import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

export type AccountDeletionResult = "deleted" | "unavailable" | "failed";

/**
 * Permanently removes an already-authenticated account. The caller must derive
 * `userId` from a freshly validated server session; this module never accepts
 * a browser-controlled account target. Hard deletion is explicit so that the
 * auth.users foreign-key cascades clear the associated personal data.
 */
export async function deleteVerifiedAccount(
  userId: string,
): Promise<AccountDeletionResult> {
  if (!uuidSchema.safeParse(userId).success) return "failed";

  const service = createServiceRoleSupabaseClient();
  if (!service) return "unavailable";

  try {
    const { error } = await service.auth.admin.deleteUser(userId, false);
    return error ? "failed" : "deleted";
  } catch {
    return "failed";
  }
}
