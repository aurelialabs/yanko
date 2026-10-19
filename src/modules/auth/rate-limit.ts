import "server-only";

import { createHash } from "node:crypto";

export function hashRateLimitIdentifier(
  kind: "email" | "ip",
  value: string,
  pepper: string,
): string {
  return createHash("sha256")
    .update(`${kind}:${pepper}:${value}`, "utf8")
    .digest("hex");
}
