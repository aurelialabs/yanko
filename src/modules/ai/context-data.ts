import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  DEFAULT_MODEL_CONTEXT_BUDGET,
  type ContextConversationMessage,
  type ContextMemory,
  type ContextSummary,
  type ModelContextSources,
} from "./context-builder";
import type {
  ModelContextMemoryRetrievalAudit,
  ModelContextMemoryRetriever,
} from "./memory-context-retrieval";
import { MEMORY_RETRIEVAL_MAX_RESULTS } from "./memory-vector";
import { ModelAdapterError } from "./model-errors";

type RawRole = {
  current_persona_version_id?: unknown;
};

type RawPersonaVersion = {
  id?: unknown;
  compiled_system_prompt?: unknown;
  strategy_version_id?: unknown;
};

type RawConversation = {
  id?: unknown;
  last_summary_message_id?: unknown;
};

type RawSummary = {
  through_message_id?: unknown;
  summary_text?: unknown;
};

type RawMessage = {
  id?: unknown;
  sender?: unknown;
  content?: unknown;
  status?: unknown;
};

type RawMemory = {
  id?: unknown;
  scope?: unknown;
  role_id?: unknown;
  category?: unknown;
  content?: unknown;
  sensitivity?: unknown;
  status?: unknown;
  confirmed_by_user?: unknown;
  valid_from?: unknown;
  valid_to?: unknown;
};

export interface ModelContextLoadOptions {
  user: User;
  roleId: string;
  conversationId?: string;
  /**
   * Pins a generation already reserved in the database to the immutable
   * persona version captured at begin_ai_chat_turn.
   */
  personaVersionId?: string;
  /** Pins the AI run's development strategy instead of mutating the persona. */
  strategyVersionId?: string;
  maxRecentMessages?: number;
  maxMemories?: number;
  now?: Date;
  /**
   * Optional vector retrieval is injected explicitly. The query must be the
   * current, already validated user message; this module never reads provider
   * configuration or creates an embedding adapter implicitly.
   */
  memoryRetrieval?: {
    retriever: ModelContextMemoryRetriever;
    query: string;
    includeSensitive?: boolean;
    traceId?: string;
  };
}

export interface LoadedModelContextSources extends ModelContextSources {
  memoryRetrievalAudit: ModelContextMemoryRetrievalAudit | null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  upperBound: number,
): number {
  if (!Number.isInteger(value) || value === undefined) return fallback;
  return Math.min(Math.max(value, 1), upperBound);
}

function toMessage(record: RawMessage): ContextConversationMessage | null {
  const id = stringValue(record.id);
  const content = stringValue(record.content);
  const sender = stringValue(record.sender);
  const status = stringValue(record.status);

  if (
    !id ||
    !content ||
    !["user", "assistant"].includes(sender ?? "") ||
    !["completed", "pending", "failed", "deleted"].includes(status ?? "")
  ) {
    return null;
  }

  return {
    id,
    sender: sender as ContextConversationMessage["sender"],
    content,
    status: status as ContextConversationMessage["status"],
  };
}

function isActiveAt(record: RawMemory, now: Date): boolean {
  const validFrom = stringValue(record.valid_from);
  const validTo = stringValue(record.valid_to);
  const nowTime = now.getTime();
  const validFromTime = validFrom ? Date.parse(validFrom) : null;
  const validToTime = validTo ? Date.parse(validTo) : null;

  return (
    (validFromTime === null ||
      (!Number.isNaN(validFromTime) && validFromTime <= nowTime)) &&
    (validToTime === null || (!Number.isNaN(validToTime) && validToTime >= nowTime))
  );
}

function toMemory(record: RawMemory, roleId: string, now: Date): ContextMemory | null {
  const id = stringValue(record.id);
  const scope = stringValue(record.scope);
  const recordRoleId = stringValue(record.role_id);
  const category = stringValue(record.category);
  const content = stringValue(record.content);
  const sensitivity = stringValue(record.sensitivity);
  const status = stringValue(record.status);

  if (
    !id ||
    !category ||
    !content ||
    !["user_shared", "role_private"].includes(scope ?? "") ||
    !["normal", "sensitive", "forbidden"].includes(sensitivity ?? "") ||
    !["active", "pending", "superseded", "deleted", "rejected"].includes(
      status ?? "",
    ) ||
    !isActiveAt(record, now)
  ) {
    return null;
  }

  if (
    (scope === "user_shared" && recordRoleId !== null) ||
    (scope === "role_private" && recordRoleId !== roleId)
  ) {
    return null;
  }

  return {
    id,
    scope: scope as ContextMemory["scope"],
    roleId: recordRoleId,
    category,
    content,
    sensitivity: sensitivity as ContextMemory["sensitivity"],
    status: status as ContextMemory["status"],
    confirmedByUser: record.confirmed_by_user === true,
  };
}

function unavailable(message: string): ModelAdapterError {
  return new ModelAdapterError("unavailable", message);
}

/**
 * Loads only the active persona, the requested role's own conversation, and
 * that role's eligible memories. Role-private memories of another role are
 * filtered at query time and then checked again before prompt construction.
 */
export async function loadModelContextSources(
  options: ModelContextLoadOptions,
): Promise<LoadedModelContextSources> {
  if (!isUuid(options.roleId)) {
    throw new ModelAdapterError("configuration", "Invalid model context role ID.");
  }

  if (options.conversationId && !isUuid(options.conversationId)) {
    throw new ModelAdapterError(
      "configuration",
      "Invalid model context conversation ID.",
    );
  }

  if (options.personaVersionId && !isUuid(options.personaVersionId)) {
    throw new ModelAdapterError(
      "configuration",
      "Invalid model context persona version ID.",
    );
  }

  if (options.strategyVersionId && !isUuid(options.strategyVersionId)) {
    throw new ModelAdapterError(
      "configuration",
      "Invalid model context strategy version ID.",
    );
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw unavailable("Chat data is not configured.");
  }

  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("current_persona_version_id")
    .eq("id", options.roleId)
    .eq("user_id", options.user.id)
    .maybeSingle();

  const currentPersonaVersionId = stringValue(
    (role as RawRole | null)?.current_persona_version_id,
  );
  const personaVersionId = options.personaVersionId ?? currentPersonaVersionId;
  if (roleError || !currentPersonaVersionId || !personaVersionId) {
    throw unavailable("Current role context is unavailable.");
  }

  const { data: personaVersion, error: personaError } = await supabase
    .from("persona_versions")
    .select("id, compiled_system_prompt, strategy_version_id")
    .eq("id", personaVersionId)
    .eq("role_id", options.roleId)
    .eq("user_id", options.user.id)
    .maybeSingle();

  const persona = personaVersion as RawPersonaVersion | null;
  const compiledSystemPrompt = stringValue(persona?.compiled_system_prompt);
  const personaStrategyVersionId = stringValue(persona?.strategy_version_id);
  const strategyVersionId = options.strategyVersionId ?? personaStrategyVersionId;
  const resolvedPersonaVersionId = stringValue(persona?.id);
  if (
    personaError ||
    !compiledSystemPrompt ||
    !personaStrategyVersionId ||
    !strategyVersionId ||
    !resolvedPersonaVersionId
  ) {
    throw unavailable("Current persona context is unavailable.");
  }

  let conversationQuery = supabase
    .from("conversations")
    .select("id, last_summary_message_id")
    .eq("user_id", options.user.id)
    .eq("role_id", options.roleId);

  if (options.conversationId) {
    conversationQuery = conversationQuery.eq("id", options.conversationId);
  }

  const { data: conversation, error: conversationError } =
    await conversationQuery.maybeSingle();
  const resolvedConversation = conversation as RawConversation | null;
  const conversationId = stringValue(resolvedConversation?.id);
  if (conversationError || !conversationId) {
    throw unavailable("Role conversation context is unavailable.");
  }

  const messageLimit = boundedLimit(
    options.maxRecentMessages,
    DEFAULT_MODEL_CONTEXT_BUDGET.maxRecentMessages,
    100,
  );
  const memoryLimit = boundedLimit(
    options.maxMemories,
    DEFAULT_MODEL_CONTEXT_BUDGET.maxMemories,
    50,
  );
  const now = options.now ?? new Date();
  const summaryMessageId = stringValue(resolvedConversation?.last_summary_message_id);
  const messagesQuery = supabase
    .from("messages")
    .select("id, sender, content, status")
    .eq("user_id", options.user.id)
    .eq("role_id", options.roleId)
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .in("sender", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(messageLimit);
  const memoriesQuery = options.memoryRetrieval
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("memories")
        .select(
          "id, scope, role_id, category, content, sensitivity, status, confirmed_by_user, valid_from, valid_to",
        )
        .eq("user_id", options.user.id)
        .eq("status", "active")
        .in("scope", ["user_shared", "role_private"])
        .or(
          `scope.eq.user_shared,and(scope.eq.role_private,role_id.eq.${options.roleId})`,
        )
        .order("updated_at", { ascending: false })
        .limit(memoryLimit);
  const memoryRetrievalQuery = options.memoryRetrieval
    ? options.memoryRetrieval.retriever.retrieve({
        userId: options.user.id,
        roleId: options.roleId,
        query: options.memoryRetrieval.query,
        maxResults: Math.min(memoryLimit, MEMORY_RETRIEVAL_MAX_RESULTS),
        includeSensitive: options.memoryRetrieval.includeSensitive === true,
        now,
        traceId: options.memoryRetrieval.traceId,
      })
    : Promise.resolve(null);
  const summaryQuery = summaryMessageId
    ? supabase
        .from("conversation_summaries")
        .select("through_message_id, summary_text")
        .eq("user_id", options.user.id)
        .eq("conversation_id", conversationId)
        .eq("through_message_id", summaryMessageId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [messagesResult, memoriesResult, summaryResult, memoryRetrievalResult] =
    await Promise.all([
      messagesQuery,
      memoriesQuery,
      summaryQuery,
      memoryRetrievalQuery,
    ]);

  if (messagesResult.error || memoriesResult.error || summaryResult.error) {
    throw unavailable("Chat context data is unavailable.");
  }

  const messages = ((messagesResult.data ?? []) as RawMessage[])
    .map(toMessage)
    .filter((message): message is ContextConversationMessage => message !== null)
    .reverse();
  const memories = memoryRetrievalResult
    ? memoryRetrievalResult.memories
    : ((memoriesResult.data ?? []) as RawMemory[])
        .map((memory) => toMemory(memory, options.roleId, now))
        .filter((memory): memory is ContextMemory => memory !== null);
  const rawSummary = summaryResult.data as RawSummary | null;
  const summaryText = stringValue(rawSummary?.summary_text);
  const summaryThroughMessageId = stringValue(rawSummary?.through_message_id);
  const summary: ContextSummary | null =
    summaryText && summaryThroughMessageId
      ? { throughMessageId: summaryThroughMessageId, content: summaryText }
      : null;

  return {
    roleId: options.roleId,
    personaVersionId: resolvedPersonaVersionId,
    strategyVersionId,
    compiledSystemPrompt,
    messages,
    memories,
    directlyRelevantSensitiveMemoryIds:
      memoryRetrievalResult?.directlyRelevantSensitiveMemoryIds ?? [],
    summary,
    memoryRetrievalAudit: memoryRetrievalResult?.audit ?? null,
  };
}
