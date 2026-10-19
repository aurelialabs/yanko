import { describe, expect, it } from "vitest";

import { deleteAccountSchema, magicLinkRequestSchema } from "./index";

describe("Magic Link input schema", () => {
  it("normalizes email casing and surrounding whitespace", () => {
    const result = magicLinkRequestSchema.safeParse({
      email: "  HELLO@Example.COM  ",
      redirectPath: "/roles/new",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("hello@example.com");
  });

  it("rejects invalid email and non-internal redirect input", () => {
    expect(
      magicLinkRequestSchema.safeParse({
        email: "not-an-email",
        redirectPath: "https://example.com",
      }).success,
    ).toBe(false);
  });
});

describe("Account deletion input schema", () => {
  it("requires the exact acknowledgement and confirmation phrase", () => {
    expect(
      deleteAccountSchema.safeParse({
        acknowledged: "true",
        confirmation: "删除我的账号",
      }).success,
    ).toBe(true);
    expect(
      deleteAccountSchema.safeParse({
        acknowledged: "false",
        confirmation: "删除我的账号 ",
      }).success,
    ).toBe(false);
  });
});
