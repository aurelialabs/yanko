import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/server/schemas";

import type { PendingPlanProposalPresentation, PlanScope } from "./plan-presentation";

export interface PlanProposalRow {
  id?: unknown;
  source_role_id?: unknown;
  source_message_id?: unknown;
  intent?: unknown;
  scope?: unknown;
  suggested_title?: unknown;
  original_time_text?: unknown;
  parsed_payload?: unknown;
  missing_fields?: unknown;
  status?: unknown;
  expires_at?: unknown;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function exactDate(value: unknown): string {
  const normalized = text(value, 10);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : "";
}

function exactMonth(value: unknown): string {
  const normalized = text(value, 7);
  return normalized && /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : "";
}

function exactYear(value: unknown): string {
  const year =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{4}$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? String(year) : "";
}

function timeFromDateTime(value: unknown, expectedDate: string): string {
  const normalized = text(value, 100);
  if (
    !normalized ||
    !expectedDate ||
    Number.isNaN(Date.parse(normalized)) ||
    !normalized.startsWith(`${expectedDate}T`)
  ) {
    return "";
  }
  return normalized.match(/T([0-2]\d:[0-5]\d)/)?.[1] ?? "";
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function missingFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((field) => text(field, 100))
        .filter((field): field is string => field !== null),
    ),
  ].slice(0, 20);
}

function toPresentation(
  row: PlanProposalRow,
  roleId: string,
  now: Date,
): PendingPlanProposalPresentation | null {
  const id = text(row.id, 100);
  const sourceRoleId = text(row.source_role_id, 100);
  const sourceMessageId = text(row.source_message_id, 100);
  const scope = text(row.scope, 20);
  const expiresAt = text(row.expires_at, 100);
  const expiresAtTime = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (
    !uuidSchema.safeParse(id).success ||
    sourceRoleId !== roleId ||
    !uuidSchema.safeParse(sourceMessageId).success ||
    row.intent !== "create" ||
    !["day", "week", "month", "year"].includes(scope ?? "") ||
    row.status !== "pending" ||
    !Number.isFinite(expiresAtTime) ||
    expiresAtTime <= now.getTime()
  ) {
    return null;
  }

  const payload = payloadRecord(row.parsed_payload);
  const date = scope === "day" ? exactDate(payload.date) : "";
  const parentPlanId =
    scope === "year" && uuidSchema.safeParse(payload.parentPlanId).success
      ? (payload.parentPlanId as string)
      : "";

  return {
    id: id!,
    sourceMessageId: sourceMessageId!,
    scope: scope as PlanScope,
    suggestedTitle: text(row.suggested_title, 200) ?? "",
    originalTimeText: text(row.original_time_text, 500),
    missingFields: missingFields(row.missing_fields),
    expiresAt: new Date(expiresAtTime).toISOString(),
    date,
    scheduledTime: scope === "day" ? timeFromDateTime(payload.scheduledAt, date) : "",
    reminderTime: scope === "day" ? timeFromDateTime(payload.reminderAt, date) : "",
    weekStart: scope === "week" ? exactDate(payload.weekStart) : "",
    month: scope === "month" ? exactMonth(payload.month) : "",
    year: scope === "year" ? exactYear(payload.year) : "",
    dueDate:
      scope === "week" || scope === "month" || scope === "year"
        ? exactDate(payload.dueDate)
        : "",
    parentPlanId,
  };
}

export function buildPendingPlanProposals(
  rows: readonly PlanProposalRow[],
  roleId: string,
  now = new Date(),
): PendingPlanProposalPresentation[] {
  if (!uuidSchema.safeParse(roleId).success || !Number.isFinite(now.getTime())) {
    return [];
  }
  return rows
    .map((row) => toPresentation(row, roleId, now))
    .filter(
      (proposal): proposal is PendingPlanProposalPresentation => proposal !== null,
    );
}

/** Reads only current-role, unexpired explicit-create proposals under RLS. */
export async function getPendingPlanProposals(
  user: User | null,
  roleId: string | null,
): Promise<PendingPlanProposalPresentation[]> {
  if (!user || !roleId || !uuidSchema.safeParse(roleId).success) return [];

  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const now = new Date();
  const { data, error } = await supabase
    .from("plan_proposals")
    .select(
      "id, source_role_id, source_message_id, intent, scope, suggested_title, original_time_text, parsed_payload, missing_fields, status, expires_at",
    )
    .eq("user_id", user.id)
    .eq("source_role_id", roleId)
    .eq("intent", "create")
    .eq("status", "pending")
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) return [];

  return buildPendingPlanProposals((data ?? []) as PlanProposalRow[], roleId, now);
}
