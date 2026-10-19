import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthContext = vi.hoisted(() => vi.fn());
const createServerSupabaseClient = vi.hoisted(() => vi.fn());
const isActiveAdmin = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ getAuthContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));
vi.mock("@/modules/admin/badcase-review-data", () => ({ isActiveAdmin }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { updateBadcaseReviewStatus } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";

function formData() {
  const form = new FormData();
  form.set("badcaseId", id);
  form.set("status", "triaged");
  form.set("expectedRevision", "2");
  return form;
}

describe("updateBadcaseReviewStatus", () => {
  beforeEach(() => {
    getAuthContext.mockReset();
    createServerSupabaseClient.mockReset();
    isActiveAdmin.mockReset();
    revalidatePath.mockReset();
  });

  it("rejects malformed requests before authentication or database access", async () => {
    const result = await updateBadcaseReviewStatus({ message: "" }, new FormData());

    expect(result.message).toContain("状态信息无效");
    expect(getAuthContext).not.toHaveBeenCalled();
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("requires a verified active administrator for every status change", async () => {
    getAuthContext.mockResolvedValue({ user: { id: "reviewer" } });
    isActiveAdmin.mockResolvedValue(false);

    await expect(
      updateBadcaseReviewStatus({ message: "" }, formData()),
    ).resolves.toEqual({
      message: "你没有访问此后台的权限。",
    });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("calls only the narrow conflict-aware RPC and revalidates the reviewed routes", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id, status: "triaged", review_revision: 3 }],
      error: null,
    });
    getAuthContext.mockResolvedValue({ user: { id: "reviewer" } });
    isActiveAdmin.mockResolvedValue(true);
    createServerSupabaseClient.mockResolvedValue({ rpc });

    await expect(
      updateBadcaseReviewStatus({ message: "" }, formData()),
    ).resolves.toEqual({
      message: "状态已更新。",
      succeeded: true,
      status: "triaged",
      reviewRevision: 3,
    });
    expect(rpc).toHaveBeenCalledWith(
      "update_badcase_review_status",
      expect.objectContaining({
        p_badcase_id: id,
        p_status: "triaged",
        p_expected_revision: 2,
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/badcases");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/badcases/${id}`);
  });

  it("maps stale or unavailable database results to a safe refresh prompt", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "internal" } });
    getAuthContext.mockResolvedValue({ user: { id: "reviewer" } });
    isActiveAdmin.mockResolvedValue(true);
    createServerSupabaseClient.mockResolvedValue({ rpc });

    await expect(
      updateBadcaseReviewStatus({ message: "" }, formData()),
    ).resolves.toEqual({
      message: "这条 Badcase 已被更新，请刷新后重新处理。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
