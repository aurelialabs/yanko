import { describe, expect, it } from "vitest";

import { applyPlanIntentPolicy } from "./plan-intent-policy";
import {
  PlanProposalPersistenceError,
  buildCreatePlanProposalRpcInput,
} from "./plan-proposal-service";

const source = {
  sourceRoleId: "52fc7ced-82cf-485c-92be-d119f1bb0c56",
  sourceMessageId: "e14607e4-f2a3-4250-89c3-23f7f88f54fa",
  idempotencyKey: "ca06a06b-a6e2-4685-a4d9-5667e473c544",
};

const explicitCreate = {
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

describe("plan proposal persistence boundary", () => {
  it("translates only an explicit confirmation-card result into RPC input", () => {
    const result = buildCreatePlanProposalRpcInput({
      ...source,
      policy: applyPlanIntentPolicy(explicitCreate),
    });

    expect(result).toEqual({
      p_source_role_id: source.sourceRoleId,
      p_source_message_id: source.sourceMessageId,
      p_scope: "day",
      p_suggested_title: "交材料",
      p_original_time_text: "明天下午三点",
      p_parsed_payload: explicitCreate.parsedPayload,
      p_missing_fields: [],
      p_confidence: 0.96,
      p_idempotency_key: source.idempotencyKey,
    });
  });

  it("does not persist an offer, even if it includes a plan-shaped draft", () => {
    const policy = applyPlanIntentPolicy({ ...explicitCreate, intent: "offer" });

    expect(() => buildCreatePlanProposalRpcInput({ ...source, policy })).toThrow(
      PlanProposalPersistenceError,
    );
  });

  it("does not persist exploratory goals or ordinary chat", () => {
    const exploratory = applyPlanIntentPolicy({
      ...explicitCreate,
      intent: "clarify",
      scope: "year",
      parsedPayload: { year: 2027 },
    });
    const ordinary = applyPlanIntentPolicy({
      ...explicitCreate,
      intent: "none",
      scope: null,
      title: null,
      parsedPayload: {},
    });

    expect(() =>
      buildCreatePlanProposalRpcInput({ ...source, policy: exploratory }),
    ).toThrow(PlanProposalPersistenceError);
    expect(() =>
      buildCreatePlanProposalRpcInput({ ...source, policy: ordinary }),
    ).toThrow(PlanProposalPersistenceError);
  });

  it("does not forward fields that the policy removed from a week draft", () => {
    const policy = applyPlanIntentPolicy({
      ...explicitCreate,
      scope: "week",
      parsedPayload: {
        weekStart: "2026-09-07",
        dueDate: "2026-09-12",
        scheduledAt: "2026-09-12T10:00:00+08:00",
        reminderAt: "2026-09-12T09:30:00+08:00",
      },
    });

    const result = buildCreatePlanProposalRpcInput({ ...source, policy });

    expect(result.p_parsed_payload).toEqual({
      weekStart: "2026-09-07",
      dueDate: "2026-09-12",
    });
  });
});
