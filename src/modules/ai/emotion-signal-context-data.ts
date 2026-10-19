import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

import type { EmotionSignalContext } from "./emotion-runtime";

export type EmotionSignalContextLoadErrorCode =
  "configuration-unavailable" | "query-unavailable";

export class EmotionSignalContextLoadError extends Error {
  constructor(readonly code: EmotionSignalContextLoadErrorCode) {
    super(code);
    this.name = "EmotionSignalContextLoadError";
  }
}

type RawRole = { id?: unknown; status?: unknown };
type RawMessage = {
  id?: unknown;
  role_id?: unknown;
  sender?: unknown;
  content?: unknown;
  status?: unknown;
  deleted_at?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Loads exactly one current message after an exact-ID claim. The service-role
 * client repeats ownership and active-role predicates; it never queries chat
 * history. Text is kept only in this server-only context for the injected
 * classifier and must never be passed to queue persistence or a client DTO.
 */
export async function loadEmotionSignalContext(
  userId: string,
  roleId: string,
  sourceMessageId: string,
): Promise<EmotionSignalContext | null> {
  if (
    !uuidSchema.safeParse(userId).success ||
    !uuidSchema.safeParse(roleId).success ||
    !uuidSchema.safeParse(sourceMessageId).success
  ) {
    return null;
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    throw new EmotionSignalContextLoadError("configuration-unavailable");
  }

  const [roleResult, messageResult] = await Promise.all([
    supabase
      .from("roles")
      .select("id, status")
      .eq("id", roleId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id, role_id, sender, content, status, deleted_at")
      .eq("id", sourceMessageId)
      .eq("user_id", userId)
      .eq("role_id", roleId)
      .eq("sender", "user")
      .eq("status", "completed")
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  if (roleResult.error || messageResult.error) {
    throw new EmotionSignalContextLoadError("query-unavailable");
  }

  const role = roleResult.data as RawRole | null;
  const message = messageResult.data as RawMessage | null;
  const sourceMessage = text(message?.content);
  if (
    text(role?.id) !== roleId ||
    role?.status !== "active" ||
    text(message?.id) !== sourceMessageId ||
    text(message?.role_id) !== roleId ||
    message?.sender !== "user" ||
    message?.status !== "completed" ||
    message?.deleted_at !== null ||
    !sourceMessage
  ) {
    return null;
  }

  return { userId, roleId, sourceMessageId, sourceMessage };
}
