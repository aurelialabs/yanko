import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSafeNextPath, isSignInRequiredPath } from "@/lib/auth/redirect";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";

function redirectWithCookies(
  destination: URL,
  source: NextResponse,
  authHeaders: Record<string, string>,
) {
  const response = NextResponse.redirect(destination);

  source.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });
  Object.entries(authHeaders).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}

/**
 * Next.js 16 calls this convention `proxy`. It refreshes Supabase's cookie
 * session before rendering and provides an optimistic route guard; each page
 * still performs its own validated server-side user lookup.
 */
export async function proxy(request: NextRequest) {
  const config = getPublicSupabaseConfig();

  if (!config) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const pendingAuthHeaders: Record<string, string> = {};
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.assign(pendingAuthHeaders, headers);
      },
    },
  });

  const { data: claimsData } = await supabase.auth.getClaims();
  const signedIn = Boolean(claimsData?.claims?.sub);
  const path = request.nextUrl.pathname;

  if (isSignInRequiredPath(path) && !signedIn) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", getSafeNextPath(path));
    return redirectWithCookies(loginUrl, response, pendingAuthHeaders);
  }

  if (path === "/login" && signedIn) {
    const nextPath = getSafeNextPath(request.nextUrl.searchParams.get("next"));
    return redirectWithCookies(
      new URL(nextPath, request.url),
      response,
      pendingAuthHeaders,
    );
  }

  Object.entries(pendingAuthHeaders).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
