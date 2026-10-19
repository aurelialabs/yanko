"use server";

import { revalidatePath } from "next/cache";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isActiveAdmin } from "@/modules/admin/badcase-review-data";
import type { BadcaseReviewActionState } from "@/modules/admin/badcase-review-action-state";
import { updateBadcaseReviewSchema } from "@/server/schemas";
import { FEEDBACK_STATUSES, type FeedbackStatus } from "@/types/domain";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return (
    typeof value === "string" && FEEDBACK_STATUSES.includes(value as FeedbackStatus)
  );
}

/** Mutates only the reviewed status through the admin-checked database function. */
export async function updateBadcaseReviewStatus(
  _previousState: BadcaseReviewActionState,
  formData: FormData,
): Promise<BadcaseReviewActionState> {
  const input = updateBadcaseReviewSchema.safeParse({
    badcaseId: field(formData, "badcaseId"),
    status: field(formData, "status"),
    expectedRevision: field(formData, "expectedRevision"),
  });
  if (!input.success) return { message: "状态信息无效，请刷新后重试。" };

  const auth = await getAuthContext();
  if (!auth.user) return { message: "登录状态已失效，请重新登录。" };
  if (!(await isActiveAdmin(auth.user))) return { message: "你没有访问此后台的权限。" };

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { message: "后台服务尚未配置，请稍后重试。" };

  const { data, error } = await supabase.rpc("update_badcase_review_status", {
    p_badcase_id: input.data.badcaseId,
    p_status: input.data.status,
    p_expected_revision: input.data.expectedRevision,
    p_now: new Date().toISOString(),
  });
  const result = Array.isArray(data) ? data[0] : null;
  const reviewRevision = result?.review_revision;
  if (
    error ||
    !result ||
    result.id !== input.data.badcaseId ||
    !isFeedbackStatus(result.status) ||
    result.status !== input.data.status ||
    typeof reviewRevision !== "number" ||
    !Number.isInteger(reviewRevision) ||
    reviewRevision < 0
  ) {
    return { message: "这条 Badcase 已被更新，请刷新后重新处理。" };
  }

  revalidatePath("/admin/badcases");
  revalidatePath(`/admin/badcases/${input.data.badcaseId}`);
  return {
    message: "状态已更新。",
    succeeded: true,
    status: result.status,
    reviewRevision,
  };
}
