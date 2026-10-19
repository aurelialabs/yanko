import { describe, expect, it } from "vitest";

import { confirmPlanProposalSchema, rejectPlanProposalSchema } from "./index";

const proposalId = "06b02ea4-3e11-4e97-af79-3d82b0137f67";
const idempotencyKey = "8f0f9875-8cfd-43c5-9525-f6e93ad139c5";

describe("confirmPlanProposalSchema", () => {
  it("accepts a day proposal with an optional scheduled time and reminder", () => {
    const result = confirmPlanProposalSchema.safeParse({
      proposalId,
      idempotencyKey,
      plan: {
        scope: "day",
        title: "交材料",
        timezone: "Asia/Shanghai",
        date: "2026-09-02",
        scheduledAt: "2026-09-02T15:00:00+08:00",
        reminderAt: "2026-09-02T14:30:00+08:00",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects weekly and monthly plans that try to include a specific time", () => {
    const weekly = confirmPlanProposalSchema.safeParse({
      proposalId,
      idempotencyKey,
      plan: {
        scope: "week",
        title: "完成调研",
        timezone: "Asia/Shanghai",
        weekStart: "2026-09-07",
        scheduledAt: "2026-09-09T09:00:00+08:00",
      },
    });
    const monthly = confirmPlanProposalSchema.safeParse({
      proposalId,
      idempotencyKey,
      plan: {
        scope: "month",
        title: "整理作品集",
        timezone: "Asia/Shanghai",
        month: "2026-09",
        reminderAt: "2026-09-10T09:00:00+08:00",
      },
    });

    expect(weekly.success).toBe(false);
    expect(monthly.success).toBe(false);
  });

  it("preserves the annual parent-goal relationship as an explicit user field", () => {
    const result = confirmPlanProposalSchema.safeParse({
      proposalId,
      idempotencyKey,
      plan: {
        scope: "year",
        title: "完成年度阅读目标",
        timezone: "Asia/Shanghai",
        year: 2027,
        parentPlanId: "6a066ca4-f7a6-4c7c-9966-f10d1fe7457d",
        dueDate: "2027-12-31",
      },
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.plan.scope === "year") {
      expect(result.data.plan.parentPlanId).toBe(
        "6a066ca4-f7a6-4c7c-9966-f10d1fe7457d",
      );
    }
  });

  it("rejects a reminder that is later than the scheduled day-plan time", () => {
    const result = confirmPlanProposalSchema.safeParse({
      proposalId,
      idempotencyKey,
      plan: {
        scope: "day",
        title: "交材料",
        timezone: "Asia/Shanghai",
        date: "2026-09-02",
        scheduledAt: "2026-09-02T15:00:00+08:00",
        reminderAt: "2026-09-02T15:30:00+08:00",
      },
    });

    expect(result.success).toBe(false);
  });

  it("requires an owned proposal id and an idempotency key before rejecting", () => {
    expect(
      rejectPlanProposalSchema.safeParse({ proposalId, idempotencyKey }).success,
    ).toBe(true);
    expect(rejectPlanProposalSchema.safeParse({ proposalId }).success).toBe(false);
  });
});
