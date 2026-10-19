export type PlanScope = "day" | "week" | "month" | "year";
export type PlanStatus = "active" | "completed";

export interface PlanPresentation {
  /** Database UUIDs and stable local-preview IDs share the same UI contract. */
  id: string;
  scope: PlanScope;
  parentPlanId: string | null;
  title: string;
  notes: string | null;
  status: PlanStatus;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  scheduledAt: string | null;
  sortOrder: number;
}

export interface PlanWorkspaceData {
  source: "demo" | "database" | "unavailable";
  anchorDate: string;
  timezone: string;
  plans: PlanPresentation[];
}

export interface PendingPlanProposalPresentation {
  id: string;
  sourceMessageId: string;
  scope: PlanScope;
  suggestedTitle: string;
  originalTimeText: string | null;
  missingFields: string[];
  expiresAt: string;
  date: string;
  scheduledTime: string;
  reminderTime: string;
  weekStart: string;
  month: string;
  year: string;
  dueDate: string;
  parentPlanId: string;
}

export interface PlanParentOption {
  id: string;
  title: string;
}

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addIsoDays(value: string, days: number) {
  const next = utcDate(value);
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
}

function mondayOf(value: string) {
  const day = utcDate(value).getUTCDay() || 7;
  return addIsoDays(value, 1 - day);
}

function monthEnd(value: string) {
  const start = utcDate(`${value.slice(0, 7)}-01`);
  start.setUTCMonth(start.getUTCMonth() + 1);
  start.setUTCDate(0);
  return isoDate(start);
}

/** Calendar date in the product timezone, independent of the machine's local zone. */
export function shanghaiCalendarDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function buildDemoPlans(anchorDate: string): PlanPresentation[] {
  const weekStart = mondayOf(anchorDate);
  const weekEnd = addIsoDays(weekStart, 6);
  const monthStart = `${anchorDate.slice(0, 7)}-01`;
  const yearStart = `${anchorDate.slice(0, 4)}-01-01`;
  const yearEnd = `${anchorDate.slice(0, 4)}-12-31`;

  return [
    {
      id: "demo-day-project-email",
      scope: "day",
      parentPlanId: null,
      title: "回复项目邮件",
      notes: "工作 · 预计 20 分钟",
      status: "completed",
      periodStart: anchorDate,
      periodEnd: anchorDate,
      dueDate: null,
      scheduledAt: `${anchorDate}T09:30:00+08:00`,
      sortOrder: 1,
    },
    {
      id: "demo-day-portfolio-structure",
      scope: "day",
      parentPlanId: null,
      title: "整理作品集信息架构",
      notes: "作品集 · 预计 45 分钟",
      status: "active",
      periodStart: anchorDate,
      periodEnd: anchorDate,
      dueDate: null,
      scheduledAt: `${anchorDate}T14:00:00+08:00`,
      sortOrder: 2,
    },
    {
      id: "demo-day-portfolio-home",
      scope: "day",
      parentPlanId: null,
      title: "整理作品集首页",
      notes: "AI 建议 · 预计 30 分钟",
      status: "active",
      periodStart: anchorDate,
      periodEnd: anchorDate,
      dueDate: null,
      scheduledAt: `${anchorDate}T19:30:00+08:00`,
      sortOrder: 3,
    },
    {
      id: "demo-day-walk",
      scope: "day",
      parentPlanId: null,
      title: "散步 20 分钟",
      notes: "生活 · 放松一下",
      status: "active",
      periodStart: anchorDate,
      periodEnd: anchorDate,
      dueDate: null,
      scheduledAt: `${anchorDate}T21:00:00+08:00`,
      sortOrder: 4,
    },
    ...["完成作品集首页初稿", "整理三个项目的素材", "安排一次作品集复盘"].map(
      (title, index): PlanPresentation => ({
        id: `demo-week-${index + 1}`,
        scope: "week",
        parentPlanId: null,
        title,
        notes: null,
        status: index === 0 ? "completed" : "active",
        periodStart: weekStart,
        periodEnd: weekEnd,
        dueDate: null,
        scheduledAt: null,
        sortOrder: index,
      }),
    ),
    ...["完成作品集第一版", "完成 20 个岗位调研", "保持每周两次运动"].map(
      (title, index): PlanPresentation => ({
        id: `demo-month-${index + 1}`,
        scope: "month",
        parentPlanId: null,
        title,
        notes: null,
        status: index === 0 ? "completed" : "active",
        periodStart: monthStart,
        periodEnd: monthEnd(anchorDate),
        dueDate: null,
        scheduledAt: null,
        sortOrder: index,
      }),
    ),
    {
      id: "demo-career",
      scope: "year",
      parentPlanId: null,
      title: "完成职业转型",
      notes: "从准备作品集到稳定进入新岗位",
      status: "active",
      periodStart: yearStart,
      periodEnd: yearEnd,
      dueDate: null,
      scheduledAt: null,
      sortOrder: 1,
    },
    {
      id: "demo-routine",
      scope: "year",
      parentPlanId: null,
      title: "建立稳定的生活节奏",
      notes: "在忙碌里保留可持续的睡眠与运动",
      status: "active",
      periodStart: yearStart,
      periodEnd: yearEnd,
      dueDate: null,
      scheduledAt: null,
      sortOrder: 2,
    },
    ...[
      ["demo-career", "作品集 V1", "completed"],
      ["demo-career", "投递 20 个合适岗位", "active"],
      ["demo-career", "完成 5 次深度面试复盘", "active"],
      ["demo-routine", "连续四周 24:00 前入睡", "completed"],
      ["demo-routine", "每周运动 3 次", "active"],
      ["demo-routine", "每月安排一次完全离线日", "active"],
    ].map(([parentPlanId, title, status], index): PlanPresentation => ({
      id: `demo-year-career-${index + 1}`,
      scope: "year",
      parentPlanId,
      title,
      notes: null,
      status: status as PlanStatus,
      periodStart: yearStart,
      periodEnd: yearEnd,
      dueDate: null,
      scheduledAt: null,
      sortOrder: index,
    })),
  ];
}

export function createDemoPlanWorkspace(now = new Date()): PlanWorkspaceData {
  const anchorDate = shanghaiCalendarDate(now);
  return {
    source: "demo",
    anchorDate,
    timezone: "Asia/Shanghai",
    plans: buildDemoPlans(anchorDate),
  };
}

export const demoPlanWorkspace: PlanWorkspaceData = createDemoPlanWorkspace();
