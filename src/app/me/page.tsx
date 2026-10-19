import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { ProfileWorkspace } from "@/modules/profile/profile-workspace";

export const metadata: Metadata = { title: "我的" };

export default async function MePage() {
  const user = await requireAuthenticatedUser("/me");

  return <ProfileWorkspace email={user?.email} isAuthenticated={Boolean(user)} />;
}
