import "server-only";

import type { ModelUsage } from "./model-types";

export type ModelErrorCode =
  | "aborted"
  | "configuration"
  | "invalid-output"
  | "not-found"
  | "rate-limited"
  | "rejected"
  | "timeout"
  | "unavailable";

/**
 * A provider-neutral error that can be handled by a feature without importing
 * a provider SDK. Its message is intentionally safe for logs, but user-facing
 * copy should be selected by the calling feature instead of exposing it.
 */
export class ModelAdapterError extends Error {
  readonly code: ModelErrorCode;
  readonly retryAfterMs?: number;
  readonly usage?: ModelUsage;

  constructor(
    code: ModelErrorCode,
    message: string,
    options?: {
      cause?: unknown;
      retryAfterMs?: number;
      usage?: ModelUsage;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ModelAdapterError";
    this.code = code;
    this.retryAfterMs = options?.retryAfterMs;
    this.usage = options?.usage;
  }
}

export function isModelAdapterError(error: unknown): error is ModelAdapterError {
  return error instanceof ModelAdapterError;
}
