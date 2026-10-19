import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter } from "../ai/model-adapter";
import type { PlanExtractionContext } from "./plan-extraction-data";
import {
  PLAN_EXTRACTION_PROMPT_VERSION,
  PlanExtractionRuntimeError,
  classifyPlanMessage,
  runPlanExtraction,
} from "./plan-extraction-runtime";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  message: "00000000-0000-4000-8000-000000000003",
  run: "00000000-0000-4000-8000-000000000004",
  proposal: "00000000-0000-4000-8000-000000000005",
};
const now = new Date("2026-09-07T10:00:00.000Z");
const context: PlanExtractionContext = {
  userId: ids.user,
  roleId: ids.role,
  roleName: "林知夏",
  sourceMessageId: ids.message,
  sourceMessage: "请帮我创建明天晚上七点半整理作品集首页的日计划。",
  timezone: "Asia/Shanghai",
};

const createOutput = {
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
};

function adapterWith(output: unknown): ModelAdapter {
  return {
    descriptor: {
      id: "plan-runtime-test",
      providerId: "descriptor-provider",
      modelId: "descriptor-model",
      capabilities: ["structured-output"],
    },
    generate: vi.fn(),
    generateStructured: vi.fn(async (request) => ({
      providerId: "local-fixed",
      modelId: "plan-classifier-v0",
      requestId: "request-1",
      output: request.parse(output),
      latencyMs: 4.6,
      usage: { inputTokens: 123.2, outputTokens: 45.8 },
    })),
  };
}

describe("runPlanExtraction", () => {
  it("stays disabled unless an authorized worker explicitly enables it", async () => {
    const adapter = adapterWith(createOutput);
    await expect(
      runPlanExtraction(
        { context, idempotencyKey: "plan-request-001", now },
        { adapter },
      ),
    ).rejects.toMatchObject({ code: "disabled" });
    expect(adapter.generateStructured).not.toHaveBeenCalled();
  });

  it("passes UTC and account timezone to a provider-neutral classifier and persists clean metadata", async () => {
    const adapter = adapterWith(createOutput);
    const persist = vi.fn().mockResolvedValue({
      runId: ids.run,
      proposalId: ids.proposal,
      replayed: false,
    });

    await expect(
      runPlanExtraction(
        {
          context,
          idempotencyKey: "plan-request-002",
          now,
          traceId: "plan-safe-trace",
        },
        { enabled: true, adapter, persist },
      ),
    ).resolves.toEqual({
      runId: ids.run,
      proposalId: ids.proposal,
      replayed: false,
    });

    const request = vi.mocked(adapter.generateStructured).mock.calls[0]?.[0];
    expect(request?.messages[1]?.content).toContain(now.toISOString());
    expect(request?.messages[1]?.content).toContain("Asia/Shanghai");
    expect(request?.metadata).toMatchObject({
      feature: "plan-extraction",
      promptVersion: PLAN_EXTRACTION_PROMPT_VERSION,
      traceId: "plan-safe-trace",
    });
    expect(persist).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        intent: "create",
        flowAction: "show_confirmation_card",
        draft: expect.objectContaining({
          originalTimeText: "明天晚上七点半",
        }),
      }),
      PLAN_EXTRACTION_PROMPT_VERSION,
      "plan-request-002",
      {
        providerId: "local-fixed",
        modelId: "plan-classifier-v0",
        latencyMs: 5,
        inputTokens: 123,
        outputTokens: 46,
      },
    );
  });

  it("drops an original time phrase that is not an exact source substring", async () => {
    const persist = vi.fn().mockResolvedValue({
      runId: ids.run,
      proposalId: ids.proposal,
      replayed: false,
    });

    await runPlanExtraction(
      { context, idempotencyKey: "plan-request-003", now },
      {
        enabled: true,
        adapter: adapterWith({
          ...createOutput,
          originalTimeText: "明晚19:30",
        }),
        persist,
      },
    );

    expect(persist.mock.calls[0]?.[1].draft?.originalTimeText).toBeNull();
  });

  it("removes unsupported precise time fields from week output before persistence", async () => {
    const persist = vi.fn().mockResolvedValue({
      runId: ids.run,
      proposalId: ids.proposal,
      replayed: false,
    });
    await runPlanExtraction(
      { context, idempotencyKey: "plan-request-004", now },
      {
        enabled: true,
        adapter: adapterWith({
          ...createOutput,
          scope: "week",
          parsedPayload: {
            weekStart: "2026-09-07",
            dueDate: "2026-09-13",
            scheduledAt: "2026-09-08T19:30:00+08:00",
            reminderAt: "2026-09-08T19:00:00+08:00",
          },
        }),
        persist,
      },
    );

    expect(persist.mock.calls[0]?.[1].draft).toMatchObject({
      parsedPayload: { weekStart: "2026-09-07", dueDate: "2026-09-13" },
      ignoredPayloadKeys: ["scheduledAt", "reminderAt"],
    });
  });

  it("rejects invalid context, time, or idempotency before calling the adapter", async () => {
    const adapter = adapterWith(createOutput);
    await expect(
      runPlanExtraction(
        {
          context: { ...context, timezone: "Not/A_Timezone" },
          idempotencyKey: "short",
          now: new Date(Number.NaN),
        },
        { enabled: true, adapter, persist: vi.fn() },
      ),
    ).rejects.toEqual(new PlanExtractionRuntimeError("invalid-input"));
    expect(adapter.generateStructured).not.toHaveBeenCalled();
  });

  it("maps adapter errors and malformed structured output to a safe classifier error", async () => {
    await expect(
      runPlanExtraction(
        { context, idempotencyKey: "plan-request-005", now },
        { enabled: true, adapter: adapterWith({ intent: "create" }), persist: vi.fn() },
      ),
    ).rejects.toEqual(new PlanExtractionRuntimeError("classifier-unavailable"));
  });

  it("maps missing, rejected, and malformed persistence results to a safe error", async () => {
    const adapter = adapterWith(createOutput);
    await expect(
      runPlanExtraction(
        { context, idempotencyKey: "plan-request-006", now },
        { enabled: true, adapter },
      ),
    ).rejects.toEqual(new PlanExtractionRuntimeError("persistence-unavailable"));

    await expect(
      runPlanExtraction(
        { context, idempotencyKey: "plan-request-007", now },
        {
          enabled: true,
          adapter,
          persist: vi.fn().mockRejectedValue(new Error("private database detail")),
        },
      ),
    ).rejects.toEqual(new PlanExtractionRuntimeError("persistence-unavailable"));
  });
});

describe("classifyPlanMessage", () => {
  it("returns the same confirmation policy without writing a proposal", async () => {
    const adapter = adapterWith(createOutput);
    adapter.generate = vi.fn(async () => ({
      providerId: "local-fixed",
      modelId: "plan-classifier-v0",
      requestId: "request-1",
      text: `说明\n${JSON.stringify({
        ...createOutput,
        scope: "month",
        parsedPayload: { month: "2026-10" },
      })}`,
      finishReason: "stop" as const,
      latencyMs: 4,
    }));
    const policy = await classifyPlanMessage(
      {
        roleName: "林知夏",
        sourceMessage: context.sourceMessage,
        now,
      },
      adapter,
    );

    expect(policy).toMatchObject({
      flowAction: "show_confirmation_card",
      draft: { scope: "month", title: "整理作品集首页" },
    });
    expect(adapter.generate).toHaveBeenCalledOnce();
  });
});
