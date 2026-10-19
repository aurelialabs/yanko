import { describe, expect, it } from "vitest";

import { readAiChatRuntimeMode } from "./runtime-config";

describe("readAiChatRuntimeMode", () => {
  it("defaults to the explicit local Mock mode", () => {
    expect(readAiChatRuntimeMode({})).toBe("mock");
  });

  it("accepts only the development MiniMax mode", () => {
    expect(readAiChatRuntimeMode({ AI_CHAT_RUNTIME_MODE: "minimax-development" })).toBe(
      "minimax-development",
    );
    expect(readAiChatRuntimeMode({ AI_CHAT_RUNTIME_MODE: "production" })).toBeNull();
  });
});
