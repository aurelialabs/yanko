import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { personaSnapshotSchema } from "@/server/schemas";

type RawRow = Record<string, unknown>;

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const ACCOUNT_EXPORT_LIMITS = {
  roles: 200,
  personaVersions: 500,
  conversations: 500,
  messages: 5_000,
  memories: 2_000,
  plans: 2_000,
  planStatusEvents: 5_000,
  planProposals: 1_000,
  notifications: 1_000,
  personaFeedback: 1_000,
} as const;

export type AccountExportUser = Pick<User, "id" | "email" | "created_at">;

export interface AccountDataExportSource {
  profile: RawRow | null;
  settings: RawRow | null;
  roles: readonly RawRow[];
  personaVersions: readonly RawRow[];
  conversations: readonly RawRow[];
  messages: readonly RawRow[];
  memories: readonly RawRow[];
  plans: readonly RawRow[];
  planStatusEvents: readonly RawRow[];
  planProposals: readonly RawRow[];
  notifications: readonly RawRow[];
  personaFeedback: readonly RawRow[];
}

export interface AccountDataExport {
  schemaVersion: 1;
  exportedAt: string;
  account: {
    email: string | null;
    createdAt: string | null;
    displayName: string | null;
    avatarSeed: string | null;
    onboardingCompletedAt: string | null;
  };
  settings: {
    timezone: string | null;
    locale: string | null;
    theme: string | null;
    fontScale: number | null;
    preferredUserName: string | null;
    defaultDayTime: string | null;
    defaultReminderMinutes: number | null;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    browserNotificationsEnabled: boolean | null;
  } | null;
  roles: JsonValue[];
  conversations: JsonValue[];
  memories: JsonValue[];
  plans: JsonValue[];
  planStatusEvents: JsonValue[];
  planProposals: JsonValue[];
  inAppNotifications: JsonValue[];
  personaFeedback: JsonValue[];
  truncatedCollections: string[];
}

export class AccountDataExportError extends Error {
  constructor() {
    super("account data export unavailable");
  }
}

function record(value: unknown): RawRow | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRow)
    : null;
}

function rows(value: unknown): RawRow[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const itemRecord = record(item);
        return itemRecord ? [itemRecord] : [];
      })
    : [];
}

function text(value: unknown, maxLength = 50_000): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
    ? value
    : null;
}

function nullableText(value: unknown, maxLength = 50_000): string | null {
  return value === null ? null : text(value, maxLength);
}

function dateTime(value: unknown): string | null {
  const candidate = text(value, 100);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return null;
  return new Date(candidate).toISOString();
}

function date(value: unknown): string | null {
  const candidate = text(value, 10);
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function uuid(value: unknown): string | null {
  const candidate = text(value, 36);
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      candidate,
    )
    ? candidate
    : null;
}

/** Bounds arbitrary persisted JSON before including it in a download. */
function json(value: unknown, depth = 0): JsonValue | null {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length <= 10_000 ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (depth >= 8) return null;
  if (Array.isArray(value)) {
    if (value.length > 100) return null;
    const items = value.map((item) => json(item, depth + 1));
    return items.some((item) => item === null) ? null : (items as JsonValue[]);
  }
  const itemRecord = record(value);
  if (!itemRecord || Object.keys(itemRecord).length > 100) return null;
  const output: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(itemRecord)) {
    if (!key || key.length > 100) return null;
    const parsed = json(item, depth + 1);
    if (parsed === null && item !== null) return null;
    output[key] = parsed;
  }
  return output;
}

function limited<T>(
  source: readonly RawRow[],
  limit: number,
  transform: (row: RawRow) => T | null,
): { items: T[]; truncated: boolean } {
  return {
    items: source.slice(0, limit).flatMap((row) => {
      const item = transform(row);
      return item === null ? [] : [item];
    }),
    truncated: source.length > limit,
  };
}

function roleForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const displayName = text(row.display_name, 40);
  const source = text(row.source, 30);
  const status = text(row.status, 30);
  if (!id || !displayName || !source || !status) return null;
  return {
    id,
    displayName,
    source,
    status,
    currentPersonaVersionId: uuid(row.current_persona_version_id),
    createdAt: dateTime(row.created_at),
    lastInteractedAt: dateTime(row.last_interacted_at),
  };
}

function personaVersionForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const roleId = uuid(row.role_id);
  const snapshot = personaSnapshotSchema.safeParse(row.persona_snapshot);
  const versionNo = number(row.version_no);
  if (!id || !roleId || !snapshot.success || !Number.isInteger(versionNo)) return null;
  return {
    id,
    roleId,
    versionNo,
    schemaVersion: Number.isInteger(number(row.schema_version))
      ? number(row.schema_version)
      : null,
    persona: snapshot.data as unknown as JsonValue,
    changeSummary: nullableText(row.change_summary, 4_000),
    createdAt: dateTime(row.created_at),
  };
}

function conversationForExport(
  row: RawRow,
  messages: readonly JsonValue[],
): JsonValue | null {
  const id = uuid(row.id);
  const roleId = uuid(row.role_id);
  if (!id || !roleId) return null;
  return {
    id,
    roleId,
    createdAt: dateTime(row.created_at),
    lastMessageAt: dateTime(row.last_message_at),
    messages: [...messages],
  };
}

function messageForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const conversationId = uuid(row.conversation_id);
  const roleId = uuid(row.role_id);
  const sender = text(row.sender, 20);
  const content = text(row.content, 50_000);
  const status = text(row.status, 30);
  if (!id || !conversationId || !roleId || !sender || !content || !status) return null;
  return {
    id,
    conversationId,
    roleId,
    sender,
    content,
    status,
    personaVersionId: uuid(row.persona_version_id),
    replyToMessageId: uuid(row.reply_to_message_id),
    createdAt: dateTime(row.created_at),
  };
}

function memoryForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const scope = text(row.scope, 30);
  const category = text(row.category, 100);
  const content = text(row.content, 5_000);
  const sensitivity = text(row.sensitivity, 30);
  const status = text(row.status, 30);
  if (!id || !scope || !category || !content || !sensitivity || !status) return null;
  return {
    id,
    scope,
    roleId: uuid(row.role_id),
    category,
    content,
    sensitivity,
    status,
    sourceMessageId: uuid(row.source_message_id),
    confirmedByUser: boolean(row.confirmed_by_user),
    validFrom: dateTime(row.valid_from),
    validTo: dateTime(row.valid_to),
    supersedesMemoryId: uuid(row.supersedes_memory_id),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

function planForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const scope = text(row.scope, 20);
  const title = text(row.title, 200);
  const status = text(row.status, 30);
  const periodStart = date(row.period_start);
  const periodEnd = date(row.period_end);
  if (!id || !scope || !title || !status || !periodStart || !periodEnd) return null;
  return {
    id,
    scope,
    parentPlanId: uuid(row.parent_plan_id),
    title,
    notes: nullableText(row.notes, 5_000),
    status,
    periodStart,
    periodEnd,
    dueDate: date(row.due_date),
    scheduledAt: dateTime(row.scheduled_at),
    reminderAt: dateTime(row.reminder_at),
    timezone: text(row.timezone, 64),
    source: text(row.source, 30),
    sourceRoleId: uuid(row.source_role_id),
    completedAt: dateTime(row.completed_at),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

function planStatusEventForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const planId = uuid(row.plan_id);
  const nextStatus = text(row.to_status, 30);
  const source = text(row.source, 30);
  if (!id || !planId || !nextStatus || !source) return null;
  return {
    id,
    planId,
    fromStatus: nullableText(row.from_status, 30),
    toStatus: nextStatus,
    source,
    metadata: json(row.metadata),
    createdAt: dateTime(row.created_at),
  };
}

function planProposalForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const sourceMessageId = uuid(row.source_message_id);
  const intent = text(row.intent, 30);
  const scope = text(row.scope, 20);
  const status = text(row.status, 30);
  const payload = json(row.parsed_payload);
  if (!id || !sourceMessageId || !intent || !scope || !status || payload === null)
    return null;
  return {
    id,
    sourceRoleId: uuid(row.source_role_id),
    sourceMessageId,
    intent,
    scope,
    parsedPayload: payload,
    missingFields: json(row.missing_fields),
    status,
    confirmedPlanId: uuid(row.confirmed_plan_id),
    expiresAt: dateTime(row.expires_at),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

function notificationForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const planId = uuid(row.plan_id);
  const kind = text(row.kind, 50);
  const deliveredAt = dateTime(row.delivered_at);
  if (!id || !planId || !kind || !deliveredAt) return null;
  return { id, planId, kind, deliveredAt, readAt: dateTime(row.read_at) };
}

function feedbackForExport(row: RawRow): JsonValue | null {
  const id = uuid(row.id);
  const messageId = uuid(row.message_id);
  const roleId = uuid(row.role_id);
  const personaVersionId = uuid(row.persona_version_id);
  const categories = json(row.categories);
  if (!id || !messageId || !roleId || !personaVersionId || !Array.isArray(categories))
    return null;
  return {
    id,
    messageId,
    roleId,
    personaVersionId,
    categories,
    additionalText: nullableText(row.additional_text, 2_000),
    entryPoint: text(row.entry_point, 30),
    status: text(row.status, 30),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

/**
 * Produces a deliberately narrow, downloadable representation of one account.
 * It excludes credentials, access/refresh tokens, AI prompts/artifacts, vector
 * embeddings, queue leases and claim tokens, and all service-only diagnostics.
 */
export function buildAccountDataExport(
  user: AccountExportUser,
  source: AccountDataExportSource,
  exportedAt = new Date(),
): AccountDataExport {
  const truncatedCollections: string[] = [];
  const roles = limited(source.roles, ACCOUNT_EXPORT_LIMITS.roles, roleForExport);
  const personas = limited(
    source.personaVersions,
    ACCOUNT_EXPORT_LIMITS.personaVersions,
    personaVersionForExport,
  );
  const messages = limited(
    source.messages,
    ACCOUNT_EXPORT_LIMITS.messages,
    messageForExport,
  );
  const memories = limited(
    source.memories,
    ACCOUNT_EXPORT_LIMITS.memories,
    memoryForExport,
  );
  const plans = limited(source.plans, ACCOUNT_EXPORT_LIMITS.plans, planForExport);
  const events = limited(
    source.planStatusEvents,
    ACCOUNT_EXPORT_LIMITS.planStatusEvents,
    planStatusEventForExport,
  );
  const proposals = limited(
    source.planProposals,
    ACCOUNT_EXPORT_LIMITS.planProposals,
    planProposalForExport,
  );
  const notifications = limited(
    source.notifications,
    ACCOUNT_EXPORT_LIMITS.notifications,
    notificationForExport,
  );
  const feedback = limited(
    source.personaFeedback,
    ACCOUNT_EXPORT_LIMITS.personaFeedback,
    feedbackForExport,
  );
  const messageByConversation = new Map<string, JsonValue[]>();
  for (const message of messages.items) {
    const conversationId = record(message)?.conversationId;
    if (typeof conversationId !== "string") continue;
    const existing = messageByConversation.get(conversationId) ?? [];
    existing.push(message);
    messageByConversation.set(conversationId, existing);
  }
  const conversations = limited(
    source.conversations,
    ACCOUNT_EXPORT_LIMITS.conversations,
    (row) =>
      conversationForExport(row, messageByConversation.get(uuid(row.id) ?? "") ?? []),
  );

  const dataSets: ReadonlyArray<[string, boolean]> = [
    ["roles", roles.truncated],
    ["personaVersions", personas.truncated],
    ["conversations", conversations.truncated],
    ["messages", messages.truncated],
    ["memories", memories.truncated],
    ["plans", plans.truncated],
    ["planStatusEvents", events.truncated],
    ["planProposals", proposals.truncated],
    ["inAppNotifications", notifications.truncated],
    ["personaFeedback", feedback.truncated],
  ];
  for (const [name, isTruncated] of dataSets) {
    if (isTruncated) truncatedCollections.push(name);
  }

  const profile = source.profile;
  const settings = source.settings;
  const personasByRole = new Map<string, JsonValue[]>();
  for (const persona of personas.items) {
    const roleId = record(persona)?.roleId;
    if (typeof roleId !== "string") continue;
    const existing = personasByRole.get(roleId) ?? [];
    existing.push(persona);
    personasByRole.set(roleId, existing);
  }

  return {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    account: {
      email: text(user.email, 320),
      createdAt: dateTime(user.created_at),
      displayName: nullableText(profile?.display_name, 40),
      avatarSeed: nullableText(profile?.avatar_seed, 500),
      onboardingCompletedAt: dateTime(profile?.onboarding_completed_at),
    },
    settings: settings
      ? {
          timezone: nullableText(settings.timezone, 64),
          locale: nullableText(settings.locale, 16),
          theme: nullableText(settings.theme, 30),
          fontScale: number(settings.font_scale),
          preferredUserName: nullableText(settings.preferred_user_name, 100),
          defaultDayTime: nullableText(settings.default_day_time, 20),
          defaultReminderMinutes: number(settings.default_reminder_minutes),
          quietHoursStart: nullableText(settings.quiet_hours_start, 20),
          quietHoursEnd: nullableText(settings.quiet_hours_end, 20),
          browserNotificationsEnabled: boolean(settings.browser_notifications_enabled),
        }
      : null,
    roles: roles.items.map((role) => {
      const roleRecord = record(role);
      const roleId = roleRecord?.id;
      return {
        ...roleRecord,
        personaVersions:
          typeof roleId === "string" ? (personasByRole.get(roleId) ?? []) : [],
      } as JsonValue;
    }),
    conversations: conversations.items,
    memories: memories.items,
    plans: plans.items,
    planStatusEvents: events.items,
    planProposals: proposals.items,
    inAppNotifications: notifications.items,
    personaFeedback: feedback.items,
    truncatedCollections,
  };
}

function resultRows(result: { data: unknown; error: unknown }): RawRow[] {
  if (result.error) throw new AccountDataExportError();
  return rows(result.data);
}

function resultRecord(result: { data: unknown; error: unknown }): RawRow | null {
  if (result.error) throw new AccountDataExportError();
  return record(result.data);
}

/** Reads only the authenticated user's RLS-visible export fields. */
export async function getAccountDataExport(
  user: AccountExportUser,
): Promise<AccountDataExport> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new AccountDataExportError();

  const [
    profileResult,
    settingsResult,
    rolesResult,
    personasResult,
    conversationsResult,
    messagesResult,
    memoriesResult,
    plansResult,
    eventsResult,
    proposalsResult,
    notificationsResult,
    feedbackResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, avatar_seed, onboarding_completed_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("user_settings")
      .select(
        "timezone, locale, theme, font_scale, preferred_user_name, default_day_time, default_reminder_minutes, quiet_hours_start, quiet_hours_end, browser_notifications_enabled",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("roles")
      .select(
        "id, display_name, source, status, current_persona_version_id, created_at, last_interacted_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.roles + 1),
    supabase
      .from("persona_versions")
      .select(
        "id, role_id, version_no, schema_version, persona_snapshot, change_summary, created_at",
      )
      .eq("user_id", user.id)
      .order("role_id", { ascending: true })
      .order("version_no", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.personaVersions + 1),
    supabase
      .from("conversations")
      .select("id, role_id, created_at, last_message_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.conversations + 1),
    supabase
      .from("messages")
      .select(
        "id, conversation_id, role_id, sender, content, status, persona_version_id, reply_to_message_id, created_at",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.messages + 1),
    supabase
      .from("memories")
      .select(
        "id, scope, role_id, category, content, sensitivity, status, source_message_id, confirmed_by_user, valid_from, valid_to, supersedes_memory_id, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.memories + 1),
    supabase
      .from("plans")
      .select(
        "id, scope, parent_plan_id, title, notes, status, period_start, period_end, due_date, scheduled_at, reminder_at, timezone, source, source_role_id, completed_at, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.plans + 1),
    supabase
      .from("plan_status_events")
      .select("id, plan_id, from_status, to_status, source, metadata, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.planStatusEvents + 1),
    supabase
      .from("plan_proposals")
      .select(
        "id, source_role_id, source_message_id, intent, scope, parsed_payload, missing_fields, status, confirmed_plan_id, expires_at, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.planProposals + 1),
    supabase
      .from("in_app_notifications")
      .select("id, plan_id, kind, delivered_at, read_at")
      .eq("user_id", user.id)
      .order("delivered_at", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.notifications + 1),
    supabase
      .from("persona_feedback")
      .select(
        "id, message_id, role_id, persona_version_id, categories, additional_text, entry_point, status, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(ACCOUNT_EXPORT_LIMITS.personaFeedback + 1),
  ]);

  return buildAccountDataExport(user, {
    profile: resultRecord(profileResult),
    settings: resultRecord(settingsResult),
    roles: resultRows(rolesResult),
    personaVersions: resultRows(personasResult),
    conversations: resultRows(conversationsResult),
    messages: resultRows(messagesResult),
    memories: resultRows(memoriesResult),
    plans: resultRows(plansResult),
    planStatusEvents: resultRows(eventsResult),
    planProposals: resultRows(proposalsResult),
    notifications: resultRows(notificationsResult),
    personaFeedback: resultRows(feedbackResult),
  });
}
