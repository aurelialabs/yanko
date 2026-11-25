"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, type FormEvent } from "react";

import { completeOnboarding } from "@/app/onboarding/actions";
import { demoRoleKey, updateDemoSession } from "@/modules/demo/demo-session";
import type { RoleWorkspaceData } from "@/modules/roles/role-presentation";
import { rememberGuestOnboarding } from "./guest-onboarding";
import "./onboarding.css";

export function OnboardingScreen({ workspace }: { workspace: RoleWorkspaceData }) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [guestError, setGuestError] = useState("");
  const [guestPending, setGuestPending] = useState(false);
  const [state, action, pending] = useActionState(completeOnboarding, { message: "" });
  const chosen = workspace.roles.find(
    (role) => (role.id || demoRoleKey(role)) === selected,
  );
  const unavailable = workspace.source === "unavailable";

  function beginGuest(event: FormEvent<HTMLFormElement>) {
    if (workspace.source !== "demo") return;
    event.preventDefault();
    if (!chosen) return;
    try {
      updateDemoSession((current) => ({
        ...current,
        activeRoleKey: demoRoleKey(chosen),
      }));
      rememberGuestOnboarding();
      setGuestPending(true);
      router.replace("/chat");
    } catch {
      setGuestError("浏览器暂时无法保存选择，请允许网站存储后重试。");
    }
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <Link href="/" className="entry-brand">
          <span aria-hidden="true">✦</span> Yanko
        </Link>
      </header>
      <section className="onboarding-content" aria-labelledby="onboarding-title">
        <h1 id="onboarding-title">
          你想和谁，
          <br />
          一起开始？
        </h1>
        {unavailable ? (
          <p role="alert">伙伴信息暂时没有加载好，请刷新后重试。</p>
        ) : (
          <form
            action={workspace.source === "database" ? action : undefined}
            onSubmit={beginGuest}
          >
            <input type="hidden" name="roleId" value={chosen?.id || ""} />
            <fieldset className="onboarding-choices" disabled={pending || guestPending}>
              <legend className="sr-only">选择 AI 陪伴助手</legend>
              {workspace.roles.map((role) => {
                const key = role.id || demoRoleKey(role);
                return (
                  <label
                    className="onboarding-role"
                    data-tone={role.tone}
                    data-selected={selected === key || undefined}
                    key={key}
                  >
                    <input
                      type="radio"
                      name="companion"
                      value={key}
                      checked={selected === key}
                      onChange={() => setSelected(key)}
                    />
                    <span className="onboarding-role-top">
                      <span className="onboarding-avatar" aria-hidden="true">
                        {role.initial}
                      </span>
                      <span className="onboarding-check" aria-hidden="true">
                        {selected === key ? "✓" : ""}
                      </span>
                    </span>
                    <span className="onboarding-role-label">{role.label}</span>
                    <strong>{role.name}</strong>
                    <span className="onboarding-description">{role.description}</span>
                  </label>
                );
              })}
            </fieldset>
            <div className="onboarding-confirm">
              <button
                className="entry-primary"
                type="submit"
                disabled={!chosen || pending || guestPending}
              >
                {pending || guestPending
                  ? "正在准备你的陪伴…"
                  : chosen
                    ? `和${chosen.name}开始聊天`
                    : "选择一位伙伴"}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
            {state.message || guestError ? (
              <p className="onboarding-error" role="alert">
                {state.message || guestError}
              </p>
            ) : null}
          </form>
        )}
      </section>
    </main>
  );
}
