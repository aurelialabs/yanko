import { describe, expect, it, vi } from "vitest";

import {
  createModelContextMemoryRetriever,
  type ModelContextMemoryRetrievalRequest,
} from "./memory-context-retrieval";
import {
  MEMORY_EMBEDDING_DIMENSIONS,
  MemoryVectorError,
  type MemoryEmbeddingAdapter,
  type MemoryVectorStore,
  type RetrievedMemoryVector,
} from "./memory-vector";

const userId = "10000000-0000-4000-8000-000000000001";
const roleId = "20000000-0000-4000-8000-000000000002";
const queryVector = [1, ...Array<number>(MEMORY_EMBEDDING_DIMENSIONS - 1).fill(0)];

function request(
  overrides: Partial<ModelContextMemoryRetrievalRequest> = {},
): ModelContextMemoryRetrievalRequest {
  return {
    userId,
    roleId,
    query: "今天工作有点乱，陪我理一下。",
    maxResults: 5,
    includeSensitive: true,
    now: new Date("2026-09-07T00:00:00.000Z"),
    traceId: "30000000-0000-4000-8000-000000000003",
    ...overrides,
  };
}

function adapter(): MemoryEmbeddingAdapter {
  return {
    descriptor: {
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      dimensions: MEMORY_EMBEDDING_DIMENSIONS,
    },
    embed: vi.fn(async () => ({
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      vector: queryVector,
      latencyMs: 0,
    })),
  };
}

describe("createModelContextMemoryRetriever", () => {
  it("maps bounded vector matches to context memories and an ordered audit", async () => {
    const embeddingAdapter = adapter();
    const store: MemoryVectorStore = {
      save: vi.fn(),
      search: vi.fn(async (): Promise<RetrievedMemoryVector[]> => [
        {
          memoryId: "40000000-0000-4000-8000-000000000004",
          scope: "role_private",
          roleId,
          category: "support_preference",
          content: "用户希望先被完整倾听。",
          sensitivity: "normal",
          confirmedByUser: true,
          similarity: 0.94,
        },
        {
          memoryId: "50000000-0000-4000-8000-000000000005",
          scope: "user_shared",
          roleId: null,
          category: "sensitive_context",
          content: "用户已确认的一条直接相关敏感记忆。",
          sensitivity: "sensitive",
          confirmedByUser: true,
          similarity: 0.89,
        },
      ]),
    };

    const result = await createModelContextMemoryRetriever({
      adapter: embeddingAdapter,
      store,
    }).retrieve(request());

    expect(embeddingAdapter.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "今天工作有点乱，陪我理一下。",
        purpose: "memory_query",
      }),
    );
    expect(result.memories).toEqual([
      expect.objectContaining({
        id: "40000000-0000-4000-8000-000000000004",
        roleId,
        status: "active",
      }),
      expect.objectContaining({
        id: "50000000-0000-4000-8000-000000000005",
        roleId: null,
        sensitivity: "sensitive",
      }),
    ]);
    expect(result.directlyRelevantSensitiveMemoryIds).toEqual([
      "50000000-0000-4000-8000-000000000005",
    ]);
    expect(result.audit).toEqual({
      embeddingProvider: "local-fixed",
      embeddingModel: "deterministic-1536-v1",
      sensitiveRetrievalAuthorized: true,
      matches: [
        {
          memoryId: "40000000-0000-4000-8000-000000000004",
          retrievalRank: 1,
          similarity: 0.94,
        },
        {
          memoryId: "50000000-0000-4000-8000-000000000005",
          retrievalRank: 2,
          similarity: 0.89,
        },
      ],
    });
  });

  it("fails closed when a store returns another role's private memory", async () => {
    const store: MemoryVectorStore = {
      save: vi.fn(),
      search: vi.fn(async (): Promise<RetrievedMemoryVector[]> => [
        {
          memoryId: "60000000-0000-4000-8000-000000000006",
          scope: "role_private",
          roleId: "70000000-0000-4000-8000-000000000007",
          category: "invalid_scope",
          content: "另一角色的记忆不得进入当前上下文。",
          sensitivity: "normal",
          confirmedByUser: true,
          similarity: 0.99,
        },
      ]),
    };

    await expect(
      createModelContextMemoryRetriever({ adapter: adapter(), store }).retrieve(
        request(),
      ),
    ).rejects.toEqual(new MemoryVectorError("retrieval-unavailable"));
  });
});
