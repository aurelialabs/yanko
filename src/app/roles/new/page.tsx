import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getRoleWorkspace } from "@/modules/roles/role-data";
import { RolePersonaForm } from "@/modules/roles/role-persona-form";

export const metadata: Metadata = { title: "创建角色" };

export default async function NewRolePage() {
  const user = await requireAuthenticatedUser("/roles/new");
  const workspace = await getRoleWorkspace(user);

  return <RolePersonaForm mode="create" workspace={workspace} />;
}
