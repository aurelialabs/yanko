import "server-only";

import type { ModelAdapter } from "../model-adapter";
import { ModelAdapterError } from "../model-errors";
import type {
  ModelFinishReason,
  ModelGenerationRequest,
  ModelGenerationResponse,
  ModelStructuredRequest,
  ModelStructuredResponse,
  ModelUsage,
} from "../model-types";
import {
  MINIMAX_DEVELOPMENT_ADAPTER_ID,
  MINIMAX_PROVIDER_ID,
  type MiniMaxConfig,
} from "./minimax-config";

type FetchImplementation = typeof fetch;

type MiniMaxEnvelope = {
  id?: unknown;
  content?: unknown;
  stop_reason?: unknown;
  usage?: unknown;
};

function safeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function parseUsage(value: unknown): ModelUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const inputTokens = positiveInteger(record.input_tokens);
  const outputTokens = positiveInteger(record.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined,
  };
}

function finishReason(value: unknown): ModelFinishReason {
  switch (value) {
    case "end_turn":
    case "stop_sequence":
    case "stop":
      return "stop";
    case "max_tokens":
    case "length":
      return "length";
    case "content_filter":
    case "content-filter":
      return "content-filter";
    case "tool_use":
      return "tool-call";
    default:
      return "unknown";
  }
}

function extractResponseText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const text = content
    .flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return [];
      const record = block as Record<string, unknown>;
      // MiniMax may return reasoning/thinking blocks. They are deliberately
      // ignored and are never persisted or surfaced to the product.
      return record.type === "text" && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join("")
    .trim();
  return text || null;
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), 300_000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date)
    ? undefined
    : Math.min(Math.max(date - Date.now(), 0), 300_000);
}

function statusError(response: Response): ModelAdapterError {
  if (response.status === 401) {
    return new ModelAdapterError(
      "configuration",
      "MiniMax rejected the server credentials.",
    );
  }
  if (response.status === 403 || response.status === 400 || response.status === 422) {
    return new ModelAdapterError("rejected", "MiniMax rejected the request.");
  }
  if (response.status === 404) {
    return new ModelAdapterError("not-found", "The MiniMax model was not found.");
  }
  if (response.status === 429) {
    return new ModelAdapterError("rate-limited", "MiniMax rate limit reached.", {
      retryAfterMs: retryAfterMs(response),
    });
  }
  return new ModelAdapterError("unavailable", "MiniMax is temporarily unavailable.");
}

function requestBody(request: ModelGenerationRequest, config: MiniMaxConfig) {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const messages = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content);
  if (!messages.length) {
    throw new ModelAdapterError(
      "configuration",
      "A MiniMax request requires a user or assistant message.",
    );
  }

  const maxTokens = request.maxOutputTokens ?? 1_200;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8_192) {
    throw new ModelAdapterError(
      "configuration",
      "The MiniMax output token limit is invalid.",
    );
  }
  const temperature = request.temperature ?? config.temperature;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new ModelAdapterError(
      "configuration",
      "The MiniMax request temperature is invalid.",
    );
  }

  return {
    model: config.modelId,
    max_tokens: maxTokens,
    messages,
    ...(system ? { system } : {}),
    temperature,
  };
}

function decodeEnvelope(value: unknown): MiniMaxEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelAdapterError(
      "invalid-output",
      "MiniMax returned an invalid response.",
    );
  }
  return value as MiniMaxEnvelope;
}

function decodeStructuredJson(text: string, usage?: ModelUsage): unknown {
  let candidate = text.trim();
  const fenced = candidate.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/iu);
  if (fenced?.[1]) candidate = fenced[1].trim();

  try {
    return JSON.parse(candidate);
  } catch {
    throw new ModelAdapterError(
      "invalid-output",
      "MiniMax returned invalid structured output.",
      { usage },
    );
  }
}

export function createMiniMaxAdapter(
  config: MiniMaxConfig,
  fetchImplementation: FetchImplementation = fetch,
): ModelAdapter {
  return {
    descriptor: {
      id: MINIMAX_DEVELOPMENT_ADAPTER_ID,
      providerId: MINIMAX_PROVIDER_ID,
      modelId: config.modelId,
      capabilities: ["text-generation", "structured-output"],
    },

    async generate(request): Promise<ModelGenerationResponse> {
      if (request.signal?.aborted) {
        throw new ModelAdapterError("aborted", "The MiniMax request was aborted.");
      }
      const timeoutMs = request.timeoutMs ?? config.timeoutMs;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
        throw new ModelAdapterError(
          "configuration",
          "The MiniMax request timeout is invalid.",
        );
      }

      const controller = new AbortController();
      let timedOut = false;
      const externalAbort = () => controller.abort();
      request.signal?.addEventListener("abort", externalAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const startedAt = Date.now();

      try {
        const response = await fetchImplementation(config.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody(request, config)),
          signal: controller.signal,
        });
        if (!response.ok) throw statusError(response);

        let decoded: unknown;
        try {
          decoded = JSON.parse(await response.text());
        } catch {
          throw new ModelAdapterError(
            "invalid-output",
            "MiniMax returned an invalid response.",
          );
        }
        const envelope = decodeEnvelope(decoded);
        const normalizedFinishReason = finishReason(envelope.stop_reason);
        const usage = parseUsage(envelope.usage);
        const text = extractResponseText(envelope.content);
        if (!text) {
          throw new ModelAdapterError(
            normalizedFinishReason === "content-filter" ? "rejected" : "invalid-output",
            normalizedFinishReason === "content-filter"
              ? "MiniMax filtered the response."
              : "MiniMax returned an empty response.",
            { usage },
          );
        }

        return {
          providerId: MINIMAX_PROVIDER_ID,
          modelId: config.modelId,
          requestId:
            safeText(envelope.id) ??
            request.metadata?.traceId ??
            "minimax-request-unavailable",
          text,
          finishReason: normalizedFinishReason,
          latencyMs: Math.max(0, Date.now() - startedAt),
          usage,
        };
      } catch (error) {
        if (error instanceof ModelAdapterError) throw error;
        if (timedOut) {
          throw new ModelAdapterError("timeout", "The MiniMax request timed out.");
        }
        if (request.signal?.aborted) {
          throw new ModelAdapterError("aborted", "The MiniMax request was aborted.");
        }
        throw new ModelAdapterError(
          "unavailable",
          "MiniMax is temporarily unavailable.",
        );
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", externalAbort);
      }
    },

    async generateStructured<TOutput>(
      request: ModelStructuredRequest<TOutput>,
    ): Promise<ModelStructuredResponse<TOutput>> {
      const response = await this.generate(request);
      const decoded = decodeStructuredJson(response.text, response.usage);

      try {
        return {
          providerId: response.providerId,
          modelId: response.modelId,
          requestId: response.requestId,
          output: request.parse(decoded),
          latencyMs: response.latencyMs,
          usage: response.usage,
        };
      } catch {
        throw new ModelAdapterError(
          "invalid-output",
          "MiniMax returned invalid structured output.",
          { usage: response.usage },
        );
      }
    },
  };
}
