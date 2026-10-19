"use client";

import { useActionState, useCallback, useEffect, useState } from "react";

import { requestMagicLink } from "@/app/login/actions";
import { initialMagicLinkActionState } from "@/modules/auth/magic-link-action-state";

export function LoginForm({
  initialError,
  initialNotice,
  nextPath,
}: {
  initialError?: string;
  initialNotice?: string;
  nextPath: string;
}) {
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const submitMagicLink = useCallback(
    async (previousState: typeof initialMagicLinkActionState, formData: FormData) => {
      const nextState = await requestMagicLink(previousState, formData);
      setCooldown(nextState.retryAfterSeconds);
      return nextState;
    },
    [],
  );
  const [state, action, pending] = useActionState(
    submitMagicLink,
    initialMagicLinkActionState,
  );

  useEffect(() => {
    if (cooldown <= 0) return undefined;

    const timer = window.setTimeout(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1_000);

    return () => window.clearTimeout(timer);
  }, [cooldown]);

  return (
    <form action={action} className="auth-form">
      <input name="nextPath" type="hidden" value={nextPath} />
      <label className="sr-only" htmlFor="email">
        邮箱
      </label>
      <input
        className="field"
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="你的邮箱"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button
        className="primary-button"
        disabled={pending || cooldown > 0}
        type="submit"
      >
        {pending
          ? "正在发送…"
          : cooldown > 0
            ? `${cooldown} 秒后可重新发送`
            : state.status === "sent"
              ? "重新发送登录链接"
              : "发送登录链接"}
      </button>
      {state.status === "sent" ? (
        <p className="success-note" role="status">
          {state.message}
        </p>
      ) : null}
      {initialNotice ? (
        <p className="success-note" role="status">
          {initialNotice}
        </p>
      ) : null}
      {initialError ? (
        <p className="auth-error-note" role="alert">
          {initialError}
        </p>
      ) : null}
      {state.status !== "idle" && state.status !== "sent" ? (
        <p className="auth-error-note" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
