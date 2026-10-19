"use server";

import { headers } from "next/headers";

import { getSafeNextPath } from "@/lib/auth/redirect";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { MagicLinkActionState } from "@/modules/auth/magic-link-action-state";
import { hashRateLimitIdentifier } from "@/modules/auth/rate-limit";
import { magicLinkRequestSchema } from "@/server/schemas";

const acceptedMessage = "如果邮箱地址有效，登录链接会很快送达，请检查收件箱。";

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function requestIp(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || requestHeaders.get("x-real-ip")?.trim() || "unknown";
}

function appOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isProviderRateLimit(error: {
  code?: string;
  message?: string;
  status?: number;
}) {
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    /rate limit|too many requests/i.test(error.message ?? "")
  );
}

export async function requestMagicLink(
  _previousState: MagicLinkActionState,
  formData: FormData,
): Promise<MagicLinkActionState> {
  const parsed = magicLinkRequestSchema.safeParse({
    email: textField(formData, "email"),
    redirectPath: textField(formData, "nextPath") || "/chat",
  });

  if (!parsed.success) {
    return {
      status: "validation_error",
      message: "请输入有效的邮箱地址。",
      retryAfterSeconds: 0,
    };
  }

  const config = getPublicSupabaseConfig();
  const origin = appOrigin();
  const pepper = process.env.AUTH_RATE_LIMIT_PEPPER?.trim();

  if (!config || !origin || !pepper) {
    return {
      status: "configuration_error",
      message: "当前环境尚未配置邮箱登录，请完成服务端配置后重试。",
      retryAfterSeconds: 0,
    };
  }

  const requestHeaders = await headers();
  const emailHash = hashRateLimitIdentifier("email", parsed.data.email, pepper);
  const ipHash = hashRateLimitIdentifier("ip", requestIp(requestHeaders), pepper);
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return {
      status: "configuration_error",
      message: "当前环境尚未配置邮箱登录，请完成服务端配置后重试。",
      retryAfterSeconds: 0,
    };
  }
  const { data: retryAfter, error: limiterError } = await supabase.rpc(
    "consume_magic_link_request_slot",
    {
      p_email_hash: emailHash,
      p_ip_hash: ipHash,
    },
  );

  if (limiterError || typeof retryAfter !== "number") {
    return {
      status: "request_failed",
      message: "暂时无法受理登录请求，请稍后重试。",
      retryAfterSeconds: 0,
    };
  }

  if (retryAfter > 0) {
    return {
      status: "sent",
      message: acceptedMessage,
      retryAfterSeconds: Math.min(60, Math.max(1, Math.ceil(retryAfter))),
    };
  }

  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set("next", getSafeNextPath(parsed.data.redirectPath));
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      shouldCreateUser: true,
    },
  });

  if (error && !isProviderRateLimit(error)) {
    return {
      status: "request_failed",
      message: "暂时无法发送登录链接，请稍后重试。",
      retryAfterSeconds: 0,
    };
  }

  return {
    status: "sent",
    message: acceptedMessage,
    retryAfterSeconds: 60,
  };
}
