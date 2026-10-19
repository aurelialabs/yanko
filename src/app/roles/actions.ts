"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  RoleMutationState,
  RoleSelectionState,
} from "@/modules/roles/role-action-state";
import { getRoleEditorData } from "@/modules/roles/role-data";
import type { PersonaChangePreview } from "@/modules/roles/role-editor";
import { describePersonaChanges } from "@/modules/roles/persona-prompt";
import {
  createCustomRoleSchema,
  createPersonaVersionSchema,
  personaSnapshotSchema,
} from "@/server/schemas";
import type { PersonaSnapshot } from "@/types/domain";

const roleIdSchema = z.string().uuid();

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function listField(formData: FormData, name: string): string[] {
  return textField(formData, name)
    .split(/\r?\n|,|，/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function personaFromForm(formData: FormData): PersonaSnapshot {
  const boundaries = listField(formData, "boundaries");
  return {
    identity: {
      name: textField(formData, "displayName"),
      role: textField(formData, "roleLabel"),
      background: textField(formData, "background") || undefined,
    },
    coreTraits: listField(formData, "coreTraits"),
    speakingStyle: listField(formData, "speakingStyle"),
    supportStyle:
      textField(formData, "supportStyle") ||
      "先理解用户的感受和真实需求，再询问是否需要建议。",
    reminderTone:
      textField(formData, "reminderTone") ||
      "温和、具体、不施压；尊重用户拒绝或调整计划。",
    boundaries: boundaries.length
      ? boundaries
      : ["尊重用户边界，不编造经历，不替用户做决定"],
    preferences: listField(formData, "preferences"),
    values: listField(formData, "values"),
    relationshipDefinition: textField(formData, "relationshipDefinition") || undefined,
    proactiveLevel: textField(formData, "proactiveLevel") as "low" | "medium" | "high",
  };
}

/**
 * Receives only an untrusted role id. It verifies the signed-in user and reads
 * the role through RLS before updating that user's current_role_id.
 */
export async function selectCurrentRole(
  _previousState: RoleSelectionState,
  formData: FormData,
): Promise<RoleSelectionState> {
  const roleId = roleIdSchema.safeParse(formData.get("roleId"));

  if (!roleId.success) {
    return { message: "角色信息无效，请刷新后重试。" };
  }

  const auth = await getAuthContext();

  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return { message: "角色服务尚未配置，暂时无法切换。" };
  }

  const { data, error } = await supabase.rpc("switch_current_role", {
    p_role_id: roleId.data,
  });

  if (error || data !== roleId.data) {
    return { message: "暂时无法切换角色，请稍后再试。" };
  }

  revalidatePath("/roles");
  revalidatePath("/chat");
  redirect("/chat");
}

export async function createCustomRole(
  _previousState: RoleMutationState,
  formData: FormData,
): Promise<RoleMutationState> {
  const input = createCustomRoleSchema.safeParse({
    displayName: textField(formData, "displayName"),
    persona: personaFromForm(formData),
    idempotencyKey: textField(formData, "idempotencyKey"),
  });
  if (!input.success || textField(formData, "confirmed") !== "true") {
    return { message: "请补全必填人设信息，并在确认后创建角色。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) return { message: "登录状态已失效，请重新登录。" };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { message: "角色服务尚未配置，暂时无法创建。" };

  const { data, error } = await supabase.rpc("create_custom_role", {
    p_display_name: input.data.displayName,
    p_persona: input.data.persona,
    p_idempotency_key: input.data.idempotencyKey,
  });
  if (error || typeof data !== "string") {
    return { message: "暂时无法创建角色，请检查内容后重试。" };
  }

  revalidatePath("/roles");
  revalidatePath("/chat");
  redirect("/roles");
}

export async function previewPersonaVersion(
  formData: FormData,
): Promise<PersonaChangePreview> {
  const roleId = roleIdSchema.safeParse(textField(formData, "roleId"));
  const expected = roleIdSchema.safeParse(
    textField(formData, "expectedCurrentVersionId"),
  );
  const persona = personaSnapshotSchema.safeParse(personaFromForm(formData));
  if (!roleId.success || !expected.success || !persona.success) {
    return { ok: false, message: "请检查人设字段后重试。", changedFields: [] };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { ok: false, message: "登录状态已失效，请重新登录。", changedFields: [] };
  }
  const current = await getRoleEditorData(auth.user, roleId.data);
  if (
    current.source !== "database" ||
    !current.persona ||
    current.currentPersonaVersionId !== expected.data
  ) {
    return {
      ok: false,
      message: "角色已被更新，请刷新后重新确认。",
      changedFields: [],
    };
  }

  const changedFields = describePersonaChanges(current.persona, persona.data);
  return changedFields.length
    ? { ok: true, message: "确认后，新设置将从下一条回复开始生效。", changedFields }
    : { ok: false, message: "人设内容没有发生变化。", changedFields: [] };
}

export async function updatePersonaVersion(
  _previousState: RoleMutationState,
  formData: FormData,
): Promise<RoleMutationState> {
  const input = createPersonaVersionSchema.safeParse({
    roleId: textField(formData, "roleId"),
    expectedCurrentVersionId: textField(formData, "expectedCurrentVersionId"),
    persona: personaFromForm(formData),
    confirmed: textField(formData, "confirmed") === "true",
    idempotencyKey: textField(formData, "idempotencyKey"),
  });
  if (!input.success) return { message: "请检查人设内容后重新确认。" };

  const auth = await getAuthContext();
  if (!auth.user) return { message: "登录状态已失效，请重新登录。" };
  const current = await getRoleEditorData(auth.user, input.data.roleId);
  if (
    current.source !== "database" ||
    !current.persona ||
    current.currentPersonaVersionId !== input.data.expectedCurrentVersionId
  ) {
    return {
      message: "角色已被更新，请刷新后重新确认。",
      conflict: true,
    };
  }
  const changedFields = describePersonaChanges(current.persona, input.data.persona);
  if (!changedFields.length) return { message: "人设内容没有发生变化。" };

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { message: "角色服务尚未配置，暂时无法保存。" };
  const { data, error } = await supabase.rpc("create_persona_version", {
    p_role_id: input.data.roleId,
    p_expected_current_version_id: input.data.expectedCurrentVersionId,
    p_persona: input.data.persona,
    p_change_summary: `修改：${changedFields.join("、")}`,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error) {
    const conflict = error.code === "40001" || /conflict/i.test(error.message);
    return {
      message: conflict
        ? "角色已被更新，请刷新后重新确认。"
        : "暂时无法保存人设，请稍后再试。",
      conflict,
    };
  }
  if (typeof data !== "string") return { message: "暂时无法保存人设，请稍后再试。" };

  revalidatePath("/roles");
  revalidatePath("/chat");
  revalidatePath(`/roles/${input.data.roleId}/edit`);
  return {
    message: "新的人设版本已保存，将从下一条回复开始生效。",
    roleId: input.data.roleId,
    personaVersionId: data,
  };
}
