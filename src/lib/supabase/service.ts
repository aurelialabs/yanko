import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a stateless service-role client for AI runtime mutations that must
 * not be callable directly from a browser session. Callers must authenticate
 * the end user first and pass only that verified user ID to guarded RPCs.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
