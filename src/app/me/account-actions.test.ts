import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthContext = vi.hoisted(() => vi.fn());
const createServerSupabaseClient = vi.hoisted(() => vi.fn());
const deleteVerifiedAccount = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ getAuthContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));
vi.mock("@/modules/profile/account-deletion", () => ({ deleteVerifiedAccount }));
vi.mock("next/navigation", () => ({ redirect }));

import { deleteMyAccount } from "./account-actions";

const userId = "10000000-0000-4000-8000-000000000001";
const initialState = { message: "" };

function confirmedFormData(): FormData {
  const formData = new FormData();
  formData.set("acknowledged", "true");
  formData.set("confirmation", "删除我的账号");
  return formData;
}

describe("deleteMyAccount", () => {
  beforeEach(() => {
    getAuthContext.mockReset();
    createServerSupabaseClient.mockReset();
    deleteVerifiedAccount.mockReset();
    redirect.mockReset();
    getAuthContext.mockResolvedValue({ configured: true, user: { id: userId } });
  });

  it("requires both explicit confirmations before touching auth or data", async () => {
    await expect(deleteMyAccount(initialState, new FormData())).resolves.toEqual({
      message: "请先确认风险，并完整输入“删除我的账号”。",
    });
    expect(getAuthContext).not.toHaveBeenCalled();
    expect(deleteVerifiedAccount).not.toHaveBeenCalled();
  });

  it("uses only the freshly authenticated account target", async () => {
    getAuthContext.mockResolvedValue({ configured: true, user: null });

    await expect(deleteMyAccount(initialState, confirmedFormData())).resolves.toEqual({
      message: "登录状态已失效，请重新登录后再试。",
    });
    expect(deleteVerifiedAccount).not.toHaveBeenCalled();
  });

  it("does not clear a session or redirect when deletion fails", async () => {
    deleteVerifiedAccount.mockResolvedValue("failed");

    const result = await deleteMyAccount(initialState, confirmedFormData());
    expect(result).toEqual({
      message: "暂时无法删除账号。你的数据仍未被删除，请稍后重试。",
    });
    expect(deleteVerifiedAccount).toHaveBeenCalledWith(userId);
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("clears only the local session after a successful hard deletion", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    deleteVerifiedAccount.mockResolvedValue("deleted");
    createServerSupabaseClient.mockResolvedValue({ auth: { signOut } });
    redirect.mockImplementation(() => {
      throw new Error("redirected");
    });

    await expect(deleteMyAccount(initialState, confirmedFormData())).rejects.toThrow(
      "redirected",
    );
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(redirect).toHaveBeenCalledWith("/login?notice=account_deleted");
  });
});
