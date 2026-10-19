"use server";

import { revalidatePath } from "next/cache";

import { getAuthContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { MemoryActionState } from "@/modules/profile/memory-action-state";
import {
  deleteMemorySchema,
  memoryCandidateDecisionSchema,
  updateMemorySchema,
} from "@/server/schemas";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalFormText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function refreshMemoryViews(): void {
  revalidatePath("/me");
  revalidatePath("/me/memories");
  revalidatePath("/chat");
}

/**
 * Confirms one owned candidate exclusively through the DB security-definer
 * function. The database repeats ownership, source-message, sensitivity,
 * scope, replacement-chain, and idempotency checks.
 */
export async function confirmMemoryCandidate(
  _previousState: MemoryActionState,
  formData: FormData,
): Promise<MemoryActionState> {
  const input = memoryCandidateDecisionSchema.safeParse({
    candidateId: formText(formData, "candidateId"),
    action: "confirm",
    editedContent: optionalFormText(formData, "editedContent"),
    editedScope: optionalFormText(formData, "editedScope"),
    editedRoleId: optionalFormText(formData, "editedRoleId"),
    idempotencyKey: formText(formData, "idempotencyKey"),
  });

  if (!input.success) {
    return { message: "记忆内容或作用范围无效，请检查后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "记忆服务尚未配置，暂时无法保存。" };
  }

  const { data, error } = await supabase.rpc("confirm_memory_candidate", {
    p_candidate_id: input.data.candidateId,
    p_edited_content: input.data.editedContent ?? null,
    p_edited_scope: input.data.editedScope ?? null,
    p_edited_role_id: input.data.editedRoleId ?? null,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error || typeof data !== "string") {
    return { message: "暂时无法确认这条记忆，请刷新后重试。" };
  }

  refreshMemoryViews();
  return { message: "", memoryId: data, succeeded: true };
}

/** Rejects one owned pending candidate without creating a formal memory. */
export async function rejectMemoryCandidate(
  _previousState: MemoryActionState,
  formData: FormData,
): Promise<MemoryActionState> {
  const input = memoryCandidateDecisionSchema.safeParse({
    candidateId: formText(formData, "candidateId"),
    action: "reject",
    idempotencyKey: formText(formData, "idempotencyKey"),
  });

  if (!input.success) {
    return { message: "记忆候选无效，请刷新后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "记忆服务尚未配置，暂时无法保存。" };
  }

  const { error } = await supabase.rpc("reject_memory_candidate", {
    p_candidate_id: input.data.candidateId,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error) {
    return { message: "暂时无法拒绝这条候选，请刷新后重试。" };
  }

  refreshMemoryViews();
  return { message: "", succeeded: true };
}

/** Replaces an active owned memory through the history-preserving DB function. */
export async function replaceMemory(
  _previousState: MemoryActionState,
  formData: FormData,
): Promise<MemoryActionState> {
  const input = updateMemorySchema.safeParse({
    memoryId: formText(formData, "memoryId"),
    content: optionalFormText(formData, "content"),
    scope: optionalFormText(formData, "scope"),
    roleId: optionalFormText(formData, "roleId"),
    idempotencyKey: formText(formData, "idempotencyKey"),
  });

  if (!input.success) {
    return { message: "记忆内容或作用范围无效，请检查后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "记忆服务尚未配置，暂时无法保存。" };
  }

  const { data: currentMemory, error: currentMemoryError } = await supabase
    .from("memories")
    .select("scope, sensitivity, status, deleted_at")
    .eq("id", input.data.memoryId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (
    currentMemoryError ||
    !currentMemory ||
    currentMemory.status !== "active" ||
    currentMemory.deleted_at !== null
  ) {
    return { message: "这条记忆已发生变化，请刷新后重试。" };
  }

  if (
    input.data.scope === "user_shared" &&
    currentMemory.scope === "role_private" &&
    formText(formData, "sharingConfirmed") !== "true"
  ) {
    return { message: "改为所有角色共享前，需要再次确认可见范围。" };
  }

  if (input.data.scope === "user_shared" && currentMemory.sensitivity === "sensitive") {
    return { message: "敏感记忆只能保留在原角色中。" };
  }

  const { data, error } = await supabase.rpc("replace_memory", {
    p_memory_id: input.data.memoryId,
    p_content: input.data.content ?? null,
    p_scope: input.data.scope ?? null,
    p_role_id: input.data.roleId ?? null,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error || typeof data !== "string") {
    return { message: "暂时无法更新这条记忆，请刷新后重试。" };
  }

  refreshMemoryViews();
  return { message: "", memoryId: data, succeeded: true };
}

/** Deletes one owned memory through the DB function so recalled context updates immediately. */
export async function deleteMemory(
  _previousState: MemoryActionState,
  formData: FormData,
): Promise<MemoryActionState> {
  if (formText(formData, "confirmDeletion") !== "true") {
    return { message: "删除前需要再次确认。" };
  }

  const input = deleteMemorySchema.safeParse({
    memoryId: formText(formData, "memoryId"),
    idempotencyKey: formText(formData, "idempotencyKey"),
  });

  if (!input.success) {
    return { message: "记忆信息无效，请刷新后重试。" };
  }

  const auth = await getAuthContext();
  if (!auth.user) {
    return { message: "登录状态已失效，请重新登录。" };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "记忆服务尚未配置，暂时无法删除。" };
  }

  const { error } = await supabase.rpc("delete_memory", {
    p_memory_id: input.data.memoryId,
    p_idempotency_key: input.data.idempotencyKey,
  });

  if (error) {
    return { message: "暂时无法删除这条记忆，请刷新后重试。" };
  }

  refreshMemoryViews();
  return { message: "", succeeded: true };
}
