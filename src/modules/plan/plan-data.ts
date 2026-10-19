import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  createDemoPlanWorkspace,
  type PlanPresentation,
  type PlanScope,
  type PlanStatus,
  type PlanWorkspaceData,
} from "./plan-presentation";

type RawPlan = {
  id?: unknown;
  scope?: unknown;
  parent_plan_id?: unknown;
  title?: unknown;
  notes?: unknown;
  status?: unknown;
  period_start?: unknown;
  period_end?: unknown;
  due_date?: unknown;
  scheduled_at?: unknown;
  sort_order?: unknown;
};

export interface PlanDetailData {
  source: PlanWorkspaceData["source"];
  timezone: string;
  plan: PlanPresentation | null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function todayInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function toPlan(value: RawPlan): PlanPresentation | null {
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  const scope = stringValue(value.scope);
  const status = stringValue(value.status);
  const periodStart = stringValue(value.period_start);
  const periodEnd = stringValue(value.period_end);

  if (
    !id ||
    !title ||
    !periodStart ||
    !periodEnd ||
    !["day", "week", "month", "year"].includes(scope ?? "") ||
    !["active", "completed"].includes(status ?? "")
  ) {
    return null;
  }

  return {
    id,
    scope: scope as PlanScope,
    parentPlanId: stringValue(value.parent_plan_id),
    title,
    notes: stringValue(value.notes),
    status: status as PlanStatus,
    periodStart,
    periodEnd,
    dueDate: stringValue(value.due_date),
    scheduledAt: stringValue(value.scheduled_at),
    sortOrder: typeof value.sort_order === "number" ? value.sort_order : 0,
  };
}

function unavailableWorkspace(): PlanWorkspaceData {
  const timezone = "Asia/Shanghai";

  return {
    source: "unavailable",
    anchorDate: todayInTimezone(timezone),
    timezone,
    plans: [],
  };
}

/** Returns a small, user-owned plan DTO for the interactive plan workspace. */
export async function getPlanWorkspace(user: User | null): Promise<PlanWorkspaceData> {
  if (!user) {
    return createDemoPlanWorkspace();
  }

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return unavailableWorkspace();
  }

  const [settingsResult, plansResult] = await Promise.all([
    supabase
      .from("user_settings")
      .select("timezone")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("plans")
      .select(
        "id, scope, parent_plan_id, title, notes, status, period_start, period_end, due_date, scheduled_at, sort_order",
      )
      .eq("user_id", user.id)
      .in("status", ["active", "completed"])
      .order("period_start", { ascending: true })
      .order("sort_order", { ascending: true }),
  ]);

  if (plansResult.error) {
    return unavailableWorkspace();
  }

  const timezone = stringValue(settingsResult.data?.timezone) ?? "Asia/Shanghai";
  const anchorDate = todayInTimezone(timezone);
  const plans = ((plansResult.data ?? []) as RawPlan[])
    .map(toPlan)
    .filter((plan): plan is PlanPresentation => plan !== null);

  return { source: "database", anchorDate, timezone, plans };
}

/** Returns a single, user-owned plan for the details route. */
export async function getPlanDetail(
  user: User | null,
  planId: string,
): Promise<PlanDetailData> {
  if (!user) {
    const demoPlanWorkspace = createDemoPlanWorkspace();
    return {
      source: "demo",
      timezone: demoPlanWorkspace.timezone,
      plan: demoPlanWorkspace.plans.find((plan) => plan.id === planId) ?? null,
    };
  }

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return { source: "unavailable", timezone: "Asia/Shanghai", plan: null };
  }
  if (!isUuid(planId)) {
    return { source: "database", timezone: "Asia/Shanghai", plan: null };
  }

  const [settingsResult, planResult] = await Promise.all([
    supabase
      .from("user_settings")
      .select("timezone")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("plans")
      .select(
        "id, scope, parent_plan_id, title, notes, status, period_start, period_end, due_date, scheduled_at, sort_order",
      )
      .eq("id", planId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (planResult.error) {
    return { source: "unavailable", timezone: "Asia/Shanghai", plan: null };
  }

  return {
    source: "database",
    timezone: stringValue(settingsResult.data?.timezone) ?? "Asia/Shanghai",
    plan: planResult.data ? toPlan(planResult.data as RawPlan) : null,
  };
}
