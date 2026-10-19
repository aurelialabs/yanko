import type { ReactNode } from "react";

import {
  DesktopNavigation,
  MobileNavigation,
  type AppSection,
  type ShellRole,
  type ShellViewer,
} from "./navigation";

export function AppShell({
  current,
  children,
  roles,
  viewer,
}: {
  current: AppSection;
  children: ReactNode;
  roles?: ReadonlyArray<ShellRole>;
  viewer?: ShellViewer;
}) {
  return (
    <main className="environment">
      <div className="app-shell">
        <DesktopNavigation current={current} roles={roles} viewer={viewer} />
        <div className="app-stage">
          <div className="mobile-status" aria-hidden="true">
            <span>9:41</span>
            <span>● ◔ ▰</span>
          </div>
          <div className="page-content">{children}</div>
        </div>
        <MobileNavigation current={current} />
      </div>
    </main>
  );
}
