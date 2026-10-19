import { describe, expect, it } from "vitest";

import { ModelContextError, buildModelContext } from "./context-builder";

const baseSources = {
  roleId: "11111111-1111-4111-8111-111111111111",
  personaVersionId: "22222222-2222-4222-8222-222222222222",
  strategyVersionId: "33333333-3333-4333-8333-333333333333",
  compiledSystemPrompt: "你是林知夏。保持温柔、清晰的边界，不虚构用户事实。",
  messages: [
    {
      id: "message-1",
      sender: "user" as const,
      content: "我今天有点焦虑。",
      status: "completed" as const,
    },
    {
      id: "message-2",
      sender: "assistant" as const,
      content: "我在，先和你一起慢慢理一下。",
      status: "completed" as const,
    },
  ],
  memories: [
    {
      id: "shared-memory",
      scope: "user_shared" as const,
      roleId: null,
      category: "偏好",
      content: "用户偏好简洁的建议。",
      sensitivity: "normal" as const,
      status: "active" as const,
      confirmedByUser: true,
    },
    {
      id: "private-memory",
      scope: "role_private" as const,
      roleId: "11111111-1111-4111-8111-111111111111",
      category: "共同约定",
      content: "用户喜欢先被倾听，再讨论方案。",
      sensitivity: "sensitive" as const,
      status: "active" as const,
      confirmedByUser: true,
    },
    {
      id: "other-role-memory",
      scope: "role_private" as const,
      roleId: "44444444-4444-4444-8444-444444444444",
      category: "错误隔离样本",
      content: "这条记忆绝不能进入当前角色。",
      sensitivity: "normal" as const,
      status: "active" as const,
      confirmedByUser: true,
    },
  ],
  directlyRelevantSensitiveMemoryIds: ["private-memory"],
  summary: {
    throughMessageId: "message-0",
    content: "用户希望在九月前完成作品集。",
  },
};

describe("buildModelContext", () => {
  it("keeps persona, same-role memories, summary, and recent turns in a bounded context", () => {
    const context = buildModelContext(baseSources, {
      maxInputTokens: 800,
      responseReserveTokens: 100,
    });

    expect(context.messages).toEqual([
      { role: "system", content: baseSources.compiledSystemPrompt },
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("shared-memory"),
      }),
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("作品集"),
      }),
      { role: "user", content: "我今天有点焦虑。" },
      { role: "assistant", content: "我在，先和你一起慢慢理一下。" },
    ]);
    expect(context.includedMemoryIds).toEqual(["shared-memory", "private-memory"]);
    expect(context.includedMemoryIds).not.toContain("other-role-memory");
    expect(context.includedMessageIds).toEqual(["message-1", "message-2"]);
    expect(context.summaryThroughMessageId).toBe("message-0");
    expect(context.estimatedInputTokens).toBeLessThanOrEqual(
      context.availableInputTokens,
    );
  });

  it("fails closed instead of dropping an oversized latest turn", () => {
    expect(() =>
      buildModelContext(
        {
          ...baseSources,
          compiledSystemPrompt: "边界。",
          messages: [
            {
              id: "oversized-latest",
              sender: "user",
              content: "很长".repeat(100),
              status: "completed",
            },
          ],
          memories: [],
          summary: null,
        },
        { maxInputTokens: 30, responseReserveTokens: 0 },
      ),
    ).toThrow(expect.objectContaining({ code: "latest-message-too-long" }));
  });

  it("does not put pending messages or unconfirmed sensitive memories into a prompt", () => {
    const context = buildModelContext({
      ...baseSources,
      messages: [
        ...baseSources.messages,
        {
          id: "pending-message",
          sender: "user",
          content: "这条还没有成功发送。",
          status: "pending",
        },
      ],
      memories: [
        ...baseSources.memories,
        {
          id: "unconfirmed-sensitive",
          scope: "user_shared",
          roleId: null,
          category: "敏感信息",
          content: "未经确认的内容。",
          sensitivity: "sensitive",
          status: "active",
          confirmedByUser: false,
        },
      ],
      directlyRelevantSensitiveMemoryIds: [],
    });

    expect(context.includedMessageIds).not.toContain("pending-message");
    expect(context.includedMemoryIds).not.toContain("unconfirmed-sensitive");
  });

  it("keeps even confirmed sensitive memories out until the retrieval stage marks them relevant", () => {
    const context = buildModelContext({
      ...baseSources,
      directlyRelevantSensitiveMemoryIds: [],
    });

    expect(context.includedMemoryIds).toEqual(["shared-memory"]);
    expect(context.includedMemoryIds).not.toContain("private-memory");
  });

  it("exposes a typed error for an invalid budget", () => {
    try {
      buildModelContext(baseSources, {
        maxInputTokens: 100,
        responseReserveTokens: 100,
      });
      throw new Error("Expected context construction to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelContextError);
      expect((error as ModelContextError).code).toBe("invalid-budget");
    }
  });
});
