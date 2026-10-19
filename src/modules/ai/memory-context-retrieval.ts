import "server-only";

import type { ContextMemory } from "./context-builder";
import {
  retrieveMemoryVectors,
  type MemoryEmbeddingAdapter,
  type MemoryVectorStore,
} from "./memory-vector";

export interface ModelContextMemoryRetrievalRequest {
  userId: string;
  roleId: string;
  query: string;
  maxResults: number;
  includeSensitive: boolean;
  now: Date;
  traceId?: string;
}

export interface ModelContextMemoryRetrievalMatch {
  memoryId: string;
  retrievalRank: number;
  similarity: number;
}

export interface ModelContextMemoryRetrievalAudit {
  embeddingProvider: string;
  embeddingModel: string;
  sensitiveRetrievalAuthorized: boolean;
  matches: readonly ModelContextMemoryRetrievalMatch[];
}

export interface ModelContextMemoryRetrievalResult {
  memories: readonly ContextMemory[];
  directlyRelevantSensitiveMemoryIds: readonly string[];
  audit: ModelContextMemoryRetrievalAudit;
}

export interface ModelContextMemoryRetriever {
  retrieve(
    request: ModelContextMemoryRetrievalRequest,
  ): Promise<ModelContextMemoryRetrievalResult>;
}

/**
 * Creates an explicitly configured retrieval boundary. No environment is read
 * here: callers must supply both the query embedding adapter and the
 * service-only vector store before a provider request can occur.
 */
export function createModelContextMemoryRetriever(dependencies: {
  adapter: MemoryEmbeddingAdapter;
  store: MemoryVectorStore;
}): ModelContextMemoryRetriever {
  return {
    async retrieve(request) {
      const retrieved = await retrieveMemoryVectors(
        {
          userId: request.userId,
          roleId: request.roleId,
          query: request.query,
          maxResults: request.maxResults,
          includeSensitive: request.includeSensitive,
          now: request.now,
          traceId: request.traceId,
        },
        dependencies,
      );

      return {
        memories: retrieved.map((memory) => ({
          id: memory.memoryId,
          scope: memory.scope,
          roleId: memory.roleId,
          category: memory.category,
          content: memory.content,
          sensitivity: memory.sensitivity,
          status: "active" as const,
          confirmedByUser: memory.confirmedByUser,
        })),
        directlyRelevantSensitiveMemoryIds: retrieved
          .filter((memory) => memory.sensitivity === "sensitive")
          .map((memory) => memory.memoryId),
        audit: {
          embeddingProvider: dependencies.adapter.descriptor.providerId,
          embeddingModel: dependencies.adapter.descriptor.modelId,
          sensitiveRetrievalAuthorized: request.includeSensitive,
          matches: retrieved.map((memory, index) => ({
            memoryId: memory.memoryId,
            retrievalRank: index + 1,
            similarity: memory.similarity,
          })),
        },
      };
    },
  };
}
