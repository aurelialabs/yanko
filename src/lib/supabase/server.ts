import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getPublicSupabaseConfig } from "./config";

/**
 * A request-scoped server client. Cookie writes are possible in Route Handlers
 * and Server Actions; Server Components rely on src/proxy.ts to refresh them.
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient | null> {
  const config = getPublicSupabaseConfig();

  if (!config) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set response cookies. The Proxy refreshes
          // sessions before those components render.
        }
      },
    },
  });
}
