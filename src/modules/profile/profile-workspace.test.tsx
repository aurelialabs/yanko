import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/auth/actions", () => ({
  signOut: vi.fn(),
}));
vi.mock("@/app/me/account-actions", () => ({
  deleteMyAccount: vi.fn(),
}));

import { ProfileWorkspace } from "./profile-workspace";

describe("ProfileWorkspace", () => {
  it("links memory management to the real protected page without a fake count", () => {
    render(<ProfileWorkspace email="user@example.invalid" isAuthenticated />);

    expect(screen.getByRole("link", { name: /记忆管理/ })).toHaveAttribute(
      "href",
      "/me/memories",
    );
    expect(screen.queryByText("12 条长期记忆")).not.toBeInTheDocument();
  });

  it("links plan reminders to the truthful in-app inbox", () => {
    render(<ProfileWorkspace email="user@example.invalid" isAuthenticated />);

    expect(screen.getByRole("link", { name: /应用内提醒/ })).toHaveAttribute(
      "href",
      "/me/notifications",
    );
    expect(screen.queryByText("提醒已发送")).not.toBeInTheDocument();
  });

  it("offers a real export download and a deliberate account-deletion confirmation", () => {
    render(<ProfileWorkspace email="user@example.invalid" isAuthenticated />);

    expect(screen.getByRole("link", { name: /导出我的数据/ })).toHaveAttribute(
      "href",
      "/me/export",
    );
    expect(screen.getByText(/聊天删除后的记忆与计划保留规则仍在制定/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /删除账号/ }));
    expect(
      screen.getByRole("dialog", { name: "删除账号和全部个人数据" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox")).toHaveAttribute("name", "confirmation");
    expect(screen.getByRole("checkbox")).toHaveAttribute("name", "acknowledged");
  });
});
