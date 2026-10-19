import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { idempotencyKeySchema, uuidSchema } from "@/server/schemas";
import type { JobStatus } from "@/types/domain";

export interface ClaimedMemoryEmbeddingJob {
  jobId: string;
  userId: string;
  memoryId: string;
  claimToken: string;
  idempotencyKey: string;
  attemptNo: number;
  leaseExpiresAt: string;
}

export type MemoryEmbeddingJobCompletionOutcome =
  "succeeded" | "cancelled" | "retryable_failure" | "permanent_failure";

export interface MemoryEmbeddingJobCompletion {
  jobId: string;
  status: Exclude<JobStatus, "running">;
  attemptCount: number;
  availableAt: string;
}

export interface MemoryEmbeddingJobStore {
  claim(input: {
    limit: number;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedMemoryEmbeddingJob[]>;
  claimOne(input: {
    jobId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedMemoryEmbeddingJob | null>;
  complete(input: {
    jobId: string;
    claimToken: string;
    outcome: MemoryEmbeddingJobCompletionOutcome;
    errorCode: string | null;
    providerId: string | null;
    modelId: string | null;
    now: Date;
  }): Promise<MemoryEmbeddingJobCompletion>;
}

export class MemoryEmbeddingJobStoreError extends Error {
  constructor(readonly code: "claim-unavailable" | "completion-unavailable") {
    super(code);
    this.name = "MemoryEmbeddingJobStoreError";
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function parseClaim(value: unknown): ClaimedMemoryEmbeddingJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const jobId = text(row.job_id);
  const userId = text(row.user_id);
  const memoryId = text(row.memory_id);
  const claimToken = text(row.claim_token);
  const idempotencyKey = text(row.idempotency_key);
  const leaseExpiresAt = timestamp(row.lease_expires_at);
  const attemptNo = row.attempt_no;

  if (
    !uuidSchema.safeParse(jobId).success ||
    !uuidSchema.safeParse(userId).success ||
    !uuidSchema.safeParse(memoryId).success ||
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
    memoryId: memoryId!,
    claimToken: claimToken!,
    idempotencyKey: idempotencyKey!,
    attemptNo: Number(attemptNo),
    leaseExpiresAt,
  };
}

function parseCompletion(value: unknown): MemoryEmbeddingJobCompletion | null {
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
    status: status as MemoryEmbeddingJobCompletion["status"],
    attemptCount: Number(attemptCount),
    availableAt,
  };
}

export class SupabaseMemoryEmbeddingJobStore implements MemoryEmbeddingJobStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claim(input: {
    limit: number;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedMemoryEmbeddingJob[]> {
    const { data, error } = await this.supabase.rpc("claim_memory_embedding_jobs", {
      p_limit: input.limit,
      p_now: input.now.toISOString(),
      p_lease_seconds: input.leaseSeconds,
    });
    if (error || !Array.isArray(data)) {
      throw new MemoryEmbeddingJobStoreError("claim-unavailable");
    }
    const jobs = data.map(parseClaim);
    if (jobs.some((job) => job === null)) {
      throw new MemoryEmbeddingJobStoreError("claim-unavailable");
    }
    return jobs as ClaimedMemoryEmbeddingJob[];
  }

  async claimOne(input: {
    jobId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedMemoryEmbeddingJob | null> {
    const { data, error } = await this.supabase.rpc("claim_memory_embedding_job", {
      p_job_id: input.jobId,
      p_now: input.now.toISOString(),
      p_lease_seconds: input.leaseSeconds,
    });
    if (error || !Array.isArray(data) || data.length > 1) {
      throw new MemoryEmbeddingJobStoreError("claim-unavailable");
    }
    if (data.length === 0) return null;
    const job = parseClaim(data[0]);
    if (!job || job.jobId !== input.jobId) {
      throw new MemoryEmbeddingJobStoreError("claim-unavailable");
    }
    return job;
  }

  async complete(input: {
    jobId: string;
    claimToken: string;
    outcome: MemoryEmbeddingJobCompletionOutcome;
    errorCode: string | null;
    providerId: string | null;
    modelId: string | null;
    now: Date;
  }): Promise<MemoryEmbeddingJobCompletion> {
    const { data, error } = await this.supabase.rpc("complete_memory_embedding_job", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_outcome: input.outcome,
      p_error_code: input.errorCode,
      p_embedding_provider: input.providerId,
      p_embedding_model: input.modelId,
      p_now: input.now.toISOString(),
    });
    const completion = parseCompletion(data);
    if (error || !completion) {
      throw new MemoryEmbeddingJobStoreError("completion-unavailable");
    }
    return completion;
  }
}
