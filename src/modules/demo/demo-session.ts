import type { ActiveMemoryPresentation, MemoryManagementData } from "@/modules/profile/memory-presentation";
import type {
  PlanPresentation,
  PlanScope,
  PlanStatus,
  PlanWorkspaceData,
} from "@/modules/plan/plan-presentation";

export const DEMO_SESSION_KEY = "yanko-demo-session-v1";
export const DEMO_SESSION_EVENT = "yanko-demo-session";

export type DemoTheme = "light" | "dark";
export type DemoFontScale = "small" | "default" | "large";

export interface DemoStoredMessage {
  id: string;
  sender: "user" | "assistant";
  content: string;
  status: "pending" | "completed" | "failed";
  createdAt?: string;
}

export interface DemoCustomRole {
  id: string;
  name: string;
  label: string;
  description: string;
  quote: string;
  guide: string;
}

export interface DemoMemoryEdit {
  content: string;
  scope: "user_shared" | "role_private";
  roleId: string | null;
  deleted?: boolean;
}

export interface DemoExtraMemory {
  id: string;
  content: string;
  category: string;
  scope: "user_shared" | "role_private";
  roleId: string | null;
}

export interface DemoPlanEdit {
  title: string;
  notes: string | null;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  scheduledAt: string | null;
}

export interface DemoPendingPlan {
  scope: PlanScope;
  title: string;
  time: string | null;
  date: string;
  afterMessageId?: string;
  flowAction: "show_confirmation_card" | "ask_to_create";
}

export interface DemoFeedbackItem {
  id: string;
  messageId: string;
  roleName: string;
  excerpt: string;
  reason: string;
  note: string;
  createdAt: string;
  status: "pending_review";
}

export interface DemoSession {
  activeRoleKey: string;
  displayName: string;
  theme: DemoTheme;
  fontScale: DemoFontScale;
  messagesByRole: Record<string, DemoStoredMessage[]>;
  planStatus: Record<string, PlanStatus>;
  deletedPlanIds: string[];
  extraPlans: PlanPresentation[];
  planEdits: Record<string, DemoPlanEdit>;
  suggestionAccepted: boolean;
  notificationRead: Record<string, boolean>;
  memoryEdits: Record<string, DemoMemoryEdit>;
  extraMemories: DemoExtraMemory[];
  customRoles: DemoCustomRole[];
  pendingPlan: DemoPendingPlan | null;
  pendingMemory: string | null;
  pendingMemoryAfterId: string | null;
  feedbackQueue: DemoFeedbackItem[];
}

export const defaultDemoSession: DemoSession = {
  activeRoleKey: "lin_zhixia",
  displayName: "小屿",
  theme: "light",
  fontScale: "default",
  messagesByRole: {},
  planStatus: {},
  deletedPlanIds: [],
  extraPlans: [],
  planEdits: {},
  suggestionAccepted: false,
  notificationRead: {},
  memoryEdits: {},
  extraMemories: [],
  customRoles: [],
  pendingPlan: null,
  pendingMemory: null,
  pendingMemoryAfterId: null,
  feedbackQueue: [],
};

const roleKeysByName: Record<string, string> = {
  林知夏: "lin_zhixia",
  周予安: "zhou_yuan",
  南枝: "nanzhi",
};

export function demoRoleKey(role: { id?: string | null; templateKey?: string | null; name: string }) {
  return role.templateKey || role.id || roleKeysByName[role.name] || role.name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSessionValue(): DemoSession {
  if (typeof window === "undefined") return defaultDemoSession;
  try {
    const raw = window.localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return defaultDemoSession;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return defaultDemoSession;
    return {
      ...defaultDemoSession,
      ...parsed,
      messagesByRole: isRecord(parsed.messagesByRole)
        ? (parsed.messagesByRole as DemoSession["messagesByRole"])
        : {},
      planStatus: isRecord(parsed.planStatus)
        ? (parsed.planStatus as DemoSession["planStatus"])
        : {},
      deletedPlanIds: Array.isArray(parsed.deletedPlanIds)
        ? parsed.deletedPlanIds.filter((id): id is string => typeof id === "string")
        : [],
      extraPlans: Array.isArray(parsed.extraPlans)
        ? (parsed.extraPlans as PlanPresentation[])
        : [],
      planEdits: isRecord(parsed.planEdits)
        ? (parsed.planEdits as DemoSession["planEdits"])
        : {},
      notificationRead: isRecord(parsed.notificationRead)
        ? (parsed.notificationRead as DemoSession["notificationRead"])
        : {},
      memoryEdits: isRecord(parsed.memoryEdits)
        ? (parsed.memoryEdits as DemoSession["memoryEdits"])
        : {},
      extraMemories: Array.isArray(parsed.extraMemories)
        ? (parsed.extraMemories as DemoExtraMemory[])
        : [],
      customRoles: Array.isArray(parsed.customRoles)
        ? (parsed.customRoles as DemoCustomRole[])
        : [],
      displayName:
        typeof parsed.displayName === "string" && parsed.displayName.trim()
          ? parsed.displayName.trim().slice(0, 20)
          : defaultDemoSession.displayName,
      activeRoleKey:
        typeof parsed.activeRoleKey === "string" && parsed.activeRoleKey
          ? parsed.activeRoleKey
          : defaultDemoSession.activeRoleKey,
      theme: parsed.theme === "dark" ? "dark" : "light",
      fontScale:
        parsed.fontScale === "small" || parsed.fontScale === "large"
          ? parsed.fontScale
          : "default",
      suggestionAccepted: parsed.suggestionAccepted === true,
      pendingPlan: readPendingPlan(parsed.pendingPlan),
      pendingMemory: typeof parsed.pendingMemory === "string" ? parsed.pendingMemory : null,
      pendingMemoryAfterId:
        typeof parsed.pendingMemoryAfterId === "string" ? parsed.pendingMemoryAfterId : null,
      feedbackQueue: Array.isArray(parsed.feedbackQueue)
        ? parsed.feedbackQueue.flatMap((item) => {
            const feedback = readFeedbackItem(item);
            return feedback ? [feedback] : [];
          })
        : [],
    };
  } catch {
    return defaultDemoSession;
  }
}

export function readDemoSession(): DemoSession {
  return readSessionValue();
}

export function writeDemoSession(session: DemoSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(DEMO_SESSION_EVENT));
}

export function updateDemoSession(recipe: (current: DemoSession) => DemoSession): DemoSession {
  const next = recipe(readDemoSession());
  writeDemoSession(next);
  return next;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addIsoDays(value: string, days: number) {
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
}

function mondayOf(value: string) {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay() || 7;
  return addIsoDays(value, 1 - day);
}

function monthEnd(value: string) {
  const start = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  start.setUTCMonth(start.getUTCMonth() + 1);
  start.setUTCDate(0);
  return isoDate(start);
}

export function demoPlanPatchFromForm(input: {
  scope: PlanScope;
  title: string;
  notes: string;
  periodStart: string;
  dueDate: string;
  scheduledTime: string;
}): DemoPlanEdit | null {
  const title = input.title.trim().slice(0, 200);
  const periodStart = input.periodStart.trim();
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return null;

  const notes = input.notes.trim().slice(0, 5000);
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : null;
  let start = periodStart;
  let end = periodStart;
  let scheduledAt: string | null = null;

  if (input.scope === "day") {
    scheduledAt = /^\d{2}:\d{2}$/.test(input.scheduledTime)
      ? `${periodStart}T${input.scheduledTime}:00+08:00`
      : null;
  } else if (input.scope === "week") {
    start = mondayOf(periodStart);
    end = addIsoDays(start, 6);
  } else if (input.scope === "month") {
    start = `${periodStart.slice(0, 7)}-01`;
    end = monthEnd(periodStart);
  } else {
    start = `${periodStart.slice(0, 4)}-01-01`;
    end = `${periodStart.slice(0, 4)}-12-31`;
  }

  return {
    title,
    notes: notes || null,
    periodStart: start,
    periodEnd: end,
    dueDate: input.scope === "day" ? null : dueDate,
    scheduledAt,
  };
}

export function applyDemoPlanSession(
  workspace: PlanWorkspaceData,
  session: DemoSession,
): PlanWorkspaceData {
  if (workspace.source !== "demo") return workspace;
  const known = new Set(workspace.plans.map((plan) => plan.id));
  const plans = [...workspace.plans, ...session.extraPlans.filter((plan) => !known.has(plan.id))]
    .filter((plan) => !session.deletedPlanIds.includes(plan.id))
    .map((plan) => {
      const edit = session.planEdits[plan.id];
      return {
        ...plan,
        ...(edit ?? {}),
        ...(session.planStatus[plan.id] ? { status: session.planStatus[plan.id] } : {}),
      };
    });
  return { ...workspace, plans };
}

export function applyDemoMemories(
  data: MemoryManagementData,
  session: DemoSession,
): MemoryManagementData {
  if (data.source !== "demo") return data;
  const edited = data.memories.flatMap((memory) => {
    const edit = session.memoryEdits[memory.id];
    if (!edit) return [memory];
    if (edit.deleted) return [];
    const role = data.roles.find((item) => item.id === edit.roleId);
    return [
      {
        ...memory,
        content: edit.content,
        scope: edit.scope,
        roleId: edit.scope === "role_private" ? edit.roleId : null,
        roleName: edit.scope === "role_private" ? (role?.name ?? memory.roleName) : null,
      },
    ];
  });
  const extras: ActiveMemoryPresentation[] = session.extraMemories.map((memory) => ({
    id: memory.id,
    content: memory.content,
    category: memory.category,
    scope: memory.scope,
    roleId: memory.roleId,
    roleName: data.roles.find((role) => role.id === memory.roleId)?.name ?? null,
    sensitivity: "normal",
    confirmedByUser: true,
    validFrom: new Date().toISOString(),
    history: [],
  }));
  return { ...data, memories: [...edited, ...extras] };
}

function readPendingPlan(value: unknown): DemoPendingPlan | null {
  if (!isRecord(value) || typeof value.title !== "string" || !value.title.trim()) return null;
  const date = typeof value.date === "string" ? value.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const scope =
    value.scope === "week" || value.scope === "month" || value.scope === "year"
      ? value.scope
      : "day";
  const time = typeof value.time === "string" && /^\d{2}:\d{2}$/.test(value.time) ? value.time : null;
  return {
    scope,
    title: value.title.trim().slice(0, 80),
    time,
    date,
    afterMessageId: typeof value.afterMessageId === "string" ? value.afterMessageId : undefined,
    flowAction: value.flowAction === "ask_to_create" ? "ask_to_create" : "show_confirmation_card",
  };
}

function readFeedbackItem(value: unknown): DemoFeedbackItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.excerpt !== "string" || typeof value.reason !== "string") {
    return null;
  }
  return {
    id: value.id,
    messageId: typeof value.messageId === "string" ? value.messageId : "",
    roleName: typeof value.roleName === "string" ? value.roleName : "",
    excerpt: value.excerpt.slice(0, 80),
    reason: value.reason.slice(0, 40),
    note: typeof value.note === "string" ? value.note.slice(0, 200) : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    status: "pending_review",
  };
}

function payloadText(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function demoPlanFromClassifier(input: {
  flowAction: "none" | "show_confirmation_card" | "ask_to_create" | "explore_first_step";
  scope: PlanScope | null;
  title: string | null;
  parsedPayload: Record<string, unknown>;
  anchorDate: string;
}): Omit<DemoPendingPlan, "afterMessageId"> | null {
  if (input.flowAction !== "show_confirmation_card" && input.flowAction !== "ask_to_create") {
    return null;
  }
  const title = input.title?.trim().slice(0, 80) ?? "";
  const scope = input.scope;
  if (!title || !scope || !/^\d{4}-\d{2}-\d{2}$/.test(input.anchorDate)) return null;

  let date = input.anchorDate;
  let time: string | null = null;
  if (scope === "day") {
    const scheduled = payloadText(input.parsedPayload, "scheduledAt");
    const scheduledMatch = scheduled?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    const explicitDate = payloadText(input.parsedPayload, "date");
    if (scheduledMatch) {
      date = scheduledMatch[1];
      time = scheduledMatch[2];
    } else if (explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
      date = explicitDate;
    }
  } else if (scope === "week") {
    const weekStart = payloadText(input.parsedPayload, "weekStart");
    date = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? mondayOf(weekStart) : mondayOf(input.anchorDate);
  } else if (scope === "month") {
    const month = payloadText(input.parsedPayload, "month");
    date = month && /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : `${input.anchorDate.slice(0, 7)}-01`;
  } else {
    const year = payloadText(input.parsedPayload, "year");
    date = year && /^\d{4}$/.test(year) ? `${year}-01-01` : `${input.anchorDate.slice(0, 4)}-01-01`;
  }

  return {
    scope,
    title,
    time,
    date,
    flowAction: input.flowAction,
  };
}

export function demoConfirmedPlan(draft: DemoPendingPlan): PlanPresentation {
  let periodStart = draft.date;
  let periodEnd = draft.date;
  let scheduledAt: string | null = null;

  if (draft.scope === "day") {
    scheduledAt = draft.time ? `${draft.date}T${draft.time}:00+08:00` : null;
  } else if (draft.scope === "week") {
    periodStart = mondayOf(draft.date);
    periodEnd = addIsoDays(periodStart, 6);
  } else if (draft.scope === "month") {
    periodStart = `${draft.date.slice(0, 7)}-01`;
    periodEnd = monthEnd(draft.date);
  } else {
    periodStart = `${draft.date.slice(0, 4)}-01-01`;
    periodEnd = `${draft.date.slice(0, 4)}-12-31`;
  }

  return {
    id: `demo-local-${crypto.randomUUID()}`,
    scope: draft.scope,
    parentPlanId: null,
    title: draft.title,
    notes: "从聊天记下",
    status: "active",
    periodStart,
    periodEnd,
    dueDate: null,
    scheduledAt,
    sortOrder: Date.now(),
  };
}

export function planDraftFromMessage(
  text: string,
  anchorDate: string,
): Omit<DemoPendingPlan, "afterMessageId"> | null {
  const trimmed = text
    .trim()
    .replace(/(?:请)?记住[：:，,\s]*[^，,。！？]{2,80}[，,]?\s*/, "");
  if (trimmed.length < 4 || trimmed.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    return null;
  }
  const scope = /周计划|下周|本周|这周/.test(trimmed)
    ? "week"
    : /月计划|这个月|本月/.test(trimmed)
      ? "month"
      : /年度目标|年计划|今年/.test(trimmed)
        ? "year"
        : /(提醒我|记到计划|加到计划|安排|放到今天|放到明天|今天.{0,16}(做|完成|整理|写|回复|开始))/.test(
              trimmed,
            )
          ? "day"
          : null;
  if (!scope) return null;
  const clock = trimmed.match(/(\d{1,2})[:：](\d{2})/);
  const hourOnly = trimmed.match(/(\d{1,2})\s*点/);
  let time: string | null = null;
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  } else if (hourOnly) {
    const hour = Number(hourOnly[1]);
    if (hour >= 0 && hour <= 23) time = `${String(hour).padStart(2, "0")}:00`;
  }
  const title = trimmed
    .replace(/请|帮我|提醒我|记到计划|加到(日)?计划|安排一下|安排|放到今天|放到明天|一下|并/g, "")
    .replace(/今天|明天|今晚/g, "")
    .replace(/\d{1,2}[:：]\d{2}|\d{1,2}\s*点/g, "")
    .replace(/[，。！？、]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  if (title.length < 2) return null;
  const date =
    scope === "week"
      ? mondayOf(anchorDate)
      : scope === "month"
        ? `${anchorDate.slice(0, 7)}-01`
        : scope === "year"
          ? `${anchorDate.slice(0, 4)}-01-01`
          : anchorDate;
  return {
    scope,
    title,
    time: scope === "day" ? time : null,
    date,
    flowAction: "show_confirmation_card",
  };
}

export function memoryDraftFromMessage(text: string): string | null {
  const match = text.trim().match(/(?:请)?记住[：:，,\s]*([^，,。！？]{2,80})/);
  if (!match) return null;
  const content = match[1].trim();
  return content.length >= 2 ? content : null;
}
