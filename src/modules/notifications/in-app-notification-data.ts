import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createDemoPlanWorkspace } from "@/modules/plan/plan-presentation";
import { uuidSchema } from "@/server/schemas";

export interface InAppNotificationItem {
  id: string;
  planId: string;
  planTitle: string;
  deliveredAt: string;
  readAt: string | null;
}

export interface InAppNotificationData {
  source: "database" | "demo" | "unavailable";
  items: InAppNotificationItem[];
  unreadCount: number;
}

interface RawNotification {
  [key: string]: unknown;
  id?: unknown;
  user_id?: unknown;
  plan_id?: unknown;
  kind?: unknown;
  delivered_at?: unknown;
  read_at?: unknown;
}

interface RawPlan {
  [key: string]: unknown;
  id?: unknown;
  user_id?: unknown;
  title?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uuid(value: unknown): string | null {
  const candidate = text(value);
  return uuidSchema.safeParse(candidate).success ? candidate : null;
}

function isoDateTime(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const date = new Date(candidate);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

export function buildInAppNotificationItems(
  notificationRows: readonly RawNotification[],
  planRows: readonly RawPlan[],
  userId: string,
): InAppNotificationItem[] {
  if (!uuidSchema.safeParse(userId).success) return [];

  const planTitles = new Map(
    planRows.flatMap((plan) => {
      const id = uuid(plan.id);
      const ownerId = uuid(plan.user_id);
      const title = text(plan.title);
      return id && ownerId === userId && title ? [[id, title] as const] : [];
    }),
  );

  return notificationRows.flatMap((notification) => {
    const id = uuid(notification.id);
    const ownerId = uuid(notification.user_id);
    const planId = uuid(notification.plan_id);
    const deliveredAt = isoDateTime(notification.delivered_at);
    const readAt =
      notification.read_at === null ? null : isoDateTime(notification.read_at);
    const planTitle = planId ? planTitles.get(planId) : null;

    if (
      !id ||
      ownerId !== userId ||
      !planId ||
      notification.kind !== "plan_reminder" ||
      !deliveredAt ||
      (notification.read_at !== null && !readAt) ||
      (readAt && Date.parse(readAt) < Date.parse(deliveredAt)) ||
      !planTitle
    ) {
      return [];
    }

    return [{ id, planId, planTitle, deliveredAt, readAt }];
  });
}

/** Reads at most 50 owned reminders and exposes only the inbox DTO. */
export async function getInAppNotificationData(
  user: User | null,
): Promise<InAppNotificationData> {
  if (!user || !uuidSchema.safeParse(user.id).success) {
    const today = createDemoPlanWorkspace().anchorDate;
    return {
      source: "demo",
      unreadCount: 1,
      items: [
        {
          id: "demo-reminder-portfolio",
          planId: "demo-day-portfolio-structure",
          planTitle: "整理作品集信息架构",
          deliveredAt: `${today}T06:00:00.000Z`,
          readAt: null,
        },
        {
          id: "demo-reminder-email",
          planId: "demo-day-project-email",
          planTitle: "回复项目邮件",
          deliveredAt: `${today}T01:30:00.000Z`,
          readAt: `${today}T01:46:00.000Z`,
        },
      ],
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { source: "unavailable", items: [], unreadCount: 0 };
  }

  const { data: notificationRows, error: notificationError } = await supabase
    .from("in_app_notifications")
    .select("id, user_id, plan_id, kind, delivered_at, read_at")
    .eq("user_id", user.id)
    .order("delivered_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (notificationError) {
    return { source: "unavailable", items: [], unreadCount: 0 };
  }

  const planIds = [
    ...new Set(
      ((notificationRows ?? []) as RawNotification[])
        .map((row) => uuid(row.plan_id))
        .filter((id): id is string => id !== null),
    ),
  ];
  if (!planIds.length) {
    return { source: "database", items: [], unreadCount: 0 };
  }

  const { data: planRows, error: planError } = await supabase
    .from("plans")
    .select("id, user_id, title")
    .eq("user_id", user.id)
    .in("id", planIds);
  if (planError) {
    return { source: "unavailable", items: [], unreadCount: 0 };
  }

  const items = buildInAppNotificationItems(
    (notificationRows ?? []) as RawNotification[],
    (planRows ?? []) as RawPlan[],
    user.id,
  );
  return {
    source: "database",
    items,
    unreadCount: items.filter((item) => item.readAt === null).length,
  };
}
