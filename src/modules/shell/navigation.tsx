"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { defaultDemoSession, demoRoleKey } from "@/modules/demo/demo-session";
import { useDemoSession } from "@/modules/demo/use-demo-session";

export type AppSection = "chat" | "plan" | "me" | "roles";
export type ShellRole = {
  id: string | null;
  name: string;
  initial: string;
  tone: "periwinkle" | "mint" | "cream";
};
export type ShellViewer = {
  displayName: string;
  initial: string;
  companionDays: string;
};

const mobileItems: ReadonlyArray<{
  key: AppSection;
  label: string;
  href: "/chat" | "/plan" | "/me";
  icon: string;
}> = [
  { key: "chat", label: "聊天", href: "/chat", icon: "●" },
  { key: "plan", label: "计划", href: "/plan", icon: "✓" },
  { key: "me", label: "我的", href: "/me", icon: "☺" },
];

const desktopItems: ReadonlyArray<{
  key: AppSection;
  label: string;
  href: "/chat" | "/plan" | "/me";
  icon: string;
}> = [
  { key: "chat", label: "聊天", href: "/chat", icon: "●" },
  { key: "plan", label: "计划", href: "/plan", icon: "□" },
  { key: "me", label: "我的", href: "/me", icon: "○" },
];

const demoRoles: ReadonlyArray<ShellRole> = [
  { id: null, name: "林知夏", initial: "夏", tone: "periwinkle" },
  { id: null, name: "周予安", initial: "安", tone: "mint" },
  { id: null, name: "南枝", initial: "枝", tone: "cream" },
];

const demoViewer: ShellViewer = {
  displayName: "小屿",
  initial: "屿",
  companionDays: "42 天",
};

function NavigationItems({
  current,
  items,
}: {
  current: AppSection;
  items: typeof mobileItems | typeof desktopItems;
}) {
  return items.map((item) => (
    <Link
      className="nav-item"
      data-section={item.key}
      href={item.href}
      aria-current={item.key === current ? "page" : undefined}
      key={item.key}
    >
      <span className="nav-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span>{item.label}</span>
    </Link>
  ));
}

export function MobileNavigation({ current }: { current: AppSection }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="主导航">
      <NavigationItems current={current} items={mobileItems} />
    </nav>
  );
}

export function DesktopNavigation({
  current,
  roles = demoRoles,
  viewer = demoViewer,
}: {
  current: AppSection;
  roles?: ReadonlyArray<ShellRole>;
  viewer?: ShellViewer;
}) {
  const { session, update } = useDemoSession();
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    setSessionReady(true);
  }, []);
  const activeSession = sessionReady ? session : defaultDemoSession;
  const databaseRole = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const demoShell = roles.every((role) => !role.id || !databaseRole.test(role.id));
  const visibleRoles = demoShell
    ? [
        ...roles,
        ...activeSession.customRoles
          .filter((role) => !roles.some((existing) => existing.id === role.id))
          .map((role) => ({
            id: role.id,
            name: role.name,
            initial: role.name.slice(0, 1) || "角",
            tone: "periwinkle" as const,
          })),
      ]
    : roles;
  const displayName = demoShell
    ? activeSession.displayName || viewer.displayName
    : viewer.displayName;
  const initial = displayName.slice(0, 1) || viewer.initial;

  return (
    <nav className="desktop-nav" aria-label="主导航">
      <Link className="desktop-brand" href="/chat">
        <span className="desktop-brand-mark" aria-hidden="true">
          言
        </span>
        <span>言行</span>
      </Link>
      <div className="desktop-nav-gap" aria-hidden="true" />
      <div className="desktop-nav-list">
        <NavigationItems current={current} items={desktopItems} />
      </div>
      <div className="desktop-nav-section-gap" aria-hidden="true" />
      <p className="desktop-role-label">陪伴角色</p>
      <div className="desktop-role-list">
        {visibleRoles.map((role) =>
          demoShell ? (
            <Link
              className="desktop-role"
              href="/chat"
              key={role.id ?? role.name}
              onClick={() => {
                update((currentSession) => ({
                  ...currentSession,
                  activeRoleKey: demoRoleKey(role),
                }));
              }}
            >
              <span
                className="desktop-role-avatar"
                data-tone={role.tone}
                aria-hidden="true"
              >
                {role.initial}
              </span>
              <span>{role.name}</span>
            </Link>
          ) : (
            <Link className="desktop-role" href="/roles" key={role.id ?? role.name}>
              <span
                className="desktop-role-avatar"
                data-tone={role.tone}
                aria-hidden="true"
              >
                {role.initial}
              </span>
              <span>{role.name}</span>
            </Link>
          ),
        )}
      </div>
      <div className="desktop-nav-fill" aria-hidden="true" />
      <Link className="desktop-user" href="/me">
        <span className="desktop-user-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="desktop-user-copy">
          <strong>{displayName}</strong>
          <span>已陪伴 {viewer.companionDays}</span>
        </span>
        <span className="desktop-user-arrow" aria-hidden="true">
          ›
        </span>
      </Link>
      <div className="desktop-nav-tail" aria-hidden="true" />
    </nav>
  );
}
