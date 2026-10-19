import "server-only";

import {
  ianaTimezoneSchema,
  idempotencyKeySchema,
  planClassifierOutputSchema,
  uuidSchema,
  type PlanClassifierOutput,
} from "@/server/schemas";

import type { ModelAdapter } from "../ai/model-adapter";
import type {
  PersistedPlanExtraction,
  PlanExtractionContext,
  PlanExtractionModelMetadata,
} from "./plan-extraction-data";
import {
  applyPlanIntentPolicy,
  type PlanIntentPolicyResult,
} from "./plan-intent-policy";

export const PLAN_EXTRACTION_PROMPT_VERSION = "plan-extraction-v0.1-grounded";

export type PlanExtractionRuntimeErrorCode =
  "disabled" | "invalid-input" | "classifier-unavailable" | "persistence-unavailable";

export class PlanExtractionRuntimeError extends Error {
  constructor(readonly code: PlanExtractionRuntimeErrorCode) {
    super(code);
    this.name = "PlanExtractionRuntimeError";
  }
}

export interface PlanExtractionRuntimeDependencies {
  /** Fail closed unless an authorized event consumer enables one exact job. */
  enabled?: boolean;
  adapter: ModelAdapter;
  persist?: (
    context: PlanExtractionContext,
    policy: PlanIntentPolicyResult,
    promptVersion: string,
    idempotencyKey: string,
    model: PlanExtractionModelMetadata,
  ) => Promise<PersistedPlanExtraction | null>;
}

export interface PlanExtractionRuntimeInput {
  context: PlanExtractionContext;
  idempotencyKey: string;
  now: Date;
  traceId?: string;
}

function classifierSystemPrompt(): string {
  return [
    "你是言行的计划意图分类器，只判断当前这一条用户消息。",
    "create：用户明确要求创建、加入、安排计划或提醒。",
    "offer：消息里存在可执行任务，但用户没有要求创建计划。",
    "clarify：用户表达模糊或长期目标，需要先探索一个可执行的第一步。",
    "none：否定、不想创建、已经完成、假设、转述他人、引用内容或普通聊天。",
    "只有日计划可以输出 scheduledAt 和 reminderAt；周计划和月计划不得输出具体时间或提醒。",
    "originalTimeText 必须是当前用户消息中的逐字连续片段；没有逐字片段就返回 null。",
    "日期字段必须使用 YYYY-MM-DD，月份使用 YYYY-MM，时间戳必须带时区偏移。",
    "不要输出思维过程；reasoningLabel 只能是简短机器标签。",
    "只输出符合结构的 JSON，不输出解释、Markdown 或额外文本。",
  ].join("\n");
}

function classifierUserPrompt(context: PlanExtractionContext, now: Date): string {
  return JSON.stringify({
    currentTimeUtc: now.toISOString(),
    accountTimezone: context.timezone,
    currentRole: { id: context.roleId, name: context.roleName },
    userMessage: context.sourceMessage,
  });
}

function safeMetric(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function groundedPolicy(
  policy: PlanIntentPolicyResult,
  sourceMessage: string,
): PlanIntentPolicyResult {
  const draft = policy.draft;
  if (!draft?.originalTimeText || sourceMessage.includes(draft.originalTimeText)) {
    return policy;
  }

  return {
    ...policy,
    draft: { ...draft, originalTimeText: null },
  };
}

/**
 * Classifies one message with the same prompt and policy as the signed-in
 * extractor, without writing a proposal. Callers still have to wait for an
 * explicit user confirmation before creating a plan.
 */
export async function classifyPlanMessage(
  input: {
    roleName: string;
    sourceMessage: string;
    timezone?: string;
    now?: Date;
  },
  adapter: ModelAdapter,
): Promise<PlanIntentPolicyResult | null> {
  const sourceMessage = input.sourceMessage.trim();
  const roleName = input.roleName.trim();
  const now = input.now ?? new Date();
  if (!sourceMessage || !roleName || !Number.isFinite(now.getTime())) return null;

  try {
    const response = await adapter.generate({
      messages: [
        { role: "system", content: classifierSystemPrompt() },
        {
          role: "user",
          content: classifierUserPrompt(
            {
              userId: "demo",
              roleId: "demo",
              roleName,
              sourceMessageId: "demo",
              sourceMessage,
              timezone: input.timezone ?? "Asia/Shanghai",
            },
            now,
          ),
        },
      ],
      maxOutputTokens: 800,
      temperature: 0,
      timeoutMs: 60_000,
      metadata: {
        feature: "plan-extraction",
        promptVersion: PLAN_EXTRACTION_PROMPT_VERSION,
      },
    });
    return groundedPolicy(
      applyPlanIntentPolicy(parseClassifierJson(response.text)),
      sourceMessage,
    );
  } catch {
    return null;
  }
}

function parseClassifierJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new PlanExtractionRuntimeError("classifier-unavailable");
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/**
 * Classifies one explicitly loaded message and persists only policy-clean
 * fields. It never scans history, creates a formal plan, or selects a provider.
 */
export async function runPlanExtraction(
  input: PlanExtractionRuntimeInput,
  dependencies: PlanExtractionRuntimeDependencies,
): Promise<PersistedPlanExtraction> {
  if (!dependencies.enabled) {
    throw new PlanExtractionRuntimeError("disabled");
  }

  const { context } = input;
  if (
    !uuidSchema.safeParse(context.userId).success ||
    !uuidSchema.safeParse(context.roleId).success ||
    !uuidSchema.safeParse(context.sourceMessageId).success ||
    !context.roleName.trim() ||
    !context.sourceMessage.trim() ||
    !ianaTimezoneSchema.safeParse(context.timezone).success ||
    !idempotencyKeySchema.safeParse(input.idempotencyKey).success ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new PlanExtractionRuntimeError("invalid-input");
  }

  let output: PlanClassifierOutput;
  let policy: PlanIntentPolicyResult;
  let model: PlanExtractionModelMetadata;
  try {
    const response = await dependencies.adapter.generateStructured({
      messages: [
        { role: "system", content: classifierSystemPrompt() },
        { role: "user", content: classifierUserPrompt(context, input.now) },
      ],
      outputName: "plan_extraction_grounded_v0_1",
      maxOutputTokens: 800,
      temperature: 0,
      timeoutMs: 120_000,
      metadata: {
        feature: "plan-extraction",
        promptVersion: PLAN_EXTRACTION_PROMPT_VERSION,
        traceId: input.traceId,
      },
      parse: (value) => planClassifierOutputSchema.parse(value),
    });
    output = response.output;
    policy = groundedPolicy(applyPlanIntentPolicy(output), context.sourceMessage);
    model = {
      providerId: response.providerId,
      modelId: response.modelId,
      latencyMs: safeMetric(response.latencyMs),
      inputTokens: safeMetric(response.usage?.inputTokens),
      outputTokens: safeMetric(response.usage?.outputTokens),
    };
  } catch {
    throw new PlanExtractionRuntimeError("classifier-unavailable");
  }

  if (!dependencies.persist) {
    throw new PlanExtractionRuntimeError("persistence-unavailable");
  }

  try {
    const result = await dependencies.persist(
      context,
      policy,
      PLAN_EXTRACTION_PROMPT_VERSION,
      input.idempotencyKey,
      model,
    );
    if (result) return result;
  } catch {
    // Provider and database details must not cross the runtime boundary.
  }

  throw new PlanExtractionRuntimeError("persistence-unavailable");
}
