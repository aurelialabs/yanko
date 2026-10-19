import "server-only";

import { ModelAdapterError } from "./model-errors";
import type { ModelAdapter } from "./model-adapter";
import type {
  ModelGenerationRequest,
  ModelGenerationResponse,
  ModelStreamEvent,
  ModelStructuredRequest,
  ModelStructuredResponse,
} from "./model-types";

function assertRequestCanRun(request: ModelGenerationRequest): void {
  if (request.signal?.aborted) {
    throw new ModelAdapterError("aborted", "The model request was aborted.");
  }

  if (request.timeoutMs !== undefined && request.timeoutMs <= 0) {
    throw new ModelAdapterError("timeout", "The model request timed out.");
  }
}

function lastUserMessage(request: ModelGenerationRequest): string {
  const message = [...request.messages]
    .reverse()
    .find((candidate) => candidate.role === "user");

  return message?.content.trim() || "你好";
}

/**
 * Deterministic local implementation for unit tests and offline runner smoke
 * checks. It is intentionally never registered in the production registry.
 */
export const deterministicMockAdapter: ModelAdapter = {
  descriptor: {
    id: "local-deterministic-mock",
    providerId: "local-mock",
    modelId: "deterministic-v0",
    capabilities: ["text-generation", "text-streaming", "structured-output"],
  },

  async generate(request): Promise<ModelGenerationResponse> {
    assertRequestCanRun(request);
    const message = lastUserMessage(request);
    const text = `已收到：「${message}」。这是仅用于本地验证的模拟回复。`;

    return {
      providerId: "local-mock",
      modelId: "deterministic-v0",
      requestId: request.metadata?.traceId ?? "local-mock-request",
      text,
      finishReason: "stop",
      latencyMs: 0,
      usage: {
        inputTokens: request.messages.length,
        outputTokens: 1,
        totalTokens: request.messages.length + 1,
      },
    };
  },

  async generateStructured<TOutput>(
    request: ModelStructuredRequest<TOutput>,
  ): Promise<ModelStructuredResponse<TOutput>> {
    assertRequestCanRun(request);

    try {
      const output = request.parse({
        mock: true,
        outputName: request.outputName,
        input: lastUserMessage(request),
      });

      return {
        providerId: "local-mock",
        modelId: "deterministic-v0",
        requestId: request.metadata?.traceId ?? "local-mock-request",
        output,
        latencyMs: 0,
      };
    } catch (error) {
      throw new ModelAdapterError(
        "invalid-output",
        "Mock structured output was rejected.",
        {
          cause: error,
        },
      );
    }
  },

  async *stream(request): AsyncIterable<ModelStreamEvent> {
    const response = await this.generate(request);
    yield { type: "text-delta", text: response.text };
    yield { type: "complete", response };
  },
};
