import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

import {
  type ClaimedEmotionFollowup,
  type EmotionFollowupCompletion,
  type EmotionFollowupCompletionOutcome,
  type EmotionFollowupDeliveryStore,
  SupabaseEmotionFollowupDeliveryStore,
} from "./emotion-followup-worker-data";

export const EMOTION_FOLLOWUP_DELIVERY_DEFAULT_LEASE_SECONDS = 300;

export type EmotionFollowupDeliveryInput = {
  followupId: string;
  userId: string;
  roleId: string;
  sourceMessageId: string;
  claimToken: string;
  now: Date;
};

export type EmotionFollowupDeliverer = (
  input: EmotionFollowupDeliveryInput,
) => Promise<
  | { outcome: "succeeded"; sentMessageId: string }
  | { outcome: "cancelled"; errorCode: "user_responded" | "source_unavailable" }
  | { outcome: "permanent_failure"; errorCode: string }
>;

export type EmotionFollowupMessageGenerator = (
  input: EmotionFollowupDeliveryInput,
) => Promise<string>;

export type EmotionFollowupWorkerJobOutcome =
  | { type: "succeeded"; followupId: string; sentMessageId: string }
  | {
      type: "cancelled";
      followupId: string;
      errorCode: "user_responded" | "source_unavailable";
    }
  | { type: "failed"; followupId: string; errorCode: string };

export type EmotionFollowupMessagePersistenceOutcome =
  | { type: "persisted"; followupId: string; sentMessageId: string }
  | {
      type: "unavailable";
      followupId: string;
      errorCode: "delivery_unavailable";
    };

export type EmotionFollowupWorkerOutcome =
  | { type: "disabled"; claimedCount: 0; outcomes: [] }
  | {
      type: "processed";
      claimedCount: 0 | 1;
      outcomes: EmotionFollowupWorkerJobOutcome[];
    };

export type EmotionFollowupWorkerErrorCode =
  | "invalid-worker-input"
  | "worker-configuration-unavailable"
  | "followup-claim-unavailable"
  | "followup-completion-unavailable";

export class EmotionFollowupWorkerError extends Error {
  constructor(readonly code: EmotionFollowupWorkerErrorCode) {
    super(code);
    this.name = "EmotionFollowupWorkerError";
  }
}

/**
 * Explicit composition-root boundary for a generated message. It persists
 * through the current claim only and intentionally does not complete the
 * follow-up; the caller must still run the terminal completion protocol.
 */
export async function persistEmotionFollowupMessage(input: {
  claim: Pick<ClaimedEmotionFollowup, "followupId" | "claimToken">;
  content: string;
  now: Date;
  store: EmotionFollowupDeliveryStore;
}): Promise<EmotionFollowupMessagePersistenceOutcome> {
  try {
    const sentMessageId = await input.store.persistMessage({
      followupId: input.claim.followupId,
      claimToken: input.claim.claimToken,
      content: input.content,
      now: input.now,
    });
    if (!sentMessageId || !uuidSchema.safeParse(sentMessageId).success) {
      return {
        type: "unavailable",
        followupId: input.claim.followupId,
        errorCode: "delivery_unavailable",
      };
    }
    return {
      type: "persisted",
      followupId: input.claim.followupId,
      sentMessageId,
    };
  } catch {
    return {
      type: "unavailable",
      followupId: input.claim.followupId,
      errorCode: "delivery_unavailable",
    };
  }
}

/**
 * Compose an explicitly injected generator with the controlled persistence
 * boundary. This helper never completes the follow-up; the Worker performs
 * terminal completion only after receiving the bound message ID.
 */
export function createEmotionFollowupDeliverer(input: {
  store: EmotionFollowupDeliveryStore;
  generate: EmotionFollowupMessageGenerator;
}): EmotionFollowupDeliverer {
  return async (deliveryInput) => {
    let content: string;
    try {
      content = await input.generate(deliveryInput);
    } catch {
      return {
        outcome: "permanent_failure",
        errorCode: "delivery_unavailable",
      };
    }

    const persisted = await persistEmotionFollowupMessage({
      claim: deliveryInput,
      content,
      now: deliveryInput.now,
      store: input.store,
    });
    if (persisted.type !== "persisted") {
      return {
        outcome: "permanent_failure",
        errorCode: "delivery_unavailable",
      };
    }
    return { outcome: "succeeded", sentMessageId: persisted.sentMessageId };
  };
}

function validErrorCode(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  return /^[a-z0-9_]{1,100}$/u.test(candidate) ? candidate : null;
}

async function complete(
  store: EmotionFollowupDeliveryStore,
  claim: ClaimedEmotionFollowup,
  now: Date,
  result: {
    outcome: EmotionFollowupCompletionOutcome;
    sentMessageId: string | null;
    errorCode: string | null;
  },
): Promise<EmotionFollowupCompletion> {
  try {
    return await store.complete({
      followupId: claim.followupId,
      claimToken: claim.claimToken,
      now,
      ...result,
    });
  } catch {
    throw new EmotionFollowupWorkerError("followup-completion-unavailable");
  }
}

export async function processEmotionFollowupDelivery(input: {
  claim: ClaimedEmotionFollowup;
  now: Date;
  store: EmotionFollowupDeliveryStore;
  deliver: EmotionFollowupDeliverer;
}): Promise<EmotionFollowupWorkerJobOutcome> {
  let delivery:
    | Awaited<ReturnType<EmotionFollowupDeliverer>>
    | { outcome: "permanent_failure"; errorCode: "delivery_unavailable" };

  try {
    delivery = await input.deliver({
      followupId: input.claim.followupId,
      userId: input.claim.userId,
      roleId: input.claim.roleId,
      sourceMessageId: input.claim.sourceMessageId,
      claimToken: input.claim.claimToken,
      now: input.now,
    });
  } catch {
    delivery = { outcome: "permanent_failure", errorCode: "delivery_unavailable" };
  }

  if (delivery.outcome === "succeeded") {
    if (!uuidSchema.safeParse(delivery.sentMessageId).success) {
      delivery = { outcome: "permanent_failure", errorCode: "delivery_unavailable" };
    } else {
      const completion = await complete(input.store, input.claim, input.now, {
        outcome: "succeeded",
        sentMessageId: delivery.sentMessageId,
        errorCode: null,
      });
      if (
        completion.status !== "succeeded" ||
        completion.sentMessageId !== delivery.sentMessageId
      ) {
        throw new EmotionFollowupWorkerError("followup-completion-unavailable");
      }
      return {
        type: "succeeded",
        followupId: input.claim.followupId,
        sentMessageId: delivery.sentMessageId,
      };
    }
  }

  if (delivery.outcome === "cancelled") {
    const completion = await complete(input.store, input.claim, input.now, {
      outcome: "cancelled",
      sentMessageId: null,
      errorCode: delivery.errorCode,
    });
    if (completion.status !== "cancelled") {
      throw new EmotionFollowupWorkerError("followup-completion-unavailable");
    }
    return {
      type: "cancelled",
      followupId: input.claim.followupId,
      errorCode: delivery.errorCode,
    };
  }

  const errorCode = validErrorCode(delivery.errorCode) ?? "delivery_unavailable";
  const completion = await complete(input.store, input.claim, input.now, {
    outcome: "permanent_failure",
    sentMessageId: null,
    errorCode,
  });
  if (completion.status !== "failed") {
    throw new EmotionFollowupWorkerError("followup-completion-unavailable");
  }
  return { type: "failed", followupId: input.claim.followupId, errorCode };
}

export function isEmotionFollowupDeliveryWorkerEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.EMOTION_FOLLOWUP_DELIVERY_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * This Worker is exact-ID-only and default-off. It has no built-in sender,
 * model Adapter, prompt, message loader, scheduler, or route registration.
 * A future approved composition root must explicitly inject `deliver`.
 */
export async function runConfiguredEmotionFollowupDeliveryWorker(input: {
  followupId?: string;
  enabled?: boolean;
  now?: Date;
  leaseSeconds?: number;
  store?: EmotionFollowupDeliveryStore;
  deliver?: EmotionFollowupDeliverer;
}): Promise<EmotionFollowupWorkerOutcome> {
  const enabled = input.enabled ?? isEmotionFollowupDeliveryWorkerEnabled();
  if (!enabled) return { type: "disabled", claimedCount: 0, outcomes: [] };

  const now = input.now ?? new Date();
  const followupId = input.followupId?.trim();
  const leaseSeconds =
    input.leaseSeconds ?? EMOTION_FOLLOWUP_DELIVERY_DEFAULT_LEASE_SECONDS;
  if (
    !uuidSchema.safeParse(followupId).success ||
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 30 ||
    leaseSeconds > 900
  ) {
    throw new EmotionFollowupWorkerError("invalid-worker-input");
  }

  const serviceClient = input.store ? null : createServiceRoleSupabaseClient();
  const store =
    input.store ??
    (serviceClient ? new SupabaseEmotionFollowupDeliveryStore(serviceClient) : null);
  if (!store || !input.deliver) {
    throw new EmotionFollowupWorkerError("worker-configuration-unavailable");
  }

  let claim: ClaimedEmotionFollowup | null;
  try {
    claim = await store.claimOne({ followupId: followupId!, now, leaseSeconds });
  } catch {
    throw new EmotionFollowupWorkerError("followup-claim-unavailable");
  }
  if (!claim) return { type: "processed", claimedCount: 0, outcomes: [] };

  const outcome = await processEmotionFollowupDelivery({
    claim,
    now,
    store,
    deliver: input.deliver,
  });
  return { type: "processed", claimedCount: 1, outcomes: [outcome] };
}
