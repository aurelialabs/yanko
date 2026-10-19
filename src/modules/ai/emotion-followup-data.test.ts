import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: () => ({ rpc }),
}));

import { scheduleStrongNegativeEmotionFollowup } from "./emotion-followup-data";

const input = {
  userId: "10000000-0000-4000-8000-000000000001",
  roleId: "20000000-0000-4000-8000-000000000002",
  sourceMessageId: "30000000-0000-4000-8000-000000000003",
  emotionType: "overwhelm" as const,
  intensity: 0.91,
  idempotencyKey: "emotion-followup-request-001",
};

describe("scheduleStrongNegativeEmotionFollowup", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: [
        {
          followup_id: "40000000-0000-4000-8000-000000000004",
          status: "scheduled",
          scheduled_for: "2026-09-09T02:00:00.000Z",
        },
      ],
      error: null,
    });
  });

  it("sends only normalized identifiers and signal metadata to the guarded RPC", async () => {
    await expect(scheduleStrongNegativeEmotionFollowup(input)).resolves.toEqual({
      followupId: "40000000-0000-4000-8000-000000000004",
      status: "scheduled",
      scheduledFor: "2026-09-09T02:00:00.000Z",
    });

    expect(rpc).toHaveBeenCalledWith("schedule_strong_negative_emotion_followup", {
      p_user_id: input.userId,
      p_role_id: input.roleId,
      p_source_message_id: input.sourceMessageId,
      p_emotion_type: "overwhelm",
      p_intensity: 0.91,
      p_idempotency_key: input.idempotencyKey,
    });
  });

  it("fails closed before storage for invalid intensity or idempotency input", async () => {
    await expect(
      scheduleStrongNegativeEmotionFollowup({ ...input, intensity: 0.79 }),
    ).resolves.toBeNull();
    await expect(
      scheduleStrongNegativeEmotionFollowup({ ...input, idempotencyKey: "short" }),
    ).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not expose storage details when persistence returns malformed data", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private detail" } });
    await expect(scheduleStrongNegativeEmotionFollowup(input)).resolves.toBeNull();
  });
});
