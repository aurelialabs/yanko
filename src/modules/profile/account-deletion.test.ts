import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceRoleSupabaseClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/service", () => ({ createServiceRoleSupabaseClient }));

import { deleteVerifiedAccount } from "./account-deletion";

const userId = "10000000-0000-4000-8000-000000000001";

describe("deleteVerifiedAccount", () => {
  beforeEach(() => {
    createServiceRoleSupabaseClient.mockReset();
  });

  it("rejects an invalid target before a service client is created", async () => {
    await expect(deleteVerifiedAccount("not-a-user-id")).resolves.toBe("failed");
    expect(createServiceRoleSupabaseClient).not.toHaveBeenCalled();
  });

  it("fails closed when the server-only deletion credential is unavailable", async () => {
    createServiceRoleSupabaseClient.mockReturnValue(null);

    await expect(deleteVerifiedAccount(userId)).resolves.toBe("unavailable");
  });

  it("explicitly makes a hard Auth deletion", async () => {
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    createServiceRoleSupabaseClient.mockReturnValue({
      auth: { admin: { deleteUser } },
    });

    await expect(deleteVerifiedAccount(userId)).resolves.toBe("deleted");
    expect(deleteUser).toHaveBeenCalledWith(userId, false);
  });

  it("does not leak Auth deletion failures", async () => {
    const deleteUser = vi
      .fn()
      .mockResolvedValue({ error: { message: "private detail" } });
    createServiceRoleSupabaseClient.mockReturnValue({
      auth: { admin: { deleteUser } },
    });

    await expect(deleteVerifiedAccount(userId)).resolves.toBe("failed");
  });
});
