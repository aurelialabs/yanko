import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const builderPath = resolve(projectRoot, "evals/scripts/build-blind-review-packet.mjs");
const analyzerPath = resolve(projectRoot, "evals/scripts/analyze-blind-review.mjs");
const candidatePaths = [
  "evals/reports/qwen-turbo-v0.1-dev-v3.jsonl",
  "evals/reports/deepseek-v4-flash-v0.1-dev-v3.jsonl",
  "evals/reports/minimax-m3-v0.1-dev-v3-rerun1.jsonl",
];

function createTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "yanko-blind-analysis-"));
}

function buildPacket(outputDirectory) {
  const args = [builderPath, "--output-dir", outputDirectory];
  for (const path of candidatePaths) {
    args.push("--candidate", path);
  }
  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

function completeForm(contents, annotatorId) {
  return contents
    .split(/\r?\n/u)
    .map((line) => {
      if (line.startsWith("标注者 ID：")) {
        return `标注者 ID：${annotatorId}  `;
      }
      if (line.startsWith("完成时间：")) {
        return "完成时间：2026-09-04T08:00:00+08:00";
      }
      if (/^\| [A-C] \|\s*\|/u.test(line)) {
        return line.replace(
          /^\| ([A-C]) \|.*$/u,
          "| $1 | 否 | 3 | 3 | 3 | 3 | 3 | 3 | 75 | 合成测试 |",
        );
      }
      return line;
    })
    .join("\n")
    .replaceAll("偏好顺序（不可并列）：________", (match, offset, fullText) => {
      const blockStart = fullText.lastIndexOf("\n### ", offset);
      const block = fullText.slice(blockStart, offset);
      const labels = [...block.matchAll(/^\| ([A-C]) \|/gmu)].map((entry) => entry[1]);
      return `偏好顺序（不可并列）：${labels.join(">")}`;
    })
    .replaceAll("需要复核：是 / 否", "需要复核：否");
}

function analyze(packetDirectory, annotatorAPath, annotatorBPath, outputPath) {
  return spawnSync(
    process.execPath,
    [
      analyzerPath,
      "--packet",
      join(packetDirectory, "blind-review-packet.jsonl"),
      "--annotator",
      annotatorAPath,
      "--annotator",
      annotatorBPath,
      "--mapping",
      join(packetDirectory, "candidate.blind-map.local.json"),
      "--output",
      outputPath,
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

describe("analyze-blind-review", () => {
  it("validates complete forms and produces an unblinded analysis", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const packetDirectory = join(temporaryDirectory, "packet");
    const annotatorAPath = join(temporaryDirectory, "completed-a.md");
    const annotatorBPath = join(temporaryDirectory, "completed-b.md");
    const outputPath = join(temporaryDirectory, "results.json");

    try {
      expect(buildPacket(packetDirectory).status).toBe(0);
      writeFileSync(
        annotatorAPath,
        completeForm(
          readFileSync(join(packetDirectory, "annotator-a.md"), "utf8"),
          "reviewer-a",
        ),
        "utf8",
      );
      writeFileSync(
        annotatorBPath,
        completeForm(
          readFileSync(join(packetDirectory, "annotator-b.md"), "utf8"),
          "reviewer-b",
        ),
        "utf8",
      );

      const processResult = analyze(
        packetDirectory,
        annotatorAPath,
        annotatorBPath,
        outputPath,
      );
      expect(processResult.status).toBe(0);

      const analysis = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(analysis.annotators).toEqual(["reviewer-a", "reviewer-b"]);
      expect(analysis.candidates).toHaveLength(3);
      expect(analysis.agreement.topChoiceAgreementRate).toBe(1);
      expect(analysis.agreement.hardFailureAgreementRate).toBe(1);
      expect(analysis.adjudicationItems).toEqual([]);
      expect(readFileSync(`${outputPath}.review.md`, "utf8")).toContain(
        "双人盲标解盲分析",
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects incomplete forms before reading the private mapping", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const packetDirectory = join(temporaryDirectory, "packet");
    const outputPath = join(temporaryDirectory, "results.json");

    try {
      expect(buildPacket(packetDirectory).status).toBe(0);
      const processResult = spawnSync(
        process.execPath,
        [
          analyzerPath,
          "--packet",
          join(packetDirectory, "blind-review-packet.jsonl"),
          "--annotator",
          join(packetDirectory, "annotator-a.md"),
          "--annotator",
          join(packetDirectory, "annotator-b.md"),
          "--mapping",
          join(packetDirectory, "missing-map.json"),
          "--output",
          outputPath,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );

      expect(processResult.status).not.toBe(0);
      expect(processResult.stderr).toContain("is missing annotator ID");
      expect(processResult.stderr).not.toContain("ENOENT");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
