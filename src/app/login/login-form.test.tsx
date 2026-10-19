import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";

const requestMagicLink = vi.hoisted(() => vi.fn());

vi.mock("@/app/login/actions", () => ({ requestMagicLink }));

describe("LoginForm", () => {
  beforeEach(() => {
    requestMagicLink.mockReset();
  });

  it("only exposes the email Magic Link flow", () => {
    render(<LoginForm nextPath="/chat" />);

    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.queryByLabelText("手机号")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
  });

  it("uses the neutral success appearance and starts the server cooldown", async () => {
    requestMagicLink.mockResolvedValue({
      status: "sent",
      message: "如果邮箱地址有效，登录链接会很快送达，请检查收件箱。",
      retryAfterSeconds: 60,
    });
    render(<LoginForm nextPath="/plan" />);

    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), {
      target: { value: "HELLO@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送登录链接" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "如果邮箱地址有效，登录链接会很快送达",
    );
    const submittedForm = requestMagicLink.mock.calls[0]?.[1] as FormData;
    expect(submittedForm.get("email")).toBe("HELLO@example.com");
    expect(submittedForm.get("nextPath")).toBe("/plan");
    expect(screen.getByRole("button", { name: "60 秒后可重新发送" })).toBeDisabled();
  });

  it("does not claim email delivery when Supabase is unconfigured", async () => {
    requestMagicLink.mockResolvedValue({
      status: "configuration_error",
      message: "当前环境尚未配置邮箱登录，请完成服务端配置后重试。",
      retryAfterSeconds: 0,
    });
    render(<LoginForm nextPath="/chat" />);

    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), {
      target: { value: "hello@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送登录链接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("尚未配置邮箱登录");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can show the safe account-deletion return notice without treating it as login mail", () => {
    render(<LoginForm initialNotice="账号和个人数据已删除。" nextPath="/chat" />);

    expect(screen.getByRole("status")).toHaveTextContent("账号和个人数据已删除。");
    expect(screen.getByRole("button", { name: "发送登录链接" })).toBeEnabled();
  });
});
