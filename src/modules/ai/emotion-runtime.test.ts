import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter } from "./model-adapter";
import {
  EMOTION_SIGNAL_PROMPT_VERSION,
  EmotionRuntimeError,
  runEmotionSignal,
} from "./emotion-runtime";

const context = {
  userId: "10000000-0000-4000-8000-000000000001",
  roleId: "20000000-0000-4000-8000-000000000002",
  sourceMessageId: "30000000-0000-4000-8000-000000000003",
  sourceMessage: "我觉得事情全堆在一起，已经完全喘不过气了。",
};

const strongNegativeSignal = {
  primaryEmotion: "overwhelm",
  valence: "negative",
  intensity: 0.91,
  highRisk: false,
  scheduleNextDayFollowup: true,
  supportMode: "listen",
};

function adapterWith(output: unknown): ModelAdapter {
  return {
    descriptor: {
      id: "emotion-runtime-test",
      providerId: "descriptor-provider",
      modelId: "descriptor-model",
      capabilities: ["structured-output"],
    },
    generate: vi.fn(),
    generateStructured: vi.fn(async (request) => ({
      providerId: "local-fixed",
      modelId: "emotion-classifier-v0",
      requestId: "request-1",
      output: request.parse(output),
      latencyMs: 5,
    })),
  };
}

describe("runEmotionSignal", () => {
  it("does not call a provider unless a future worker explicitly enables it", async () => {
    const adapter = adapterWith(strongNegativeSignal);
    await expect(
      runEmotionSignal({ context, idempotencyKey: "emotion-request-001" }, { adapter }),
    ).rejects.toEqual(new EmotionRuntimeError("disabled"));
    expect(adapter.generateStructured).not.toHaveBeenCalled();
  });

  it("routes explicit immediate risk to deterministic safety without a provider or follow-up", async () => {
    const adapter = adapterWith(strongNegativeSignal);
    const persist = vi.fn();
    await expect(
      runEmotionSignal(
        {
          context: { ...context, sourceMessage: "我现在想吞药结束生命。" },
          idempotencyKey: "emotion-request-002",
        },
        { enabled: true, adapter, persist },
      ),
    ).resolves.toMatchObject({ outcome: "safety", policy: { supportMode: "safety" } });
    expect(adapter.generateStructured).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists only normalized metadata for an eligible strong negative signal", async () => {
    const adapter = adapterWith(strongNegativeSignal);
    const persist = vi.fn().mockResolvedValue({
      followupId: "40000000-0000-4000-8000-000000000004",
      status: "scheduled",
      scheduledFor: "2026-09-09T02:00:00.000Z",
    });
    await expect(
      runEmotionSignal(
        {
          context,
          idempotencyKey: "emotion-request-003",
          traceId: "emotion-safe-trace",
        },
        { enabled: true, adapter, persist },
      ),
    ).resolves.toMatchObject({ outcome: "followup_scheduled" });

    const request = vi.mocked(adapter.generateStructured).mock.calls[0]?.[0];
    expect(request?.metadata).toMatchObject({
      feature: "emotion-signal",
      promptVersion: EMOTION_SIGNAL_PROMPT_VERSION,
      traceId: "emotion-safe-trace",
    });
    expect(persist).toHaveBeenCalledWith({
      userId: context.userId,
      roleId: context.roleId,
      sourceMessageId: context.sourceMessageId,
      emotionType: "overwhelm",
      intensity: 0.91,
      idempotencyKey: "emotion-request-003",
    });
  });

  it("does not persist ordinary distress or a model-reported safety signal", async () => {
    const persist = vi.fn();
    await expect(
      runEmotionSignal(
        { context, idempotencyKey: "emotion-request-004" },
        {
          enabled: true,
          adapter: adapterWith({ ...strongNegativeSignal, intensity: 0.4 }),
          persist,
        },
      ),
    ).resolves.toMatchObject({ outcome: "support_only" });
    await expect(
      runEmotionSignal(
        { context, idempotencyKey: "emotion-request-005" },
        {
          enabled: true,
          adapter: adapterWith({
            ...strongNegativeSignal,
            highRisk: true,
            scheduleNextDayFollowup: false,
            supportMode: "safety",
          }),
          persist,
        },
      ),
    ).resolves.toMatchObject({ outcome: "safety" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("maps malformed model output and unavailable persistence to safe errors", async () => {
    await expect(
      runEmotionSignal(
        { context, idempotencyKey: "emotion-request-006" },
        { enabled: true, adapter: adapterWith({ primaryEmotion: "overwhelm" }) },
      ),
    ).rejects.toEqual(new EmotionRuntimeError("classifier-unavailable"));
    await expect(
      runEmotionSignal(
        { context, idempotencyKey: "emotion-request-007" },
        { enabled: true, adapter: adapterWith(strongNegativeSignal) },
      ),
    ).rejects.toEqual(new EmotionRuntimeError("persistence-unavailable"));
  });
});
