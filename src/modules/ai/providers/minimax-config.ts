import "server-only";

import { ModelAdapterError } from "../model-errors";

export const MINIMAX_PROVIDER_ID = "minimax";
export const MINIMAX_DEVELOPMENT_MODEL_ID = "MiniMax-M3";
export const MINIMAX_DEVELOPMENT_ADAPTER_ID = "minimax-m3-development";
export const MINIMAX_DEFAULT_ENDPOINT = "https://api.minimax.cn/anthropic/v1/messages";

export interface MiniMaxConfig {
  apiKey: string;
  endpoint: string;
  modelId: typeof MINIMAX_DEVELOPMENT_MODEL_ID;
  temperature: number;
  timeoutMs: number;
}

interface MiniMaxEnvironment {
  [key: string]: string | undefined;
  MINIMAX_AI_ENABLED?: string;
  MINIMAX_AI_BASE_URL?: string;
  MINIMAX_AI_API_KEY?: string;
  MINIMAX_AI_MODEL?: string;
  MINIMAX_AI_TEMPERATURE?: string;
  MINIMAX_AI_TIMEOUT_MS?: string;
}

function configurationError(message: string): ModelAdapterError {
  return new ModelAdapterError("configuration", message);
}

function parseFiniteNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw configurationError(`Invalid MiniMax ${label} configuration.`);
  }
  return parsed;
}

/**
 * Reads only server-side MiniMax settings. The API key is intentionally kept
 * inside this DTO and must never be returned by a Server Action or Client
 * Component.
 */
export function readMiniMaxConfig(
  environment: MiniMaxEnvironment = process.env,
): MiniMaxConfig {
  if (environment.MINIMAX_AI_ENABLED?.trim().toLowerCase() !== "true") {
    throw configurationError("MiniMax development runtime is not enabled.");
  }

  const apiKey = environment.MINIMAX_AI_API_KEY?.trim();
  if (!apiKey) {
    throw configurationError("MiniMax server credentials are not configured.");
  }

  const modelId = environment.MINIMAX_AI_MODEL?.trim() || MINIMAX_DEVELOPMENT_MODEL_ID;
  if (modelId !== MINIMAX_DEVELOPMENT_MODEL_ID) {
    throw configurationError("The selected MiniMax development model is invalid.");
  }

  const endpointValue =
    environment.MINIMAX_AI_BASE_URL?.trim() || MINIMAX_DEFAULT_ENDPOINT;
  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw configurationError("The MiniMax endpoint is invalid.");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw configurationError("The MiniMax endpoint must be a safe HTTPS URL.");
  }

  const temperature = parseFiniteNumber(
    environment.MINIMAX_AI_TEMPERATURE,
    0.2,
    0,
    2,
    "temperature",
  );
  const timeoutMs = parseFiniteNumber(
    environment.MINIMAX_AI_TIMEOUT_MS,
    120_000,
    1_000,
    300_000,
    "timeout",
  );
  if (!Number.isInteger(timeoutMs)) {
    throw configurationError("Invalid MiniMax timeout configuration.");
  }

  return {
    apiKey,
    endpoint: endpoint.toString(),
    modelId: MINIMAX_DEVELOPMENT_MODEL_ID,
    temperature,
    timeoutMs,
  };
}
