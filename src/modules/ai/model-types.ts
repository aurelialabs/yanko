import "server-only";

/**
 * Provider-neutral contracts for the server-side model boundary.
 *
 * Business modules should exchange only these types. A provider SDK, model
 * name, or API credential must never cross this boundary into the client.
 */

export type ModelCapability =
  "text-generation" | "text-streaming" | "structured-output";

export type ModelMessageRole = "system" | "user" | "assistant";

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  estimatedCostUsd?: number;
}

export type ModelFinishReason =
  "stop" | "length" | "content-filter" | "tool-call" | "unknown";

/**
 * Safe, non-content metadata for tracing, evaluation, and policy selection.
 * Do not place an email address, message body, access token, or credential in
 * this object: adapter integrations may record it in operational telemetry.
 */
export interface ModelRequestMetadata {
  evalCaseId?: string;
  feature?:
    | "chat"
    | "ooc-check"
    | "plan-extraction"
    | "memory"
    | "emotion-signal"
    | "evaluation";
  policyVersion?: string;
  promptVersion?: string;
  traceId?: string;
}

export interface ModelGenerationRequest {
  messages: readonly ModelMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  metadata?: ModelRequestMetadata;
}

export interface ModelResponseIdentity {
  providerId: string;
  modelId: string;
  requestId: string;
}

export interface ModelGenerationResponse extends ModelResponseIdentity {
  text: string;
  finishReason: ModelFinishReason;
  latencyMs: number;
  usage?: ModelUsage;
}

export interface ModelStructuredRequest<TOutput> extends ModelGenerationRequest {
  /** A stable name used by evaluation and observability, not a provider schema. */
  outputName: string;
  /**
   * Validate the decoded JSON returned by an adapter. This keeps validation in
   * the calling server module and avoids coupling the common contract to one
   * validation library.
   */
  parse: (value: unknown) => TOutput;
}

export interface ModelStructuredResponse<TOutput> extends ModelResponseIdentity {
  output: TOutput;
  latencyMs: number;
  usage?: ModelUsage;
}

export type ModelStreamEvent =
  | {
      type: "text-delta";
      text: string;
    }
  | {
      type: "complete";
      response: ModelGenerationResponse;
    };

export interface ModelAdapterDescriptor {
  /** Stable registry key, such as "provider-a-primary". Never use a secret. */
  id: string;
  providerId: string;
  modelId: string;
  capabilities: readonly ModelCapability[];
}
