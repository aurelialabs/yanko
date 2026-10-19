import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/server/schemas";

import {
  demoMemoryManagementData,
  type ActiveMemoryPresentation,
  type MemoryHistoryPresentation,
  type MemoryManagementData,
  type MemoryRoleOption,
  type PendingMemoryCandidatePresentation,
} from "./memory-presentation";

type RawRole = {
  id?: unknown;
  display_name?: unknown;
  status?: unknown;
};

type RawSourceMessage = {
  id?: unknown;
  role_id?: unknown;
  sender?: unknown;
  status?: unknown;
  deleted_at?: unknown;
};

type RawCandidate = {
  [key: string]: unknown;
  id?: unknown;
  role_id?: unknown;
  source_message_id?: unknown;
  suggested_scope?: unknown;
  category?: unknown;
  content?: unknown;
  sensitivity?: unknown;
  status?: unknown;
  expires_at?: unknown;
};

type RawMemory = {
  [key: string]: unknown;
  id?: unknown;
  scope?: unknown;
  role_id?: unknown;
  category?: unknown;
  content?: unknown;
  sensitivity?: unknown;
  status?: unknown;
  confirmed_by_user?: unknown;
  valid_from?: unknown;
  valid_to?: unknown;
  supersedes_memory_id?: unknown;
  deleted_at?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoDateTime(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const date = new Date(candidate);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function toRole(value: RawRole): MemoryRoleOption | null {
  const id = text(value.id);
  const name = text(value.display_name);
  return id && name && value.status === "active" ? { id, name } : null;
}

/**
 * Reads only pending candidates whose source user message belongs to the
 * current role. Shared candidates still stay attached to the role where the
 * user originally said the source fact.
 */
export async function getPendingMemoryCandidates(
  user: User | null,
  currentRoleId: string | null,
): Promise<PendingMemoryCandidatePresentation[]> {
  if (!user || !currentRoleId || !uuidSchema.safeParse(currentRoleId).success) {
    return [];
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const [profileResult, roleResult, candidateResult] = await Promise.all([
    supabase.from("profiles").select("current_role_id").eq("id", user.id).maybeSingle(),
    supabase
      .from("roles")
      .select("id, display_name, status")
      .eq("id", currentRoleId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("memory_candidates")
      .select(
        "id, role_id, source_message_id, suggested_scope, category, content, sensitivity, status, expires_at",
      )
      .eq("user_id", user.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  const role = roleResult.data as RawRole | null;
  const roleName = text(role?.display_name);
  if (
    profileResult.error ||
    roleResult.error ||
    candidateResult.error ||
    text(profileResult.data?.current_role_id) !== currentRoleId ||
    text(role?.id) !== currentRoleId ||
    role?.status !== "active" ||
    !roleName
  ) {
    return [];
  }

  const candidates = (candidateResult.data ?? []) as RawCandidate[];
  const sourceIds = candidates
    .map((candidate) => text(candidate.source_message_id))
    .filter((id): id is string => id !== null);
  if (!sourceIds.length) return [];

  const { data: sourceRows, error: sourceError } = await supabase
    .from("messages")
    .select("id, role_id, sender, status, deleted_at")
    .eq("user_id", user.id)
    .eq("role_id", currentRoleId)
    .eq("sender", "user")
    .eq("status", "completed")
    .is("deleted_at", null)
    .in("id", sourceIds);
  if (sourceError) return [];

  const validSourceIds = new Set(
    ((sourceRows ?? []) as RawSourceMessage[])
      .filter(
        (message) =>
          text(message.role_id) === currentRoleId &&
          message.sender === "user" &&
          message.status === "completed" &&
          message.deleted_at === null,
      )
      .map((message) => text(message.id))
      .filter((id): id is string => id !== null),
  );

  return buildPendingMemoryCandidates(
    candidates,
    validSourceIds,
    currentRoleId,
    roleName,
  );
}

export function buildPendingMemoryCandidates(
  candidates: readonly RawCandidate[],
  validSourceIds: ReadonlySet<string>,
  currentRoleId: string,
  roleName: string,
): PendingMemoryCandidatePresentation[] {
  return candidates.flatMap((candidate) => {
    const id = text(candidate.id);
    const sourceMessageId = text(candidate.source_message_id);
    const roleId = optionalText(candidate.role_id);
    const scope = text(candidate.suggested_scope);
    const category = text(candidate.category);
    const content = text(candidate.content);
    const sensitivity = text(candidate.sensitivity);
    const expiresAt = isoDateTime(candidate.expires_at);

    if (
      !id ||
      !sourceMessageId ||
      !validSourceIds.has(sourceMessageId) ||
      !category ||
      !content ||
      !expiresAt ||
      candidate.status !== "pending" ||
      !["user_shared", "role_private"].includes(scope ?? "") ||
      !["normal", "sensitive"].includes(sensitivity ?? "") ||
      (scope === "user_shared" && roleId !== null) ||
      (scope === "role_private" && roleId !== currentRoleId) ||
      (sensitivity === "sensitive" && scope !== "role_private")
    ) {
      return [];
    }

    return [
      {
        id,
        content,
        category,
        suggestedScope: scope as PendingMemoryCandidatePresentation["suggestedScope"],
        roleId,
        roleName,
        sensitivity: sensitivity as PendingMemoryCandidatePresentation["sensitivity"],
        expiresAt,
      },
    ];
  });
}

function toHistory(value: RawMemory): MemoryHistoryPresentation | null {
  const id = text(value.id);
  const content = text(value.content);
  const status = text(value.status);
  if (!id || !content || !["active", "superseded"].includes(status ?? "")) {
    return null;
  }

  return {
    id,
    content,
    status: status as MemoryHistoryPresentation["status"],
    validFrom: isoDateTime(value.valid_from),
    validTo: isoDateTime(value.valid_to),
  };
}

export async function getMemoryManagementData(
  user: User | null,
): Promise<MemoryManagementData> {
  if (!user) return demoMemoryManagementData;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { source: "unavailable", roles: [], memories: [] };

  const [rolesResult, memoriesResult] = await Promise.all([
    supabase
      .from("roles")
      .select("id, display_name, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase
      .from("memories")
      .select(
        "id, scope, role_id, category, content, sensitivity, status, confirmed_by_user, valid_from, valid_to, supersedes_memory_id, deleted_at",
      )
      .eq("user_id", user.id)
      .in("status", ["active", "superseded"])
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);

  if (rolesResult.error || memoriesResult.error) {
    return { source: "unavailable", roles: [], memories: [] };
  }

  const built = buildMemoryManagementData(
    (rolesResult.data ?? []) as RawRole[],
    (memoriesResult.data ?? []) as RawMemory[],
  );
  return { source: "database", ...built };
}

export function buildMemoryManagementData(
  roleRows: readonly RawRole[],
  rows: readonly RawMemory[],
): Pick<MemoryManagementData, "roles" | "memories"> {
  const roles = roleRows
    .map(toRole)
    .filter((role): role is MemoryRoleOption => role !== null);
  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  const rowsById = new Map(
    rows.flatMap((row) => {
      const id = text(row.id);
      return id ? [[id, row] as const] : [];
    }),
  );

  const memories = rows.flatMap((row): ActiveMemoryPresentation[] => {
    const id = text(row.id);
    const scope = text(row.scope);
    const roleId = optionalText(row.role_id);
    const category = text(row.category);
    const content = text(row.content);
    const sensitivity = text(row.sensitivity);
    if (
      !id ||
      !category ||
      !content ||
      row.status !== "active" ||
      row.deleted_at !== null ||
      typeof row.confirmed_by_user !== "boolean" ||
      !["user_shared", "role_private"].includes(scope ?? "") ||
      !["normal", "sensitive"].includes(sensitivity ?? "") ||
      (scope === "user_shared" && roleId !== null) ||
      (scope === "role_private" && (!roleId || !roleNames.has(roleId)))
    ) {
      return [];
    }

    const history: MemoryHistoryPresentation[] = [];
    const visited = new Set<string>([id]);
    let previousId = optionalText(row.supersedes_memory_id);
    while (previousId && history.length < 20 && !visited.has(previousId)) {
      visited.add(previousId);
      const previous = rowsById.get(previousId);
      if (!previous) break;
      if (text(previous.scope) !== scope || optionalText(previous.role_id) !== roleId) {
        break;
      }
      const item = toHistory(previous);
      if (!item) break;
      history.push(item);
      previousId = optionalText(previous.supersedes_memory_id);
    }

    return [
      {
        id,
        content,
        category,
        scope: scope as ActiveMemoryPresentation["scope"],
        roleId,
        roleName: roleId ? (roleNames.get(roleId) ?? null) : null,
        sensitivity: sensitivity as ActiveMemoryPresentation["sensitivity"],
        confirmedByUser: row.confirmed_by_user,
        validFrom: isoDateTime(row.valid_from),
        history,
      },
    ];
  });

  return { roles, memories };
}
