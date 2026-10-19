"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function canRegisterServiceWorker() {
  if (!("serviceWorker" in navigator)) return false;

  const host = window.location.hostname;
  return (
    window.isSecureContext ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]"
  );
}

/**
 * Provides the deliberately small PWA client boundary.
 *
 * The service worker only caches public app-shell assets. This component makes
 * a dropped connection visible and stops form submissions before React Server
 * Actions can be dispatched, so a user never sees an offline write as saved.
 */
export function PwaClient() {
  const [isOffline, setIsOffline] = useState(false);
  const [writeWasBlocked, setWriteWasBlocked] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const updateConnectionState = () => {
      setIsOffline(!navigator.onLine);
    };
    const handleOffline = () => {
      setIsOffline(true);
      setWriteWasBlocked(false);
    };
    const handleOnline = () => {
      setIsOffline(false);
      setWriteWasBlocked(false);
    };
    const preventOfflineSubmission = (event: SubmitEvent) => {
      if (navigator.onLine) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      setIsOffline(true);
      setWriteWasBlocked(true);
    };

    updateConnectionState();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("submit", preventOfflineSubmission, true);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("submit", preventOfflineSubmission, true);
    };
  }, []);

  useEffect(() => {
    if (!canRegisterServiceWorker()) return;

    void navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      const promptEvent = event as Partial<InstallPromptEvent>;
      if (typeof promptEvent.prompt !== "function" || !promptEvent.userChoice) return;

      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function requestInstall() {
    const prompt = installPrompt;
    if (!prompt) return;

    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // Browser-specific install errors are intentionally not surfaced as a
      // false success or internal diagnostic in the product UI.
    } finally {
      setInstallPrompt(null);
    }
  }

  return (
    <>
      {isOffline ? (
        <aside
          aria-atomic="true"
          aria-live="polite"
          className="pwa-offline-notice"
          role="status"
        >
          <strong>{writeWasBlocked ? "本次提交未发送" : "当前处于离线状态"}</strong>
          <span>聊天、记忆、计划和账号操作不会提交；恢复网络后请重新尝试。</span>
        </aside>
      ) : null}
      {installPrompt ? (
        <aside aria-label="安装言行" className="pwa-install-prompt">
          <span>将言行添加到设备，随时回到你的时间线。</span>
          <button onClick={requestInstall} type="button">
            安装言行
          </button>
        </aside>
      ) : null}
    </>
  );
}
