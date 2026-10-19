import { describe, expect, it, vi } from "vitest";

import {
  EmotionFollowupWorkerError,
  createEmotionFollowupDeliverer,
  isEmotionFollowupDeliveryWorkerEnabled,
  persistEmotionFollowupMessage,
  processEmotionFollowupDelivery,
  runConfiguredEmotionFollowupDeliveryWorker,
} from "./emotion-followup-worker";
import type {
  ClaimedEmotionFollowup,
  EmotionFollowupDeliveryStore,
} from "./emotion-followup-worker-data";

const now = new Date("2026-09-08T02:00:00.000Z");
const claim: ClaimedEmotionFollowup = {
  followupId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000002",
  roleId: "30000000-0000-4000-8000-000000000003",
  sourceMessageId: "40000000-0000-4000-8000-000000000004",
  claimToken: "50000000-0000-4000-8000-000000000005",
  leaseExpiresAt: "2026-09-08T02:05:00.000Z",
};
const sentMessageId = "60000000-0000-4000-8000-000000000006";

function storeWith(status: "succeeded" | "failed" | "cancelled") {
  const store: EmotionFollowupDeliveryStore = {
    claimOne: vi.fn().mockResolvedValue(claim),
    persistMessage: vi.fn(),
    complete: vi.fn().mockResolvedValue({
      followupId: claim.followupId,
      status,
      sentMessageId: status === "succeeded" ? sentMessageId : null,
    }),
  };
  return store;
}

describe("emotion follow-up exact delivery worker", () => {
  it("persists generated content through the current claim without completing it", async () => {
    const store = storeWith("succeeded");
    vi.mocked(store.persistMessage).mockResolvedValue(sentMessageId);

    await expect(
      persistEmotionFollowupMessage({
        claim,
        content: "合成的回访消息",
        now,
        store,
      }),
    ).resolves.toEqual({
      type: "persisted",
      followupId: claim.followupId,
      sentMessageId,
    });
    expect(store.persistMessage).toHaveBeenCalledWith({
      followupId: claim.followupId,
      claimToken: claim.claimToken,
      content: "合成的回访消息",
      now,
    });
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("composes an injected generator with controlled persistence and returns only the bound ID", async () => {
    const store = storeWith("succeeded");
    vi.mocked(store.persistMessage).mockResolvedValue(sentMessageId);
    const generate = vi.fn().mockResolvedValue("组合根生成的合成回访消息");
    const deliver = createEmotionFollowupDeliverer({ store, generate });

    await expect(
      deliver({
        followupId: claim.followupId,
        userId: claim.userId,
        roleId: claim.roleId,
        sourceMessageId: claim.sourceMessageId,
        claimToken: claim.claimToken,
        now,
      }),
    ).resolves.toEqual({ outcome: "succeeded", sentMessageId });
    expect(generate).toHaveBeenCalledWith({
      followupId: claim.followupId,
      userId: claim.userId,
      roleId: claim.roleId,
      sourceMessageId: claim.sourceMessageId,
      claimToken: claim.claimToken,
      now,
    });
    expect(store.persistMessage).toHaveBeenCalledWith({
      followupId: claim.followupId,
      claimToken: claim.claimToken,
      content: "组合根生成的合成回访消息",
      now,
    });
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("fails closed when generation throws or persistence cannot bind a message", async () => {
    const generationStore = storeWith("succeeded");
    const generationFailure = createEmotionFollowupDeliverer({
      store: generationStore,
      generate: vi.fn().mockRejectedValue(new Error("private generation detail")),
    });
    await expect(
      generationFailure({
        followupId: claim.followupId,
        userId: claim.userId,
        roleId: claim.roleId,
        sourceMessageId: claim.sourceMessageId,
        claimToken: claim.claimToken,
        now,
      }),
    ).resolves.toEqual({
      outcome: "permanent_failure",
      errorCode: "delivery_unavailable",
    });
    expect(generationStore.persistMessage).not.toHaveBeenCalled();

    const persistenceStore = storeWith("succeeded");
    vi.mocked(persistenceStore.persistMessage).mockResolvedValue(null);
    const persistenceFailure = createEmotionFollowupDeliverer({
      store: persistenceStore,
      generate: vi.fn().mockResolvedValue("无法绑定的合成回访消息"),
    });
    await expect(
      persistenceFailure({
        followupId: claim.followupId,
        userId: claim.userId,
        roleId: claim.roleId,
        sourceMessageId: claim.sourceMessageId,
        claimToken: claim.claimToken,
        now,
      }),
    ).resolves.toEqual({
      outcome: "permanent_failure",
      errorCode: "delivery_unavailable",
    });
  });

  it("maps null, malformed IDs, and storage errors to one safe unavailable result", async () => {
    const nullStore = storeWith("succeeded");
    vi.mocked(nullStore.persistMessage).mockResolvedValue(null);
    await expect(
      persistEmotionFollowupMessage({
        claim,
        content: "租约已失效",
        now,
        store: nullStore,
      }),
    ).resolves.toEqual({
      type: "unavailable",
      followupId: claim.followupId,
      errorCode: "delivery_unavailable",
    });

    const malformedStore = storeWith("succeeded");
    vi.mocked(malformedStore.persistMessage).mockResolvedValue("invalid");
    await expect(
      persistEmotionFollowupMessage({
        claim,
        content: "畸形结果",
        now,
        store: malformedStore,
      }),
    ).resolves.toMatchObject({ type: "unavailable" });

    const failingStore = storeWith("succeeded");
    vi.mocked(failingStore.persistMessage).mockRejectedValue(
      new Error("private storage detail"),
    );
    await expect(
      persistEmotionFollowupMessage({
        claim,
        content: "存储失败",
        now,
        store: failingStore,
      }),
    ).resolves.toEqual({
      type: "unavailable",
      followupId: claim.followupId,
      errorCode: "delivery_unavailable",
    });
  });

  it("is default-off before any database access or injected delivery callback", async () => {
    const store = storeWith("succeeded");
    const deliver = vi.fn();
    await expect(
      runConfiguredEmotionFollowupDeliveryWorker({
        store,
        deliver,
        followupId: "invalid",
      }),
    ).resolves.toEqual({ type: "disabled", claimedCount: 0, outcomes: [] });
    expect(store.claimOne).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(
      isEmotionFollowupDeliveryWorkerEnabled({
        EMOTION_FOLLOWUP_DELIVERY_ENABLED: " TRUE ",
      }),
    ).toBe(true);
  });

  it("passes only identifiers and an opaque token to an explicitly injected delivery boundary", async () => {
    const store = storeWith("succeeded");
    const deliver = vi.fn().mockResolvedValue({ outcome: "succeeded", sentMessageId });

    await expect(
      runConfiguredEmotionFollowupDeliveryWorker({
        enabled: true,
        store,
        deliver,
        followupId: claim.followupId,
        now,
      }),
    ).resolves.toEqual({
      type: "processed",
      claimedCount: 1,
      outcomes: [{ type: "succeeded", followupId: claim.followupId, sentMessageId }],
    });
    expect(store.claimOne).toHaveBeenCalledWith({
      followupId: claim.followupId,
      now,
      leaseSeconds: 300,
    });
    expect(deliver).toHaveBeenCalledWith({
      followupId: claim.followupId,
      userId: claim.userId,
      roleId: claim.roleId,
      sourceMessageId: claim.sourceMessageId,
      claimToken: claim.claimToken,
      now,
    });
    expect(store.complete).toHaveBeenCalledWith({
      followupId: claim.followupId,
      claimToken: claim.claimToken,
      outcome: "succeeded",
      sentMessageId,
      errorCode: null,
      now,
    });
  });

  it("records only a fixed permanent failure code when delivery throws", async () => {
    const store = storeWith("failed");
    const deliver = vi
      .fn()
      .mockRejectedValue(new Error("private provider and user text"));

    await expect(
      processEmotionFollowupDelivery({ claim, now, store, deliver }),
    ).resolves.toEqual({
      type: "failed",
      followupId: claim.followupId,
      errorCode: "delivery_unavailable",
    });
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "permanent_failure",
        sentMessageId: null,
        errorCode: "delivery_unavailable",
      }),
    );
  });

  it("validates exact IDs and requires an explicit delivery boundary before claiming", async () => {
    const store = storeWith("succeeded");
    await expect(
      runConfiguredEmotionFollowupDeliveryWorker({
        enabled: true,
        store,
        deliver: async () => ({ outcome: "succeeded", sentMessageId }),
        followupId: "invalid",
      }),
    ).rejects.toEqual(new EmotionFollowupWorkerError("invalid-worker-input"));
    await expect(
      runConfiguredEmotionFollowupDeliveryWorker({
        enabled: true,
        store,
        followupId: claim.followupId,
      }),
    ).rejects.toEqual(
      new EmotionFollowupWorkerError("worker-configuration-unavailable"),
    );
    expect(store.claimOne).not.toHaveBeenCalled();
  });
});
