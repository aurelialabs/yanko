import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

import type { ModelAdapter } from "../ai/model-adapter";
import {
  loadPlanExtractionContext,
  persistPlanExtraction,
  type PersistedPlanExtraction,
  type PlanExtractionContext,
} from "./plan-extraction-data";
import {
  PlanExtractionRuntimeError,
  runPlanExtraction,
} from "./plan-extraction-runtime";
import {
  SupabasePlanExtractionJobStore,
  type ClaimedPlanExtractionJob,
  type PlanExtractionJobCompletion,
  type PlanExtractionJobCompletionOutcome,
  type PlanExtractionJobStore,
} from "./plan-extraction-worker-data";

export const PLAN_EXTRACTION_WORKER_DEFAULT_LEASE_SECONDS = 300;

export type PlanExtractionExecutor = (input: {
  context: PlanExtractionContext;
  idempotencyKey: string;
  now: Date;
  traceId: string;
}) => Promise<PersistedPlanExtraction>;

export type PlanExtractionWorkerJobOutcome =
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

export type PlanExtractionWorkerOutcome =
  | { type: "disabled"; claimedCount: 0; outcomes: [] }
  | {
      type: "processed";
      claimedCount: 0 | 1;
      outcomes: PlanExtractionWorkerJobOutcome[];
    };

export type PlanExtractionWorkerErrorCode =
  | "invalid-worker-input"
  | "worker-configuration-unavailable"
  | "job-claim-unavailable"
  | "job-completion-unavailable";

export class PlanExtractionWorkerError extends Error {
  constructor(readonly code: PlanExtractionWorkerErrorCode) {
    super(code);
    this.name = "PlanExtractionWorkerError";
  }
}

function safeFailure(error: unknown): {
  outcome: "retryable_failure" | "permanent_failure";
  errorCode: string;
} {
  if (error instanceof PlanExtractionRuntimeError) {
    switch (error.code) {
      case "invalid-input":
        return { outcome: "permanent_failure", errorCode: "invalid_input" };
      case "disabled":
        return { outcome: "permanent_failure", errorCode: "runtime_disabled" };
      case "classifier-unavailable":
        return {
          outcome: "retryable_failure",
          errorCode: "classifier_unavailable",
        };
      case "persistence-unavailable":
        return {
          outcome: "retryable_failure",
          errorCode: "persistence_unavailable",
        };
    }
  }

  return { outcome: "retryable_failure", errorCode: "worker_unavailable" };
}

async function recordCompletion(
  store: PlanExtractionJobStore,
  job: ClaimedPlanExtractionJob,
  now: Date,
  completion: {
    outcome: PlanExtractionJobCompletionOutcome;
    errorCode: string | null;
    extractionRunId: string | null;
  },
): Promise<PlanExtractionJobCompletion> {
  try {
    return await store.complete({
      jobId: job.jobId,
      claimToken: job.claimToken,
      now,
      ...completion,
    });
  } catch {
    throw new PlanExtractionWorkerError("job-completion-unavailable");
  }
}

export async function processPlanExtractionJob(input: {
  job: ClaimedPlanExtractionJob;
  now: Date;
  store: PlanExtractionJobStore;
  loadContext: (
    userId: string,
    roleId: string,
    sourceMessageId: string,
  ) => Promise<PlanExtractionContext | null>;
  extract: PlanExtractionExecutor;
}): Promise<PlanExtractionWorkerJobOutcome> {
  let context: PlanExtractionContext | null;
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
      throw new PlanExtractionWorkerError("job-completion-unavailable");
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
      throw new PlanExtractionWorkerError("job-completion-unavailable");
    }
    return {
      type: "cancelled",
      jobId: input.job.jobId,
      errorCode: "source_unavailable",
      finalStatus: "cancelled",
    };
  }

  let extraction: PersistedPlanExtraction;
  try {
    extraction = await input.extract({
      context,
      idempotencyKey: input.job.idempotencyKey,
      now: input.now,
      traceId: `plan-job:${input.job.jobId}:attempt:${input.job.attemptNo}`,
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
      throw new PlanExtractionWorkerError("job-completion-unavailable");
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
    throw new PlanExtractionWorkerError("job-completion-unavailable");
  }
  return {
    type: "succeeded",
    jobId: input.job.jobId,
    runId: extraction.runId,
    finalStatus: "succeeded",
  };
}

export function isPlanExtractionWorkerEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.PLAN_EXTRACTION_ENABLED?.trim().toLowerCase() === "true";
}

/** Processes at most one explicitly identified event job; it never scans. */
export async function runConfiguredPlanExtractionWorker(input: {
  adapter?: ModelAdapter;
  enabled?: boolean;
  now?: Date;
  jobId?: string;
  leaseSeconds?: number;
  store?: PlanExtractionJobStore;
  loadContext?: (
    userId: string,
    roleId: string,
    sourceMessageId: string,
  ) => Promise<PlanExtractionContext | null>;
  extract?: PlanExtractionExecutor;
}): Promise<PlanExtractionWorkerOutcome> {
  const enabled = input.enabled ?? isPlanExtractionWorkerEnabled();
  if (!enabled) return { type: "disabled", claimedCount: 0, outcomes: [] };

  const now = input.now ?? new Date();
  const jobId = input.jobId?.trim();
  const leaseSeconds =
    input.leaseSeconds ?? PLAN_EXTRACTION_WORKER_DEFAULT_LEASE_SECONDS;
  if (
    !uuidSchema.safeParse(jobId).success ||
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 30 ||
    leaseSeconds > 900
  ) {
    throw new PlanExtractionWorkerError("invalid-worker-input");
  }

  const serviceClient = input.store ? null : createServiceRoleSupabaseClient();
  const store =
    input.store ??
    (serviceClient ? new SupabasePlanExtractionJobStore(serviceClient) : null);
  if (!store || (!input.extract && !input.adapter)) {
    throw new PlanExtractionWorkerError("worker-configuration-unavailable");
  }

  let job: ClaimedPlanExtractionJob | null;
  try {
    job = await store.claimOne({ jobId: jobId!, now, leaseSeconds });
  } catch {
    throw new PlanExtractionWorkerError("job-claim-unavailable");
  }

  if (!job) return { type: "processed", claimedCount: 0, outcomes: [] };

  const loadContext = input.loadContext ?? loadPlanExtractionContext;
  const extract =
    input.extract ??
    (async ({ context, idempotencyKey, now: extractionNow, traceId }) =>
      runPlanExtraction(
        { context, idempotencyKey, now: extractionNow, traceId },
        {
          enabled: true,
          adapter: input.adapter!,
          persist: persistPlanExtraction,
        },
      ));
  const outcome = await processPlanExtractionJob({
    job,
    now,
    store,
    loadContext,
    extract,
  });
  return { type: "processed", claimedCount: 1, outcomes: [outcome] };
}
