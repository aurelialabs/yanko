import { describe, expect, it } from "vitest";

import type { OocCheckOutput } from "@/server/schemas";

import { OocPolicyError, applyOocPolicy, calculateOocOverallScore } from "./ooc-policy";

const passingAssessment: OocCheckOutput = {
  verdict: "pass",
  overallScore: 0.99,
  dimensionScores: {
    identity: 0.9,
    personality: 0.9,
    speakingStyle: 0.9,
    preference: 0.9,
    memoryTruthfulness: 0.9,
    boundarySafety: 0.9,
    temporaryRoleplay: 0.9,
  },
  failureLabels: [],
  rewriteInstructions: [],
};

describe("applyOocPolicy", () => {
  it("passes only when the structured verdict and all PRD thresholds pass", () => {
    const result = applyOocPolicy(passingAssessment, 1);

    expect(result.action).toBe("pass");
    expect(result.calculatedOverallScore).toBeCloseTo(0.9);
    expect(result.reportedOverallScore).toBe(0.99);
    expect(result.belowCriticalDimensions).toEqual([]);
  });

  it("requires a rewrite when a critical dimension is below 80 even with a high reported score", () => {
    const result = applyOocPolicy(
      {
        ...passingAssessment,
        overallScore: 1,
        dimensionScores: { ...passingAssessment.dimensionScores, identity: 0.79 },
        rewriteInstructions: ["修正角色身份与背景表述。"],
      },
      1,
    );

    expect(result.action).toBe("rewrite");
    expect(result.belowCriticalDimensions).toEqual(["identity"]);
    expect(result.failureLabels).toContain("identity_below_threshold");
    expect(result.rewriteInstructions).toEqual(["修正角色身份与背景表述。"]);
  });

  it("blocks a PRD one-vote failure immediately", () => {
    const result = applyOocPolicy(
      {
        ...passingAssessment,
        verdict: "pass",
        failureLabels: ["exclusive_dependency_inducement"],
      },
      1,
    );

    expect(result.action).toBe("block");
    expect(result.hardFailureLabels).toEqual(["exclusive_dependency_inducement"]);
    expect(result.rewriteInstructions).toEqual([]);
  });

  it("blocks a second failed check instead of producing a second rewrite", () => {
    const result = applyOocPolicy(
      {
        ...passingAssessment,
        verdict: "rewrite",
        failureLabels: ["speaking_style_drift"],
      },
      2,
    );

    expect(result.action).toBe("block");
  });

  it("rejects malformed checker output before it reaches a user", () => {
    expect(() => applyOocPolicy({ verdict: "pass" }, 1)).toThrow(OocPolicyError);
  });

  it("uses the seven configured dimension weights", () => {
    expect(calculateOocOverallScore(passingAssessment)).toBeCloseTo(0.9);
  });
});
