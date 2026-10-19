import { describe, expect, it } from "vitest";

import { buildMemoryManagementData, buildPendingMemoryCandidates } from "./memory-data";

const ids = {
  role: "10000000-0000-4000-8000-000000000001",
  otherRole: "20000000-0000-4000-8000-000000000002",
  source: "30000000-0000-4000-8000-000000000003",
  otherSource: "40000000-0000-4000-8000-000000000004",
  currentMemory: "50000000-0000-4000-8000-000000000005",
  historyMemory: "60000000-0000-4000-8000-000000000006",
};

describe("memory presentation DTO builders", () => {
  it("only returns pending candidates grounded in a current-role source message", () => {
    const result = buildPendingMemoryCandidates(
      [
        {
          id: "70000000-0000-4000-8000-000000000007",
          role_id: ids.role,
          source_message_id: ids.source,
          suggested_scope: "role_private",
          category: "agreement",
          content: "用户难过时希望先被倾听。",
          sensitivity: "normal",
          status: "pending",
          expires_at: "2026-10-01T00:00:00.000Z",
          confidence: 0.99,
          normalized_key: "must-not-cross-dto",
        },
        {
          id: "80000000-0000-4000-8000-000000000008",
          role_id: ids.otherRole,
          source_message_id: ids.otherSource,
          suggested_scope: "role_private",
          category: "sensitive",
          content: "另一个角色的内容",
          sensitivity: "sensitive",
          status: "pending",
          expires_at: "2026-10-01T00:00:00.000Z",
        },
      ],
      new Set([ids.source]),
      ids.role,
      "林知夏",
    );

    expect(result).toEqual([
      {
        id: "70000000-0000-4000-8000-000000000007",
        roleId: ids.role,
        roleName: "林知夏",
        content: "用户难过时希望先被倾听。",
        category: "agreement",
        suggestedScope: "role_private",
        sensitivity: "normal",
        expiresAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    expect(result[0]).not.toHaveProperty("confidence");
    expect(result[0]).not.toHaveProperty("normalizedKey");
    expect(result[0]).not.toHaveProperty("sourceMessageId");
  });

  it("returns active memories only and exposes same-scope superseded history", () => {
    const result = buildMemoryManagementData(
      [
        { id: ids.role, display_name: "林知夏", status: "active" },
        { id: ids.otherRole, display_name: "已归档", status: "archived" },
      ],
      [
        {
          id: ids.currentMemory,
          scope: "role_private",
          role_id: ids.role,
          category: "preference",
          content: "用户现在不喜欢牛奶。",
          sensitivity: "normal",
          status: "active",
          confirmed_by_user: true,
          valid_from: "2026-09-02T00:00:00.000Z",
          valid_to: null,
          supersedes_memory_id: ids.historyMemory,
          deleted_at: null,
          normalized_key: "must-not-cross-dto",
        },
        {
          id: ids.historyMemory,
          scope: "role_private",
          role_id: ids.role,
          category: "preference",
          content: "用户以前喜欢牛奶。",
          sensitivity: "normal",
          status: "superseded",
          confirmed_by_user: false,
          valid_from: "2026-08-01T00:00:00.000Z",
          valid_to: "2026-09-02T00:00:00.000Z",
          supersedes_memory_id: null,
          deleted_at: null,
        },
        {
          id: "90000000-0000-4000-8000-000000000009",
          scope: "role_private",
          role_id: ids.otherRole,
          category: "sensitive",
          content: "不可见角色的数据",
          sensitivity: "sensitive",
          status: "active",
          confirmed_by_user: true,
          deleted_at: null,
        },
      ],
    );

    expect(result.roles).toEqual([{ id: ids.role, name: "林知夏" }]);
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      id: ids.currentMemory,
      content: "用户现在不喜欢牛奶。",
      confirmedByUser: true,
      history: [
        {
          id: ids.historyMemory,
          content: "用户以前喜欢牛奶。",
          status: "superseded",
        },
      ],
    });
    expect(result.memories[0]).not.toHaveProperty("normalizedKey");
    expect(result.memories[0]).not.toHaveProperty("sourceMessageId");
  });
});
