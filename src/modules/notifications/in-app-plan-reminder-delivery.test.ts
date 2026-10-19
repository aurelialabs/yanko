import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  InAppPlanReminderDeliveryError,
  SupabaseInAppPlanReminderDelivery,
} from "./in-app-plan-reminder-delivery";

const input = {
  jobId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000002",
  planId: "30000000-0000-4000-8000-000000000003",
  claimToken: "40000000-0000-4000-8000-000000000004",
  scheduledFor: "2026-09-07T02:00:00.000Z",
  deliveredAt: new Date("2026-09-07T02:00:01.000Z"),
};

describe("SupabaseInAppPlanReminderDelivery", () => {
  it("uses only the service-only delivery function and the worker timestamp", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: "50000000-0000-4000-8000-000000000005",
      error: null,
    });
    const delivery = new SupabaseInAppPlanReminderDelivery({
      rpc,
    } as unknown as SupabaseClient);

    await expect(delivery.deliver(input)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("deliver_in_app_plan_reminder", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_now: input.deliveredAt.toISOString(),
    });
  });

  it.each([
    { ...input, jobId: "invalid" },
    { ...input, claimToken: "invalid" },
    { ...input, scheduledFor: "invalid" },
    { ...input, deliveredAt: new Date("invalid") },
  ])("rejects malformed worker input before writing", async (malformed) => {
    const rpc = vi.fn();
    const delivery = new SupabaseInAppPlanReminderDelivery({
      rpc,
    } as unknown as SupabaseClient);

    await expect(delivery.deliver(malformed)).rejects.toEqual(
      new InAppPlanReminderDeliveryError(),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: "database internals" } },
    { data: "not-a-uuid", error: null },
  ])("maps database failures to one stable internal error", async (result) => {
    const delivery = new SupabaseInAppPlanReminderDelivery({
      rpc: vi.fn().mockResolvedValue(result),
    } as unknown as SupabaseClient);

    await expect(delivery.deliver(input)).rejects.toEqual(
      new InAppPlanReminderDeliveryError(),
    );
  });
});
