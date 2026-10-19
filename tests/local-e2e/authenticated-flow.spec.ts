import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

type MailpitSummary = {
  ID?: unknown;
  To?: Array<{ Address?: unknown }>;
};

type MailpitList = {
  messages?: MailpitSummary[];
};

type MailpitMessage = {
  Text?: unknown;
};

type LocalPlanProposalInput = {
  scope: "day" | "week" | "month" | "year";
  title: string;
  originalTimeText: string | null;
  parsedPayload: Record<string, string>;
};

type PersonaFeedbackBadcase = {
  source_type?: unknown;
  persona_feedback_id?: unknown;
  capability?: unknown;
  severity?: unknown;
  diagnosis?: unknown;
  redacted_excerpt?: unknown;
  status?: unknown;
};

let cleanupUserEmail: string | null = null;

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
      { message: "等待本地 Mailpit 收到 Magic Link", timeout: 15_000 },
    )
    .toBe(true);

  const response = await request.get(
    `http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(mailId)}`,
  );
  expect(response.ok()).toBe(true);
  const message = (await response.json()) as MailpitMessage;
  const text = typeof message.Text === "string" ? message.Text : "";
  const link = text.match(/https?:\/\/[^\s)]+\/auth\/v1\/verify\?[^\s)]+/)?.[0];
  if (!link) throw new Error("本地 Magic Link 邮件中没有登录地址");
  return link;
}

async function switchRole(page: Page, name: string) {
  const roleForm = page.locator(".role-choice-form").filter({ hasText: name });
  await roleForm.getByRole("button").click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
}

function localServiceRoleKey(): string | null {
  const configured = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (configured) return configured;

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
    const match = output.match(/^SERVICE_ROLE_KEY=['"]?([^'"\r\n]+)['"]?$/m);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function deleteLocalTestUser(email: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = localServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("本地认证 E2E 缺少 Supabase service-role 配置，无法清理测试账号");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (let page = 1; page <= 20; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 100 });
    expect(listed.error).toBeNull();
    const user = listed.data.users.find((candidate) => candidate.email === email);
    if (user) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      expect(deleted.error).toBeNull();
      return;
    }
    if (listed.data.users.length < 100) return;
  }
  throw new Error("本地认证 E2E 无法在受控分页范围内定位测试账号");
}

function requireLoopbackSupabaseUrl(url: string): void {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("本地认证 E2E 拒绝查询非本机 Supabase");
  }
}

async function readSyntheticFeedbackBadcase(
  request: APIRequestContext,
  additionalText: string,
): Promise<PersonaFeedbackBadcase | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = localServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("本地反馈 E2E 缺少 Supabase service-role 配置");
  }
  requireLoopbackSupabaseUrl(supabaseUrl);

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  const feedbackUrl = new URL("/rest/v1/persona_feedback", supabaseUrl);
  feedbackUrl.searchParams.set("select", "id");
  feedbackUrl.searchParams.set("additional_text", `eq.${additionalText}`);
  feedbackUrl.searchParams.set("limit", "1");

  const feedbackResponse = await request.get(feedbackUrl.toString(), { headers });
  if (!feedbackResponse.ok()) {
    throw new Error("本地反馈 E2E 无法读取本次合成反馈");
  }
  const feedbackRows = (await feedbackResponse.json()) as Array<{ id?: unknown }>;
  const feedbackId = feedbackRows[0]?.id;
  if (typeof feedbackId !== "string") return null;

  const badcaseUrl = new URL("/rest/v1/badcases", supabaseUrl);
  badcaseUrl.searchParams.set(
    "select",
    "source_type,persona_feedback_id,capability,severity,diagnosis,redacted_excerpt,status",
  );
  badcaseUrl.searchParams.set("persona_feedback_id", `eq.${feedbackId}`);

  const badcaseResponse = await request.get(badcaseUrl.toString(), { headers });
  if (!badcaseResponse.ok()) {
    throw new Error("本地反馈 E2E 无法读取关联 Badcase");
  }
  const badcaseRows = (await badcaseResponse.json()) as PersonaFeedbackBadcase[];
  return badcaseRows[0] ?? null;
}

test.afterEach(async () => {
  const email = cleanupUserEmail;
  cleanupUserEmail = null;
  if (email) await deleteLocalTestUser(email);
});

async function createLocalMemoryCandidate(
  request: APIRequestContext,
  sourceContent: string,
  candidateContent: string,
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = localServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("本地记忆 E2E 缺少 Supabase service-role 配置");
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const sourceUrl = new URL("/rest/v1/messages", supabaseUrl);
  sourceUrl.searchParams.set("select", "id,user_id,role_id");
  sourceUrl.searchParams.set("sender", "eq.user");
  sourceUrl.searchParams.set("status", "eq.completed");
  sourceUrl.searchParams.set("content", `eq.${sourceContent}`);
  sourceUrl.searchParams.set("deleted_at", "is.null");
  sourceUrl.searchParams.set("order", "created_at.desc");
  sourceUrl.searchParams.set("limit", "1");

  const sourceResponse = await request.get(sourceUrl.toString(), { headers });
  expect(sourceResponse.ok()).toBe(true);
  const sourceRows = (await sourceResponse.json()) as Array<{
    id?: unknown;
    user_id?: unknown;
    role_id?: unknown;
  }>;
  const source = sourceRows[0];
  if (
    typeof source?.id !== "string" ||
    typeof source.user_id !== "string" ||
    typeof source.role_id !== "string"
  ) {
    throw new Error("本地记忆 E2E 找不到刚创建的用户消息");
  }

  const persistenceResponse = await request.post(
    new URL("/rest/v1/rpc/persist_memory_extraction", supabaseUrl).toString(),
    {
      headers,
      data: {
        p_user_id: source.user_id,
        p_role_id: source.role_id,
        p_source_message_id: source.id,
        p_policy_version: "e2e-fixed-v0.1",
        p_idempotency_key: `memory-e2e-${crypto.randomUUID()}`,
        p_operations: [
          {
            candidateIndex: 0,
            action: "create_candidate",
            reason: "explicit_confirmation_requested",
            memory: {
              sourceMessageId: source.id,
              scope: "role_private",
              roleId: source.role_id,
              category: "agreement",
              content: candidateContent,
              normalizedKey: `e2e_agreement_${crypto.randomUUID()}`,
              sensitivity: "normal",
              confidence: 1,
              supersedesMemoryId: null,
            },
          },
        ],
      },
    },
  );
  expect(persistenceResponse.ok()).toBe(true);
}

async function createLocalPlanProposal(
  request: APIRequestContext,
  sourceContent: string,
  input: LocalPlanProposalInput,
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = localServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("本地计划提案 E2E 缺少 Supabase service-role 配置");
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const sourceUrl = new URL("/rest/v1/messages", supabaseUrl);
  sourceUrl.searchParams.set("select", "id,user_id,role_id");
  sourceUrl.searchParams.set("sender", "eq.user");
  sourceUrl.searchParams.set("status", "eq.completed");
  sourceUrl.searchParams.set("content", `eq.${sourceContent}`);
  sourceUrl.searchParams.set("deleted_at", "is.null");
  sourceUrl.searchParams.set("order", "created_at.desc");
  sourceUrl.searchParams.set("limit", "1");

  const sourceResponse = await request.get(sourceUrl.toString(), { headers });
  expect(sourceResponse.ok()).toBe(true);
  const sourceRows = (await sourceResponse.json()) as Array<{
    id?: unknown;
    user_id?: unknown;
    role_id?: unknown;
  }>;
  const source = sourceRows[0];
  if (
    typeof source?.id !== "string" ||
    typeof source.user_id !== "string" ||
    typeof source.role_id !== "string"
  ) {
    throw new Error("本地计划提案 E2E 找不到刚创建的用户消息");
  }

  const proposalResponse = await request.post(
    new URL("/rest/v1/plan_proposals?select=id", supabaseUrl).toString(),
    {
      headers: { ...headers, Prefer: "return=representation" },
      data: {
        user_id: source.user_id,
        source_role_id: source.role_id,
        source_message_id: source.id,
        intent: "create",
        scope: input.scope,
        suggested_title: input.title,
        original_time_text: input.originalTimeText,
        parsed_payload: input.parsedPayload,
        missing_fields: [],
        confidence: 1,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        idempotency_key: `plan-e2e-${crypto.randomUUID()}`,
      },
    },
  );
  expect(proposalResponse.ok()).toBe(true);
  const proposals = (await proposalResponse.json()) as Array<{ id?: unknown }>;
  if (typeof proposals[0]?.id !== "string") {
    throw new Error("本地计划提案 E2E 未返回提案 ID");
  }
  return proposals[0].id;
}

test("real Magic Link, custom role, isolated timeline, and persona v2", async ({
  page,
  request,
}) => {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const email = `playwright-${suffix}@example.invalid`;
  cleanupUserEmail = email;
  const roleName = `知夏${suffix.slice(0, 6)}`;
  const updatedRoleName = `${roleName}二版`;
  const privateMessage = `只属于${roleName}的消息 ${suffix.slice(-6)}`;
  const feedbackNote = `本地反馈 Badcase 验证 ${suffix}`;
  const memoryCandidate = `用户希望${updatedRoleName}先听完再建议 ${suffix.slice(-6)}`;
  const editedMemory = `${memoryCandidate}（用户已确认）`;
  const proposalTitle = `整理作品集首页 ${suffix.slice(-6)}`;
  const editedProposalTitle = `完成作品集首屏 ${suffix.slice(-6)}`;
  const rejectedProposalTitle = `本周整理三个案例 ${suffix.slice(-6)}`;

  await page.goto("/login?next=/chat");
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送登录链接" }).click();

  await expect(page.getByRole("status")).toContainText(
    "如果邮箱地址有效，登录链接会很快送达",
  );
  await expect(page.getByRole("button", { name: /秒后可重新发送/ })).toBeDisabled();

  const magicLink = await magicLinkFor(request, email);
  const verification = await page.request.get(magicLink, { maxRedirects: 0 });
  expect(verification.status()).toBeGreaterThanOrEqual(300);
  expect(verification.status()).toBeLessThan(400);
  const callbackLocation = verification.headers().location;
  expect(callbackLocation).toBeTruthy();
  const callback = new URL(callbackLocation);
  expect(callback.pathname).toBe("/auth/callback");
  expect(callback.searchParams.has("code")).toBe(true);
  await page.goto(callback.toString());
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText("本地 Mock 对话：消息会保存")).toBeVisible();

  await page.getByRole("link", { name: "切换或修改角色" }).click();
  await expect(page).toHaveURL(/\/roles$/);
  await expect(page.locator(".role-choice-card")).toHaveCount(3);
  await page.getByRole("link", { name: "创建自己的角色" }).click();
  await expect(page).toHaveURL(/\/roles\/new$/);

  await page.getByLabel("角色名称").fill(roleName);
  await page.getByLabel("身份定位").fill("温柔的创作伙伴");
  await page.getByLabel("身份与背景").fill("理解创作压力，也尊重用户自己做决定。");
  await page.getByLabel("与用户的关系").fill("可信任但有清晰边界的长期伙伴。");
  await page.getByLabel("核心性格").fill("温柔\n稳定\n诚实");
  await page.getByLabel("说话风格").fill("自然\n简洁\n先倾听后建议");
  await page.getByLabel("价值观（选填）").fill("诚实\n尊重自主");
  await page.getByRole("button", { name: "检查并继续" }).click();
  await expect(page.getByRole("heading", { name: "确认创建" })).toBeVisible();
  await page.getByRole("button", { name: "确认创建" }).click();

  await expect(page).toHaveURL(/\/roles$/);
  await expect(page.getByText(roleName, { exact: true }).first()).toBeVisible();
  await switchRole(page, roleName);

  await page.getByLabel("输入消息").fill(privateMessage);
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(privateMessage, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "长按反馈这条消息不符合人设" })
    .last()
    .click({ button: "right" });
  await expect(
    page.getByRole("heading", { name: "这句话哪里不符合人设？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "事实错误" }).click();
  await page.getByLabel("补充说明").fill(feedbackNote);
  await page.getByRole("button", { name: "提交反馈" }).click();
  await expect(page.getByRole("status")).toContainText(
    "反馈已提交，谢谢你帮助我们改进后续回应。",
  );

  await expect
    .poll(() => readSyntheticFeedbackBadcase(request, feedbackNote), {
      message: "等待本次合成反馈关联最小化 Badcase",
      timeout: 10_000,
    })
    .toMatchObject({
      source_type: "persona_feedback",
      capability: "persona_feedback",
      severity: "medium",
      diagnosis: "等待人工复核的人设反馈。",
      redacted_excerpt: null,
      status: "open",
    });
  await page.getByRole("button", { name: "关闭反馈" }).click();

  await page.getByRole("link", { name: "切换或修改角色" }).click();
  await switchRole(page, "林知夏");
  await expect(page.getByText(privateMessage, { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "切换或修改角色" }).click();
  await switchRole(page, roleName);
  await expect(page.getByText(privateMessage, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "切换或修改角色" }).click();
  await page.getByRole("link", { name: "管理角色" }).click();
  await expect(page).toHaveURL(/\/roles\/[0-9a-f-]+\/edit$/);
  await expect(page.getByText("人设版本 v1")).toBeVisible();
  await page.getByLabel("角色名称").fill(updatedRoleName);
  await page.getByRole("button", { name: "检查并继续" }).click();
  await expect(page.getByText("涉及：角色名称")).toBeVisible();
  await page.getByRole("button", { name: "确认并保存新版本" }).click();
  await expect(page.getByRole("status")).toContainText("新的人设版本已保存");

  await page.reload();
  await expect(page.getByText("人设版本 v2")).toBeVisible();
  await expect(page.getByLabel("角色名称")).toHaveValue(updatedRoleName);
  await page.getByRole("link", { name: "返回角色管理" }).click();
  await expect(page.getByText(updatedRoleName, { exact: true }).first()).toBeVisible();

  await createLocalMemoryCandidate(request, privateMessage, memoryCandidate);
  await page.goto("/chat");
  await expect(
    page.getByRole("heading", { name: new RegExp(updatedRoleName) }),
  ).toBeVisible();
  await expect(page.getByText("想记住这件事")).toBeVisible();
  await expect(page.getByLabel("记忆内容")).toHaveValue(memoryCandidate);
  await page.getByRole("button", { name: "确认保存" }).click();

  await page.getByRole("link", { name: "我的", exact: true }).first().click();
  await expect(page).toHaveURL(/\/me$/);
  await page.getByRole("link", { name: /记忆管理/ }).click();
  await expect(page).toHaveURL(/\/me\/memories$/);
  await expect(page.getByLabel("记忆内容")).toHaveValue(memoryCandidate);

  await page.getByLabel("记忆内容").fill(editedMemory);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByLabel("记忆内容")).toHaveValue(editedMemory);

  await page.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText(/立即停止参与后续回复/)).toBeVisible();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByLabel("记忆内容")).toHaveCount(0);

  await createLocalPlanProposal(request, privateMessage, {
    scope: "day",
    title: proposalTitle,
    originalTimeText: "今天晚上七点半",
    parsedPayload: {
      date: "2026-09-07",
      scheduledAt: "2026-09-07T19:30:00+08:00",
      reminderAt: "2026-09-07T19:00:00+08:00",
    },
  });
  await page.goto("/chat");
  await expect(page.getByLabel("计划名称")).toHaveValue(proposalTitle);
  await expect(page.getByText(/今天晚上七点半/)).toBeVisible();
  await page.getByLabel("计划名称").fill(editedProposalTitle);
  await page.getByRole("button", { name: "确认并加入计划" }).click();
  await expect(page.getByText("计划已创建")).toBeVisible();
  await page.getByRole("link", { name: "查看计划 →" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: editedProposalTitle })).toBeVisible();

  await createLocalPlanProposal(request, privateMessage, {
    scope: "week",
    title: rejectedProposalTitle,
    originalTimeText: "这周内",
    parsedPayload: { weekStart: "2026-09-07", dueDate: "2026-09-12" },
  });
  await page.goto("/chat");
  await expect(page.getByLabel("计划名称")).toHaveValue(rejectedProposalTitle);
  await page.getByRole("button", { name: "暂不创建" }).click();
  await expect(page.getByText("这份计划建议不会生成正式计划。")).toBeVisible();
});

test("account data export is private and confirmed account deletion returns to login", async ({
  page,
  request,
}) => {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const email = `privacy-${suffix}@example.invalid`;
  cleanupUserEmail = email;

  await page.goto("/login?next=/me");
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
  await expect(page).toHaveURL(/\/me$/);

  const exported = await page.request.get("/me/export");
  expect(exported.ok()).toBe(true);
  expect(exported.headers()["cache-control"]).toContain("private");
  expect(exported.headers()["cache-control"]).toContain("no-store");
  expect(exported.headers()["x-content-type-options"]).toBe("nosniff");
  const exportedData = (await exported.json()) as {
    account?: { email?: unknown };
    roles?: unknown[];
  };
  expect(exportedData.account?.email).toBe(email);
  expect(exportedData.roles).toHaveLength(3);
  expect(JSON.stringify(exportedData)).not.toContain("compiled_system_prompt");
  expect(JSON.stringify(exportedData)).not.toContain("claim_token");

  await page.getByRole("button", { name: "删除账号" }).click();
  await expect(
    page.getByRole("dialog", { name: "删除账号和全部个人数据" }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("textbox").fill("删除我的账号");
  await page.getByRole("button", { name: "永久删除账号" }).click();
  await expect(page).toHaveURL(/\/login\?notice=account_deleted$/);
  await expect(page.getByRole("status")).toHaveText("账号和个人数据已删除。");
});
