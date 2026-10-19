import { describe, expect, it, vi } from "vitest";

import type { MemoryExtractionContext } from "./memory-extraction-data";
import { MemoryExtractionRuntimeError } from "./memory-extraction-runtime";
import {
  isMemoryExtractionWorkerEnabled,
  processMemoryExtractionJob,
  runConfiguredMemoryExtractionWorker,
} from "./memory-extraction-worker";
import type {
  ClaimedMemoryExtractionJob,
  MemoryExtractionJobStore,
} from "./memory-extraction-worker-data";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  message: "00000000-0000-4000-8000-000000000003",
  job: "00000000-0000-4000-8000-000000000004",
  claim: "00000000-0000-4000-8000-000000000005",
  run: "00000000-0000-4000-8000-000000000006",
};
const now = new Date("2026-09-05T08:00:00.000Z");
const job: ClaimedMemoryExtractionJob = {
  jobId: ids.job,
  userId: ids.user,
  roleId: ids.role,
  sourceMessageId: ids.message,
  claimToken: ids.claim,
  idempotencyKey: `memory-extraction-job:${ids.message}`,
  attemptNo: 1,
  leaseExpiresAt: "2026-09-05T08:05:00.000Z",
};
const context: MemoryExtractionContext = {
  userId: ids.user,
  roleId: ids.role,
  roleName: "林知夏",
  sourceMessageId: ids.message,
  sourceMessage: "以后我难过时请先听我说完。",
  existingMemories: [],
};

function createStore(
  completionStatus?: "scheduled" | "succeeded" | "failed" | "cancelled",
): MemoryExtractionJobStore {
  return {
    claim: vi.fn().mockResolvedValue([job]),
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

const successfulExtraction = {
  runId: ids.run,
  candidateIds: [],
  memoryIds: [],
  discardedCount: 0,
  replayed: false,
};

describe("memory extraction worker", () => {
  it("enables only an explicit true value", () => {
    expect(isMemoryExtractionWorkerEnabled({})).toBe(false);
    expect(
      isMemoryExtractionWorkerEnabled({ MEMORY_EXTRACTION_ENABLED: "false" }),
    ).toBe(false);
    expect(
      isMemoryExtractionWorkerEnabled({ MEMORY_EXTRACTION_ENABLED: " TRUE " }),
    ).toBe(true);
  });

  it("does not claim jobs or require a provider while disabled", async () => {
    const store = createStore();
    await expect(
      runConfiguredMemoryExtractionWorker({ enabled: false, store }),
    ).resolves.toEqual({ type: "disabled", claimedCount: 0, outcomes: [] });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("requires an explicitly injected executor or adapter before claiming", async () => {
    const store = createStore();
    await expect(
      runConfiguredMemoryExtractionWorker({ enabled: true, store }),
    ).rejects.toMatchObject({ code: "worker-configuration-unavailable" });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("claims a bounded batch and completes a grounded extraction", async () => {
    const store = createStore();
    const loadContext = vi.fn().mockResolvedValue(context);
    const extract = vi.fn().mockResolvedValue(successfulExtraction);

    await expect(
      runConfiguredMemoryExtractionWorker({
        enabled: true,
        now,
        maxJobs: 3,
        leaseSeconds: 120,
        store,
        loadContext,
        extract,
      }),
    ).resolves.toEqual({
      type: "processed",
      claimedCount: 1,
      outcomes: [
        { type: "succeeded", jobId: ids.job, runId: ids.run, finalStatus: "succeeded" },
      ],
    });
    expect(store.claim).toHaveBeenCalledWith({ limit: 3, now, leaseSeconds: 120 });
    expect(loadContext).toHaveBeenCalledWith(ids.user, ids.role, ids.message);
    expect(extract).toHaveBeenCalledWith({
      context,
      idempotencyKey: job.idempotencyKey,
      traceId: `memory-job:${ids.job}:attempt:1`,
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

  it("claims only the explicitly requested event job", async () => {
    const store = createStore();

    await expect(
      runConfiguredMemoryExtractionWorker({
        enabled: true,
        jobId: ids.job,
        now,
        maxJobs: 20,
        leaseSeconds: 120,
        store,
        loadContext: vi.fn().mockResolvedValue(context),
        extract: vi.fn().mockResolvedValue(successfulExtraction),
      }),
    ).resolves.toMatchObject({ type: "processed", claimedCount: 1 });

    expect(store.claimOne).toHaveBeenCalledWith({
      jobId: ids.job,
      now,
      leaseSeconds: 120,
    });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("rejects an invalid event job id before touching the queue", async () => {
    const store = createStore();

    await expect(
      runConfiguredMemoryExtractionWorker({
        enabled: true,
        jobId: "not-a-job-id",
        store,
        extract: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "invalid-worker-input" });

    expect(store.claimOne).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("cancels a job whose source can no longer be safely loaded", async () => {
    const store = createStore();
    const extract = vi.fn();
    await expect(
      processMemoryExtractionJob({
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
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "cancelled",
        errorCode: "source_unavailable",
      }),
    );
  });

  it("retries when the source database cannot be checked", async () => {
    const store = createStore();
    const extract = vi.fn();
    await expect(
      processMemoryExtractionJob({
        job,
        now,
        store,
        loadContext: vi.fn().mockRejectedValue(new Error("private database detail")),
        extract,
      }),
    ).resolves.toEqual({
      type: "retry_scheduled",
      jobId: ids.job,
      errorCode: "context_unavailable",
      finalStatus: "scheduled",
    });
    expect(extract).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "retryable_failure",
        errorCode: "context_unavailable",
      }),
    );
  });

  it("schedules only retryable runtime failures without exposing provider errors", async () => {
    const store = createStore();
    await expect(
      processMemoryExtractionJob({
        job,
        now,
        store,
        loadContext: vi.fn().mockResolvedValue(context),
        extract: vi
          .fn()
          .mockRejectedValue(new MemoryExtractionRuntimeError("extractor-unavailable")),
      }),
    ).resolves.toEqual({
      type: "retry_scheduled",
      jobId: ids.job,
      errorCode: "extractor_unavailable",
      finalStatus: "scheduled",
    });
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "retryable_failure",
        errorCode: "extractor_unavailable",
      }),
    );
  });

  it("marks invalid input as a permanent failure", async () => {
    const store = createStore();
    await expect(
      processMemoryExtractionJob({
        job,
        now,
        store,
        loadContext: vi.fn().mockResolvedValue(context),
        extract: vi
          .fn()
          .mockRejectedValue(new MemoryExtractionRuntimeError("invalid-input")),
      }),
    ).resolves.toEqual({
      type: "failed",
      jobId: ids.job,
      errorCode: "invalid_input",
      finalStatus: "failed",
    });
  });

  it("fails closed when the database returns an impossible completion state", async () => {
    const store = createStore("cancelled");
    await expect(
      processMemoryExtractionJob({
        job,
        now,
        store,
        loadContext: vi.fn().mockResolvedValue(context),
        extract: vi.fn().mockResolvedValue(successfulExtraction),
      }),
    ).rejects.toMatchObject({ code: "job-completion-unavailable" });
  });

  it("maps claim failures to a stable internal code", async () => {
    const store = createStore();
    vi.mocked(store.claim).mockRejectedValue(new Error("private database detail"));
    await expect(
      runConfiguredMemoryExtractionWorker({
        enabled: true,
        store,
        extract: vi.fn(),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "job-claim-unavailable" }));
  });
});
