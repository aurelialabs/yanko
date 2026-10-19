import "server-only";

import type { User } from "@supabase/supabase-js";

import { oocCheckOutputSchema } from "@/server/schemas";

import { buildModelContext } from "./context-builder";
import {
  loadModelContextSources,
  type LoadedModelContextSources,
} from "./context-data";
import {
  beginAiChatTurn,
  completeAiChatTurn,
  failAiChatTurn,
  type BeginAiChatTurnInput,
  type BeginAiChatTurnResult,
  type CompleteAiChatTurnInput,
  type FailAiChatTurnInput,
  type PersistedOocCheck,
} from "./chat-runtime-data";
import {
  recordAiRunMemoryRetrievals,
  type RecordAiRunMemoryRetrievalsInput,
} from "./chat-memory-retrieval-data";
import {
  buildOocCheckMessages,
  buildRewriteMessages,
  CHAT_GENERATION_PROMPT_VERSION,
  withGenerationSafetyBoundary,
} from "./chat-prompts";
import {
  DETERMINISTIC_HIGH_RISK_RESPONSE,
  hasExplicitImmediateSafetyRisk,
} from "./chat-safety";
import type { ModelAdapter } from "./model-adapter";
import { isModelAdapterError, ModelAdapterError } from "./model-errors";
import type { ModelContextMemoryRetriever } from "./memory-context-retrieval";
import type {
  ModelGenerationResponse,
  ModelStructuredResponse,
  ModelUsage,
} from "./model-types";
import { runOocGate, type OocGateCheckRecord } from "./ooc-gate";
import { createMiniMaxAdapter } from "./providers/minimax-adapter";
import { readMiniMaxConfig } from "./providers/minimax-config";

export interface DevelopmentChatTurnInput {
  user: User;
  roleId: string;
  conversationId: string;
  content: string;
  clientMessageId: string;
}

export type DevelopmentChatTurnResult =
  | {
      outcome: "completed" | "in-progress" | "blocked";
      userMessageId: string;
      assistantMessageId: string;
    }
  | {
      outcome: "failed";
      userMessageId?: string;
      assistantMessageId?: string;
    };

interface RuntimeDependencies {
  createAdapter: () => ModelAdapter;
  begin: (input: BeginAiChatTurnInput) => Promise<BeginAiChatTurnResult | null>;
  complete: (input: CompleteAiChatTurnInput) => Promise<boolean>;
  fail: (input: FailAiChatTurnInput) => Promise<boolean>;
  loadContext: typeof loadModelContextSources;
  memoryRetriever: ModelContextMemoryRetriever | null;
  includeSensitiveMemories: boolean;
  recordMemoryRetrievals: (input: RecordAiRunMemoryRetrievalsInput) => Promise<boolean>;
  createTraceId: () => string;
  now: () => number;
}

const defaultDependencies: RuntimeDependencies = {
  createAdapter: () => createMiniMaxAdapter(readMiniMaxConfig()),
  begin: beginAiChatTurn,
  complete: completeAiChatTurn,
  fail: failAiChatTurn,
  loadContext: loadModelContextSources,
  memoryRetriever: null,
  includeSensitiveMemories: false,
  recordMemoryRetrievals: recordAiRunMemoryRetrievals,
  createTraceId: () => crypto.randomUUID(),
  now: () => Date.now(),
};

interface UsageAccumulator {
  hasInput: boolean;
  hasOutput: boolean;
  inputTokens: number;
  outputTokens: number;
}

function addUsage(accumulator: UsageAccumulator, usage?: ModelUsage): void {
  if (usage?.inputTokens !== undefined) {
    accumulator.hasInput = true;
    accumulator.inputTokens += usage.inputTokens;
  }
  if (usage?.outputTokens !== undefined) {
    accumulator.hasOutput = true;
    accumulator.outputTokens += usage.outputTokens;
  }
}

function accumulatedInputTokens(accumulator: UsageAccumulator): number | null {
  return accumulator.hasInput ? accumulator.inputTokens : null;
}

function accumulatedOutputTokens(accumulator: UsageAccumulator): number | null {
  return accumulator.hasOutput ? accumulator.outputTokens : null;
}

function safeErrorCode(error: unknown): string {
  return isModelAdapterError(error) ? error.code : "internal";
}

function validateGenerationFinish(response: ModelGenerationResponse): void {
  if (response.finishReason === "stop" || response.finishReason === "unknown") return;
  throw new ModelAdapterError(
    response.finishReason === "content-filter" ? "rejected" : "invalid-output",
    "The model generation did not finish with a sendable response.",
  );
}

function persistedOocChecks(
  checks: readonly OocGateCheckRecord[],
  responses: ReadonlyMap<
    1 | 2,
    ModelStructuredResponse<ReturnType<typeof oocCheckOutputSchema.parse>>
  >,
): readonly PersistedOocCheck[] {
  return checks.flatMap((check) => {
    const response = responses.get(check.attemptNo);
    if (!response) return [];
    return [
      {
        attempt_no: check.attemptNo,
        verdict: check.policy.action,
        overall_score: check.policy.calculatedOverallScore,
        dimension_scores: check.policy.assessment.dimensionScores,
        failure_labels: [...check.policy.failureLabels],
        latency_ms: response.latencyMs,
      },
    ];
  });
}

async function persistFailure(
  dependencies: RuntimeDependencies,
  reservation: BeginAiChatTurnResult,
  userId: string,
  traceId: string,
  startedAt: number,
  usage: UsageAccumulator,
  input: {
    status: "blocked" | "failed";
    errorCode: string;
    checks?: readonly PersistedOocCheck[];
  },
): Promise<void> {
  if (!reservation.aiRunId) return;
  await dependencies.fail({
    userId,
    aiRunId: reservation.aiRunId,
    traceId,
    runStatus: input.status,
    errorCode: input.errorCode,
    latencyMs: Math.max(0, dependencies.now() - startedAt),
    inputTokens: accumulatedInputTokens(usage),
    outputTokens: accumulatedOutputTokens(usage),
    oocChecks: input.checks ?? [],
  });
}

function existingReservationResult(
  reservation: BeginAiChatTurnResult,
): DevelopmentChatTurnResult {
  if (reservation.runStatus === "blocked") {
    return {
      outcome: "blocked",
      userMessageId: reservation.userMessageId,
      assistantMessageId: reservation.assistantMessageId,
    };
  }
  return {
    outcome: reservation.runStatus === "completed" ? "completed" : "in-progress",
    userMessageId: reservation.userMessageId,
    assistantMessageId: reservation.assistantMessageId,
  };
}

async function persistMemoryRetrievalAudit(
  dependencies: RuntimeDependencies,
  input: {
    userId: string;
    aiRunId: string;
    traceId: string;
    roleId: string;
    sources: LoadedModelContextSources;
    includedMemoryIds: readonly string[];
  },
): Promise<boolean> {
  const audit = input.sources.memoryRetrievalAudit;
  if (!audit) return true;

  const sourceMemoryIds = new Set(input.sources.memories.map((memory) => memory.id));
  const retrievedMemoryIds = new Set(audit.matches.map((memory) => memory.memoryId));
  if (
    sourceMemoryIds.size !== input.sources.memories.length ||
    retrievedMemoryIds.size !== audit.matches.length ||
    sourceMemoryIds.size !== retrievedMemoryIds.size ||
    [...sourceMemoryIds].some((memoryId) => !retrievedMemoryIds.has(memoryId))
  ) {
    return false;
  }

  const includedMemoryIds = new Set(input.includedMemoryIds);
  if ([...includedMemoryIds].some((memoryId) => !retrievedMemoryIds.has(memoryId))) {
    return false;
  }

  return dependencies.recordMemoryRetrievals({
    userId: input.userId,
    aiRunId: input.aiRunId,
    traceId: input.traceId,
    roleId: input.roleId,
    embeddingProvider: audit.embeddingProvider,
    embeddingModel: audit.embeddingModel,
    sensitiveRetrievalAuthorized: audit.sensitiveRetrievalAuthorized,
    retrievals: audit.matches.map((memory) => ({
      memoryId: memory.memoryId,
      retrievalRank: memory.retrievalRank,
      similarity: memory.similarity,
      includedInContext: includedMemoryIds.has(memory.memoryId),
    })),
  });
}

/**
 * Executes one development-only MiniMax turn. It never returns a draft:
 * completion crosses the client boundary only after deterministic safety and
 * OOC checks have produced a persisted terminal state.
 */
export async function runMiniMaxDevelopmentChatTurn(
  input: DevelopmentChatTurnInput,
  overrides: Partial<RuntimeDependencies> = {},
): Promise<DevelopmentChatTurnResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const traceId = dependencies.createTraceId();
  const startedAt = dependencies.now();
  const usage: UsageAccumulator = {
    hasInput: false,
    hasOutput: false,
    inputTokens: 0,
    outputTokens: 0,
  };
  const isHighRisk = hasExplicitImmediateSafetyRisk(input.content);
  let adapter: ModelAdapter | null = null;

  if (!isHighRisk) {
    try {
      adapter = dependencies.createAdapter();
    } catch {
      return { outcome: "failed" };
    }
  }

  const reservation = await dependencies.begin({
    userId: input.user.id,
    roleId: input.roleId,
    conversationId: input.conversationId,
    content: input.content,
    clientMessageId: input.clientMessageId,
    runtime: isHighRisk ? "deterministic-safety" : "minimax-development",
    traceId,
  });
  if (!reservation) return { outcome: "failed" };
  if (!reservation.shouldGenerate || !reservation.aiRunId) {
    return existingReservationResult(reservation);
  }

  if (isHighRisk) {
    const completed = await dependencies.complete({
      userId: input.user.id,
      aiRunId: reservation.aiRunId,
      traceId,
      content: DETERMINISTIC_HIGH_RISK_RESPONSE,
      rewritten: false,
      latencyMs: Math.max(0, dependencies.now() - startedAt),
      inputTokens: null,
      outputTokens: null,
      oocChecks: [],
    });
    if (!completed) {
      await persistFailure(
        dependencies,
        reservation,
        input.user.id,
        traceId,
        startedAt,
        usage,
        {
          status: "failed",
          errorCode: "internal",
        },
      );
      return {
        outcome: "failed",
        userMessageId: reservation.userMessageId,
        assistantMessageId: reservation.assistantMessageId,
      };
    }
    return {
      outcome: "completed",
      userMessageId: reservation.userMessageId,
      assistantMessageId: reservation.assistantMessageId,
    };
  }

  if (
    reservation.provider !== adapter?.descriptor.providerId ||
    reservation.model !== adapter.descriptor.modelId
  ) {
    await persistFailure(
      dependencies,
      reservation,
      input.user.id,
      traceId,
      startedAt,
      usage,
      {
        status: "failed",
        errorCode: "configuration",
      },
    );
    return {
      outcome: "failed",
      userMessageId: reservation.userMessageId,
      assistantMessageId: reservation.assistantMessageId,
    };
  }

  let sources: LoadedModelContextSources;
  try {
    sources = await dependencies.loadContext({
      user: input.user,
      roleId: input.roleId,
      conversationId: input.conversationId,
      personaVersionId: reservation.personaVersionId,
      strategyVersionId: reservation.strategyVersionId,
      ...(dependencies.memoryRetriever
        ? {
            memoryRetrieval: {
              retriever: dependencies.memoryRetriever,
              query: input.content,
              includeSensitive: dependencies.includeSensitiveMemories,
              traceId,
            },
          }
        : {}),
    });
  } catch {
    await persistFailure(
      dependencies,
      reservation,
      input.user.id,
      traceId,
      startedAt,
      usage,
      {
        status: "failed",
        errorCode: "context-unavailable",
      },
    );
    return {
      outcome: "failed",
      userMessageId: reservation.userMessageId,
      assistantMessageId: reservation.assistantMessageId,
    };
  }

  const safeAdapter = adapter as ModelAdapter;
  const checkResponses = new Map<
    1 | 2,
    ModelStructuredResponse<ReturnType<typeof oocCheckOutputSchema.parse>>
  >();

  try {
    const context = buildModelContext(sources);
    const auditPersisted = await persistMemoryRetrievalAudit(dependencies, {
      userId: input.user.id,
      aiRunId: reservation.aiRunId,
      traceId,
      roleId: input.roleId,
      sources,
      includedMemoryIds: context.includedMemoryIds,
    });
    if (!auditPersisted) {
      throw new ModelAdapterError(
        "unavailable",
        "Memory retrieval audit is unavailable.",
      );
    }
    const generation = await safeAdapter.generate({
      messages: withGenerationSafetyBoundary(context),
      maxOutputTokens: 1_200,
      metadata: {
        feature: "chat",
        policyVersion: reservation.strategyVersionId,
        promptVersion: CHAT_GENERATION_PROMPT_VERSION,
        traceId,
      },
    });
    addUsage(usage, generation.usage);
    validateGenerationFinish(generation);

    const gate = await runOocGate(generation.text, {
      async checkDraft(draft, attemptNo) {
        try {
          const response = await safeAdapter.generateStructured({
            messages: buildOocCheckMessages({
              compiledSystemPrompt: sources.compiledSystemPrompt,
              latestUserMessage: input.content,
              draft,
            }),
            maxOutputTokens: 1_200,
            temperature: 0,
            outputName: "yanxing-ooc-check-v0.1",
            parse: (value) => oocCheckOutputSchema.parse(value),
            metadata: {
              feature: "ooc-check",
              policyVersion: reservation.strategyVersionId,
              promptVersion: "ooc-check-v0.1",
              traceId: `${traceId}:ooc:${attemptNo}`,
            },
          });
          addUsage(usage, response.usage);
          checkResponses.set(attemptNo, response);
          return response.output;
        } catch (error) {
          if (isModelAdapterError(error)) addUsage(usage, error.usage);
          throw error;
        }
      },
      async rewriteDraft(draft, instructions) {
        const response = await safeAdapter.generate({
          messages: buildRewriteMessages({ context, draft, instructions }),
          maxOutputTokens: 1_200,
          metadata: {
            feature: "chat",
            policyVersion: reservation.strategyVersionId,
            promptVersion: `${CHAT_GENERATION_PROMPT_VERSION}:rewrite`,
            traceId: `${traceId}:rewrite`,
          },
        });
        addUsage(usage, response.usage);
        validateGenerationFinish(response);
        return response.text;
      },
    });
    const checks = persistedOocChecks(gate.checks, checkResponses);

    if (gate.outcome === "blocked") {
      await persistFailure(
        dependencies,
        reservation,
        input.user.id,
        traceId,
        startedAt,
        usage,
        {
          status: "blocked",
          errorCode: "safety-blocked",
          checks,
        },
      );
      return {
        outcome: "blocked",
        userMessageId: reservation.userMessageId,
        assistantMessageId: reservation.assistantMessageId,
      };
    }
    if (gate.outcome === "failed") {
      await persistFailure(
        dependencies,
        reservation,
        input.user.id,
        traceId,
        startedAt,
        usage,
        {
          status: "failed",
          errorCode:
            gate.reason === "checker-unavailable"
              ? "ooc-checker-unavailable"
              : "ooc-rewrite-unavailable",
          checks,
        },
      );
      return {
        outcome: "failed",
        userMessageId: reservation.userMessageId,
        assistantMessageId: reservation.assistantMessageId,
      };
    }

    const completed = await dependencies.complete({
      userId: input.user.id,
      aiRunId: reservation.aiRunId,
      traceId,
      content: gate.finalDraft,
      rewritten: gate.rewritten,
      latencyMs: Math.max(0, dependencies.now() - startedAt),
      inputTokens: accumulatedInputTokens(usage),
      outputTokens: accumulatedOutputTokens(usage),
      oocChecks: checks,
    });
    if (!completed) {
      await persistFailure(
        dependencies,
        reservation,
        input.user.id,
        traceId,
        startedAt,
        usage,
        {
          status: "failed",
          errorCode: "internal",
          checks,
        },
      );
      return {
        outcome: "failed",
        userMessageId: reservation.userMessageId,
        assistantMessageId: reservation.assistantMessageId,
      };
    }

    return {
      outcome: "completed",
      userMessageId: reservation.userMessageId,
      assistantMessageId: reservation.assistantMessageId,
    };
  } catch (error) {
    await persistFailure(
      dependencies,
      reservation,
      input.user.id,
      traceId,
      startedAt,
      usage,
      {
        status: "failed",
        errorCode: safeErrorCode(error),
        checks: persistedOocChecks([], checkResponses),
      },
    );
    return {
      outcome: "failed",
      userMessageId: reservation.userMessageId,
      assistantMessageId: reservation.assistantMessageId,
    };
  }
}
