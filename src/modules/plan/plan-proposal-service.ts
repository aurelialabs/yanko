import "server-only";

import { z } from "zod";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { idempotencyKeySchema, uuidSchema } from "@/server/schemas";

import type { PlanIntentPolicyResult } from "./plan-intent-policy";

const proposalSourceSchema = z
  .object({
    sourceRoleId: uuidSchema,
    sourceMessageId: uuidSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export interface CreatePlanProposalRequest {
  sourceRoleId: string;
  sourceMessageId: string;
  idempotencyKey: string;
  policy: PlanIntentPolicyResult;
}

export interface PlanProposalRpcInput {
  p_source_role_id: string;
  p_source_message_id: string;
  p_scope: "day" | "week" | "month" | "year";
  p_suggested_title: string | null;
  p_original_time_text: string | null;
  p_parsed_payload: Record<string, unknown>;
  p_missing_fields: string[];
  p_confidence: number;
  p_idempotency_key: string;
}

export class PlanProposalPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanProposalPersistenceError";
  }
}

function jsonRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  let serialized: string | undefined;

  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new PlanProposalPersistenceError(
      "Plan proposal payload must be JSON serializable.",
    );
  }

  if (!serialized) {
    throw new PlanProposalPersistenceError(
      "Plan proposal payload must be a JSON object.",
    );
  }

  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new PlanProposalPersistenceError(
      "Plan proposal payload must be a JSON object.",
    );
  }

  return parsed as Record<string, unknown>;
}

/**
 * Narrows a policy result to the only outcome that is allowed to become a
 * durable proposal. OFFER_PLAN, EXPLORE_GOAL, and ordinary chat stay out of
 * persistence, even if a caller attempts to pass their draft-like data here.
 */
export function buildCreatePlanProposalRpcInput(
  request: CreatePlanProposalRequest,
): PlanProposalRpcInput {
  const source = proposalSourceSchema.safeParse({
    sourceRoleId: request.sourceRoleId,
    sourceMessageId: request.sourceMessageId,
    idempotencyKey: request.idempotencyKey,
  });

  if (!source.success) {
    throw new PlanProposalPersistenceError("Plan proposal source is invalid.");
  }

  const { policy } = request;
  const draft = policy.draft;
  if (
    policy.intent !== "create" ||
    policy.flowAction !== "show_confirmation_card" ||
    !draft ||
    !Number.isFinite(policy.confidence)
  ) {
    throw new PlanProposalPersistenceError(
      "Only an explicit create result may be persisted as a plan proposal.",
    );
  }

  return {
    p_source_role_id: source.data.sourceRoleId,
    p_source_message_id: source.data.sourceMessageId,
    p_scope: draft.scope,
    p_suggested_title: draft.title,
    p_original_time_text: draft.originalTimeText,
    p_parsed_payload: jsonRecord(draft.parsedPayload),
    p_missing_fields: [...draft.missingFields],
    p_confidence: policy.confidence,
    p_idempotency_key: source.data.idempotencyKey,
  };
}

/**
 * Persists only a confirmation-ready chat plan proposal. The database RPC
 * re-checks the current user, current role, source message, expiry, payload
 * whitelist, and idempotency before a row can be inserted.
 */
export async function persistCreatePlanProposal(
  request: CreatePlanProposalRequest,
): Promise<string> {
  const rpcInput = buildCreatePlanProposalRpcInput(request);
  const auth = await getAuthContext();

  if (!auth.user) {
    throw new PlanProposalPersistenceError("Authentication is required.");
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw new PlanProposalPersistenceError("Plan proposal service is not configured.");
  }

  const { data, error } = await supabase.rpc("create_plan_proposal_v2", rpcInput);
  if (error || typeof data !== "string") {
    throw new PlanProposalPersistenceError("Plan proposal could not be persisted.");
  }

  return data;
}
