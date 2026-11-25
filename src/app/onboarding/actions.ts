"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const roleIdSchema = z.uuid().transform((value) => value.toLowerCase());

export async function completeOnboarding(
  _previousState: { message: string },
  formData: FormData,
): Promise<{ message: string }> {
  const roleId = roleIdSchema.safeParse(formData.get("roleId"));
  if (!roleId.success) {
    return { message: "角色信息无效，请刷新后重试。" };
  }

  try {
    const { user } = await getAuthContext();
    if (!user) {
      return { message: "登录状态已失效，请重新登录。" };
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      return { message: "引导服务尚未配置，暂时无法保存。" };
    }

    // The controlled RPC checks auth.uid(), active role ownership and persona;
    // current_role_id cannot be updated directly by authenticated clients.
    const { data, error } = await supabase.rpc("switch_current_role", {
      p_role_id: roleId.data,
    });
    if (error || data !== roleId.data) {
      return { message: "暂时无法保存角色，请刷新后重试。" };
    }

    // This user-editable flag controls onboarding presentation, never access.
    const { data: updated, error: updateError } = await supabase.auth.updateUser({
      data: { yanko_onboarding_completed: true },
    });
    if (
      updateError ||
      updated.user?.id !== user.id ||
      updated.user?.user_metadata?.yanko_onboarding_completed !== true
    ) {
      return { message: "角色已保存，但引导状态暂时无法保存，请重试。" };
    }
  } catch {
    return { message: "暂时无法完成引导，请稍后重试。" };
  }

  revalidatePath("/");
  revalidatePath("/onboarding");
  revalidatePath("/roles");
  revalidatePath("/me");
  revalidatePath("/chat");
  redirect("/chat");
}
