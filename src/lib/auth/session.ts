import "server-only";

import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "../supabase/server";
import { getSafeNextPath, isSignInRequiredPath } from "./redirect";

export interface AuthContext {
  configured: boolean;
  user: User | null;
}

/**
 * Uses Supabase's validated user lookup on the server. This intentionally does
 * not trust browser state or an unverified `getSession()` result.
 */
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return { configured: false, user: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { configured: true, user };
});

/**
 * Product pages render the local demo when nobody is signed in. Admin pages
 * still require a validated session.
 */
export async function requireAuthenticatedUser(nextPath: string): Promise<User | null> {
  const auth = await getAuthContext();
  const path = nextPath.split(/[?#]/, 1)[0] ?? "";

  if (auth.configured && !auth.user && isSignInRequiredPath(path)) {
    redirect(`/login?next=${encodeURIComponent(getSafeNextPath(nextPath))}`);
  }

  return auth.user;
}
