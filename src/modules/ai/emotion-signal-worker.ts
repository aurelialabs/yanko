import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

import type { ModelAdapter } from "./model-adapter";
import { loadEmotionSignalContext } from "./emotion-signal-context-data";
import {
  SupabaseEmotionSignalJobStore,
  type ClaimedEmotionSignalJob,
  type EmotionSignalJobCompletion,
  type EmotionSignalJobCompletionOutcome,
  type EmotionSignalJobStore,
} from "./emotion-signal-worker-data";
import {
  EmotionRuntimeError,
  runEmotionSignal,
  type EmotionRuntimeResult,
  type EmotionSignalContext,
} from "./emotion-runtime";
import type { PersistedEmotionFollowup } from "./emotion-followup-data";
import { scheduleStrongNegativeEmotionFollowup } from "./emotion-followup-data";

export const EMOTION_SIGNAL_WORKER_DEFAULT_LEASE_SECONDS = 300;

export type EmotionSignalExecutor = (input: {
  context: EmotionSignalContext;
  idempotencyKey: string;
  traceId: string;
}) => Promise<EmotionRuntimeResult>;

export type EmotionSignalWorkerJobOutcome =
  | { type: "succeeded"; jobId: string; finalStatus: "succeeded" }
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

export type EmotionSignalWorkerOutcome =
  | { type: "disabled"; claimedCount: 0; outcomes: [] }
  | {
      type: "processed";
      claimedCount: 0 | 1;
      outcomes: EmotionSignalWorkerJobOutcome[];
    };

export type EmotionSignalWorkerErrorCode =
  | "invalid-worker-input"
  | "worker-configuration-unavailable"
  | "job-claim-unavailable"
  | "job-completion-unavailable";

export class EmotionSignalWorkerError extends Error {
  constructor(readonly code: EmotionSignalWorkerErrorCode) {
    super(code);
    this.name = "EmotionSignalWorkerError";
  }
}

function safeFailure(error: unknown): {
  outcome: "retryable_failure" | "permanent_failure";
  errorCode: string;
} {
  if (error instanceof EmotionRuntimeError) {
    switch (error.code) {
      case "invalid-input":
        return { outcome: "permanent_failure", errorCode: "invalid_input" };
      case "disabled":
        return { outcome: "permanent_failure", errorCode: "runtime_disabled" };
      case "classifier-unavailable":
        return { outcome: "retryable_failure", errorCode: "classifier_unavailable" };
      case "persistence-unavailable":
        return { outcome: "retryable_failure", errorCode: "persistence_unavailable" };
    }
  }

  return { outcome: "retryable_failure", errorCode: "worker_unavailable" };
}

async function recordCompletion(
  store: EmotionSignalJobStore,
  job: ClaimedEmotionSignalJob,
  now: Date,
  completion: {
    outcome: EmotionSignalJobCompletionOutcome;
    errorCode: string | null;
  },
): Promise<EmotionSignalJobCompletion> {
  try {
    return await store.complete({
      jobId: job.jobId,
      claimToken: job.claimToken,
      now,
      ...completion,
    });
  } catch {
    throw new EmotionSignalWorkerError("job-completion-unavailable");
  }
}

export async function processEmotionSignalJob(input: {
  job: ClaimedEmotionSignalJob;
  now: Date;
  store: EmotionSignalJobStore;
  loadContext: (
    userId: string,
    roleId: string,
    sourceMessageId: string,
  ) => Promise<EmotionSignalContext | null>;
  classify: EmotionSignalExecutor;
}): Promise<EmotionSignalWorkerJobOutcome> {
  let context: EmotionSignalContext | null;
  try {
    context = await input.loadContext(
      input.job.userId,
      input.job.roleId,
      input.job.sourceMessageId,
    );
  } catch {
    return completeFailure(input, "retryable_failure", "context_unavailable");
  }

  if (!context) {
    const completion = await recordCompletion(input.store, input.job, input.now, {
      outcome: "cancelled",
      errorCode: "source_unavailable",
    });
    if (completion.status !== "cancelled") {
      throw new EmotionSignalWorkerError("job-completion-unavailable");
    }
    return {
      type: "cancelled",
      jobId: input.job.jobId,
      errorCode: "source_unavailable",
      finalStatus: "cancelled",
    };
  }

  try {
    await input.classify({
      context,
      idempotencyKey: input.job.idempotencyKey,
      traceId: `emotion-job:${input.job.jobId}:attempt:${input.job.attemptNo}`,
    });
  } catch (error) {
    const failure = safeFailure(error);
    return completeFailure(input, failure.outcome, failure.errorCode);
  }

  const completion = await recordCompletion(input.store, input.job, input.now, {
    outcome: "succeeded",
    errorCode: null,
  });
  if (completion.status !== "succeeded") {
    throw new EmotionSignalWorkerError("job-completion-unavailable");
  }
  return { type: "succeeded", jobId: input.job.jobId, finalStatus: "succeeded" };
}

async function completeFailure(
  input: Parameters<typeof processEmotionSignalJob>[0],
  outcome: "retryable_failure" | "permanent_failure",
  errorCode: string,
): Promise<EmotionSignalWorkerJobOutcome> {
  const completion = await recordCompletion(input.store, input.job, input.now, {
    outcome,
    errorCode,
  });
  if (completion.status === "scheduled") {
    return {
      type: "retry_scheduled",
      jobId: input.job.jobId,
      errorCode,
      finalStatus: "scheduled",
    };
  }
  if (completion.status !== "failed") {
    throw new EmotionSignalWorkerError("job-completion-unavailable");
  }
  return { type: "failed", jobId: input.job.jobId, errorCode, finalStatus: "failed" };
}

export function isEmotionSignalWorkerEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.EMOTION_SIGNAL_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Processes one named event job only. It is not a cron consumer and cannot
 * scan historical chat. With the default environment it returns before any
 * database query or provider call.
 */
export async function runConfiguredEmotionSignalWorker(input: {
  adapter?: ModelAdapter;
  enabled?: boolean;
  now?: Date;
  jobId?: string;
  leaseSeconds?: number;
  store?: EmotionSignalJobStore;
  loadContext?: (
    userId: string,
    roleId: string,
    sourceMessageId: string,
  ) => Promise<EmotionSignalContext | null>;
  classify?: EmotionSignalExecutor;
  persist?: (input: {
    userId: string;
    roleId: string;
    sourceMessageId: string;
    emotionType:
      "sadness" | "anxiety" | "anger" | "grief" | "loneliness" | "overwhelm" | "other";
    intensity: number;
    idempotencyKey: string;
  }) => Promise<PersistedEmotionFollowup | null>;
}): Promise<EmotionSignalWorkerOutcome> {
  const enabled = input.enabled ?? isEmotionSignalWorkerEnabled();
  if (!enabled) return { type: "disabled", claimedCount: 0, outcomes: [] };

  const now = input.now ?? new Date();
  const jobId = input.jobId?.trim();
  const leaseSeconds =
    input.leaseSeconds ?? EMOTION_SIGNAL_WORKER_DEFAULT_LEASE_SECONDS;
  if (
    !uuidSchema.safeParse(jobId).success ||
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 30 ||
    leaseSeconds > 900
  ) {
    throw new EmotionSignalWorkerError("invalid-worker-input");
  }

  const serviceClient = input.store ? null : createServiceRoleSupabaseClient();
  const store =
    input.store ??
    (serviceClient ? new SupabaseEmotionSignalJobStore(serviceClient) : null);
  if (!store || (!input.classify && !input.adapter)) {
    throw new EmotionSignalWorkerError("worker-configuration-unavailable");
  }

  let job: ClaimedEmotionSignalJob | null;
  try {
    job = await store.claimOne({ jobId: jobId!, now, leaseSeconds });
  } catch {
    throw new EmotionSignalWorkerError("job-claim-unavailable");
  }
  if (!job) return { type: "processed", claimedCount: 0, outcomes: [] };

  const loadContext = input.loadContext ?? loadEmotionSignalContext;
  const classify =
    input.classify ??
    (async ({ context, idempotencyKey, traceId }) =>
      runEmotionSignal(
        { context, idempotencyKey, traceId },
        {
          enabled: true,
          adapter: input.adapter!,
          persist: input.persist ?? scheduleStrongNegativeEmotionFollowup,
        },
      ));
  const outcome = await processEmotionSignalJob({
    job,
    now,
    store,
    loadContext,
    classify,
  });
  return { type: "processed", claimedCount: 1, outcomes: [outcome] };
}
