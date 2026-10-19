import "server-only";

import { uuidSchema } from "@/server/schemas";
import type { MemoryScope } from "@/types/domain";

export const MEMORY_EMBEDDING_DIMENSIONS = 1536;
export const MEMORY_RETRIEVAL_MAX_RESULTS = 5;
export const MEMORY_RETRIEVAL_DEFAULT_MIN_SIMILARITY = 0.78;

export type MemoryEmbeddingPurpose = "memory_document" | "memory_query";

export interface MemoryEmbeddingAdapterDescriptor {
  providerId: string;
  modelId: string;
  dimensions: number;
}

export interface MemoryEmbeddingRequest {
  input: string;
  purpose: MemoryEmbeddingPurpose;
  timeoutMs: number;
  traceId?: string;
}

export interface MemoryEmbeddingResponse {
  providerId: string;
  modelId: string;
  vector: readonly number[];
  latencyMs: number;
}

export interface MemoryEmbeddingAdapter {
  readonly descriptor: MemoryEmbeddingAdapterDescriptor;
  embed(request: MemoryEmbeddingRequest): Promise<MemoryEmbeddingResponse>;
}

export interface RetrievedMemoryVector {
  memoryId: string;
  scope: MemoryScope;
  roleId: string | null;
  category: string;
  content: string;
  sensitivity: "normal" | "sensitive";
  confirmedByUser: boolean;
  similarity: number;
}

export interface MemoryVectorStore {
  save(input: {
    userId: string;
    memoryId: string;
    expectedContent: string;
    expectedUpdatedAt: string;
    providerId: string;
    modelId: string;
    embedding: readonly number[];
  }): Promise<string | null>;
  search(input: {
    userId: string;
    roleId: string;
    queryEmbedding: readonly number[];
    providerId: string;
    modelId: string;
    limit: number;
    minSimilarity: number;
    includeSensitive: boolean;
    now: Date;
  }): Promise<RetrievedMemoryVector[]>;
}

export type MemoryVectorErrorCode =
  | "invalid-input"
  | "configuration-unavailable"
  | "embedding-unavailable"
  | "invalid-embedding"
  | "persistence-unavailable"
  | "retrieval-unavailable";

export class MemoryVectorError extends Error {
  constructor(readonly code: MemoryVectorErrorCode) {
    super(code);
    this.name = "MemoryVectorError";
  }
}

function nonEmptyText(value: string, maxLength: number): boolean {
  const length = value.trim().length;
  return length >= 1 && length <= maxLength;
}

export function isValidMemoryEmbeddingAdapter(
  adapter: MemoryEmbeddingAdapter,
): boolean {
  return (
    nonEmptyText(adapter.descriptor.providerId, 100) &&
    nonEmptyText(adapter.descriptor.modelId, 200) &&
    adapter.descriptor.dimensions === MEMORY_EMBEDDING_DIMENSIONS
  );
}

export function isValidMemoryEmbedding(vector: readonly number[]): boolean {
  if (
    !Array.isArray(vector) ||
    vector.length !== MEMORY_EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    return false;
  }

  return vector.some((value) => value !== 0);
}

async function createEmbedding(
  adapter: MemoryEmbeddingAdapter,
  input: string,
  purpose: MemoryEmbeddingPurpose,
  traceId?: string,
): Promise<readonly number[]> {
  let response: MemoryEmbeddingResponse;
  try {
    response = await adapter.embed({
      input,
      purpose,
      timeoutMs: 120_000,
      traceId,
    });
  } catch {
    throw new MemoryVectorError("embedding-unavailable");
  }

  if (
    response.providerId !== adapter.descriptor.providerId ||
    response.modelId !== adapter.descriptor.modelId ||
    !Number.isFinite(response.latencyMs) ||
    response.latencyMs < 0 ||
    !isValidMemoryEmbedding(response.vector)
  ) {
    throw new MemoryVectorError("invalid-embedding");
  }

  return response.vector;
}

export async function indexMemoryVector(
  input: {
    userId: string;
    memoryId: string;
    content: string;
    expectedUpdatedAt: string;
    traceId?: string;
  },
  dependencies: {
    adapter: MemoryEmbeddingAdapter;
    store: MemoryVectorStore;
  },
): Promise<{
  memoryId: string;
  providerId: string;
  modelId: string;
  dimensions: typeof MEMORY_EMBEDDING_DIMENSIONS;
}> {
  if (
    !uuidSchema.safeParse(input.userId).success ||
    !uuidSchema.safeParse(input.memoryId).success ||
    !nonEmptyText(input.content, 5000) ||
    !Number.isFinite(Date.parse(input.expectedUpdatedAt))
  ) {
    throw new MemoryVectorError("invalid-input");
  }
  if (!isValidMemoryEmbeddingAdapter(dependencies.adapter)) {
    throw new MemoryVectorError("configuration-unavailable");
  }

  const embedding = await createEmbedding(
    dependencies.adapter,
    input.content,
    "memory_document",
    input.traceId,
  );

  let persistedId: string | null;
  try {
    persistedId = await dependencies.store.save({
      userId: input.userId,
      memoryId: input.memoryId,
      expectedContent: input.content,
      expectedUpdatedAt: input.expectedUpdatedAt,
      providerId: dependencies.adapter.descriptor.providerId,
      modelId: dependencies.adapter.descriptor.modelId,
      embedding,
    });
  } catch {
    throw new MemoryVectorError("persistence-unavailable");
  }

  if (persistedId !== input.memoryId) {
    throw new MemoryVectorError("persistence-unavailable");
  }

  return {
    memoryId: persistedId,
    providerId: dependencies.adapter.descriptor.providerId,
    modelId: dependencies.adapter.descriptor.modelId,
    dimensions: MEMORY_EMBEDDING_DIMENSIONS,
  };
}

function validRetrievedMemory(
  memory: RetrievedMemoryVector,
  roleId: string,
  includeSensitive: boolean,
  minSimilarity: number,
): boolean {
  return (
    uuidSchema.safeParse(memory.memoryId).success &&
    nonEmptyText(memory.category, 100) &&
    nonEmptyText(memory.content, 5000) &&
    Number.isFinite(memory.similarity) &&
    memory.similarity >= minSimilarity &&
    memory.similarity <= 1 + Number.EPSILON &&
    ((memory.scope === "user_shared" && memory.roleId === null) ||
      (memory.scope === "role_private" && memory.roleId === roleId)) &&
    (memory.sensitivity === "normal" ||
      (includeSensitive &&
        memory.sensitivity === "sensitive" &&
        memory.confirmedByUser))
  );
}

export async function retrieveMemoryVectors(
  input: {
    userId: string;
    roleId: string;
    query: string;
    maxResults?: number;
    minSimilarity?: number;
    includeSensitive?: boolean;
    now?: Date;
    traceId?: string;
  },
  dependencies: {
    adapter: MemoryEmbeddingAdapter;
    store: MemoryVectorStore;
  },
): Promise<RetrievedMemoryVector[]> {
  const maxResults = input.maxResults ?? MEMORY_RETRIEVAL_MAX_RESULTS;
  const minSimilarity = input.minSimilarity ?? MEMORY_RETRIEVAL_DEFAULT_MIN_SIMILARITY;
  const includeSensitive = input.includeSensitive ?? false;
  const now = input.now ?? new Date();

  if (
    !uuidSchema.safeParse(input.userId).success ||
    !uuidSchema.safeParse(input.roleId).success ||
    !nonEmptyText(input.query, 20_000) ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MEMORY_RETRIEVAL_MAX_RESULTS ||
    !Number.isFinite(minSimilarity) ||
    minSimilarity < 0 ||
    minSimilarity > 1 ||
    !Number.isFinite(now.getTime())
  ) {
    throw new MemoryVectorError("invalid-input");
  }
  if (!isValidMemoryEmbeddingAdapter(dependencies.adapter)) {
    throw new MemoryVectorError("configuration-unavailable");
  }

  const queryEmbedding = await createEmbedding(
    dependencies.adapter,
    input.query,
    "memory_query",
    input.traceId,
  );

  let memories: RetrievedMemoryVector[];
  try {
    memories = await dependencies.store.search({
      userId: input.userId,
      roleId: input.roleId,
      queryEmbedding,
      providerId: dependencies.adapter.descriptor.providerId,
      modelId: dependencies.adapter.descriptor.modelId,
      limit: maxResults,
      minSimilarity,
      includeSensitive,
      now,
    });
  } catch {
    throw new MemoryVectorError("retrieval-unavailable");
  }

  const uniqueIds = new Set(memories.map((memory) => memory.memoryId));
  if (
    memories.length > maxResults ||
    uniqueIds.size !== memories.length ||
    memories.some(
      (memory, index) =>
        index > 0 && memories[index - 1].similarity < memory.similarity,
    ) ||
    memories.some(
      (memory) =>
        !validRetrievedMemory(memory, input.roleId, includeSensitive, minSimilarity),
    )
  ) {
    throw new MemoryVectorError("retrieval-unavailable");
  }

  return memories;
}
