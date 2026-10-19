import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface LocalSupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

interface MailpitSummary {
  ID?: unknown;
  To?: Array<{ Address?: unknown }>;
}

interface MailpitList {
  messages?: MailpitSummary[];
}

interface MailpitMessage {
  Text?: unknown;
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
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("本地管理员 E2E 拒绝连接非本机 Supabase");
  }
}

function localSupabaseConfig(): LocalSupabaseConfig {
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
  const serviceRoleKey = envValue(output, "SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("本地管理员 E2E 缺少正在运行的 Supabase 配置");
  }
  requireLoopbackUrl(url);
  return { url, serviceRoleKey };
}

async function magicLinkFor(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let mailId = "";

  await expect
    .poll(
      async () => {
        const response = await request.get("http://127.0.0.1:54324/api/v1/messages");
        if (!response.ok()) return false;
        const mailbox = (await response.json()) as MailpitList;
        const message = mailbox.messages?.find((item) =>
          item.To?.some((recipient) => recipient.Address === email),
        );
        mailId = typeof message?.ID === "string" ? message.ID : "";
        return Boolean(mailId);
      },
      { message: "等待本地 Mailpit 收到管理员 Magic Link", timeout: 15_000 },
    )
    .toBe(true);

  const response = await request.get(
    `http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(mailId)}`,
  );
  expect(response.ok()).toBe(true);
  const message = (await response.json()) as MailpitMessage;
  const text = typeof message.Text === "string" ? message.Text : "";
  const link = text.match(/https?:\/\/[^\s)]+\/auth\/v1\/verify\?[^\s)]+/)?.[0];
  if (!link) throw new Error("本地管理员 Magic Link 邮件中没有登录地址");
  return link;
}

test.afterEach(async () => {
  if (cleanupClient && cleanupUserId) {
    const deleted = await cleanupClient.auth.admin.deleteUser(cleanupUserId);
    expect(deleted.error).toBeNull();
  }
  cleanupClient = null;
  cleanupUserId = null;
});

test("synthetic administrator reviews only a redacted local Badcase", async ({
  page,
  request,
}) => {
  const config = localSupabaseConfig();
  const serviceClient = createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  cleanupClient = serviceClient;

  const suffix = crypto.randomUUID().replaceAll("-", "");
  const email = `badcase-admin-${suffix}@example.invalid`;
  const capability = `本地后台复核 ${suffix.slice(0, 6)}`;
  const created = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  expect(created.error).toBeNull();
  const userId = created.data.user?.id;
  expect(userId).toMatch(/^[0-9a-f-]{36}$/);
  cleanupUserId = userId ?? null;

  const grant = await serviceClient.from("admin_users").insert({
    user_id: userId!,
    access_level: "admin",
  });
  expect(grant.error).toBeNull();

  const createdBadcase = await serviceClient
    .from("badcases")
    .insert({
      user_id: userId!,
      source_type: "manual",
      capability,
      severity: "critical",
      diagnosis: "仅用于本地回归的合成诊断摘要。",
      redacted_excerpt: "合成片段：不包含用户身份、聊天正文或模型原始输出。",
      status: "open",
    })
    .select("id,status,review_revision")
    .single();
  expect(createdBadcase.error).toBeNull();
  expect(createdBadcase.data).toMatchObject({ status: "open", review_revision: 0 });
  const badcaseId = createdBadcase.data?.id;
  expect(badcaseId).toMatch(/^[0-9a-f-]{36}$/);

  await page.goto("/login?next=/admin/badcases");
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("status")).toContainText(
    "如果邮箱地址有效，登录链接会很快送达",
  );

  const magicLink = await magicLinkFor(request, email);
  const verification = await page.request.get(magicLink, { maxRedirects: 0 });
  expect(verification.status()).toBeGreaterThanOrEqual(300);
  expect(verification.status()).toBeLessThan(400);
  const callbackLocation = verification.headers().location;
  expect(callbackLocation).toBeTruthy();
  await page.goto(new URL(callbackLocation!).toString());
  await expect(page).toHaveURL(/\/admin\/badcases$/);

  await expect(page.getByRole("heading", { name: "Badcase 复核" })).toBeVisible();
  await expect(page.getByText(capability, { exact: true })).toBeVisible();
  const listText = await page.locator("body").innerText();
  expect(listText).not.toContain(email);
  expect(listText).not.toContain(userId!);

  await page
    .getByRole("navigation", { name: "Badcase 筛选" })
    .getByRole("link", { name: "严重" })
    .click();
  await expect(page).toHaveURL(/\/admin\/badcases\?severity=critical$/);
  await page.getByRole("link", { name: "查看复核详情" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/badcases/${badcaseId}$`));
  await expect(page.getByRole("heading", { name: capability })).toBeVisible();
  await expect(page.getByText("仅用于本地回归的合成诊断摘要。")).toBeVisible();

  const status = page.getByRole("combobox", { name: "状态" });
  await status.selectOption("resolved");
  await page.getByRole("button", { name: "保存复核状态" }).click();
  await expect(page.getByRole("status")).toHaveText("状态已更新。");

  const reviewed = await serviceClient
    .from("badcases")
    .select("status,resolved_at,review_revision")
    .eq("id", badcaseId!)
    .single();
  expect(reviewed.error).toBeNull();
  expect(reviewed.data).toMatchObject({ status: "resolved", review_revision: 1 });
  expect(reviewed.data?.resolved_at).toEqual(expect.any(String));
  await expect(status).toHaveValue("resolved");
});
