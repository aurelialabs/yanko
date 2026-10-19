import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanWorkspaceData } from "./plan-presentation";

const createManualPlan = vi.hoisted(() => vi.fn());
const deletePlan = vi.hoisted(() => vi.fn());

vi.mock("@/app/plan/actions", () => ({
  createManualPlan,
  deletePlan,
  togglePlanCompletion: vi.fn(),
}));

import { PlanCreateDialog } from "./plan-workspace";

const workspace: PlanWorkspaceData = {
  source: "database",
  anchorDate: "2026-09-02",
  timezone: "Asia/Shanghai",
  plans: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      scope: "year",
      parentPlanId: null,
      title: "2026 年大目标",
      notes: null,
      status: "active",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      dueDate: null,
      scheduledAt: null,
      sortOrder: 1,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      scope: "year",
      parentPlanId: null,
      title: "2027 年大目标",
      notes: null,
      status: "active",
      periodStart: "2027-01-01",
      periodEnd: "2027-12-31",
      dueDate: null,
      scheduledAt: null,
      sortOrder: 1,
    },
  ],
};

describe("PlanCreateDialog", () => {
  beforeEach(() => {
    createManualPlan.mockReset();
  });

  it("uses the selected weekly and monthly period as the due-date boundary", () => {
    render(
      <PlanCreateDialog
        activeScope="week"
        date="2026-09-02"
        onClose={vi.fn()}
        onCreated={vi.fn()}
        workspace={workspace}
      />,
    );

    const weeklyDueDate = screen.getByLabelText("截止日期（可选）");
    expect(weeklyDueDate).toHaveAttribute("min", "2026-08-31");
    expect(weeklyDueDate).toHaveAttribute("max", "2026-09-06");

    fireEvent.change(screen.getByLabelText("所在周"), {
      target: { value: "2026-09-12" },
    });
    expect(screen.getByLabelText("截止日期（可选）")).toHaveAttribute(
      "min",
      "2026-09-07",
    );
    expect(screen.getByLabelText("截止日期（可选）")).toHaveAttribute(
      "max",
      "2026-09-13",
    );

    fireEvent.click(screen.getByRole("radio", { name: "月计划" }));

    expect(screen.getByLabelText("截止日期（可选）")).toHaveAttribute(
      "min",
      "2026-09-01",
    );
    expect(screen.getByLabelText("截止日期（可选）")).toHaveAttribute(
      "max",
      "2026-09-30",
    );
  });

  it("limits annual subgoals to a parent from the selected year", () => {
    render(
      <PlanCreateDialog
        activeScope="year"
        date="2026-09-02"
        onClose={vi.fn()}
        onCreated={vi.fn()}
        workspace={workspace}
      />,
    );

    const parentGoal = screen.getByRole("combobox");
    expect(parentGoal).toHaveTextContent("2026 年大目标");
    expect(parentGoal).not.toHaveTextContent("2027 年大目标");

    fireEvent.change(screen.getByRole("spinbutton", { name: "年份" }), {
      target: { value: "2027" },
    });
    expect(screen.getByRole("combobox")).toHaveTextContent("2027 年大目标");
    expect(screen.getByRole("combobox")).not.toHaveTextContent("2026 年大目标");
  });

  it("reports a successful creation to its owner and starts clean when reopened", async () => {
    createManualPlan.mockResolvedValue({
      message: "",
      createdPlanId: "33333333-3333-4333-8333-333333333333",
    });
    const onCreated = vi.fn();
    const firstDialog = render(
      <PlanCreateDialog
        activeScope="week"
        date="2026-09-02"
        onClose={vi.fn()}
        onCreated={onCreated}
        workspace={workspace}
      />,
    );

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "组会" } });
    fireEvent.click(screen.getByRole("button", { name: "创建计划" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({ scope: "week", date: "2026-09-02" });
    });

    firstDialog.unmount();
    render(
      <PlanCreateDialog
        activeScope="month"
        date="2026-09-02"
        onClose={vi.fn()}
        onCreated={vi.fn()}
        workspace={workspace}
      />,
    );

    expect(screen.getByRole("button", { name: "创建计划" })).toBeEnabled();
    expect(
      screen.queryByText("已创建计划，关闭后即可在对应计划列表中查看。"),
    ).not.toBeInTheDocument();
  });
});
