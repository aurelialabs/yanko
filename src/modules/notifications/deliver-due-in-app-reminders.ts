import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

import { SupabaseInAppPlanReminderDelivery } from "./in-app-plan-reminder-delivery";
import { runConfiguredPlanReminderJob } from "./plan-reminder-worker";

const DUE_REMINDER_LIMIT = 5;

export async function listDuePlanReminderJobIds(
  userId: string,
  now: Date,
): Promise<string[]> {
  if (!uuidSchema.safeParse(userId).success || !Number.isFinite(now.getTime())) {
    return [];
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return [];

  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from("notification_jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .lte("available_at", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(DUE_REMINDER_LIMIT);

  if (error || !Array.isArray(data)) return [];

  return data.flatMap((row) => {
    const id = row?.id;
    return typeof id === "string" && uuidSchema.safeParse(id).success ? [id] : [];
  });
}

async function deliverJob(jobId: string, now: Date): Promise<void> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return;
  await runConfiguredPlanReminderJob({
    jobId,
    now,
    delivery: new SupabaseInAppPlanReminderDelivery(supabase),
  });
}

/**
 * Delivers reminders that are already due into the in-app inbox. Opening the
 * inbox is the local stand-in for a scheduler; it does not send Web Push.
 */
export async function deliverDueInAppPlanReminders(
  input: { userId: string; now?: Date },
  dependencies: {
    listDueJobIds?: (userId: string, now: Date) => Promise<string[]>;
    deliverJob?: (jobId: string, now: Date) => Promise<void>;
  } = {},
): Promise<{ delivered: number }> {
  const now = input.now ?? new Date();
  if (!uuidSchema.safeParse(input.userId).success || !Number.isFinite(now.getTime())) {
    return { delivered: 0 };
  }

  let jobIds: string[];
  try {
    jobIds = await (dependencies.listDueJobIds ?? listDuePlanReminderJobIds)(
      input.userId,
      now,
    );
  } catch {
    return { delivered: 0 };
  }

  const send = dependencies.deliverJob ?? deliverJob;
  const results = await Promise.all(
    jobIds.map(async (jobId) => {
      try {
        await send(jobId, now);
        return true;
      } catch {
        return false;
      }
    }),
  );

  return { delivered: results.filter(Boolean).length };
}
