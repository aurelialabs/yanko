import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { uuidSchema } from "@/server/schemas";

export interface MemoryEmbeddingContext {
  userId: string;
  memoryId: string;
  content: string;
  updatedAt: string;
}

export class MemoryEmbeddingContextLoadError extends Error {
  constructor(readonly code: "configuration-unavailable" | "query-unavailable") {
    super(code);
    this.name = "MemoryEmbeddingContextLoadError";
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function loadMemoryEmbeddingContext(
  userId: string,
  memoryId: string,
): Promise<MemoryEmbeddingContext | null> {
  if (
    !uuidSchema.safeParse(userId).success ||
    !uuidSchema.safeParse(memoryId).success
  ) {
    return null;
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    throw new MemoryEmbeddingContextLoadError("configuration-unavailable");
  }

  const { data, error } = await supabase
    .from("memories")
    .select("id,user_id,content,status,deleted_at,updated_at")
    .eq("id", memoryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new MemoryEmbeddingContextLoadError("query-unavailable");
  }

  const row = data as Record<string, unknown> | null;
  const content = text(row?.content);
  const updatedAt = text(row?.updated_at);
  if (
    text(row?.id) !== memoryId ||
    text(row?.user_id) !== userId ||
    row?.status !== "active" ||
    row?.deleted_at !== null ||
    !content ||
    !updatedAt ||
    !Number.isFinite(Date.parse(updatedAt))
  ) {
    return null;
  }

  return { userId, memoryId, content, updatedAt };
}
