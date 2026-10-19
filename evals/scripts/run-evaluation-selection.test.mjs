import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const runnerPath = resolve(projectRoot, "evals/scripts/run-evaluation.mjs");

function createTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "yanko-eval-selection-"));
}

function runSelection(outputPath, caseIds) {
  const args = [
    runnerPath,
    "--output",
    outputPath,
    "--split",
    "dev",
    "--prompt-version",
    "selection-test",
    "--policy-version",
    "selection-test",
  ];
  for (const caseId of caseIds) {
    args.push("--case-id", caseId);
  }

  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

describe("run-evaluation case selection", () => {
  it("runs only repeated exact case IDs and records them in the summary", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const outputPath = join(temporaryDirectory, "selection.jsonl");
    const caseIds = ["v0_1_plan_classification_001", "v0_1_plan_extraction_003"];

    try {
      const result = runSelection(outputPath, caseIds);
      expect(result.status).toBe(0);

      const records = readFileSync(outputPath, "utf8")
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line));
      expect(records.map((record) => record.caseId)).toEqual(caseIds);

      const summary = JSON.parse(readFileSync(`${outputPath}.summary.json`, "utf8"));
      expect(summary.selectedCaseIds).toEqual(caseIds);
      expect(summary.totalCases).toBe(2);
      expect(summary.runId).toMatch(/^eval-[a-f0-9]{16}$/u);
      expect(summary.configurationFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(Date.parse(summary.runStartedAt)).not.toBeNaN();
      expect(Date.parse(summary.runCompletedAt)).not.toBeNaN();
      expect(Date.parse(summary.runCompletedAt)).toBeGreaterThanOrEqual(
        Date.parse(summary.runStartedAt),
      );
      expect(
        records.every(
          (record) =>
            record.runId === summary.runId &&
            record.configurationFingerprint === summary.configurationFingerprint &&
            record.runStartedAt === summary.runStartedAt,
        ),
      ).toBe(true);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("creates unique run IDs while preserving the configuration fingerprint", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const firstOutputPath = join(temporaryDirectory, "first.jsonl");
    const secondOutputPath = join(temporaryDirectory, "second.jsonl");
    const caseIds = ["v0_1_persona_response_001"];

    try {
      const firstResult = runSelection(firstOutputPath, caseIds);
      const secondResult = runSelection(secondOutputPath, caseIds);
      expect(firstResult.status).toBe(0);
      expect(secondResult.status).toBe(0);

      const firstSummary = JSON.parse(
        readFileSync(`${firstOutputPath}.summary.json`, "utf8"),
      );
      const secondSummary = JSON.parse(
        readFileSync(`${secondOutputPath}.summary.json`, "utf8"),
      );

      expect(firstSummary.runId).not.toBe(secondSummary.runId);
      expect(firstSummary.configurationFingerprint).toBe(
        secondSummary.configurationFingerprint,
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing report or summary", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const existingReportPath = join(temporaryDirectory, "existing-report.jsonl");
    const reservedSummaryOutputPath = join(
      temporaryDirectory,
      "reserved-summary.jsonl",
    );

    try {
      writeFileSync(existingReportPath, "keep-report\n", "utf8");
      const reportResult = runSelection(existingReportPath, [
        "v0_1_persona_response_001",
      ]);
      expect(reportResult.status).not.toBe(0);
      expect(reportResult.stderr).toContain(
        "Refusing to overwrite existing evaluation artifact",
      );
      expect(readFileSync(existingReportPath, "utf8")).toBe("keep-report\n");

      writeFileSync(
        `${reservedSummaryOutputPath}.summary.json`,
        "keep-summary\n",
        "utf8",
      );
      const summaryResult = runSelection(reservedSummaryOutputPath, [
        "v0_1_persona_response_001",
      ]);
      expect(summaryResult.status).not.toBe(0);
      expect(summaryResult.stderr).toContain(
        "Refusing to overwrite existing evaluation artifact",
      );
      expect(existsSync(reservedSummaryOutputPath)).toBe(false);
      expect(readFileSync(`${reservedSummaryOutputPath}.summary.json`, "utf8")).toBe(
        "keep-summary\n",
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("fails closed when a case is absent from the selected split", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const outputPath = join(temporaryDirectory, "missing.jsonl");

    try {
      const result = runSelection(outputPath, ["v0_1_safety_response_missing"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Requested case IDs were not found in the selected split",
      );
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
