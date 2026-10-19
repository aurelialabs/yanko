import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthContext = vi.hoisted(() => vi.fn());
const createServerSupabaseClient = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ getAuthContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { markInAppNotificationRead } from "./actions";

const notificationId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const initialState = { message: "", succeeded: false };

function validFormData(read = "true"): FormData {
  const formData = new FormData();
  formData.set("notificationId", notificationId);
  formData.set("read", read);
  return formData;
}

function supabaseResult(input?: {
  owned?: boolean;
  ownershipError?: unknown;
  rpcError?: unknown;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: input?.owned === false ? null : { id: notificationId },
    error: input?.ownershipError ?? null,
  });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const rpc = vi.fn().mockResolvedValue({
    data: input?.rpcError ? null : notificationId,
    error: input?.rpcError ?? null,
  });
  return {
    client: { from: vi.fn().mockReturnValue(query), rpc },
    query,
    rpc,
  };
}

describe("markInAppNotificationRead", () => {
  beforeEach(() => {
    getAuthContext.mockReset();
    createServerSupabaseClient.mockReset();
    revalidatePath.mockReset();
    getAuthContext.mockResolvedValue({
      configured: true,
      user: { id: userId },
    });
  });

  it("rejects malformed input before authentication or database access", async () => {
    const formData = validFormData("yes");

    await expect(markInAppNotificationRead(initialState, formData)).resolves.toEqual({
      message: "提醒信息无效，请刷新后重试。",
    });
    expect(getAuthContext).not.toHaveBeenCalled();
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("requires a current authenticated user on every request", async () => {
    getAuthContext.mockResolvedValue({ configured: true, user: null });

    await expect(
      markInAppNotificationRead(initialState, validFormData()),
    ).resolves.toEqual({ message: "登录状态已失效，请重新登录。" });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rechecks ownership before calling the controlled read-state function", async () => {
    const database = supabaseResult({ owned: false });
    createServerSupabaseClient.mockResolvedValue(database.client);

    await expect(
      markInAppNotificationRead(initialState, validFormData()),
    ).resolves.toEqual({ message: "这条提醒已发生变化，请刷新后重试。" });
    expect(database.query.eq).toHaveBeenNthCalledWith(1, "id", notificationId);
    expect(database.query.eq).toHaveBeenNthCalledWith(2, "user_id", userId);
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it("uses server time and refreshes only reminder views after success", async () => {
    const database = supabaseResult();
    createServerSupabaseClient.mockResolvedValue(database.client);

    await expect(
      markInAppNotificationRead(initialState, validFormData("false")),
    ).resolves.toEqual({ message: "", succeeded: true });
    expect(database.rpc).toHaveBeenCalledWith("mark_in_app_notification_read", {
      p_notification_id: notificationId,
      p_read: false,
      p_now: expect.any(String),
    });
    const rpcInput = database.rpc.mock.calls[0]?.[1] as { p_now: string };
    expect(Number.isFinite(Date.parse(rpcInput.p_now))).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/me");
    expect(revalidatePath).toHaveBeenCalledWith("/me/notifications");
  });

  it("does not expose database errors to the client", async () => {
    const database = supabaseResult({ rpcError: { message: "private details" } });
    createServerSupabaseClient.mockResolvedValue(database.client);

    const result = await markInAppNotificationRead(initialState, validFormData());
    expect(result).toEqual({ message: "暂时无法更新提醒状态，请稍后重试。" });
    expect(result.message).not.toContain("private details");
  });
});
