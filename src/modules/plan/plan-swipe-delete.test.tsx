import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlanPresentation } from "./plan-presentation";

const createManualPlan = vi.hoisted(() => vi.fn());
const deletePlan = vi.hoisted(() => vi.fn());
const togglePlanCompletion = vi.hoisted(() => vi.fn());

vi.mock("@/app/plan/actions", () => ({
  createManualPlan,
  deletePlan,
  togglePlanCompletion,
}));

import { SwipeToDeletePlan } from "./plan-workspace";

const plan: PlanPresentation = {
  id: "11111111-1111-4111-8111-111111111111",
  scope: "week",
  parentPlanId: null,
  title: "整理作品集素材",
  notes: null,
  status: "active",
  periodStart: "2026-08-31",
  periodEnd: "2026-09-06",
  dueDate: null,
  scheduledAt: null,
  sortOrder: 1,
};

describe("SwipeToDeletePlan", () => {
  it("reveals the red delete control after a left swipe and deletes on tap", () => {
    const onDemoDelete = vi.fn();
    render(
      <SwipeToDeletePlan onDemoDelete={onDemoDelete} plan={plan} source="demo">
        <article>整理作品集素材</article>
      </SwipeToDeletePlan>,
    );

    const swipeTarget = screen.getByLabelText("整理作品集素材，向左滑动后可删除");
    const deleteButton = screen.getByRole("button", { name: "删除：整理作品集素材" });
    expect(deleteButton).toHaveAttribute("tabindex", "-1");

    fireEvent.pointerDown(swipeTarget, { clientX: 180, isPrimary: true });
    fireEvent.pointerMove(swipeTarget, { clientX: 80, isPrimary: true });
    fireEvent.pointerUp(swipeTarget, { clientX: 80, isPrimary: true });

    expect(deleteButton).toHaveAttribute("tabindex", "0");
    fireEvent.click(deleteButton);
    expect(onDemoDelete).toHaveBeenCalledWith(plan.id);
  });
});
