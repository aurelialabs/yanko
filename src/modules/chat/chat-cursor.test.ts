import { describe, expect, it } from "vitest";

import { decodeChatHistoryCursor, encodeChatHistoryCursor } from "./chat-cursor";

describe("chat history cursor", () => {
  it("round-trips the created_at and id tuple", () => {
    const payload = {
      createdAt: "2026-09-02T10:20:30.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    };
    expect(decodeChatHistoryCursor(encodeChatHistoryCursor(payload))).toEqual(payload);
  });

  it("rejects malformed, non-UUID, and invalid-time cursors", () => {
    expect(decodeChatHistoryCursor("not-base64-json")).toBeNull();
    expect(
      decodeChatHistoryCursor(
        Buffer.from(
          JSON.stringify({ createdAt: "not-a-time", id: "not-a-uuid" }),
        ).toString("base64url"),
      ),
    ).toBeNull();
  });
});
