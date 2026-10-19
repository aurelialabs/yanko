import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter } from "./model-adapter";
import type { MemoryExtractionContext } from "./memory-extraction-data";
import {
  MemoryExtractionRuntimeError,
  runMemoryExtraction,
} from "./memory-extraction-runtime";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  message: "00000000-0000-4000-8000-000000000003",
  memory: "00000000-0000-4000-8000-000000000004",
  run: "00000000-0000-4000-8000-000000000005",
};

const context: MemoryExtractionContext = {
  userId: ids.user,
  roleId: ids.role,
  roleName: "林知夏",
  sourceMessageId: ids.message,
  sourceMessage: "以后我难过的时候，请先听我说完。",
  existingMemories: [],
};

function adapterWith(output: unknown): ModelAdapter {
  return {
    descriptor: {
      id: "memory-runtime-test",
      providerId: "local-test",
      modelId: "fixed-output",
      capabilities: ["structured-output"],
    },
    generate: vi.fn(),
    generateStructured: vi.fn(async (request) => ({
      providerId: "local-test",
      modelId: "fixed-output",
      requestId: "request-1",
      output: request.parse(output),
      latencyMs: 0,
    })),
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    action: "auto_write",
    scope: "role_private",
    roleId: ids.role,
    category: "agreement",
    content: "用户难过时希望先被倾听。",
    normalizedKey: "support_when_sad",
    sensitivity: "normal",
    confidence: 0.98,
    supersedesMemoryId: null,
    evidenceQuote: "请先听我说完",
    ...overrides,
  };
}

describe("runMemoryExtraction", () => {
  it("stays disabled unless a worker explicitly enables it", async () => {
    await expect(
      runMemoryExtraction(
        { context, idempotencyKey: "memory-request-001" },
        { adapter: adapterWith({ candidates: [] }) },
      ),
    ).rejects.toMatchObject({ code: "disabled" });
  });

  it("grounds candidates in an exact user quote and persists only policy operations", async () => {
    const persist = vi.fn(async (_context, _policy, _key, operations) => {
      expect(operations).toMatchObject([
        { action: "auto_write", reason: "normal_auto_write" },
      ]);
      return {
        runId: ids.run,
        candidateIds: [],
        memoryIds: [ids.memory],
        discardedCount: 0,
        replayed: false,
      };
    });

    const result = await runMemoryExtraction(
      { context, idempotencyKey: "memory-request-001", traceId: "safe-trace" },
      {
        enabled: true,
        adapter: adapterWith({ candidates: [candidate()] }),
        persist,
      },
    );

    expect(result.memoryIds).toEqual([ids.memory]);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("discards a model claim whose evidence is not an exact source quote", async () => {
    const persist = vi.fn(async (_context, _policy, _key, operations) => {
      expect(operations).toEqual([
        {
          candidateIndex: 0,
          action: "discard",
          reason: "missing_explicit_user_evidence",
          memory: null,
        },
      ]);
      return {
        runId: ids.run,
        candidateIds: [],
        memoryIds: [],
        discardedCount: 1,
        replayed: false,
      };
    });

    await runMemoryExtraction(
      { context, idempotencyKey: "memory-request-002" },
      {
        enabled: true,
        adapter: adapterWith({
          candidates: [candidate({ evidenceQuote: "用户没有说过的内容" })],
        }),
        persist,
      },
    );
  });

  it("keeps shared scope pending unless trusted server policy approves it", async () => {
    const persist = vi.fn(async (_context, _policy, _key, operations) => {
      expect(operations[0]).toMatchObject({
        action: "create_candidate",
        reason: "shared_scope_requires_confirmation",
        memory: { scope: "user_shared", roleId: null },
      });
      return {
        runId: ids.run,
        candidateIds: [ids.memory],
        memoryIds: [],
        discardedCount: 0,
        replayed: false,
      };
    });

    await runMemoryExtraction(
      { context, idempotencyKey: "memory-request-003" },
      {
        enabled: true,
        adapter: adapterWith({
          candidates: [
            candidate({
              scope: "user_shared",
              roleId: null,
              normalizedKey: "preferred_support",
            }),
          ],
        }),
        persist,
      },
    );
  });

  it("never persists forbidden content and does not expose raw model output", async () => {
    const persist = vi.fn(async (_context, _policy, _key, operations) => {
      expect(operations[0]).toMatchObject({
        action: "discard",
        reason: "forbidden_content",
        memory: null,
      });
      return {
        runId: ids.run,
        candidateIds: [],
        memoryIds: [],
        discardedCount: 1,
        replayed: false,
      };
    });

    const result = await runMemoryExtraction(
      { context, idempotencyKey: "memory-request-004" },
      {
        enabled: true,
        adapter: adapterWith({
          candidates: [
            candidate({
              action: "forbidden",
              category: "credential",
              sensitivity: "forbidden",
            }),
          ],
        }),
        persist,
      },
    );

    expect(result).not.toHaveProperty("output");
    expect(result).not.toHaveProperty("evidenceQuote");
  });

  it("maps invalid structured output to a safe unavailable error", async () => {
    await expect(
      runMemoryExtraction(
        { context, idempotencyKey: "memory-request-005" },
        {
          enabled: true,
          adapter: adapterWith({ raw: "not a valid extraction" }),
          persist: vi.fn(),
        },
      ),
    ).rejects.toEqual(new MemoryExtractionRuntimeError("extractor-unavailable"));
  });
});
