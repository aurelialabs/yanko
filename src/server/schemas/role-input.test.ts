import { describe, expect, it } from "vitest";

import {
  createCustomRoleSchema,
  createPersonaVersionSchema,
  personaSnapshotSchema,
} from "./index";

const persona = {
  identity: {
    name: "知夏",
    role: "长期陪伴者",
    background: "理解创作压力，但不会替用户做决定。",
  },
  coreTraits: ["温柔", "稳定"],
  speakingStyle: ["自然", "简洁"],
  supportStyle: "先听懂感受，再询问是否需要建议。",
  reminderTone: "温和、具体、不施压。",
  boundaries: ["不编造经历", "不诱导依赖"],
  preferences: ["清晰的下一步"],
  values: ["诚实", "尊重自主"],
  relationshipDefinition: "可信任且有清晰边界的长期伙伴",
  proactiveLevel: "medium" as const,
};

describe("role and persona input schemas", () => {
  it("accepts a complete custom role with advanced fields", () => {
    expect(
      createCustomRoleSchema.safeParse({
        displayName: "知夏",
        persona,
        idempotencyKey: "custom-role-request-001",
      }).success,
    ).toBe(true);
  });

  it("requires custom-role background and relationship fields", () => {
    expect(
      createCustomRoleSchema.safeParse({
        displayName: "知夏",
        persona: {
          ...persona,
          identity: { name: "知夏", role: "长期陪伴者" },
          relationshipDefinition: "",
        },
        idempotencyKey: "custom-role-request-001",
      }).success,
    ).toBe(false);
  });

  it("enforces field limits and rejects policy-internal extras", () => {
    expect(
      personaSnapshotSchema.safeParse({
        ...persona,
        identity: { ...persona.identity, name: "太".repeat(41) },
      }).success,
    ).toBe(false);
    expect(
      personaSnapshotSchema.safeParse({
        ...persona,
        compiledSystemPrompt: "客户端不能覆盖最终 Prompt",
      }).success,
    ).toBe(false);
  });

  it("requires explicit confirmation for an immutable persona version", () => {
    const base = {
      roleId: "11111111-1111-4111-8111-111111111111",
      expectedCurrentVersionId: "22222222-2222-4222-8222-222222222222",
      persona,
      idempotencyKey: "persona-version-request-001",
    };
    expect(
      createPersonaVersionSchema.safeParse({ ...base, confirmed: true }).success,
    ).toBe(true);
    expect(
      createPersonaVersionSchema.safeParse({ ...base, confirmed: false }).success,
    ).toBe(false);
  });
});
