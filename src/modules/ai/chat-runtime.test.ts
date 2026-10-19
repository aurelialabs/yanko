import type { User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter } from "./model-adapter";
import { ModelAdapterError } from "./model-errors";
import type {
  ModelGenerationResponse,
  ModelStructuredRequest,
  ModelStructuredResponse,
} from "./model-types";
import {
  runMiniMaxDevelopmentChatTurn,
  type DevelopmentChatTurnInput,
} from "./chat-runtime";
import type {
  BeginAiChatTurnResult,
  CompleteAiChatTurnInput,
  FailAiChatTurnInput,
} from "./chat-runtime-data";
import type { RecordAiRunMemoryRetrievalsInput } from "./chat-memory-retrieval-data";
import { DETERMINISTIC_HIGH_RISK_RESPONSE } from "./chat-safety";
import type { LoadedModelContextSources } from "./context-data";
import type { ModelContextMemoryRetriever } from "./memory-context-retrieval";

const user = {
  id: "10000000-0000-4000-8000-000000000001",
} as User;

const input: DevelopmentChatTurnInput = {
  user,
  roleId: "20000000-0000-4000-8000-000000000002",
  conversationId: "30000000-0000-4000-8000-000000000003",
  content: "今天工作有点乱，陪我理一下。",
  clientMessageId: "40000000-0000-4000-8000-000000000004",
};

const reservation: BeginAiChatTurnResult = {
  userMessageId: "50000000-0000-4000-8000-000000000005",
  assistantMessageId: "60000000-0000-4000-8000-000000000006",
  aiRunId: "70000000-0000-4000-8000-000000000007",
  personaVersionId: "80000000-0000-4000-8000-000000000008",
  strategyVersionId: "90000000-0000-4000-8000-000000000009",
  provider: "minimax",
  model: "MiniMax-M3",
  runStatus: "running",
  shouldGenerate: true,
};

const sources: LoadedModelContextSources = {
  roleId: input.roleId,
  personaVersionId: reservation.personaVersionId,
  strategyVersionId: reservation.strategyVersionId,
  compiledSystemPrompt: "你是尊重边界、温和清晰的长期伙伴。",
  messages: [
    {
      id: reservation.userMessageId,
      sender: "user",
      content: input.content,
      status: "completed",
    },
  ],
  memories: [],
  directlyRelevantSensitiveMemoryIds: [],
  summary: null,
  memoryRetrievalAudit: null,
};

function generation(
  text = "我在。我们先列出最影响你的两件事。",
): ModelGenerationResponse {
  return {
    providerId: "minimax",
    modelId: "MiniMax-M3",
    requestId: "provider-request",
    text,
    finishReason: "stop",
    latencyMs: 20,
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
  };
}

function checker(verdict: "pass" | "block" = "pass"): ModelStructuredResponse<{
  verdict: "pass" | "block";
  overallScore: number;
  dimensionScores: {
    identity: number;
    personality: number;
    speakingStyle: number;
    preference: number;
    memoryTruthfulness: number;
    boundarySafety: number;
    temporaryRoleplay: number;
  };
  failureLabels: string[];
  rewriteInstructions: string[];
}> {
  const blocked = verdict === "block";
  return {
    providerId: "minimax",
    modelId: "MiniMax-M3",
    requestId: "checker-request",
    latencyMs: 12,
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    output: {
      verdict,
      overallScore: blocked ? 0.1 : 1,
      dimensionScores: {
        identity: blocked ? 0.1 : 1,
        personality: blocked ? 0.1 : 1,
        speakingStyle: blocked ? 0.1 : 1,
        preference: blocked ? 0.1 : 1,
        memoryTruthfulness: blocked ? 0.1 : 1,
        boundarySafety: blocked ? 0.1 : 1,
        temporaryRoleplay: blocked ? 0.1 : 1,
      },
      failureLabels: blocked ? ["explicit_boundary_violation"] : [],
      rewriteInstructions: [],
    },
  };
}

function adapterWith(
  generateResponse: ModelGenerationResponse | Error = generation(),
  checkResponse: ReturnType<typeof checker> | Error = checker(),
): ModelAdapter {
  return {
    descriptor: {
      id: "minimax-test",
      providerId: "minimax",
      modelId: "MiniMax-M3",
      capabilities: ["text-generation", "structured-output"],
    },
    generate: vi.fn(async () => {
      if (generateResponse instanceof Error) throw generateResponse;
      return generateResponse;
    }),
    async generateStructured<TOutput>(
      request: ModelStructuredRequest<TOutput>,
    ): Promise<ModelStructuredResponse<TOutput>> {
      if (checkResponse instanceof Error) throw checkResponse;
      return {
        providerId: checkResponse.providerId,
        modelId: checkResponse.modelId,
        requestId: checkResponse.requestId,
        latencyMs: checkResponse.latencyMs,
        usage: checkResponse.usage,
        output: request.parse(checkResponse.output),
      };
    },
  };
}

function dependencies(options: {
  adapter?: ModelAdapter;
  begin?: BeginAiChatTurnResult;
  complete?: (input: CompleteAiChatTurnInput) => Promise<boolean>;
  fail?: (input: FailAiChatTurnInput) => Promise<boolean>;
  memoryRetriever?: ModelContextMemoryRetriever | null;
  includeSensitiveMemories?: boolean;
  recordMemoryRetrievals?: (
    input: RecordAiRunMemoryRetrievalsInput,
  ) => Promise<boolean>;
}) {
  return {
    createAdapter: vi.fn(() => options.adapter ?? adapterWith()),
    begin: vi.fn(async () => options.begin ?? reservation),
    complete: vi.fn(options.complete ?? (async () => true)),
    fail: vi.fn(options.fail ?? (async () => true)),
    loadContext: vi.fn(async () => sources),
    memoryRetriever: options.memoryRetriever ?? null,
    includeSensitiveMemories: options.includeSensitiveMemories ?? false,
    recordMemoryRetrievals: vi.fn(options.recordMemoryRetrievals ?? (async () => true)),
    createTraceId: () => "a0000000-0000-4000-8000-00000000000a",
    now: () => 100,
  };
}

describe("runMiniMaxDevelopmentChatTurn", () => {
  it("bypasses the provider and persists mandatory help for explicit high risk", async () => {
    const deps = dependencies({});
    const result = await runMiniMaxDevelopmentChatTurn(
      { ...input, content: "我现在想吞药结束生命" },
      deps,
    );

    expect(result.outcome).toBe("completed");
    expect(deps.createAdapter).not.toHaveBeenCalled();
    expect(deps.loadContext).not.toHaveBeenCalled();
    expect(deps.begin).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "deterministic-safety" }),
    );
    expect(deps.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: DETERMINISTIC_HIGH_RISK_RESPONSE,
        oocChecks: [],
      }),
    );
  });

  it("persists a normal response only after a passing OOC check", async () => {
    const adapter = adapterWith();
    const deps = dependencies({ adapter });
    const result = await runMiniMaxDevelopmentChatTurn(input, deps);

    expect(result.outcome).toBe("completed");
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    expect(deps.loadContext).toHaveBeenCalledWith(
      expect.objectContaining({
        personaVersionId: reservation.personaVersionId,
        strategyVersionId: reservation.strategyVersionId,
      }),
    );
    expect(deps.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "我在。我们先列出最影响你的两件事。",
        inputTokens: 32,
        outputTokens: 18,
        oocChecks: [expect.objectContaining({ attempt_no: 1, verdict: "pass" })],
      }),
    );
    expect(deps.fail).not.toHaveBeenCalled();
    expect(deps.recordMemoryRetrievals).not.toHaveBeenCalled();
  });

  it("audits retrieved and actually included memory IDs before generation", async () => {
    const adapter = adapterWith();
    const memoryRetriever: ModelContextMemoryRetriever = {
      retrieve: vi.fn(),
    };
    const deps = dependencies({ adapter, memoryRetriever });
    const firstMemoryId = "a1000000-0000-4000-8000-000000000001";
    const secondMemoryId = "a2000000-0000-4000-8000-000000000002";
    deps.loadContext.mockResolvedValue({
      ...sources,
      memories: [
        {
          id: firstMemoryId,
          scope: "role_private",
          roleId: input.roleId,
          category: "preference",
          content: "甲".repeat(5_000),
          sensitivity: "normal",
          status: "active",
          confirmedByUser: true,
        },
        {
          id: secondMemoryId,
          scope: "user_shared",
          roleId: null,
          category: "support",
          content: "乙".repeat(5_000),
          sensitivity: "normal",
          status: "active",
          confirmedByUser: true,
        },
      ],
      memoryRetrievalAudit: {
        embeddingProvider: "local-fixed",
        embeddingModel: "deterministic-1536-v1",
        sensitiveRetrievalAuthorized: false,
        matches: [
          { memoryId: firstMemoryId, retrievalRank: 1, similarity: 0.93 },
          { memoryId: secondMemoryId, retrievalRank: 2, similarity: 0.86 },
        ],
      },
    });

    const result = await runMiniMaxDevelopmentChatTurn(input, deps);

    expect(result.outcome).toBe("completed");
    expect(deps.loadContext).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryRetrieval: expect.objectContaining({
          retriever: memoryRetriever,
          query: input.content,
          includeSensitive: false,
        }),
      }),
    );
    expect(deps.recordMemoryRetrievals).toHaveBeenCalledWith({
      userId: user.id,
      aiRunId: reservation.aiRunId,
      traceId: "a0000000-0000-4000-8000-00000000000a",
      roleId: input.roleId,
      embeddingProvider: "local-fixed",
      embeddingModel: "deterministic-1536-v1",
      sensitiveRetrievalAuthorized: false,
      retrievals: [
        {
          memoryId: firstMemoryId,
          retrievalRank: 1,
          similarity: 0.93,
          includedInContext: true,
        },
        {
          memoryId: secondMemoryId,
          retrievalRank: 2,
          similarity: 0.86,
          includedInContext: false,
        },
      ],
    });
    expect(deps.recordMemoryRetrievals.mock.invocationCallOrder[0]).toBeLessThan(
      (adapter.generate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
  });

  it("fails closed without generating when retrieval audit persistence fails", async () => {
    const adapter = adapterWith();
    const memoryId = "a3000000-0000-4000-8000-000000000003";
    const deps = dependencies({
      adapter,
      memoryRetriever: { retrieve: vi.fn() },
      recordMemoryRetrievals: async () => false,
    });
    deps.loadContext.mockResolvedValue({
      ...sources,
      memories: [
        {
          id: memoryId,
          scope: "role_private",
          roleId: input.roleId,
          category: "preference",
          content: "用户希望先被倾听。",
          sensitivity: "normal",
          status: "active",
          confirmedByUser: true,
        },
      ],
      memoryRetrievalAudit: {
        embeddingProvider: "local-fixed",
        embeddingModel: "deterministic-1536-v1",
        sensitiveRetrievalAuthorized: false,
        matches: [{ memoryId, retrievalRank: 1, similarity: 0.9 }],
      },
    });

    const result = await runMiniMaxDevelopmentChatTurn(input, deps);

    expect(result.outcome).toBe("failed");
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "unavailable", runStatus: "failed" }),
    );
  });

  it("blocks a draft with a hard OOC failure and never completes it", async () => {
    const adapter = adapterWith(generation(), checker("block"));
    const deps = dependencies({ adapter });
    const result = await runMiniMaxDevelopmentChatTurn(input, deps);

    expect(result.outcome).toBe("blocked");
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        runStatus: "blocked",
        errorCode: "safety-blocked",
        oocChecks: [expect.objectContaining({ verdict: "block", attempt_no: 1 })],
      }),
    );
  });

  it("maps provider details to a safe database error code", async () => {
    const adapter = adapterWith(
      new ModelAdapterError("rate-limited", "private provider detail"),
    );
    const deps = dependencies({ adapter });
    const result = await runMiniMaxDevelopmentChatTurn(input, deps);

    expect(result.outcome).toBe("failed");
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "rate-limited", runStatus: "failed" }),
    );
  });

  it("counts provider-reported usage when structured parsing fails", async () => {
    const adapter = adapterWith(
      generation(),
      new ModelAdapterError("invalid-output", "safe parse failure", {
        usage: { inputTokens: 15, outputTokens: 6, totalTokens: 21 },
      }),
    );
    const deps = dependencies({ adapter });
    const result = await runMiniMaxDevelopmentChatTurn(input, deps);

    expect(result.outcome).toBe("failed");
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "ooc-checker-unavailable",
        inputTokens: 35,
        outputTokens: 16,
      }),
    );
  });

  it("does not generate again when another request owns the active lease", async () => {
    const adapter = adapterWith();
    const deps = dependencies({
      adapter,
      begin: { ...reservation, shouldGenerate: false },
    });
    const result = await runMiniMaxDevelopmentChatTurn(input, deps);

    expect(result.outcome).toBe("in-progress");
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
  });
});
