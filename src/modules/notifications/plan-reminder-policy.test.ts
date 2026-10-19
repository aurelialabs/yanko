import { describe, expect, it } from "vitest";

import { decidePlanReminderDispatch } from "./plan-reminder-policy";

const dueAt = "2026-09-02T07:00:00.000Z";
const now = new Date("2026-09-02T07:00:01.000Z");
const job = {
  userId: "9c02b183-6b33-4f3b-ae3e-580c89aa88a4",
  planId: "52fc7ced-82cf-485c-92be-d119f1bb0c56",
  scheduledFor: dueAt,
  status: "scheduled" as const,
};
const plan = {
  id: job.planId,
  userId: job.userId,
  scope: "day" as const,
  status: "active" as const,
  reminderAt: dueAt,
};

describe("decidePlanReminderDispatch", () => {
  it("allows a due job only when it still matches an active day plan", () => {
    expect(decidePlanReminderDispatch({ job, plan, now })).toEqual({
      shouldDeliver: true,
      reason: "deliver",
    });
  });

  it("waits for a future job instead of delivering early", () => {
    expect(
      decidePlanReminderDispatch({
        job: { ...job, scheduledFor: "2026-09-02T08:00:00.000Z" },
        plan: { ...plan, reminderAt: "2026-09-02T08:00:00.000Z" },
        now,
      }),
    ).toEqual({ shouldDeliver: false, reason: "job_not_due" });
  });

  it("does not deliver cancelled or succeeded jobs", () => {
    expect(
      decidePlanReminderDispatch({ job: { ...job, status: "cancelled" }, plan, now }),
    ).toEqual({ shouldDeliver: false, reason: "job_not_deliverable" });
    expect(
      decidePlanReminderDispatch({ job: { ...job, status: "succeeded" }, plan, now }),
    ).toEqual({ shouldDeliver: false, reason: "job_not_deliverable" });
  });

  it("fails closed when the plan has been completed, changed, or is not daily", () => {
    expect(
      decidePlanReminderDispatch({ job, plan: { ...plan, status: "completed" }, now }),
    ).toEqual({ shouldDeliver: false, reason: "plan_not_active_day" });
    expect(
      decidePlanReminderDispatch({
        job,
        plan: { ...plan, reminderAt: "2026-09-02T07:30:00.000Z" },
        now,
      }),
    ).toEqual({ shouldDeliver: false, reason: "reminder_changed" });
    expect(
      decidePlanReminderDispatch({ job, plan: { ...plan, scope: "week" }, now }),
    ).toEqual({ shouldDeliver: false, reason: "plan_not_active_day" });
  });

  it("fails closed when ownership or plan identity no longer matches", () => {
    expect(
      decidePlanReminderDispatch({ job, plan: { ...plan, userId: "other-user" }, now }),
    ).toEqual({ shouldDeliver: false, reason: "job_plan_mismatch" });
    expect(decidePlanReminderDispatch({ job, plan: null, now })).toEqual({
      shouldDeliver: false,
      reason: "job_plan_mismatch",
    });
  });
});
