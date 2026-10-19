import "server-only";

import { z } from "zod";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { ianaTimezoneSchema, uuidSchema } from "@/server/schemas";

import type { PlanIntentPolicyResult } from "./plan-intent-policy";

export interface PlanExtractionContext {
  userId: string;
  roleId: string;
  roleName: string;
  sourceMessageId: string;
  sourceMessage: string;
  timezone: string;
}

export interface PlanExtractionModelMetadata {
  providerId: string;
  modelId: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface PersistedPlanExtraction {
  runId: string;
  proposalId: string | null;
  replayed: boolean;
}

export type PlanExtractionDataErrorCode =
  "configuration-unavailable" | "query-unavailable";

export class PlanExtractionDataError extends Error {
  constructor(readonly code: PlanExtractionDataErrorCode) {
    super(code);
    this.name = "PlanExtractionDataError";
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

const persistenceResultSchema = z
  .object({
    runId: uuidSchema,
    proposalId: uuidSchema.nullable(),
    replayed: z.boolean(),
  })
  .strict();

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Loads exactly one active-role, completed user message. Because this uses a
 * service-role client, every ownership predicate is repeated explicitly.
 */
export async function loadPlanExtractionContext(
  userId: string,
  roleId: string,
  sourceMessageId: string,
): Promise<PlanExtractionContext | null> {
  if (
    !uuidSchema.safeParse(userId).success ||
    !uuidSchema.safeParse(roleId).success ||
    !uuidSchema.safeParse(sourceMessageId).success
  ) {
    return null;
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    throw new PlanExtractionDataError("configuration-unavailable");
  }

  const [roleResult, messageResult, settingsResult] = await Promise.all([
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
      .from("user_settings")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (roleResult.error || messageResult.error || settingsResult.error) {
    throw new PlanExtractionDataError("query-unavailable");
  }

  const role = roleResult.data as RawRole | null;
  const message = messageResult.data as RawMessage | null;
  const roleName = text(role?.display_name);
  const sourceMessage = text(message?.content);
  const timezone = ianaTimezoneSchema.safeParse(settingsResult.data?.timezone);
  if (
    text(role?.id) !== roleId ||
    role?.status !== "active" ||
    text(message?.id) !== sourceMessageId ||
    text(message?.role_id) !== roleId ||
    message?.sender !== "user" ||
    message?.status !== "completed" ||
    message?.deleted_at !== null ||
    !roleName ||
    !sourceMessage ||
    !timezone.success
  ) {
    return null;
  }

  return {
    userId,
    roleId,
    roleName,
    sourceMessageId,
    sourceMessage,
    timezone: timezone.data,
  };
}

/** Persists only policy-clean fields and non-content provider metadata. */
export async function persistPlanExtraction(
  context: PlanExtractionContext,
  policy: PlanIntentPolicyResult,
  promptVersion: string,
  idempotencyKey: string,
  model: PlanExtractionModelMetadata,
): Promise<PersistedPlanExtraction | null> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return null;

  const draft = policy.draft;
  const { data, error } = await supabase.rpc("persist_plan_extraction_result", {
    p_user_id: context.userId,
    p_role_id: context.roleId,
    p_source_message_id: context.sourceMessageId,
    p_policy_version: policy.policyVersion,
    p_prompt_version: promptVersion,
    p_provider: model.providerId,
    p_model: model.modelId,
    p_intent: policy.intent,
    p_flow_action: policy.flowAction,
    p_scope: draft?.scope ?? null,
    p_confidence: policy.confidence,
    p_suggested_title: draft?.title ?? null,
    p_original_time_text: draft?.originalTimeText ?? null,
    p_parsed_payload: draft ? { ...draft.parsedPayload } : {},
    p_missing_fields: draft ? [...draft.missingFields] : [],
    p_latency_ms: model.latencyMs,
    p_input_tokens: model.inputTokens,
    p_output_tokens: model.outputTokens,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return null;

  const parsed = persistenceResultSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
