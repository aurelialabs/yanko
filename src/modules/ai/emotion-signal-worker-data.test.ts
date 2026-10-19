import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EmotionSignalJobStoreError,
  SupabaseEmotionSignalJobStore,
} from "./emotion-signal-worker-data";

const jobId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const roleId = "30000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000004";
const claimToken = "50000000-0000-4000-8000-000000000005";
const now = new Date("2026-09-08T02:00:00.000Z");

const rpc = vi.fn();
const store = new SupabaseEmotionSignalJobStore({ rpc } as never);

const claimRow = {
  job_id: jobId,
  user_id: userId,
  role_id: roleId,
  source_message_id: messageId,
  claim_token: claimToken,
  idempotency_key: "emotion-signal-job-001",
  attempt_no: 1,
  lease_expires_at: "2026-09-08T02:05:00.000Z",
};

describe("SupabaseEmotionSignalJobStore", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("claims only the supplied event job ID", async () => {
    rpc.mockResolvedValue({ data: [claimRow], error: null });

    await expect(
      store.claimOne({ jobId, now, leaseSeconds: 300 }),
    ).resolves.toMatchObject({
      jobId,
      userId,
      roleId,
      sourceMessageId: messageId,
      attemptNo: 1,
    });
    expect(rpc).toHaveBeenCalledWith("claim_emotion_signal_job", {
      p_job_id: jobId,
      p_now: now.toISOString(),
      p_lease_seconds: 300,
    });
  });

  it("returns null for a valid empty exact claim and rejects malformed rows", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(store.claimOne({ jobId, now, leaseSeconds: 300 })).resolves.toBeNull();

    rpc.mockResolvedValueOnce({ data: [{ ...claimRow, job_id: roleId }], error: null });
    await expect(store.claimOne({ jobId, now, leaseSeconds: 300 })).rejects.toEqual(
      new EmotionSignalJobStoreError("claim-unavailable"),
    );
  });

  it("completes with the lease token and exposes only validated queue state", async () => {
    rpc.mockResolvedValue({
      data: {
        jobId,
        status: "succeeded",
        attemptCount: 1,
        availableAt: now.toISOString(),
      },
      error: null,
    });

    await expect(
      store.complete({
        jobId,
        claimToken,
        outcome: "succeeded",
        errorCode: null,
        now,
      }),
    ).resolves.toEqual({
      jobId,
      status: "succeeded",
      attemptCount: 1,
      availableAt: now.toISOString(),
    });
    expect(rpc).toHaveBeenCalledWith("complete_emotion_signal_job", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_outcome: "succeeded",
      p_error_code: null,
      p_now: now.toISOString(),
    });
  });

  it("fails closed when an RPC error or untrusted completion shape is returned", async () => {
    rpc.mockResolvedValue({
      data: {
        jobId,
        status: "running",
        attemptCount: 1,
        availableAt: now.toISOString(),
      },
      error: null,
    });
    await expect(
      store.complete({
        jobId,
        claimToken,
        outcome: "succeeded",
        errorCode: null,
        now,
      }),
    ).rejects.toEqual(new EmotionSignalJobStoreError("completion-unavailable"));
  });
});
