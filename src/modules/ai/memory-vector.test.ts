import { describe, expect, it, vi } from "vitest";

import {
  MEMORY_EMBEDDING_DIMENSIONS,
  MEMORY_RETRIEVAL_DEFAULT_MIN_SIMILARITY,
  MemoryVectorError,
  indexMemoryVector,
  retrieveMemoryVectors,
  type MemoryEmbeddingAdapter,
  type MemoryVectorStore,
} from "./memory-vector";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  memory: "00000000-0000-4000-8000-000000000003",
  otherMemory: "00000000-0000-4000-8000-000000000004",
};
const now = new Date("2026-09-07T03:00:00.000Z");
const vector = Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, index) =>
  index === 0 ? 1 : 0,
);

function adapter(overrides?: {
  dimensions?: number;
  vector?: readonly number[];
}): MemoryEmbeddingAdapter {
  return {
    descriptor: {
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      dimensions: overrides?.dimensions ?? MEMORY_EMBEDDING_DIMENSIONS,
    },
    embed: vi.fn(async (request) => ({
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      vector: overrides?.vector ?? vector,
      latencyMs: 0,
      purpose: request.purpose,
    })),
  };
}

function store(): MemoryVectorStore {
  return {
    save: vi.fn(async (input) => input.memoryId),
    search: vi.fn().mockResolvedValue([
      {
        memoryId: ids.memory,
        scope: "role_private",
        roleId: ids.role,
        category: "agreement",
        content: "用户难过时希望先被完整倾听。",
        sensitivity: "normal",
        confirmedByUser: false,
        similarity: 0.93,
      },
    ]),
  };
}

describe("memory vector boundary", () => {
  it("indexes one immutable memory version through an explicit adapter and store", async () => {
    const embeddingAdapter = adapter();
    const vectorStore = store();

    await expect(
      indexMemoryVector(
        {
          userId: ids.user,
          memoryId: ids.memory,
          content: "用户难过时希望先被完整倾听。",
          expectedUpdatedAt: now.toISOString(),
          traceId: "memory-vector-index-test",
        },
        { adapter: embeddingAdapter, store: vectorStore },
      ),
    ).resolves.toEqual({
      memoryId: ids.memory,
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      dimensions: 1536,
    });

    expect(embeddingAdapter.embed).toHaveBeenCalledWith({
      input: "用户难过时希望先被完整倾听。",
      purpose: "memory_document",
      timeoutMs: 120_000,
      traceId: "memory-vector-index-test",
    });
    expect(vectorStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ids.user,
        memoryId: ids.memory,
        expectedUpdatedAt: now.toISOString(),
        providerId: "local-fixed",
        modelId: "deterministic-1536-v1",
        embedding: vector,
      }),
    );
  });

  it("rejects a wrong-dimensional provider before persisting anything", async () => {
    const vectorStore = store();

    await expect(
      indexMemoryVector(
        {
          userId: ids.user,
          memoryId: ids.memory,
          content: "可验证的记忆正文",
          expectedUpdatedAt: now.toISOString(),
        },
        { adapter: adapter({ dimensions: 3 }), store: vectorStore },
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "configuration-unavailable" }));
    expect(vectorStore.save).not.toHaveBeenCalled();
  });

  it("rejects a malformed embedding without leaking it into the store", async () => {
    const vectorStore = store();

    await expect(
      indexMemoryVector(
        {
          userId: ids.user,
          memoryId: ids.memory,
          content: "可验证的记忆正文",
          expectedUpdatedAt: now.toISOString(),
        },
        { adapter: adapter({ vector: [1, 0, 0] }), store: vectorStore },
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "invalid-embedding" }));
    expect(vectorStore.save).not.toHaveBeenCalled();
  });

  it("retrieves at most five normal memories with a bounded threshold by default", async () => {
    const embeddingAdapter = adapter();
    const vectorStore = store();

    await expect(
      retrieveMemoryVectors(
        {
          userId: ids.user,
          roleId: ids.role,
          query: "我现在很难过",
          now,
          traceId: "memory-vector-query-test",
        },
        { adapter: embeddingAdapter, store: vectorStore },
      ),
    ).resolves.toMatchObject([{ memoryId: ids.memory, similarity: 0.93 }]);

    expect(vectorStore.search).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ids.user,
        roleId: ids.role,
        limit: 5,
        minSimilarity: MEMORY_RETRIEVAL_DEFAULT_MIN_SIMILARITY,
        includeSensitive: false,
        queryEmbedding: vector,
      }),
    );
  });

  it("fails closed when the store returns another role or unapproved sensitive memory", async () => {
    const vectorStore = store();
    vi.mocked(vectorStore.search).mockResolvedValue([
      {
        memoryId: ids.otherMemory,
        scope: "role_private",
        roleId: "00000000-0000-4000-8000-000000000099",
        category: "private",
        content: "不能进入当前角色的记忆",
        sensitivity: "sensitive",
        confirmedByUser: false,
        similarity: 0.99,
      },
    ]);

    await expect(
      retrieveMemoryVectors(
        { userId: ids.user, roleId: ids.role, query: "查询", now },
        { adapter: adapter(), store: vectorStore },
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "retrieval-unavailable" }));
  });

  it("fails closed when the store returns a non-descending similarity order", async () => {
    const vectorStore = store();
    vi.mocked(vectorStore.search).mockResolvedValue([
      {
        memoryId: ids.memory,
        scope: "role_private",
        roleId: ids.role,
        category: "first",
        content: "第一条召回结果",
        sensitivity: "normal",
        confirmedByUser: true,
        similarity: 0.82,
      },
      {
        memoryId: ids.otherMemory,
        scope: "role_private",
        roleId: ids.role,
        category: "second",
        content: "第二条召回结果",
        sensitivity: "normal",
        confirmedByUser: true,
        similarity: 0.94,
      },
    ]);

    await expect(
      retrieveMemoryVectors(
        { userId: ids.user, roleId: ids.role, query: "查询", now },
        { adapter: adapter(), store: vectorStore },
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "retrieval-unavailable" }));
  });

  it("does not allow a caller to request more than five results", async () => {
    const vectorStore = store();

    await expect(
      retrieveMemoryVectors(
        {
          userId: ids.user,
          roleId: ids.role,
          query: "查询",
          maxResults: 6,
        },
        { adapter: adapter(), store: vectorStore },
      ),
    ).rejects.toBeInstanceOf(MemoryVectorError);
    expect(vectorStore.search).not.toHaveBeenCalled();
  });
});
