"use client";

import type { Route } from "next";
import Link from "next/link";
import { useActionState } from "react";

import { selectCurrentRole } from "@/app/roles/actions";
import { demoRoleKey, type DemoCustomRole } from "@/modules/demo/demo-session";
import { useDemoSession } from "@/modules/demo/use-demo-session";
import { initialRoleSelectionState } from "@/modules/roles/role-action-state";
import { AppShell } from "@/modules/shell/app-shell";

import type { RolePresentation, RoleWorkspaceData } from "./role-presentation";

function RoleChoice({
  role,
  selected,
  canPersist,
  pending,
  action,
  onSelect,
}: {
  role: RolePresentation;
  selected: boolean;
  canPersist: boolean;
  pending: boolean;
  action: (formData: FormData) => void;
  onSelect: (role: RolePresentation) => void;
}) {
  const content = (
    <>
      <span className="role-avatar" data-tone={role.tone} aria-hidden="true">
        {role.initial}
      </span>
      <span className="role-choice-copy">
        <span className="role-choice-title">
          <strong>{role.name}</strong>
          <small data-tone={role.tone}>{role.label}</small>
        </span>
        <span>{role.description}</span>
        <em>陪伴方向 · {role.direction}</em>
      </span>
      <span className="role-choice-action">
        {selected ? "使用中" : pending ? "切换中" : "切换"}
      </span>
    </>
  );

  if (!canPersist || !role.id) {
    return (
      <button
        className="role-choice-card"
        data-selected={selected || undefined}
        type="button"
        onClick={() => onSelect(role)}
      >
        {content}
      </button>
    );
  }

  return (
    <form action={action} className="role-choice-form">
      <input name="roleId" type="hidden" value={role.id} />
      <button
        aria-pressed={selected}
        className="role-choice-card"
        data-selected={selected || undefined}
        disabled={pending || selected}
        type="submit"
      >
        {content}
      </button>
    </form>
  );
}

export function RolesWorkspace({ workspace }: { workspace: RoleWorkspaceData }) {
  const { session, update } = useDemoSession();
  const [state, action, pending] = useActionState(
    selectCurrentRole,
    initialRoleSelectionState,
  );
  const customRoles: RolePresentation[] = session.customRoles.map((role: DemoCustomRole) => ({
    id: role.id,
    templateKey: null,
    name: role.name,
    label: role.label,
    description: role.description,
    direction: "自定义陪伴",
    quote: role.quote,
    initial: role.name.slice(0, 1) || "角",
    tone: "periwinkle",
    stats: { chatCount: "新角色", memoryCount: "0 条", companionDays: "刚刚" },
  }));
  const roles =
    workspace.source === "demo" ? [...workspace.roles, ...customRoles] : workspace.roles;
  const currentRole =
    workspace.source === "demo"
      ? (roles.find((role) => demoRoleKey(role) === session.activeRoleKey) ??
        workspace.currentRole)
      : workspace.currentRole;

  function selectDemoRole(role: RolePresentation) {
    update((current) => ({ ...current, activeRoleKey: demoRoleKey(role) }));
    window.location.assign("/chat");
  }

  return (
    <AppShell current="roles" roles={roles} viewer={workspace.viewer}>
      <section className="roles-page" aria-labelledby="roles-page-title">
        <header className="roles-page-header">
          <h1 id="roles-page-title">角色</h1>
          <Link
            className="roles-manage-button"
            href={
              workspace.source === "database" && currentRole.id
                ? (`/roles/${currentRole.id}/edit` as Route)
                : "/roles"
            }
          >
            管理角色
          </Link>
        </header>

        <div className="roles-content">
          <article className="roles-intro">
            <h2>选择今天陪伴你的人</h2>
            <p>每个角色都有自己的聊天、关系和专属记忆；计划也能共享。</p>
          </article>

          <div className="roles-desktop-grid">
            <section className="roles-choice-list" aria-label="陪伴角色">
              {roles.map((role) => (
                <RoleChoice
                  action={action}
                  canPersist={workspace.source === "database"}
                  key={role.id ?? role.name}
                  onSelect={selectDemoRole}
                  pending={pending}
                  role={role}
                  selected={
                    workspace.source === "demo"
                      ? demoRoleKey(role) === session.activeRoleKey
                      : role.id === currentRole.id && role.name === currentRole.name
                  }
                />
              ))}
              {workspace.source === "unavailable" ? (
                <p className="role-selection-message" role="alert">
                  角色数据仍在准备中，请稍后刷新页面。
                </p>
              ) : state.message ? (
                <p className="role-selection-message" role="alert">
                  {state.message}
                </p>
              ) : null}
              <Link className="role-create-card" href={"/roles/new" as Route}>
                <span aria-hidden="true">＋</span>
                <span>
                  <strong>创建自己的角色</strong>
                  <small>昵称、关系与陪伴方式都可以自定义</small>
                </span>
                <i aria-hidden="true">›</i>
              </Link>
            </section>

            <aside className="current-role-panel" aria-label="当前角色详情">
              <p>当前角色</p>
              <span
                className="role-avatar"
                data-tone={currentRole.tone}
                aria-hidden="true"
              >
                {currentRole.initial}
              </span>
              <h2>{currentRole.name}</h2>
              <span className="current-role-label">{currentRole.label}</span>
              <blockquote>“{currentRole.quote}”</blockquote>
              <p className="current-role-stats-title">角色数据</p>
              <dl className="current-role-stats">
                <div>
                  <dt>聊天</dt>
                  <dd>{currentRole.stats.chatCount}</dd>
                </div>
                <div>
                  <dt>专属记忆</dt>
                  <dd>{currentRole.stats.memoryCount}</dd>
                </div>
                <div>
                  <dt>陪伴天数</dt>
                  <dd>{currentRole.stats.companionDays}</dd>
                </div>
              </dl>
              <Link
                className="current-role-edit"
                href={
                  workspace.source === "database" && currentRole.id
                    ? (`/roles/${currentRole.id}/edit` as Route)
                    : "/roles"
                }
              >
                编辑和调整这个角色
              </Link>
            </aside>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
