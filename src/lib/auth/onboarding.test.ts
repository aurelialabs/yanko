import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerSupabaseClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));

import { hasCompletedOnboarding } from "./onboarding";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "20000000-0000-4000-8000-000000000002";

function user(id = userId, metadata: User["user_metadata"] = {}): User {
  return { id, user_metadata: metadata } as User;
}

function historyResult(data: unknown = [], error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const client = { from: vi.fn().mockReturnValue(query) };
  createServerSupabaseClient.mockResolvedValue(client);
  return { client, query };
}

describe("hasCompletedOnboarding", () => {
  beforeEach(() => {
    createServerSupabaseClient.mockReset();
  });

  it("accepts an explicit boolean completion flag without reading history", async () => {
    await expect(
      hasCompletedOnboarding(user(userId, { yanko_onboarding_completed: true })),
    ).resolves.toBe(true);
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it.each([undefined, false, null, "true", 1])(
    "does not treat metadata value %s as completed without history",
    async (value) => {
      historyResult();
      await expect(
        hasCompletedOnboarding(user(userId, { yanko_onboarding_completed: value })),
      ).resolves.toBe(false);
      expect(createServerSupabaseClient).toHaveBeenCalledOnce();
    },
  );

  it("recognizes legacy users with an owner-scoped, minimal history query", async () => {
    const { client, query } = historyResult([{ id: "existing-message" }]);

    await expect(hasCompletedOnboarding(user())).resolves.toBe(true);
    expect(client.from).toHaveBeenCalledWith("messages");
    expect(query.select).toHaveBeenCalledWith("id");
    expect(query.eq).toHaveBeenCalledWith("user_id", userId);
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("falls back to incomplete when Supabase is unconfigured", async () => {
    createServerSupabaseClient.mockResolvedValue(null);
    await expect(hasCompletedOnboarding(user())).resolves.toBe(false);
  });

  it.each([null, []])("treats absent history %s as incomplete", async (data) => {
    historyResult(data);
    await expect(hasCompletedOnboarding(user())).resolves.toBe(false);
  });

  it("does not trust history returned alongside a database error", async () => {
    historyResult([{ id: "existing-message" }], { message: "private details" });
    await expect(hasCompletedOnboarding(user())).resolves.toBe(false);
  });

  it("returns incomplete when the history query rejects", async () => {
    const { query } = historyResult();
    query.limit.mockRejectedValue(new Error("network unavailable"));
    await expect(hasCompletedOnboarding(user())).resolves.toBe(false);
  });

  it("returns incomplete when creating the client rejects", async () => {
    createServerSupabaseClient.mockRejectedValue(new Error("cookies unavailable"));
    await expect(hasCompletedOnboarding(user())).resolves.toBe(false);
  });

  it("does not share completion metadata between users", async () => {
    historyResult();

    await expect(
      hasCompletedOnboarding(user(userId, { yanko_onboarding_completed: true })),
    ).resolves.toBe(true);
    await expect(hasCompletedOnboarding(user(otherUserId))).resolves.toBe(false);
    expect(createServerSupabaseClient).toHaveBeenCalledOnce();
  });

  it("does not reuse one user's chat history for another user", async () => {
    const first = historyResult([{ id: "existing-message" }]);
    const second = historyResult();
    createServerSupabaseClient
      .mockReset()
      .mockResolvedValueOnce(first.client)
      .mockResolvedValueOnce(second.client);

    await expect(hasCompletedOnboarding(user())).resolves.toBe(true);
    await expect(hasCompletedOnboarding(user(otherUserId))).resolves.toBe(false);
    expect(first.query.eq).toHaveBeenCalledWith("user_id", userId);
    expect(second.query.eq).toHaveBeenCalledWith("user_id", otherUserId);
  });
});
