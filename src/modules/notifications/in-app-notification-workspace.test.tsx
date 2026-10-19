import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/me/notifications/actions", () => ({
  markInAppNotificationRead: vi.fn(),
}));

import { InAppNotificationWorkspace } from "./in-app-notification-workspace";

const data = {
  source: "database" as const,
  unreadCount: 1,
  items: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      planId: "20000000-0000-4000-8000-000000000002",
      planTitle: "上午十点提交周报",
      deliveredAt: "2026-09-07T02:00:01.000Z",
      readAt: null,
    },
    {
      id: "30000000-0000-4000-8000-000000000003",
      planId: "40000000-0000-4000-8000-000000000004",
      planTitle: "晚上整理资料",
      deliveredAt: "2026-09-06T11:00:01.000Z",
      readAt: "2026-09-06T11:05:00.000Z",
    },
  ],
};

describe("InAppNotificationWorkspace", () => {
  it("shows owned reminders, read controls, and truthful channel status", () => {
    render(<InAppNotificationWorkspace data={data} />);

    expect(screen.getByRole("heading", { name: "应用内提醒" })).toBeInTheDocument();
    expect(screen.getByText("1 条未读提醒")).toBeInTheDocument();
    expect(screen.getByText("系统通知尚未启用")).toBeInTheDocument();
    expect(screen.getByText(/当前不会向设备发送 Push/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "查看计划" })[0]).toHaveAttribute(
      "href",
      `/plan/${data.items[0].planId}`,
    );
    expect(screen.getByRole("button", { name: "标为已读" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "标为未读" })).toBeInTheDocument();
    expect(screen.queryByText("提醒已发送")).not.toBeInTheDocument();
  });

  it("shows a safe recovery state when reminder data is unavailable", () => {
    render(
      <InAppNotificationWorkspace
        data={{ source: "unavailable", unreadCount: 0, items: [] }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("提醒服务仍在准备中");
    expect(
      screen.queryByRole("link", { name: "查看我的计划" }),
    ).not.toBeInTheDocument();
  });

  it("shows an honest empty inbox without claiming external delivery", () => {
    render(
      <InAppNotificationWorkspace
        data={{ source: "database", unreadCount: 0, items: [] }}
      />,
    );

    expect(screen.getByText("这里还没有应用内提醒")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看我的计划" })).toHaveAttribute(
      "href",
      "/plan",
    );
  });
});
