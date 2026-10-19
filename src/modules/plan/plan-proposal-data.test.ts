import { describe, expect, it } from "vitest";

import { buildPendingPlanProposals, type PlanProposalRow } from "./plan-proposal-data";

const roleId = "10000000-0000-4000-8000-000000000001";
const sourceMessageId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-07T00:00:00.000Z");

function row(overrides: Partial<PlanProposalRow> = {}): PlanProposalRow {
  return {
    id: "30000000-0000-4000-8000-000000000003",
    source_role_id: roleId,
    source_message_id: sourceMessageId,
    intent: "create",
    scope: "day",
    suggested_title: "整理作品集首页",
    original_time_text: "今天晚上七点半",
    parsed_payload: {
      date: "2026-09-07",
      scheduledAt: "2026-09-07T19:30:00+08:00",
      reminderAt: "2026-09-07T19:00:00+08:00",
    },
    missing_fields: [],
    status: "pending",
    expires_at: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildPendingPlanProposals", () => {
  it("returns a minimal editable DTO for a current-role pending proposal", () => {
    expect(buildPendingPlanProposals([row()], roleId, now)).toEqual([
      {
        id: "30000000-0000-4000-8000-000000000003",
        sourceMessageId,
        scope: "day",
        suggestedTitle: "整理作品集首页",
        originalTimeText: "今天晚上七点半",
        missingFields: [],
        expiresAt: "2026-09-14T00:00:00.000Z",
        date: "2026-09-07",
        scheduledTime: "19:30",
        reminderTime: "19:00",
        weekStart: "",
        month: "",
        year: "",
        dueDate: "",
        parentPlanId: "",
      },
    ]);
  });

  it("drops expired, another-role, non-create, and malformed records", () => {
    expect(
      buildPendingPlanProposals(
        [
          row({ expires_at: "2026-09-06T00:00:00.000Z" }),
          row({ source_role_id: "40000000-0000-4000-8000-000000000004" }),
          row({ intent: "offer" }),
          row({ id: "not-a-uuid" }),
        ],
        roleId,
        now,
      ),
    ).toEqual([]);
  });

  it("keeps missing or malformed model fields editable instead of inventing values", () => {
    const [proposal] = buildPendingPlanProposals(
      [
        row({
          suggested_title: null,
          original_time_text: null,
          parsed_payload: {
            date: "tomorrow",
            scheduledAt: "not-a-date",
          },
          missing_fields: ["title", "date", "title", ""],
        }),
      ],
      roleId,
      now,
    );

    expect(proposal).toMatchObject({
      suggestedTitle: "",
      originalTimeText: null,
      date: "",
      scheduledTime: "",
      reminderTime: "",
      missingFields: ["title", "date"],
    });
  });
});
