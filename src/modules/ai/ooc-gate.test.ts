import { describe, expect, it, vi } from "vitest";

import { runOocGate } from "./ooc-gate";

const passingAssessment = {
  verdict: "pass",
  overallScore: 0.9,
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

const rewriteAssessment = {
  ...passingAssessment,
  verdict: "rewrite",
  failureLabels: ["speaking_style_drift"],
  rewriteInstructions: ["使用当前角色的稳定说话方式重写。"],
};

describe("runOocGate", () => {
  it("returns only a first-pass checked draft", async () => {
    const checkDraft = vi.fn().mockResolvedValue(passingAssessment);
    const rewriteDraft = vi.fn();

    await expect(
      runOocGate("已校验的初稿", { checkDraft, rewriteDraft }),
    ).resolves.toMatchObject({
      outcome: "pass",
      finalDraft: "已校验的初稿",
      rewritten: false,
    });
    expect(checkDraft).toHaveBeenCalledTimes(1);
    expect(rewriteDraft).not.toHaveBeenCalled();
  });

  it("rewrites once and returns only the second checked draft", async () => {
    const checkDraft = vi
      .fn()
      .mockResolvedValueOnce(rewriteAssessment)
      .mockResolvedValueOnce(passingAssessment);
    const rewriteDraft = vi.fn().mockResolvedValue("通过重写的回复");

    const result = await runOocGate("初稿", { checkDraft, rewriteDraft });

    expect(result).toMatchObject({
      outcome: "pass",
      finalDraft: "通过重写的回复",
      rewritten: true,
    });
    expect(checkDraft).toHaveBeenNthCalledWith(1, "初稿", 1);
    expect(checkDraft).toHaveBeenNthCalledWith(2, "通过重写的回复", 2);
    expect(rewriteDraft).toHaveBeenCalledTimes(1);
  });

  it("blocks a failed second check and never returns either draft", async () => {
    const checkDraft = vi.fn().mockResolvedValue(rewriteAssessment);
    const rewriteDraft = vi.fn().mockResolvedValue("仍不符合要求的重写稿");

    const result = await runOocGate("初稿", { checkDraft, rewriteDraft });

    expect(result).toMatchObject({ outcome: "blocked", rewritten: true });
    expect(result).not.toHaveProperty("finalDraft");
    expect(rewriteDraft).toHaveBeenCalledTimes(1);
  });

  it("fails closed without retrying a checker failure", async () => {
    const checkDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(passingAssessment);
    const rewriteDraft = vi.fn();

    const result = await runOocGate("初稿", { checkDraft, rewriteDraft });

    expect(result).toEqual({
      outcome: "failed",
      reason: "checker-unavailable",
      rewritten: false,
      checks: [],
    });
    expect(checkDraft).toHaveBeenCalledTimes(1);
  });

  it("does not retry a structured checker error", async () => {
    const checkDraft = vi
      .fn()
      .mockResolvedValueOnce({ ...passingAssessment, verdict: "error" })
      .mockResolvedValueOnce(passingAssessment);
    const rewriteDraft = vi.fn();

    const result = await runOocGate("初稿", { checkDraft, rewriteDraft });

    expect(result).toEqual({
      outcome: "failed",
      reason: "checker-unavailable",
      rewritten: false,
      checks: [],
    });
    expect(checkDraft).toHaveBeenCalledTimes(1);
    expect(rewriteDraft).not.toHaveBeenCalled();
  });

  it("fails closed after one checker exception", async () => {
    const checkDraft = vi.fn().mockRejectedValue(new Error("unavailable"));
    const rewriteDraft = vi.fn();

    await expect(runOocGate("初稿", { checkDraft, rewriteDraft })).resolves.toEqual({
      outcome: "failed",
      reason: "checker-unavailable",
      rewritten: false,
      checks: [],
    });
    expect(checkDraft).toHaveBeenCalledTimes(1);
    expect(rewriteDraft).not.toHaveBeenCalled();
  });
});
