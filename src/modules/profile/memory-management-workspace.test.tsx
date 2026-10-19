import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMemory = vi.hoisted(() => vi.fn());
const deleteMemory = vi.hoisted(() => vi.fn());

vi.mock("@/app/me/actions", () => ({
  deleteMemory,
  replaceMemory,
}));

import { MemoryManagementWorkspace } from "./memory-management-workspace";

const roleId = "10000000-0000-4000-8000-000000000001";
const data = {
  source: "database" as const,
  roles: [{ id: roleId, name: "林知夏" }],
  memories: [
    {
      id: "20000000-0000-4000-8000-000000000002",
      content: "用户难过时希望先被倾听。",
      category: "agreement",
      scope: "role_private" as const,
      roleId,
      roleName: "林知夏",
      sensitivity: "normal" as const,
      confirmedByUser: true,
      validFrom: "2026-09-01T00:00:00.000Z",
      history: [
        {
          id: "30000000-0000-4000-8000-000000000003",
          content: "用户过去希望马上获得建议。",
          status: "superseded" as const,
          validFrom: "2026-08-01T00:00:00.000Z",
          validTo: "2026-09-01T00:00:00.000Z",
        },
      ],
    },
  ],
};

describe("MemoryManagementWorkspace", () => {
  beforeEach(() => {
    replaceMemory.mockReset();
    deleteMemory.mockReset();
  });

  it("groups active memories and requires explicit confirmation before sharing", () => {
    render(<MemoryManagementWorkspace data={data} />);

    expect(screen.getByRole("heading", { name: "重要约定" })).toBeInTheDocument();
    expect(screen.getByText("用户已确认")).toBeInTheDocument();
    expect(screen.getByText("查看变化历史（1）")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("作用范围"), {
      target: { value: "user_shared" },
    });
    expect(screen.getByLabelText("我确认这条记忆将对全部角色可见")).toBeRequired();
  });

  it("uses a second confirmation step before deleting a memory", () => {
    render(<MemoryManagementWorkspace data={data} />);

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/立即停止参与后续回复/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认删除" })).toBeInTheDocument();
  });

  it("shows a truthful empty state for a scope without memories", () => {
    render(
      <MemoryManagementWorkspace
        data={{
          ...data,
          roles: [...data.roles, { id: "other-role", name: "南枝" }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "南枝" }));
    expect(screen.getByText("这里还没有长期记忆")).toBeInTheDocument();
  });
});
