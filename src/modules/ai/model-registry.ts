import "server-only";

import { ModelAdapterError } from "./model-errors";
import type { ModelAdapter } from "./model-adapter";
import type { ModelAdapterDescriptor } from "./model-types";

/**
 * Explicit, empty-by-default registry for server startup wiring.
 *
 * There is deliberately no default production model. The product can register
 * approved candidates after privacy review and then run the frozen evaluation
 * set before one is chosen for a feature policy.
 */
export class ModelRegistry {
  private readonly adapters = new Map<string, ModelAdapter>();

  register(adapter: ModelAdapter): void {
    const id = adapter.descriptor.id.trim();

    if (!id) {
      throw new ModelAdapterError(
        "configuration",
        "Model adapter IDs must not be empty.",
      );
    }

    if (this.adapters.has(id)) {
      throw new ModelAdapterError(
        "configuration",
        `A model adapter is already registered for "${id}".`,
      );
    }

    this.adapters.set(id, adapter);
  }

  get(id: string): ModelAdapter | undefined {
    return this.adapters.get(id);
  }

  require(id: string): ModelAdapter {
    const adapter = this.get(id);

    if (!adapter) {
      throw new ModelAdapterError(
        "not-found",
        `No model adapter is registered for "${id}".`,
      );
    }

    return adapter;
  }

  list(): readonly ModelAdapterDescriptor[] {
    return [...this.adapters.values()].map((adapter) => adapter.descriptor);
  }
}

export const modelRegistry = new ModelRegistry();
