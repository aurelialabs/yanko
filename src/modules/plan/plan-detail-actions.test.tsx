import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const deletePlan = vi.hoisted(() => vi.fn());
const updatePlanDetails = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());

vi.mock("@/app/plan/actions", () => ({
  deletePlan,
  updatePlanDetails,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import { PlanDetailActions } from "./plan-detail-actions";

const planId = "11111111-1111-4111-8111-111111111111";

describe("PlanDetailActions", () => {
  it("lets an annual subgoal edit its title and notes", async () => {
    updatePlanDetails.mockResolvedValue({ message: "", updatedPlanId: planId });

    render(
      <PlanDetailActions
        canDelete
        canEdit
        initialNotes="原备注"
        initialTitle="原子目标"
        isSubgoal
        periodEnd="2026-12-31"
        periodStart="2026-01-01"
        planId={planId}
        removesSubgoals={false}
        scope="year"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑子目标" }));
    expect(screen.getByDisplayValue("原子目标")).toBeInTheDocument();
    expect(screen.getByDisplayValue("原备注")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), {
      target: { value: "更新后的子目标" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "备注（可选）" }), {
      target: { value: "更新后的备注" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(updatePlanDetails).toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: "保存修改" }),
      ).not.toBeInTheDocument();
    });

    const formData = updatePlanDetails.mock.calls[0][1] as FormData;
    expect(formData.get("planId")).toBe(planId);
    expect(formData.get("title")).toBe("更新后的子目标");
    expect(formData.get("notes")).toBe("更新后的备注");
  });

  it("keeps delete as the separate fallback action", () => {
    render(
      <PlanDetailActions
        canDelete
        canEdit
        initialTitle="子目标"
        isSubgoal
        periodEnd="2026-12-31"
        periodStart="2026-01-01"
        planId={planId}
        removesSubgoals={false}
        scope="year"
      />,
    );

    expect(screen.getByRole("button", { name: "编辑子目标" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除计划" })).toBeInTheDocument();
  });
});
