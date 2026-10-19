import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";
import type { JobStatus } from "@/types/domain";

import {
  decidePlanReminderDispatch,
  type PlanReminderPlanSnapshot,
} from "./plan-reminder-policy";

const COMPLETION_STATUSES: ReadonlyArray<Exclude<JobStatus, "running">> = [
  "scheduled",
  "succeeded",
  "failed",
  "cancelled",
];

export interface ClaimedPlanReminderJob {
  jobId: string;
  userId: string;
  planId: string;
  scheduledFor: string;
  claimToken: string;
  attemptNo: number;
  leaseExpiresAt: string;
  status: "running";
}

export interface PlanReminderDeliveryInput {
  jobId: string;
  userId: string;
  planId: string;
  scheduledFor: string;
  claimToken: string;
  deliveredAt: Date;
}

/** A single delivery channel such as the local in-app fallback. */
export interface PlanReminderDelivery {
  deliver(input: PlanReminderDeliveryInput): Promise<void>;
}

export interface PlanReminderJobStore {
  claimDue(
    jobId: string,
    now: Date,
    leaseSeconds: number,
  ): Promise<ClaimedPlanReminderJob | null>;
  readPlan(planId: string, userId: string): Promise<PlanReminderPlanSnapshot | null>;
  complete(input: {
    jobId: string;
    claimToken: string;
    outcome: "succeeded" | "cancelled" | "retryable_failure" | "permanent_failure";
    errorCode: string | null;
    now: Date;
  }): Promise<PlanReminderJobCompletion>;
}

export interface PlanReminderJobCompletion {
  jobId: string;
  status: Exclude<JobStatus, "running">;
  attemptCount: number;
  availableAt: string;
}

export type PlanReminderWorkerOutcome =
  | { type: "not_claimed" }
  | { type: "suppressed"; reason: string; finalStatus: JobStatus }
  | { type: "delivered"; finalStatus: JobStatus }
  | { type: "delivery_failed"; finalStatus: JobStatus };

export type PlanReminderWorkerErrorCode =
  | "invalid-worker-input"
  | "job-claim-unavailable"
  | "context-unavailable"
  | "job-completion-unavailable"
  | "worker-configuration-unavailable";

export class PlanReminderWorkerError extends Error {
  constructor(readonly code: PlanReminderWorkerErrorCode) {
    super(code);
    this.name = "PlanReminderWorkerError";
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function timestamp(value: unknown): string | null {
  const candidate = nonEmptyString(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function parseCompletion(value: unknown): PlanReminderJobCompletion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const jobId = nonEmptyString(row.jobId);
  const status = nonEmptyString(row.status);
  const availableAt = timestamp(row.availableAt);
  const attemptCount = row.attemptCount;
  if (
    !uuidSchema.safeParse(jobId).success ||
    !COMPLETION_STATUSES.includes(status as Exclude<JobStatus, "running">) ||
    !Number.isInteger(attemptCount) ||
    Number(attemptCount) < 1 ||
    Number(attemptCount) > 5 ||
    !availableAt
  ) {
    return null;
  }
  return {
    jobId: jobId!,
    status: status as PlanReminderJobCompletion["status"],
    attemptCount: Number(attemptCount),
    availableAt,
  };
}

async function recordCompletion(
  store: PlanReminderJobStore,
  job: ClaimedPlanReminderJob,
  now: Date,
  completion: {
    outcome: "succeeded" | "cancelled" | "retryable_failure" | "permanent_failure";
    errorCode: string | null;
  },
): Promise<PlanReminderJobCompletion> {
  try {
    return await store.complete({
      jobId: job.jobId,
      claimToken: job.claimToken,
      now,
      ...completion,
    });
  } catch {
    throw new PlanReminderWorkerError("job-completion-unavailable");
  }
}

/**
 * Claims one due job, rechecks its current plan immediately before delivery,
 * and records the terminal outcome. A missing service configuration is never
 * treated as a successful notification.
 */
export async function dispatchPlanReminderJob(input: {
  jobId: string;
  now: Date;
  leaseSeconds?: number;
  store: PlanReminderJobStore;
  delivery: PlanReminderDelivery;
}): Promise<PlanReminderWorkerOutcome> {
  const leaseSeconds = input.leaseSeconds ?? 300;
  if (
    !uuidSchema.safeParse(input.jobId).success ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 30 ||
    leaseSeconds > 900
  ) {
    throw new PlanReminderWorkerError("invalid-worker-input");
  }

  let job: ClaimedPlanReminderJob | null;
  try {
    job = await input.store.claimDue(input.jobId, input.now, leaseSeconds);
  } catch {
    throw new PlanReminderWorkerError("job-claim-unavailable");
  }
  if (!job) {
    return { type: "not_claimed" };
  }

  let plan: PlanReminderPlanSnapshot | null;
  try {
    plan = await input.store.readPlan(job.planId, job.userId);
  } catch {
    const completion = await recordCompletion(input.store, job, input.now, {
      outcome: "retryable_failure",
      errorCode: "context_unavailable",
    });
    if (!["scheduled", "failed"].includes(completion.status)) {
      throw new PlanReminderWorkerError("job-completion-unavailable");
    }
    return { type: "delivery_failed", finalStatus: completion.status };
  }
  const decision = decidePlanReminderDispatch({ job, plan, now: input.now });

  if (!decision.shouldDeliver) {
    const completion = await recordCompletion(input.store, job, input.now, {
      outcome: "cancelled",
      errorCode: `pre_send_${decision.reason}`,
    });
    if (completion.status !== "cancelled") {
      throw new PlanReminderWorkerError("job-completion-unavailable");
    }
    return {
      type: "suppressed",
      reason: decision.reason,
      finalStatus: completion.status,
    };
  }

  try {
    await input.delivery.deliver({
      jobId: job.jobId,
      userId: job.userId,
      planId: job.planId,
      scheduledFor: job.scheduledFor,
      claimToken: job.claimToken,
      deliveredAt: input.now,
    });
  } catch {
    const completion = await recordCompletion(input.store, job, input.now, {
      outcome: "retryable_failure",
      errorCode: "delivery_unavailable",
    });
    if (!["scheduled", "failed"].includes(completion.status)) {
      throw new PlanReminderWorkerError("job-completion-unavailable");
    }
    return { type: "delivery_failed", finalStatus: completion.status };
  }

  const completion = await recordCompletion(input.store, job, input.now, {
    outcome: "succeeded",
    errorCode: null,
  });
  if (completion.status !== "succeeded") {
    throw new PlanReminderWorkerError("job-completion-unavailable");
  }
  return { type: "delivered", finalStatus: completion.status };
}

/** A thin service-role adapter for a future Trigger.dev task. */
export class SupabasePlanReminderJobStore implements PlanReminderJobStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimDue(
    jobId: string,
    now: Date,
    leaseSeconds: number,
  ): Promise<ClaimedPlanReminderJob | null> {
    const { data, error } = await this.supabase.rpc("claim_due_notification_job", {
      p_job_id: jobId,
      p_now: now.toISOString(),
      p_lease_seconds: leaseSeconds,
    });
    if (error) {
      throw new PlanReminderWorkerError("job-claim-unavailable");
    }

    if (!Array.isArray(data) || data.length > 1) {
      throw new PlanReminderWorkerError("job-claim-unavailable");
    }
    if (data.length === 0) return null;
    const result = data[0];
    const claimedJobId = nonEmptyString(result?.job_id);
    const userId = nonEmptyString(result?.user_id);
    const planId = nonEmptyString(result?.plan_id);
    const scheduledFor = timestamp(result?.scheduled_for);
    const claimToken = nonEmptyString(result?.claim_token);
    const attemptNo = result?.attempt_no;
    const leaseExpiresAt = timestamp(result?.lease_expires_at);

    if (
      claimedJobId !== jobId ||
      !uuidSchema.safeParse(claimedJobId).success ||
      !uuidSchema.safeParse(userId).success ||
      !uuidSchema.safeParse(planId).success ||
      !uuidSchema.safeParse(claimToken).success ||
      !scheduledFor ||
      !Number.isInteger(attemptNo) ||
      Number(attemptNo) < 1 ||
      Number(attemptNo) > 5 ||
      !leaseExpiresAt ||
      Date.parse(scheduledFor) > now.getTime() ||
      Date.parse(leaseExpiresAt) <= now.getTime()
    ) {
      throw new PlanReminderWorkerError("job-claim-unavailable");
    }

    return {
      jobId: claimedJobId,
      userId: userId!,
      planId: planId!,
      scheduledFor,
      claimToken: claimToken!,
      attemptNo: Number(attemptNo),
      leaseExpiresAt,
      status: "running",
    };
  }

  async readPlan(
    planId: string,
    userId: string,
  ): Promise<PlanReminderPlanSnapshot | null> {
    const { data, error } = await this.supabase
      .from("plans")
      .select("id, user_id, scope, status, reminder_at")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw new PlanReminderWorkerError("context-unavailable");
    }

    const id = nonEmptyString(data?.id);
    const ownerId = nonEmptyString(data?.user_id);
    const scope = data?.scope;
    const status = data?.status;

    if (
      !id ||
      !ownerId ||
      !["day", "week", "month", "year"].includes(String(scope)) ||
      !["pending", "active", "completed", "cancelled", "deleted"].includes(
        String(status),
      )
    ) {
      return null;
    }

    return {
      id,
      userId: ownerId,
      scope: scope as PlanReminderPlanSnapshot["scope"],
      status: status as PlanReminderPlanSnapshot["status"],
      reminderAt: nonEmptyString(data?.reminder_at),
    };
  }

  async complete(input: {
    jobId: string;
    claimToken: string;
    outcome: "succeeded" | "cancelled" | "retryable_failure" | "permanent_failure";
    errorCode: string | null;
    now: Date;
  }): Promise<PlanReminderJobCompletion> {
    const { data, error } = await this.supabase.rpc("complete_notification_job", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_outcome: input.outcome,
      p_error_code: input.errorCode,
      p_now: input.now.toISOString(),
    });
    const completion = parseCompletion(data);

    if (error || !completion || completion.jobId !== input.jobId) {
      throw new PlanReminderWorkerError("job-completion-unavailable");
    }

    return completion;
  }
}

/**
 * Convenience entry point for the future scheduler. It intentionally requires
 * an injected delivery adapter; no unconfigured fallback may mark a job sent.
 */
export async function runConfiguredPlanReminderJob(input: {
  jobId: string;
  now: Date;
  leaseSeconds?: number;
  delivery: PlanReminderDelivery;
}): Promise<PlanReminderWorkerOutcome> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    throw new PlanReminderWorkerError("worker-configuration-unavailable");
  }

  return dispatchPlanReminderJob({
    jobId: input.jobId,
    now: input.now,
    store: new SupabasePlanReminderJobStore(supabase),
    delivery: input.delivery,
    ...(input.leaseSeconds === undefined ? {} : { leaseSeconds: input.leaseSeconds }),
  });
}
