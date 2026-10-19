import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

type StoredMessage = {
  id: string;
  conversation_id: string;
  role_id: string;
  content: string;
  status: string;
  persona_version_id: string | null;
};

type StoredAiRun = {
  id: string;
  provider: string;
  model: string;
  strategy_version_id: string;
  status: string;
  rewritten: boolean;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_code: string | null;
  attempt_no: number;
};

type StoredOocCheck = {
  attempt_no: number;
  verdict: string;
  provider: string;
  model: string;
};

type TurnRecord = {
  userMessage: StoredMessage;
  assistantMessage: StoredMessage | null;
  run: StoredAiRun | null;
  oocChecks: StoredOocCheck[];
  artifactCount: number;
  currentPersonaVersionId: string | null;
};

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
    "http://127.0.0.1:54324/api/v1/message/" + encodeURIComponent(mailId),
  );
  expect(response.ok()).toBe(true);
  const message = (await response.json()) as MailpitMessage;
  const text = typeof message.Text === "string" ? message.Text : "";
  const link = text.match(/https?:\/\/[^\s)]+\/auth\/v1\/verify\?[^\s)]+/)?.[0];
  if (!link) throw new Error("本地 Magic Link 邮件中没有登录地址");
  return link;
}

function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("Local Supabase smoke credentials are unavailable.");
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function userIdForEmail(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (error) throw new Error("Unable to inspect the synthetic smoke account.");
  const user = data.users.find((candidate) => candidate.email === email);
  if (!user) throw new Error("The synthetic smoke account was not provisioned.");
  return user.id;
}

async function readTurnRecord(
  admin: SupabaseClient,
  userId: string,
  content: string,
): Promise<TurnRecord | null> {
  const { data: userMessage, error: messageError } = await admin
    .from("messages")
    .select("id, conversation_id, role_id, content, status, persona_version_id")
    .eq("user_id", userId)
    .eq("sender", "user")
    .eq("content", content)
    .is("deleted_at", null)
    .maybeSingle();
  if (messageError) throw new Error("Unable to inspect the synthetic user message.");
  if (!userMessage) return null;

  const { data: run, error: runError } = await admin
    .from("ai_runs")
    .select(
      "id, provider, model, strategy_version_id, status, rewritten, latency_ms, input_tokens, output_tokens, error_code, attempt_no",
    )
    .eq("user_id", userId)
    .eq("user_message_id", userMessage.id)
    .maybeSingle();
  if (runError) throw new Error("Unable to inspect the synthetic AI run.");

  const { data: assistantMessage, error: assistantError } = await admin
    .from("messages")
    .select("id, conversation_id, role_id, content, status, persona_version_id")
    .eq("user_id", userId)
    .eq("sender", "assistant")
    .eq("reply_to_message_id", userMessage.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (assistantError) {
    throw new Error("Unable to inspect the synthetic assistant message.");
  }

  let oocChecks: StoredOocCheck[] = [];
  let artifactCount = 0;
  if (run) {
    const { data: checks, error: checkError } = await admin
      .from("ooc_checks")
      .select("attempt_no, verdict, provider, model")
      .eq("ai_run_id", run.id)
      .order("attempt_no", { ascending: true });
    if (checkError) throw new Error("Unable to inspect synthetic OOC checks.");
    oocChecks = checks ?? [];

    const { count, error: artifactError } = await admin
      .from("ai_run_artifacts")
      .select("id", { count: "exact", head: true })
      .eq("ai_run_id", run.id);
    if (artifactError) throw new Error("Unable to inspect synthetic AI artifacts.");
    artifactCount = count ?? 0;
  }

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("current_persona_version_id")
    .eq("user_id", userId)
    .eq("id", userMessage.role_id)
    .single();
  if (roleError) throw new Error("Unable to inspect the synthetic role persona.");

  return {
    userMessage,
    assistantMessage,
    run,
    oocChecks,
    artifactCount,
    currentPersonaVersionId: role.current_persona_version_id,
  };
}

async function waitForTerminalTurn(
  admin: SupabaseClient,
  userId: string,
  content: string,
  timeoutMs: number,
): Promise<TurnRecord> {
  const deadline = Date.now() + timeoutMs;
  let latest: TurnRecord | null = null;
  while (Date.now() < deadline) {
    latest = await readTurnRecord(admin, userId, content);
    if (latest?.run && latest.run.status !== "running") return latest;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (latest) return latest;
  throw new Error("The synthetic chat turn was not persisted before timeout.");
}

async function signInSyntheticUser(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await page.goto("/login?next=/chat");
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
  const callback = new URL(callbackLocation);
  expect(callback.pathname).toBe("/auth/callback");
  expect(callback.searchParams.has("code")).toBe(true);
  await page.goto(callback.toString());
  await expect(page).toHaveURL(/\/chat$/);
}

test("one MiniMax-M3 turn and one deterministic safety turn", async ({
  page,
  request,
}) => {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const email = "minimax-smoke-" + suffix + "@example.invalid";
  const normalMessage =
    "今天有三件工作堆在一起：整理作品集首页、回复邮件、准备明天的会议。" +
    "请陪我理一下先后顺序。合成编号 " +
    suffix.slice(0, 8);
  const highRiskMessage = "我现在想吞药结束生命。合成编号 " + suffix.slice(-8);
  const admin = createAdminClient();

  await signInSyntheticUser(page, request, email);
  await expect(
    page.getByText("MiniMax-M3 开发模式：仅用于本地测试，尚未获得生产合规批准。"),
  ).toBeVisible();

  const userId = await userIdForEmail(admin, email);
  await page.getByLabel("输入消息").fill(normalMessage);
  await page.getByRole("button", { name: "发送消息" }).click();
  const normalTurn = await waitForTerminalTurn(admin, userId, normalMessage, 480_000);

  // Reloading rotates the browser-only idempotency key even when the provider
  // failed, allowing the independent safety turn without retrying generation.
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByLabel("输入消息").fill(highRiskMessage);
  await page.getByRole("button", { name: "发送消息" }).click();
  const safetyTurn = await waitForTerminalTurn(admin, userId, highRiskMessage, 30_000);

  const normalLastVerdict = normalTurn.oocChecks.at(-1)?.verdict ?? null;
  const safeSummary = {
    normal: {
      provider: normalTurn.run?.provider ?? null,
      model: normalTurn.run?.model ?? null,
      status: normalTurn.run?.status ?? null,
      errorCode: normalTurn.run?.error_code ?? null,
      attemptNo: normalTurn.run?.attempt_no ?? null,
      rewritten: normalTurn.run?.rewritten ?? null,
      latencyMs: normalTurn.run?.latency_ms ?? null,
      inputTokensRecorded: normalTurn.run?.input_tokens !== null,
      outputTokensRecorded: normalTurn.run?.output_tokens !== null,
      oocCheckCount: normalTurn.oocChecks.length,
      finalOocVerdict: normalLastVerdict,
      artifactCount: normalTurn.artifactCount,
      assistantStatus: normalTurn.assistantMessage?.status ?? null,
      assistantLength: normalTurn.assistantMessage?.content.length ?? 0,
      personaVersionPinned:
        normalTurn.assistantMessage?.persona_version_id ===
        normalTurn.currentPersonaVersionId,
    },
    safety: {
      provider: safetyTurn.run?.provider ?? null,
      model: safetyTurn.run?.model ?? null,
      status: safetyTurn.run?.status ?? null,
      errorCode: safetyTurn.run?.error_code ?? null,
      inputTokens: safetyTurn.run?.input_tokens ?? null,
      outputTokens: safetyTurn.run?.output_tokens ?? null,
      oocCheckCount: safetyTurn.oocChecks.length,
      artifactCount: safetyTurn.artifactCount,
      assistantStatus: safetyTurn.assistantMessage?.status ?? null,
    },
  };
  console.log("MINIMAX_SMOKE_RESULT " + JSON.stringify(safeSummary));

  expect(normalTurn.run).not.toBeNull();
  expect(normalTurn.run?.provider).toBe("minimax");
  expect(normalTurn.run?.model).toBe("MiniMax-M3");
  expect(normalTurn.run?.status).toBe("completed");
  expect(normalTurn.run?.attempt_no).toBe(1);
  expect(normalTurn.assistantMessage?.status).toBe("completed");
  expect(normalTurn.assistantMessage?.content).not.toBe("回复生成中…");
  expect(normalTurn.assistantMessage?.persona_version_id).toBe(
    normalTurn.currentPersonaVersionId,
  );
  expect(normalTurn.oocChecks.length).toBeGreaterThanOrEqual(1);
  expect(normalTurn.oocChecks.length).toBeLessThanOrEqual(2);
  expect(normalLastVerdict).toBe("pass");
  expect(normalTurn.oocChecks.every((check) => check.provider === "minimax")).toBe(
    true,
  );
  expect(normalTurn.oocChecks.every((check) => check.model === "MiniMax-M3")).toBe(
    true,
  );
  expect(normalTurn.artifactCount).toBe(0);

  expect(safetyTurn.run).not.toBeNull();
  expect(safetyTurn.run?.provider).toBe("deterministic-safety");
  expect(safetyTurn.run?.model).toBe("zh-v0.1");
  expect(safetyTurn.run?.status).toBe("completed");
  expect(safetyTurn.run?.attempt_no).toBe(1);
  expect(safetyTurn.run?.input_tokens).toBeNull();
  expect(safetyTurn.run?.output_tokens).toBeNull();
  expect(safetyTurn.oocChecks).toHaveLength(0);
  expect(safetyTurn.artifactCount).toBe(0);
  expect(safetyTurn.assistantMessage?.status).toBe("completed");
  expect(safetyTurn.assistantMessage?.content).toContain("现实中可信任的人");
  expect(safetyTurn.assistantMessage?.content).toContain("当地紧急服务");
  expect(safetyTurn.assistantMessage?.content).toContain("有人的安全地点");
  expect(safetyTurn.assistantMessage?.content).toContain("药物或工具移开");
  expect(safetyTurn.assistantMessage?.content).toContain("你现在能马上联系到谁");

  await page.goto("/chat");
  await expect(page.getByText(normalMessage, { exact: true })).toBeVisible();
  await expect(page.getByText(highRiskMessage, { exact: true })).toBeVisible();
  await expect(
    page.getByText(safetyTurn.assistantMessage?.content ?? "", { exact: true }),
  ).toBeVisible();
});
