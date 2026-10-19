import { describe, expect, it, vi } from "vitest";

import type { PlanExtractionContext } from "./plan-extraction-data";
import { PlanExtractionRuntimeError } from "./plan-extraction-runtime";
import {
  isPlanExtractionWorkerEnabled,
  processPlanExtractionJob,
  runConfiguredPlanExtractionWorker,
} from "./plan-extraction-worker";
import type {
  ClaimedPlanExtractionJob,
  PlanExtractionJobStore,
} from "./plan-extraction-worker-data";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  message: "00000000-0000-4000-8000-000000000003",
  job: "00000000-0000-4000-8000-000000000004",
  claim: "00000000-0000-4000-8000-000000000005",
  run: "00000000-0000-4000-8000-000000000006",
  proposal: "00000000-0000-4000-8000-000000000007",
};
const now = new Date("2026-09-07T10:00:00.000Z");
const job: ClaimedPlanExtractionJob = {
  jobId: ids.job,
  userId: ids.user,
  roleId: ids.role,
  sourceMessageId: ids.message,
  claimToken: ids.claim,
  idempotencyKey: `plan-extraction-job:${ids.message}`,
  attemptNo: 1,
  leaseExpiresAt: "2026-09-07T10:05:00.000Z",
};
const context: PlanExtractionContext = {
  userId: ids.user,
  roleId: ids.role,
  roleName: "林知夏",
  sourceMessageId: ids.message,
  sourceMessage: "请帮我创建明天晚上七点半整理作品集首页的日计划。",
  timezone: "Asia/Shanghai",
};
const extraction = {
  runId: ids.run,
  proposalId: ids.proposal,
  replayed: false,
};

function createStore(
  completionStatus?: "scheduled" | "succeeded" | "failed" | "cancelled",
): PlanExtractionJobStore {
  return {
    claimOne: vi.fn().mockResolvedValue(job),
    complete: vi.fn(async (input) => ({
      jobId: input.jobId,
      status:
        completionStatus ??
        (input.outcome === "succeeded"
          ? "succeeded"
          : input.outcome === "cancelled"
            ? "cancelled"
            : input.outcome === "retryable_failure"
              ? "scheduled"
              : "failed"),
      attemptCount: 1,
      availableAt: now.toISOString(),
    })),
  };
}

describe("plan extraction worker", () => {
  it("enables only an explicit true value", () => {
    expect(isPlanExtractionWorkerEnabled({})).toBe(false);
    expect(isPlanExtractionWorkerEnabled({ PLAN_EXTRACTION_ENABLED: "false" })).toBe(
      false,
    );
    expect(isPlanExtractionWorkerEnabled({ PLAN_EXTRACTION_ENABLED: " TRUE " })).toBe(
      true,
    );
  });

  it("does not require a job, store, or adapter while disabled", async () => {
    await expect(
      runConfiguredPlanExtractionWorker({ enabled: false }),
    ).resolves.toEqual({ type: "disabled", claimedCount: 0, outcomes: [] });
  });

  it("requires one valid explicit job id before touching the queue", async () => {
    const store = createStore();
    await expect(
      runConfiguredPlanExtractionWorker({
        enabled: true,
        jobId: "not-a-job-id",
        store,
        extract: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "invalid-worker-input" });
    expect(store.claimOne).not.toHaveBeenCalled();
  });

  it("requires an explicitly injected executor or adapter before claiming", async () => {
    const store = createStore();
    await expect(
      runConfiguredPlanExtractionWorker({ enabled: true, jobId: ids.job, store }),
    ).rejects.toMatchObject({ code: "worker-configuration-unavailable" });
    expect(store.claimOne).not.toHaveBeenCalled();
  });

  it("claims and processes only the exact event job", async () => {
    const store = createStore();
    const loadContext = vi.fn().mockResolvedValue(context);
    const extract = vi.fn().mockResolvedValue(extraction);
    await expect(
      runConfiguredPlanExtractionWorker({
        enabled: true,
        jobId: ids.job,
        now,
        leaseSeconds: 120,
        store,
        loadContext,
        extract,
      }),
    ).resolves.toEqual({
      type: "processed",
      claimedCount: 1,
      outcomes: [
        {
          type: "succeeded",
          jobId: ids.job,
          runId: ids.run,
          finalStatus: "succeeded",
        },
      ],
    });
    expect(store.claimOne).toHaveBeenCalledWith({
      jobId: ids.job,
      now,
      leaseSeconds: 120,
    });
    expect(extract).toHaveBeenCalledWith({
      context,
      idempotencyKey: job.idempotencyKey,
      now,
      traceId: `plan-job:${ids.job}:attempt:1`,
    });
    expect(store.complete).toHaveBeenCalledWith({
      jobId: ids.job,
      claimToken: ids.claim,
      outcome: "succeeded",
      errorCode: null,
      extractionRunId: ids.run,
      now,
    });
  });

  it("returns a safe empty result when the exact job is not eligible", async () => {
    const store = createStore();
    vi.mocked(store.claimOne).mockResolvedValue(null);
    await expect(
      runConfiguredPlanExtractionWorker({
        enabled: true,
        jobId: ids.job,
        store,
        extract: vi.fn(),
      }),
    ).resolves.toEqual({ type: "processed", claimedCount: 0, outcomes: [] });
  });

  it("cancels a claimed job when its source is no longer available", async () => {
    const store = createStore();
    const extract = vi.fn();
    await expect(
      processPlanExtractionJob({
        job,
        now,
        store,
        loadContext: vi.fn().mockResolvedValue(null),
        extract,
      }),
    ).resolves.toEqual({
      type: "cancelled",
      jobId: ids.job,
      errorCode: "source_unavailable",
      finalStatus: "cancelled",
    });
    expect(extract).not.toHaveBeenCalled();
  });

  it("retries context, classifier, and persistence availability failures with safe codes", async () => {
    for (const [error, errorCode] of [
      [new Error("private database detail"), "context_unavailable"],
      [
        new PlanExtractionRuntimeError("classifier-unavailable"),
        "classifier_unavailable",
      ],
      [
        new PlanExtractionRuntimeError("persistence-unavailable"),
        "persistence_unavailable",
      ],
    ] as const) {
      const store = createStore();
      const loadContext =
        errorCode === "context_unavailable"
          ? vi.fn().mockRejectedValue(error)
          : vi.fn().mockResolvedValue(context);
      const extract = vi.fn().mockRejectedValue(error);
      await expect(
        processPlanExtractionJob({ job, now, store, loadContext, extract }),
      ).resolves.toMatchObject({
        type: "retry_scheduled",
        errorCode,
        finalStatus: "scheduled",
      });
    }
  });

  it("marks invalid runtime input and a disabled runtime as permanent failures", async () => {
    for (const [error, errorCode] of [
      [new PlanExtractionRuntimeError("invalid-input"), "invalid_input"],
      [new PlanExtractionRuntimeError("disabled"), "runtime_disabled"],
    ] as const) {
      const store = createStore();
      await expect(
        processPlanExtractionJob({
          job,
          now,
          store,
          loadContext: vi.fn().mockResolvedValue(context),
          extract: vi.fn().mockRejectedValue(error),
        }),
      ).resolves.toMatchObject({ type: "failed", errorCode, finalStatus: "failed" });
    }
  });

  it("fails closed for claim errors and impossible completion states", async () => {
    const claimFailure = createStore();
    vi.mocked(claimFailure.claimOne).mockRejectedValue(
      new Error("private database detail"),
    );
    await expect(
      runConfiguredPlanExtractionWorker({
        enabled: true,
        jobId: ids.job,
        store: claimFailure,
        extract: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "job-claim-unavailable" });

    await expect(
      processPlanExtractionJob({
        job,
        now,
        store: createStore("cancelled"),
        loadContext: vi.fn().mockResolvedValue(context),
        extract: vi.fn().mockResolvedValue(extraction),
      }),
    ).rejects.toMatchObject({ code: "job-completion-unavailable" });
  });
});
