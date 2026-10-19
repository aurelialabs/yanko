import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { getSafeNextPath } from "@/lib/auth/redirect";
import { getAuthContext } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "邮箱登录" };

const callbackErrorMessages: Record<string, string> = {
  missing_code: "登录链接无效或已过期，请重新获取一封邮件。",
  configuration: "当前环境尚未配置邮箱登录，请完成配置后重试。",
  callback_failed: "无法验证这封登录邮件，请重新获取登录链接。",
  account_setup_failed: "账号初始化暂未完成，请稍后重新打开登录链接。",
};

const loginNoticeMessages: Record<string, string> = {
  account_deleted: "账号和个人数据已删除。",
};

function firstQueryValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    next?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const nextPath = getSafeNextPath(firstQueryValue(query.next));
  const auth = await getAuthContext();

  if (auth.configured && auth.user) {
    redirect(nextPath as Route);
  }

  const callbackError = firstQueryValue(query.error);
  const notice = firstQueryValue(query.notice);

  return (
    <main className="auth-page">
      <section className="auth-device" aria-labelledby="login-title">
        <div className="mobile-status" aria-hidden="true">
          <span>9:41</span>
          <span>● ◔ ▰</span>
        </div>
        <div className="auth-content">
          <div className="brand-mark" aria-hidden="true">
            言
          </div>
          <h1 className="auth-title" id="login-title">
            欢迎来到言行
          </h1>
          <p className="auth-subtitle">输入邮箱，我们会发送免密码登录链接。</p>
          <LoginForm
            initialError={
              callbackError ? callbackErrorMessages[callbackError] : undefined
            }
            initialNotice={notice ? loginNoticeMessages[notice] : undefined}
            nextPath={nextPath}
          />
          <p className="legal-copy">继续即代表你同意《用户协议》和《隐私政策》</p>
        </div>
      </section>
    </main>
  );
}
