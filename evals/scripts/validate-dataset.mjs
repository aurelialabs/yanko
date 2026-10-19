import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const datasetDir = path.resolve(scriptDir, "../datasets/v0.1");
const manifestPath = path.join(datasetDir, "manifest.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function validateCommon(caseDefinition, expectedCapability, source) {
  const requiredKeys = [
    "caseKey",
    "capability",
    "dataLevel",
    "split",
    "isSensitive",
    "tags",
    "input",
    "expected",
  ];

  for (const key of requiredKeys) {
    assert(Object.hasOwn(caseDefinition, key), `${source}: 缺少 ${key}`);
  }

  assert(
    /^v0_1_[a-z_]+_[0-9]{3}$/.test(caseDefinition.caseKey),
    `${source}: caseKey 格式错误`,
  );
  assert(
    caseDefinition.capability === expectedCapability,
    `${source}: capability 与文件不一致`,
  );
  assert(
    ["L1", "L2", "L3"].includes(caseDefinition.dataLevel),
    `${source}: dataLevel 无效`,
  );
  assert(["dev", "test"].includes(caseDefinition.split), `${source}: split 无效`);
  assert(
    typeof caseDefinition.isSensitive === "boolean",
    `${source}: isSensitive 必须是布尔值`,
  );
  assert(Array.isArray(caseDefinition.tags), `${source}: tags 必须是数组`);
  assert(
    new Set(caseDefinition.tags).size === caseDefinition.tags.length,
    `${source}: tags 不得重复`,
  );
  assert(
    caseDefinition.input?.taskType === expectedCapability,
    `${source}: input.taskType 不一致`,
  );
  assert(
    caseDefinition.expected?.taskType === expectedCapability,
    `${source}: expected.taskType 不一致`,
  );

  if (caseDefinition.dataLevel === "L2") {
    assert(caseDefinition.sourceBadcaseId, `${source}: L2 必须关联 sourceBadcaseId`);
  }

  if (expectedCapability === "safety_response") {
    assert(caseDefinition.isSensitive, `${source}: 安全样本必须标记为敏感`);
  }

  if (["plan_classification", "plan_extraction"].includes(expectedCapability)) {
    assert(caseDefinition.input.referenceTime, `${source}: 计划样本缺少 referenceTime`);
    assert(
      caseDefinition.input.timezone === "Asia/Shanghai",
      `${source}: 计划样本时区不一致`,
    );
  }

  if (["role_isolation", "memory_recall"].includes(expectedCapability)) {
    assert(
      Array.isArray(caseDefinition.input.memories),
      `${source}: memories 必须是数组`,
    );
    assert(
      Array.isArray(caseDefinition.expected.requiredMemoryIds),
      `${source}: 缺少 requiredMemoryIds`,
    );
    assert(
      Array.isArray(caseDefinition.expected.excludedMemoryIds),
      `${source}: 缺少 excludedMemoryIds`,
    );
    const overlap = caseDefinition.expected.requiredMemoryIds.filter((id) =>
      caseDefinition.expected.excludedMemoryIds.includes(id),
    );
    assert(overlap.length === 0, `${source}: 同一记忆不能同时要求召回和排除`);
    assert(caseDefinition.expected.maxResults <= 5, `${source}: 召回结果不能超过 5 条`);
  }

  if (expectedCapability === "plan_classification") {
    const expected = caseDefinition.expected;
    assert(
      ["none", "create", "offer", "clarify"].includes(expected.intent),
      `${source}: intent 无效`,
    );
    if (expected.intent === "none") {
      assert(expected.scope === null, `${source}: NONE 的 scope 必须为空`);
      assert(
        !expected.shouldShowCard && !expected.shouldAskBeforeCard,
        `${source}: NONE 不应进入计划流程`,
      );
    } else {
      assert(
        ["day", "week", "month", "year"].includes(expected.scope),
        `${source}: 非 NONE 缺少 scope`,
      );
    }
  }

  if (expectedCapability === "plan_extraction") {
    const expected = caseDefinition.expected;
    assert(
      ["day", "week", "month", "year"].includes(expected.scope),
      `${source}: scope 无效`,
    );
    assert(Array.isArray(expected.forbiddenFields), `${source}: 缺少 forbiddenFields`);
    for (const forbiddenField of expected.forbiddenFields) {
      assert(
        !Object.hasOwn(expected.parsedPayload, forbiddenField),
        `${source}: parsedPayload 包含层级禁止字段 ${forbiddenField}`,
      );
    }
  }

  if (expectedCapability === "memory_extraction") {
    assert(
      Array.isArray(caseDefinition.expected.candidates),
      `${source}: candidates 必须是数组`,
    );
    for (const candidate of caseDefinition.expected.candidates) {
      assert(
        ["auto_write", "confirm", "ignore", "forbidden"].includes(candidate.action),
        `${source}: memory action 无效`,
      );
      if (candidate.sensitivity === "sensitive") {
        assert(candidate.action === "confirm", `${source}: 敏感记忆必须确认后写入`);
      }
      if (candidate.sensitivity === "forbidden") {
        assert(
          candidate.action === "forbidden",
          `${source}: 禁止记忆必须使用 forbidden`,
        );
      }
      if (candidate.scope === "user_shared") {
        assert(
          candidate.roleKey === null,
          `${source}: user_shared 的 roleKey 必须为空`,
        );
      }
      if (candidate.scope === "role_private") {
        assert(candidate.roleKey, `${source}: role_private 必须绑定角色`);
      }
    }
  }

  if (expectedCapability === "emotion_response") {
    const [minimum, maximum] = caseDefinition.expected.intensityRange ?? [];
    assert(
      Number.isFinite(minimum) &&
        Number.isFinite(maximum) &&
        minimum >= 0 &&
        maximum <= 1 &&
        minimum <= maximum,
      `${source}: intensityRange 无效`,
    );
  }
}

export async function loadAndValidateDataset() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const allCases = [];
  const caseKeys = new Set();
  const splitCounts = {};
  const levelCounts = {};
  let sensitiveCases = 0;

  for (const [capability, config] of Object.entries(manifest.capabilities)) {
    const filePath = path.join(datasetDir, config.file);
    const sourceText = await readFile(filePath, "utf8");
    const lines = sourceText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const localSplitCounts = {};
    const localLevelCounts = {};

    assert(
      lines.length === config.count,
      `${config.file}: 实际 ${lines.length} 条，manifest 声明 ${config.count} 条`,
    );

    lines.forEach((line, index) => {
      const source = `${config.file}:${index + 1}`;
      let caseDefinition;
      try {
        caseDefinition = JSON.parse(line);
      } catch (error) {
        throw new Error(`${source}: JSON 无效：${error.message}`);
      }

      validateCommon(caseDefinition, capability, source);
      assert(
        !caseKeys.has(caseDefinition.caseKey),
        `${source}: caseKey 重复 ${caseDefinition.caseKey}`,
      );
      caseKeys.add(caseDefinition.caseKey);
      increment(splitCounts, caseDefinition.split);
      increment(levelCounts, caseDefinition.dataLevel);
      increment(localSplitCounts, caseDefinition.split);
      increment(localLevelCounts, caseDefinition.dataLevel);
      if (caseDefinition.isSensitive) sensitiveCases += 1;
      allCases.push(caseDefinition);
    });

    for (const split of ["dev", "test"]) {
      assert(
        (localSplitCounts[split] ?? 0) === config[split],
        `${config.file}: ${split} 数量与 manifest 不一致`,
      );
    }
    for (const level of ["L1", "L3"]) {
      assert(
        (localLevelCounts[level] ?? 0) === (config[level] ?? 0),
        `${config.file}: ${level} 数量与 manifest 不一致`,
      );
    }
  }

  assert(allCases.length === manifest.totalCases, "总样本数与 manifest 不一致");
  assert((splitCounts.dev ?? 0) === manifest.splits.dev, "dev 总数与 manifest 不一致");
  assert(
    (splitCounts.test ?? 0) === manifest.splits.test,
    "test 总数与 manifest 不一致",
  );
  for (const level of ["L1", "L2", "L3"]) {
    assert(
      (levelCounts[level] ?? 0) === manifest.dataLevels[level],
      `${level} 总数与 manifest 不一致`,
    );
  }
  assert(sensitiveCases === manifest.sensitiveCases, "敏感样本总数与 manifest 不一致");

  return { manifest, allCases, datasetDir };
}

async function main() {
  const { manifest, allCases } = await loadAndValidateDataset();
  const summary = {
    dataset: `${manifest.datasetKey}@${manifest.version}`,
    cases: allCases.length,
    splits: manifest.splits,
    dataLevels: manifest.dataLevels,
    sensitiveCases: manifest.sensitiveCases,
    capabilities: Object.fromEntries(
      Object.entries(manifest.capabilities).map(([key, value]) => [key, value.count]),
    ),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
