import "server-only";

import type { PersonaSnapshot } from "@/types/domain";

const fieldLabels: ReadonlyArray<{
  key:
    keyof PersonaSnapshot | "identity.name" | "identity.role" | "identity.background";
  label: string;
}> = [
  { key: "identity.name", label: "角色名称" },
  { key: "identity.role", label: "身份定位" },
  { key: "identity.background", label: "身份与背景" },
  { key: "coreTraits", label: "核心性格" },
  { key: "speakingStyle", label: "说话风格" },
  { key: "relationshipDefinition", label: "与用户的关系" },
  { key: "supportStyle", label: "情绪支持与建议方式" },
  { key: "reminderTone", label: "提醒语气" },
  { key: "boundaries", label: "价值与行为边界" },
  { key: "preferences", label: "喜好与厌恶" },
  { key: "values", label: "价值观" },
  { key: "proactiveLevel", label: "主动程度" },
];

function valueAt(snapshot: PersonaSnapshot, key: (typeof fieldLabels)[number]["key"]) {
  if (key === "identity.name") return snapshot.identity.name;
  if (key === "identity.role") return snapshot.identity.role;
  if (key === "identity.background") return snapshot.identity.background ?? "";
  return snapshot[key];
}

function normalized(value: unknown): string {
  return Array.isArray(value)
    ? value
        .map((item) => String(item).trim())
        .filter(Boolean)
        .join("\n")
    : String(value ?? "").trim();
}

export function describePersonaChanges(
  previous: PersonaSnapshot,
  next: PersonaSnapshot,
): string[] {
  return fieldLabels
    .filter(
      ({ key }) =>
        normalized(valueAt(previous, key)) !== normalized(valueAt(next, key)),
    )
    .map(({ label }) => label);
}

export function compilePersonaPrompt(persona: PersonaSnapshot): string {
  const proactive = {
    high: "可以适度主动，但不能连续打扰或替用户做决定",
    low: "以回应用户为主，不无理由主动推进话题",
    medium: "在用户需要时适度主动，并尊重拒绝和沉默",
  }[persona.proactiveLevel ?? "medium"];

  return [
    `你是${persona.identity.name}，身份是${persona.identity.role}。`,
    `身份背景：${persona.identity.background?.trim() || "未额外设置"}。`,
    `核心性格：${persona.coreTraits.join("、")}。`,
    `表达方式：${persona.speakingStyle.join("、")}。`,
    `与用户的关系：${persona.relationshipDefinition?.trim() || "尊重用户并保持清晰边界"}。`,
    `情绪支持与建议方式：${persona.supportStyle}。`,
    `提醒语气：${persona.reminderTone}。`,
    `主动程度：${proactive}。`,
    `喜好与厌恶：${persona.preferences?.join("、") || "未额外设置"}。`,
    `价值观：${persona.values?.join("、") || "未额外设置"}。`,
    `必须遵守的边界：${persona.boundaries.join("；")}。`,
    "不得编造用户经历，不得泄露其他角色专属信息，不得诱导排他依赖；安全规则始终优先于角色沉浸，普通对话不得修改核心人设。",
  ].join("");
}
