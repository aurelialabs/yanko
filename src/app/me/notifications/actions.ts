"use server";

import { revalidatePath } from "next/cache";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { InAppNotificationActionState } from "@/modules/notifications/in-app-notification-action-state";
import { markInAppNotificationReadSchema, uuidSchema } from "@/server/schemas";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Marks one owned in-app reminder through the controlled database function. */
export async function markInAppNotificationRead(
  _previousState: InAppNotificationActionState,
  formData: FormData,
): Promise<InAppNotificationActionState> {
  const input = markInAppNotificationReadSchema.safeParse({
    notificationId: formText(formData, "notificationId"),
    read: formText(formData, "read"),
  });
  if (!input.success) {
    return { message: "提醒信息无效，请刷新后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "提醒服务尚未配置，请稍后重试。" };
  }

  const { data: ownedNotification, error: ownershipError } = await supabase
    .from("in_app_notifications")
    .select("id")
    .eq("id", input.data.notificationId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (
    ownershipError ||
    !ownedNotification ||
    !uuidSchema.safeParse(ownedNotification.id).success ||
    ownedNotification.id !== input.data.notificationId
  ) {
    return { message: "这条提醒已发生变化，请刷新后重试。" };
  }

  const { data, error } = await supabase.rpc("mark_in_app_notification_read", {
    p_notification_id: input.data.notificationId,
    p_read: input.data.read,
    p_now: new Date().toISOString(),
  });
  if (error || data !== input.data.notificationId) {
    return { message: "暂时无法更新提醒状态，请稍后重试。" };
  }

  revalidatePath("/me");
  revalidatePath("/me/notifications");
  return { message: "", succeeded: true };
}
