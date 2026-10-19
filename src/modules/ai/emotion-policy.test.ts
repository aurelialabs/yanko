import { describe, expect, it } from "vitest";

import type { EmotionSignalOutput } from "@/server/schemas";

import { applyEmotionPolicy, EMOTION_FOLLOWUP_MIN_INTENSITY } from "./emotion-policy";

const baseSignal = {
  primaryEmotion: "overwhelm",
  valence: "negative" as const,
  intensity: 0.91,
  highRisk: false,
  scheduleNextDayFollowup: true,
  supportMode: "listen" as const,
} satisfies EmotionSignalOutput;

describe("emotion follow-up policy", () => {
  it("schedules only a strong, explicitly requested non-immediate negative follow-up", () => {
    expect(applyEmotionPolicy(baseSignal)).toMatchObject({
      outcome: "schedule_next_day",
      emotionType: "overwhelm",
      intensity: 0.91,
    });
  });

  it.each([
    { ...baseSignal, intensity: EMOTION_FOLLOWUP_MIN_INTENSITY - 0.01 },
    { ...baseSignal, scheduleNextDayFollowup: false },
    { ...baseSignal, valence: "neutral" as const },
    { ...baseSignal, valence: "positive" as const },
  ])("keeps ordinary or unrequested signals in the current conversation", (signal) => {
    expect(applyEmotionPolicy(signal).outcome).toBe("support_only");
  });

  it.each([
    { ...baseSignal, highRisk: true },
    { ...baseSignal, supportMode: "safety" as const },
  ])("never schedules a passive follow-up for a safety signal", (signal) => {
    expect(applyEmotionPolicy(signal).outcome).toBe("safety");
  });
});
