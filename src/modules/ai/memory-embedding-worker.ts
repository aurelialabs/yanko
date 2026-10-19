import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

import {
  loadMemoryEmbeddingContext,
  type MemoryEmbeddingContext,
} from "./memory-embedding-data";
import {
  SupabaseMemoryEmbeddingJobStore,
  type ClaimedMemoryEmbeddingJob,
  type MemoryEmbeddingJobCompletion,
  type MemoryEmbeddingJobCompletionOutcome,
  type MemoryEmbeddingJobStore,
} from "./memory-embedding-worker-data";
import { SupabaseMemoryVectorStore } from "./memory-vector-data";
import {
  MemoryVectorError,
  indexMemoryVector,
  isValidMemoryEmbeddingAdapter,
  type MemoryEmbeddingAdapter,
  type MemoryVectorStore,
} from "./memory-vector";

export const MEMORY_EMBEDDING_WORKER_DEFAULT_BATCH_SIZE = 5;
export const MEMORY_EMBEDDING_WORKER_DEFAULT_LEASE_SECONDS = 300;

export type MemoryEmbeddingWorkerJobOutcome =
  | { type: "succeeded"; jobId: string; memoryId: string; finalStatus: "succeeded" }
  | {
      type: "cancelled";
      jobId: string;
      errorCode: "memory_unavailable";
      finalStatus: "cancelled";
    }
  | {
      type: "retry_scheduled";
      jobId: string;
      errorCode: string;
      finalStatus: "scheduled";
    }
  | { type: "failed"; jobId: string; errorCode: string; finalStatus: "failed" };

export type MemoryEmbeddingWorkerBatchOutcome =
  | { type: "disabled"; claimedCount: 0; outcomes: [] }
  | {
      type: "processed";
      claimedCount: number;
      outcomes: MemoryEmbeddingWorkerJobOutcome[];
    };

export type MemoryEmbeddingWorkerErrorCode =
  | "invalid-worker-input"
  | "worker-configuration-unavailable"
  | "job-claim-unavailable"
  | "job-completion-unavailable";

export class MemoryEmbeddingWorkerError extends Error {
  constructor(readonly code: MemoryEmbeddingWorkerErrorCode) {
    super(code);
    this.name = "MemoryEmbeddingWorkerError";
  }
}

function safeFailure(error: unknown): {
  outcome: "retryable_failure" | "permanent_failure";
  errorCode: string;
} {
  if (error instanceof MemoryVectorError) {
    switch (error.code) {
      case "invalid-input":
        return { outcome: "permanent_failure", errorCode: "invalid_input" };
      case "configuration-unavailable":
        return { outcome: "permanent_failure", errorCode: "invalid_configuration" };
      case "invalid-embedding":
        return { outcome: "permanent_failure", errorCode: "invalid_embedding" };
      case "embedding-unavailable":
        return { outcome: "retryable_failure", errorCode: "embedding_unavailable" };
      case "persistence-unavailable":
        return { outcome: "retryable_failure", errorCode: "persistence_unavailable" };
      case "retrieval-unavailable":
        return { outcome: "retryable_failure", errorCode: "worker_unavailable" };
    }
  }
  return { outcome: "retryable_failure", errorCode: "worker_unavailable" };
}

async function recordCompletion(
  store: MemoryEmbeddingJobStore,
  job: ClaimedMemoryEmbeddingJob,
  now: Date,
  completion: {
    outcome: MemoryEmbeddingJobCompletionOutcome;
    errorCode: string | null;
    providerId: string | null;
    modelId: string | null;
  },
): Promise<MemoryEmbeddingJobCompletion> {
  try {
    return await store.complete({
      jobId: job.jobId,
      claimToken: job.claimToken,
      now,
      ...completion,
    });
  } catch {
    throw new MemoryEmbeddingWorkerError("job-completion-unavailable");
  }
}

export async function processMemoryEmbeddingJob(input: {
  job: ClaimedMemoryEmbeddingJob;
  now: Date;
  adapter: MemoryEmbeddingAdapter;
  jobStore: MemoryEmbeddingJobStore;
  vectorStore: MemoryVectorStore;
  loadContext: (
    userId: string,
    memoryId: string,
  ) => Promise<MemoryEmbeddingContext | null>;
}): Promise<MemoryEmbeddingWorkerJobOutcome> {
  let context: MemoryEmbeddingContext | null;
  try {
    context = await input.loadContext(input.job.userId, input.job.memoryId);
  } catch {
    const completion = await recordCompletion(input.jobStore, input.job, input.now, {
      outcome: "retryable_failure",
      errorCode: "context_unavailable",
      providerId: null,
      modelId: null,
    });
    if (completion.status === "scheduled") {
      return {
        type: "retry_scheduled",
        jobId: input.job.jobId,
        errorCode: "context_unavailable",
        finalStatus: "scheduled",
      };
    }
    if (completion.status !== "failed") {
      throw new MemoryEmbeddingWorkerError("job-completion-unavailable");
    }
    return {
      type: "failed",
      jobId: input.job.jobId,
      errorCode: "context_unavailable",
      finalStatus: "failed",
    };
  }

  if (!context) {
    const completion = await recordCompletion(input.jobStore, input.job, input.now, {
      outcome: "cancelled",
      errorCode: "memory_unavailable",
      providerId: null,
      modelId: null,
    });
    if (completion.status !== "cancelled") {
      throw new MemoryEmbeddingWorkerError("job-completion-unavailable");
    }
    return {
      type: "cancelled",
      jobId: input.job.jobId,
      errorCode: "memory_unavailable",
      finalStatus: "cancelled",
    };
  }

  try {
    await indexMemoryVector(
      {
        userId: context.userId,
        memoryId: context.memoryId,
        content: context.content,
        expectedUpdatedAt: context.updatedAt,
        traceId: `memory-embedding-job:${input.job.jobId}:attempt:${input.job.attemptNo}`,
      },
      { adapter: input.adapter, store: input.vectorStore },
    );
  } catch (error) {
    const failure = safeFailure(error);
    const completion = await recordCompletion(input.jobStore, input.job, input.now, {
      ...failure,
      providerId: null,
      modelId: null,
    });
    if (completion.status === "scheduled") {
      return {
        type: "retry_scheduled",
        jobId: input.job.jobId,
        errorCode: failure.errorCode,
        finalStatus: "scheduled",
      };
    }
    if (completion.status !== "failed") {
      throw new MemoryEmbeddingWorkerError("job-completion-unavailable");
    }
    return {
      type: "failed",
      jobId: input.job.jobId,
      errorCode: failure.errorCode,
      finalStatus: "failed",
    };
  }

  const completion = await recordCompletion(input.jobStore, input.job, input.now, {
    outcome: "succeeded",
    errorCode: null,
    providerId: input.adapter.descriptor.providerId,
    modelId: input.adapter.descriptor.modelId,
  });
  if (completion.status !== "succeeded") {
    throw new MemoryEmbeddingWorkerError("job-completion-unavailable");
  }
  return {
    type: "succeeded",
    jobId: input.job.jobId,
    memoryId: input.job.memoryId,
    finalStatus: "succeeded",
  };
}

export function isMemoryEmbeddingWorkerEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.MEMORY_EMBEDDING_ENABLED?.trim().toLowerCase() === "true";
}

export async function runConfiguredMemoryEmbeddingWorker(input: {
  adapter?: MemoryEmbeddingAdapter;
  enabled?: boolean;
  now?: Date;
  jobId?: string;
  maxJobs?: number;
  leaseSeconds?: number;
  jobStore?: MemoryEmbeddingJobStore;
  vectorStore?: MemoryVectorStore;
  loadContext?: (
    userId: string,
    memoryId: string,
  ) => Promise<MemoryEmbeddingContext | null>;
}): Promise<MemoryEmbeddingWorkerBatchOutcome> {
  const enabled = input.enabled ?? isMemoryEmbeddingWorkerEnabled();
  if (!enabled) return { type: "disabled", claimedCount: 0, outcomes: [] };

  const now = input.now ?? new Date();
  const jobId = input.jobId?.trim();
  const maxJobs = input.maxJobs ?? MEMORY_EMBEDDING_WORKER_DEFAULT_BATCH_SIZE;
  const leaseSeconds =
    input.leaseSeconds ?? MEMORY_EMBEDDING_WORKER_DEFAULT_LEASE_SECONDS;
  if (
    !Number.isFinite(now.getTime()) ||
    (input.jobId !== undefined && !uuidSchema.safeParse(jobId).success) ||
    !Number.isInteger(maxJobs) ||
    maxJobs < 1 ||
    maxJobs > 20 ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 30 ||
    leaseSeconds > 900
  ) {
    throw new MemoryEmbeddingWorkerError("invalid-worker-input");
  }
  if (!input.adapter || !isValidMemoryEmbeddingAdapter(input.adapter)) {
    throw new MemoryEmbeddingWorkerError("worker-configuration-unavailable");
  }

  const serviceClient =
    input.jobStore && input.vectorStore ? null : createServiceRoleSupabaseClient();
  const jobStore =
    input.jobStore ??
    (serviceClient ? new SupabaseMemoryEmbeddingJobStore(serviceClient) : null);
  const vectorStore =
    input.vectorStore ??
    (serviceClient ? new SupabaseMemoryVectorStore(serviceClient) : null);
  if (!jobStore || !vectorStore) {
    throw new MemoryEmbeddingWorkerError("worker-configuration-unavailable");
  }

  let jobs: ClaimedMemoryEmbeddingJob[];
  try {
    if (jobId) {
      const claimedJob = await jobStore.claimOne({ jobId, now, leaseSeconds });
      jobs = claimedJob ? [claimedJob] : [];
    } else {
      jobs = await jobStore.claim({ limit: maxJobs, now, leaseSeconds });
    }
  } catch {
    throw new MemoryEmbeddingWorkerError("job-claim-unavailable");
  }

  const loadContext = input.loadContext ?? loadMemoryEmbeddingContext;
  const outcomes: MemoryEmbeddingWorkerJobOutcome[] = [];
  for (const job of jobs) {
    outcomes.push(
      await processMemoryEmbeddingJob({
        job,
        now,
        adapter: input.adapter,
        jobStore,
        vectorStore,
        loadContext,
      }),
    );
  }
  return { type: "processed", claimedCount: jobs.length, outcomes };
}
