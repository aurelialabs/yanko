"use client";

import { useEffect } from "react";

import { useDemoSession } from "./use-demo-session";

/** Applies the no-login appearance choices saved in this browser. */
export function DemoAppearance() {
  const { session } = useDemoSession();

  useEffect(() => {
    document.documentElement.dataset.theme = session.theme;
    document.documentElement.dataset.fontScale = session.fontScale;
  }, [session.fontScale, session.theme]);

  return null;
}
