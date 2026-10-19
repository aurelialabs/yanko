import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthContext = vi.hoisted(() => vi.fn());
const createServerSupabaseClient = vi.hoisted(() => vi.fn());
const readAiChatRuntimeMode = vi.hoisted(() => vi.fn());
const runMiniMaxDevelopmentChatTurn = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ getAuthContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));
vi.mock("@/modules/ai/runtime-config", () => ({ readAiChatRuntimeMode }));
vi.mock("@/modules/ai/chat-runtime", () => ({ runMiniMaxDevelopmentChatTurn }));
vi.mock("@/modules/chat/chat-data", () => ({ getChatHistoryPage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath, refresh }));

import { retryFailedChatMessage } from "./actions";

const userId = "11111111-1111-4111-8111-111111111111";
const userMessageId = "22222222-2222-4222-8222-222222222222";
const roleId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";

function validForm() {
  const form = new FormData();
  form.set("userMessageId", userMessageId);
  form.set("idempotencyKey", "retry-key-123456");
  return form;
}

function queryWithResults(...results: unknown[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  for (const result of results) query.maybeSingle.mockResolvedValueOnce(result);
  return query;
}

describe("retryFailedChatMessage", () => {
  beforeEach(() => {
    getAuthContext.mockReset();
    createServerSupabaseClient.mockReset();
    readAiChatRuntimeMode.mockReset();
    runMiniMaxDevelopmentChatTurn.mockReset();
    revalidatePath.mockReset();
    refresh.mockReset();
    getAuthContext.mockResolvedValue({ user: { id: userId } });
    readAiChatRuntimeMode.mockReturnValue("minimax-development");
  });

  it("rejects malformed input before authentication or database access", async () => {
    await expect(
      retryFailedChatMessage({ message: "" }, new FormData()),
    ).resolves.toEqual({ message: "这条回复无法重试，请刷新后再试。" });
    expect(getAuthContext).not.toHaveBeenCalled();
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user for every retry request", async () => {
    getAuthContext.mockResolvedValue({ user: null });

    await expect(retryFailedChatMessage({ message: "" }, validForm())).resolves.toEqual(
      { message: "登录状态已失效，请重新登录。" },
    );
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rechecks both original message ownership and failed reply before rerunning", async () => {
    const query = queryWithResults(
      { data: null, error: null },
      { data: null, error: null },
    );
    createServerSupabaseClient.mockResolvedValue({
      from: vi.fn().mockReturnValue(query),
    });

    await expect(retryFailedChatMessage({ message: "" }, validForm())).resolves.toEqual(
      { message: "这条回复已更新，请刷新后再试。" },
    );
    expect(query.eq).toHaveBeenCalledWith("user_id", userId);
    expect(runMiniMaxDevelopmentChatTurn).not.toHaveBeenCalled();
  });

  it("passes only the server-read original turn to the development runtime", async () => {
    const query = queryWithResults(
      {
        data: {
          id: userMessageId,
          content: "保留原文重试",
          client_message_id: "client-key-123456",
          conversation_id: conversationId,
          role_id: roleId,
        },
        error: null,
      },
      { data: { id: "55555555-5555-4555-8555-555555555555" }, error: null },
    );
    createServerSupabaseClient.mockResolvedValue({
      from: vi.fn().mockReturnValue(query),
    });
    runMiniMaxDevelopmentChatTurn.mockResolvedValue({
      outcome: "completed",
      userMessageId,
      assistantMessageId: "55555555-5555-4555-8555-555555555555",
    });

    const result = await retryFailedChatMessage({ message: "" }, validForm());

    expect(result).toEqual({
      message: "",
      clientMessageId: "client-key-123456",
      sentMessageId: userMessageId,
    });
    expect(runMiniMaxDevelopmentChatTurn).toHaveBeenCalledWith({
      user: { id: userId },
      roleId,
      conversationId,
      content: "保留原文重试",
      clientMessageId: "client-key-123456",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/chat");
  });
});
