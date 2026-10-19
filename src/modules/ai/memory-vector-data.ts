import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

import {
  isValidMemoryEmbedding,
  type MemoryVectorStore,
  type RetrievedMemoryVector,
} from "./memory-vector";

export class MemoryVectorStoreError extends Error {
  constructor(readonly code: "persistence-unavailable" | "retrieval-unavailable") {
    super(code);
    this.name = "MemoryVectorStoreError";
  }
}

function vectorLiteral(vector: readonly number[]): string {
  if (!isValidMemoryEmbedding(vector)) {
    throw new MemoryVectorStoreError("persistence-unavailable");
  }
  return `[${vector.join(",")}]`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseRetrievedMemory(value: unknown): RetrievedMemoryVector | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const memoryId = text(row.memory_id);
  const scope = text(row.scope);
  const roleId = text(row.role_id);
  const category = text(row.category);
  const content = text(row.content);
  const sensitivity = text(row.sensitivity);
  const similarity = row.similarity;

  if (
    !uuidSchema.safeParse(memoryId).success ||
    !["user_shared", "role_private"].includes(scope ?? "") ||
    (roleId !== null && !uuidSchema.safeParse(roleId).success) ||
    !category ||
    !content ||
    !["normal", "sensitive"].includes(sensitivity ?? "") ||
    typeof row.confirmed_by_user !== "boolean" ||
    typeof similarity !== "number" ||
    !Number.isFinite(similarity)
  ) {
    return null;
  }

  return {
    memoryId: memoryId!,
    scope: scope as RetrievedMemoryVector["scope"],
    roleId,
    category,
    content,
    sensitivity: sensitivity as RetrievedMemoryVector["sensitivity"],
    confirmedByUser: row.confirmed_by_user,
    similarity,
  };
}

export class SupabaseMemoryVectorStore implements MemoryVectorStore {
  constructor(
    private readonly supabase: SupabaseClient | null = createServiceRoleSupabaseClient(),
  ) {}

  async save(input: {
    userId: string;
    memoryId: string;
    expectedContent: string;
    expectedUpdatedAt: string;
    providerId: string;
    modelId: string;
    embedding: readonly number[];
  }): Promise<string | null> {
    if (!this.supabase) {
      throw new MemoryVectorStoreError("persistence-unavailable");
    }

    let embedding: string;
    try {
      embedding = vectorLiteral(input.embedding);
    } catch {
      throw new MemoryVectorStoreError("persistence-unavailable");
    }
    const { data, error } = await this.supabase.rpc("set_memory_embedding", {
      p_user_id: input.userId,
      p_memory_id: input.memoryId,
      p_expected_content: input.expectedContent,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_embedding_provider: input.providerId,
      p_embedding_model: input.modelId,
      p_embedding: embedding,
    });

    if (error || !uuidSchema.safeParse(data).success) {
      throw new MemoryVectorStoreError("persistence-unavailable");
    }
    return data as string;
  }

  async search(input: {
    userId: string;
    roleId: string;
    queryEmbedding: readonly number[];
    providerId: string;
    modelId: string;
    limit: number;
    minSimilarity: number;
    includeSensitive: boolean;
    now: Date;
  }): Promise<RetrievedMemoryVector[]> {
    if (!this.supabase) {
      throw new MemoryVectorStoreError("retrieval-unavailable");
    }

    let queryEmbedding: string;
    try {
      queryEmbedding = vectorLiteral(input.queryEmbedding);
    } catch {
      throw new MemoryVectorStoreError("retrieval-unavailable");
    }
    const { data, error } = await this.supabase.rpc("match_memories_for_role", {
      p_user_id: input.userId,
      p_role_id: input.roleId,
      p_query_embedding: queryEmbedding,
      p_embedding_provider: input.providerId,
      p_embedding_model: input.modelId,
      p_limit: input.limit,
      p_min_similarity: input.minSimilarity,
      p_include_sensitive: input.includeSensitive,
      p_now: input.now.toISOString(),
    });

    if (error || !Array.isArray(data)) {
      throw new MemoryVectorStoreError("retrieval-unavailable");
    }
    const memories = data.map(parseRetrievedMemory);
    if (memories.some((memory) => memory === null)) {
      throw new MemoryVectorStoreError("retrieval-unavailable");
    }
    return memories as RetrievedMemoryVector[];
  }
}
