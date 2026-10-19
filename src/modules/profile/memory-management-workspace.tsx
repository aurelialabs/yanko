"use client";

import Link from "next/link";
import { startTransition, useActionState, useMemo, useState } from "react";

import { deleteMemory, replaceMemory } from "@/app/me/actions";
import { applyDemoMemories } from "@/modules/demo/demo-session";
import { useDemoSession } from "@/modules/demo/use-demo-session";
import { initialMemoryActionState } from "@/modules/profile/memory-action-state";
import { AppShell } from "@/modules/shell/app-shell";

import {
  memoryCategoryLabel,
  type ActiveMemoryPresentation,
  type MemoryManagementData,
} from "./memory-presentation";

function dateLabel(value: string | null): string {
  if (!value) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function MemoryEditor({
  memory,
  data,
}: {
  memory: ActiveMemoryPresentation;
  data: MemoryManagementData;
}) {
  const [content, setContent] = useState(memory.content);
  const [scope, setScope] = useState(memory.scope);
  const [roleId, setRoleId] = useState(memory.roleId ?? data.roles[0]?.id ?? "");
  const [updateKey] = useState(() => `memory-update-${crypto.randomUUID()}`);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(
    replaceMemory,
    initialMemoryActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteMemory,
    initialMemoryActionState,
  );
  const [localSaved, setLocalSaved] = useState(false);
  const [localDeleted, setLocalDeleted] = useState(false);
  const { update } = useDemoSession();
  const demo = data.source === "demo";

  if (deleteState.succeeded || localDeleted) {
    return (
      <article className="memory-management-card" data-state="deleted">
        <strong>这条记忆已删除</strong>
        <p>后续回复不会再召回它。</p>
      </article>
    );
  }

  return (
    <article className="memory-management-card">
      <header>
        <span className="memory-scope-badge">
          {memory.scope === "user_shared"
            ? "所有角色共享"
            : `仅${memory.roleName ?? "当前角色"}`}
        </span>
        {memory.confirmedByUser ? <small>用户已确认</small> : <small>自动记忆</small>}
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (demo) {
            update((current) => {
              if (current.extraMemories.some((item) => item.id === memory.id)) {
                return {
                  ...current,
                  extraMemories: current.extraMemories.map((item) =>
                    item.id === memory.id
                      ? {
                          ...item,
                          content,
                          scope,
                          roleId: scope === "role_private" ? roleId : null,
                        }
                      : item,
                  ),
                };
              }
              return {
                ...current,
                memoryEdits: {
                  ...current.memoryEdits,
                  [memory.id]: {
                    content,
                    scope,
                    roleId: scope === "role_private" ? roleId : null,
                  },
                },
              };
            });
            setLocalSaved(true);
            return;
          }
          startTransition(() => updateAction(new FormData(event.currentTarget)));
        }}
      >
        <input name="memoryId" type="hidden" value={memory.id} />
        <input name="idempotencyKey" type="hidden" value={updateKey} />
        <label>
          记忆内容
          <textarea
            maxLength={5000}
            name="content"
            required
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
          />
        </label>
        <label>
          作用范围
          <select
            name="scope"
            value={scope}
            onChange={(event) => setScope(event.currentTarget.value as typeof scope)}
          >
            <option value="role_private">角色专属</option>
            {memory.sensitivity === "normal" ? (
              <option value="user_shared">所有角色共享</option>
            ) : null}
          </select>
        </label>
        {scope === "role_private" ? (
          <label>
            指定角色
            <select
              disabled={memory.sensitivity === "sensitive"}
              name="roleId"
              required
              value={roleId}
              onChange={(event) => setRoleId(event.currentTarget.value)}
            >
              {data.roles
                .filter(
                  (role) =>
                    memory.sensitivity !== "sensitive" || role.id === memory.roleId,
                )
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
            {memory.sensitivity === "sensitive" ? (
              <small>敏感记忆不能移动到其他角色。</small>
            ) : null}
          </label>
        ) : (
          <>
            <input name="roleId" type="hidden" value="" />
            {memory.scope === "role_private" ? (
              <label className="memory-sharing-confirmation">
                <input name="sharingConfirmed" required type="checkbox" value="true" />
                我确认这条记忆将对全部角色可见
              </label>
            ) : null}
          </>
        )}
        {updateState.message ? (
          <p className="memory-action-error" role="alert">
            {updateState.message}
          </p>
        ) : updateState.succeeded || localSaved ? (
          <p className="memory-action-success" role="status">
            {demo ? "已保存在这台浏览器里。" : "已保存修改，旧内容仍保留在变化历史中。"}
          </p>
        ) : null}
        <footer>
          <button disabled={updatePending || deletePending} type="submit">
            {updatePending ? "保存中…" : "保存修改"}
          </button>
          <button
            className="memory-delete-trigger"
            disabled={updatePending || deletePending}
            type="button"
            onClick={() => {
              if (demo) {
                update((current) => ({
                  ...current,
                  extraMemories: current.extraMemories.filter((item) => item.id !== memory.id),
                  memoryEdits: {
                    ...current.memoryEdits,
                    [memory.id]: {
                      content,
                      scope,
                      roleId: scope === "role_private" ? roleId : null,
                      deleted: true,
                    },
                  },
                }));
                setLocalDeleted(true);
                return;
              }
              setDeleteOpen(true);
            }}
          >
            删除
          </button>
        </footer>
      </form>

      {memory.history.length ? (
        <details className="memory-history">
          <summary>查看变化历史（{memory.history.length}）</summary>
          <ol>
            {memory.history.map((item) => (
              <li key={item.id}>
                <p>{item.content}</p>
                <small>
                  {dateLabel(item.validFrom)} — {dateLabel(item.validTo)}
                </small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {deleteOpen ? (
        <form
          className="memory-delete-confirmation"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => deleteAction(new FormData(event.currentTarget)));
          }}
        >
          <input name="memoryId" type="hidden" value={memory.id} />
          <input
            name="idempotencyKey"
            type="hidden"
            value={`memory-delete-${memory.id}`}
          />
          <input name="confirmDeletion" type="hidden" value="true" />
          <p>删除后，这条记忆会立即停止参与后续回复。确定删除吗？</p>
          {deleteState.message ? (
            <p className="memory-action-error" role="alert">
              {deleteState.message}
            </p>
          ) : null}
          <div>
            <button
              disabled={deletePending}
              type="button"
              onClick={() => setDeleteOpen(false)}
            >
              取消
            </button>
            <button disabled={deletePending} type="submit">
              {deletePending ? "删除中…" : "确认删除"}
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

export function MemoryManagementWorkspace({ data }: { data: MemoryManagementData }) {
  const { session } = useDemoSession();
  const visibleData = applyDemoMemories(data, session);
  const [scopeFilter, setScopeFilter] = useState("all");
  const filtered = useMemo(
    () =>
      visibleData.memories.filter((memory) => {
        if (scopeFilter === "all") return true;
        if (scopeFilter === "user_shared") return memory.scope === "user_shared";
        return memory.scope === "role_private" && memory.roleId === scopeFilter;
      }),
    [visibleData.memories, scopeFilter],
  );
  const grouped = useMemo(() => {
    const groups = new Map<string, ActiveMemoryPresentation[]>();
    for (const memory of filtered) {
      const label = memoryCategoryLabel(memory.category);
      groups.set(label, [...(groups.get(label) ?? []), memory]);
    }
    return [...groups.entries()];
  }, [filtered]);

  return (
    <AppShell current="me">
      <section className="memory-management-page" aria-labelledby="memory-page-title">
        <header className="memory-management-header">
          <div>
            <Link href="/me">← 返回我的</Link>
            <h1 id="memory-page-title">记忆管理</h1>
            <p>只有当前有效的长期记忆会参与后续回复，你可以随时修改或删除。</p>
            {data.source === "demo" ? <p>修改会留在这台浏览器里，刷新后仍然在。</p> : null}
          </div>
        </header>

        {data.source === "unavailable" ? (
          <p className="memory-data-unavailable" role="alert">
            记忆服务仍在准备中，请稍后刷新页面。
          </p>
        ) : (
          <>
            <nav className="memory-scope-tabs" aria-label="按作用范围筛选">
              <button
                data-active={scopeFilter === "all" || undefined}
                type="button"
                onClick={() => setScopeFilter("all")}
              >
                全部
              </button>
              <button
                data-active={scopeFilter === "user_shared" || undefined}
                type="button"
                onClick={() => setScopeFilter("user_shared")}
              >
                用户共享
              </button>
              {data.roles.map((role) => (
                <button
                  data-active={scopeFilter === role.id || undefined}
                  key={role.id}
                  type="button"
                  onClick={() => setScopeFilter(role.id)}
                >
                  {role.name}
                </button>
              ))}
            </nav>

            {grouped.length ? (
              <div className="memory-groups">
                {grouped.map(([label, memories]) => (
                  <section key={label} aria-labelledby={`memory-group-${label}`}>
                    <h2 id={`memory-group-${label}`}>{label}</h2>
                    <div className="memory-management-list">
                      {memories.map((memory) => (
                        <MemoryEditor data={visibleData} key={memory.id} memory={memory} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="memory-empty-state">
                <strong>这里还没有长期记忆</strong>
                <p>当你确认保存，或系统安全地写入长期信息后，会显示在这里。</p>
                <Link href="/chat">返回聊天</Link>
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
