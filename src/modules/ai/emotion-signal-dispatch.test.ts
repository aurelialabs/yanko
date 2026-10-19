import { describe, expect, it, vi } from "vitest";

import {
  createEmotionSignalDispatchSignature,
  dispatchEmotionSignalJob,
  EMOTION_SIGNAL_DISPATCH_MAX_AGE_MS,
  readEmotionSignalDispatchConfig,
  verifyEmotionSignalDispatch,
} from "./emotion-signal-dispatch";

const secret = "test-emotion-dispatch-secret-with-at-least-32-chars";
const jobId = "10000000-0000-4000-8000-000000000001";
const timestampMs = "1788832800000";
const nowMs = Number(timestampMs);
const rawBody = JSON.stringify({ jobId });

describe("emotion signal dispatch boundary", () => {
  it("fails closed unless both the internal switch and a sufficiently strong secret exist", () => {
    expect(readEmotionSignalDispatchConfig({})).toBeNull();
    expect(
      readEmotionSignalDispatchConfig({
        EMOTION_SIGNAL_DISPATCH_ENABLED: "true",
        EMOTION_SIGNAL_DISPATCH_SECRET: "short",
      }),
    ).toBeNull();
    expect(
      readEmotionSignalDispatchConfig({
        EMOTION_SIGNAL_DISPATCH_ENABLED: " TRUE ",
        EMOTION_SIGNAL_DISPATCH_SECRET: secret,
      }),
    ).toEqual({ secret });
  });

  it("accepts only a fresh signature bound to one strict job-ID payload", () => {
    const signature = createEmotionSignalDispatchSignature(
      secret,
      timestampMs,
      rawBody,
    );
    const config = { secret };

    expect(
      verifyEmotionSignalDispatch({
        config,
        rawBody,
        signature,
        timestampMs,
        nowMs,
      }),
    ).toBe(jobId);
    expect(
      verifyEmotionSignalDispatch({
        config,
        rawBody: JSON.stringify({ jobId, extra: true }),
        signature,
        timestampMs,
        nowMs,
      }),
    ).toBeNull();
    expect(
      verifyEmotionSignalDispatch({
        config,
        rawBody,
        signature: "0".repeat(64),
        timestampMs,
        nowMs,
      }),
    ).toBeNull();
    expect(
      verifyEmotionSignalDispatch({
        config,
        rawBody,
        signature,
        timestampMs,
        nowMs: nowMs + EMOTION_SIGNAL_DISPATCH_MAX_AGE_MS + 1,
      }),
    ).toBeNull();
  });

  it("does not construct a model adapter and maps worker state to two safe dispatch outcomes", async () => {
    const completedWorker = vi.fn().mockResolvedValue({
      type: "processed",
      claimedCount: 0,
      outcomes: [],
    });
    await expect(
      dispatchEmotionSignalJob(jobId, { runWorker: completedWorker }),
    ).resolves.toBe("completed");
    expect(completedWorker).toHaveBeenCalledWith({ jobId });

    await expect(
      dispatchEmotionSignalJob(jobId, {
        runWorker: async () => ({ type: "disabled", claimedCount: 0, outcomes: [] }),
      }),
    ).resolves.toBe("unavailable");
    await expect(
      dispatchEmotionSignalJob(jobId, {
        runWorker: async () => {
          throw new Error("model configuration detail");
        },
      }),
    ).resolves.toBe("unavailable");
  });
});
