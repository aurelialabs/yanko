import { describe, expect, it } from "vitest";

import {
  PLAN_INTENT_POLICY_VERSION,
  PlanIntentPolicyError,
  applyPlanIntentPolicy,
} from "./plan-intent-policy";

const dayCreate = {
  intent: "create",
  scope: "day",
  confidence: 0.96,
  title: "交材料",
  originalTimeText: "明天下午三点",
  parsedPayload: {
    date: "2026-09-02",
    scheduledAt: "2026-09-02T15:00:00+08:00",
    reminderAt: "2026-09-02T14:30:00+08:00",
  },
  missingFields: [],
  reasoningLabel: "明确要求提醒",
};

describe("applyPlanIntentPolicy", () => {
  it("shows an editable confirmation card for explicit creation without writing a plan", () => {
    expect(applyPlanIntentPolicy(dayCreate)).toEqual({
      policyVersion: PLAN_INTENT_POLICY_VERSION,
      flowAction: "show_confirmation_card",
      intent: "create",
      confidence: 0.96,
      reasoningLabel: "明确要求提醒",
      draft: {
        scope: "day",
        title: "交材料",
        originalTimeText: "明天下午三点",
        parsedPayload: dayCreate.parsedPayload,
        missingFields: [],
        ignoredPayloadKeys: [],
      },
    });
  });

  it("asks before showing a card for an offer, even at high confidence", () => {
    const result = applyPlanIntentPolicy({
      ...dayCreate,
      intent: "offer",
      confidence: 0.99,
      title: "去银行补办卡",
    });

    expect(result).toMatchObject({
      flowAction: "ask_to_create",
      intent: "offer",
      draft: { title: "去银行补办卡" },
    });
  });

  it("routes an exploratory goal to first-step exploration instead of creation", () => {
    const result = applyPlanIntentPolicy({
      ...dayCreate,
      intent: "clarify",
      scope: "year",
      title: null,
      parsedPayload: { year: 2027 },
      missingFields: ["first_step"],
    });

    expect(result).toMatchObject({
      flowAction: "explore_first_step",
      intent: "clarify",
      draft: {
        scope: "year",
        title: null,
        missingFields: ["first_step", "title"],
      },
    });
  });

  it("returns no draft for ordinary, negated, completed, hypothetical, or reported speech", () => {
    const result = applyPlanIntentPolicy({
      ...dayCreate,
      intent: "none",
      scope: null,
      title: null,
      parsedPayload: {},
      missingFields: [],
    });

    expect(result).toMatchObject({ flowAction: "none", intent: "none", draft: null });
  });

  it("removes forbidden time fields from week and month drafts", () => {
    const result = applyPlanIntentPolicy({
      ...dayCreate,
      scope: "week",
      parsedPayload: {
        weekStart: "2026-09-07",
        dueDate: "2026-09-12",
        scheduledAt: "2026-09-12T10:00:00+08:00",
        reminderAt: "2026-09-12T09:30:00+08:00",
      },
    });

    expect(result.draft).toMatchObject({
      parsedPayload: { weekStart: "2026-09-07", dueDate: "2026-09-12" },
      ignoredPayloadKeys: ["scheduledAt", "reminderAt"],
    });
  });

  it("fails closed for malformed classifier output", () => {
    expect(() => applyPlanIntentPolicy({ intent: "create" })).toThrow(
      PlanIntentPolicyError,
    );
  });
});
