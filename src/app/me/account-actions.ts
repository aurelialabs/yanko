"use server";

import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  deleteVerifiedAccount,
  type AccountDeletionResult,
} from "@/modules/profile/account-deletion";
import type { AccountDeletionActionState } from "@/modules/profile/account-action-state";
import { deleteAccountSchema } from "@/server/schemas";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function deletionMessage(result: Exclude<AccountDeletionResult, "deleted">): string {
  return result === "unavailable"
    ? "账号服务尚未配置，暂时无法删除账号。"
    : "暂时无法删除账号。你的数据仍未被删除，请稍后重试。";
}

/**
 * The only browser-reachable account deletion boundary. It validates the
 * explicit double confirmation, revalidates the current session, and uses
 * that session's ID exclusively. No user ID, email, or deletion scope comes
 * from the form.
 */
export async function deleteMyAccount(
  _previousState: AccountDeletionActionState,
  formData: FormData,
): Promise<AccountDeletionActionState> {
  const input = deleteAccountSchema.safeParse({
    acknowledged: formText(formData, "acknowledged"),
    confirmation: formText(formData, "confirmation").trim(),
  });
  if (!input.success) {
    return { message: "请先确认风险，并完整输入“删除我的账号”。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录后再试。" };
  }

  const result = await deleteVerifiedAccount(auth.user.id);
  if (result !== "deleted") {
    return { message: deletionMessage(result) };
  }

  // Clear this browser's cookie session after Auth has removed the account.
  // Other sessions fail server-side user validation because the Auth user no
  // longer exists. Deliberately do not report a sign-out error after deletion.
  const supabase = await createServerSupabaseClient();
  if (supabase) {
    await supabase.auth.signOut({ scope: "local" });
  }

  redirect("/login?notice=account_deleted");
}
