import { describe, expect, it } from "vitest";

import { deterministicMockAdapter } from "./mock-adapter";
import { ModelRegistry } from "./model-registry";

describe("ModelRegistry", () => {
  it("has no implicit production model", () => {
    const registry = new ModelRegistry();

    expect(registry.list()).toEqual([]);
    expect(() => registry.require("unconfigured")).toThrow(
      'No model adapter is registered for "unconfigured".',
    );
  });

  it("registers explicit adapters once and keeps their public descriptor", () => {
    const registry = new ModelRegistry();
    registry.register(deterministicMockAdapter);

    expect(registry.require("local-deterministic-mock")).toBe(deterministicMockAdapter);
    expect(registry.list()).toEqual([deterministicMockAdapter.descriptor]);
    expect(() => registry.register(deterministicMockAdapter)).toThrow(
      'A model adapter is already registered for "local-deterministic-mock".',
    );
  });
});
