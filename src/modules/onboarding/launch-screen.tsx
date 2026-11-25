"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";

import { FairyLight } from "./fairy-light";
import { hasGuestOnboarding } from "./guest-onboarding";
import "./onboarding.css";

function subscribeToGuestState(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const notReturningOnServer = () => false;

export function LaunchScreen({
  authenticated,
  completed,
}: {
  authenticated: boolean;
  completed: boolean;
}) {
  const router = useRouter();
  const guestReturning = useSyncExternalStore(
    subscribeToGuestState,
    hasGuestOnboarding,
    notReturningOnServer,
  );
  const [leaving, setLeaving] = useState(false);
  const returning = completed || (!authenticated && guestReturning);
  const title = returning ? "欢迎回到 Yanko" : "很高兴，遇见你";

  useEffect(() => {
    router.prefetch("/chat");
  }, [router]);

  useEffect(() => {
    if (!returning) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fadeTimer = window.setTimeout(
      () => setLeaving(true),
      reducedMotion ? 200 : 2300,
    );
    const routeTimer = window.setTimeout(
      () => router.replace("/chat"),
      reducedMotion ? 350 : 2700,
    );
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(routeTimer);
    };
  }, [returning, router]);

  return (
    <main className="launch-page" data-leaving={leaving || undefined}>
      <header className="entry-brand">
        <span aria-hidden="true">✦</span> Yanko
      </header>
      {returning ? (
        <Link href="/chat" replace className="entry-skip">
          进入首页 <span aria-hidden="true">↗</span>
        </Link>
      ) : null}
      <section className="launch-content" aria-labelledby="launch-title">
        <FairyLight />
        <h1 className="launch-title" id="launch-title" aria-label={title} key={title}>
          {Array.from(title).map((letter, index) => (
            <span
              aria-hidden="true"
              key={index}
              style={{ "--letter-index": index } as CSSProperties}
            >
              {letter === " " ? "\u00a0" : letter}
            </span>
          ))}
        </h1>
        {returning ? (
          <div className="launch-loading" role="status">
            <span className="sr-only">正在进入首页</span>
            <i />
            <i />
            <i />
          </div>
        ) : (
          <div className="launch-actions">
            <Link
              className="entry-primary"
              href={authenticated ? "/onboarding" : "/login?next=%2Fonboarding"}
            >
              {authenticated ? "遇见你的 AI 伙伴" : "登录，开启陪伴"}
              <span aria-hidden="true">↗</span>
            </Link>
            {!authenticated ? (
              <Link className="entry-secondary" href="/onboarding?guest=1">
                先体验一下 <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </div>
        )}
      </section>
      <footer className="entry-footer">
        <Link href="/install">
          添加到手机主屏幕 <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </main>
  );
}
