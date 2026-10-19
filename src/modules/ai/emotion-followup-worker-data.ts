import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { uuidSchema } from "@/server/schemas";
import type { JobStatus } from "@/types/domain";

export interface ClaimedEmotionFollowup {
  followupId: string;
  userId: string;
  roleId: string;
  sourceMessageId: string;
  claimToken: string;
  leaseExpiresAt: string;
}

export type EmotionFollowupCompletionOutcome =
  "succeeded" | "cancelled" | "permanent_failure";

export interface EmotionFollowupCompletion {
  followupId: string;
  status: Exclude<JobStatus, "running" | "scheduled">;
  sentMessageId: string | null;
}

export interface EmotionFollowupDeliveryStore {
  claimOne(input: {
    followupId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedEmotionFollowup | null>;
  /**
   * Persist one message through the exact current claim. A null result is a
   * terminal fail-closed outcome (for example an expired lease or unavailable
   * target) and must never be treated as a generated message ID.
   */
  persistMessage(input: {
    followupId: string;
    claimToken: string;
    content: string;
    now: Date;
  }): Promise<string | null>;
  complete(input: {
    followupId: string;
    claimToken: string;
    outcome: EmotionFollowupCompletionOutcome;
    sentMessageId: string | null;
    errorCode: string | null;
    now: Date;
  }): Promise<EmotionFollowupCompletion>;
}

export class EmotionFollowupDeliveryStoreError extends Error {
  constructor(
    readonly code:
      "claim-unavailable" | "message-persist-unavailable" | "completion-unavailable",
  ) {
    super(code);
    this.name = "EmotionFollowupDeliveryStoreError";
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function parseClaim(value: unknown): ClaimedEmotionFollowup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const followupId = text(row.followup_id);
  const userId = text(row.user_id);
  const roleId = text(row.role_id);
  const sourceMessageId = text(row.source_message_id);
  const claimToken = text(row.claim_token);
  const leaseExpiresAt = timestamp(row.lease_expires_at);

  if (
    !uuidSchema.safeParse(followupId).success ||
    !uuidSchema.safeParse(userId).success ||
    !uuidSchema.safeParse(roleId).success ||
    !uuidSchema.safeParse(sourceMessageId).success ||
    !uuidSchema.safeParse(claimToken).success ||
    !leaseExpiresAt
  ) {
    return null;
  }

  return {
    followupId: followupId!,
    userId: userId!,
    roleId: roleId!,
    sourceMessageId: sourceMessageId!,
    claimToken: claimToken!,
    leaseExpiresAt,
  };
}

function parseCompletion(value: unknown): EmotionFollowupCompletion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const followupId = text(row.followupId);
  const status = text(row.status);
  const sentMessageId = row.sentMessageId === null ? null : text(row.sentMessageId);

  if (
    !uuidSchema.safeParse(followupId).success ||
    !["succeeded", "failed", "cancelled"].includes(status ?? "") ||
    (sentMessageId !== null && !uuidSchema.safeParse(sentMessageId).success)
  ) {
    return null;
  }

  return {
    followupId: followupId!,
    status: status as EmotionFollowupCompletion["status"],
    sentMessageId,
  };
}

/** Deliberately exact-ID-only: no list or batch query is exposed here. */
export class SupabaseEmotionFollowupDeliveryStore implements EmotionFollowupDeliveryStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimOne(input: {
    followupId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedEmotionFollowup | null> {
    const { data, error } = await this.supabase.rpc("claim_due_emotion_followup", {
      p_followup_id: input.followupId,
      p_now: input.now.toISOString(),
      p_lease_seconds: input.leaseSeconds,
    });
    if (error || !Array.isArray(data) || data.length > 1) {
      throw new EmotionFollowupDeliveryStoreError("claim-unavailable");
    }
    if (data.length === 0) return null;

    const claim = parseClaim(data[0]);
    if (!claim || claim.followupId !== input.followupId) {
      throw new EmotionFollowupDeliveryStoreError("claim-unavailable");
    }
    return claim;
  }

  async persistMessage(input: {
    followupId: string;
    claimToken: string;
    content: string;
    now: Date;
  }): Promise<string | null> {
    const content = input.content.trim();
    if (
      !uuidSchema.safeParse(input.followupId).success ||
      !uuidSchema.safeParse(input.claimToken).success ||
      content.length < 1 ||
      content.length > 20000 ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new EmotionFollowupDeliveryStoreError("message-persist-unavailable");
    }

    const { data, error } = await this.supabase.rpc(
      "persist_claimed_emotion_followup_message",
      {
        p_followup_id: input.followupId,
        p_claim_token: input.claimToken,
        p_content: content,
        p_now: input.now.toISOString(),
      },
    );
    if (error) {
      throw new EmotionFollowupDeliveryStoreError("message-persist-unavailable");
    }
    if (data === null) return null;
    if (!uuidSchema.safeParse(data).success) {
      throw new EmotionFollowupDeliveryStoreError("message-persist-unavailable");
    }
    return data as string;
  }

  async complete(input: {
    followupId: string;
    claimToken: string;
    outcome: EmotionFollowupCompletionOutcome;
    sentMessageId: string | null;
    errorCode: string | null;
    now: Date;
  }): Promise<EmotionFollowupCompletion> {
    const { data, error } = await this.supabase.rpc(
      "complete_emotion_followup_delivery",
      {
        p_followup_id: input.followupId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome,
        p_sent_message_id: input.sentMessageId,
        p_error_code: input.errorCode,
        p_now: input.now.toISOString(),
      },
    );
    const completion = parseCompletion(data);
    if (error || !completion || completion.followupId !== input.followupId) {
      throw new EmotionFollowupDeliveryStoreError("completion-unavailable");
    }
    return completion;
  }
}
