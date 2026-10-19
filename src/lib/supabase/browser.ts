"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfig } from "./config";

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabaseClient(): SupabaseClient | null {
  const config = getPublicSupabaseConfig();

  if (!config) {
    return null;
  }

  browserClient ??= createBrowserClient(config.url, config.anonKey);
  return browserClient;
}
