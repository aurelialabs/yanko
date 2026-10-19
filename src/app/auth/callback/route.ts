import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { getSafeNextPath } from "@/lib/auth/redirect";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

function loginUrl(request: NextRequest, error: string, nextPath: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  url.searchParams.set("next", nextPath);
  return url;
}

/**
 * Exchanges Supabase's one-time PKCE code for an HttpOnly cookie session.
 * The database migration provisions the default profile and three roles after
 * email confirmation; the RPC below is an additional idempotent safeguard.
 */
export async function GET(request: NextRequest) {
  const nextPath = getSafeNextPath(request.nextUrl.searchParams.get("next"));
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(loginUrl(request, "missing_code", nextPath));
  }

  const config = getPublicSupabaseConfig();

  if (!config) {
    return NextResponse.redirect(loginUrl(request, "configuration", nextPath));
  }

  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        pendingCookies.push(...cookiesToSet);
        Object.assign(pendingHeaders, headers);
      },
    },
  });

  const withPendingAuthCookies = (destination: URL) => {
    const response = NextResponse.redirect(destination);

    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    Object.entries(pendingHeaders).forEach(([name, value]) => {
      response.headers.set(name, value);
    });
    response.headers.set("Cache-Control", "private, no-store");

    return response;
  };

  const {
    data: { user },
    error: exchangeError,
  } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !user) {
    return withPendingAuthCookies(loginUrl(request, "callback_failed", nextPath));
  }

  const { error: provisionError } = await supabase.rpc("provision_default_roles", {
    p_user_id: user.id,
  });

  if (provisionError) {
    return withPendingAuthCookies(loginUrl(request, "account_setup_failed", nextPath));
  }

  return withPendingAuthCookies(new URL(nextPath, request.url));
}
