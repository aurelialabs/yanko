import { describe, expect, it } from "vitest";

import { buildInAppNotificationItems } from "./in-app-notification-data";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "20000000-0000-4000-8000-000000000002";
const planId = "30000000-0000-4000-8000-000000000003";
const otherPlanId = "40000000-0000-4000-8000-000000000004";

describe("buildInAppNotificationItems", () => {
  it("returns only owned, plan-backed reminder DTOs in source order", () => {
    const result = buildInAppNotificationItems(
      [
        {
          id: "50000000-0000-4000-8000-000000000005",
          user_id: userId,
          plan_id: planId,
          kind: "plan_reminder",
          delivered_at: "2026-09-07T02:00:00+00:00",
          read_at: null,
          notification_job_id: "must-not-cross-dto",
        },
        {
          id: "60000000-0000-4000-8000-000000000006",
          user_id: otherUserId,
          plan_id: otherPlanId,
          kind: "plan_reminder",
          delivered_at: "2026-09-07T01:00:00Z",
          read_at: null,
        },
      ],
      [
        { id: planId, user_id: userId, title: "上午十点提交周报" },
        { id: otherPlanId, user_id: otherUserId, title: "其他用户的计划" },
      ],
      userId,
    );

    expect(result).toEqual([
      {
        id: "50000000-0000-4000-8000-000000000005",
        planId,
        planTitle: "上午十点提交周报",
        deliveredAt: "2026-09-07T02:00:00.000Z",
        readAt: null,
      },
    ]);
    expect(result[0]).not.toHaveProperty("notificationJobId");
    expect(result[0]).not.toHaveProperty("userId");
  });

  it("drops malformed, missing-plan, wrong-kind, and invalid-time rows", () => {
    const base = {
      user_id: userId,
      plan_id: planId,
      kind: "plan_reminder",
      delivered_at: "2026-09-07T02:00:00Z",
      read_at: null,
    };
    const result = buildInAppNotificationItems(
      [
        { ...base, id: "invalid" },
        {
          ...base,
          id: "50000000-0000-4000-8000-000000000005",
          plan_id: otherPlanId,
        },
        {
          ...base,
          id: "60000000-0000-4000-8000-000000000006",
          kind: "push_sent",
        },
        {
          ...base,
          id: "70000000-0000-4000-8000-000000000007",
          delivered_at: "invalid",
        },
        {
          ...base,
          id: "80000000-0000-4000-8000-000000000008",
          read_at: "2026-09-07T01:59:59Z",
        },
      ],
      [{ id: planId, user_id: userId, title: "有效计划" }],
      userId,
    );

    expect(result).toEqual([]);
  });
});
