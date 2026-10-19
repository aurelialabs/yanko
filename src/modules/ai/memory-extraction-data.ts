import "server-only";

import { z } from "zod";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";
import type { MemoryScope, MemorySensitivity } from "@/types/domain";

import type { ExistingMemoryForPolicy, MemoryPolicyOperation } from "./memory-policy";

export interface ExistingMemoryForExtraction extends ExistingMemoryForPolicy {
  category: string;
  content: string;
  sensitivity: Exclude<MemorySensitivity, "forbidden">;
  confirmedByUser: boolean;
}

export interface MemoryExtractionContext {
  userId: string;
  roleId: string;
  roleName: string;
  sourceMessageId: string;
  sourceMessage: string;
  existingMemories: ExistingMemoryForExtraction[];
}

export interface PersistedMemoryExtraction {
  runId: string;
  candidateIds: string[];
  memoryIds: string[];
  discardedCount: number;
  replayed: boolean;
}

export type MemoryExtractionContextLoadErrorCode =
  "configuration-unavailable" | "query-unavailable";

export class MemoryExtractionContextLoadError extends Error {
  constructor(readonly code: MemoryExtractionContextLoadErrorCode) {
    super(code);
    this.name = "MemoryExtractionContextLoadError";
  }
}

type RawRole = {
  id?: unknown;
  display_name?: unknown;
  status?: unknown;
};

type RawMessage = {
  id?: unknown;
  role_id?: unknown;
  sender?: unknown;
  content?: unknown;
  status?: unknown;
  deleted_at?: unknown;
};

type RawMemory = {
  id?: unknown;
  user_id?: unknown;
  scope?: unknown;
  role_id?: unknown;
  category?: unknown;
  content?: unknown;
  normalized_key?: unknown;
  sensitivity?: unknown;
  status?: unknown;
  confirmed_by_user?: unknown;
  deleted_at?: unknown;
};

const persistenceResultSchema = z
  .object({
    runId: uuidSchema,
    candidateIds: z.array(uuidSchema).max(20),
    memoryIds: z.array(uuidSchema).max(20),
    discardedCount: z.number().int().min(0).max(20),
    replayed: z.boolean(),
  })
  .strict();

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toExistingMemory(
  value: RawMemory,
  expectedUserId: string,
  currentRoleId: string,
): ExistingMemoryForExtraction | null {
  const id = text(value.id);
  const userId = text(value.user_id);
  const scope = text(value.scope);
  const roleId = nullableText(value.role_id);
  const category = text(value.category);
  const content = text(value.content);
  const sensitivity = text(value.sensitivity);
  const status = text(value.status);

  if (
    !id ||
    userId !== expectedUserId ||
    !category ||
    !content ||
    !["user_shared", "role_private"].includes(scope ?? "") ||
    !["normal", "sensitive"].includes(sensitivity ?? "") ||
    status !== "active" ||
    value.deleted_at !== null ||
    typeof value.confirmed_by_user !== "boolean"
  ) {
    return null;
  }

  if (
    (scope === "user_shared" && roleId !== null) ||
    (scope === "role_private" && roleId !== currentRoleId)
  ) {
    return null;
  }

  return {
    id,
    userId,
    scope: scope as MemoryScope,
    roleId,
    category,
    content,
    normalizedKey: nullableText(value.normalized_key),
    sensitivity: sensitivity as ExistingMemoryForExtraction["sensitivity"],
    status: "active",
    confirmedByUser: value.confirmed_by_user,
    deletedAt: null,
  };
}

/**
 * Loads one completed, non-deleted user message and only the memories that are
 * visible to its role. A service-role client is used for the future worker,
 * so every ownership and scope predicate is repeated explicitly here.
 */
export async function loadMemoryExtractionContext(
  userId: string,
  roleId: string,
  sourceMessageId: string,
): Promise<MemoryExtractionContext | null> {
  if (
    !uuidSchema.safeParse(userId).success ||
    !uuidSchema.safeParse(roleId).success ||
    !uuidSchema.safeParse(sourceMessageId).success
  ) {
    return null;
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    throw new MemoryExtractionContextLoadError("configuration-unavailable");
  }

  const [roleResult, messageResult, memoriesResult] = await Promise.all([
    supabase
      .from("roles")
      .select("id, display_name, status")
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
    supabase
      .from("memories")
      .select(
        "id, user_id, scope, role_id, category, content, normalized_key, sensitivity, status, confirmed_by_user, deleted_at",
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .is("deleted_at", null)
      .or(`role_id.is.null,role_id.eq.${roleId}`)
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);

  if (roleResult.error || messageResult.error || memoriesResult.error) {
    throw new MemoryExtractionContextLoadError("query-unavailable");
  }

  const role = roleResult.data as RawRole | null;
  const message = messageResult.data as RawMessage | null;
  const roleName = text(role?.display_name);
  const sourceMessage = text(message?.content);
  if (
    text(role?.id) !== roleId ||
    role?.status !== "active" ||
    text(message?.id) !== sourceMessageId ||
    text(message?.role_id) !== roleId ||
    message?.sender !== "user" ||
    message?.status !== "completed" ||
    message?.deleted_at !== null ||
    !roleName ||
    !sourceMessage
  ) {
    return null;
  }

  return {
    userId,
    roleId,
    roleName,
    sourceMessageId,
    sourceMessage,
    existingMemories: ((memoriesResult.data ?? []) as RawMemory[])
      .map((memory) => toExistingMemory(memory, userId, roleId))
      .filter((memory): memory is ExistingMemoryForExtraction => memory !== null),
  };
}

export async function persistMemoryExtraction(
  context: MemoryExtractionContext,
  policyVersion: string,
  idempotencyKey: string,
  operations: readonly MemoryPolicyOperation[],
): Promise<PersistedMemoryExtraction | null> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("persist_memory_extraction", {
    p_user_id: context.userId,
    p_role_id: context.roleId,
    p_source_message_id: context.sourceMessageId,
    p_policy_version: policyVersion,
    p_idempotency_key: idempotencyKey,
    p_operations: operations,
  });
  if (error) return null;

  const parsed = persistenceResultSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
