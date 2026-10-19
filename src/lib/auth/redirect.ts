const exactAppPaths = new Set([
  "/chat",
  "/plan",
  "/me",
  "/me/memories",
  "/me/notifications",
  "/roles",
  "/roles/new",
]);
const uuidSegment =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const planDetailPattern = new RegExp(`^/plan/${uuidSegment}$`, "i");
const roleEditPattern = new RegExp(`^/roles/${uuidSegment}/edit$`, "i");
const adminBadcaseDetailPattern = new RegExp(`^/admin/badcases/${uuidSegment}$`, "i");

export function isAllowedAppPath(pathname: string): boolean {
  return (
    exactAppPaths.has(pathname) ||
    planDetailPattern.test(pathname) ||
    roleEditPattern.test(pathname) ||
    pathname === "/admin/badcases" ||
    adminBadcaseDetailPattern.test(pathname)
  );
}

export function isProtectedAppPath(pathname: string): boolean {
  return (
    pathname === "/chat" ||
    pathname === "/me" ||
    pathname.startsWith("/me/") ||
    pathname === "/plan" ||
    pathname.startsWith("/plan/") ||
    pathname === "/roles" ||
    pathname.startsWith("/roles/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

/** Product pages stay open for the no-login demo. Only the admin console signs in. */
export function isSignInRequiredPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Authentication redirects must stay within the product. Keeping this as an
 * allow-list prevents a `next=https://…` query parameter becoming an open
 * redirect after a user follows a Magic Link.
 */
export function getSafeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/chat";
  }

  try {
    const candidate = new URL(value, "https://yanko.local");

    if (candidate.origin !== "https://yanko.local") {
      return "/chat";
    }

    if (!isAllowedAppPath(candidate.pathname)) {
      return "/chat";
    }

    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return "/chat";
  }
}
