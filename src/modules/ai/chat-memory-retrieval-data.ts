import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

export interface PersistedMemoryRetrieval {
  memoryId: string;
  retrievalRank: number;
  similarity: number;
  includedInContext: boolean;
}

export interface RecordAiRunMemoryRetrievalsInput {
  userId: string;
  aiRunId: string;
  traceId: string;
  roleId: string;
  embeddingProvider: string;
  embeddingModel: string;
  sensitiveRetrievalAuthorized: boolean;
  retrievals: readonly PersistedMemoryRetrieval[];
}

function validText(value: string, maxLength: number): boolean {
  const length = value.trim().length;
  return length >= 1 && length <= maxLength;
}

function validRetrievals(retrievals: readonly PersistedMemoryRetrieval[]): boolean {
  if (!Array.isArray(retrievals) || retrievals.length > 5) return false;

  const memoryIds = new Set<string>();
  const ranks = new Set<number>();
  for (const retrieval of retrievals) {
    if (
      !uuidSchema.safeParse(retrieval.memoryId).success ||
      !Number.isInteger(retrieval.retrievalRank) ||
      retrieval.retrievalRank < 1 ||
      retrieval.retrievalRank > retrievals.length ||
      !Number.isFinite(retrieval.similarity) ||
      retrieval.similarity < 0 ||
      retrieval.similarity > 1 ||
      typeof retrieval.includedInContext !== "boolean"
    ) {
      return false;
    }
    memoryIds.add(retrieval.memoryId);
    ranks.add(retrieval.retrievalRank);
  }

  return memoryIds.size === retrievals.length && ranks.size === retrievals.length;
}

/**
 * Persists only retrieval metadata and final inclusion decisions. Query text,
 * query vectors, prompts, drafts, and provider response bodies never cross
 * this database boundary.
 */
export async function recordAiRunMemoryRetrievals(
  input: RecordAiRunMemoryRetrievalsInput,
): Promise<boolean> {
  if (
    !uuidSchema.safeParse(input.userId).success ||
    !uuidSchema.safeParse(input.aiRunId).success ||
    !uuidSchema.safeParse(input.traceId).success ||
    !uuidSchema.safeParse(input.roleId).success ||
    !validText(input.embeddingProvider, 100) ||
    !validText(input.embeddingModel, 200) ||
    typeof input.sensitiveRetrievalAuthorized !== "boolean" ||
    !validRetrievals(input.retrievals)
  ) {
    return false;
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return false;

  const { data, error } = await supabase.rpc("record_ai_run_memory_retrievals", {
    p_user_id: input.userId,
    p_ai_run_id: input.aiRunId,
    p_trace_id: input.traceId,
    p_role_id: input.roleId,
    p_embedding_provider: input.embeddingProvider.trim(),
    p_embedding_model: input.embeddingModel.trim(),
    p_include_sensitive: input.sensitiveRetrievalAuthorized,
    p_retrievals: input.retrievals.map((retrieval) => ({
      memory_id: retrieval.memoryId,
      retrieval_rank: retrieval.retrievalRank,
      similarity: retrieval.similarity,
      included_in_context: retrieval.includedInContext,
    })),
  });

  return !error && data === input.aiRunId;
}
