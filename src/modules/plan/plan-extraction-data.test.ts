import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceClientFactory = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: serviceClientFactory,
}));

import {
  PlanExtractionDataError,
  loadPlanExtractionContext,
  persistPlanExtraction,
} from "./plan-extraction-data";
import { applyPlanIntentPolicy } from "./plan-intent-policy";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  message: "00000000-0000-4000-8000-000000000003",
  run: "00000000-0000-4000-8000-000000000004",
  proposal: "00000000-0000-4000-8000-000000000005",
};

function queryWith(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  return query;
}

function loadClient(overrides?: {
  role?: unknown;
  message?: unknown;
  settings?: unknown;
}) {
  const results = {
    roles:
      overrides?.role ??
      ({
        data: { id: ids.role, display_name: "林知夏", status: "active" },
        error: null,
      } as const),
    messages:
      overrides?.message ??
      ({
        data: {
          id: ids.message,
          role_id: ids.role,
          sender: "user",
          content: "请帮我创建明天的日计划。",
          status: "completed",
          deleted_at: null,
        },
        error: null,
      } as const),
    user_settings:
      overrides?.settings ??
      ({ data: { timezone: "Asia/Shanghai" }, error: null } as const),
  };
  const from = vi.fn((table: keyof typeof results) => queryWith(results[table]));
  return { from };
}

beforeEach(() => {
  serviceClientFactory.mockReset();
});

describe("loadPlanExtractionContext", () => {
  it("loads one owned active-role message with the account timezone", async () => {
    const client = loadClient();
    serviceClientFactory.mockReturnValue(client);
    await expect(
      loadPlanExtractionContext(ids.user, ids.role, ids.message),
    ).resolves.toEqual({
      userId: ids.user,
      roleId: ids.role,
      roleName: "林知夏",
      sourceMessageId: ids.message,
      sourceMessage: "请帮我创建明天的日计划。",
      timezone: "Asia/Shanghai",
    });
    expect(client.from).toHaveBeenCalledTimes(3);
  });

  it("returns null for invalid ids, cross-role data, or an invalid timezone", async () => {
    await expect(
      loadPlanExtractionContext("bad", ids.role, ids.message),
    ).resolves.toBeNull();
    expect(serviceClientFactory).not.toHaveBeenCalled();

    serviceClientFactory.mockReturnValue(
      loadClient({
        message: {
          data: {
            id: ids.message,
            role_id: ids.user,
            sender: "user",
            content: "不属于该角色",
            status: "completed",
            deleted_at: null,
          },
          error: null,
        },
      }),
    );
    await expect(
      loadPlanExtractionContext(ids.user, ids.role, ids.message),
    ).resolves.toBeNull();

    serviceClientFactory.mockReturnValue(
      loadClient({ settings: { data: { timezone: "Local" }, error: null } }),
    );
    await expect(
      loadPlanExtractionContext(ids.user, ids.role, ids.message),
    ).resolves.toBeNull();
  });

  it("maps missing service configuration and query errors to stable codes", async () => {
    serviceClientFactory.mockReturnValue(null);
    await expect(
      loadPlanExtractionContext(ids.user, ids.role, ids.message),
    ).rejects.toEqual(new PlanExtractionDataError("configuration-unavailable"));

    serviceClientFactory.mockReturnValue(
      loadClient({ role: { data: null, error: { message: "private detail" } } }),
    );
    await expect(
      loadPlanExtractionContext(ids.user, ids.role, ids.message),
    ).rejects.toEqual(new PlanExtractionDataError("query-unavailable"));
  });
});

describe("persistPlanExtraction", () => {
  it("sends only policy-clean fields and safe model metadata", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { runId: ids.run, proposalId: ids.proposal, replayed: false },
      error: null,
    });
    serviceClientFactory.mockReturnValue({ rpc });
    const context = {
      userId: ids.user,
      roleId: ids.role,
      roleName: "林知夏",
      sourceMessageId: ids.message,
      sourceMessage: "请帮我创建明天的计划。",
      timezone: "Asia/Shanghai",
    };
    const policy = applyPlanIntentPolicy({
      intent: "create",
      scope: "day",
      confidence: 1,
      title: "整理首页",
      originalTimeText: "明天",
      parsedPayload: { date: "2026-09-08", forbidden: "drop-me" },
      missingFields: [],
      reasoningLabel: "do_not_persist_this_label",
    });

    await expect(
      persistPlanExtraction(context, policy, "plan-prompt-v1", "plan-idempotency-001", {
        providerId: "local-fixed",
        modelId: "plan-classifier-v0",
        latencyMs: 1,
        inputTokens: 2,
        outputTokens: 3,
      }),
    ).resolves.toEqual({
      runId: ids.run,
      proposalId: ids.proposal,
      replayed: false,
    });

    const payload = rpc.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      p_user_id: ids.user,
      p_role_id: ids.role,
      p_source_message_id: ids.message,
      p_intent: "create",
      p_flow_action: "show_confirmation_card",
      p_parsed_payload: { date: "2026-09-08" },
      p_provider: "local-fixed",
      p_model: "plan-classifier-v0",
    });
    expect(payload).not.toHaveProperty("sourceMessage");
    expect(payload).not.toHaveProperty("reasoningLabel");
    expect(JSON.stringify(payload)).not.toContain("do_not_persist_this_label");
    expect(JSON.stringify(payload)).not.toContain("drop-me");
  });

  it("returns null for missing configuration, RPC errors, or malformed output", async () => {
    serviceClientFactory.mockReturnValue(null);
    await expect(
      persistPlanExtraction(
        {} as never,
        {} as never,
        "prompt-version",
        "idempotency-key",
        {} as never,
      ),
    ).resolves.toBeNull();

    for (const response of [
      { data: null, error: { message: "private detail" } },
      { data: { runId: "bad", proposalId: null, replayed: false }, error: null },
    ]) {
      serviceClientFactory.mockReturnValue({
        rpc: vi.fn().mockResolvedValue(response),
      });
      await expect(
        persistPlanExtraction(
          {
            userId: ids.user,
            roleId: ids.role,
            roleName: "角色",
            sourceMessageId: ids.message,
            sourceMessage: "消息",
            timezone: "Asia/Shanghai",
          },
          applyPlanIntentPolicy({
            intent: "none",
            scope: null,
            confidence: 1,
            title: null,
            originalTimeText: null,
            parsedPayload: {},
            missingFields: [],
            reasoningLabel: "none",
          }),
          "prompt-version",
          "idempotency-key",
          {
            providerId: "local-fixed",
            modelId: "fixed",
            latencyMs: null,
            inputTokens: null,
            outputTokens: null,
          },
        ),
      ).resolves.toBeNull();
    }
  });
});
