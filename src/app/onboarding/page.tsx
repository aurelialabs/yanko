import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth/session";
import { hasCompletedOnboarding } from "@/lib/auth/onboarding";
import { OnboardingScreen } from "@/modules/onboarding/onboarding-screen";
import { getRoleWorkspace } from "@/modules/roles/role-data";

export const metadata: Metadata = { title: "遇见你的 AI 伙伴" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ guest?: string }>;
}) {
  const { user } = await getAuthContext();
  const { guest } = await searchParams;
  if (!user && guest !== "1") redirect("/login?next=%2Fonboarding");
  if (user && (await hasCompletedOnboarding(user))) redirect("/");
  const workspace = await getRoleWorkspace(user);
  return <OnboardingScreen workspace={workspace} />;
}
