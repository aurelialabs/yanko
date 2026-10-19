import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { idempotencyKeySchema, uuidSchema } from "@/server/schemas";
import type { JobStatus } from "@/types/domain";

export interface ClaimedEmotionSignalJob {
  jobId: string;
  userId: string;
  roleId: string;
  sourceMessageId: string;
  claimToken: string;
  idempotencyKey: string;
  attemptNo: number;
  leaseExpiresAt: string;
}

export type EmotionSignalJobCompletionOutcome =
  "succeeded" | "cancelled" | "retryable_failure" | "permanent_failure";

export interface EmotionSignalJobCompletion {
  jobId: string;
  status: Exclude<JobStatus, "running">;
  attemptCount: number;
  availableAt: string;
}

export interface EmotionSignalJobStore {
  claimOne(input: {
    jobId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedEmotionSignalJob | null>;
  complete(input: {
    jobId: string;
    claimToken: string;
    outcome: EmotionSignalJobCompletionOutcome;
    errorCode: string | null;
    now: Date;
  }): Promise<EmotionSignalJobCompletion>;
}

export class EmotionSignalJobStoreError extends Error {
  constructor(readonly code: "claim-unavailable" | "completion-unavailable") {
    super(code);
    this.name = "EmotionSignalJobStoreError";
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function parseClaim(value: unknown): ClaimedEmotionSignalJob | null {
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

function parseCompletion(value: unknown): EmotionSignalJobCompletion | null {
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
    status: status as EmotionSignalJobCompletion["status"],
    attemptCount: Number(attemptCount),
    availableAt,
  };
}

/** There is deliberately no list or batch method: an event supplies one ID. */
export class SupabaseEmotionSignalJobStore implements EmotionSignalJobStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimOne(input: {
    jobId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedEmotionSignalJob | null> {
    const { data, error } = await this.supabase.rpc("claim_emotion_signal_job", {
      p_job_id: input.jobId,
      p_now: input.now.toISOString(),
      p_lease_seconds: input.leaseSeconds,
    });
    if (error || !Array.isArray(data) || data.length > 1) {
      throw new EmotionSignalJobStoreError("claim-unavailable");
    }
    if (data.length === 0) return null;

    const job = parseClaim(data[0]);
    if (!job || job.jobId !== input.jobId) {
      throw new EmotionSignalJobStoreError("claim-unavailable");
    }
    return job;
  }

  async complete(input: {
    jobId: string;
    claimToken: string;
    outcome: EmotionSignalJobCompletionOutcome;
    errorCode: string | null;
    now: Date;
  }): Promise<EmotionSignalJobCompletion> {
    const { data, error } = await this.supabase.rpc("complete_emotion_signal_job", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_outcome: input.outcome,
      p_error_code: input.errorCode,
      p_now: input.now.toISOString(),
    });
    const result = parseCompletion(data);
    if (error || !result || result.jobId !== input.jobId) {
      throw new EmotionSignalJobStoreError("completion-unavailable");
    }
    return result;
  }
}
