import { execFileSync } from "node:child_process";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";

import { SupabaseInAppPlanReminderDelivery } from "@/modules/notifications/in-app-plan-reminder-delivery";
import {
  dispatchPlanReminderJob,
  SupabasePlanReminderJobStore,
} from "@/modules/notifications/plan-reminder-worker";

interface LocalSupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

let cleanupClient: SupabaseClient | null = null;
let cleanupUserId: string | null = null;

function envValue(output: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = output.match(
    new RegExp(`^${escapedName}=['\"]?([^'\"\\r\\n]+)['\"]?$`, "m"),
  );
  return match?.[1]?.trim() || null;
}

function requireLoopbackUrl(url: string): void {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("本地提醒集成测试拒绝连接非本机 Supabase");
  }
}

function localSupabaseConfig(): LocalSupabaseConfig {
  try {
    const executable = path.join(
      process.cwd(),
      "node_modules",
      "supabase",
      "dist",
      "supabase.js",
    );
    const output = execFileSync(process.execPath, [executable, "status", "-o", "env"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const url = envValue(output, "API_URL");
    const anonKey = envValue(output, "ANON_KEY");
    const serviceRoleKey = envValue(output, "SERVICE_ROLE_KEY");
    if (url && anonKey && serviceRoleKey) {
      requireLoopbackUrl(url);
      return { url, anonKey, serviceRoleKey };
    }
  } catch {
    // Fall through to explicitly configured loopback values.
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("本地提醒集成测试缺少正在运行的 Supabase 配置");
  }
  requireLoopbackUrl(url);
  return { url, anonKey, serviceRoleKey };
}

afterEach(async () => {
  if (cleanupClient && cleanupUserId) {
    const deleted = await cleanupClient.auth.admin.deleteUser(cleanupUserId);
    expect(deleted.error).toBeNull();
  }
  cleanupClient = null;
  cleanupUserId = null;
});

describe("local in-app plan reminder delivery", () => {
  it("claims one synthetic job and records one user-readable reminder", async () => {
    const config = localSupabaseConfig();
    const serviceClient = createClient(config.url, config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cleanupClient = serviceClient;

    const suffix = crypto.randomUUID().replaceAll("-", "");
    const email = `plan-reminder-${suffix}@example.invalid`;
    const password = `Local-only-${suffix}!`;
    const title = "本地应用内提醒集成测试计划";
    const scheduledAt = new Date(Date.now() + 20 * 60_000);
    const reminderAt = new Date(Date.now() + 10 * 60_000);
    const periodDate = new Date().toISOString().slice(0, 10);

    const created = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const userId = created.data.user?.id;
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    cleanupUserId = userId ?? null;

    const userClient = createClient(config.url, config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await userClient.auth.signInWithPassword({ email, password });
    expect(signedIn.error).toBeNull();

    const createdPlan = await userClient.rpc("create_manual_plan", {
      p_scope: "day",
      p_title: title,
      p_notes: null,
      p_period_start: periodDate,
      p_period_end: periodDate,
      p_due_date: periodDate,
      p_scheduled_at: scheduledAt.toISOString(),
      p_reminder_at: reminderAt.toISOString(),
      p_timezone: "Asia/Shanghai",
      p_parent_plan_id: null,
      p_idempotency_key: `local-plan-reminder-${suffix}`,
    });
    expect(createdPlan.error).toBeNull();
    expect(createdPlan.data).toMatch(/^[0-9a-f-]{36}$/);
    const planId = createdPlan.data!;

    const jobResult = await serviceClient
      .from("notification_jobs")
      .select("id,status,attempt_count,scheduled_for")
      .eq("user_id", userId!)
      .eq("plan_id", planId)
      .single();
    expect(jobResult.error).toBeNull();
    expect(jobResult.data).toMatchObject({
      status: "scheduled",
      attempt_count: 0,
    });
    expect(new Date(jobResult.data!.scheduled_for).toISOString()).toBe(
      reminderAt.toISOString(),
    );
    const jobId = jobResult.data!.id;

    const workerNow = new Date(reminderAt.getTime() + 1_000);
    await expect(
      dispatchPlanReminderJob({
        jobId,
        now: workerNow,
        store: new SupabasePlanReminderJobStore(serviceClient),
        delivery: new SupabaseInAppPlanReminderDelivery(serviceClient),
      }),
    ).resolves.toEqual({ type: "delivered", finalStatus: "succeeded" });

    const completedJob = await serviceClient
      .from("notification_jobs")
      .select("status,attempt_count,claim_token,lease_expires_at,last_error_code")
      .eq("id", jobId)
      .single();
    expect(completedJob.error).toBeNull();
    expect(completedJob.data).toEqual({
      status: "succeeded",
      attempt_count: 1,
      claim_token: null,
      lease_expires_at: null,
      last_error_code: null,
    });

    const serviceInbox = await serviceClient
      .from("in_app_notifications")
      .select("id,user_id,notification_job_id,plan_id,kind,delivered_at,read_at")
      .eq("notification_job_id", jobId)
      .single();
    expect(serviceInbox.error).toBeNull();
    expect(serviceInbox.data).toMatchObject({
      user_id: userId,
      notification_job_id: jobId,
      plan_id: planId,
      kind: "plan_reminder",
      read_at: null,
    });
    expect(new Date(serviceInbox.data!.delivered_at).toISOString()).toBe(
      workerNow.toISOString(),
    );

    const userInbox = await userClient
      .from("in_app_notifications")
      .select("id,plan_id,delivered_at,read_at")
      .eq("user_id", userId!)
      .eq("id", serviceInbox.data!.id)
      .single();
    expect(userInbox.error).toBeNull();
    expect(userInbox.data).toMatchObject({
      id: serviceInbox.data!.id,
      plan_id: planId,
      read_at: null,
    });
    expect(new Date(userInbox.data!.delivered_at).toISOString()).toBe(
      workerNow.toISOString(),
    );

    const markedRead = await userClient.rpc("mark_in_app_notification_read", {
      p_notification_id: serviceInbox.data!.id,
      p_read: true,
      p_now: new Date(workerNow.getTime() + 1_000).toISOString(),
    });
    expect(markedRead.error).toBeNull();
    expect(markedRead.data).toBe(serviceInbox.data!.id);

    const planAfterDelivery = await userClient
      .from("plans")
      .select("id,title,status,scheduled_at,reminder_at")
      .eq("id", planId)
      .single();
    expect(planAfterDelivery.error).toBeNull();
    expect(planAfterDelivery.data).toMatchObject({
      id: planId,
      title,
      status: "active",
    });
    expect(new Date(planAfterDelivery.data!.scheduled_at).toISOString()).toBe(
      scheduledAt.toISOString(),
    );
    expect(new Date(planAfterDelivery.data!.reminder_at).toISOString()).toBe(
      reminderAt.toISOString(),
    );
  });
});
