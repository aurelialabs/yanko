import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/server/schemas";
import {
  AI_RUN_STATUSES,
  FEEDBACK_STATUSES,
  OOC_VERDICTS,
  type AiRunStatus,
  type FeedbackStatus,
  type OocVerdict,
} from "@/types/domain";

export const BADCASE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const BADCASE_SOURCES = [
  "persona_feedback",
  "automatic_eval",
  "manual",
] as const;

export type BadcaseSeverity = (typeof BADCASE_SEVERITIES)[number];
export type BadcaseSource = (typeof BADCASE_SOURCES)[number];
export type BadcaseFilterValue<T extends string> = T | "all";

export interface BadcaseListFilter {
  status: BadcaseFilterValue<FeedbackStatus>;
  severity: BadcaseFilterValue<BadcaseSeverity>;
  source: BadcaseFilterValue<BadcaseSource>;
}

export const defaultBadcaseListFilter: BadcaseListFilter = {
  status: "all",
  severity: "all",
  source: "all",
};

export interface AdminBadcaseListItem {
  id: string;
  source: BadcaseSource;
  capability: string;
  severity: BadcaseSeverity;
  status: FeedbackStatus;
  redactedExcerpt: string | null;
  createdAt: string;
  updatedAt: string;
  reviewRevision: number;
}

export interface AdminBadcaseDetail extends AdminBadcaseListItem {
  diagnosis: string | null;
  resolvedAt: string | null;
  aiRun: AdminBadcaseAiRunSummary | null;
}

export interface AdminBadcaseOocCheckSummary {
  attemptNo: number;
  verdict: OocVerdict;
  overallScore: number | null;
  failureLabels: string[];
  latencyMs: number;
}

export interface AdminBadcaseAiRunSummary {
  provider: string;
  model: string;
  status: AiRunStatus;
  rewritten: boolean;
  attemptNo: number;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
  oocChecks: AdminBadcaseOocCheckSummary[];
}

export type AdminBadcaseListData =
  | { source: "database"; items: AdminBadcaseListItem[] }
  | { source: "forbidden" | "unavailable"; items: [] };

export type AdminBadcaseDetailData =
  | { source: "database"; item: AdminBadcaseDetail }
  | { source: "not_found" | "forbidden" | "unavailable"; item: null };

interface RawBadcase {
  [key: string]: unknown;
  id?: unknown;
  source_type?: unknown;
  capability?: unknown;
  severity?: unknown;
  status?: unknown;
  diagnosis?: unknown;
  redacted_excerpt?: unknown;
  resolved_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  review_revision?: unknown;
  ai_run_id?: unknown;
  user_id?: unknown;
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] | null {
  return typeof value === "string" && values.includes(value) ? value : null;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum)}…`;
}

function dateTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function badcaseId(value: unknown): string | null {
  return typeof value === "string" && uuidSchema.safeParse(value).success
    ? value
    : null;
}

function feedbackStatus(value: unknown): FeedbackStatus | null {
  return enumValue(value, FEEDBACK_STATUSES);
}

function revision(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function integer(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum
    ? value
    : null;
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function aiRunStatus(value: unknown): AiRunStatus | null {
  return enumValue(value, AI_RUN_STATUSES);
}

function oocVerdict(value: unknown): OocVerdict | null {
  return enumValue(value, OOC_VERDICTS);
}

function parseFailureLabels(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const labels = value.map((item) => text(item, 80));
  return labels.every((label): label is string => label !== null) ? labels : null;
}

export function toAdminBadcaseOocCheckSummary(
  row: Record<string, unknown>,
): AdminBadcaseOocCheckSummary | null {
  const attemptNo = integer(row.attempt_no, 1);
  const verdict = oocVerdict(row.verdict);
  const latencyMs = integer(row.latency_ms);
  const overallScore = row.overall_score === null ? null : Number(row.overall_score);
  const failureLabels = parseFailureLabels(row.failure_labels);
  if (
    attemptNo === null ||
    attemptNo > 2 ||
    !verdict ||
    !Number.isFinite(overallScore) ||
    (overallScore !== null && (overallScore < 0 || overallScore > 1)) ||
    failureLabels === null ||
    latencyMs === null
  ) {
    return null;
  }
  return { attemptNo, verdict, overallScore, failureLabels, latencyMs };
}

export function toAdminBadcaseAiRunSummary(
  row: Record<string, unknown>,
  oocRows: Record<string, unknown>[] = [],
): AdminBadcaseAiRunSummary | null {
  const provider = text(row.provider, 80);
  const model = text(row.model, 120);
  const status = aiRunStatus(row.status);
  const rewritten = booleanValue(row.rewritten);
  const attemptNo = integer(row.attempt_no, 1);
  const latencyMs = nullableInteger(row.latency_ms);
  const inputTokens = nullableInteger(row.input_tokens);
  const outputTokens = nullableInteger(row.output_tokens);
  const errorCode = row.error_code === null ? null : text(row.error_code, 120);
  const startedAt = dateTime(row.started_at);
  const completedAt = row.completed_at === null ? null : dateTime(row.completed_at);
  if (
    !provider ||
    !model ||
    !status ||
    rewritten === null ||
    attemptNo === null ||
    attemptNo > 20 ||
    (latencyMs === null && row.latency_ms !== null) ||
    (inputTokens === null && row.input_tokens !== null) ||
    (outputTokens === null && row.output_tokens !== null) ||
    (errorCode === null && row.error_code !== null) ||
    !startedAt ||
    (row.completed_at !== null && !completedAt)
  ) {
    return null;
  }
  return {
    provider,
    model,
    status,
    rewritten,
    attemptNo,
    latencyMs,
    inputTokens,
    outputTokens,
    errorCode,
    startedAt,
    completedAt,
    oocChecks: oocRows
      .map(toAdminBadcaseOocCheckSummary)
      .filter((check): check is AdminBadcaseOocCheckSummary => check !== null)
      .sort((a, b) => a.attemptNo - b.attemptNo),
  };
}

export function parseBadcaseListFilter(input: {
  status?: string | string[];
  severity?: string | string[];
  source?: string | string[];
}): BadcaseListFilter {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const status = enumValue(first(input.status), FEEDBACK_STATUSES) ?? "all";
  const severity = enumValue(first(input.severity), BADCASE_SEVERITIES) ?? "all";
  const source = enumValue(first(input.source), BADCASE_SOURCES) ?? "all";

  return { status, severity, source };
}

/** Parses the narrow common DTO used by both the list and the detail view. */
export function toAdminBadcaseListItem(row: RawBadcase): AdminBadcaseListItem | null {
  const id = badcaseId(row.id);
  const source = enumValue(row.source_type, BADCASE_SOURCES);
  const capability = text(row.capability, 120);
  const severity = enumValue(row.severity, BADCASE_SEVERITIES);
  const status = feedbackStatus(row.status);
  const createdAt = dateTime(row.created_at);
  const updatedAt = dateTime(row.updated_at);
  const reviewRevision = revision(row.review_revision);

  if (
    !id ||
    !source ||
    !capability ||
    !severity ||
    !status ||
    !createdAt ||
    !updatedAt ||
    reviewRevision === null
  ) {
    return null;
  }

  return {
    id,
    source,
    capability,
    severity,
    status,
    redactedExcerpt: text(row.redacted_excerpt, 2_000),
    createdAt,
    updatedAt,
    reviewRevision,
  };
}

export function toAdminBadcaseDetail(row: RawBadcase): AdminBadcaseDetail | null {
  const item = toAdminBadcaseListItem(row);
  const resolvedAt = row.resolved_at === null ? null : dateTime(row.resolved_at);

  if (!item || (row.resolved_at !== null && !resolvedAt)) return null;

  return {
    ...item,
    diagnosis: text(row.diagnosis, 4_000),
    resolvedAt,
    aiRun: null,
  };
}

async function hasActiveAdminAccess(
  user: User | null,
): Promise<"granted" | "forbidden" | "unavailable"> {
  if (!user || !uuidSchema.safeParse(user.id).success) return "unavailable";

  const supabase = await createServerSupabaseClient();
  if (!supabase) return "unavailable";

  const { data, error } = await supabase.rpc("is_admin");
  if (error) return "unavailable";
  return data === true ? "granted" : "forbidden";
}

/** Reads only redacted diagnostic fields after rechecking the active admin claim. */
export async function getAdminBadcaseList(
  user: User | null,
  filter: BadcaseListFilter,
): Promise<AdminBadcaseListData> {
  const access = await hasActiveAdminAccess(user);
  if (access !== "granted") return { source: access, items: [] };

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { source: "unavailable", items: [] };

  let query = supabase
    .from("badcases")
    .select(
      "id, source_type, capability, severity, status, redacted_excerpt, created_at, updated_at, review_revision",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (filter.status !== "all") query = query.eq("status", filter.status);
  if (filter.severity !== "all") query = query.eq("severity", filter.severity);
  if (filter.source !== "all") query = query.eq("source_type", filter.source);

  const { data, error } = await query;
  if (error) return { source: "unavailable", items: [] };

  return {
    source: "database",
    items: ((data ?? []) as RawBadcase[])
      .map(toAdminBadcaseListItem)
      .filter((item): item is AdminBadcaseListItem => item !== null),
  };
}

/** Re-reads one ID through RLS and never selects user IDs, message bodies, AI runs, or artifacts. */
export async function getAdminBadcaseDetail(
  user: User | null,
  id: string,
): Promise<AdminBadcaseDetailData> {
  if (!uuidSchema.safeParse(id).success) return { source: "not_found", item: null };

  const access = await hasActiveAdminAccess(user);
  if (access !== "granted") return { source: access, item: null };

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { source: "unavailable", item: null };

  const { data, error } = await supabase
    .from("badcases")
    .select(
      "id, user_id, source_type, capability, severity, status, diagnosis, redacted_excerpt, resolved_at, created_at, updated_at, review_revision, ai_run_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { source: "unavailable", item: null };

  const item = data ? toAdminBadcaseDetail(data as RawBadcase) : null;
  if (!item) return { source: "not_found", item: null };

  const linkedAiRunId = badcaseId((data as RawBadcase | null)?.ai_run_id);
  const linkedUserId = badcaseId((data as RawBadcase | null)?.user_id);
  if (!linkedAiRunId || !linkedUserId) return { source: "database", item };

  const [runResult, checksResult] = await Promise.all([
    supabase
      .from("ai_runs")
      .select(
        "provider, model, status, rewritten, attempt_no, latency_ms, input_tokens, output_tokens, error_code, started_at, completed_at",
      )
      .eq("id", linkedAiRunId)
      .eq("user_id", linkedUserId)
      .maybeSingle(),
    supabase
      .from("ooc_checks")
      .select("attempt_no, verdict, overall_score, failure_labels, latency_ms")
      .eq("ai_run_id", linkedAiRunId)
      .order("attempt_no", { ascending: true }),
  ]);
  if (runResult.error || checksResult.error || !runResult.data) {
    return { source: "unavailable", item: null };
  }
  const aiRun = toAdminBadcaseAiRunSummary(
    runResult.data as Record<string, unknown>,
    (checksResult.data ?? []) as Record<string, unknown>[],
  );
  if (!aiRun) return { source: "unavailable", item: null };
  return { source: "database", item: { ...item, aiRun } };
}

export async function isActiveAdmin(user: User | null): Promise<boolean> {
  return (await hasActiveAdminAccess(user)) === "granted";
}
