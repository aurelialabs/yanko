import { describe, expect, it } from "vitest";

import { buildChatThread, formatChatTime, shouldShowChatTime } from "@/modules/chat/chat-time";

const now = new Date("2026-10-16T07:00:00.000Z");

describe("chat timestamps", () => {
  it("labels time the way a chat thread does", () => {
    expect(formatChatTime("2026-10-16T01:00:00.000Z", now)).toBe("09:00");
    expect(formatChatTime("2026-10-15T12:09:00.000Z", now)).toBe("昨天 20:09");
    expect(formatChatTime("2026-10-13T12:09:00.000Z", now)).toBe("周二 20:09");
    expect(formatChatTime("2026-09-02T02:20:00.000Z", now)).toBe("9月2日 10:20");
    expect(formatChatTime("2025-10-16T02:20:00.000Z", now)).toBe("2025年10月16日 10:20");
  });

  it("shows a new time after five minutes or a new day", () => {
    expect(shouldShowChatTime("2026-10-16T01:04:00.000Z", "2026-10-16T01:00:00.000Z")).toBe(
      false,
    );
    expect(shouldShowChatTime("2026-10-16T01:05:00.000Z", "2026-10-16T01:00:00.000Z")).toBe(
      true,
    );
    expect(shouldShowChatTime("2026-10-16T16:02:00.000Z", "2026-10-16T15:58:00.000Z")).toBe(
      true,
    );
  });

  it("keeps a plan card where it was created instead of after later messages", () => {
    const thread = buildChatThread({
      now,
      messages: [
        { id: "a", sender: "assistant", content: "先说计划", status: "completed", createdAt: "2026-10-16T01:00:00.000Z" },
        { id: "b", sender: "user", content: "后来又说了一句", status: "completed", createdAt: "2026-10-16T07:30:00.000Z" },
      ],
      markers: [{ id: "suggestion", afterMessageId: "a" }],
    });

    expect(thread.map((entry) => entry.kind === "message" ? entry.message.id : entry.kind === "time" ? entry.label : entry.id)).toEqual([
      "09:00",
      "a",
      "suggestion",
      "15:30",
      "b",
    ]);
  });
});
