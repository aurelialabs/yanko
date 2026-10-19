import { describe, expect, it } from "vitest";

import {
  getSafeNextPath,
  isAllowedAppPath,
  isProtectedAppPath,
  isSignInRequiredPath,
} from "./redirect";

const ids = {
  plan: "11111111-1111-4111-8111-111111111111",
  role: "22222222-2222-4222-8222-222222222222",
  badcase: "33333333-3333-4333-8333-333333333333",
};

describe("getSafeNextPath", () => {
  it("keeps approved in-app destinations", () => {
    expect(getSafeNextPath("/plan?scope=week")).toBe("/plan?scope=week");
    expect(getSafeNextPath(`/plan/${ids.plan}#details`)).toBe(
      `/plan/${ids.plan}#details`,
    );
    expect(getSafeNextPath("/roles/new")).toBe("/roles/new");
    expect(getSafeNextPath("/me/memories")).toBe("/me/memories");
    expect(getSafeNextPath("/me/notifications")).toBe("/me/notifications");
    expect(getSafeNextPath(`/roles/${ids.role}/edit`)).toBe(`/roles/${ids.role}/edit`);
    expect(getSafeNextPath("/admin/badcases")).toBe("/admin/badcases");
    expect(getSafeNextPath(`/admin/badcases/${ids.badcase}`)).toBe(
      `/admin/badcases/${ids.badcase}`,
    );
  });

  it("rejects external, protocol-relative, and unknown destinations", () => {
    expect(getSafeNextPath("https://example.com")).toBe("/chat");
    expect(getSafeNextPath("//example.com")).toBe("/chat");
    expect(getSafeNextPath("/api/private")).toBe("/chat");
    expect(getSafeNextPath("/plan/not-a-uuid")).toBe("/chat");
    expect(getSafeNextPath("/roles/not-a-uuid/edit")).toBe("/chat");
    expect(getSafeNextPath("/roles/new/extra")).toBe("/chat");
    expect(getSafeNextPath("/me/memories/unknown")).toBe("/chat");
    expect(getSafeNextPath("/admin")).toBe("/chat");
    expect(getSafeNextPath("/admin/badcases/not-a-uuid")).toBe("/chat");
  });

  it("protects nested plan and role routes optimistically", () => {
    expect(isProtectedAppPath(`/plan/${ids.plan}`)).toBe(true);
    expect(isProtectedAppPath("/roles/new")).toBe(true);
    expect(isProtectedAppPath("/me/memories")).toBe(true);
    expect(isProtectedAppPath("/me/notifications")).toBe(true);
    expect(isProtectedAppPath(`/roles/${ids.role}/edit`)).toBe(true);
    expect(isProtectedAppPath("/admin/badcases")).toBe(true);
    expect(isProtectedAppPath("/login")).toBe(false);
    expect(isSignInRequiredPath("/chat")).toBe(false);
    expect(isSignInRequiredPath("/plan")).toBe(false);
    expect(isSignInRequiredPath("/me/memories")).toBe(false);
    expect(isSignInRequiredPath("/admin/badcases")).toBe(true);
  });

  it("allows only recognized leaf routes as post-auth destinations", () => {
    expect(isAllowedAppPath(`/plan/${ids.plan}`)).toBe(true);
    expect(isAllowedAppPath(`/roles/${ids.role}/edit`)).toBe(true);
    expect(isAllowedAppPath("/admin/badcases")).toBe(true);
    expect(isAllowedAppPath(`/admin/badcases/${ids.badcase}`)).toBe(true);
    expect(isAllowedAppPath("/plan/11111111-1111-1111-1111-111111111111")).toBe(false);
  });
});
