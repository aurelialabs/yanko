import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getMemoryManagementData } from "@/modules/profile/memory-data";
import { MemoryManagementWorkspace } from "@/modules/profile/memory-management-workspace";

export const metadata: Metadata = { title: "记忆管理" };

export default async function MemoriesPage() {
  const user = await requireAuthenticatedUser("/me/memories");
  const data = await getMemoryManagementData(user);

  return <MemoryManagementWorkspace data={data} />;
}
