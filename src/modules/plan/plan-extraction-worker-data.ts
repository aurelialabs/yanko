import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { idempotencyKeySchema, uuidSchema } from "@/server/schemas";
import type { JobStatus } from "@/types/domain";

export interface ClaimedPlanExtractionJob {
  jobId: string;
  userId: string;
  roleId: string;
  sourceMessageId: string;
  claimToken: string;
  idempotencyKey: string;
  attemptNo: number;
  leaseExpiresAt: string;
}

export type PlanExtractionJobCompletionOutcome =
  "succeeded" | "cancelled" | "retryable_failure" | "permanent_failure";

export interface PlanExtractionJobCompletion {
  jobId: string;
  status: Exclude<JobStatus, "running">;
  attemptCount: number;
  availableAt: string;
}

export interface PlanExtractionJobStore {
  claimOne(input: {
    jobId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedPlanExtractionJob | null>;
  complete(input: {
    jobId: string;
    claimToken: string;
    outcome: PlanExtractionJobCompletionOutcome;
    errorCode: string | null;
    extractionRunId: string | null;
    now: Date;
  }): Promise<PlanExtractionJobCompletion>;
}

export class PlanExtractionJobStoreError extends Error {
  constructor(readonly code: "claim-unavailable" | "completion-unavailable") {
    super(code);
    this.name = "PlanExtractionJobStoreError";
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function parseClaim(value: unknown): ClaimedPlanExtractionJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const jobId = text(row.job_id);
  const userId = text(row.user_id);
  const roleId = text(row.role_id);
  const sourceMessageId = text(row.source_message_id);
  const claimToken = text(row.claim_token);
  const idempotencyKey = text(row.idempotency_key);
  const leaseExpiresAt = timestamp(row.lease_expires_at);
  const attemptNo = row.attempt_no;

  if (
    !uuidSchema.safeParse(jobId).success ||
    !uuidSchema.safeParse(userId).success ||
    !uuidSchema.safeParse(roleId).success ||
    !uuidSchema.safeParse(sourceMessageId).success ||
    !uuidSchema.safeParse(claimToken).success ||
    !idempotencyKeySchema.safeParse(idempotencyKey).success ||
    !Number.isInteger(attemptNo) ||
    Number(attemptNo) < 1 ||
    Number(attemptNo) > 5 ||
    !leaseExpiresAt
  ) {
    return null;
  }

  return {
    jobId: jobId!,
    userId: userId!,
    roleId: roleId!,
    sourceMessageId: sourceMessageId!,
    claimToken: claimToken!,
    idempotencyKey: idempotencyKey!,
    attemptNo: Number(attemptNo),
    leaseExpiresAt,
  };
}

function parseCompletion(value: unknown): PlanExtractionJobCompletion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const jobId = text(row.jobId);
  const status = text(row.status);
  const availableAt = timestamp(row.availableAt);
  const attemptCount = row.attemptCount;

  if (
    !uuidSchema.safeParse(jobId).success ||
    !["scheduled", "succeeded", "failed", "cancelled"].includes(status ?? "") ||
    !Number.isInteger(attemptCount) ||
    Number(attemptCount) < 1 ||
    Number(attemptCount) > 5 ||
    !availableAt
  ) {
    return null;
  }

  return {
    jobId: jobId!,
    status: status as PlanExtractionJobCompletion["status"],
    attemptCount: Number(attemptCount),
    availableAt,
  };
}

/** A deliberately exact-ID-only store; there is no batch scan method. */
export class SupabasePlanExtractionJobStore implements PlanExtractionJobStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimOne(input: {
    jobId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedPlanExtractionJob | null> {
    const { data, error } = await this.supabase.rpc("claim_plan_extraction_job", {
      p_job_id: input.jobId,
      p_now: input.now.toISOString(),
      p_lease_seconds: input.leaseSeconds,
    });
    if (error || !Array.isArray(data) || data.length > 1) {
      throw new PlanExtractionJobStoreError("claim-unavailable");
    }

    if (data.length === 0) return null;
    const job = parseClaim(data[0]);
    if (!job || job.jobId !== input.jobId) {
      throw new PlanExtractionJobStoreError("claim-unavailable");
    }
    return job;
  }

  async complete(input: {
    jobId: string;
    claimToken: string;
    outcome: PlanExtractionJobCompletionOutcome;
    errorCode: string | null;
    extractionRunId: string | null;
    now: Date;
  }): Promise<PlanExtractionJobCompletion> {
    const { data, error } = await this.supabase.rpc("complete_plan_extraction_job", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_outcome: input.outcome,
      p_error_code: input.errorCode,
      p_extraction_run_id: input.extractionRunId,
      p_now: input.now.toISOString(),
    });
    const result = parseCompletion(data);
    if (error || !result || result.jobId !== input.jobId) {
      throw new PlanExtractionJobStoreError("completion-unavailable");
    }
    return result;
  }
}
