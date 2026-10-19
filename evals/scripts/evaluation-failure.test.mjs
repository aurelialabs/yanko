import { describe, expect, it, vi } from "vitest";

import { createDeepSeekAdapter } from "../adapters/deepseek.mjs";
import { createEvaluationFailureFields } from "./evaluation-failure.mjs";

const configuredEnv = {
  DEEPSEEK_AI_ENABLED: "true",
  DEEPSEEK_AI_BASE_URL: "https://api.deepseek.com",
  DEEPSEEK_AI_API_KEY: "test-only-runner-secret",
  DEEPSEEK_AI_MODEL: "deepseek-v4-flash",
  DEEPSEEK_AI_TEMPERATURE: "0.2",
  DEEPSEEK_AI_TIMEOUT_MS: "120000",
};

describe("createEvaluationFailureFields", () => {
  it("writes safe response diagnostics and parsed raw output for strict failures", async () => {
    const reasoningContent = "provider reasoning must not be persisted";
    const rawOutput = {
      taskType: "plan_classification",
      intent: "none",
      sourceIntent: "NONE",
      scope: "null",
      shouldShowCard: false,
      shouldAskBeforeCard: false,
    };
    const content = JSON.stringify(rawOutput);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content,
              reasoning_content: reasoningContent,
            },
          },
        ],
        usage: {
          prompt_tokens: 73,
          completion_tokens: 24,
          total_tokens: 97,
        },
      }),
    }));
    const adapter = createDeepSeekAdapter({
      env: configuredEnv,
      fetchImpl,
      promptVersion: "yanxing-eval-v0.3",
    });

    let failure;
    try {
      await adapter.evaluateCase({
        capability: "plan_classification",
        input: {
          taskType: "plan_classification",
          userMessage: "普通聊天",
        },
      });
    } catch (error) {
      failure = error;
    }

    const fields = createEvaluationFailureFields(failure);
    expect(fields).toEqual({
      latencyMs: expect.any(Number),
      usage: {
        inputTokens: 73,
        outputTokens: 24,
        totalTokens: 97,
      },
      responseDiagnostics: {
        finishReason: "stop",
        contentPresent: true,
        contentLength: content.length,
        reasoningContentPresent: true,
        reasoningContentLength: reasoningContent.length,
      },
      rawOutput,
      output: null,
      score: null,
      error: "plan_classification output failed strict schema validation.",
    });

    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain(reasoningContent);
    expect(serialized).not.toContain(configuredEnv.DEEPSEEK_AI_API_KEY);
  });

  it("does not trust diagnostic-looking fields from ordinary errors", () => {
    const error = new Error("Ordinary adapter failure.");
    error.evaluationDiagnostics = {
      latencyMs: 1,
      rawOutput: { leaked: true },
    };

    expect(createEvaluationFailureFields(error)).toEqual({
      latencyMs: null,
      usage: null,
      output: null,
      score: null,
      error: "Ordinary adapter failure.",
    });
  });
});
