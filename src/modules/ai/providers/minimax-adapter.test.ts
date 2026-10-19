import { describe, expect, it, vi } from "vitest";

import { ModelAdapterError } from "../model-errors";
import { createMiniMaxAdapter } from "./minimax-adapter";
import {
  MINIMAX_DEVELOPMENT_MODEL_ID,
  readMiniMaxConfig,
  type MiniMaxConfig,
} from "./minimax-config";

const config: MiniMaxConfig = {
  apiKey: "test-secret-that-must-not-leak",
  endpoint: "https://api.minimax.cn/anthropic/v1/messages",
  modelId: MINIMAX_DEVELOPMENT_MODEL_ID,
  temperature: 0.2,
  timeoutMs: 1_000,
};

const request = {
  messages: [
    { role: "system" as const, content: "系统人设" },
    { role: "user" as const, content: "你好" },
  ],
  metadata: { traceId: "trace-for-test" },
};

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("readMiniMaxConfig", () => {
  it("reads the fixed development model without exposing a browser setting", () => {
    expect(
      readMiniMaxConfig({
        MINIMAX_AI_ENABLED: "true",
        MINIMAX_AI_API_KEY: "server-key",
      }),
    ).toMatchObject({
      apiKey: "server-key",
      modelId: "MiniMax-M3",
      temperature: 0.2,
      timeoutMs: 120_000,
    });
  });

  it.each([
    [{ MINIMAX_AI_ENABLED: "false", MINIMAX_AI_API_KEY: "key" }],
    [{ MINIMAX_AI_ENABLED: "true" }],
    [
      {
        MINIMAX_AI_ENABLED: "true",
        MINIMAX_AI_API_KEY: "key",
        MINIMAX_AI_BASE_URL: "http://api.minimax.cn/v1/messages",
      },
    ],
    [
      {
        MINIMAX_AI_ENABLED: "true",
        MINIMAX_AI_API_KEY: "key",
        MINIMAX_AI_MODEL: "another-model",
      },
    ],
  ])("fails closed for invalid server configuration", (environment) => {
    expect(() => readMiniMaxConfig(environment)).toThrow(ModelAdapterError);
  });
});

describe("MiniMax adapter", () => {
  it("generates text while ignoring reasoning blocks", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: "request-1",
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: " 我在这里。 " },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
    );
    const adapter = createMiniMaxAdapter(config, fetchMock);

    await expect(adapter.generate(request)).resolves.toMatchObject({
      providerId: "minimax",
      modelId: "MiniMax-M3",
      requestId: "request-1",
      text: "我在这里。",
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    });
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-secret-that-must-not-leak",
    });
    expect(body).toMatchObject({
      model: "MiniMax-M3",
      system: "系统人设",
      messages: [{ role: "user", content: "你好" }],
    });
  });

  it("parses and validates structured JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        content: [{ type: "text", text: '{"verdict":"pass"}' }],
        stop_reason: "end_turn",
      }),
    );
    const adapter = createMiniMaxAdapter(config, fetchMock);

    await expect(
      adapter.generateStructured({
        ...request,
        outputName: "test-verdict",
        parse(value) {
          const verdict = (value as { verdict?: unknown }).verdict;
          if (verdict !== "pass") throw new Error("invalid");
          return { verdict };
        },
      }),
    ).resolves.toMatchObject({ output: { verdict: "pass" } });
  });

  it("accepts one complete JSON fence but rejects surrounding prose", async () => {
    const fenced = createMiniMaxAdapter(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          content: [
            {
              type: "text",
              text: '```json\n{"verdict":"pass"}\n```',
            },
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 20, output_tokens: 5 },
        }),
      ),
    );
    const withProse = createMiniMaxAdapter(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          content: [
            {
              type: "text",
              text: '结果如下：\n```json\n{"verdict":"pass"}\n```',
            },
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 20, output_tokens: 5 },
        }),
      ),
    );
    const structuredRequest = {
      ...request,
      outputName: "test-verdict",
      parse(value: unknown) {
        const verdict = (value as { verdict?: unknown }).verdict;
        if (verdict !== "pass") throw new Error("invalid");
        return { verdict };
      },
    };

    await expect(fenced.generateStructured(structuredRequest)).resolves.toMatchObject({
      output: { verdict: "pass" },
    });
    await expect(withProse.generateStructured(structuredRequest)).rejects.toMatchObject(
      {
        code: "invalid-output",
        usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
      },
    );
  });

  it("maps a rate limit without reading its response body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("sensitive provider body", {
        status: 429,
        headers: { "retry-after": "2" },
      }),
    );
    const adapter = createMiniMaxAdapter(config, fetchMock);

    const error = await adapter.generate(request).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ModelAdapterError);
    expect(error).toMatchObject({ code: "rate-limited", retryAfterMs: 2_000 });
    expect(String(error)).not.toContain("sensitive provider body");
    expect(String(error)).not.toContain(config.apiKey);
  });

  it("maps provider failures to a generic unavailable error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("stack and private provider details", { status: 503 }),
      );
    const adapter = createMiniMaxAdapter(config, fetchMock);

    const error = await adapter.generate(request).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "unavailable" });
    expect(String(error)).not.toContain("private provider details");
  });

  it("fails closed for invalid, empty, or invalid structured output", async () => {
    const invalidJson = createMiniMaxAdapter(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json")),
    );
    const empty = createMiniMaxAdapter(
      config,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ content: [{ type: "text", text: " " }] })),
    );
    const invalidStructured = createMiniMaxAdapter(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          content: [{ type: "text", text: "not structured JSON" }],
        }),
      ),
    );

    await expect(invalidJson.generate(request)).rejects.toMatchObject({
      code: "invalid-output",
    });
    await expect(empty.generate(request)).rejects.toMatchObject({
      code: "invalid-output",
    });
    await expect(
      invalidStructured.generateStructured({
        ...request,
        outputName: "invalid",
        parse: (value) => value,
      }),
    ).rejects.toMatchObject({ code: "invalid-output" });
  });

  it("aborts requests at the configured request timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const adapter = createMiniMaxAdapter(config, fetchMock);

    await expect(adapter.generate({ ...request, timeoutMs: 5 })).rejects.toMatchObject({
      code: "timeout",
    });
  });
});
