import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

import type { ModelAdapter } from "./model-adapter";
import {
  loadMemoryExtractionContext,
  persistMemoryExtraction,
  type MemoryExtractionContext,
  type PersistedMemoryExtraction,
} from "./memory-extraction-data";
import {
  MemoryExtractionRuntimeError,
  runMemoryExtraction,
} from "./memory-extraction-runtime";
import {
  SupabaseMemoryExtractionJobStore,
  type ClaimedMemoryExtractionJob,
  type MemoryExtractionJobCompletion,
  type MemoryExtractionJobCompletionOutcome,
  type MemoryExtractionJobStore,
} from "./memory-extraction-worker-data";

export const MEMORY_EXTRACTION_WORKER_DEFAULT_BATCH_SIZE = 5;
export const MEMORY_EXTRACTION_WORKER_DEFAULT_LEASE_SECONDS = 300;

export type MemoryExtractionExecutor = (input: {
  context: MemoryExtractionContext;
  idempotencyKey: string;
  traceId: string;
}) => Promise<PersistedMemoryExtraction>;

export type MemoryExtractionWorkerJobOutcome =
  | { type: "succeeded"; jobId: string; runId: string; finalStatus: "succeeded" }
  | {
      type: "cancelled";
      jobId: string;
      errorCode: "source_unavailable";
      finalStatus: "cancelled";
    }
  | {
      type: "retry_scheduled";
      jobId: string;
      errorCode: string;
      finalStatus: "scheduled";
    }
  | { type: "failed"; jobId: string; errorCode: string; finalStatus: "failed" };

export type MemoryExtractionWorkerBatchOutcome =
  | { type: "disabled"; claimedCount: 0; outcomes: [] }
  | {
      type: "processed";
      claimedCount: number;
      outcomes: MemoryExtractionWorkerJobOutcome[];
    };

export type MemoryExtractionWorkerErrorCode =
  | "invalid-worker-input"
  | "worker-configuration-unavailable"
  | "job-claim-unavailable"
  | "job-completion-unavailable";

export class MemoryExtractionWorkerError extends Error {
  constructor(readonly code: MemoryExtractionWorkerErrorCode) {
    super(code);
    this.name = "MemoryExtractionWorkerError";
  }
}

function safeFailure(error: unknown): {
  outcome: "retryable_failure" | "permanent_failure";
  errorCode: string;
} {
  if (error instanceof MemoryExtractionRuntimeError) {
    switch (error.code) {
      case "invalid-input":
        return { outcome: "permanent_failure", errorCode: "invalid_input" };
      case "disabled":
        return { outcome: "permanent_failure", errorCode: "runtime_disabled" };
      case "persistence-unavailable":
        return { outcome: "retryable_failure", errorCode: "persistence_unavailable" };
      case "extractor-unavailable":
        return { outcome: "retryable_failure", errorCode: "extractor_unavailable" };
    }
  }
  return { outcome: "retryable_failure", errorCode: "worker_unavailable" };
}

async function recordCompletion(
  store: MemoryExtractionJobStore,
  job: ClaimedMemoryExtractionJob,
  now: Date,
  completion: {
    outcome: MemoryExtractionJobCompletionOutcome;
    errorCode: string | null;
    extractionRunId: string | null;
  },
): Promise<MemoryExtractionJobCompletion> {
  try {
    return await store.complete({
      jobId: job.jobId,
      claimToken: job.claimToken,
      now,
      ...completion,
    });
  } catch {
    throw new MemoryExtractionWorkerError("job-completion-unavailable");
  }
}

export async function processMemoryExtractionJob(input: {
  job: ClaimedMemoryExtractionJob;
  now: Date;
  store: MemoryExtractionJobStore;
  loadContext: (
    userId: string,
    roleId: string,
    sourceMessageId: string,
  ) => Promise<MemoryExtractionContext | null>;
  extract: MemoryExtractionExecutor;
}): Promise<MemoryExtractionWorkerJobOutcome> {
  let context: MemoryExtractionContext | null;
  try {
    context = await input.loadContext(
      input.job.userId,
      input.job.roleId,
      input.job.sourceMessageId,
    );
  } catch {
    const completion = await recordCompletion(input.store, input.job, input.now, {
      outcome: "retryable_failure",
      errorCode: "context_unavailable",
      extractionRunId: null,
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
      throw new MemoryExtractionWorkerError("job-completion-unavailable");
    }
    return {
      type: "failed",
      jobId: input.job.jobId,
      errorCode: "context_unavailable",
      finalStatus: "failed",
    };
  }

  if (!context) {
    const completion = await recordCompletion(input.store, input.job, input.now, {
      outcome: "cancelled",
      errorCode: "source_unavailable",
      extractionRunId: null,
    });
    if (completion.status !== "cancelled") {
      throw new MemoryExtractionWorkerError("job-completion-unavailable");
    }
    return {
      type: "cancelled",
      jobId: input.job.jobId,
      errorCode: "source_unavailable",
      finalStatus: "cancelled",
    };
  }

  let extraction: PersistedMemoryExtraction;
  try {
    extraction = await input.extract({
      context,
      idempotencyKey: input.job.idempotencyKey,
      traceId: `memory-job:${input.job.jobId}:attempt:${input.job.attemptNo}`,
    });
  } catch (error) {
    const failure = safeFailure(error);
    const completion = await recordCompletion(input.store, input.job, input.now, {
      ...failure,
      extractionRunId: null,
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
      throw new MemoryExtractionWorkerError("job-completion-unavailable");
    }
    return {
      type: "failed",
      jobId: input.job.jobId,
      errorCode: failure.errorCode,
      finalStatus: "failed",
    };
  }

  const completion = await recordCompletion(input.store, input.job, input.now, {
    outcome: "succeeded",
    errorCode: null,
    extractionRunId: extraction.runId,
  });
  if (completion.status !== "succeeded") {
    throw new MemoryExtractionWorkerError("job-completion-unavailable");
  }
  return {
    type: "succeeded",
    jobId: input.job.jobId,
    runId: extraction.runId,
    finalStatus: "succeeded",
  };
}

export function isMemoryExtractionWorkerEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.MEMORY_EXTRACTION_ENABLED?.trim().toLowerCase() === "true";
}

/** Claims a small batch, or one explicit event job, then processes sequentially. */
export async function runConfiguredMemoryExtractionWorker(input: {
  adapter?: ModelAdapter;
  enabled?: boolean;
  now?: Date;
  jobId?: string;
  maxJobs?: number;
  leaseSeconds?: number;
  store?: MemoryExtractionJobStore;
  loadContext?: (
    userId: string,
    roleId: string,
    sourceMessageId: string,
  ) => Promise<MemoryExtractionContext | null>;
  extract?: MemoryExtractionExecutor;
}): Promise<MemoryExtractionWorkerBatchOutcome> {
  const enabled = input.enabled ?? isMemoryExtractionWorkerEnabled();
  if (!enabled) return { type: "disabled", claimedCount: 0, outcomes: [] };

  const now = input.now ?? new Date();
  const maxJobs = input.maxJobs ?? MEMORY_EXTRACTION_WORKER_DEFAULT_BATCH_SIZE;
  const leaseSeconds =
    input.leaseSeconds ?? MEMORY_EXTRACTION_WORKER_DEFAULT_LEASE_SECONDS;
  const jobId = input.jobId?.trim();
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
    throw new MemoryExtractionWorkerError("invalid-worker-input");
  }

  const serviceClient = input.store ? null : createServiceRoleSupabaseClient();
  const store =
    input.store ??
    (serviceClient ? new SupabaseMemoryExtractionJobStore(serviceClient) : null);
  if (!store || (!input.extract && !input.adapter)) {
    throw new MemoryExtractionWorkerError("worker-configuration-unavailable");
  }

  let jobs: ClaimedMemoryExtractionJob[];
  try {
    if (jobId) {
      const claimedJob = await store.claimOne({ jobId, now, leaseSeconds });
      jobs = claimedJob ? [claimedJob] : [];
    } else {
      jobs = await store.claim({ limit: maxJobs, now, leaseSeconds });
    }
  } catch {
    throw new MemoryExtractionWorkerError("job-claim-unavailable");
  }

  const loadContext = input.loadContext ?? loadMemoryExtractionContext;
  const extract =
    input.extract ??
    (async ({ context, idempotencyKey, traceId }) =>
      runMemoryExtraction(
        { context, idempotencyKey, traceId },
        {
          enabled: true,
          adapter: input.adapter!,
          persist: persistMemoryExtraction,
        },
      ));
  const outcomes: MemoryExtractionWorkerJobOutcome[] = [];
  for (const job of jobs) {
    outcomes.push(
      await processMemoryExtractionJob({ job, now, store, loadContext, extract }),
    );
  }
  return { type: "processed", claimedCount: jobs.length, outcomes };
}
