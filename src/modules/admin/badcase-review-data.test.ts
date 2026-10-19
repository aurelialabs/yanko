import { describe, expect, it } from "vitest";

import {
  parseBadcaseListFilter,
  toAdminBadcaseAiRunSummary,
  toAdminBadcaseDetail,
  toAdminBadcaseListItem,
  toAdminBadcaseOocCheckSummary,
} from "./badcase-review-data";

const id = "11111111-1111-4111-8111-111111111111";

describe("Badcase review DTO", () => {
  it("normalizes allowed filters and rejects unknown values", () => {
    expect(
      parseBadcaseListFilter({
        status: "triaged",
        severity: "high",
        source: "manual",
      }),
    ).toEqual({ status: "triaged", severity: "high", source: "manual" });
    expect(
      parseBadcaseListFilter({
        status: "unknown",
        severity: ["critical", "low"],
        source: "untrusted",
      }),
    ).toEqual({ status: "all", severity: "critical", source: "all" });
  });

  it("exposes only a bounded, already-redacted admin review DTO", () => {
    const item = toAdminBadcaseDetail({
      id,
      source_type: "persona_feedback",
      capability: "persona_response",
      severity: "high",
      status: "open",
      diagnosis: "诊断摘要",
      redacted_excerpt: "已脱敏片段",
      resolved_at: null,
      created_at: "2026-09-08T00:00:00.000Z",
      updated_at: "2026-09-08T01:00:00.000Z",
      review_revision: 2,
      user_id: "this field is deliberately ignored",
      ai_run_id: "this field is deliberately ignored",
      raw_model_output: "this field is deliberately ignored",
    });

    expect(item).toEqual({
      id,
      source: "persona_feedback",
      capability: "persona_response",
      severity: "high",
      status: "open",
      diagnosis: "诊断摘要",
      redactedExcerpt: "已脱敏片段",
      resolvedAt: null,
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T01:00:00.000Z",
      reviewRevision: 2,
      aiRun: null,
    });
    expect(item).not.toHaveProperty("userId");
    expect(item).not.toHaveProperty("aiRunId");
    expect(item).not.toHaveProperty("rawModelOutput");
  });

  it("keeps a valid list row when detail-only fields were not selected", () => {
    expect(
      toAdminBadcaseListItem({
        id,
        source_type: "manual",
        capability: "manual_review",
        severity: "critical",
        status: "open",
        redacted_excerpt: "已脱敏片段",
        created_at: "2026-09-08T00:00:00.000Z",
        updated_at: "2026-09-08T01:00:00.000Z",
        review_revision: 0,
      }),
    ).toEqual({
      id,
      source: "manual",
      capability: "manual_review",
      severity: "critical",
      status: "open",
      redactedExcerpt: "已脱敏片段",
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T01:00:00.000Z",
      reviewRevision: 0,
    });
  });

  it("drops malformed rows instead of exposing partial diagnostic data", () => {
    expect(
      toAdminBadcaseDetail({
        id,
        source_type: "manual",
        capability: "review",
        severity: "critical",
        status: "open",
        resolved_at: null,
        created_at: "not-a-date",
        updated_at: "2026-09-08T01:00:00.000Z",
        review_revision: 0,
      }),
    ).toBeNull();
  });

  it("keeps only bounded AI Run and OOC metadata", () => {
    const checkRow = {
      attempt_no: 1,
      verdict: "pass",
      overall_score: "0.92",
      failure_labels: [],
      latency_ms: 240,
      provider: "ignored",
      model: "ignored",
      dimension_scores: { hidden: "ignored" },
    };
    const check = toAdminBadcaseOocCheckSummary(checkRow);
    expect(check).toEqual({
      attemptNo: 1,
      verdict: "pass",
      overallScore: 0.92,
      failureLabels: [],
      latencyMs: 240,
    });
    const run = toAdminBadcaseAiRunSummary(
      {
        provider: "minimax",
        model: "MiniMax-M3",
        status: "completed",
        rewritten: false,
        attempt_no: 1,
        latency_ms: 1_200,
        input_tokens: 80,
        output_tokens: 120,
        error_code: null,
        started_at: "2026-09-08T00:00:00.000Z",
        completed_at: "2026-09-08T00:00:01.200Z",
        prompt: "must not be exposed",
        raw_output: "must not be exposed",
      },
      [checkRow],
    );

    expect(run).toEqual({
      provider: "minimax",
      model: "MiniMax-M3",
      status: "completed",
      rewritten: false,
      attemptNo: 1,
      latencyMs: 1_200,
      inputTokens: 80,
      outputTokens: 120,
      errorCode: null,
      startedAt: "2026-09-08T00:00:00.000Z",
      completedAt: "2026-09-08T00:00:01.200Z",
      oocChecks: [
        {
          attemptNo: 1,
          verdict: "pass",
          overallScore: 0.92,
          failureLabels: [],
          latencyMs: 240,
        },
      ],
    });
    expect(run).not.toHaveProperty("prompt");
    expect(run).not.toHaveProperty("rawOutput");
  });

  it("rejects malformed diagnostic metadata instead of showing partial fields", () => {
    expect(
      toAdminBadcaseAiRunSummary({
        provider: "minimax",
        model: "MiniMax-M3",
        status: "completed",
        rewritten: false,
        attempt_no: 1,
        latency_ms: -1,
        input_tokens: 1,
        output_tokens: 1,
        error_code: null,
        started_at: "2026-09-08T00:00:00.000Z",
        completed_at: null,
      }),
    ).toBeNull();
    expect(
      toAdminBadcaseOocCheckSummary({
        attempt_no: 1,
        verdict: "pass",
        overall_score: 2,
        failure_labels: [],
        latency_ms: 1,
      }),
    ).toBeNull();
  });
});
