import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { uuidSchema } from "@/server/schemas";

import { runConfiguredEmotionSignalWorker } from "./emotion-signal-worker";

export const EMOTION_SIGNAL_DISPATCH_SIGNATURE_VERSION = "emotion-signal-dispatch-v1";
export const EMOTION_SIGNAL_DISPATCH_MAX_AGE_MS = 5 * 60 * 1_000;

const dispatchBodySchema = z.object({ jobId: uuidSchema }).strict();

interface DispatchEnvironment {
  [key: string]: string | undefined;
  EMOTION_SIGNAL_DISPATCH_ENABLED?: string;
  EMOTION_SIGNAL_DISPATCH_SECRET?: string;
}

export interface EmotionSignalDispatchConfig {
  secret: string;
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/**
 * This is intentionally separate from the Worker switch. Both a dispatcher
 * secret and an explicit Worker enablement are required before a task can get
 * as far as the provider-neutral runtime.
 */
export function readEmotionSignalDispatchConfig(
  environment: DispatchEnvironment = process.env,
): EmotionSignalDispatchConfig | null {
  if (!isEnabled(environment.EMOTION_SIGNAL_DISPATCH_ENABLED)) return null;

  const secret = environment.EMOTION_SIGNAL_DISPATCH_SECRET?.trim();
  if (!secret || secret.length < 32 || secret.length > 2_000) return null;
  return { secret };
}

function signingPayload(timestampMs: string, rawBody: string): string {
  return `${EMOTION_SIGNAL_DISPATCH_SIGNATURE_VERSION}.${timestampMs}.${rawBody}`;
}

/** Server-only helper for an approved scheduler or isolated route test. */
export function createEmotionSignalDispatchSignature(
  secret: string,
  timestampMs: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(signingPayload(timestampMs, rawBody), "utf8")
    .digest("hex");
}

function secureHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/iu.test(left) || !/^[a-f0-9]{64}$/iu.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function validTimestamp(timestampMs: string, nowMs: number): boolean {
  if (!/^\d{13}$/u.test(timestampMs)) return false;
  const parsed = Number(timestampMs);
  return (
    Number.isSafeInteger(parsed) &&
    Number.isSafeInteger(nowMs) &&
    Math.abs(nowMs - parsed) <= EMOTION_SIGNAL_DISPATCH_MAX_AGE_MS
  );
}

/**
 * Verifies a signed, replay-window-bounded raw body before JSON parsing. It
 * returns only the exact job ID; malformed input, stale timestamps, invalid
 * signatures, and schema violations intentionally share the same null result.
 */
export function verifyEmotionSignalDispatch(input: {
  config: EmotionSignalDispatchConfig;
  rawBody: string;
  signature: string | null;
  timestampMs: string | null;
  nowMs?: number;
}): string | null {
  const signature = input.signature?.trim().toLowerCase();
  const timestampMs = input.timestampMs?.trim();
  const nowMs = input.nowMs ?? Date.now();
  if (!signature || !timestampMs || !validTimestamp(timestampMs, nowMs)) return null;

  const expected = createEmotionSignalDispatchSignature(
    input.config.secret,
    timestampMs,
    input.rawBody,
  );
  if (!secureHexEqual(signature, expected)) return null;

  try {
    const parsed = dispatchBodySchema.safeParse(JSON.parse(input.rawBody));
    return parsed.success ? parsed.data.jobId : null;
  } catch {
    return null;
  }
}

export type EmotionSignalDispatchResult = "completed" | "unavailable";

/**
 * The dispatcher deliberately does not construct a provider Adapter. Until a
 * later, explicitly approved composition root supplies one, the configured
 * Worker fails before it can claim a job or send source text anywhere.
 */
export async function dispatchEmotionSignalJob(
  jobId: string,
  dependencies: {
    runWorker?: typeof runConfiguredEmotionSignalWorker;
  } = {},
): Promise<EmotionSignalDispatchResult> {
  try {
    const result = await (dependencies.runWorker ?? runConfiguredEmotionSignalWorker)({
      jobId,
    });
    return result.type === "disabled" ? "unavailable" : "completed";
  } catch {
    return "unavailable";
  }
}
