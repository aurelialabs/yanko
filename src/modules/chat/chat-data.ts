import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readAiChatRuntimeMode } from "@/modules/ai/runtime-config";
import { getPendingMemoryCandidates } from "@/modules/profile/memory-data";
import { getPendingPlanProposals } from "@/modules/plan/plan-proposal-data";

import {
  decodeChatHistoryCursor,
  encodeChatHistoryCursor,
  isChatResourceId,
} from "./chat-cursor";
import {
  demoChatWorkspace,
  type ChatHistoryPage,
  type ChatMessagePresentation,
  type ChatWorkspaceData,
} from "./chat-presentation";

export const CHAT_HISTORY_PAGE_SIZE = 50;

type RawConversation = {
  id?: unknown;
};

export type ChatHistoryRow = {
  id?: unknown;
  sender?: unknown;
  content?: unknown;
  status?: unknown;
  persona_version_id?: unknown;
  reply_to_message_id?: unknown;
  created_at?: unknown;
};

const emptyHistory: ChatHistoryPage = {
  messages: [],
  nextCursor: null,
  hasMore: false,
};

export const SCHEDULED_FOLLOWUP_NOTICE = "如果你没有先继续说，明天会再关心你一次。";

async function readScheduledFollowupNotice(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userId: string,
  roleId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("emotion_followups")
    .select("id")
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .eq("status", "scheduled")
    .limit(1);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  return SCHEDULED_FOLLOWUP_NOTICE;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function chatTimestamp(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function toMessage(value: ChatHistoryRow): ChatMessagePresentation | null {
  const id = stringValue(value.id);
  const sender = stringValue(value.sender);
  const content = stringValue(value.content);
  const status = stringValue(value.status);
  const personaVersionId = stringValue(value.persona_version_id);
  const replyToMessageId = stringValue(value.reply_to_message_id);

  if (
    !id ||
    !content ||
    !["user", "assistant"].includes(sender ?? "") ||
    !["pending", "completed", "failed"].includes(status ?? "")
  ) {
    return null;
  }

  return {
    id,
    sender: sender as ChatMessagePresentation["sender"],
    content,
    status: status as ChatMessagePresentation["status"],
    personaVersionId: sender === "assistant" ? personaVersionId : null,
    replyToMessageId: sender === "assistant" ? replyToMessageId : null,
    createdAt: chatTimestamp(value.created_at),
  };
}

export function buildChatHistoryPage(rows: ChatHistoryRow[]): ChatHistoryPage {
  const hasMore = rows.length > CHAT_HISTORY_PAGE_SIZE;
  const pageRows = rows.slice(0, CHAT_HISTORY_PAGE_SIZE);
  const oldestRow = pageRows.at(-1);
  const oldestCreatedAt = stringValue(oldestRow?.created_at);
  const oldestId = stringValue(oldestRow?.id);
  const nextCursor =
    hasMore && oldestCreatedAt && oldestId
      ? encodeChatHistoryCursor({
          createdAt: new Date(oldestCreatedAt).toISOString(),
          id: oldestId,
        })
      : null;

  return {
    messages: pageRows
      .map(toMessage)
      .filter((message): message is ChatMessagePresentation => message !== null)
      .reverse(),
    nextCursor,
    hasMore: Boolean(hasMore && nextCursor),
  };
}

/**
 * Reads one page from the signed-in user's currently selected, unique role
 * conversation. Rows are fetched newest-first for a stable tuple cursor and
 * reversed before they cross the server boundary.
 */
export async function getChatHistoryPage(
  user: User,
  roleId: string,
  conversationId: string,
  cursor: string | null,
): Promise<ChatHistoryPage | null> {
  if (!isChatResourceId(roleId) || !isChatResourceId(conversationId)) return null;
  const decodedCursor = cursor ? decodeChatHistoryCursor(cursor) : null;
  if (cursor && !decodedCursor) return null;

  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const [profileResult, conversationResult] = await Promise.all([
    supabase.from("profiles").select("current_role_id").eq("id", user.id).maybeSingle(),
    supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .eq("role_id", roleId)
      .maybeSingle(),
  ]);
  const currentRoleId = stringValue(profileResult.data?.current_role_id);
  const ownedConversationId = stringValue(
    (conversationResult.data as RawConversation | null)?.id,
  );
  if (
    profileResult.error ||
    conversationResult.error ||
    currentRoleId !== roleId ||
    ownedConversationId !== conversationId
  ) {
    return null;
  }

  let query = supabase
    .from("messages")
    .select(
      "id, sender, content, status, persona_version_id, reply_to_message_id, created_at",
    )
    .eq("user_id", user.id)
    .eq("role_id", roleId)
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .in("sender", ["user", "assistant"])
    .in("status", ["pending", "completed", "failed"]);

  if (decodedCursor) {
    query = query.or(
      `created_at.lt.${decodedCursor.createdAt},and(created_at.eq.${decodedCursor.createdAt},id.lt.${decodedCursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHAT_HISTORY_PAGE_SIZE + 1);
  if (error) return null;

  return buildChatHistoryPage((data ?? []) as ChatHistoryRow[]);
}

/**
 * Reads only the current role's conversation under RLS.
 * This prevents another role's history from reaching the chat client.
 */
export async function getChatWorkspace(
  user: User | null,
  roleId: string | null,
): Promise<ChatWorkspaceData> {
  if (!user) return demoChatWorkspace;
  const runtimeMode = readAiChatRuntimeMode() ?? "unavailable";
  if (!roleId) {
    return {
      source: "unavailable",
      runtimeMode,
      conversationId: null,
      history: emptyHistory,
      memoryCandidates: [],
      planProposals: [],
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return {
      source: "unavailable",
      runtimeMode,
      conversationId: null,
      history: emptyHistory,
      memoryCandidates: [],
      planProposals: [],
    };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", user.id)
    .eq("role_id", roleId)
    .maybeSingle();

  const conversationId = stringValue((conversation as RawConversation | null)?.id);
  if (conversationError || !conversationId) {
    return {
      source: "unavailable",
      runtimeMode,
      conversationId: null,
      history: emptyHistory,
      memoryCandidates: [],
      planProposals: [],
    };
  }

  const [history, memoryCandidates, planProposals, scheduledFollowupNotice] =
    await Promise.all([
      getChatHistoryPage(user, roleId, conversationId, null),
      getPendingMemoryCandidates(user, roleId),
      getPendingPlanProposals(user, roleId),
      readScheduledFollowupNotice(supabase, user.id, roleId),
    ]);
  if (!history) {
    return {
      source: "unavailable",
      runtimeMode,
      conversationId: null,
      history: emptyHistory,
      memoryCandidates: [],
      planProposals: [],
    };
  }

  return {
    source: "database",
    runtimeMode,
    conversationId,
    history,
    memoryCandidates,
    planProposals,
    scheduledFollowupNotice,
  };
}
