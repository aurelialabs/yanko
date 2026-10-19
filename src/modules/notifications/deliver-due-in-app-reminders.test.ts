import { describe, expect, it, vi } from "vitest";

import { deliverDueInAppPlanReminders } from "./deliver-due-in-app-reminders";

const userId = "00000000-0000-4000-8000-000000000001";
const firstJobId = "00000000-0000-4000-8000-000000000021";
const secondJobId = "00000000-0000-4000-8000-000000000022";
const now = new Date("2026-10-16T06:00:00.000Z");

describe("deliverDueInAppPlanReminders", () => {
  it("does nothing for an invalid account", async () => {
    const listDueJobIds = vi.fn();
    const result = await deliverDueInAppPlanReminders(
      { userId: "not-a-user", now },
      { listDueJobIds },
    );

    expect(result).toEqual({ delivered: 0 });
    expect(listDueJobIds).not.toHaveBeenCalled();
  });

  it("delivers each due reminder and continues after one failure", async () => {
    const deliverJob = vi.fn(async (jobId: string) => {
      if (jobId === firstJobId) throw new Error("delivery down");
    });

    const result = await deliverDueInAppPlanReminders(
      { userId, now },
      {
        listDueJobIds: async () => [firstJobId, secondJobId],
        deliverJob,
      },
    );

    expect(result).toEqual({ delivered: 1 });
    expect(deliverJob).toHaveBeenCalledTimes(2);
    expect(deliverJob).toHaveBeenNthCalledWith(1, firstJobId, now);
    expect(deliverJob).toHaveBeenNthCalledWith(2, secondJobId, now);
  });
});
