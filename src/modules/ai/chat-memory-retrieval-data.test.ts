import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: () => ({ rpc }),
}));

import { recordAiRunMemoryRetrievals } from "./chat-memory-retrieval-data";

const input = {
  userId: "10000000-0000-4000-8000-000000000001",
  aiRunId: "20000000-0000-4000-8000-000000000002",
  traceId: "30000000-0000-4000-8000-000000000003",
  roleId: "40000000-0000-4000-8000-000000000004",
  embeddingProvider: "local-fixed",
  embeddingModel: "deterministic-1536-v1",
  sensitiveRetrievalAuthorized: false,
  retrievals: [
    {
      memoryId: "50000000-0000-4000-8000-000000000005",
      retrievalRank: 1,
      similarity: 0.91,
      includedInContext: true,
    },
  ],
} as const;

describe("recordAiRunMemoryRetrievals", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: input.aiRunId, error: null });
  });

  it("sends only bounded retrieval metadata to the controlled RPC", async () => {
    await expect(recordAiRunMemoryRetrievals(input)).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith("record_ai_run_memory_retrievals", {
      p_user_id: input.userId,
      p_ai_run_id: input.aiRunId,
      p_trace_id: input.traceId,
      p_role_id: input.roleId,
      p_embedding_provider: "local-fixed",
      p_embedding_model: "deterministic-1536-v1",
      p_include_sensitive: false,
      p_retrievals: [
        {
          memory_id: input.retrievals[0].memoryId,
          retrieval_rank: 1,
          similarity: 0.91,
          included_in_context: true,
        },
      ],
    });
  });

  it("rejects duplicate IDs or non-contiguous ranks before touching storage", async () => {
    await expect(
      recordAiRunMemoryRetrievals({
        ...input,
        retrievals: [input.retrievals[0], { ...input.retrievals[0], retrievalRank: 2 }],
      }),
    ).resolves.toBe(false);
    await expect(
      recordAiRunMemoryRetrievals({
        ...input,
        retrievals: [{ ...input.retrievals[0], retrievalRank: 2 }],
      }),
    ).resolves.toBe(false);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC does not return the requested AI run", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private detail" } });

    await expect(recordAiRunMemoryRetrievals(input)).resolves.toBe(false);
  });
});
