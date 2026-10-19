import "server-only";

import type { JobStatus, PlanScope, PlanStatus } from "@/types/domain";

export type PlanReminderDispatchReason =
  | "deliver"
  | "job_not_deliverable"
  | "job_not_due"
  | "invalid_scheduled_time"
  | "job_plan_mismatch"
  | "plan_not_active_day"
  | "reminder_changed";

export interface PlanReminderJobSnapshot {
  userId: string;
  planId: string;
  scheduledFor: string;
  status: JobStatus;
}

export interface PlanReminderPlanSnapshot {
  id: string;
  userId: string;
  scope: PlanScope;
  status: PlanStatus;
  reminderAt: string | null;
}

export interface PlanReminderDispatchDecision {
  shouldDeliver: boolean;
  reason: PlanReminderDispatchReason;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Re-checks the job against the current plan immediately before a background
 * worker sends anything. This makes delayed or already-claimed jobs fail
 * closed after the user changes a reminder, completes a plan, or switches the
 * plan to a different state.
 */
export function decidePlanReminderDispatch(input: {
  job: PlanReminderJobSnapshot;
  plan: PlanReminderPlanSnapshot | null;
  now: Date;
}): PlanReminderDispatchDecision {
  if (!input.now || Number.isNaN(input.now.valueOf())) {
    return { shouldDeliver: false, reason: "invalid_scheduled_time" };
  }

  if (!["scheduled", "running"].includes(input.job.status)) {
    return { shouldDeliver: false, reason: "job_not_deliverable" };
  }

  const scheduledFor = timestamp(input.job.scheduledFor);
  if (scheduledFor === null) {
    return { shouldDeliver: false, reason: "invalid_scheduled_time" };
  }

  if (scheduledFor > input.now.valueOf()) {
    return { shouldDeliver: false, reason: "job_not_due" };
  }

  const { plan } = input;
  if (!plan || plan.id !== input.job.planId || plan.userId !== input.job.userId) {
    return { shouldDeliver: false, reason: "job_plan_mismatch" };
  }

  if (plan.scope !== "day" || plan.status !== "active") {
    return { shouldDeliver: false, reason: "plan_not_active_day" };
  }

  if (!plan.reminderAt || timestamp(plan.reminderAt) !== scheduledFor) {
    return { shouldDeliver: false, reason: "reminder_changed" };
  }

  return { shouldDeliver: true, reason: "deliver" };
}
