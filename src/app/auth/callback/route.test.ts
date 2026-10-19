import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClient = vi.hoisted(() => vi.fn());
const getPublicSupabaseConfig = vi.hoisted(() => vi.fn());
const exchangeCodeForSession = vi.hoisted(() => vi.fn());
const provisionDefaultRoles = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("@/lib/supabase/config", () => ({ getPublicSupabaseConfig }));

import { GET } from "./route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    createServerClient.mockReset();
    getPublicSupabaseConfig.mockReset();
    exchangeCodeForSession.mockReset();
    provisionDefaultRoles.mockReset();
    getPublicSupabaseConfig.mockReturnValue({
      url: "http://127.0.0.1:54321",
      anonKey: "public-test-key",
    });
    createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession },
      rpc: provisionDefaultRoles,
    });
  });

  it("returns a safe login error when the PKCE code is absent", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3002/auth/callback?next=https://example.com"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/login?error=missing_code&next=%2Fchat",
    );
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("offers recovery when public Auth configuration is missing", async () => {
    getPublicSupabaseConfig.mockReturnValue(null);
    const response = await GET(
      new NextRequest(
        "http://localhost:3002/auth/callback?code=one-time-code&next=%2Fplan",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/login?error=configuration&next=%2Fplan",
    );
  });

  it.each([
    ["invalid", "invalid_grant"],
    ["expired", "otp_expired"],
  ])(
    "maps an %s or already-used code to the same safe recovery entry",
    async (_label, code) => {
      exchangeCodeForSession.mockResolvedValue({
        data: { user: null },
        error: { code, message: "internal provider detail" },
      });
      const response = await GET(
        new NextRequest(
          "http://localhost:3002/auth/callback?code=bad-code&next=%2Fchat",
        ),
      );

      expect(response.headers.get("location")).toBe(
        "http://localhost:3002/login?error=callback_failed&next=%2Fchat",
      );
      expect(response.headers.get("location")).not.toContain("internal");
    },
  );

  it("does not enter the app when default account setup fails", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: null,
    });
    provisionDefaultRoles.mockResolvedValue({
      data: null,
      error: { message: "database detail" },
    });
    const response = await GET(
      new NextRequest(
        "http://localhost:3002/auth/callback?code=valid-code&next=%2Fchat",
      ),
    );

    expect(provisionDefaultRoles).toHaveBeenCalledWith("provision_default_roles", {
      p_user_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/login?error=account_setup_failed&next=%2Fchat",
    );
  });

  it("keeps an allowed dynamic destination after a successful exchange", async () => {
    const planId = "22222222-2222-4222-8222-222222222222";
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: null,
    });
    provisionDefaultRoles.mockResolvedValue({ data: null, error: null });
    const response = await GET(
      new NextRequest(
        `http://localhost:3002/auth/callback?code=valid-code&next=%2Fplan%2F${planId}`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      `http://localhost:3002/plan/${planId}`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
