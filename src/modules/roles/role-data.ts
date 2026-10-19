import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { personaSnapshotSchema } from "@/server/schemas";

import {
  demoRoleWorkspace,
  type RolePresentation,
  type RoleStats,
  type RoleWorkspaceData,
} from "./role-presentation";
import type { RoleEditorData } from "./role-editor";

type RawTemplate = {
  template_key?: unknown;
  role_label?: unknown;
  short_description?: unknown;
  persona_snapshot?: unknown;
};

type RawRole = {
  id?: unknown;
  display_name?: unknown;
  role_templates?: RawTemplate | RawTemplate[] | null;
};

type RawProfile = {
  current_role_id?: unknown;
  display_name?: unknown;
  created_at?: unknown;
};

type RawEditorRole = {
  id?: unknown;
  display_name?: unknown;
  source?: unknown;
  current_persona_version_id?: unknown;
};

type RawPersonaVersion = {
  id?: unknown;
  version_no?: unknown;
  persona_snapshot?: unknown;
};

const roleDetails: Record<
  string,
  Pick<RolePresentation, "tone" | "direction" | "quote">
> = {
  lin_zhixia: {
    tone: "periwinkle",
    direction: "情感和人际关系",
    quote: "我会先听懂你的感受，再陪你把事情一点点理清。",
  },
  zhou_yuan: {
    tone: "mint",
    direction: "决策与成长",
    quote: "我会和你一起分清事实、感受和下一步。",
  },
  nanzhi: {
    tone: "cream",
    direction: "行动与习惯",
    quote: "我们从一个足够小、今天就能开始的动作出发。",
  },
};

function unavailableRoleWorkspace(): RoleWorkspaceData {
  return { ...demoRoleWorkspace, source: "unavailable" };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getTemplate(value: RawRole["role_templates"]): RawTemplate | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function roleLabel(template: RawTemplate | null): string {
  const explicitLabel = stringValue(template?.role_label);

  if (explicitLabel) {
    return explicitLabel;
  }

  const snapshot = recordValue(template?.persona_snapshot);
  const identity = recordValue(snapshot?.identity);
  return stringValue(identity?.role) ?? "陪伴角色";
}

function compactCount(count: number | null): string {
  return typeof count === "number" ? `${count} 条` : "—";
}

function companionDays(createdAt: unknown): string {
  const timestamp = stringValue(createdAt);

  if (!timestamp) {
    return "—";
  }

  const parsed = new Date(timestamp).getTime();

  if (Number.isNaN(parsed)) {
    return "—";
  }

  const elapsedDays = Math.floor((Date.now() - parsed) / 86_400_000) + 1;
  return `${Math.max(1, elapsedDays)} 天`;
}

function toRolePresentation(role: RawRole): RolePresentation | null {
  const id = stringValue(role.id);
  const name = stringValue(role.display_name);

  if (!id || !name) {
    return null;
  }

  const template = getTemplate(role.role_templates);
  const templateKey = stringValue(template?.template_key);
  const detail = templateKey ? roleDetails[templateKey] : undefined;

  return {
    id,
    templateKey,
    name,
    label: roleLabel(template),
    description: stringValue(template?.short_description) ?? "一个由你定义的陪伴角色。",
    direction: detail?.direction ?? "你的专属陪伴方式",
    quote: detail?.quote ?? "我会用适合你的方式，陪你把眼前的事情一点点理清。",
    initial: Array.from(name)[0] ?? "言",
    tone: detail?.tone ?? "periwinkle",
    stats: { chatCount: "—", memoryCount: "—", companionDays: "—" },
  };
}

async function getCurrentRoleStats(
  roleId: string,
  profileCreatedAt: unknown,
): Promise<RoleStats> {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return {
      chatCount: "—",
      memoryCount: "—",
      companionDays: companionDays(profileCreatedAt),
    };
  }

  const [messages, memories] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId)
      .is("deleted_at", null),
    supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId)
      .eq("status", "active")
      .is("deleted_at", null),
  ]);

  return {
    chatCount: compactCount(messages.error ? null : messages.count),
    memoryCount: compactCount(memories.error ? null : memories.count),
    companionDays: companionDays(profileCreatedAt),
  };
}

/**
 * Reads a minimal presentation DTO through RLS. No prompt, raw memories,
 * message text, or unrelated profile data crosses into the Client Component.
 */
export async function getRoleWorkspace(user: User | null): Promise<RoleWorkspaceData> {
  if (!user) {
    return demoRoleWorkspace;
  }

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return unavailableRoleWorkspace();
  }

  const [profileResult, rolesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("current_role_id, display_name, created_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("roles")
      .select(
        "id, display_name, role_templates(template_key, role_label, short_description, persona_snapshot)",
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  const profile = profileResult.data as RawProfile | null;
  const roles = ((rolesResult.data ?? []) as RawRole[])
    .map(toRolePresentation)
    .filter((role): role is RolePresentation => role !== null);

  if (profileResult.error || rolesResult.error || !profile || roles.length === 0) {
    return unavailableRoleWorkspace();
  }

  const currentRoleId = stringValue(profile.current_role_id);
  const selectedRole = roles.find((role) => role.id === currentRoleId) ?? roles[0];

  if (!selectedRole.id) {
    return unavailableRoleWorkspace();
  }

  const stats = await getCurrentRoleStats(selectedRole.id, profile.created_at);
  const currentRole = { ...selectedRole, stats };
  const displayName = stringValue(profile.display_name) ?? "新朋友";

  return {
    source: "database",
    roles,
    currentRole,
    viewer: {
      displayName,
      initial: Array.from(displayName)[0] ?? "言",
      companionDays: stats.companionDays,
    },
  };
}

/** Reads only the current role and its current editable persona snapshot. */
export async function getRoleEditorData(
  user: User | null,
  roleId: string,
): Promise<RoleEditorData> {
  const unavailable: RoleEditorData = {
    source: "unavailable",
    roleId: null,
    displayName: "",
    roleSource: null,
    currentPersonaVersionId: null,
    versionNo: null,
    persona: null,
  };
  if (!user || !/^[0-9a-f-]{36}$/i.test(roleId)) return unavailable;

  const supabase = await createServerSupabaseClient();
  if (!supabase) return unavailable;

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("current_role_id").eq("id", user.id).maybeSingle(),
    supabase
      .from("roles")
      .select("id, display_name, source, current_persona_version_id")
      .eq("id", roleId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const role = roleResult.data as RawEditorRole | null;
  const currentRoleId = stringValue(profileResult.data?.current_role_id);
  const personaVersionId = stringValue(role?.current_persona_version_id);

  if (
    profileResult.error ||
    roleResult.error ||
    !role ||
    currentRoleId !== roleId ||
    !personaVersionId
  ) {
    return unavailable;
  }

  const personaResult = await supabase
    .from("persona_versions")
    .select("id, version_no, persona_snapshot")
    .eq("id", personaVersionId)
    .eq("role_id", roleId)
    .eq("user_id", user.id)
    .maybeSingle();
  const personaVersion = personaResult.data as RawPersonaVersion | null;
  const persona = personaSnapshotSchema.safeParse(personaVersion?.persona_snapshot);
  const source = stringValue(role.source);
  const displayName = stringValue(role.display_name);

  if (
    personaResult.error ||
    !personaVersion ||
    !persona.success ||
    !displayName ||
    (source !== "system_template" && source !== "custom")
  ) {
    return unavailable;
  }

  return {
    source: "database",
    roleId,
    displayName,
    roleSource: source,
    currentPersonaVersionId: personaVersionId,
    versionNo:
      typeof personaVersion.version_no === "number" ? personaVersion.version_no : null,
    persona: persona.data,
  };
}
