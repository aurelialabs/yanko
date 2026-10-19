import "server-only";

import {
  emotionSignalOutputSchema,
  idempotencyKeySchema,
  uuidSchema,
  type EmotionSignalOutput,
} from "@/server/schemas";

import { hasExplicitImmediateSafetyRisk } from "./chat-safety";
import type { PersistedEmotionFollowup } from "./emotion-followup-data";
import { applyEmotionPolicy, type EmotionPolicyResult } from "./emotion-policy";
import type { ModelAdapter } from "./model-adapter";

export const EMOTION_SIGNAL_PROMPT_VERSION = "emotion-signal-v0.1";

export interface EmotionSignalContext {
  userId: string;
  roleId: string;
  sourceMessageId: string;
  sourceMessage: string;
}

export interface EmotionRuntimeInput {
  context: EmotionSignalContext;
  idempotencyKey: string;
  traceId?: string;
}

export type EmotionRuntimeErrorCode =
  "disabled" | "invalid-input" | "classifier-unavailable" | "persistence-unavailable";

export class EmotionRuntimeError extends Error {
  constructor(readonly code: EmotionRuntimeErrorCode) {
    super(code);
    this.name = "EmotionRuntimeError";
  }
}

export type EmotionRuntimeResult =
  | { outcome: "safety"; policy: EmotionPolicyResult }
  | { outcome: "support_only"; policy: EmotionPolicyResult }
  | {
      outcome: "followup_scheduled" | "followup_suppressed";
      policy: EmotionPolicyResult;
      followup: PersistedEmotionFollowup;
    };

export interface EmotionRuntimeDependencies {
  /** A future exact-job worker must opt in; ordinary chat sends never invoke this. */
  enabled?: boolean;
  adapter: ModelAdapter;
  persist?: (input: {
    userId: string;
    roleId: string;
    sourceMessageId: string;
    emotionType: EmotionSignalOutput["primaryEmotion"];
    intensity: number;
    idempotencyKey: string;
  }) => Promise<PersistedEmotionFollowup | null>;
}

function classifierSystemPrompt(): string {
  return [
    "你是言行的情绪信号分类器，只判断当前这一条用户消息。",
    "这不是心理诊断；不要推测用户未明确表达的经历、身份或原因。",
    "highRisk 仅用于明确、即时的自伤、伤人或生命危险；不确定时不要标记。",
    "只有强烈负面情绪且用户未处于高风险时，scheduleNextDayFollowup 才可以为 true。",
    "highRisk 为 true 或 supportMode 为 safety 时，scheduleNextDayFollowup 必须为 false。",
    "只输出结构化 JSON，不输出分析过程、建议或额外文本。",
  ].join("\n");
}

function classifierUserPrompt(context: EmotionSignalContext): string {
  return JSON.stringify({ userMessage: context.sourceMessage });
}

function deterministicSafetyPolicy(): EmotionPolicyResult {
  return {
    outcome: "safety",
    emotionType: "other",
    intensity: 1,
    supportMode: "safety",
  };
}

/**
 * Classifies one explicitly supplied source message. It is intentionally not
 * wired to chat submission: without `enabled: true` and an injected adapter,
 * it never sends text to a provider or creates a follow-up.
 */
export async function runEmotionSignal(
  input: EmotionRuntimeInput,
  dependencies: EmotionRuntimeDependencies,
): Promise<EmotionRuntimeResult> {
  const { context } = input;
  if (
    !uuidSchema.safeParse(context.userId).success ||
    !uuidSchema.safeParse(context.roleId).success ||
    !uuidSchema.safeParse(context.sourceMessageId).success ||
    !context.sourceMessage.trim() ||
    context.sourceMessage.length > 20_000 ||
    !idempotencyKeySchema.safeParse(input.idempotencyKey).success
  ) {
    throw new EmotionRuntimeError("invalid-input");
  }

  if (hasExplicitImmediateSafetyRisk(context.sourceMessage)) {
    return { outcome: "safety", policy: deterministicSafetyPolicy() };
  }
  if (!dependencies.enabled) {
    throw new EmotionRuntimeError("disabled");
  }

  let signal: EmotionSignalOutput;
  try {
    const response = await dependencies.adapter.generateStructured({
      messages: [
        { role: "system", content: classifierSystemPrompt() },
        { role: "user", content: classifierUserPrompt(context) },
      ],
      outputName: "emotion_signal_v0_1",
      maxOutputTokens: 400,
      temperature: 0,
      timeoutMs: 120_000,
      metadata: {
        feature: "emotion-signal",
        promptVersion: EMOTION_SIGNAL_PROMPT_VERSION,
        traceId: input.traceId,
      },
      parse: (value): EmotionSignalOutput => emotionSignalOutputSchema.parse(value),
    });
    signal = response.output;
  } catch {
    throw new EmotionRuntimeError("classifier-unavailable");
  }

  const policy = applyEmotionPolicy(signal);
  if (policy.outcome === "safety") return { outcome: "safety", policy };
  if (policy.outcome === "support_only") return { outcome: "support_only", policy };

  if (!dependencies.persist) {
    throw new EmotionRuntimeError("persistence-unavailable");
  }
  let followup: PersistedEmotionFollowup | null;
  try {
    followup = await dependencies.persist({
      userId: context.userId,
      roleId: context.roleId,
      sourceMessageId: context.sourceMessageId,
      emotionType: policy.emotionType,
      intensity: policy.intensity,
      idempotencyKey: input.idempotencyKey,
    });
  } catch {
    throw new EmotionRuntimeError("persistence-unavailable");
  }
  if (!followup) throw new EmotionRuntimeError("persistence-unavailable");

  return {
    outcome:
      followup.status === "scheduled" ? "followup_scheduled" : "followup_suppressed",
    policy,
    followup,
  };
}
