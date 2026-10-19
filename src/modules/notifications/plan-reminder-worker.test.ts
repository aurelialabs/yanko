import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  dispatchPlanReminderJob,
  PlanReminderWorkerError,
  SupabasePlanReminderJobStore,
  type ClaimedPlanReminderJob,
  type PlanReminderJobCompletion,
  type PlanReminderJobStore,
} from "./plan-reminder-worker";

const now = new Date("2026-09-02T07:00:01.000Z");
const job: ClaimedPlanReminderJob = {
  jobId: "bc2a5788-030e-4a78-8a84-3f2591e7bffc",
  userId: "0c9f4ac8-1aed-4c10-8b3a-2d527c2de6a7",
  planId: "45e5875b-75a4-4c2b-a4e0-58e5d5f32532",
  scheduledFor: "2026-09-02T07:00:00.000Z",
  claimToken: "3c99f3d2-1023-4dd5-a8be-4d43043b809f",
  attemptNo: 1,
  leaseExpiresAt: "2026-09-02T07:05:01.000Z",
  status: "running",
};
const plan = {
  id: job.planId,
  userId: job.userId,
  scope: "day" as const,
  status: "active" as const,
  reminderAt: job.scheduledFor,
};

function completion(
  status: PlanReminderJobCompletion["status"],
): PlanReminderJobCompletion {
  return {
    jobId: job.jobId,
    status,
    attemptCount: job.attemptNo,
    availableAt: job.scheduledFor,
  };
}

function store(overrides: Partial<PlanReminderJobStore> = {}): PlanReminderJobStore {
  return {
    claimDue: vi.fn().mockResolvedValue(job),
    readPlan: vi.fn().mockResolvedValue(plan),
    complete: vi.fn().mockResolvedValue(completion("succeeded")),
    ...overrides,
  };
}

describe("dispatchPlanReminderJob", () => {
  it("claims only the requested job with a bounded lease", async () => {
    const jobStore = store({ claimDue: vi.fn().mockResolvedValue(null) });
    const delivery = { deliver: vi.fn() };

    await expect(
      dispatchPlanReminderJob({
        jobId: job.jobId,
        now,
        leaseSeconds: 120,
        store: jobStore,
        delivery,
      }),
    ).resolves.toEqual({ type: "not_claimed" });
    expect(jobStore.claimDue).toHaveBeenCalledWith(job.jobId, now, 120);
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(jobStore.complete).not.toHaveBeenCalled();
  });

  it("delivers only after the current active daily plan passes the recheck", async () => {
    const jobStore = store();
    const delivery = { deliver: vi.fn().mockResolvedValue(undefined) };

    await expect(
      dispatchPlanReminderJob({ jobId: job.jobId, now, store: jobStore, delivery }),
    ).resolves.toEqual({ type: "delivered", finalStatus: "succeeded" });
    expect(delivery.deliver).toHaveBeenCalledWith({
      jobId: job.jobId,
      userId: job.userId,
      planId: job.planId,
      scheduledFor: job.scheduledFor,
      claimToken: job.claimToken,
      deliveredAt: now,
    });
    expect(jobStore.complete).toHaveBeenCalledWith({
      jobId: job.jobId,
      claimToken: job.claimToken,
      outcome: "succeeded",
      errorCode: null,
      now,
    });
  });

  it("suppresses a changed or completed plan without delivery", async () => {
    const jobStore = store({
      readPlan: vi.fn().mockResolvedValue({ ...plan, status: "completed" }),
      complete: vi.fn().mockResolvedValue(completion("cancelled")),
    });
    const delivery = { deliver: vi.fn() };

    await expect(
      dispatchPlanReminderJob({ jobId: job.jobId, now, store: jobStore, delivery }),
    ).resolves.toEqual({
      type: "suppressed",
      reason: "plan_not_active_day",
      finalStatus: "cancelled",
    });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(jobStore.complete).toHaveBeenCalledWith({
      jobId: job.jobId,
      claimToken: job.claimToken,
      outcome: "cancelled",
      errorCode: "pre_send_plan_not_active_day",
      now,
    });
  });

  it("reschedules a context query failure without exposing its cause", async () => {
    const jobStore = store({
      readPlan: vi.fn().mockRejectedValue(new Error("database host and details")),
      complete: vi.fn().mockResolvedValue(completion("scheduled")),
    });

    await expect(
      dispatchPlanReminderJob({
        jobId: job.jobId,
        now,
        store: jobStore,
        delivery: { deliver: vi.fn() },
      }),
    ).resolves.toEqual({ type: "delivery_failed", finalStatus: "scheduled" });
    expect(jobStore.complete).toHaveBeenCalledWith({
      jobId: job.jobId,
      claimToken: job.claimToken,
      outcome: "retryable_failure",
      errorCode: "context_unavailable",
      now,
    });
  });

  it.each(["scheduled", "failed"] as const)(
    "records an unavailable delivery as %s and never reports it as sent",
    async (finalStatus) => {
      const jobStore = store({
        complete: vi.fn().mockResolvedValue(completion(finalStatus)),
      });
      const delivery = {
        deliver: vi.fn().mockRejectedValue(new Error("provider secret details")),
      };

      await expect(
        dispatchPlanReminderJob({ jobId: job.jobId, now, store: jobStore, delivery }),
      ).resolves.toEqual({ type: "delivery_failed", finalStatus });
      expect(jobStore.complete).toHaveBeenCalledWith({
        jobId: job.jobId,
        claimToken: job.claimToken,
        outcome: "retryable_failure",
        errorCode: "delivery_unavailable",
        now,
      });
    },
  );

  it("fails closed when a stale claim cannot be completed", async () => {
    const jobStore = store({
      complete: vi.fn().mockRejectedValue(new Error("stale claim")),
    });

    await expect(
      dispatchPlanReminderJob({
        jobId: job.jobId,
        now,
        store: jobStore,
        delivery: { deliver: vi.fn().mockResolvedValue(undefined) },
      }),
    ).rejects.toEqual(new PlanReminderWorkerError("job-completion-unavailable"));
  });

  it("fails closed when completion returns an impossible delivered status", async () => {
    const jobStore = store({
      complete: vi.fn().mockResolvedValue(completion("failed")),
    });

    await expect(
      dispatchPlanReminderJob({
        jobId: job.jobId,
        now,
        store: jobStore,
        delivery: { deliver: vi.fn().mockResolvedValue(undefined) },
      }),
    ).rejects.toEqual(new PlanReminderWorkerError("job-completion-unavailable"));
  });

  it("fails closed when retry completion returns an impossible status", async () => {
    const jobStore = store({
      complete: vi.fn().mockResolvedValue(completion("succeeded")),
    });

    await expect(
      dispatchPlanReminderJob({
        jobId: job.jobId,
        now,
        store: jobStore,
        delivery: { deliver: vi.fn().mockRejectedValue(new Error("unavailable")) },
      }),
    ).rejects.toEqual(new PlanReminderWorkerError("job-completion-unavailable"));
  });

  it.each([
    ["not-a-uuid", now, 300],
    [job.jobId, new Date("invalid"), 300],
    [job.jobId, now, 29],
    [job.jobId, now, 901],
  ])(
    "rejects invalid worker input before querying the database",
    async (id, at, lease) => {
      const jobStore = store();

      await expect(
        dispatchPlanReminderJob({
          jobId: id as string,
          now: at as Date,
          leaseSeconds: lease as number,
          store: jobStore,
          delivery: { deliver: vi.fn() },
        }),
      ).rejects.toEqual(new PlanReminderWorkerError("invalid-worker-input"));
      expect(jobStore.claimDue).not.toHaveBeenCalled();
    },
  );
});

describe("SupabasePlanReminderJobStore", () => {
  it("maps an exact valid database claim without exposing extra fields", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          job_id: job.jobId,
          user_id: job.userId,
          plan_id: job.planId,
          scheduled_for: job.scheduledFor,
          claim_token: job.claimToken,
          attempt_no: job.attemptNo,
          lease_expires_at: job.leaseExpiresAt,
          internal_error: "must-not-cross-adapter",
        },
      ],
      error: null,
    });
    const adapter = new SupabasePlanReminderJobStore({
      rpc,
    } as unknown as SupabaseClient);

    await expect(adapter.claimDue(job.jobId, now, 300)).resolves.toEqual(job);
    expect(rpc).toHaveBeenCalledWith("claim_due_notification_job", {
      p_job_id: job.jobId,
      p_now: now.toISOString(),
      p_lease_seconds: 300,
    });
  });

  it.each([
    [
      {
        job_id: "not-a-uuid",
        user_id: job.userId,
        plan_id: job.planId,
        scheduled_for: job.scheduledFor,
        claim_token: job.claimToken,
        attempt_no: 1,
        lease_expires_at: job.leaseExpiresAt,
      },
    ],
    [
      {
        job_id: job.jobId,
        user_id: job.userId,
        plan_id: job.planId,
        scheduled_for: job.scheduledFor,
        claim_token: job.claimToken,
        attempt_no: 1,
        lease_expires_at: now.toISOString(),
      },
    ],
    [{ job_id: job.jobId, user_id: job.userId, plan_id: job.planId }],
    [
      {
        job_id: job.jobId,
        user_id: job.userId,
        plan_id: job.planId,
        scheduled_for: job.scheduledFor,
        claim_token: "not-a-token",
        attempt_no: 1,
        lease_expires_at: job.leaseExpiresAt,
      },
    ],
  ])("fails closed on a malformed claim row", async (row) => {
    const adapter = new SupabasePlanReminderJobStore({
      rpc: vi.fn().mockResolvedValue({ data: [row], error: null }),
    } as unknown as SupabaseClient);

    await expect(adapter.claimDue(job.jobId, now, 300)).rejects.toEqual(
      new PlanReminderWorkerError("job-claim-unavailable"),
    );
  });

  it("fails closed on a malformed completion payload", async () => {
    const adapter = new SupabasePlanReminderJobStore({
      rpc: vi.fn().mockResolvedValue({
        data: { jobId: job.jobId, status: "running", attemptCount: 1 },
        error: null,
      }),
    } as unknown as SupabaseClient);

    await expect(
      adapter.complete({
        jobId: job.jobId,
        claimToken: job.claimToken,
        outcome: "succeeded",
        errorCode: null,
        now,
      }),
    ).rejects.toEqual(new PlanReminderWorkerError("job-completion-unavailable"));
  });
});
