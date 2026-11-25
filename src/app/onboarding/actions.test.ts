import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthContext = vi.hoisted(() => vi.fn());
const createServerSupabaseClient = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ getAuthContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

import { completeOnboarding } from "./actions";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "20000000-0000-4000-8000-000000000002";
const roleId = "abcdefab-0000-4000-8000-000000000003";
const otherRoleId = "abcdefab-0000-4000-8000-000000000004";
const initialState = { message: "" };

function validFormData(selectedRoleId = roleId): FormData {
  const formData = new FormData();
  formData.set("roleId", selectedRoleId);
  return formData;
}

function completionUser(id = userId, completed: unknown = true) {
  return { id, user_metadata: { yanko_onboarding_completed: completed } };
}

function supabaseClient(id = userId, selectedRoleId = roleId) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: selectedRoleId, error: null }),
    auth: {
      updateUser: vi.fn().mockResolvedValue({
        data: { user: completionUser(id) },
        error: null,
      }),
    },
  };
}

function expectNoNavigation() {
  expect(revalidatePath).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
}

describe("completeOnboarding", () => {
  beforeEach(() => {
    getAuthContext.mockReset();
    createServerSupabaseClient.mockReset();
    revalidatePath.mockReset();
    redirect.mockReset().mockImplementation(() => {
      throw new Error("NEXT_REDIRECT:/chat");
    });
    getAuthContext.mockResolvedValue({ configured: true, user: { id: userId } });
  });

  it.each([null, "", "not-a-uuid", "../roles", "abcdefab-0000-0000-0000-000000000003"])(
    "rejects malformed role id %s before authentication or mutations",
    async (value) => {
      const formData = new FormData();
      if (value !== null) formData.set("roleId", value);

      await expect(completeOnboarding(initialState, formData)).resolves.toEqual({
        message: "角色信息无效，请刷新后重试。",
      });
      expect(getAuthContext).not.toHaveBeenCalled();
      expect(createServerSupabaseClient).not.toHaveBeenCalled();
      expectNoNavigation();
    },
  );

  it("rejects a file submitted as roleId", async () => {
    const formData = new FormData();
    formData.set("roleId", new File([roleId], "role.txt"));

    await expect(completeOnboarding(initialState, formData)).resolves.toEqual({
      message: "角色信息无效，请刷新后重试。",
    });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("requires a validated signed-in user", async () => {
    getAuthContext.mockResolvedValue({ configured: true, user: null });

    await expect(completeOnboarding(initialState, validFormData())).resolves.toEqual({
      message: "登录状态已失效，请重新登录。",
    });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expectNoNavigation();
  });

  it("does not continue when the server client is unconfigured", async () => {
    createServerSupabaseClient.mockResolvedValue(null);

    await expect(completeOnboarding(initialState, validFormData())).resolves.toEqual({
      message: "引导服务尚未配置，暂时无法保存。",
    });
    expectNoNavigation();
  });

  it("does not continue when authentication lookup rejects", async () => {
    getAuthContext.mockRejectedValue(new Error("private auth details"));

    await expect(completeOnboarding(initialState, validFormData())).resolves.toEqual({
      message: "暂时无法完成引导，请稍后重试。",
    });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expectNoNavigation();
  });

  it.each([
    { data: null, error: { message: "role not found" } },
    { data: null, error: null },
    { data: otherRoleId, error: null },
    { data: roleId, error: { message: "private database details" } },
  ])(
    "does not mark onboarding complete when the role RPC fails: %j",
    async (result) => {
      const client = supabaseClient();
      client.rpc.mockResolvedValue(result);
      createServerSupabaseClient.mockResolvedValue(client);

      await expect(completeOnboarding(initialState, validFormData())).resolves.toEqual({
        message: "暂时无法保存角色，请刷新后重试。",
      });
      expect(client.rpc).toHaveBeenCalledWith("switch_current_role", {
        p_role_id: roleId,
      });
      expect(client.auth.updateUser).not.toHaveBeenCalled();
      expectNoNavigation();
    },
  );

  it("handles a rejected role RPC without updating metadata", async () => {
    const client = supabaseClient();
    client.rpc.mockRejectedValue(new Error("private database details"));
    createServerSupabaseClient.mockResolvedValue(client);

    await expect(completeOnboarding(initialState, validFormData())).resolves.toEqual({
      message: "暂时无法完成引导，请稍后重试。",
    });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expectNoNavigation();
  });

  it.each([
    { data: { user: null }, error: { message: "private auth details" } },
    { data: { user: null }, error: null },
    { data: { user: completionUser(userId, false) }, error: null },
    { data: { user: completionUser(userId, "true") }, error: null },
    { data: { user: completionUser(otherUserId) }, error: null },
  ])(
    "does not report success for an unconfirmed metadata update: %j",
    async (result) => {
      const client = supabaseClient();
      client.auth.updateUser.mockResolvedValue(result);
      createServerSupabaseClient.mockResolvedValue(client);

      await expect(completeOnboarding(initialState, validFormData())).resolves.toEqual({
        message: "角色已保存，但引导状态暂时无法保存，请重试。",
      });
      expectNoNavigation();
    },
  );

  it("does not navigate when the metadata update rejects", async () => {
    const client = supabaseClient();
    client.auth.updateUser.mockRejectedValue(new Error("private auth details"));
    createServerSupabaseClient.mockResolvedValue(client);

    await expect(completeOnboarding(initialState, validFormData())).resolves.toEqual({
      message: "暂时无法完成引导，请稍后重试。",
    });
    expectNoNavigation();
  });

  it("persists the role then metadata before refreshing pages and redirecting", async () => {
    const client = supabaseClient();
    createServerSupabaseClient.mockResolvedValue(client);
    const formData = validFormData(roleId.toUpperCase());
    formData.set("userId", otherUserId);
    formData.set("next", "https://example.com");
    formData.set("yanko_onboarding_completed", "false");

    await expect(completeOnboarding(initialState, formData)).rejects.toThrow(
      "NEXT_REDIRECT:/chat",
    );
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("switch_current_role", {
      p_role_id: roleId,
    });
    expect(client.auth.updateUser).toHaveBeenCalledExactlyOnceWith({
      data: { yanko_onboarding_completed: true },
    });
    expect(revalidatePath.mock.calls).toEqual([
      ["/"],
      ["/onboarding"],
      ["/roles"],
      ["/me"],
      ["/chat"],
    ]);
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/chat");
    expect(client.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      client.auth.updateUser.mock.invocationCallOrder[0]!,
    );
    expect(client.auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      revalidatePath.mock.invocationCallOrder[0]!,
    );
    expect(revalidatePath.mock.invocationCallOrder.at(-1)).toBeLessThan(
      redirect.mock.invocationCallOrder[0]!,
    );
  });

  it("uses each request's session and never reuses another user's completion", async () => {
    const first = supabaseClient();
    const second = supabaseClient(otherUserId, otherRoleId);
    second.rpc.mockResolvedValue({
      data: null,
      error: { message: "role not found" },
    });
    getAuthContext
      .mockResolvedValueOnce({ configured: true, user: { id: userId } })
      .mockResolvedValueOnce({ configured: true, user: { id: otherUserId } });
    createServerSupabaseClient
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await expect(completeOnboarding(initialState, validFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/chat",
    );
    revalidatePath.mockClear();
    redirect.mockClear();

    await expect(
      completeOnboarding(initialState, validFormData(roleId)),
    ).resolves.toEqual({ message: "暂时无法保存角色，请刷新后重试。" });
    expect(getAuthContext).toHaveBeenCalledTimes(2);
    expect(second.rpc).toHaveBeenCalledWith("switch_current_role", {
      p_role_id: roleId,
    });
    expect(first.auth.updateUser).toHaveBeenCalledOnce();
    expect(second.auth.updateUser).not.toHaveBeenCalled();
    expectNoNavigation();
  });
});
