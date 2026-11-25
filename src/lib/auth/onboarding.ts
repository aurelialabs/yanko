import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Presentation state only; authentication and authorization stay independent. */
export async function hasCompletedOnboarding(user: User): Promise<boolean> {
  if (user.user_metadata?.yanko_onboarding_completed === true) {
    return true;
  }

  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return false;

    // Existing accounts predate the metadata flag. RLS and the explicit owner
    // filter keep this existence check scoped to the supplied signed-in user.
    const { data, error } = await supabase
      .from("messages")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);

    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
