import { describe, expect, it, vi } from "vitest";

import type { EmotionRuntimeResult } from "./emotion-runtime";
import {
  EmotionSignalWorkerError,
  isEmotionSignalWorkerEnabled,
  processEmotionSignalJob,
  runConfiguredEmotionSignalWorker,
} from "./emotion-signal-worker";
import type {
  ClaimedEmotionSignalJob,
  EmotionSignalJobStore,
} from "./emotion-signal-worker-data";

const now = new Date("2026-09-08T02:00:00.000Z");
const job: ClaimedEmotionSignalJob = {
  jobId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000002",
  roleId: "30000000-0000-4000-8000-000000000003",
  sourceMessageId: "40000000-0000-4000-8000-000000000004",
  claimToken: "50000000-0000-4000-8000-000000000005",
  idempotencyKey: "emotion-signal-job-001",
  attemptNo: 1,
  leaseExpiresAt: "2026-09-08T02:05:00.000Z",
};

const context = {
  userId: job.userId,
  roleId: job.roleId,
  sourceMessageId: job.sourceMessageId,
  sourceMessage: "我今天被事情压得很难受。",
};

const supportOnly: EmotionRuntimeResult = {
  outcome: "support_only",
  policy: {
    outcome: "support_only",
    emotionType: "overwhelm",
    intensity: 0.71,
    supportMode: "listen",
  },
};

function storeWith(status: "scheduled" | "succeeded" | "failed" | "cancelled") {
  const store: EmotionSignalJobStore = {
    claimOne: vi.fn().mockResolvedValue(job),
    complete: vi.fn().mockResolvedValue({
      jobId: job.jobId,
      status,
      attemptCount: 1,
      availableAt: now.toISOString(),
    }),
  };
  return store;
}

describe("emotion signal exact job worker", () => {
  it("is default-off and does not claim a task before explicit enablement", async () => {
    const store = storeWith("succeeded");
    await expect(
      runConfiguredEmotionSignalWorker({ store, jobId: "not-a-uuid" }),
    ).resolves.toEqual({ type: "disabled", claimedCount: 0, outcomes: [] });
    expect(store.claimOne).not.toHaveBeenCalled();
    expect(isEmotionSignalWorkerEnabled({ EMOTION_SIGNAL_ENABLED: "false" })).toBe(
      false,
    );
    expect(isEmotionSignalWorkerEnabled({ EMOTION_SIGNAL_ENABLED: " TRUE " })).toBe(
      true,
    );
  });

  it("claims precisely one supplied event, loads only its context, and completes safely", async () => {
    const store = storeWith("succeeded");
    const loadContext = vi.fn().mockResolvedValue(context);
    const classify = vi.fn().mockResolvedValue(supportOnly);

    await expect(
      runConfiguredEmotionSignalWorker({
        enabled: true,
        store,
        jobId: job.jobId,
        now,
        loadContext,
        classify,
      }),
    ).resolves.toEqual({
      type: "processed",
      claimedCount: 1,
      outcomes: [{ type: "succeeded", jobId: job.jobId, finalStatus: "succeeded" }],
    });
    expect(store.claimOne).toHaveBeenCalledWith({
      jobId: job.jobId,
      now,
      leaseSeconds: 300,
    });
    expect(loadContext).toHaveBeenCalledWith(
      job.userId,
      job.roleId,
      job.sourceMessageId,
    );
    expect(classify).toHaveBeenCalledWith({
      context,
      idempotencyKey: job.idempotencyKey,
      traceId: `emotion-job:${job.jobId}:attempt:1`,
    });
    expect(store.complete).toHaveBeenCalledWith({
      jobId: job.jobId,
      claimToken: job.claimToken,
      outcome: "succeeded",
      errorCode: null,
      now,
    });
  });

  it("cancels an unavailable source without classifying it", async () => {
    const store = storeWith("cancelled");
    const classify = vi.fn();
    await expect(
      processEmotionSignalJob({
        job,
        now,
        store,
        loadContext: async () => null,
        classify,
      }),
    ).resolves.toMatchObject({ type: "cancelled", errorCode: "source_unavailable" });
    expect(classify).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "cancelled",
        errorCode: "source_unavailable",
      }),
    );
  });

  it("uses bounded retry state for unavailable classification without exposing the error", async () => {
    const store = storeWith("scheduled");
    await expect(
      processEmotionSignalJob({
        job,
        now,
        store,
        loadContext: async () => context,
        classify: async () => {
          throw new Error("provider response with private detail");
        },
      }),
    ).resolves.toEqual({
      type: "retry_scheduled",
      jobId: job.jobId,
      errorCode: "worker_unavailable",
      finalStatus: "scheduled",
    });
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "retryable_failure",
        errorCode: "worker_unavailable",
      }),
    );
  });

  it("requires a valid exact task ID and either an executor or an adapter", async () => {
    const store = storeWith("succeeded");
    await expect(
      runConfiguredEmotionSignalWorker({ enabled: true, store, jobId: "not-a-uuid" }),
    ).rejects.toEqual(new EmotionSignalWorkerError("invalid-worker-input"));
    await expect(
      runConfiguredEmotionSignalWorker({ enabled: true, store, jobId: job.jobId }),
    ).rejects.toEqual(new EmotionSignalWorkerError("worker-configuration-unavailable"));
  });
});
