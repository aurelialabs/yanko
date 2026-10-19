import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  PlanExtractionJobStoreError,
  SupabasePlanExtractionJobStore,
} from "./plan-extraction-worker-data";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  message: "00000000-0000-4000-8000-000000000003",
  job: "00000000-0000-4000-8000-000000000004",
  claim: "00000000-0000-4000-8000-000000000005",
  run: "00000000-0000-4000-8000-000000000006",
};
const now = new Date("2026-09-07T10:00:00.000Z");

function clientWith(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    store: new SupabasePlanExtractionJobStore({ rpc } as unknown as SupabaseClient),
  };
}

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    job_id: ids.job,
    user_id: ids.user,
    role_id: ids.role,
    source_message_id: ids.message,
    claim_token: ids.claim,
    idempotency_key: `plan-extraction-job:${ids.message}`,
    attempt_no: 1,
    lease_expires_at: "2026-09-07T10:05:00.000Z",
    ...overrides,
  };
}

describe("SupabasePlanExtractionJobStore", () => {
  it("claims only the exact requested job and parses the strict row", async () => {
    const { rpc, store } = clientWith([claimRow()]);
    await expect(
      store.claimOne({ jobId: ids.job, now, leaseSeconds: 120 }),
    ).resolves.toMatchObject({ jobId: ids.job, attemptNo: 1 });
    expect(rpc).toHaveBeenCalledWith("claim_plan_extraction_job", {
      p_job_id: ids.job,
      p_now: now.toISOString(),
      p_lease_seconds: 120,
    });
  });

  it("returns null when the exact job is not eligible", async () => {
    const { store } = clientWith([]);
    await expect(
      store.claimOne({ jobId: ids.job, now, leaseSeconds: 120 }),
    ).resolves.toBeNull();
  });

  it.each([
    ["multiple rows", [claimRow(), claimRow()]],
    ["wrong id", [claimRow({ job_id: ids.user })]],
    ["invalid token", [claimRow({ claim_token: "private-error" })]],
    ["invalid attempt", [claimRow({ attempt_no: 6 })]],
    ["invalid lease", [claimRow({ lease_expires_at: "later" })]],
  ])("fails closed for an invalid claim shape: %s", async (_label, data) => {
    const { store } = clientWith(data);
    await expect(
      store.claimOne({ jobId: ids.job, now, leaseSeconds: 120 }),
    ).rejects.toEqual(new PlanExtractionJobStoreError("claim-unavailable"));
  });

  it("completes with safe fields and validates the response", async () => {
    const { rpc, store } = clientWith({
      jobId: ids.job,
      status: "succeeded",
      attemptCount: 1,
      availableAt: now.toISOString(),
    });
    await expect(
      store.complete({
        jobId: ids.job,
        claimToken: ids.claim,
        outcome: "succeeded",
        errorCode: null,
        extractionRunId: ids.run,
        now,
      }),
    ).resolves.toMatchObject({ jobId: ids.job, status: "succeeded" });
    expect(rpc).toHaveBeenCalledWith("complete_plan_extraction_job", {
      p_job_id: ids.job,
      p_claim_token: ids.claim,
      p_outcome: "succeeded",
      p_error_code: null,
      p_extraction_run_id: ids.run,
      p_now: now.toISOString(),
    });
  });

  it("maps database errors and impossible completion states to stable errors", async () => {
    const failed = clientWith(null, { message: "private database detail" }).store;
    await expect(
      failed.claimOne({ jobId: ids.job, now, leaseSeconds: 120 }),
    ).rejects.toMatchObject({ code: "claim-unavailable" });

    const invalid = clientWith({
      jobId: ids.user,
      status: "running",
      attemptCount: 0,
      availableAt: "invalid",
    }).store;
    await expect(
      invalid.complete({
        jobId: ids.job,
        claimToken: ids.claim,
        outcome: "retryable_failure",
        errorCode: "classifier_unavailable",
        extractionRunId: null,
        now,
      }),
    ).rejects.toEqual(new PlanExtractionJobStoreError("completion-unavailable"));
  });
});
