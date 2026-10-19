import { describe, expect, it } from "vitest";

import {
  buildAccountDataExport,
  type AccountDataExportSource,
} from "./account-data-export";

const userId = "10000000-0000-4000-8000-000000000001";
const roleId = "20000000-0000-4000-8000-000000000002";
const personaVersionId = "30000000-0000-4000-8000-000000000003";
const conversationId = "40000000-0000-4000-8000-000000000004";
const messageId = "50000000-0000-4000-8000-000000000005";

const persona = {
  identity: { name: "小屿", role: "陪伴者", background: "温和的成长伙伴" },
  coreTraits: ["真诚"],
  speakingStyle: ["简洁温暖"],
  supportStyle: "先听，再一起找到下一步。",
  reminderTone: "轻声提醒，不催促。",
  boundaries: ["不替用户做决定"],
  relationshipDefinition: "长期陪伴关系",
};

function source(
  overrides: Partial<AccountDataExportSource> = {},
): AccountDataExportSource {
  return {
    profile: {
      display_name: "小安",
      avatar_seed: "seed",
      onboarding_completed_at: "2026-09-01T00:00:00.000Z",
    },
    settings: {
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
      theme: "light",
      font_scale: 1,
      preferred_user_name: "小安",
      default_day_time: "09:00:00",
      default_reminder_minutes: 30,
      quiet_hours_start: null,
      quiet_hours_end: null,
      browser_notifications_enabled: false,
    },
    roles: [
      {
        id: roleId,
        display_name: "小屿",
        source: "custom",
        status: "active",
        current_persona_version_id: personaVersionId,
        created_at: "2026-09-01T00:00:00.000Z",
        compiled_system_prompt: "must never export",
      },
    ],
    personaVersions: [
      {
        id: personaVersionId,
        role_id: roleId,
        version_no: 1,
        schema_version: 1,
        persona_snapshot: persona,
        change_summary: "初始版本",
        compiled_system_prompt: "must never export",
        created_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    conversations: [
      {
        id: conversationId,
        role_id: roleId,
        created_at: "2026-09-01T00:00:00.000Z",
        last_message_at: "2026-09-01T01:00:00.000Z",
      },
    ],
    messages: [
      {
        id: messageId,
        conversation_id: conversationId,
        role_id: roleId,
        sender: "user",
        content: "这是我自己的合成聊天。",
        status: "completed",
        persona_version_id: null,
        reply_to_message_id: null,
        created_at: "2026-09-01T01:00:00.000Z",
        client_message_id: "must never export",
      },
    ],
    memories: [
      {
        id: "60000000-0000-4000-8000-000000000006",
        scope: "role_private",
        role_id: roleId,
        category: "偏好",
        content: "喜欢早晨散步",
        sensitivity: "normal",
        status: "active",
        source_message_id: messageId,
        confirmed_by_user: true,
        valid_from: null,
        valid_to: null,
        supersedes_memory_id: null,
        created_at: "2026-09-01T01:00:00.000Z",
        updated_at: "2026-09-01T01:00:00.000Z",
        embedding: [0.1, 0.2],
        embedding_provider: "must never export",
      },
    ],
    plans: [],
    planStatusEvents: [],
    planProposals: [],
    notifications: [],
    personaFeedback: [],
    ...overrides,
  };
}

describe("buildAccountDataExport", () => {
  it("exports a narrow user-owned DTO and groups messages beneath their conversation", () => {
    const result = buildAccountDataExport(
      {
        id: userId,
        email: "user@example.invalid",
        created_at: "2026-09-01T00:00:00.000Z",
      },
      source(),
      new Date("2026-09-08T00:00:00.000Z"),
    );

    expect(result.account).toMatchObject({
      email: "user@example.invalid",
      displayName: "小安",
    });
    expect(result.roles).toHaveLength(1);
    expect(result.conversations).toMatchObject([
      {
        id: conversationId,
        messages: [{ id: messageId, content: "这是我自己的合成聊天。" }],
      },
    ]);
  });

  it("never copies prompts, vectors, idempotency values, or service-only tokens", () => {
    const output = JSON.stringify(
      buildAccountDataExport(
        {
          id: userId,
          email: "user@example.invalid",
          created_at: "2026-09-01T00:00:00.000Z",
        },
        source(),
      ),
    );

    expect(output).not.toContain("compiled_system_prompt");
    expect(output).not.toContain("must never export");
    expect(output).not.toContain("embedding_provider");
    expect(output).not.toContain("claim_token");
  });

  it("makes a capped export explicit instead of silently presenting it as complete", () => {
    const result = buildAccountDataExport(
      {
        id: userId,
        email: "user@example.invalid",
        created_at: "2026-09-01T00:00:00.000Z",
      },
      source({
        roles: Array.from({ length: 201 }, (_, index) => ({
          id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          display_name: `角色 ${index}`,
          source: "custom",
          status: "active",
        })),
      }),
    );

    expect(result.roles).toHaveLength(200);
    expect(result.truncatedCollections).toContain("roles");
  });
});
