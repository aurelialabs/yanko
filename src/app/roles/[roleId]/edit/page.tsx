import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getRoleEditorData, getRoleWorkspace } from "@/modules/roles/role-data";
import { RolePersonaForm } from "@/modules/roles/role-persona-form";

export const metadata: Metadata = { title: "编辑当前角色" };

export default async function EditRolePage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  const user = await requireAuthenticatedUser(`/roles/${roleId}/edit`);
  const [workspace, editor] = await Promise.all([
    getRoleWorkspace(user),
    getRoleEditorData(user, roleId),
  ]);

  return <RolePersonaForm editor={editor} mode="edit" workspace={workspace} />;
}
