#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";

import { deterministicMockAdapter } from "../adapters/deterministic-mock.mjs";
import { createDeepSeekAdapter, DEEPSEEK_ADAPTER_ID } from "../adapters/deepseek.mjs";
import { createMiniMaxAdapter, MINIMAX_ADAPTER_ID } from "../adapters/minimax.mjs";
import {
  createTaokeTagQwenAdapter,
  TAOKE_TAG_QWEN_ADAPTER_ID,
} from "../adapters/taoke-tag-qwen.mjs";
import { createEvaluationFailureFields } from "./evaluation-failure.mjs";

const DEFAULT_DATASET = "evals/datasets/v0.1/dataset.snapshot.json";
const DEFAULT_ADAPTER = "local-deterministic-mock";

function usage() {
  return [
    "Usage:",
    "  node evals/scripts/run-evaluation.mjs --output <report.jsonl> [options]",
    "",
    "Options:",
    `  --dataset <path>   Dataset snapshot or JSONL file (default: ${DEFAULT_DATASET})`,
    `  --adapter <id>     Registered adapter (default: ${DEFAULT_ADAPTER})`,
    "  --split <name>     Only run cases from a named split, such as development or test",
    "  --case-id <id>     Run one exact case ID; repeat to select multiple cases",
    "  --prompt-version <version>  Prompt configuration label recorded in the report",
    "  --policy-version <version>  Policy label recorded in the report",
    "",
    `Network candidate: ${TAOKE_TAG_QWEN_ADAPTER_ID} (requires explicit server-only environment configuration).`,
    `Network candidate: ${DEEPSEEK_ADAPTER_ID} (requires explicit server-only environment configuration).`,
    `Network candidate: ${MINIMAX_ADAPTER_ID} (requires explicit server-only environment configuration).`,
    "This runner records one candidate and never selects a winning provider.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    adapter: DEFAULT_ADAPTER,
    caseIds: [],
    dataset: DEFAULT_DATASET,
    output: undefined,
    policyVersion: "unassigned",
    promptVersion: "unassigned",
    split: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      return { help: true, options };
    }

    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }

    switch (argument) {
      case "--adapter":
        options.adapter = value;
        break;
      case "--case-id":
        options.caseIds.push(value);
        break;
      case "--dataset":
        options.dataset = value;
        break;
      case "--output":
        options.output = value;
        break;
      case "--split":
        options.split = value;
        break;
      case "--prompt-version":
        options.promptVersion = value;
        break;
      case "--policy-version":
        options.policyVersion = value;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }

    index += 1;
  }

  return { help: false, options };
}

function looksLikeEvaluationCase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value;
  const hasId =
    typeof candidate.caseKey === "string" ||
    typeof candidate.id === "string" ||
    typeof candidate.case_id === "string";
  const hasEvaluationShape =
    typeof candidate.capability === "string" ||
    typeof candidate.task === "string" ||
    typeof candidate.category === "string" ||
    typeof candidate.split === "string";

  return hasId && hasEvaluationShape;
}

function collectCases(value, seen = new Set()) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectCases(entry, seen));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  if (looksLikeEvaluationCase(value)) {
    const caseId =
      typeof value.caseKey === "string"
        ? value.caseKey
        : typeof value.id === "string"
          ? value.id
          : value.case_id;
    if (seen.has(caseId)) {
      return [];
    }

    seen.add(caseId);
    return [value];
  }

  return Object.values(value).flatMap((entry) => collectCases(entry, seen));
}

function parseJsonLines(contents, sourceLabel) {
  return contents
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL in ${sourceLabel} on line ${index + 1}.`);
      }
    });
}

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function resolveSnapshotCaseFile(datasetPath, fileName) {
  const datasetDirectory = dirname(datasetPath);
  const candidatePath = resolve(datasetDirectory, fileName);
  const pathFromDataset = relative(datasetDirectory, candidatePath);

  if (
    pathFromDataset.startsWith("..") ||
    isAbsolute(pathFromDataset) ||
    pathFromDataset === ""
  ) {
    throw new Error(`Invalid dataset file path: ${fileName}`);
  }

  return candidatePath;
}

async function readDataset(datasetPath) {
  const contents = await readFile(datasetPath, "utf8");

  if (extname(datasetPath).toLowerCase() === ".jsonl") {
    return {
      cases: parseJsonLines(contents, datasetPath),
      fingerprint: hash(contents),
    };
  }

  const snapshot = JSON.parse(contents);
  if (Array.isArray(snapshot.files)) {
    const cases = [];

    for (const entry of snapshot.files) {
      if (!entry || typeof entry.file !== "string") {
        throw new Error("Dataset snapshot contains an invalid file entry.");
      }

      const caseFilePath = resolveSnapshotCaseFile(datasetPath, entry.file);
      const caseFileContents = await readFile(caseFilePath, "utf8");
      const actualHash = hash(caseFileContents);

      if (typeof entry.sha256 === "string" && entry.sha256 !== actualHash) {
        throw new Error(`Dataset file fingerprint mismatch: ${entry.file}`);
      }

      cases.push(...parseJsonLines(caseFileContents, entry.file));
    }

    return {
      cases,
      fingerprint:
        typeof snapshot.sha256 === "string" ? snapshot.sha256 : hash(contents),
    };
  }

  return {
    cases: collectCases(snapshot),
    fingerprint: hash(contents),
  };
}

function contentFingerprint(value) {
  return hash(JSON.stringify(value));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertReportPathsAvailable(outputPath) {
  const summaryPath = `${outputPath}.summary.json`;
  const existingPaths = [];

  if (await pathExists(outputPath)) existingPaths.push(outputPath);
  if (await pathExists(summaryPath)) existingPaths.push(summaryPath);

  if (existingPaths.length > 0) {
    throw new Error(
      `Refusing to overwrite existing evaluation artifact: ${existingPaths.join(", ")}.`,
    );
  }
}

function resolveAdapter(adapterId, promptVersion) {
  if (adapterId === deterministicMockAdapter.descriptor.id) {
    return deterministicMockAdapter;
  }

  if (adapterId === TAOKE_TAG_QWEN_ADAPTER_ID) {
    return createTaokeTagQwenAdapter({ promptVersion });
  }

  if (adapterId === DEEPSEEK_ADAPTER_ID) {
    return createDeepSeekAdapter({ promptVersion });
  }

  if (adapterId === MINIMAX_ADAPTER_ID) {
    return createMiniMaxAdapter({ promptVersion });
  }

  throw new Error(
    `Adapter "${adapterId}" is not registered with the evaluation runner.`,
  );
}

function caseIdFor(evalCase, index) {
  if (typeof evalCase.caseKey === "string") {
    return evalCase.caseKey;
  }

  if (typeof evalCase.id === "string") {
    return evalCase.id;
  }

  if (typeof evalCase.case_id === "string") {
    return evalCase.case_id;
  }

  return `case-${index + 1}`;
}

function splitFor(evalCase) {
  if (typeof evalCase.split === "string") {
    return evalCase.split;
  }

  if (typeof evalCase.dataset_split === "string") {
    return evalCase.dataset_split;
  }

  return "unspecified";
}

function toAdapterInput(evalCase) {
  return {
    capability:
      typeof evalCase.capability === "string" ? evalCase.capability : "unknown",
    input: evalCase.input ?? null,
  };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { options } = parsed;
  if (!options.output) {
    throw new Error(
      "--output is required so generated evaluation artifacts are explicit.",
    );
  }

  const datasetPath = resolve(options.dataset);
  const outputPath = resolve(options.output);
  await assertReportPathsAvailable(outputPath);
  const adapter = resolveAdapter(options.adapter, options.promptVersion);
  const { cases, fingerprint: datasetFingerprint } = await readDataset(datasetPath);
  const splitCases = options.split
    ? cases.filter((evalCase) => splitFor(evalCase) === options.split)
    : cases;
  const requestedCaseIds = [...new Set(options.caseIds)];

  if (requestedCaseIds.length !== options.caseIds.length) {
    throw new Error("Duplicate --case-id values are not allowed.");
  }

  const requestedCaseIdSet = new Set(requestedCaseIds);
  const selectedCases =
    requestedCaseIds.length > 0
      ? splitCases.filter((evalCase, index) =>
          requestedCaseIdSet.has(caseIdFor(evalCase, index)),
        )
      : splitCases;
  const selectedCaseIdSet = new Set(
    selectedCases.map((evalCase, index) => caseIdFor(evalCase, index)),
  );
  const missingCaseIds = requestedCaseIds.filter(
    (caseId) => !selectedCaseIdSet.has(caseId),
  );

  if (missingCaseIds.length > 0) {
    throw new Error(
      `Requested case IDs were not found in the selected split: ${missingCaseIds.join(", ")}.`,
    );
  }

  if (selectedCases.length === 0) {
    throw new Error("No evaluation cases matched the requested dataset and split.");
  }

  const selectedCaseIds = selectedCases.map((evalCase, index) =>
    caseIdFor(evalCase, index),
  );
  const configurationFingerprint = contentFingerprint({
    adapter: adapter.descriptor,
    datasetFingerprint,
    policyVersion: options.policyVersion,
    promptVersion: options.promptVersion,
    selectedCaseIds,
    split: options.split ?? "all",
  });
  const runStartedAt = new Date().toISOString();
  const runId = `eval-${createHash("sha256")
    .update(`${configurationFingerprint}:${runStartedAt}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 16)}`;
  const records = [];

  for (const [index, evalCase] of selectedCases.entries()) {
    const caseId = caseIdFor(evalCase, index);
    const split = splitFor(evalCase);
    const adapterInput = toAdapterInput(evalCase);

    try {
      const result = await adapter.evaluateCase(adapterInput);
      records.push({
        runId,
        configurationFingerprint,
        runStartedAt,
        caseId,
        split,
        status: "completed",
        adapter: adapter.descriptor,
        promptVersion: options.promptVersion,
        policyVersion: options.policyVersion,
        datasetFingerprint,
        inputFingerprint: contentFingerprint(adapterInput),
        latencyMs: result.latencyMs,
        usage: result.usage,
        ...(Array.isArray(result.policyAdjustments) &&
        result.policyAdjustments.length > 0
          ? { policyAdjustments: result.policyAdjustments }
          : {}),
        ...(result.rawOutput && typeof result.rawOutput === "object"
          ? { rawOutput: result.rawOutput }
          : {}),
        output: result.output,
        score: null,
        error: null,
      });
    } catch (error) {
      records.push({
        runId,
        configurationFingerprint,
        runStartedAt,
        caseId,
        split,
        status: "failed",
        adapter: adapter.descriptor,
        promptVersion: options.promptVersion,
        policyVersion: options.policyVersion,
        datasetFingerprint,
        inputFingerprint: contentFingerprint(adapterInput),
        ...createEvaluationFailureFields(error),
      });
    }
  }

  const runCompletedAt = new Date().toISOString();
  const summary = {
    runId,
    configurationFingerprint,
    runStartedAt,
    runCompletedAt,
    dataset: basename(datasetPath),
    adapter: adapter.descriptor,
    datasetFingerprint,
    promptVersion: options.promptVersion,
    policyVersion: options.policyVersion,
    split: options.split ?? "all",
    ...(requestedCaseIds.length > 0 ? { selectedCaseIds: requestedCaseIds } : {}),
    totalCases: records.length,
    completedCases: records.filter((record) => record.status === "completed").length,
    failedCases: records.filter((record) => record.status === "failed").length,
    scoring: "not-run",
    note: "This artifact records one candidate run. It does not rank providers or select a production model.",
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    { flag: "wx" },
  );
  await writeFile(
    `${outputPath}.summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
    { flag: "wx" },
  );
  process.stdout.write(
    `Wrote ${records.length} local evaluation records to ${outputPath} (run ${runId}).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown error."}\n`,
  );
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
});
