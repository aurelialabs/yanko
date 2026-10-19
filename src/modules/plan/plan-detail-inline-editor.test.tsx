import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const updatePlanDetails = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/app/plan/actions", () => ({
  updatePlanDetails,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { PlanDetailInlineEditor } from "./plan-detail-inline-editor";

const planId = "11111111-1111-4111-8111-111111111111";

function renderEditor() {
  return render(
    <PlanDetailInlineEditor
      canEdit
      completed={false}
      dueDate="2026-09-08"
      initialNotes="原备注"
      initialTitle="原计划"
      isSubgoal={false}
      periodEnd="2026-09-07"
      periodLabel="2026-09-07 · 09:30"
      periodStart="2026-09-07"
      planId={planId}
      scheduledAt="2026-09-07T01:30:00.000Z"
      scope="day"
      timezone="Asia/Shanghai"
    />,
  );
}

describe("PlanDetailInlineEditor", () => {
  it("edits the title by clicking the title", async () => {
    updatePlanDetails.mockResolvedValue({ message: "", updatedPlanId: planId });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "编辑计划标题" }));
    const titleInput = screen.getByRole("textbox", { name: "" });
    fireEvent.change(titleInput, { target: { value: "更新后的计划" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updatePlanDetails).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const formData = updatePlanDetails.mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get("planId")).toBe(planId);
    expect(formData.get("title")).toBe("更新后的计划");
    expect(formData.get("notes")).toBe("原备注");
    expect(formData.get("periodStart")).toBe("2026-09-07");
    expect(formData.get("periodEnd")).toBe("2026-09-07");
  });

  it("edits the date and time by clicking the time range", async () => {
    updatePlanDetails.mockResolvedValue({ message: "", updatedPlanId: planId });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "编辑时间范围" }));
    fireEvent.change(screen.getByLabelText("日期"), {
      target: { value: "2026-09-09" },
    });
    fireEvent.change(screen.getByDisplayValue("09:30"), {
      target: { value: "10:15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updatePlanDetails).toHaveBeenCalled());
    const formData = updatePlanDetails.mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get("periodStart")).toBe("2026-09-09");
    expect(formData.get("periodEnd")).toBe("2026-09-09");
    expect(formData.get("scheduledTime")).toBe("10:15");
    expect(formData.get("dueDate")).toBe("2026-09-08");
  });

  it("edits notes by clicking the notes area", async () => {
    updatePlanDetails.mockResolvedValue({ message: "", updatedPlanId: planId });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "编辑备注" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "新的提醒" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updatePlanDetails).toHaveBeenCalled());
    const formData = updatePlanDetails.mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get("notes")).toBe("新的提醒");
    expect(formData.get("title")).toBe("原计划");
  });

  it("uses the annual subgoal label for title editing", () => {
    render(
      <PlanDetailInlineEditor
        canEdit
        completed={false}
        dueDate={null}
        initialNotes={null}
        initialTitle="子目标"
        isSubgoal
        periodEnd="2026-12-31"
        periodLabel="2026 年"
        periodStart="2026-01-01"
        planId={planId}
        scheduledAt={null}
        scope="year"
        timezone="Asia/Shanghai"
      />,
    );

    expect(screen.getByRole("button", { name: "编辑子目标标题" })).toBeInTheDocument();
  });
});
