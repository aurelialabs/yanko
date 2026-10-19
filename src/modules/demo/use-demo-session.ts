"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEMO_SESSION_EVENT,
  DEMO_SESSION_KEY,
  defaultDemoSession,
  readDemoSession,
  updateDemoSession,
  type DemoSession,
} from "./demo-session";

export function useDemoSession() {
  const [session, setSession] = useState<DemoSession>(defaultDemoSession);

  useEffect(() => {
    const sync = () => setSession(readDemoSession());
    const onStorage = (event: StorageEvent) => {
      if (event.key === DEMO_SESSION_KEY) sync();
    };
    sync();
    window.addEventListener(DEMO_SESSION_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEMO_SESSION_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = useCallback((recipe: (current: DemoSession) => DemoSession) => {
    setSession(updateDemoSession(recipe));
  }, []);

  return { session, update };
}
