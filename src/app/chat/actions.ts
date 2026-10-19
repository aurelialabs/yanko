"use server";

import { refresh, revalidatePath } from "next/cache";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  ChatActionState,
  PersonaFeedbackActionState,
} from "@/modules/chat/chat-action-state";
import { runMiniMaxDevelopmentChatTurn } from "@/modules/ai/chat-runtime";
import { processCompletedUserMessageUnderstanding } from "@/modules/ai/post-message-understanding";
import { readAiChatRuntimeMode } from "@/modules/ai/runtime-config";
import { getChatHistoryPage } from "@/modules/chat/chat-data";
import type { ChatHistoryActionResult } from "@/modules/chat/chat-presentation";
import {
  chatHistoryRequestSchema,
  idempotencyKeySchema,
  personaFeedbackSchema,
  regenerateMessageSchema,
  sendMessageSchema,
} from "@/server/schemas";

function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function loadOlderChatMessages(
  formData: FormData,
): Promise<ChatHistoryActionResult> {
  const input = chatHistoryRequestSchema.safeParse({
    roleId: textField(formData, "roleId"),
    conversationId: textField(formData, "conversationId"),
    cursor: textField(formData, "cursor"),
  });
  if (!input.success) {
    return { status: "unavailable", message: "无法加载更早消息，请刷新后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { status: "unavailable", message: "登录状态已失效，请重新登录。" };
  }
  const page = await getChatHistoryPage(
    auth.user,
    input.data.roleId,
    input.data.conversationId,
    input.data.cursor,
  );
  return page
    ? { status: "success", page }
    : { status: "unavailable", message: "暂时无法加载更早消息，请稍后再试。" };
}

/**
 * Appends an idempotent current-role turn. Mock remains the default; the
 * MiniMax development mode returns only after a safe terminal state is saved.
 */
export async function sendChatMessage(
  _previousState: ChatActionState,
  formData: FormData,
): Promise<ChatActionState> {
  const input = sendMessageSchema.safeParse({
    roleId: textField(formData, "roleId"),
    conversationId: textField(formData, "conversationId"),
    clientMessageId: textField(formData, "clientMessageId"),
    content: textField(formData, "content"),
  });

  if (!input.success) {
    return { message: "消息不能为空，且不能超过 20,000 个字符。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return {
      message: "登录状态已失效，请重新登录。",
      clientMessageId: input.data.clientMessageId,
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return {
      message: "聊天服务尚未配置，暂时无法发送。",
      clientMessageId: input.data.clientMessageId,
    };
  }

  const runtimeMode = readAiChatRuntimeMode();
  if (!runtimeMode) {
    return {
      message: "聊天运行模式配置无效，暂时无法发送。",
      clientMessageId: input.data.clientMessageId,
    };
  }

  let sentMessageId: string | null = null;
  let actionMessage = "";
  if (runtimeMode === "mock") {
    const { data, error } = await supabase.rpc("append_mock_chat_turn", {
      p_role_id: input.data.roleId,
      p_conversation_id: input.data.conversationId,
      p_content: input.data.content,
      p_client_message_id: input.data.clientMessageId,
    });
    const result = Array.isArray(data) ? data[0] : null;
    sentMessageId =
      result && typeof result.user_message_id === "string"
        ? result.user_message_id
        : null;
    if (error || !sentMessageId) {
      return {
        message: "暂时无法发送消息，请稍后再试。",
        clientMessageId: input.data.clientMessageId,
      };
    }
  } else {
    const result = await runMiniMaxDevelopmentChatTurn({
      user: auth.user,
      roleId: input.data.roleId,
      conversationId: input.data.conversationId,
      content: input.data.content,
      clientMessageId: input.data.clientMessageId,
    });
    if (result.outcome === "failed") {
      return {
        message: "回复暂时不可用，原消息已保留，可直接重试。",
        clientMessageId: input.data.clientMessageId,
      };
    }
    sentMessageId = result.userMessageId;
    actionMessage =
      result.outcome === "in-progress"
        ? "这条消息正在生成回复，请稍后刷新查看。"
        : result.outcome === "blocked"
          ? "这次回复未通过安全检查，请换一种说法后再试。"
          : "";
  }

  if (sentMessageId) {
    try {
      await processCompletedUserMessageUnderstanding({
        userId: auth.user.id,
        sourceMessageId: sentMessageId,
      });
    } catch {
      // The reply is already saved. Understanding can be retried by sending again.
    }
  }

  revalidatePath("/chat");
  revalidatePath("/plan");
  revalidatePath("/me/memories");
  refresh();
  return {
    message: actionMessage,
    clientMessageId: input.data.clientMessageId,
    sentMessageId,
  };
}

/**
 * Re-runs a failed assistant turn using the authenticated user's original
 * message. The database runtime reuses its idempotent AI run and message pair.
 */
export async function retryFailedChatMessage(
  _previousState: ChatActionState,
  formData: FormData,
): Promise<ChatActionState> {
  const input = regenerateMessageSchema.safeParse({
    userMessageId: textField(formData, "userMessageId"),
    idempotencyKey: textField(formData, "idempotencyKey"),
  });
  if (!input.success) return { message: "这条回复无法重试，请刷新后再试。" };

  const auth = await getAuthContext();
  if (!auth.user) return { message: "登录状态已失效，请重新登录。" };

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { message: "聊天服务尚未配置，暂时无法重试。" };
  if (readAiChatRuntimeMode() !== "minimax-development") {
    return { message: "当前聊天运行模式不支持重试。" };
  }

  const { data: userMessage, error: userMessageError } = await supabase
    .from("messages")
    .select("id, content, client_message_id, conversation_id, role_id")
    .eq("id", input.data.userMessageId)
    .eq("user_id", auth.user.id)
    .eq("sender", "user")
    .eq("status", "completed")
    .is("deleted_at", null)
    .maybeSingle();
  if (
    userMessageError ||
    !userMessage ||
    typeof userMessage.content !== "string" ||
    typeof userMessage.client_message_id !== "string" ||
    typeof userMessage.conversation_id !== "string" ||
    typeof userMessage.role_id !== "string"
  ) {
    return { message: "这条回复已更新，请刷新后再试。" };
  }

  const { data: failedReply, error: failedReplyError } = await supabase
    .from("messages")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("conversation_id", userMessage.conversation_id)
    .eq("role_id", userMessage.role_id)
    .eq("sender", "assistant")
    .eq("reply_to_message_id", userMessage.id)
    .eq("status", "failed")
    .is("deleted_at", null)
    .maybeSingle();
  if (failedReplyError || !failedReply) {
    return { message: "这条回复已更新，请刷新后再试。" };
  }

  const retryFormData = new FormData();
  retryFormData.set("roleId", userMessage.role_id);
  retryFormData.set("conversationId", userMessage.conversation_id);
  retryFormData.set("clientMessageId", userMessage.client_message_id);
  retryFormData.set("content", userMessage.content);
  return sendChatMessage(_previousState, retryFormData);
}

/**
 * Stores a negative persona-feedback signal through a guarded, idempotent
 * database function. The server function re-checks the target assistant
 * message, role, persona version, and current user before inserting anything.
 */
export async function submitPersonaFeedback(
  _previousState: PersonaFeedbackActionState,
  formData: FormData,
): Promise<PersonaFeedbackActionState> {
  const idempotencyKey = textField(formData, "idempotencyKey");
  const feedback = personaFeedbackSchema.safeParse({
    messageId: textField(formData, "messageId"),
    roleId: textField(formData, "roleId"),
    personaVersionId: textField(formData, "personaVersionId"),
    categories: formData
      .getAll("categories")
      .filter((value): value is string => typeof value === "string"),
    additionalText: textField(formData, "additionalText").trim() || undefined,
    entryPoint: textField(formData, "entryPoint"),
  });
  const key = idempotencyKeySchema.safeParse(idempotencyKey);

  if (!feedback.success || !key.success) {
    return { message: "反馈信息不完整，请重新提交。", idempotencyKey };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return {
      message: "登录状态已失效，请重新登录后提交反馈。",
      idempotencyKey: key.data,
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return {
      message: "反馈服务尚未配置，当前仅为原型演示。",
      idempotencyKey: key.data,
    };
  }

  const { data, error } = await supabase.rpc("submit_persona_feedback", {
    p_message_id: feedback.data.messageId,
    p_role_id: feedback.data.roleId,
    p_persona_version_id: feedback.data.personaVersionId,
    p_categories: feedback.data.categories,
    p_additional_text: feedback.data.additionalText ?? null,
    p_entry_point: feedback.data.entryPoint,
    p_idempotency_key: key.data,
  });

  if (error || typeof data !== "string") {
    return {
      message: "暂时无法提交反馈，请稍后再试。",
      idempotencyKey: key.data,
    };
  }

  revalidatePath("/chat");
  refresh();
  return {
    message: "反馈已提交，谢谢你帮助我们改进后续回应。",
    idempotencyKey: key.data,
    submitted: true,
  };
}
