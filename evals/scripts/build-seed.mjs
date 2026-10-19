import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAndValidateDataset } from "./validate-dataset.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonb(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

const { manifest, allCases, datasetDir } = await loadAndValidateDataset();
const files = [];

for (const config of Object.values(manifest.capabilities)) {
  const source = await readFile(path.join(datasetDir, config.file), "utf8");
  files.push({ file: config.file, sha256: sha256(source), cases: config.count });
}

const canonicalCases = [...allCases].sort((left, right) =>
  left.caseKey.localeCompare(right.caseKey),
);
const datasetHash = sha256(
  JSON.stringify({
    datasetKey: manifest.datasetKey,
    version: manifest.version,
    strategyVersion: manifest.strategyVersion,
    personaTemplateVersions: manifest.personaTemplateVersions,
    cases: canonicalCases,
  }),
);

const snapshot = {
  datasetKey: manifest.datasetKey,
  version: manifest.version,
  generatedAt: `${manifest.createdAt}T00:00:00+08:00`,
  sha256: datasetHash,
  totalCases: allCases.length,
  files,
};

await writeFile(
  path.join(datasetDir, "dataset.snapshot.json"),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8",
);

const activeCaseKeys = canonicalCases.map((item) => sqlString(item.caseKey)).join(", ");
const rows = canonicalCases.map((item) => {
  const inputPayload = {
    datasetVersion: manifest.version,
    datasetSha256: datasetHash,
    split: item.split,
    tags: item.tags,
    input: item.input,
  };
  const expectedOutput = {
    schemaVersion: manifest.version,
    expected: item.expected,
  };
  const sourceBadcaseId = item.sourceBadcaseId
    ? `${sqlString(item.sourceBadcaseId)}::uuid`
    : "null";

  return `  (${sqlString(item.caseKey)}, ${sqlString(item.capability)}, ${sqlString(item.dataLevel)}, ${jsonb(inputPayload)}, ${jsonb(expectedOutput)}, ${item.isSensitive}, ${sourceBadcaseId}, 'active')`;
});

const sql = `-- Generated from evals/datasets/${manifest.version}/*.jsonl. Do not edit directly.
-- Dataset SHA-256: ${datasetHash}

begin;

update public.eval_cases
set status = 'retired', updated_at = now()
where case_key ~ '^v0_1_'
  and case_key not in (${activeCaseKeys});

insert into public.eval_cases (
  case_key,
  capability,
  data_level,
  input_payload,
  expected_output,
  is_sensitive,
  source_badcase_id,
  status
)
values
${rows.join(",\n")}
on conflict (case_key) do update
set
  capability = excluded.capability,
  data_level = excluded.data_level,
  input_payload = excluded.input_payload,
  expected_output = excluded.expected_output,
  is_sensitive = excluded.is_sensitive,
  source_badcase_id = excluded.source_badcase_id,
  status = excluded.status,
  updated_at = now();

commit;
`;

const seedDir = path.join(workspaceRoot, "supabase", "seed");
await mkdir(seedDir, { recursive: true });
const seedPath = path.join(seedDir, "202608310001_initial_eval_cases.sql");
await writeFile(seedPath, sql, "utf8");

process.stdout.write(
  `${JSON.stringify({ snapshot: path.join(datasetDir, "dataset.snapshot.json"), seed: seedPath, cases: allCases.length, sha256: datasetHash }, null, 2)}\n`,
);
