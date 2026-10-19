import { describe, expect, it, vi } from "vitest";

import type { MemoryEmbeddingContext } from "./memory-embedding-data";
import {
  isMemoryEmbeddingWorkerEnabled,
  processMemoryEmbeddingJob,
  runConfiguredMemoryEmbeddingWorker,
} from "./memory-embedding-worker";
import type {
  ClaimedMemoryEmbeddingJob,
  MemoryEmbeddingJobStore,
} from "./memory-embedding-worker-data";
import {
  MEMORY_EMBEDDING_DIMENSIONS,
  type MemoryEmbeddingAdapter,
  type MemoryVectorStore,
} from "./memory-vector";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  memory: "00000000-0000-4000-8000-000000000002",
  job: "00000000-0000-4000-8000-000000000003",
  claim: "00000000-0000-4000-8000-000000000004",
};
const now = new Date("2026-09-07T04:00:00.000Z");
const context: MemoryEmbeddingContext = {
  userId: ids.user,
  memoryId: ids.memory,
  content: "用户难过时希望先被完整倾听。",
  updatedAt: "2026-09-07T03:59:00.000Z",
};
const job: ClaimedMemoryEmbeddingJob = {
  jobId: ids.job,
  userId: ids.user,
  memoryId: ids.memory,
  claimToken: ids.claim,
  idempotencyKey: `memory-embedding-job:${ids.memory}`,
  attemptNo: 1,
  leaseExpiresAt: "2026-09-07T04:05:00.000Z",
};
const vector = Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, index) =>
  index === 0 ? 1 : 0,
);

function adapter(outputVector: readonly number[] = vector): MemoryEmbeddingAdapter {
  return {
    descriptor: {
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      dimensions: MEMORY_EMBEDDING_DIMENSIONS,
    },
    embed: vi.fn().mockResolvedValue({
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      vector: outputVector,
      latencyMs: 0,
    }),
  };
}

function jobStore(
  completionStatus?: "scheduled" | "succeeded" | "failed" | "cancelled",
): MemoryEmbeddingJobStore {
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

function vectorStore(): MemoryVectorStore {
  return {
    save: vi.fn(async (input) => input.memoryId),
    search: vi.fn().mockResolvedValue([]),
  };
}

describe("memory embedding worker", () => {
  it("enables only an explicit true value", () => {
    expect(isMemoryEmbeddingWorkerEnabled({})).toBe(false);
    expect(isMemoryEmbeddingWorkerEnabled({ MEMORY_EMBEDDING_ENABLED: "false" })).toBe(
      false,
    );
    expect(isMemoryEmbeddingWorkerEnabled({ MEMORY_EMBEDDING_ENABLED: " TRUE " })).toBe(
      true,
    );
  });

  it("does not claim or require an adapter while disabled", async () => {
    const store = jobStore();
    await expect(
      runConfiguredMemoryEmbeddingWorker({ enabled: false, jobStore: store }),
    ).resolves.toEqual({ type: "disabled", claimedCount: 0, outcomes: [] });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("requires an explicit valid adapter before claiming", async () => {
    const store = jobStore();
    await expect(
      runConfiguredMemoryEmbeddingWorker({ enabled: true, jobStore: store }),
    ).rejects.toMatchObject({ code: "worker-configuration-unavailable" });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("claims one explicit job, writes its vector, and completes with model identity", async () => {
    const jobs = jobStore();
    const vectors = vectorStore();
    const embeddingAdapter = adapter();

    await expect(
      runConfiguredMemoryEmbeddingWorker({
        enabled: true,
        jobId: ids.job,
        now,
        leaseSeconds: 120,
        adapter: embeddingAdapter,
        jobStore: jobs,
        vectorStore: vectors,
        loadContext: vi.fn().mockResolvedValue(context),
      }),
    ).resolves.toEqual({
      type: "processed",
      claimedCount: 1,
      outcomes: [
        {
          type: "succeeded",
          jobId: ids.job,
          memoryId: ids.memory,
          finalStatus: "succeeded",
        },
      ],
    });

    expect(jobs.claimOne).toHaveBeenCalledWith({
      jobId: ids.job,
      now,
      leaseSeconds: 120,
    });
    expect(jobs.claim).not.toHaveBeenCalled();
    expect(vectors.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ids.user,
        memoryId: ids.memory,
        expectedContent: context.content,
        expectedUpdatedAt: context.updatedAt,
      }),
    );
    expect(jobs.complete).toHaveBeenCalledWith({
      jobId: ids.job,
      claimToken: ids.claim,
      outcome: "succeeded",
      errorCode: null,
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      now,
    });
  });

  it("cancels a job whose active memory can no longer be loaded", async () => {
    const jobs = jobStore();
    const vectors = vectorStore();
    const embeddingAdapter = adapter();

    await expect(
      processMemoryEmbeddingJob({
        job,
        now,
        adapter: embeddingAdapter,
        jobStore: jobs,
        vectorStore: vectors,
        loadContext: vi.fn().mockResolvedValue(null),
      }),
    ).resolves.toMatchObject({
      type: "cancelled",
      errorCode: "memory_unavailable",
    });
    expect(embeddingAdapter.embed).not.toHaveBeenCalled();
  });

  it("retries a temporary context query failure with a safe code", async () => {
    const jobs = jobStore();

    await expect(
      processMemoryEmbeddingJob({
        job,
        now,
        adapter: adapter(),
        jobStore: jobs,
        vectorStore: vectorStore(),
        loadContext: vi.fn().mockRejectedValue(new Error("private database detail")),
      }),
    ).resolves.toMatchObject({
      type: "retry_scheduled",
      errorCode: "context_unavailable",
    });
  });

  it("marks an invalid provider vector as a permanent failure", async () => {
    const jobs = jobStore();

    await expect(
      processMemoryEmbeddingJob({
        job,
        now,
        adapter: adapter([1, 0, 0]),
        jobStore: jobs,
        vectorStore: vectorStore(),
        loadContext: vi.fn().mockResolvedValue(context),
      }),
    ).resolves.toMatchObject({ type: "failed", errorCode: "invalid_embedding" });
    expect(jobs.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "permanent_failure",
        errorCode: "invalid_embedding",
      }),
    );
  });

  it("retries persistence failure without exposing the database error", async () => {
    const jobs = jobStore();
    const vectors = vectorStore();
    vi.mocked(vectors.save).mockRejectedValue(new Error("private database detail"));

    await expect(
      processMemoryEmbeddingJob({
        job,
        now,
        adapter: adapter(),
        jobStore: jobs,
        vectorStore: vectors,
        loadContext: vi.fn().mockResolvedValue(context),
      }),
    ).resolves.toMatchObject({
      type: "retry_scheduled",
      errorCode: "persistence_unavailable",
    });
  });

  it("rejects an invalid event job id before touching the queue", async () => {
    const jobs = jobStore();
    await expect(
      runConfiguredMemoryEmbeddingWorker({
        enabled: true,
        jobId: "not-a-job-id",
        adapter: adapter(),
        jobStore: jobs,
        vectorStore: vectorStore(),
      }),
    ).rejects.toMatchObject({ code: "invalid-worker-input" });
    expect(jobs.claimOne).not.toHaveBeenCalled();
  });
});
