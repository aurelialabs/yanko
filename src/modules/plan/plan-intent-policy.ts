import "server-only";

import {
  planClassifierOutputSchema,
  type PlanClassifierOutput,
} from "@/server/schemas";
import type { PlanScope } from "@/types/domain";

export const PLAN_INTENT_POLICY_VERSION = "v0.1";

export type PlanFlowAction =
  "none" | "show_confirmation_card" | "ask_to_create" | "explore_first_step";

export interface PlanDraftForConfirmation {
  scope: PlanScope;
  title: string | null;
  originalTimeText: string | null;
  parsedPayload: Readonly<Record<string, unknown>>;
  missingFields: readonly string[];
  ignoredPayloadKeys: readonly string[];
}

export interface PlanIntentPolicyResult {
  policyVersion: typeof PLAN_INTENT_POLICY_VERSION;
  flowAction: PlanFlowAction;
  intent: PlanClassifierOutput["intent"];
  confidence: number;
  /** Server-side diagnostics only. Do not render model reasoning as user copy. */
  reasoningLabel: string;
  draft: PlanDraftForConfirmation | null;
}

export class PlanIntentPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanIntentPolicyError";
  }
}

const PAYLOAD_KEYS_BY_SCOPE: Readonly<Record<PlanScope, readonly string[]>> = {
  day: ["date", "scheduledAt", "reminderAt"],
  week: ["weekStart", "dueDate"],
  month: ["month", "dueDate"],
  year: ["year", "parentPlanId", "dueDate"],
};

function normalizedText(value: string | null): string | null {
  if (value === null) return null;

  const normalized = value.trim();
  return normalized || null;
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sanitizedPayload(
  payload: Record<string, unknown>,
  scope: PlanScope,
): Pick<PlanDraftForConfirmation, "parsedPayload" | "ignoredPayloadKeys"> {
  const allowedKeys = new Set(PAYLOAD_KEYS_BY_SCOPE[scope]);
  const parsedPayload: Record<string, unknown> = {};
  const ignoredPayloadKeys: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (allowedKeys.has(key)) {
      parsedPayload[key] = value;
    } else {
      ignoredPayloadKeys.push(key);
    }
  }

  return { parsedPayload, ignoredPayloadKeys };
}

function toDraft(output: PlanClassifierOutput): PlanDraftForConfirmation {
  if (output.scope === null) {
    throw new PlanIntentPolicyError("A plan flow requires a plan scope.");
  }

  const title = normalizedText(output.title);
  const payload = sanitizedPayload(output.parsedPayload, output.scope);
  const missingFields = uniqueNonEmpty([
    ...output.missingFields,
    ...(title === null ? ["title"] : []),
  ]);

  return {
    scope: output.scope,
    title,
    originalTimeText: normalizedText(output.originalTimeText),
    parsedPayload: payload.parsedPayload,
    missingFields,
    ignoredPayloadKeys: payload.ignoredPayloadKeys,
  };
}

/**
 * Converts one untrusted structured classification into a UI-safe plan flow.
 * This policy never creates a formal plan, writes a proposal, schedules a
 * reminder, or claims success. A later persistence layer may only use the
 * final fields after the user has confirmed the editable card.
 */
export function applyPlanIntentPolicy(rawOutput: unknown): PlanIntentPolicyResult {
  const parsed = planClassifierOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    throw new PlanIntentPolicyError(
      "Plan classifier returned invalid structured output.",
    );
  }

  const output = parsed.data;
  const base = {
    policyVersion: PLAN_INTENT_POLICY_VERSION,
    intent: output.intent,
    confidence: output.confidence,
    reasoningLabel: output.reasoningLabel,
  } as const;

  if (output.intent === "none") {
    return { ...base, flowAction: "none", draft: null };
  }

  const draft = toDraft(output);

  if (output.intent === "create") {
    return { ...base, flowAction: "show_confirmation_card", draft };
  }

  if (output.intent === "offer") {
    return { ...base, flowAction: "ask_to_create", draft };
  }

  return { ...base, flowAction: "explore_first_step", draft };
}
