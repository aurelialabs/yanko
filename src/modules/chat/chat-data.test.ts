import { describe, expect, it } from "vitest";

import { decodeChatHistoryCursor } from "./chat-cursor";
import {
  buildChatHistoryPage,
  CHAT_HISTORY_PAGE_SIZE,
  type ChatHistoryRow,
} from "./chat-data";

function messageRow(sequence: number): ChatHistoryRow {
  return {
    id: `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`,
    sender: sequence % 2 ? "user" : "assistant",
    content: `message-${sequence}`,
    status: "completed",
    persona_version_id: sequence % 2 ? null : "11111111-1111-4111-8111-111111111111",
    reply_to_message_id: sequence % 2 ? null : "22222222-2222-4222-8222-222222222222",
    created_at: "2026-09-02T10:20:30.000Z",
  };
}

describe("buildChatHistoryPage", () => {
  it("returns the latest 50 in display order with a stable tuple cursor", () => {
    const newestFirst = Array.from({ length: CHAT_HISTORY_PAGE_SIZE + 1 }, (_, index) =>
      messageRow(CHAT_HISTORY_PAGE_SIZE + 1 - index),
    );
    const page = buildChatHistoryPage(newestFirst);

    expect(page.messages).toHaveLength(50);
    expect(page.messages[0]?.content).toBe("message-2");
    expect(page.messages.at(-1)?.content).toBe("message-51");
    expect(new Set(page.messages.map((message) => message.id)).size).toBe(50);
    expect(page.hasMore).toBe(true);
    expect(decodeChatHistoryCursor(page.nextCursor ?? "")).toEqual({
      createdAt: "2026-09-02T10:20:30.000Z",
      id: "00000000-0000-4000-8000-000000000002",
    });
  });

  it("stops pagination when the result does not contain a lookahead row", () => {
    const page = buildChatHistoryPage(
      Array.from({ length: 50 }, (_, index) => messageRow(50 - index)),
    );

    expect(page.messages).toHaveLength(50);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("preserves the original user message reference for assistant replies", () => {
    const page = buildChatHistoryPage([messageRow(2)]);

    expect(page.messages[0]?.replyToMessageId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });
});
