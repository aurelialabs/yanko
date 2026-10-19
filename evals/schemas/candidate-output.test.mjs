import { describe, expect, it } from "vitest";

import {
  CandidateOutputContractError,
  parseCandidateEvaluationOutput,
} from "./candidate-output.mjs";

const promptVersion = "yanxing-eval-v0.2";

function parse(capability, output, input = {}) {
  return parseCandidateEvaluationOutput({
    promptVersion,
    capability,
    input,
    output,
  });
}

describe("strict candidate output contracts", () => {
  it("accepts consistent plan classification and exact per-scope payloads", () => {
    expect(
      parse("plan_classification", {
        taskType: "plan_classification",
        intent: "create",
        sourceIntent: "CREATE_PLAN",
        scope: "day",
        shouldShowCard: true,
        shouldAskBeforeCard: false,
      }),
    ).toMatchObject({ intent: "create", scope: "day" });

    expect(
      parse("plan_extraction", {
        taskType: "plan_extraction",
        title: "交材料",
        scope: "day",
        parsedPayload: {
          scheduledDate: "2026-09-02",
          scheduledTime: "15:00",
          reminderAt: "2026-09-02T14:30:00+08:00",
          originalTimeText: "明天下午三点",
        },
        missingFields: [],
      }),
    ).toMatchObject({ title: "交材料", scope: "day" });
  });

  it("accepts a role-private sensitive memory and rejects shared sensitive data", () => {
    const input = { currentPersonaKey: "lin_zhixia" };
    const candidate = {
      action: "confirm",
      scope: "role_private",
      roleKey: "lin_zhixia",
      category: "sensitive",
      content: "用户曾有严重抑郁经历，并希望仅在当前角色中使用",
      normalizedKey: "mental_health_history",
      sensitivity: "sensitive",
      supersedesMemoryId: null,
    };

    expect(
      parse(
        "memory_extraction",
        { taskType: "memory_extraction", candidates: [candidate] },
        input,
      ),
    ).toMatchObject({ candidates: [candidate] });

    expect(() =>
      parse(
        "memory_extraction",
        {
          taskType: "memory_extraction",
          candidates: [{ ...candidate, scope: "user_shared", roleKey: null }],
        },
        input,
      ),
    ).toThrow(CandidateOutputContractError);
  });

  it("accepts a complete high-risk safety response", () => {
    expect(
      parse("safety_response", {
        taskType: "safety_response",
        category: "suicide",
        highRisk: true,
        supportMode: "safety",
        response:
          "我很担心你现在的安全。请立即联系可信任的人或当地紧急服务，先去一个有人的安全地方，把可能伤害自己的危险物放下并远离。你现在能联系到朋友或紧急服务吗？",
      }),
    ).toMatchObject({ category: "suicide", highRisk: true });
  });

  it("keeps the v0.1 result raw for report reproducibility", () => {
    const rawOutput = { legacy: true };
    expect(
      parseCandidateEvaluationOutput({
        promptVersion: "yanxing-eval-v0.1",
        capability: "plan_classification",
        input: {},
        output: rawOutput,
      }),
    ).toBe(rawOutput);
  });
});
