"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import "./pwa.css";

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

  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const previousHeight = root.style.getPropertyValue("--yanko-viewport-height");
    const updateViewportHeight = () => {
      // Preserve pinch zoom: it must not resize the app or its text.
      if (viewport && viewport.scale !== 1) return;
      root.style.setProperty(
        "--yanko-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };

    updateViewportHeight();
    viewport?.addEventListener("resize", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);
    window.addEventListener("pageshow", updateViewportHeight);
    return () => {
      viewport?.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("pageshow", updateViewportHeight);
      if (previousHeight)
        root.style.setProperty("--yanko-viewport-height", previousHeight);
      else root.style.removeProperty("--yanko-viewport-height");
    };
  }, []);

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
      .register("/service-worker.js", { scope: "/", updateViaCache: "none" })
      .catch(() => undefined);
  }, []);

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
          <span>
            聊天、记忆、计划和账号操作需要联网。未发送的操作不会自动补交，恢复网络后请重新提交。
          </span>
        </aside>
      ) : null}
    </>
  );
}

/** Safari installation is a user action in its share sheet, never a JS prompt. */
export function InstallInstructions() {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const updateDisplayMode = () => {
      setIsStandalone(
        displayMode.matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    };

    updateDisplayMode();
    displayMode.addEventListener("change", updateDisplayMode);
    window.addEventListener("pageshow", updateDisplayMode);
    return () => {
      displayMode.removeEventListener("change", updateDisplayMode);
      window.removeEventListener("pageshow", updateDisplayMode);
    };
  }, []);

  return (
    <main className="pwa-install-page">
      <div className="pwa-install-content">
        <Link className="pwa-install-back" href="/me">
          ← 返回我的
        </Link>
        <header className="pwa-install-header">
          <Image
            alt="言行"
            className="pwa-install-icon"
            height={80}
            src="/icons/apple-touch-icon.png"
            unoptimized
            width={80}
          />
          <h1>{isStandalone ? "已从主屏幕打开言行" : "把言行放到 iPhone 主屏幕"}</h1>
        </header>

        {!isStandalone ? (
          <section
            aria-labelledby="pwa-install-steps-title"
            className="pwa-install-card"
          >
            <h2 id="pwa-install-steps-title">在 Safari 中添加</h2>
            <ol className="pwa-install-steps">
              <li>
                <strong>用 Safari 打开言行</strong>
              </li>
              <li>
                <strong>
                  轻点“分享”
                  <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                    <path
                      d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                    />
                  </svg>
                </strong>
                <p>也可在“…”菜单中找到“分享”。</p>
              </li>
              <li>
                <strong>选择“添加到主屏幕”</strong>
              </li>
              <li>
                <strong>确认名称“Yanko”，轻点“添加”</strong>
                <p>如果有“作为网页 App 打开”选项，请保持开启。</p>
              </li>
            </ol>
          </section>
        ) : null}

        <Link className="pwa-install-continue" href="/">
          继续使用言行
        </Link>
      </div>
    </main>
  );
}
