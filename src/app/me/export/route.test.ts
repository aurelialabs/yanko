import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthContext = vi.hoisted(() => vi.fn());
const getAccountDataExport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ getAuthContext }));
vi.mock("@/modules/profile/account-data-export", () => ({
  AccountDataExportError: class AccountDataExportError extends Error {},
  getAccountDataExport,
}));

import { GET } from "./route";

describe("GET /me/export", () => {
  beforeEach(() => {
    getAuthContext.mockReset();
    getAccountDataExport.mockReset();
  });

  it("requires a verified current user before querying export data", async () => {
    getAuthContext.mockResolvedValue({ configured: true, user: null });

    const response = await GET();
    expect(response.status).toBe(401);
    expect(getAccountDataExport).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns a private JSON attachment without raw database details", async () => {
    const user = { id: "10000000-0000-4000-8000-000000000001" };
    getAuthContext.mockResolvedValue({ configured: true, user });
    getAccountDataExport.mockResolvedValue({
      schemaVersion: 1,
      account: { email: null },
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      account: { email: null },
    });
  });

  it("maps unexpected failures to a safe download error", async () => {
    getAuthContext.mockResolvedValue({ configured: true, user: { id: "user" } });
    getAccountDataExport.mockRejectedValue(new Error("query says secret-token"));

    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      message: "暂时无法导出数据，请稍后重试。",
    });
  });
});
