"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useState } from "react";

import { signOut } from "@/app/auth/actions";
import { useDemoSession } from "@/modules/demo/use-demo-session";
import { deleteMyAccount } from "@/app/me/account-actions";
import { AppShell } from "@/modules/shell/app-shell";
import { initialAccountDeletionActionState } from "@/modules/profile/account-action-state";

type ProfilePanel = "privacy" | "appearance";
type ProfileItemId = "memory" | "reminders" | ProfilePanel;

const profileItems: ReadonlyArray<{
  id: ProfileItemId;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    id: "memory",
    title: "记忆管理",
    description: "查看、修改与删除",
    icon: "◆",
  },
  {
    id: "reminders",
    title: "应用内提醒",
    description: "查看计划提醒",
    icon: "◌",
  },
  { id: "privacy", title: "账号与隐私", description: "邮箱、数据与隐私", icon: "●" },
  { id: "appearance", title: "外观偏好", description: "主题 · 字体大小", icon: "✦" },
];

function maskEmail(email: string) {
  const [localPart, domain] = email.split("@");

  if (!localPart || !domain) {
    return email;
  }

  return `${localPart.slice(0, Math.min(3, localPart.length))}***@${domain}`;
}

function AccountDeletionDialog({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(
    deleteMyAccount,
    initialAccountDeletionActionState,
  );

  return (
    <div className="account-deletion-backdrop" role="presentation">
      <section
        aria-describedby="account-deletion-description"
        aria-labelledby="account-deletion-title"
        aria-modal="true"
        className="account-deletion-dialog"
        role="dialog"
      >
        <p className="account-deletion-eyebrow">不可撤销的操作</p>
        <h2 id="account-deletion-title">删除账号和全部个人数据</h2>
        <p id="account-deletion-description">
          删除后，角色、人设版本、聊天、记忆、计划、反馈和提醒都会被永久清除，无法恢复。
        </p>
        <form action={action}>
          <label className="account-deletion-check">
            <input name="acknowledged" required type="checkbox" value="true" />
            <span>我理解删除后无法恢复，也已自行导出需要保留的数据。</span>
          </label>
          <label className="account-deletion-confirmation">
            <span>请输入“删除我的账号”以继续</span>
            <input
              autoComplete="off"
              disabled={pending}
              name="confirmation"
              placeholder="删除我的账号"
              required
              type="text"
            />
          </label>
          {state.message ? (
            <p className="account-deletion-error" role="alert">
              {state.message}
            </p>
          ) : null}
          <footer>
            <button disabled={pending} onClick={onClose} type="button">
              取消
            </button>
            <button disabled={pending} type="submit">
              {pending ? "正在删除…" : "永久删除账号"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PrivacyPanel({
  email,
  isAuthenticated,
}: {
  email?: string;
  isAuthenticated: boolean;
}) {
  const [isDeletionDialogOpen, setDeletionDialogOpen] = useState(false);

  return (
    <>
      <section className="profile-detail-card" aria-labelledby="privacy-title">
        <h2 id="privacy-title">账号与隐私</h2>
        <article className="profile-memory-callout">
          <strong>你的聊天和记忆由你管理</strong>
          <p>你可以查看、导出或删除自己的数据；我们不会将它用于公开展示。</p>
        </article>

        <p className="profile-detail-label">账号</p>
        <div className="profile-email-row">
          <span>
            <strong>邮箱</strong>
            <small>用于安全登录和接收邮件</small>
          </span>
          <span>{email ? maskEmail(email) : "yan***@gmail.com"}</span>
        </div>

        <p className="profile-detail-label">数据管理</p>
        <a className="profile-data-action" download href="/me/export">
          <span className="profile-data-icon" aria-hidden="true">
            ↓
          </span>
          <span>
            <strong>导出我的数据</strong>
            <small>下载聊天、记忆、计划与反馈副本</small>
          </span>
          <i aria-hidden="true">›</i>
        </a>
        <article className="profile-unavailable-action" role="note">
          <span className="profile-data-icon" aria-hidden="true">
            ＋
          </span>
          <span>
            <strong>清除聊天记录</strong>
            <small>聊天删除后的记忆与计划保留规则仍在制定，暂不提供此操作。</small>
          </span>
        </article>
        <button
          className="profile-delete-action"
          type="button"
          onClick={() => setDeletionDialogOpen(true)}
        >
          <span>
            <strong>删除账号</strong>
            <small>此操作不可撤销</small>
          </span>
          <i aria-hidden="true">›</i>
        </button>
        {isAuthenticated ? (
          <form action={signOut}>
            <button className="profile-data-action" type="submit">
              <span className="profile-data-icon" aria-hidden="true">
                ↗
              </span>
              <span>
                <strong>退出登录</strong>
                <small>在这台设备上结束当前会话</small>
              </span>
              <i aria-hidden="true">›</i>
            </button>
          </form>
        ) : null}
      </section>
      {isDeletionDialogOpen ? (
        <AccountDeletionDialog onClose={() => setDeletionDialogOpen(false)} />
      ) : null}
    </>
  );
}

function AppearancePanel() {
  const { session, update } = useDemoSession();

  return (
    <section className="profile-detail-card" aria-labelledby="appearance-title">
      <h2 id="appearance-title">外观偏好</h2>
      <p>主题和字号会立刻生效，并留在这台浏览器里。</p>
      <div className="appearance-choices">
        <fieldset>
          <legend>主题</legend>
          <label>
            <input
              checked={session.theme === "light"}
              name="theme"
              type="radio"
              onChange={() => update((current) => ({ ...current, theme: "light" }))}
            />
            浅色
          </label>
          <label>
            <input
              checked={session.theme === "dark"}
              name="theme"
              type="radio"
              onChange={() => update((current) => ({ ...current, theme: "dark" }))}
            />
            深色
          </label>
        </fieldset>
        <fieldset>
          <legend>字体大小</legend>
          {(
            [
              ["small", "较小"],
              ["default", "标准"],
              ["large", "较大"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                checked={session.fontScale === value}
                name="fontScale"
                type="radio"
                onChange={() => update((current) => ({ ...current, fontScale: value }))}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  );
}

export function ProfileWorkspace({
  email,
  isAuthenticated = false,
}: {
  email?: string;
  isAuthenticated?: boolean;
}) {
  const { session, update } = useDemoSession();
  const [activePanel, setActivePanel] = useState<ProfilePanel>("privacy");
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(session.displayName);
  const displayName = session.displayName || "小屿";
  const initial = displayName.slice(0, 1) || "屿";

  return (
    <AppShell
      current="me"
      viewer={{ displayName, initial, companionDays: "42 天" }}
    >
      <section className="profile-workspace" aria-labelledby="profile-page-title">
        <header className="profile-page-header">
          <h1 id="profile-page-title">我的</h1>
          <button type="button" onClick={() => {
            setNameDraft(displayName);
            setEditingProfile(true);
          }}>
            编辑资料
          </button>
        </header>

        <div className="profile-content">
          <section className="profile-hero" aria-label="个人概览">
            <span className="profile-hero-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="profile-hero-copy">
              <strong>{displayName}</strong>
              <span>已陪伴 42 天 · 完成 36 个计划</span>
            </span>
            <span className="profile-hero-stat">
              <strong>42</strong>
              <small>陪伴天数</small>
            </span>
            <span className="profile-hero-stat" data-tone="cream">
              <strong>36</strong>
              <small>完成计划</small>
            </span>
          </section>

          {isAuthenticated ? null : (
            <section className="feedback-review" aria-label="反馈复核">
              <header>
                <h2>反馈复核</h2>
                <p>长按角色回复提交的反馈会留在这台浏览器里，状态为待复核。</p>
              </header>
              {session.feedbackQueue.length ? (
                <ul>
                  {session.feedbackQueue.map((item) => (
                    <li key={item.id}>
                      <span>待复核</span>
                      <strong>{item.reason}</strong>
                      <p>{item.roleName}：{item.excerpt}</p>
                      {item.note ? <small>{item.note}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="feedback-review-empty">当前没有待复核反馈。</p>
              )}
            </section>
          )}

          <div className="profile-desktop-grid">
            <nav className="profile-settings-nav" aria-label="偏好设置">
              <p>偏好设置</p>
              {profileItems.map((item) =>
                item.id === "memory" || item.id === "reminders" ? (
                  <Link
                    className="profile-settings-item"
                    href={
                      (item.id === "memory"
                        ? "/me/memories"
                        : "/me/notifications") as Route
                    }
                    key={item.id}
                  >
                    <span className="profile-settings-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <i aria-hidden="true">›</i>
                  </Link>
                ) : (
                  <button
                    className="profile-settings-item"
                    data-active={activePanel === item.id || undefined}
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === "privacy" || item.id === "appearance") {
                        setActivePanel(item.id);
                      }
                    }}
                  >
                    <span className="profile-settings-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                ),
              )}
              <small className="profile-version">V0.1.0 · Web/PWA</small>
            </nav>

            {activePanel === "privacy" ? (
              <PrivacyPanel email={email} isAuthenticated={isAuthenticated} />
            ) : (
              <AppearancePanel />
            )}
          </div>
        </div>
      </section>
      {editingProfile ? (
        <div
          aria-labelledby="profile-edit-title"
          aria-modal="true"
          className="plan-create-backdrop"
          role="dialog"
        >
          <section className="plan-create-dialog">
            <header>
              <h2 id="profile-edit-title">编辑资料</h2>
              <button
                aria-label="关闭编辑资料"
                type="button"
                onClick={() => setEditingProfile(false)}
              >
                ×
              </button>
            </header>
            <form
              className="profile-edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                const nextName = nameDraft.trim();
                if (!nextName) return;
                update((current) => ({ ...current, displayName: nextName.slice(0, 20) }));
                setEditingProfile(false);
              }}
            >
              <label>
                怎么称呼你
                <input
                  maxLength={20}
                  required
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                />
              </label>
              <p>这个称呼会留在这台浏览器里，聊天和侧栏都会使用它。</p>
              <footer>
                <button type="button" onClick={() => setEditingProfile(false)}>
                  取消
                </button>
                <button type="submit">保存</button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
