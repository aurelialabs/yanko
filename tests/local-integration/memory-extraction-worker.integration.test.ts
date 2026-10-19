import { execFileSync } from "node:child_process";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";

import type { ModelAdapter } from "@/modules/ai/model-adapter";
import { runConfiguredMemoryEmbeddingWorker } from "@/modules/ai/memory-embedding-worker";
import { runConfiguredMemoryExtractionWorker } from "@/modules/ai/memory-extraction-worker";
import {
  MEMORY_EMBEDDING_DIMENSIONS,
  retrieveMemoryVectors,
  type MemoryEmbeddingAdapter,
} from "@/modules/ai/memory-vector";
import { SupabaseMemoryVectorStore } from "@/modules/ai/memory-vector-data";
import { runConfiguredPlanExtractionWorker } from "@/modules/plan/plan-extraction-worker";

interface LocalSupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface ChatTurnResult {
  user_message_id?: unknown;
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
    throw new Error("本地集成测试拒绝连接非本机 Supabase");
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
    // Fall through to explicitly configured local values.
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("本地集成测试缺少正在运行的 Supabase 配置");
  }
  requireLoopbackUrl(url);
  return { url, anonKey, serviceRoleKey };
}

function fixedMemoryAdapter(input: {
  roleId: string;
  normalizedKey: string;
}): ModelAdapter {
  return {
    descriptor: {
      id: "local-memory-integration-fixed",
      providerId: "local-fixed",
      modelId: "memory-candidate-v0",
      capabilities: ["structured-output"],
    },
    async generate() {
      throw new Error("本地记忆集成 Adapter 不提供文本生成");
    },
    async generateStructured(request) {
      return {
        providerId: "local-fixed",
        modelId: "memory-candidate-v0",
        requestId: request.metadata?.traceId ?? "local-memory-integration",
        output: request.parse({
          candidates: [
            {
              action: "confirm",
              scope: "role_private",
              roleId: input.roleId,
              category: "agreement",
              content: "用户难过时希望先被完整倾听。",
              normalizedKey: input.normalizedKey,
              sensitivity: "normal",
              confidence: 1,
              supersedesMemoryId: null,
              evidenceQuote: "请先听我说完",
            },
          ],
        }),
        latencyMs: 0,
      };
    },
  };
}

function fixedEmbeddingAdapter(): MemoryEmbeddingAdapter {
  const vector = Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  );

  return {
    descriptor: {
      providerId: "local-fixed",
      modelId: "deterministic-1536-v1",
      dimensions: MEMORY_EMBEDDING_DIMENSIONS,
    },
    async embed() {
      return {
        providerId: "local-fixed",
        modelId: "deterministic-1536-v1",
        vector,
        latencyMs: 0,
      };
    },
  };
}

function fixedPlanAdapter(): ModelAdapter {
  return {
    descriptor: {
      id: "local-plan-integration-fixed",
      providerId: "local-fixed",
      modelId: "plan-classifier-v0",
      capabilities: ["structured-output"],
    },
    async generate() {
      throw new Error("本地计划集成 Adapter 不提供文本生成");
    },
    async generateStructured(request) {
      return {
        providerId: "local-fixed",
        modelId: "plan-classifier-v0",
        requestId: request.metadata?.traceId ?? "local-plan-integration",
        output: request.parse({
          intent: "create",
          scope: "day",
          confidence: 1,
          title: "整理作品集首页",
          originalTimeText: "明天晚上七点半",
          parsedPayload: {
            date: "2026-09-08",
            scheduledAt: "2026-09-08T19:30:00+08:00",
          },
          missingFields: [],
          reasoningLabel: "explicit_create",
        }),
        latencyMs: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

afterEach(async () => {
  if (cleanupClient && cleanupUserId) {
    const deleted = await cleanupClient.auth.admin.deleteUser(cleanupUserId);
    expect(deleted.error).toBeNull();
  }
  cleanupClient = null;
  cleanupUserId = null;
});

describe("local durable memory extraction queue", () => {
  it("processes only its synthetic message and lets that user confirm the candidate", async () => {
    const config = localSupabaseConfig();
    process.env.NEXT_PUBLIC_SUPABASE_URL = config.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = config.serviceRoleKey;

    const serviceClient = createClient(config.url, config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cleanupClient = serviceClient;

    const suffix = crypto.randomUUID().replaceAll("-", "");
    const email = `memory-worker-${suffix}@example.invalid`;
    const password = `Local-only-${suffix}!`;
    const sourceContent = "本地队列集成测试：以后我难过时，请先听我说完。";
    const candidateContent = "用户难过时希望先被完整倾听。";
    const normalizedKey = `local_integration_support_when_sad_${suffix}`;

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

    const profileResult = await userClient
      .from("profiles")
      .select("current_role_id")
      .eq("id", userId!)
      .single();
    expect(profileResult.error).toBeNull();
    const roleId = profileResult.data?.current_role_id;
    expect(roleId).toMatch(/^[0-9a-f-]{36}$/);

    const conversationResult = await userClient
      .from("conversations")
      .select("id")
      .eq("role_id", roleId!)
      .single();
    expect(conversationResult.error).toBeNull();
    const conversationId = conversationResult.data?.id;
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);

    const turnResult = await userClient.rpc("append_mock_chat_turn", {
      p_role_id: roleId!,
      p_conversation_id: conversationId!,
      p_content: sourceContent,
      p_client_message_id: `local-memory-integration-${suffix}`,
    });
    expect(turnResult.error).toBeNull();
    const sourceMessageId = (turnResult.data as ChatTurnResult[] | null)?.[0]
      ?.user_message_id;
    expect(sourceMessageId).toMatch(/^[0-9a-f-]{36}$/);

    const jobResult = await serviceClient
      .from("memory_extraction_jobs")
      .select("id,status,attempt_count")
      .eq("user_id", userId!)
      .eq("source_message_id", sourceMessageId!)
      .single();
    expect(jobResult.error).toBeNull();
    expect(jobResult.data).toMatchObject({ status: "scheduled", attempt_count: 0 });
    const jobId = jobResult.data?.id;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    const workerResult = await runConfiguredMemoryExtractionWorker({
      enabled: true,
      jobId: jobId!,
      maxJobs: 1,
      adapter: fixedMemoryAdapter({ roleId: roleId!, normalizedKey }),
    });
    expect(workerResult).toMatchObject({
      type: "processed",
      claimedCount: 1,
      outcomes: [{ type: "succeeded", jobId, finalStatus: "succeeded" }],
    });

    const completedJob = await serviceClient
      .from("memory_extraction_jobs")
      .select("status,attempt_count,extraction_run_id,last_error_code")
      .eq("id", jobId!)
      .single();
    expect(completedJob.error).toBeNull();
    expect(completedJob.data).toMatchObject({
      status: "succeeded",
      attempt_count: 1,
      last_error_code: null,
    });
    expect(completedJob.data?.extraction_run_id).toMatch(/^[0-9a-f-]{36}$/);

    const runResult = await serviceClient
      .from("memory_extraction_runs")
      .select("id,user_id,role_id,source_message_id")
      .eq("id", completedJob.data!.extraction_run_id!)
      .single();
    expect(runResult.error).toBeNull();
    expect(runResult.data).toMatchObject({
      user_id: userId,
      role_id: roleId,
      source_message_id: sourceMessageId,
    });

    const candidateResult = await userClient
      .from("memory_candidates")
      .select("id,status,role_id,source_message_id,content,sensitivity")
      .eq("source_message_id", sourceMessageId!)
      .single();
    expect(candidateResult.error).toBeNull();
    expect(candidateResult.data).toMatchObject({
      status: "pending",
      role_id: roleId,
      source_message_id: sourceMessageId,
      content: candidateContent,
      sensitivity: "normal",
    });

    const formalMemoryBeforeConfirmation = await userClient
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("source_message_id", sourceMessageId!);
    expect(formalMemoryBeforeConfirmation.error).toBeNull();
    expect(formalMemoryBeforeConfirmation.count).toBe(0);

    const confirmed = await userClient.rpc("confirm_memory_candidate", {
      p_candidate_id: candidateResult.data!.id,
      p_edited_content: candidateContent,
      p_edited_scope: "role_private",
      p_edited_role_id: roleId!,
      p_idempotency_key: `local-memory-confirm-${suffix}`,
    });
    expect(confirmed.error).toBeNull();
    expect(confirmed.data).toMatch(/^[0-9a-f-]{36}$/);

    const memoryResult = await userClient
      .from("memories")
      .select(
        "id,status,role_id,content,confirmed_by_user,source_message_id,updated_at",
      )
      .eq("id", confirmed.data!)
      .single();
    expect(memoryResult.error).toBeNull();
    expect(memoryResult.data).toMatchObject({
      status: "active",
      role_id: roleId,
      content: candidateContent,
      confirmed_by_user: true,
      source_message_id: sourceMessageId,
    });

    const embeddingAdapter = fixedEmbeddingAdapter();
    const vectorStore = new SupabaseMemoryVectorStore(serviceClient);
    const embeddingJobResult = await serviceClient
      .from("memory_embedding_jobs")
      .select("id,status,attempt_count")
      .eq("user_id", userId!)
      .eq("memory_id", memoryResult.data!.id)
      .single();
    expect(embeddingJobResult.error).toBeNull();
    expect(embeddingJobResult.data).toMatchObject({
      status: "scheduled",
      attempt_count: 0,
    });

    await expect(
      runConfiguredMemoryEmbeddingWorker({
        enabled: true,
        jobId: embeddingJobResult.data!.id,
        maxJobs: 1,
        adapter: embeddingAdapter,
        vectorStore,
      }),
    ).resolves.toMatchObject({
      type: "processed",
      claimedCount: 1,
      outcomes: [
        {
          type: "succeeded",
          jobId: embeddingJobResult.data!.id,
          memoryId: memoryResult.data!.id,
          finalStatus: "succeeded",
        },
      ],
    });

    const completedEmbeddingJob = await serviceClient
      .from("memory_embedding_jobs")
      .select("status,attempt_count,embedding_provider,embedding_model,last_error_code")
      .eq("id", embeddingJobResult.data!.id)
      .single();
    expect(completedEmbeddingJob.error).toBeNull();
    expect(completedEmbeddingJob.data).toMatchObject({
      status: "succeeded",
      attempt_count: 1,
      embedding_provider: "local-fixed",
      embedding_model: "deterministic-1536-v1",
      last_error_code: null,
    });

    await expect(
      retrieveMemoryVectors(
        {
          userId: userId!,
          roleId: roleId!,
          query: "我现在有些难过",
          maxResults: 5,
          minSimilarity: 0.99,
        },
        { adapter: embeddingAdapter, store: vectorStore },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        memoryId: memoryResult.data!.id,
        roleId,
        content: candidateContent,
        sensitivity: "normal",
        confirmedByUser: true,
        similarity: 1,
      }),
    ]);
  });
});

describe("local durable plan extraction queue", () => {
  it("claims only its synthetic message and creates a pending proposal with no formal plan", async () => {
    const config = localSupabaseConfig();
    process.env.NEXT_PUBLIC_SUPABASE_URL = config.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = config.serviceRoleKey;

    const serviceClient = createClient(config.url, config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cleanupClient = serviceClient;

    const suffix = crypto.randomUUID().replaceAll("-", "");
    const email = "plan-worker-" + suffix + "@example.invalid";
    const password = "Local-only-" + suffix + "!";
    const sourceContent =
      "本地计划队列集成测试：请帮我创建明天晚上七点半整理作品集首页的日计划。";

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

    const profileResult = await userClient
      .from("profiles")
      .select("current_role_id")
      .eq("id", userId!)
      .single();
    expect(profileResult.error).toBeNull();
    const roleId = profileResult.data?.current_role_id;
    expect(roleId).toMatch(/^[0-9a-f-]{36}$/);

    const conversationResult = await userClient
      .from("conversations")
      .select("id")
      .eq("role_id", roleId!)
      .single();
    expect(conversationResult.error).toBeNull();
    const conversationId = conversationResult.data?.id;
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);

    const turnResult = await userClient.rpc("append_mock_chat_turn", {
      p_role_id: roleId!,
      p_conversation_id: conversationId!,
      p_content: sourceContent,
      p_client_message_id: "local-plan-integration-" + suffix,
    });
    expect(turnResult.error).toBeNull();
    const sourceMessageId = (turnResult.data as ChatTurnResult[] | null)?.[0]
      ?.user_message_id;
    expect(sourceMessageId).toMatch(/^[0-9a-f-]{36}$/);

    const jobResult = await serviceClient
      .from("plan_extraction_jobs")
      .select("id,status,attempt_count")
      .eq("user_id", userId!)
      .eq("source_message_id", sourceMessageId!)
      .single();
    expect(jobResult.error).toBeNull();
    expect(jobResult.data).toMatchObject({ status: "scheduled", attempt_count: 0 });
    const jobId = jobResult.data?.id;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      runConfiguredPlanExtractionWorker({
        enabled: true,
        jobId: jobId!,
        adapter: fixedPlanAdapter(),
      }),
    ).resolves.toMatchObject({
      type: "processed",
      claimedCount: 1,
      outcomes: [
        {
          type: "succeeded",
          jobId,
          finalStatus: "succeeded",
        },
      ],
    });

    const completedJob = await serviceClient
      .from("plan_extraction_jobs")
      .select("status,attempt_count,extraction_run_id,last_error_code")
      .eq("id", jobId!)
      .single();
    expect(completedJob.error).toBeNull();
    expect(completedJob.data).toMatchObject({
      status: "succeeded",
      attempt_count: 1,
      last_error_code: null,
    });
    expect(completedJob.data?.extraction_run_id).toMatch(/^[0-9a-f-]{36}$/);

    const runResult = await serviceClient
      .from("plan_extraction_runs")
      .select(
        "id,user_id,role_id,source_message_id,policy_version,prompt_version,provider,model,intent,flow_action,scope,confidence,suggested_title,original_time_text,parsed_payload,missing_fields,proposal_id,latency_ms,input_tokens,output_tokens",
      )
      .eq("id", completedJob.data!.extraction_run_id!)
      .single();
    expect(runResult.error).toBeNull();
    expect(runResult.data).toMatchObject({
      user_id: userId,
      role_id: roleId,
      source_message_id: sourceMessageId,
      policy_version: "v0.1",
      prompt_version: "plan-extraction-v0.1-grounded",
      provider: "local-fixed",
      model: "plan-classifier-v0",
      intent: "create",
      flow_action: "show_confirmation_card",
      scope: "day",
      suggested_title: "整理作品集首页",
      original_time_text: "明天晚上七点半",
      parsed_payload: {
        date: "2026-09-08",
        scheduledAt: "2026-09-08T19:30:00+08:00",
      },
      missing_fields: [],
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(runResult.data?.proposal_id).toMatch(/^[0-9a-f-]{36}$/);

    const proposalResult = await userClient
      .from("plan_proposals")
      .select(
        "id,status,source_role_id,source_message_id,intent,scope,suggested_title,original_time_text,confirmed_plan_id",
      )
      .eq("id", runResult.data!.proposal_id!)
      .single();
    expect(proposalResult.error).toBeNull();
    expect(proposalResult.data).toMatchObject({
      status: "pending",
      source_role_id: roleId,
      source_message_id: sourceMessageId,
      intent: "create",
      scope: "day",
      suggested_title: "整理作品集首页",
      original_time_text: "明天晚上七点半",
      confirmed_plan_id: null,
    });

    const formalPlans = await userClient
      .from("plans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId!);
    expect(formalPlans.error).toBeNull();
    expect(formalPlans.count).toBe(0);
  });
});
