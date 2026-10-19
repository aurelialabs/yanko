"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PlanActionState } from "@/modules/plan/plan-action-state";
import {
  confirmPlanProposalSchema,
  ianaTimezoneSchema,
  type PlanInput,
  rejectPlanProposalSchema,
} from "@/server/schemas";

const planToggleSchema = z.object({
  planId: z.string().uuid(),
  expectedStatus: z.enum(["pending", "active", "completed", "cancelled"]),
  nextStatus: z.enum(["active", "completed"]),
  idempotencyKey: z.string().uuid(),
});

const planDeleteSchema = z.object({
  planId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});

const planUpdateSchema = z.object({
  planId: z.string().uuid(),
  scope: z.enum(["day", "week", "month", "year"]),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(5000),
  periodStart: z.string(),
  periodEnd: z.string(),
  dueDate: z.string(),
  scheduledTime: z.string(),
  idempotencyKey: z.string().uuid(),
});

const createPlanFormSchema = z.object({
  scope: z.enum(["day", "week", "month", "year"]),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(5000),
  dayDate: z.string(),
  weekDate: z.string(),
  month: z.string(),
  year: z.string(),
  scheduledTime: z.string(),
  dueDate: z.string(),
  parentPlanId: z.union([z.literal(""), z.string().uuid()]),
  idempotencyKey: z.string().uuid(),
});

const confirmPlanProposalFormSchema = createPlanFormSchema.extend({
  proposalId: z.string().uuid(),
  reminderTime: z.string(),
});

const rejectPlanProposalFormSchema = z.object({
  proposalId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});

type NewPlanValues = {
  scope: "day" | "week" | "month" | "year";
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  scheduledAt: string | null;
  parentPlanId: string | null;
};

type UpdatePlanValues = Pick<
  NewPlanValues,
  "periodStart" | "periodEnd" | "dueDate" | "scheduledAt"
>;

function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isExactIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  return addUtcDays(value, 1 - day);
}

function getLocalDateParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

function scheduledTimeInTimezone(date: string, time: string, timezone: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const intendedUtc = Date.UTC(year, month - 1, day, hour, minute);
  const observed = getLocalDateParts(new Date(intendedUtc), timezone);
  const observedUtc = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
  );
  const scheduledAt = new Date(intendedUtc - (observedUtc - intendedUtc));
  const result = getLocalDateParts(scheduledAt, timezone);

  if (
    result.year !== year ||
    result.month !== month ||
    result.day !== day ||
    result.hour !== hour ||
    result.minute !== minute
  ) {
    return null;
  }

  return scheduledAt.toISOString();
}

function createPlanValues(
  input: z.infer<typeof createPlanFormSchema>,
  timezone: string,
): NewPlanValues | null {
  if (input.scope === "day") {
    if (!isExactIsoDate(input.dayDate)) return null;
    const scheduledAt = input.scheduledTime
      ? scheduledTimeInTimezone(input.dayDate, input.scheduledTime, timezone)
      : null;

    if (input.scheduledTime && !scheduledAt) return null;

    return {
      scope: input.scope,
      periodStart: input.dayDate,
      periodEnd: input.dayDate,
      dueDate: null,
      scheduledAt,
      parentPlanId: null,
    };
  }

  if (input.scope === "week") {
    if (!isExactIsoDate(input.weekDate)) return null;
    const periodStart = startOfWeek(input.weekDate);
    const periodEnd = addUtcDays(periodStart, 6);
    const dueDate = input.dueDate || null;

    if (
      dueDate &&
      (!isExactIsoDate(dueDate) || dueDate < periodStart || dueDate > periodEnd)
    ) {
      return null;
    }

    return {
      scope: input.scope,
      periodStart,
      periodEnd,
      dueDate,
      scheduledAt: null,
      parentPlanId: null,
    };
  }

  if (input.scope === "month") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) return null;
    const periodStart = `${input.month}-01`;
    const date = new Date(`${periodStart}T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCDate(0);
    const periodEnd = date.toISOString().slice(0, 10);
    const dueDate = input.dueDate || null;

    if (
      dueDate &&
      (!isExactIsoDate(dueDate) || dueDate < periodStart || dueDate > periodEnd)
    ) {
      return null;
    }

    return {
      scope: input.scope,
      periodStart,
      periodEnd,
      dueDate,
      scheduledAt: null,
      parentPlanId: null,
    };
  }

  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  const periodStart = `${year}-01-01`;
  const periodEnd = `${year}-12-31`;
  const dueDate = input.dueDate || null;
  if (
    dueDate &&
    (!isExactIsoDate(dueDate) || dueDate < periodStart || dueDate > periodEnd)
  ) {
    return null;
  }

  return {
    scope: input.scope,
    periodStart,
    periodEnd,
    dueDate,
    scheduledAt: null,
    parentPlanId: input.parentPlanId || null,
  };
}

function updatePlanValues(
  input: z.infer<typeof planUpdateSchema>,
  timezone: string,
): UpdatePlanValues | null {
  if (!isExactIsoDate(input.periodStart) || !isExactIsoDate(input.periodEnd)) {
    return null;
  }

  let expectedEnd = input.periodEnd;
  if (input.scope === "day") {
    if (input.periodEnd !== input.periodStart) return null;
  } else if (input.scope === "week") {
    const startDay = new Date(input.periodStart + "T00:00:00.000Z").getUTCDay();
    if (startDay !== 1) return null;
    expectedEnd = addUtcDays(input.periodStart, 6);
  } else if (input.scope === "month") {
    if (input.periodStart.slice(8) !== "01") return null;
    const monthEnd = new Date(input.periodStart + "T00:00:00.000Z");
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    monthEnd.setUTCDate(0);
    expectedEnd = monthEnd.toISOString().slice(0, 10);
  } else {
    if (input.periodStart.slice(5) !== "01-01") return null;
    expectedEnd = input.periodStart.slice(0, 4) + "-12-31";
  }

  if (input.scope === "day" && input.periodEnd !== expectedEnd) return null;

  const dueDate = input.dueDate || null;
  if (
    dueDate &&
    (!isExactIsoDate(dueDate) || dueDate < input.periodStart || dueDate > expectedEnd)
  ) {
    return null;
  }

  if (input.scope !== "day" && input.scheduledTime) return null;
  const scheduledAt =
    input.scope === "day" && input.scheduledTime
      ? scheduledTimeInTimezone(input.periodStart, input.scheduledTime, timezone)
      : null;

  if (input.scope === "day" && input.scheduledTime && !scheduledAt) return null;

  return {
    periodStart: input.periodStart,
    periodEnd: expectedEnd,
    dueDate,
    scheduledAt,
  };
}

function proposalPlanValues(plan: PlanInput): NewPlanValues {
  if (plan.scope === "day") {
    return {
      scope: plan.scope,
      periodStart: plan.date,
      periodEnd: plan.date,
      dueDate: null,
      scheduledAt: plan.scheduledAt ?? null,
      parentPlanId: null,
    };
  }

  if (plan.scope === "week") {
    return {
      scope: plan.scope,
      periodStart: plan.weekStart,
      periodEnd: addUtcDays(plan.weekStart, 6),
      dueDate: plan.dueDate ?? null,
      scheduledAt: null,
      parentPlanId: null,
    };
  }

  if (plan.scope === "month") {
    const periodStart = `${plan.month}-01`;
    const lastDay = new Date(`${periodStart}T00:00:00.000Z`);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
    lastDay.setUTCDate(0);

    return {
      scope: plan.scope,
      periodStart,
      periodEnd: lastDay.toISOString().slice(0, 10),
      dueDate: plan.dueDate ?? null,
      scheduledAt: null,
      parentPlanId: null,
    };
  }

  return {
    scope: plan.scope,
    periodStart: `${plan.year}-01-01`,
    periodEnd: `${plan.year}-12-31`,
    dueDate: plan.dueDate ?? null,
    scheduledAt: null,
    parentPlanId: plan.parentPlanId ?? null,
  };
}

/** Changes only an owned plan's completion status; the DB trigger records history. */
export async function togglePlanCompletion(
  _previousState: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const input = planToggleSchema.safeParse({
    planId: formData.get("planId"),
    expectedStatus: formData.get("expectedStatus"),
    nextStatus: formData.get("nextStatus"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!input.success) {
    return { message: "计划信息无效，请刷新后重试。" };
  }

  const auth = await getAuthContext();

  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return { message: "计划服务尚未配置，暂时无法保存。" };
  }

  const { error } = await supabase.rpc("change_plan_status", {
    p_plan_id: input.data.planId,
    p_expected_status: input.data.expectedStatus,
    p_next_status: input.data.nextStatus,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error) {
    return { message: "暂时无法保存完成状态，请稍后再试。" };
  }

  revalidatePath("/plan");
  return { message: "" };
}

/** Creates one manual plan after validating its scope-specific time boundary. */
export async function createManualPlan(
  _previousState: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const input = createPlanFormSchema.safeParse({
    scope: textField(formData, "scope"),
    title: textField(formData, "title"),
    notes: textField(formData, "notes"),
    dayDate: textField(formData, "dayDate"),
    weekDate: textField(formData, "weekDate"),
    month: textField(formData, "month"),
    year: textField(formData, "year"),
    scheduledTime: textField(formData, "scheduledTime"),
    dueDate: textField(formData, "dueDate"),
    parentPlanId: textField(formData, "parentPlanId"),
    idempotencyKey: textField(formData, "idempotencyKey"),
  });

  if (!input.success) {
    return { message: "请检查计划名称与填写内容后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "计划服务尚未配置，暂时无法保存。" };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const timezone =
    !settingsError && typeof settings?.timezone === "string"
      ? settings.timezone
      : "Asia/Shanghai";
  const values = createPlanValues(input.data, timezone);

  if (!values) {
    return { message: "计划日期、截止日期或时间不符合当前计划范围。" };
  }

  const { data, error } = await supabase.rpc("create_manual_plan", {
    p_scope: values.scope,
    p_title: input.data.title,
    p_notes: input.data.notes || null,
    p_period_start: values.periodStart,
    p_period_end: values.periodEnd,
    p_due_date: values.dueDate,
    p_scheduled_at: values.scheduledAt,
    p_reminder_at: null,
    p_timezone: timezone,
    p_parent_plan_id: values.parentPlanId,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error || typeof data !== "string") {
    return { message: "暂时无法创建计划，请稍后再试。" };
  }

  revalidatePath("/plan");
  return { message: "", createdPlanId: data };
}

/**
 * Confirms an already shown chat plan proposal. This action deliberately
 * accepts the user's final editable fields, derives the account timezone on
 * the server, and delegates all ownership, expiry, and atomicity checks to
 * the guarded database RPC. No chat UI calls it until that card is designed.
 */
export async function confirmPlanProposal(rawInput: unknown): Promise<PlanActionState> {
  const input = confirmPlanProposalSchema.safeParse(rawInput);

  if (!input.success) {
    return { message: "请检查计划名称、日期和时间后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "计划服务尚未配置，暂时无法确认。" };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const configuredTimezone = ianaTimezoneSchema.safeParse(settings?.timezone);
  const timezone =
    !settingsError && configuredTimezone.success
      ? configuredTimezone.data
      : "Asia/Shanghai";
  const values = proposalPlanValues(input.data.plan);

  const { data, error } = await supabase.rpc("confirm_plan_proposal", {
    p_proposal_id: input.data.proposalId,
    p_scope: values.scope,
    p_title: input.data.plan.title,
    p_notes: input.data.plan.notes ?? null,
    p_period_start: values.periodStart,
    p_period_end: values.periodEnd,
    p_due_date: values.dueDate,
    p_scheduled_at: values.scheduledAt,
    p_reminder_at:
      input.data.plan.scope === "day" ? (input.data.plan.reminderAt ?? null) : null,
    p_timezone: timezone,
    p_parent_plan_id: values.parentPlanId,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error) {
    return { message: "暂时无法确认计划，请稍后再试。" };
  }

  if (typeof data !== "string") {
    return { message: "这份计划草稿已失效，请重新发起创建。" };
  }

  // Keep the current chat tree mounted so the action state can show its
  // success card. A later navigation or reload reads the finalized proposal.
  revalidatePath("/plan");
  return { message: "", createdPlanId: data };
}

/**
 * Form-oriented chat confirmation. Scope-specific dates and local wall-clock
 * times are validated on the server and converted with the account timezone;
 * the browser cannot choose the stored timezone.
 */
export async function confirmPlanProposalFromChat(
  _previousState: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const input = confirmPlanProposalFormSchema.safeParse({
    proposalId: textField(formData, "proposalId"),
    scope: textField(formData, "scope"),
    title: textField(formData, "title"),
    notes: textField(formData, "notes"),
    dayDate: textField(formData, "dayDate"),
    weekDate: textField(formData, "weekDate"),
    month: textField(formData, "month"),
    year: textField(formData, "year"),
    scheduledTime: textField(formData, "scheduledTime"),
    reminderTime: textField(formData, "reminderTime"),
    dueDate: textField(formData, "dueDate"),
    parentPlanId: textField(formData, "parentPlanId"),
    idempotencyKey: textField(formData, "idempotencyKey"),
  });
  if (!input.success) {
    return { message: "请检查计划名称、日期和时间后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "计划服务尚未配置，暂时无法确认。" };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const configuredTimezone = ianaTimezoneSchema.safeParse(settings?.timezone);
  const timezone =
    !settingsError && configuredTimezone.success
      ? configuredTimezone.data
      : "Asia/Shanghai";
  const values = createPlanValues(input.data, timezone);
  if (!values) {
    return { message: "计划日期、截止日期或时间不符合当前计划范围。" };
  }

  const reminderAt =
    input.data.scope === "day" && input.data.reminderTime
      ? scheduledTimeInTimezone(input.data.dayDate, input.data.reminderTime, timezone)
      : null;
  if (
    (input.data.scope !== "day" && input.data.reminderTime) ||
    (input.data.reminderTime &&
      (!reminderAt ||
        !values.scheduledAt ||
        Date.parse(reminderAt) > Date.parse(values.scheduledAt)))
  ) {
    return { message: "提醒时间必须早于或等于计划时间。" };
  }

  const { data, error } = await supabase.rpc("confirm_plan_proposal", {
    p_proposal_id: input.data.proposalId,
    p_scope: values.scope,
    p_title: input.data.title,
    p_notes: input.data.notes || null,
    p_period_start: values.periodStart,
    p_period_end: values.periodEnd,
    p_due_date: values.dueDate,
    p_scheduled_at: values.scheduledAt,
    p_reminder_at: reminderAt,
    p_timezone: timezone,
    p_parent_plan_id: values.parentPlanId,
    p_idempotency_key: input.data.idempotencyKey,
  });
  if (error) {
    return { message: "暂时无法确认计划，请稍后再试。" };
  }
  if (typeof data !== "string") {
    return { message: "这份计划草稿已失效，请重新发起创建。" };
  }

  // Keep the current chat tree mounted so the action state can show its
  // success card. A later navigation or reload reads the finalized proposal.
  revalidatePath("/plan");
  return { message: "", createdPlanId: data };
}

/**
 * Dismisses a pending chat plan proposal without ever touching a formal plan.
 * The database RPC re-checks owner, expiry, and pending status, and records a
 * dedicated idempotency key for safe retries.
 */
export async function rejectPlanProposal(rawInput: unknown): Promise<PlanActionState> {
  const input = rejectPlanProposalSchema.safeParse(rawInput);

  if (!input.success) {
    return { message: "计划草稿信息无效，请刷新后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "计划服务尚未配置，暂时无法处理。" };
  }

  const { data, error } = await supabase.rpc("reject_plan_proposal", {
    p_proposal_id: input.data.proposalId,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error) {
    return { message: "暂时无法处理计划草稿，请稍后再试。" };
  }

  if (typeof data !== "string") {
    return { message: "这份计划草稿已失效。" };
  }

  // Do not refresh the chat tree before the rejection state can be announced.
  return { message: "", rejectedProposalId: data };
}

/** Form-oriented rejection used by a chat confirmation card. */
export async function rejectPlanProposalFromChat(
  _previousState: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const input = rejectPlanProposalFormSchema.safeParse({
    proposalId: textField(formData, "proposalId"),
    idempotencyKey: textField(formData, "idempotencyKey"),
  });
  if (!input.success) {
    return { message: "计划草稿信息无效，请刷新后重试。" };
  }

  return rejectPlanProposal(input.data);
}

/** Deletes one owned plan; deleting an annual goal also removes its own subgoals. */
export async function deletePlan(
  _previousState: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const input = planDeleteSchema.safeParse({
    planId: formData.get("planId"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!input.success) {
    return { message: "计划信息无效，请刷新后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "计划服务尚未配置，暂时无法删除。" };
  }

  const { error } = await supabase.rpc("delete_plan", {
    p_plan_id: input.data.planId,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error) {
    return { message: "暂时无法删除计划，请稍后再试。" };
  }

  revalidatePath("/plan");
  return { message: "", deletedPlanId: input.data.planId };
}

/** Updates only the editable details of one owned plan. Scope and hierarchy stay server-controlled. */
export async function updatePlanDetails(
  _previousState: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const input = planUpdateSchema.safeParse({
    planId: formData.get("planId"),
    scope: textField(formData, "scope"),
    title: textField(formData, "title"),
    notes: textField(formData, "notes"),
    periodStart: textField(formData, "periodStart"),
    periodEnd: textField(formData, "periodEnd"),
    dueDate: textField(formData, "dueDate"),
    scheduledTime: textField(formData, "scheduledTime"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!input.success) {
    return { message: "请检查标题与备注后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "计划服务尚未配置，暂时无法保存。" };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const timezone =
    !settingsError && typeof settings?.timezone === "string"
      ? settings.timezone
      : "Asia/Shanghai";
  const values = updatePlanValues(input.data, timezone);

  if (!values) {
    return { message: "时间范围、截止日期或时间点不符合当前计划类型。" };
  }

  const { data, error } = await supabase.rpc("update_plan_details", {
    p_plan_id: input.data.planId,
    p_title: input.data.title,
    p_notes: input.data.notes || null,
    p_period_start: values.periodStart,
    p_period_end: values.periodEnd,
    p_due_date: values.dueDate,
    p_scheduled_at: values.scheduledAt,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error || typeof data !== "string") {
    return { message: "暂时无法保存计划，请稍后再试。" };
  }

  revalidatePath("/plan");
  revalidatePath(`/plan/${input.data.planId}`);
  return { message: "", updatedPlanId: data };
}
