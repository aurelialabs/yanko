import "server-only";

import {
  groundedMemoryExtractionOutputSchema,
  idempotencyKeySchema,
  uuidSchema,
  type GroundedMemoryExtractionOutput,
} from "@/server/schemas";

import { MEMORY_POLICY_VERSION, applyMemoryPolicy } from "./memory-policy";
import type { ModelAdapter } from "./model-adapter";
import type {
  MemoryExtractionContext,
  PersistedMemoryExtraction,
} from "./memory-extraction-data";

export const MEMORY_EXTRACTION_PROMPT_VERSION = "memory-extraction-v0.1-grounded";

export type MemoryExtractionRuntimeErrorCode =
  "disabled" | "invalid-input" | "extractor-unavailable" | "persistence-unavailable";

export class MemoryExtractionRuntimeError extends Error {
  constructor(readonly code: MemoryExtractionRuntimeErrorCode) {
    super(code);
    this.name = "MemoryExtractionRuntimeError";
  }
}

type GroundedCandidate = GroundedMemoryExtractionOutput["candidates"][number];

export interface MemoryExtractionRuntimeDependencies {
  /** Fail closed unless a future background worker enables this explicitly. */
  enabled?: boolean;
  adapter: ModelAdapter;
  persist?: (
    context: MemoryExtractionContext,
    policyVersion: string,
    idempotencyKey: string,
    operations: ReturnType<typeof applyMemoryPolicy>["operations"],
  ) => Promise<PersistedMemoryExtraction | null>;
  approveSharedScope?: (
    candidate: GroundedCandidate,
    context: MemoryExtractionContext,
  ) => boolean;
}

export interface MemoryExtractionRuntimeInput {
  context: MemoryExtractionContext;
  idempotencyKey: string;
  traceId?: string;
}

function extractionSystemPrompt(): string {
  return [
    "你是言行的长期记忆候选抽取器，只能提取用户本条消息明确说出的事实。",
    "不要推测原因、身份、诊断、关系或用户没有直接表达的事实。",
    "密码、验证码、支付凭证、访问令牌等必须标记 forbidden。",
    "用户明确要求不要记住时必须标记 ignore。",
    "家庭、关系、健康和重要情绪经历必须标记 sensitive、confirm、role_private。",
    "每个候选都必须给出本条用户消息中的一段逐字 evidenceQuote；不能提供逐字证据就标记 ignore。",
    "role_private 的 roleId 只能是当前角色 ID；user_shared 的 roleId 必须为 null。",
    "只输出结构化结果，不输出解释、分析过程或额外文本。",
  ].join("\n");
}

function extractionUserPrompt(context: MemoryExtractionContext): string {
  const comparableMemories = context.existingMemories
    .filter((memory) => memory.sensitivity === "normal")
    .slice(0, 50)
    .map((memory) => ({
      id: memory.id,
      scope: memory.scope,
      roleId: memory.roleId,
      category: memory.category,
      content: memory.content,
      normalizedKey: memory.normalizedKey,
      confirmedByUser: memory.confirmedByUser,
    }));

  return JSON.stringify({
    currentRole: { id: context.roleId, name: context.roleName },
    userMessage: context.sourceMessage,
    comparableActiveMemories: comparableMemories,
  });
}

function exactEvidence(
  context: MemoryExtractionContext,
  output: GroundedMemoryExtractionOutput,
  candidateIndex: number,
): boolean {
  const quote = output.candidates[candidateIndex]?.evidenceQuote.trim();
  return Boolean(quote && context.sourceMessage.includes(quote));
}

function policyOutput(output: GroundedMemoryExtractionOutput) {
  return {
    candidates: output.candidates.map((candidate) => ({
      action: candidate.action,
      scope: candidate.scope,
      roleId: candidate.roleId,
      category: candidate.category,
      content: candidate.content,
      normalizedKey: candidate.normalizedKey,
      sensitivity: candidate.sensitivity,
      confidence: candidate.confidence,
      supersedesMemoryId: candidate.supersedesMemoryId,
    })),
  };
}

/**
 * Runs the provider-neutral extraction boundary. It is not connected to chat
 * submission yet: a future authorized background worker must load one source
 * context, enable the dependency explicitly, and provide an approved adapter.
 */
export async function runMemoryExtraction(
  input: MemoryExtractionRuntimeInput,
  dependencies: MemoryExtractionRuntimeDependencies,
): Promise<PersistedMemoryExtraction> {
  if (!dependencies.enabled) {
    throw new MemoryExtractionRuntimeError("disabled");
  }

  const { context } = input;
  if (
    !uuidSchema.safeParse(context.userId).success ||
    !uuidSchema.safeParse(context.roleId).success ||
    !uuidSchema.safeParse(context.sourceMessageId).success ||
    !context.roleName.trim() ||
    !context.sourceMessage.trim() ||
    !idempotencyKeySchema.safeParse(input.idempotencyKey).success
  ) {
    throw new MemoryExtractionRuntimeError("invalid-input");
  }

  let extraction: GroundedMemoryExtractionOutput;
  try {
    const response = await dependencies.adapter.generateStructured({
      messages: [
        { role: "system", content: extractionSystemPrompt() },
        { role: "user", content: extractionUserPrompt(context) },
      ],
      outputName: "memory_extraction_grounded_v0_1",
      maxOutputTokens: 1_200,
      temperature: 0,
      timeoutMs: 120_000,
      metadata: {
        feature: "memory",
        policyVersion: MEMORY_POLICY_VERSION,
        promptVersion: MEMORY_EXTRACTION_PROMPT_VERSION,
        traceId: input.traceId,
      },
      parse: (value) => groundedMemoryExtractionOutputSchema.parse(value),
    });
    extraction = response.output;
  } catch {
    throw new MemoryExtractionRuntimeError("extractor-unavailable");
  }

  const policy = applyMemoryPolicy({
    currentUserId: context.userId,
    currentRoleId: context.roleId,
    sourceMessageId: context.sourceMessageId,
    rawExtractionOutput: policyOutput(extraction),
    existingMemories: context.existingMemories,
    hasExplicitUserEvidence: (_candidate, index) =>
      exactEvidence(context, extraction, index),
    isUserSharedScopeApproved: (candidate, index) =>
      Boolean(
        dependencies.approveSharedScope?.(
          extraction.candidates[index] ?? {
            ...candidate,
            evidenceQuote: "",
          },
          context,
        ),
      ),
  });

  const persist = dependencies.persist;
  if (!persist) {
    throw new MemoryExtractionRuntimeError("persistence-unavailable");
  }

  const result = await persist(
    context,
    policy.policyVersion,
    input.idempotencyKey,
    policy.operations,
  );
  if (!result) {
    throw new MemoryExtractionRuntimeError("persistence-unavailable");
  }

  return result;
}
