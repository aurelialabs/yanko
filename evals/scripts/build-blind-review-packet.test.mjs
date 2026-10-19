import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const builderPath = resolve(projectRoot, "evals/scripts/build-blind-review-packet.mjs");
const candidatePaths = [
  "evals/reports/qwen-turbo-v0.1-dev-v3.jsonl",
  "evals/reports/deepseek-v4-flash-v0.1-dev-v3.jsonl",
  "evals/reports/minimax-m3-v0.1-dev-v3-rerun1.jsonl",
];

function createTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "yanko-blind-review-"));
}

function runBuilder(outputDirectory) {
  const args = [builderPath, "--output-dir", outputDirectory];
  for (const path of candidatePaths) {
    args.push("--candidate", path);
  }
  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

describe("build-blind-review-packet", () => {
  it("creates a balanced public packet and a separate local mapping", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const outputDirectory = join(temporaryDirectory, "packet");

    try {
      const result = runBuilder(outputDirectory);
      expect(result.status).toBe(0);

      const publicPaths = [
        "blind-review-packet.jsonl",
        "blind-review-packet.md",
        "annotator-a.md",
        "annotator-b.md",
        "blind-review-summary.json",
      ].map((name) => join(outputDirectory, name));
      const mappingPath = join(outputDirectory, "candidate.blind-map.local.json");
      expect(publicPaths.every(existsSync)).toBe(true);
      expect(existsSync(mappingPath)).toBe(true);

      const summary = JSON.parse(readFileSync(publicPaths[4], "utf8"));
      expect(summary.generationThreeWayItems).toBe(6);
      expect(summary.generationThreeWayOptionsPerItem).toBe(3);
      expect(summary.safetyItems).toBe(3);
      expect(summary.safetyOptionsPerItem).toBe(2);
      expect(summary.annotatorCount).toBe(2);

      const records = readFileSync(publicPaths[0], "utf8")
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line));
      expect(records).toHaveLength(9);
      expect(
        records
          .filter((record) => record.sectionId === "generation-three-way")
          .every((record) => record.options.length === 3),
      ).toBe(true);
      expect(
        records
          .filter((record) => record.sectionId === "safety-available-candidates")
          .every((record) => record.options.length === 2),
      ).toBe(true);

      const publicText = publicPaths
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      expect(publicText).not.toMatch(
        /qwen|deepseek|minimax|dashscope|alibaba-cloud|eval-[a-f0-9]{16}|v0_1_/iu,
      );

      const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
      expect(mapping.candidates).toHaveLength(3);
      expect(mapping.mappings).toHaveLength(9);

      const generationMappings = mapping.mappings.filter((item) =>
        item.reviewItemId.startsWith("G"),
      );
      for (const candidate of mapping.candidates) {
        const adapterId = candidate.adapter.id;
        const labelCounts = new Map([
          ["A", 0],
          ["B", 0],
          ["C", 0],
        ]);
        for (const item of generationMappings) {
          const option = item.options.find((entry) => entry.adapter.id === adapterId);
          labelCounts.set(option.label, labelCounts.get(option.label) + 1);
        }
        expect([...labelCounts.values()]).toEqual([2, 2, 2]);
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing blind-review packet", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const outputDirectory = join(temporaryDirectory, "packet");

    try {
      expect(runBuilder(outputDirectory).status).toBe(0);
      const secondResult = runBuilder(outputDirectory);
      expect(secondResult.status).not.toBe(0);
      expect(secondResult.stderr).toContain(
        "Refusing to overwrite existing blind-review artifact",
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
