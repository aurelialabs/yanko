import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { idempotencyKeySchema, uuidSchema } from "@/server/schemas";

export type EmotionFollowupStatus = "scheduled" | "cancelled";

export interface ScheduleEmotionFollowupInput {
  userId: string;
  roleId: string;
  sourceMessageId: string;
  emotionType:
    "sadness" | "anxiety" | "anger" | "grief" | "loneliness" | "overwhelm" | "other";
  intensity: number;
  idempotencyKey: string;
}

export interface PersistedEmotionFollowup {
  followupId: string;
  status: EmotionFollowupStatus;
  scheduledFor: string;
}

type RawEmotionFollowup = {
  followup_id?: unknown;
  status?: unknown;
  scheduled_for?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parsePersistedEmotionFollowup(
  value: unknown,
): PersistedEmotionFollowup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as RawEmotionFollowup;
  const followupId = text(row.followup_id);
  const status = text(row.status);
  const scheduledFor = text(row.scheduled_for);
  if (
    !uuidSchema.safeParse(followupId).success ||
    !["scheduled", "cancelled"].includes(status ?? "") ||
    !scheduledFor ||
    !Number.isFinite(Date.parse(scheduledFor))
  ) {
    return null;
  }

  return {
    followupId: followupId!,
    status: status as EmotionFollowupStatus,
    scheduledFor,
  };
}

/**
 * Service-only persistence for one already classified, explicitly loaded
 * source message. It passes only IDs and normalized signal metadata, never
 * message content or a provider's raw structured response.
 */
export async function scheduleStrongNegativeEmotionFollowup(
  input: ScheduleEmotionFollowupInput,
): Promise<PersistedEmotionFollowup | null> {
  if (
    !uuidSchema.safeParse(input.userId).success ||
    !uuidSchema.safeParse(input.roleId).success ||
    !uuidSchema.safeParse(input.sourceMessageId).success ||
    !idempotencyKeySchema.safeParse(input.idempotencyKey).success ||
    !Number.isFinite(input.intensity) ||
    input.intensity < 0.8 ||
    input.intensity > 1
  ) {
    return null;
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc(
    "schedule_strong_negative_emotion_followup",
    {
      p_user_id: input.userId,
      p_role_id: input.roleId,
      p_source_message_id: input.sourceMessageId,
      p_emotion_type: input.emotionType,
      p_intensity: input.intensity,
      p_idempotency_key: input.idempotencyKey,
    },
  );
  if (error) return null;
  return parsePersistedEmotionFollowup(Array.isArray(data) ? data[0] : data);
}
