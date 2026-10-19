import { describe, expect, it, vi } from "vitest";

import { DETERMINISTIC_HIGH_RISK_RESPONSE } from "./chat-safety";
import { buildDemoChatRequest, generateDemoChatReply } from "./demo-chat";
import type { ModelAdapter } from "./model-adapter";

const adapter = {
  generate: vi.fn(async () => ({
    providerId: "minimax",
    modelId: "MiniMax-M3",
    requestId: "test",
    text: "实习累的话，先不用马上振作。你想先说说今天哪一段最耗你吗？",
    finishReason: "stop" as const,
    latencyMs: 10,
  })),
} as unknown as ModelAdapter;

describe("demo chat", () => {
  it("asks the model to answer the latest user message in character", () => {
    const request = buildDemoChatRequest({
      templateKey: "lin_zhixia",
      messages: [
        { sender: "user", content: "实习好累啊" },
        { sender: "assistant", content: "我在。" },
        { sender: "user", content: "可以安慰一下我吗" },
      ],
    });

    expect("messages" in request).toBe(true);
    if (!("messages" in request)) return;
    expect(request.messages[0]?.content).toContain("林知夏");
    expect(request.messages[0]?.content).toContain("先接住情绪");
    expect(request.messages.at(-1)).toEqual({
      role: "user",
      content: "可以安慰一下我吗",
    });
  });

  it("gives the model only confirmed memories and tells it not to invent the rest", () => {
    const request = buildDemoChatRequest({
      templateKey: "lin_zhixia",
      memories: [
        { id: "memory-portfolio", category: "长期目标", content: "希望十月前完成作品集" },
      ],
      messages: [{ sender: "user", content: "今天先做什么" }],
    });

    expect("messages" in request).toBe(true);
    if (!("messages" in request)) return;
    expect(request.messages[1]?.content).toContain("已确认的用户记忆");
    expect(request.messages[1]?.content).toContain("希望十月前完成作品集");
    expect(request.messages[1]?.content).toContain("没有依据时不要说自己记得");
  });

  it("returns the model reply for an ordinary message", async () => {
    const result = await generateDemoChatReply(
      {
        templateKey: "lin_zhixia",
        messages: [{ sender: "user", content: "实习好累啊，可以安慰一下我吗" }],
      },
      adapter,
    );

    expect(result).toEqual({
      reply: "实习累的话，先不用马上振作。你想先说说今天哪一段最耗你吗？",
    });
  });

  it("does not call the model for an explicit safety risk", async () => {
    const generate = vi.fn();
    const result = await generateDemoChatReply(
      {
        templateKey: "zhou_yuan",
        messages: [{ sender: "user", content: "我想自杀" }],
      },
      { generate } as unknown as ModelAdapter,
    );

    expect(generate).not.toHaveBeenCalled();
    expect(result).toEqual({ reply: DETERMINISTIC_HIGH_RISK_RESPONSE });
  });
});
