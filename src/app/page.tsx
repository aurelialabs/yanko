import { getAuthContext } from "@/lib/auth/session";
import { hasCompletedOnboarding } from "@/lib/auth/onboarding";
import { LaunchScreen } from "@/modules/onboarding/launch-screen";

export default async function HomePage() {
  const { user } = await getAuthContext();
  const completed = user ? await hasCompletedOnboarding(user) : false;

  return <LaunchScreen authenticated={Boolean(user)} completed={completed} />;
}
