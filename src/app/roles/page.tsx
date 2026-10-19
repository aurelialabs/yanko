import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getRoleWorkspace } from "@/modules/roles/role-data";
import { RolesWorkspace } from "@/modules/roles/roles-workspace";

export const metadata: Metadata = { title: "角色" };

export default async function RolesPage() {
  const user = await requireAuthenticatedUser("/roles");
  const workspace = await getRoleWorkspace(user);

  return <RolesWorkspace workspace={workspace} />;
}
