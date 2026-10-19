import type {
  PlanPresentation,
  PlanWorkspaceData,
} from "@/modules/plan/plan-presentation";

import type { ChatTodayOverview, ChatTodayPlanPresentation } from "./chat-presentation";

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${read("month")}月${read("day")}日 · ${read("weekday")}`;
}

function timeLabel(plan: PlanPresentation, timezone: string) {
  if (!plan.scheduledAt) return "全天";

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(plan.scheduledAt));
}

function scheduledSortValue(plan: PlanPresentation) {
  return plan.scheduledAt
    ? new Date(plan.scheduledAt).getTime()
    : Number.POSITIVE_INFINITY;
}

/** Converts the shared plan workspace into the small, role-neutral chat sidebar view. */
export function buildChatTodayOverview(
  workspace: PlanWorkspaceData,
): ChatTodayOverview {
  const dayPlans = workspace.plans.filter(
    (plan) => plan.scope === "day" && plan.periodStart === workspace.anchorDate,
  );
  const nextPlans = dayPlans
    .filter((plan) => plan.status === "active")
    .sort(
      (left, right) =>
        scheduledSortValue(left) - scheduledSortValue(right) ||
        left.sortOrder - right.sortOrder,
    )
    .slice(0, 3)
    .map((plan): ChatTodayPlanPresentation => ({
      id: plan.id,
      title: plan.title,
      timeLabel: timeLabel(plan, workspace.timezone),
    }));

  return {
    dateLabel: dateLabel(workspace.anchorDate),
    completedCount: dayPlans.filter((plan) => plan.status === "completed").length,
    totalCount: dayPlans.length,
    nextPlans,
  };
}
