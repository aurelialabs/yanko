import { describe, expect, it, vi } from "vitest";

import { createDeepSeekAdapter, DEEPSEEK_ADAPTER_ID } from "./deepseek.mjs";
import { getCandidateAdapterFailureDiagnostics } from "./openai-compatible.mjs";

const configuredEnv = {
  DEEPSEEK_AI_ENABLED: "true",
  DEEPSEEK_AI_BASE_URL: "https://api.deepseek.com",
  DEEPSEEK_AI_API_KEY: "test-only-deepseek-secret",
  DEEPSEEK_AI_MODEL: "deepseek-v4-flash",
  DEEPSEEK_AI_TEMPERATURE: "0.2",
  DEEPSEEK_AI_TIMEOUT_MS: "120000",
};

describe("deepSeekAdapter", () => {
  it("fails closed before a request when the server-only key is missing", () => {
    expect(() =>
      createDeepSeekAdapter({
        env: { ...configuredEnv, DEEPSEEK_AI_API_KEY: "" },
        fetchImpl: vi.fn(),
      }),
    ).toThrow("DEEPSEEK_AI_API_KEY is required.");
  });

  it("uses the OpenAI-compatible endpoint and the same v0.3 contract", async () => {
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
        choices: [
          {
            message: { content: JSON.stringify(rawOutput) },
          },
        ],
        usage: {
          prompt_tokens: 88,
          completion_tokens: 15,
          total_tokens: 103,
        },
      }),
    }));
    const adapter = createDeepSeekAdapter({
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
      id: DEEPSEEK_ADAPTER_ID,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    });
    expect(result.rawOutput).toEqual(rawOutput);
    expect(result.output).toEqual(rawOutput);
    expect(result.policyAdjustments).toEqual([]);
    expect(result.usage).toEqual({
      inputTokens: 88,
      outputTokens: 15,
      totalTokens: 103,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-only-deepseek-secret");
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.temperature).toBe(0.2);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).not.toContain("expected");
    expect(body.messages[1].content).not.toContain("split");
  });

  it("does not expose a provider error body or credential", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "deepseek-provider-secret-error",
    }));
    const adapter = createDeepSeekAdapter({
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
      expect(error.message).not.toContain("deepseek-provider-secret-error");
      expect(error.message).not.toContain("test-only-deepseek-secret");
    }
  });

  it("records only safe metadata for an empty reasoning-only response", async () => {
    const reasoningContent = "private reasoning must never enter the report";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            finish_reason: "length",
            message: {
              content: null,
              reasoning_content: reasoningContent,
            },
          },
        ],
        usage: {
          prompt_tokens: 91,
          completion_tokens: 1200,
          total_tokens: 1291,
        },
      }),
    }));
    const adapter = createDeepSeekAdapter({
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
          finishReason: "length",
          contentPresent: false,
          contentLength: 0,
          reasoningContentPresent: true,
          reasoningContentLength: reasoningContent.length,
        },
      });

      const serialized = JSON.stringify(diagnostics);
      expect(serialized).not.toContain(reasoningContent);
      expect(serialized).not.toContain(configuredEnv.DEEPSEEK_AI_API_KEY);
    }
  });

  it("rejects unsafe base URLs before making a request", () => {
    expect(() =>
      createDeepSeekAdapter({
        env: {
          ...configuredEnv,
          DEEPSEEK_AI_BASE_URL: "http://api.deepseek.com?key=unsafe",
        },
        fetchImpl: vi.fn(),
      }),
    ).toThrow(
      "DEEPSEEK_AI_BASE_URL must be an HTTPS URL without credentials, query, or hash.",
    );
  });
});
