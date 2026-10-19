import "server-only";

import type {
  ModelAdapterDescriptor,
  ModelGenerationRequest,
  ModelGenerationResponse,
  ModelStreamEvent,
  ModelStructuredRequest,
  ModelStructuredResponse,
} from "./model-types";

/**
 * The only model-facing interface allowed to be used by product server code.
 * Concrete provider implementations belong behind this contract and must not
 * be imported from React components or client bundles.
 */
export interface ModelAdapter {
  readonly descriptor: ModelAdapterDescriptor;

  generate(request: ModelGenerationRequest): Promise<ModelGenerationResponse>;

  generateStructured<TOutput>(
    request: ModelStructuredRequest<TOutput>,
  ): Promise<ModelStructuredResponse<TOutput>>;

  stream?(request: ModelGenerationRequest): AsyncIterable<ModelStreamEvent>;
}
