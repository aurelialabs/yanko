import { describe, expect, it } from "vitest";

import {
  applyDemoPlanSession,
  defaultDemoSession,
  demoConfirmedPlan,
  demoPlanFromClassifier,
  demoPlanPatchFromForm,
  memoryDraftFromMessage,
  planDraftFromMessage,
} from "@/modules/demo/demo-session";
import { createDemoPlanWorkspace, shanghaiCalendarDate } from "@/modules/plan/plan-presentation";

describe("demo calendar", () => {
  it("anchors the sample day plans on Shanghai today", () => {
    const workspace = createDemoPlanWorkspace(new Date("2026-10-16T02:00:00.000Z"));

    expect(workspace.anchorDate).toBe("2026-10-16");
    expect(shanghaiCalendarDate(new Date("2026-10-16T02:00:00.000Z"))).toBe("2026-10-16");
    expect(
      workspace.plans.find((plan) => plan.id === "demo-day-portfolio-home")?.periodStart,
    ).toBe("2026-10-16");
    expect(workspace.plans.find((plan) => plan.id === "demo-week-1")?.periodStart).toBe(
      "2026-10-12",
    );
  });
});

describe("demo plan edits", () => {
  it("keeps a renamed day plan on the same date and time", () => {
    const patch = demoPlanPatchFromForm({
      scope: "day",
      title: "晚间散步",
      notes: "绕小区一圈",
      periodStart: "2026-10-16",
      dueDate: "",
      scheduledTime: "21:00",
    });
    const workspace = createDemoPlanWorkspace(new Date("2026-10-16T02:00:00.000Z"));
    const next = applyDemoPlanSession(workspace, {
      ...defaultDemoSession,
      planEdits: { "demo-day-walk": patch! },
    });
    const plan = next.plans.find((item) => item.id === "demo-day-walk");

    expect(patch?.scheduledAt).toBe("2026-10-16T21:00:00+08:00");
    expect(plan?.title).toBe("晚间散步");
    expect(plan?.notes).toBe("绕小区一圈");
  });
});

describe("demo plan classification", () => {
  it("keeps the classifier scope when turning a message into a confirmable plan", () => {
    const week = demoPlanFromClassifier({
      flowAction: "show_confirmation_card",
      scope: "week",
      title: "整理作品集结构",
      parsedPayload: { weekStart: "2026-10-14" },
      anchorDate: "2026-10-16",
    });
    const ordinary = demoPlanFromClassifier({
      flowAction: "none",
      scope: null,
      title: null,
      parsedPayload: {},
      anchorDate: "2026-10-16",
    });

    expect(week).toMatchObject({ scope: "week", date: "2026-10-12", title: "整理作品集结构" });
    expect(ordinary).toBeNull();
    expect(week ? demoConfirmedPlan({ ...week, flowAction: "show_confirmation_card" }).periodEnd : "").toBe(
      "2026-10-18",
    );
  });
});

describe("demo chat drafts", () => {
  it("turns an explicit reminder into a plan draft and a remember line into a memory", () => {
    expect(planDraftFromMessage("提醒我今天 19:30 整理作品集首页", "2026-10-16")).toEqual({
      scope: "day",
      title: "整理作品集首页",
      time: "19:30",
      date: "2026-10-16",
      flowAction: "show_confirmation_card",
    });
    expect(planDraftFromMessage("请帮我创建下周的周计划：整理作品集结构", "2026-10-19")?.scope).toBe(
      "week",
    );
    expect(planDraftFromMessage("实习好累啊", "2026-10-16")).toBeNull();
    expect(memoryDraftFromMessage("请记住我希望九月前完成作品集")).toBe(
      "我希望九月前完成作品集",
    );
  });
});
