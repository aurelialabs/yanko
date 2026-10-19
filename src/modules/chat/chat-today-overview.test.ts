import { describe, expect, it } from "vitest";

import type { PlanWorkspaceData } from "@/modules/plan/plan-presentation";

import { buildChatTodayOverview } from "./chat-today-overview";

const workspace: PlanWorkspaceData = {
  source: "database",
  anchorDate: "2026-09-02",
  timezone: "Asia/Shanghai",
  plans: [
    {
      id: "day-completed",
      scope: "day",
      parentPlanId: null,
      title: "完成邮件",
      notes: null,
      status: "completed",
      periodStart: "2026-09-02",
      periodEnd: "2026-09-02",
      dueDate: null,
      scheduledAt: "2026-09-02T00:00:00.000Z",
      sortOrder: 1,
    },
    {
      id: "day-morning",
      scope: "day",
      parentPlanId: null,
      title: "整理作品集",
      notes: null,
      status: "active",
      periodStart: "2026-09-02",
      periodEnd: "2026-09-02",
      dueDate: null,
      scheduledAt: "2026-09-02T01:30:00.000Z",
      sortOrder: 2,
    },
    {
      id: "day-afternoon",
      scope: "day",
      parentPlanId: null,
      title: "散步 20 分钟",
      notes: null,
      status: "active",
      periodStart: "2026-09-02",
      periodEnd: "2026-09-02",
      dueDate: null,
      scheduledAt: "2026-09-02T04:00:00.000Z",
      sortOrder: 3,
    },
    {
      id: "day-all-day",
      scope: "day",
      parentPlanId: null,
      title: "阅读",
      notes: null,
      status: "active",
      periodStart: "2026-09-02",
      periodEnd: "2026-09-02",
      dueDate: null,
      scheduledAt: null,
      sortOrder: 4,
    },
    {
      id: "another-day",
      scope: "day",
      parentPlanId: null,
      title: "不属于今天",
      notes: null,
      status: "active",
      periodStart: "2026-09-03",
      periodEnd: "2026-09-03",
      dueDate: null,
      scheduledAt: null,
      sortOrder: 1,
    },
    {
      id: "weekly-plan",
      scope: "week",
      parentPlanId: null,
      title: "本周计划不出现在今日卡片",
      notes: null,
      status: "active",
      periodStart: "2026-08-31",
      periodEnd: "2026-09-06",
      dueDate: null,
      scheduledAt: null,
      sortOrder: 1,
    },
  ],
};

describe("buildChatTodayOverview", () => {
  it("uses the current date's day plans and keeps the next list time-ordered", () => {
    expect(buildChatTodayOverview(workspace)).toEqual({
      dateLabel: "9月2日 · 周三",
      completedCount: 1,
      totalCount: 4,
      nextPlans: [
        { id: "day-morning", title: "整理作品集", timeLabel: "09:30" },
        { id: "day-afternoon", title: "散步 20 分钟", timeLabel: "12:00" },
        { id: "day-all-day", title: "阅读", timeLabel: "全天" },
      ],
    });
  });

  it("returns an explicit empty state when no plan belongs to today", () => {
    expect(
      buildChatTodayOverview({ ...workspace, plans: workspace.plans.slice(4) }),
    ).toEqual({
      dateLabel: "9月2日 · 周三",
      completedCount: 0,
      totalCount: 0,
      nextPlans: [],
    });
  });
});
