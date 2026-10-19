import type { EmotionSignalOutput } from "@/server/schemas";

/** A follow-up is deliberately reserved for a strong, non-immediate negative signal. */
export const EMOTION_FOLLOWUP_MIN_INTENSITY = 0.8;

export type EmotionPolicyOutcome = "safety" | "support_only" | "schedule_next_day";

export interface EmotionPolicyResult {
  outcome: EmotionPolicyOutcome;
  emotionType: EmotionSignalOutput["primaryEmotion"];
  intensity: number;
  supportMode: EmotionSignalOutput["supportMode"];
}

/**
 * Applies product safety rules after schema validation. A model can request a
 * next-day follow-up, but cannot create one for immediate risk, safety-mode
 * responses, ordinary distress, or weak signals.
 */
export function applyEmotionPolicy(signal: EmotionSignalOutput): EmotionPolicyResult {
  const shared = {
    emotionType: signal.primaryEmotion,
    intensity: signal.intensity,
    supportMode: signal.supportMode,
  } as const;

  if (signal.highRisk || signal.supportMode === "safety") {
    return { outcome: "safety", ...shared };
  }

  if (
    signal.valence === "negative" &&
    signal.intensity >= EMOTION_FOLLOWUP_MIN_INTENSITY &&
    signal.scheduleNextDayFollowup
  ) {
    return { outcome: "schedule_next_day", ...shared };
  }

  return { outcome: "support_only", ...shared };
}
