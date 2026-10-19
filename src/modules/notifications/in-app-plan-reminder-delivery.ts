import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { uuidSchema } from "@/server/schemas";

import type {
  PlanReminderDelivery,
  PlanReminderDeliveryInput,
} from "./plan-reminder-worker";

export class InAppPlanReminderDeliveryError extends Error {
  constructor() {
    super("in-app-delivery-unavailable");
    this.name = "InAppPlanReminderDeliveryError";
  }
}

/**
 * Records the owned plan reminder through the service-only database function.
 * This is an in-app fallback only: it does not send Web Push or contact an
 * external scheduler.
 */
export class SupabaseInAppPlanReminderDelivery implements PlanReminderDelivery {
  constructor(private readonly supabase: SupabaseClient) {}

  async deliver(input: PlanReminderDeliveryInput): Promise<void> {
    if (
      !uuidSchema.safeParse(input.jobId).success ||
      !uuidSchema.safeParse(input.userId).success ||
      !uuidSchema.safeParse(input.planId).success ||
      !uuidSchema.safeParse(input.claimToken).success ||
      !Number.isFinite(Date.parse(input.scheduledFor)) ||
      !Number.isFinite(input.deliveredAt.getTime())
    ) {
      throw new InAppPlanReminderDeliveryError();
    }

    const { data, error } = await this.supabase.rpc("deliver_in_app_plan_reminder", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_now: input.deliveredAt.toISOString(),
    });

    if (error || !uuidSchema.safeParse(data).success) {
      throw new InAppPlanReminderDeliveryError();
    }
  }
}
