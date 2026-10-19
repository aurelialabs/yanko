import { describe, expect, it } from "vitest";

import { hashRateLimitIdentifier } from "@/modules/auth/rate-limit";

describe("Magic Link rate-limit identifiers", () => {
  it("is deterministic without retaining the raw email or IP", () => {
    const pepper = "server-only-test-pepper";
    const email = "person@example.com";
    const identifier = hashRateLimitIdentifier("email", email, pepper);

    expect(identifier).toMatch(/^[0-9a-f]{64}$/);
    expect(identifier).toBe(hashRateLimitIdentifier("email", email, pepper));
    expect(identifier).not.toContain(email);
  });

  it("separates email and IP domains and changes when the pepper changes", () => {
    const value = "same-normalized-value";
    expect(hashRateLimitIdentifier("email", value, "pepper-a")).not.toBe(
      hashRateLimitIdentifier("ip", value, "pepper-a"),
    );
    expect(hashRateLimitIdentifier("email", value, "pepper-a")).not.toBe(
      hashRateLimitIdentifier("email", value, "pepper-b"),
    );
  });
});
