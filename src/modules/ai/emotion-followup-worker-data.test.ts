import { describe, expect, it, vi } from "vitest";

import {
  EmotionFollowupDeliveryStoreError,
  SupabaseEmotionFollowupDeliveryStore,
} from "./emotion-followup-worker-data";

const followupId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const roleId = "30000000-0000-4000-8000-000000000003";
const sourceMessageId = "40000000-0000-4000-8000-000000000004";
const claimToken = "50000000-0000-4000-8000-000000000005";
const sentMessageId = "60000000-0000-4000-8000-000000000006";
const now = new Date("2026-09-08T02:00:00.000Z");

function clientWith(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  };
}

describe("emotion follow-up delivery store", () => {
  it("claims exactly one validated follow-up reference with no message body", async () => {
    const client = clientWith([
      {
        followup_id: followupId,
        user_id: userId,
        role_id: roleId,
        source_message_id: sourceMessageId,
        claim_token: claimToken,
        lease_expires_at: "2026-09-08T02:05:00.000Z",
      },
    ]);
    const store = new SupabaseEmotionFollowupDeliveryStore(client as never);

    await expect(
      store.claimOne({ followupId, now, leaseSeconds: 300 }),
    ).resolves.toEqual({
      followupId,
      userId,
      roleId,
      sourceMessageId,
      claimToken,
      leaseExpiresAt: "2026-09-08T02:05:00.000Z",
    });
    expect(client.rpc).toHaveBeenCalledWith("claim_due_emotion_followup", {
      p_followup_id: followupId,
      p_now: now.toISOString(),
      p_lease_seconds: 300,
    });
  });

  it("refuses malformed claims and maps terminal completion to minimal data", async () => {
    const malformedClient = clientWith([{ followup_id: followupId }]);
    const malformedStore = new SupabaseEmotionFollowupDeliveryStore(
      malformedClient as never,
    );
    await expect(
      malformedStore.claimOne({ followupId, now, leaseSeconds: 300 }),
    ).rejects.toEqual(new EmotionFollowupDeliveryStoreError("claim-unavailable"));

    const client = clientWith({
      followupId,
      status: "succeeded",
      sentMessageId,
    });
    const store = new SupabaseEmotionFollowupDeliveryStore(client as never);
    await expect(
      store.complete({
        followupId,
        claimToken,
        outcome: "succeeded",
        sentMessageId,
        errorCode: null,
        now,
      }),
    ).resolves.toEqual({ followupId, status: "succeeded", sentMessageId });
    expect(client.rpc).toHaveBeenCalledWith("complete_emotion_followup_delivery", {
      p_followup_id: followupId,
      p_claim_token: claimToken,
      p_outcome: "succeeded",
      p_sent_message_id: sentMessageId,
      p_error_code: null,
      p_now: now.toISOString(),
    });
  });

  it("persists only through the exact claim and accepts a fail-closed null result", async () => {
    const client = clientWith(sentMessageId);
    const store = new SupabaseEmotionFollowupDeliveryStore(client as never);

    await expect(
      store.persistMessage({
        followupId,
        claimToken,
        content: "  合成回访消息  ",
        now,
      }),
    ).resolves.toBe(sentMessageId);
    expect(client.rpc).toHaveBeenCalledWith(
      "persist_claimed_emotion_followup_message",
      {
        p_followup_id: followupId,
        p_claim_token: claimToken,
        p_content: "合成回访消息",
        p_now: now.toISOString(),
      },
    );

    const nullClient = clientWith(null);
    const nullStore = new SupabaseEmotionFollowupDeliveryStore(nullClient as never);
    await expect(
      nullStore.persistMessage({
        followupId,
        claimToken,
        content: "租约已失效",
        now,
      }),
    ).resolves.toBeNull();
  });

  it("rejects malformed persistence output and invalid message inputs", async () => {
    const malformedStore = new SupabaseEmotionFollowupDeliveryStore(
      clientWith({ id: sentMessageId }) as never,
    );
    await expect(
      malformedStore.persistMessage({
        followupId,
        claimToken,
        content: "合成消息",
        now,
      }),
    ).rejects.toEqual(
      new EmotionFollowupDeliveryStoreError("message-persist-unavailable"),
    );

    const client = clientWith(sentMessageId);
    const store = new SupabaseEmotionFollowupDeliveryStore(client as never);
    await expect(
      store.persistMessage({
        followupId: "invalid",
        claimToken,
        content: "合成消息",
        now,
      }),
    ).rejects.toEqual(
      new EmotionFollowupDeliveryStoreError("message-persist-unavailable"),
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
