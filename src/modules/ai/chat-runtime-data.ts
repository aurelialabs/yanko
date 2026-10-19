import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

export type AiChatReservationRuntime = "minimax-development" | "deterministic-safety";

export type AiRunTerminalStatus = "blocked" | "failed";

export interface PersistedOocCheck {
  attempt_no: 1 | 2;
  verdict: "pass" | "rewrite" | "block" | "error";
  overall_score: number;
  dimension_scores: Record<string, number>;
  failure_labels: string[];
  latency_ms: number;
}

export interface BeginAiChatTurnInput {
  userId: string;
  roleId: string;
  conversationId: string;
  content: string;
  clientMessageId: string;
  runtime: AiChatReservationRuntime;
  traceId: string;
}

export interface BeginAiChatTurnResult {
  userMessageId: string;
  assistantMessageId: string;
  aiRunId: string | null;
  personaVersionId: string;
  strategyVersionId: string;
  provider: string;
  model: string;
  runStatus: "running" | "completed" | "blocked" | "failed";
  shouldGenerate: boolean;
}

export interface CompleteAiChatTurnInput {
  userId: string;
  aiRunId: string;
  traceId: string;
  content: string;
  rewritten: boolean;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  oocChecks: readonly PersistedOocCheck[];
}

export interface FailAiChatTurnInput {
  userId: string;
  aiRunId: string;
  traceId: string;
  runStatus: AiRunTerminalStatus;
  errorCode: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  oocChecks: readonly PersistedOocCheck[];
}

type RawBeginResult = {
  user_message_id?: unknown;
  assistant_message_id?: unknown;
  ai_run_id?: unknown;
  persona_version_id?: unknown;
  strategy_version_id?: unknown;
  provider?: unknown;
  model?: unknown;
  run_status?: unknown;
  should_generate?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseBeginResult(value: unknown): BeginAiChatTurnResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as RawBeginResult;
  const userMessageId = text(row.user_message_id);
  const assistantMessageId = text(row.assistant_message_id);
  const aiRunId = text(row.ai_run_id);
  const personaVersionId = text(row.persona_version_id);
  const strategyVersionId = text(row.strategy_version_id);
  const provider = text(row.provider);
  const model = text(row.model);
  const runStatus = text(row.run_status);
  if (
    !userMessageId ||
    !assistantMessageId ||
    !personaVersionId ||
    !strategyVersionId ||
    !provider ||
    !model ||
    !["running", "completed", "blocked", "failed"].includes(runStatus ?? "") ||
    typeof row.should_generate !== "boolean" ||
    (row.should_generate && !aiRunId)
  ) {
    return null;
  }

  return {
    userMessageId,
    assistantMessageId,
    aiRunId,
    personaVersionId,
    strategyVersionId,
    provider,
    model,
    runStatus: runStatus as BeginAiChatTurnResult["runStatus"],
    shouldGenerate: row.should_generate,
  };
}

export async function beginAiChatTurn(
  input: BeginAiChatTurnInput,
): Promise<BeginAiChatTurnResult | null> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("begin_ai_chat_turn", {
    p_user_id: input.userId,
    p_role_id: input.roleId,
    p_conversation_id: input.conversationId,
    p_content: input.content,
    p_client_message_id: input.clientMessageId,
    p_runtime: input.runtime,
    p_trace_id: input.traceId,
  });
  if (error) return null;
  return parseBeginResult(Array.isArray(data) ? data[0] : data);
}

export async function completeAiChatTurn(
  input: CompleteAiChatTurnInput,
): Promise<boolean> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("complete_ai_chat_turn", {
    p_user_id: input.userId,
    p_ai_run_id: input.aiRunId,
    p_trace_id: input.traceId,
    p_content: input.content,
    p_rewritten: input.rewritten,
    p_latency_ms: input.latencyMs,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_ooc_checks: input.oocChecks,
  });
  return !error && typeof data === "string";
}

export async function failAiChatTurn(input: FailAiChatTurnInput): Promise<boolean> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("fail_ai_chat_turn", {
    p_user_id: input.userId,
    p_ai_run_id: input.aiRunId,
    p_trace_id: input.traceId,
    p_run_status: input.runStatus,
    p_error_code: input.errorCode,
    p_latency_ms: input.latencyMs,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_ooc_checks: input.oocChecks,
  });
  return !error && typeof data === "string";
}
