import { describe, expect, it, vi } from "vitest";

import { getCandidateAdapterFailureDiagnostics } from "./candidate-adapter-error.mjs";
import { createMiniMaxAdapter, MINIMAX_ADAPTER_ID } from "./minimax.mjs";

const configuredEnv = {
  MINIMAX_AI_ENABLED: "true",
  MINIMAX_AI_BASE_URL: "https://api.minimax.cn/anthropic/v1/messages",
  MINIMAX_AI_API_KEY: "test-only-minimax-secret",
  MINIMAX_AI_MODEL: "MiniMax-M3",
  MINIMAX_AI_TEMPERATURE: "0.2",
  MINIMAX_AI_TIMEOUT_MS: "120000",
};

describe("miniMaxAdapter", () => {
  it("fails closed before a request when the server-only key is missing", () => {
    expect(() =>
      createMiniMaxAdapter({
        env: { ...configuredEnv, MINIMAX_AI_API_KEY: "" },
        fetchImpl: vi.fn(),
      }),
    ).toThrow("MINIMAX_AI_API_KEY is required.");
  });

  it("uses the Anthropic-compatible messages endpoint and strict v0.3 contract", async () => {
    const reasoningContent = "private MiniMax thinking";
    const rawOutput = {
      taskType: "plan_classification",
      intent: "none",
      sourceIntent: "NONE",
      scope: null,
      shouldShowCard: false,
      shouldAskBeforeCard: false,
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          { type: "thinking", thinking: reasoningContent },
          { type: "text", text: JSON.stringify(rawOutput) },
        ],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 88,
          output_tokens: 15,
        },
      }),
    }));
    const adapter = createMiniMaxAdapter({
      env: configuredEnv,
      fetchImpl,
      promptVersion: "yanxing-eval-v0.3",
    });

    const result = await adapter.evaluateCase({
      capability: "plan_classification",
      input: {
        taskType: "plan_classification",
        userMessage: "英语电影的配乐还挺好听的。",
      },
      expected: { intent: "create" },
      split: "dev",
    });

    expect(adapter.descriptor).toEqual({
      id: MINIMAX_ADAPTER_ID,
      providerId: "minimax",
      modelId: "MiniMax-M3",
    });
    expect(result.rawOutput).toEqual(rawOutput);
    expect(result.output).toEqual(rawOutput);
    expect(result.policyAdjustments).toEqual([]);
    expect(result.usage).toEqual({
      inputTokens: 88,
      outputTokens: 15,
      totalTokens: 103,
    });
    expect(JSON.stringify(result)).not.toContain(reasoningContent);

    const [url, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.minimax.cn/anthropic/v1/messages");
    expect(init.headers.Authorization).toBe("Bearer test-only-minimax-secret");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(body.model).toBe("MiniMax-M3");
    expect(body.max_tokens).toBe(1200);
    expect(body.temperature).toBe(0.2);
    expect(body.system).toContain("只输出一个合法 JSON 对象");
    expect(body).not.toHaveProperty("response_format");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).not.toContain("expected");
    expect(body.messages[0].content).not.toContain("split");
  });

  it("records only lengths for a reasoning-only response", async () => {
    const reasoningContent = "private reasoning must not enter the report";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "thinking", thinking: reasoningContent }],
        stop_reason: "max_tokens",
        usage: {
          input_tokens: 91,
          output_tokens: 1200,
        },
      }),
    }));
    const adapter = createMiniMaxAdapter({
      env: configuredEnv,
      fetchImpl,
      promptVersion: "yanxing-eval-v0.3",
    });

    try {
      await adapter.evaluateCase({
        capability: "safety_response",
        input: { taskType: "safety_response", userMessage: "合成安全样本" },
      });
      throw new Error("Expected the adapter request to fail.");
    } catch (error) {
      expect(error.message).toBe(
        "Candidate model returned an empty or unsupported response.",
      );
      const diagnostics = getCandidateAdapterFailureDiagnostics(error);
      expect(diagnostics).toEqual({
        latencyMs: expect.any(Number),
        usage: {
          inputTokens: 91,
          outputTokens: 1200,
          totalTokens: 1291,
        },
        response: {
          finishReason: "max_tokens",
          contentPresent: false,
          contentLength: 0,
          reasoningContentPresent: true,
          reasoningContentLength: reasoningContent.length,
        },
      });

      const serialized = JSON.stringify(diagnostics);
      expect(serialized).not.toContain(reasoningContent);
      expect(serialized).not.toContain(configuredEnv.MINIMAX_AI_API_KEY);
    }
  });

  it("does not expose a provider error body or credential", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "minimax-provider-secret-error",
    }));
    const adapter = createMiniMaxAdapter({
      env: configuredEnv,
      fetchImpl,
    });

    try {
      await adapter.evaluateCase({
        capability: "persona_response",
        input: { taskType: "persona_response", userMessage: "你好" },
      });
      throw new Error("Expected the adapter request to fail.");
    } catch (error) {
      expect(error.message).toBe("Candidate model request failed with HTTP 401.");
      expect(error.message).not.toContain("minimax-provider-secret-error");
      expect(error.message).not.toContain(configuredEnv.MINIMAX_AI_API_KEY);
    }
  });

  it("rejects unsafe endpoint URLs before making a request", () => {
    expect(() =>
      createMiniMaxAdapter({
        env: {
          ...configuredEnv,
          MINIMAX_AI_BASE_URL: "http://api.minimax.cn/anthropic/v1/messages?key=unsafe",
        },
        fetchImpl: vi.fn(),
      }),
    ).toThrow(
      "MINIMAX_AI_BASE_URL must be an HTTPS URL without credentials, query, or hash.",
    );
  });
});
