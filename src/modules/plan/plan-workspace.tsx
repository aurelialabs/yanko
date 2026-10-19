"use client";

import type { Route } from "next";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { createManualPlan, deletePlan, togglePlanCompletion } from "@/app/plan/actions";
import { applyDemoPlanSession } from "@/modules/demo/demo-session";
import { useDemoSession } from "@/modules/demo/use-demo-session";
import { initialPlanActionState } from "@/modules/plan/plan-action-state";
import type { ShellRole, ShellViewer } from "@/modules/shell/navigation";
import { AppShell } from "@/modules/shell/app-shell";

import type {
  PlanPresentation,
  PlanScope,
  PlanWorkspaceData,
} from "./plan-presentation";

type PlanTab = PlanScope;

type CreatedPlanTarget = {
  date: string;
  scope: PlanScope;
};

const tabs: ReadonlyArray<{ id: PlanTab; label: string }> = [
  { id: "day", label: "日计划" },
  { id: "week", label: "周计划" },
  { id: "month", label: "月计划" },
  { id: "year", label: "年度目标" },
];

const swipeDeleteWidth = 84;

function asDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const next = asDate(value);
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
}

function startOfWeek(value: string) {
  const date = asDate(value);
  const day = date.getUTCDay() || 7;
  return addDays(value, 1 - day);
}

function startOfMonth(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function startOfYear(value: string) {
  return `${value.slice(0, 4)}-01-01`;
}

function endOfMonth(value: string) {
  const start = asDate(`${value}-01`);
  start.setUTCMonth(start.getUTCMonth() + 1);
  start.setUTCDate(0);
  return isoDate(start);
}

function displayDay(value: string, anchorDate: string) {
  const date = asDate(value);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日${value === anchorDate ? " · 今天" : ""}`;
}

function displayWeek(value: string) {
  const start = startOfWeek(value);
  const end = addDays(start, 6);
  const selectedDate = asDate(value);
  const startDate = asDate(start);
  const endDate = asDate(end);
  const week = Math.floor((selectedDate.getUTCDate() - 1) / 7) + 1;
  return `${selectedDate.getUTCMonth() + 1} 月第 ${week} 周 · ${startDate.getUTCMonth() + 1} 月 ${startDate.getUTCDate()} 日 — ${endDate.getUTCMonth() + 1} 月 ${endDate.getUTCDate()} 日`;
}

function displayMonth(value: string) {
  const date = asDate(value);
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月`;
}

function displayTime(value: string | null, timezone: string) {
  if (!value) return "全天";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function planHref(
  plan: PlanPresentation,
  returnScope: PlanScope,
  returnDate: string,
): Route<"/plan/[planId]"> {
  return ("/plan/" +
    encodeURIComponent(plan.id) +
    "?scope=" +
    returnScope +
    "&date=" +
    returnDate) as Route<"/plan/[planId]">;
}

function createIdempotencyKey() {
  return crypto.randomUUID();
}

function creationTarget(
  formData: FormData,
  fallbackDate: string,
): CreatedPlanTarget | null {
  const scope = formData.get("scope");
  if (scope !== "day" && scope !== "week" && scope !== "month" && scope !== "year") {
    return null;
  }

  if (scope === "day") {
    const date = formData.get("dayDate");
    return typeof date === "string" && date ? { scope, date } : null;
  }

  if (scope === "week") {
    const date = formData.get("weekDate");
    return typeof date === "string" && date ? { scope, date } : null;
  }

  if (scope === "month") {
    const month = formData.get("month");
    return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
      ? { scope, date: `${month}-01` }
      : null;
  }

  const year = formData.get("year");
  return typeof year === "string" && /^\d{4}$/.test(year)
    ? { scope, date: `${year}-01-01` }
    : { scope, date: fallbackDate };
}

function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function buildLocalPlan(formData: FormData, fallbackDate: string): PlanPresentation | null {
  const target = creationTarget(formData, fallbackDate);
  const title = textField(formData, "title");
  if (!target || !title) return null;
  const notes = textField(formData, "notes");
  let periodStart = target.date;
  let periodEnd = target.date;
  let scheduledAt: string | null = null;
  let parentPlanId: string | null = null;
  let dueDate: string | null = null;

  if (target.scope === "day") {
    const time = textField(formData, "scheduledTime");
    scheduledAt = /^\d{2}:\d{2}$/.test(time) ? `${target.date}T${time}:00+08:00` : null;
  } else if (target.scope === "week") {
    periodStart = startOfWeek(target.date);
    periodEnd = addDays(periodStart, 6);
    dueDate = textField(formData, "dueDate") || null;
  } else if (target.scope === "month") {
    periodStart = startOfMonth(target.date);
    periodEnd = endOfMonth(target.date.slice(0, 7));
    dueDate = textField(formData, "dueDate") || null;
  } else {
    periodStart = startOfYear(target.date);
    periodEnd = `${target.date.slice(0, 4)}-12-31`;
    parentPlanId = textField(formData, "parentPlanId") || null;
  }

  return {
    id: `demo-local-${crypto.randomUUID()}`,
    scope: target.scope,
    parentPlanId,
    title,
    notes: notes || null,
    status: "active",
    periodStart,
    periodEnd,
    dueDate,
    scheduledAt,
    sortOrder: Date.now(),
  };
}

function ArrowButton({
  direction,
  onClick,
}: {
  direction: -1 | 1;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={direction === -1 ? "查看上一时间段" : "查看下一时间段"}
      className="plan-arrow-button"
      onClick={onClick}
      type="button"
    >
      {direction === -1 ? "‹" : "›"}
    </button>
  );
}

function EmptyPlanState({ label }: { label: string }) {
  return <p className="plan-empty-state">{label}</p>;
}

export function PlanCreateDialog({
  activeScope,
  date,
  onClose,
  onCreated,
  onDemoCreate,
  persistLocally = false,
  workspace,
}: {
  activeScope: PlanScope;
  date: string;
  onClose: () => void;
  onCreated: (target: CreatedPlanTarget) => void;
  onDemoCreate?: (plan: PlanPresentation) => void;
  persistLocally?: boolean;
  workspace: PlanWorkspaceData;
}) {
  const [scope, setScope] = useState<PlanScope>(activeScope);
  const [idempotencyKey] = useState(createIdempotencyKey);
  const [state, action, pending] = useActionState(
    createManualPlan,
    initialPlanActionState,
  );
  const [submittedTarget, setSubmittedTarget] = useState<CreatedPlanTarget | null>(
    null,
  );
  const [weekDate, setWeekDate] = useState(date);
  const [month, setMonth] = useState(date.slice(0, 7));
  const [year, setYear] = useState(date.slice(0, 4));
  const weekStart = startOfWeek(weekDate);
  const weekEnd = addDays(weekStart, 6);
  const monthStart = `${month}-01`;
  const monthEnd = endOfMonth(month);
  const yearStart = `${year}-01-01`;
  const yearGoals = workspace.plans.filter(
    (plan) =>
      plan.scope === "year" && !plan.parentPlanId && plan.periodStart === yearStart,
  );

  useEffect(() => {
    if (state.createdPlanId && submittedTarget) {
      onCreated(submittedTarget);
    }
  }, [onCreated, state.createdPlanId, submittedTarget]);

  return (
    <div
      aria-labelledby="plan-create-title"
      aria-modal="true"
      className="plan-create-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <section className="plan-create-dialog">
        <header>
          <div>
            <p>手动创建</p>
            <h2 id="plan-create-title">新建计划</h2>
          </div>
          <button aria-label="关闭新建计划" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <form
          action={persistLocally ? undefined : action}
          className="plan-create-form"
          onSubmit={(event) => {
            const formData = new FormData(event.currentTarget);
            const target = creationTarget(formData, date);
            if (!persistLocally) {
              setSubmittedTarget(target);
              return;
            }
            event.preventDefault();
            const plan = buildLocalPlan(formData, date);
            if (!plan || !target) return;
            onDemoCreate?.(plan);
            onCreated(target);
          }}
        >
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
          <fieldset>
            <legend>计划类型</legend>
            <div className="plan-create-scope-options">
              {tabs.map((tab) => (
                <label data-selected={scope === tab.id || undefined} key={tab.id}>
                  <input
                    checked={scope === tab.id}
                    name="scope"
                    onChange={() => setScope(tab.id)}
                    type="radio"
                    value={tab.id}
                  />
                  <span>{tab.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="plan-create-field">
            <span>名称</span>
            <input
              autoFocus
              maxLength={200}
              name="title"
              placeholder="例如：整理作品集首页"
              required
              type="text"
            />
          </label>
          {scope === "day" ? (
            <div className="plan-create-field-grid">
              <label className="plan-create-field">
                <span>日期</span>
                <input defaultValue={date} name="dayDate" required type="date" />
              </label>
              <label className="plan-create-field">
                <span>时间（可选）</span>
                <input name="scheduledTime" type="time" />
              </label>
            </div>
          ) : null}
          {scope === "week" ? (
            <div className="plan-create-field-grid">
              <label className="plan-create-field">
                <span>所在周</span>
                <input
                  name="weekDate"
                  onChange={(event) => setWeekDate(event.target.value || date)}
                  required
                  type="date"
                  value={weekDate}
                />
              </label>
              <label className="plan-create-field">
                <span>截止日期（可选）</span>
                <input
                  key={weekDate}
                  max={weekEnd}
                  min={weekStart}
                  name="dueDate"
                  type="date"
                />
              </label>
            </div>
          ) : null}
          {scope === "month" ? (
            <div className="plan-create-field-grid">
              <label className="plan-create-field">
                <span>月份</span>
                <input
                  name="month"
                  onChange={(event) => setMonth(event.target.value || date.slice(0, 7))}
                  required
                  type="month"
                  value={month}
                />
              </label>
              <label className="plan-create-field">
                <span>截止日期（可选）</span>
                <input
                  key={month}
                  max={monthEnd}
                  min={monthStart}
                  name="dueDate"
                  type="date"
                />
              </label>
            </div>
          ) : null}
          {scope === "year" ? (
            <>
              <label className="plan-create-field">
                <span>年份</span>
                <input
                  max="2100"
                  min="2000"
                  name="year"
                  onChange={(event) => {
                    if (event.target.value) setYear(event.target.value);
                  }}
                  required
                  type="number"
                  value={year}
                />
              </label>
              <label className="plan-create-field">
                <span>归属目标</span>
                <select defaultValue="" key={yearStart} name="parentPlanId">
                  <option value="">作为年度大目标</option>
                  {yearGoals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))}
                </select>
                <small>选择大目标后，将创建为它下面的小目标。</small>
              </label>
            </>
          ) : null}
          <label className="plan-create-field">
            <span>备注（可选）</span>
            <textarea
              maxLength={5000}
              name="notes"
              placeholder="写下一点说明或提醒"
              rows={3}
            />
          </label>
          {state.message ? (
            <p className="plan-action-message" role="alert">
              {state.message}
            </p>
          ) : null}
          <footer>
            <button onClick={onClose} type="button">
              取消
            </button>
            <button disabled={pending} type="submit">
              {pending ? "保存中…" : "创建计划"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PlanToggle({
  action,
  children,
  className,
  completed,
  onDemoToggle,
  pending,
  plan,
  source,
}: {
  action: (formData: FormData) => void;
  children: React.ReactNode;
  className: string;
  completed: boolean;
  onDemoToggle: (id: string) => void;
  pending: boolean;
  plan: PlanPresentation;
  source: PlanWorkspaceData["source"];
}) {
  const nextStatus = completed ? "active" : "completed";
  const [idempotencyKey] = useState(createIdempotencyKey);

  if (source === "database") {
    return (
      <form action={action} className="plan-toggle-form">
        <input name="planId" type="hidden" value={plan.id} />
        <input name="expectedStatus" type="hidden" value={plan.status} />
        <input name="nextStatus" type="hidden" value={nextStatus} />
        <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <button
          aria-label={(completed ? "取消完成：" : "完成：") + plan.title}
          aria-pressed={completed}
          className={className}
          disabled={pending}
          type="submit"
        >
          {children}
        </button>
      </form>
    );
  }

  return (
    <button
      aria-label={(completed ? "取消完成：" : "完成：") + plan.title}
      aria-pressed={completed}
      className={className}
      onClick={() => onDemoToggle(plan.id)}
      type="button"
    >
      {children}
    </button>
  );
}

export function SwipeToDeletePlan({
  children,
  onDemoDelete,
  plan,
  source,
  variant = "row",
}: {
  children: React.ReactNode;
  onDemoDelete: (id: string) => void;
  plan: PlanPresentation;
  source: PlanWorkspaceData["source"];
  variant?: "row" | "card";
}) {
  const [state, action, pending] = useActionState(deletePlan, initialPlanActionState);
  const [idempotencyKey] = useState(createIdempotencyKey);
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const startOffset = useRef(0);
  const offsetRef = useRef(0);
  const didSwipe = useRef(false);
  const isOpen = offset <= -swipeDeleteWidth / 2;

  if (source === "unavailable") {
    return children;
  }

  function setSwipeOffset(nextOffset: number) {
    const boundedOffset = Math.max(-swipeDeleteWidth, Math.min(0, nextOffset));
    offsetRef.current = boundedOffset;
    setOffset(boundedOffset);
  }

  function isDeleteControl(target: EventTarget | null) {
    return (
      target instanceof Element && Boolean(target.closest(".plan-swipe-delete-action"))
    );
  }

  function finishSwipe() {
    const nextOffset =
      offsetRef.current <= -swipeDeleteWidth / 2 ? -swipeDeleteWidth : 0;
    setSwipeOffset(nextOffset);
    startX.current = null;
    startY.current = null;
    setIsDragging(false);
  }

  return (
    <div
      aria-label={`${plan.title}，向左滑动后可删除`}
      className={`plan-swipe-delete plan-swipe-delete--${variant}`}
      data-dragging={isDragging || undefined}
      data-open={isOpen || undefined}
      onClickCapture={(event) => {
        if (isDeleteControl(event.target)) return;

        if (didSwipe.current) {
          didSwipe.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (isOpen) {
          setSwipeOffset(0);
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerCancel={finishSwipe}
      onPointerDown={(event) => {
        if (
          event.isPrimary === false ||
          (event.pointerType === "mouse" && event.button !== 0) ||
          isDeleteControl(event.target)
        ) {
          return;
        }

        startX.current = event.clientX;
        startY.current = event.clientY;
        startOffset.current = offsetRef.current;
        didSwipe.current = false;
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        if (
          startX.current === null ||
          startY.current === null ||
          isDeleteControl(event.target)
        ) {
          return;
        }

        const distance = event.clientX - startX.current;
        const verticalDistance = event.clientY - startY.current;
        const isHorizontalSwipe =
          Math.abs(distance) > 12 && Math.abs(distance) > Math.abs(verticalDistance);

        if (isHorizontalSwipe) {
          didSwipe.current = true;
          event.preventDefault();
          setSwipeOffset(startOffset.current + distance);
        }
      }}
      onPointerUp={finishSwipe}
    >
      <div className="plan-swipe-delete-action">
        {source === "database" ? (
          <form action={action}>
            <input name="planId" type="hidden" value={plan.id} />
            <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
            <button
              aria-label={`删除：${plan.title}`}
              disabled={pending}
              tabIndex={isOpen ? 0 : -1}
              type="submit"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" />
              </svg>
              <span>{pending ? "删除中" : "删除"}</span>
            </button>
          </form>
        ) : (
          <button
            aria-label={`删除：${plan.title}`}
            onClick={() => onDemoDelete(plan.id)}
            tabIndex={isOpen ? 0 : -1}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" />
            </svg>
            <span>删除</span>
          </button>
        )}
      </div>
      <div
        className="plan-swipe-delete-content"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
      {state.message ? (
        <p className="plan-swipe-delete-message" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function DayPlanView({
  action,
  date,
  onChangeDate,
  onDemoDelete,
  onDemoToggle,
  pending,
  workspace,
}: {
  action: (formData: FormData) => void;
  date: string;
  onChangeDate: (days: number) => void;
  onDemoDelete: (id: string) => void;
  onDemoToggle: (id: string) => void;
  pending: boolean;
  workspace: PlanWorkspaceData;
}) {
  const tasks = workspace.plans.filter(
    (plan) => plan.scope === "day" && plan.periodStart === date,
  );
  const completedCount = tasks.filter((plan) => plan.status === "completed").length;
  const weekStart = startOfWeek(date);

  return (
    <>
      <div className="plan-period-header">
        <ArrowButton direction={-1} onClick={() => onChangeDate(-1)} />
        <h2>{displayDay(date, workspace.anchorDate)}</h2>
        <ArrowButton direction={1} onClick={() => onChangeDate(1)} />
      </div>
      <div aria-label="本周日期" className="plan-week-strip">
        {Array.from({ length: 7 }, (_, index) => {
          const day = addDays(weekStart, index);
          const shown = asDate(day);
          return (
            <button
              className="plan-week-day"
              data-current={day === date || undefined}
              key={day}
              onClick={() =>
                onChangeDate(index - Math.floor((asDate(date).getUTCDay() || 7) - 1))
              }
              type="button"
            >
              <span>{["一", "二", "三", "四", "五", "六", "日"][index]}</span>
              <strong>{shown.getUTCDate()}</strong>
            </button>
          );
        })}
      </div>
      <div className="plan-desktop-grid plan-day-grid">
        <section
          aria-labelledby="today-schedule-title"
          className="plan-card plan-timeline"
        >
          <h2 id="today-schedule-title">今天的安排</h2>
          <div className="plan-task-list">
            {tasks.length === 0 ? <EmptyPlanState label="这一天还没有计划。" /> : null}
            {tasks.map((task, index) => {
              const completed = task.status === "completed";
              return (
                <SwipeToDeletePlan
                  key={task.id ?? task.title}
                  onDemoDelete={onDemoDelete}
                  plan={task}
                  source={workspace.source}
                >
                  <article
                    className="plan-day-task"
                    data-completed={completed || undefined}
                    data-tone={["muted", "periwinkle", "cream", "warm"][index % 4]}
                  >
                    <PlanToggle
                      action={action}
                      className="plan-check"
                      completed={completed}
                      onDemoToggle={onDemoToggle}
                      pending={pending}
                      plan={task}
                      source={workspace.source}
                    >
                      {completed ? "✓" : "○"}
                    </PlanToggle>
                    <Link className="plan-task-copy" href={planHref(task, "day", date)}>
                      <h3>{task.title}</h3>
                      <p>{task.notes ?? "未添加说明"}</p>
                    </Link>
                    <time>{displayTime(task.scheduledAt, workspace.timezone)}</time>
                  </article>
                </SwipeToDeletePlan>
              );
            })}
          </div>
        </section>
        <aside aria-label="今日进度" className="plan-card plan-summary">
          <h2>今日进度</h2>
          <div className="plan-progress-hero" data-tone="periwinkle">
            <strong>
              {tasks.length
                ? `${Math.round((completedCount / tasks.length) * 100)}%`
                : "0%"}
            </strong>
            <span>{`已完成 ${completedCount} / ${tasks.length}`}</span>
          </div>
          <div className="plan-gentle-tip">
            <strong>林知夏的小提醒</strong>
            <p>今天留一点余量，不需要把每一分钟都安排满。</p>
          </div>
        </aside>
      </div>
    </>
  );
}

function ListPlanView({
  action,
  scope,
  date,
  onChangeDate,
  onDemoDelete,
  onDemoToggle,
  pending,
  workspace,
}: {
  action: (formData: FormData) => void;
  scope: "week" | "month";
  date: string;
  onChangeDate: (days: number) => void;
  onDemoDelete: (id: string) => void;
  onDemoToggle: (id: string) => void;
  pending: boolean;
  workspace: PlanWorkspaceData;
}) {
  const periodStart = scope === "week" ? startOfWeek(date) : startOfMonth(date);
  const plans = workspace.plans.filter(
    (plan) => plan.scope === scope && plan.periodStart === periodStart,
  );
  const completed = plans.filter((plan) => plan.status === "completed").length;
  const label = scope === "week" ? "本周待完成事项" : "本月计划";

  return (
    <>
      <div className="plan-period-header">
        <ArrowButton
          direction={-1}
          onClick={() => onChangeDate(scope === "week" ? -7 : -31)}
        />
        <h2>{scope === "week" ? displayWeek(date) : displayMonth(date)}</h2>
        <ArrowButton
          direction={1}
          onClick={() => onChangeDate(scope === "week" ? 7 : 31)}
        />
      </div>
      <div className="plan-desktop-grid plan-list-grid">
        <section className="plan-card plan-list-panel">
          <h2>{label}</h2>
          {plans.length === 0 ? (
            <EmptyPlanState label="这个时间段还没有计划。" />
          ) : null}
          {plans.map((plan) => {
            const isCompleted = plan.status === "completed";
            return (
              <SwipeToDeletePlan
                key={plan.id}
                onDemoDelete={onDemoDelete}
                plan={plan}
                source={workspace.source}
              >
                <article
                  className="plan-list-row"
                  data-completed={isCompleted || undefined}
                >
                  <PlanToggle
                    action={action}
                    className="plan-list-check"
                    completed={isCompleted}
                    onDemoToggle={onDemoToggle}
                    pending={pending}
                    plan={plan}
                    source={workspace.source}
                  >
                    {isCompleted ? "✓" : "○"}
                  </PlanToggle>
                  <Link className="plan-list-detail" href={planHref(plan, scope, date)}>
                    <p>{plan.title}</p>
                    <span aria-hidden="true">›</span>
                  </Link>
                </article>
              </SwipeToDeletePlan>
            );
          })}
        </section>
        <aside className="plan-card plan-summary">
          <h2>{scope === "week" ? "本周概览" : "本月概览"}</h2>
          <div
            className="plan-progress-hero"
            data-tone={scope === "week" ? "mint" : "periwinkle"}
          >
            <strong>
              {scope === "week"
                ? `${completed} / ${plans.length}`
                : `${plans.length ? Math.round((completed / plans.length) * 100) : 0}%`}
            </strong>
            <span>{scope === "week" ? "已完成事项" : "本月进度"}</span>
          </div>
        </aside>
      </div>
    </>
  );
}

function YearPlanView({
  action,
  date,
  onChangeDate,
  onDemoDelete,
  onDemoToggle,
  pending,
  workspace,
}: {
  action: (formData: FormData) => void;
  date: string;
  onChangeDate: (days: number) => void;
  onDemoDelete: (id: string) => void;
  onDemoToggle: (id: string) => void;
  pending: boolean;
  workspace: PlanWorkspaceData;
}) {
  const periodStart = startOfYear(date);
  const goals = workspace.plans.filter(
    (plan) =>
      plan.scope === "year" && !plan.parentPlanId && plan.periodStart === periodStart,
  );
  const childPlans = workspace.plans.filter(
    (plan) =>
      plan.scope === "year" && plan.parentPlanId && plan.periodStart === periodStart,
  );
  const complete = childPlans.filter((plan) => plan.status === "completed").length;

  return (
    <>
      <div className="plan-period-header plan-year-header">
        <ArrowButton direction={-1} onClick={() => onChangeDate(-365)} />
        <h2>{date.slice(0, 4)} 年度目标</h2>
        <ArrowButton direction={1} onClick={() => onChangeDate(365)} />
      </div>
      <div className="plan-desktop-grid plan-year-grid">
        <section aria-label="年度大目标" className="plan-goal-list">
          {goals.length === 0 ? (
            <EmptyPlanState label="这一年还没有年度目标。" />
          ) : null}
          {goals.map((goal, index) => {
            const subgoals = childPlans.filter((plan) => plan.parentPlanId === goal.id);
            const finished = subgoals.filter(
              (plan) => plan.status === "completed",
            ).length;
            const progress = subgoals.length
              ? Math.round((finished / subgoals.length) * 100)
              : goal.status === "completed"
                ? 100
                : 0;
            const tone = index % 2 ? "mint" : "periwinkle";
            return (
              <SwipeToDeletePlan
                key={goal.id}
                onDemoDelete={onDemoDelete}
                plan={goal}
                source={workspace.source}
                variant="card"
              >
                <article className="plan-goal-card">
                  <header>
                    <div>
                      <Link
                        className="plan-goal-detail"
                        href={planHref(goal, "year", date)}
                      >
                        <h2>{goal.title}</h2>
                      </Link>
                      <p>{goal.notes ?? "年度目标"}</p>
                    </div>
                    <span className="plan-goal-percent" data-tone={tone}>
                      {progress}%
                    </span>
                  </header>
                  <div aria-label={`${goal.title}进度`} className="plan-progress-track">
                    <span data-tone={tone} style={{ width: `${progress}%` }} />
                  </div>
                  <p className="plan-summary-label">子目标</p>
                  <div className="plan-subgoal-list">
                    {subgoals.map((subgoal) => {
                      const done = subgoal.status === "completed";
                      return (
                        <SwipeToDeletePlan
                          key={subgoal.id}
                          onDemoDelete={onDemoDelete}
                          plan={subgoal}
                          source={workspace.source}
                        >
                          <article
                            className="plan-subgoal"
                            data-completed={done || undefined}
                          >
                            <PlanToggle
                              action={action}
                              className="plan-subgoal-check"
                              completed={done}
                              onDemoToggle={onDemoToggle}
                              pending={pending}
                              plan={subgoal}
                              source={workspace.source}
                            >
                              {done ? "✓" : "○"}
                            </PlanToggle>
                            <Link
                              className="plan-subgoal-detail"
                              href={planHref(subgoal, "year", date)}
                            >
                              {subgoal.title}
                            </Link>
                          </article>
                        </SwipeToDeletePlan>
                      );
                    })}
                    {subgoals.length === 0 ? (
                      <EmptyPlanState label="还没有子目标。" />
                    ) : null}
                  </div>
                </article>
              </SwipeToDeletePlan>
            );
          })}
        </section>
        <aside aria-label="年度概览" className="plan-card plan-year-summary">
          <h2>年度概览</h2>
          <div className="plan-progress-hero" data-tone="cream">
            <strong>
              {childPlans.length
                ? `${Math.round((complete / childPlans.length) * 100)}%`
                : "0%"}
            </strong>
            <span>整体进度</span>
          </div>
          <p className="plan-summary-label">目标统计</p>
          <div className="plan-stat" data-tone="periwinkle">
            <span>大目标</span>
            <strong>{goals.length} 个</strong>
          </div>
          <div className="plan-stat" data-tone="mint">
            <span>子目标</span>
            <strong>{childPlans.length} 个</strong>
          </div>
          <div className="plan-stat" data-tone="warm">
            <span>已完成</span>
            <strong>{complete} 个</strong>
          </div>
        </aside>
      </div>
    </>
  );
}

export function PlanWorkspace({
  initialDate,
  initialScope = "day",
  roles,
  viewer,
  workspace,
}: {
  initialDate?: string;
  initialScope?: PlanTab;
  roles?: ReadonlyArray<ShellRole>;
  viewer?: ShellViewer;
  workspace: PlanWorkspaceData;
}) {
  const { session, update } = useDemoSession();
  const [activeTab, setActiveTab] = useState<PlanTab>(initialScope);
  const [date, setDate] = useState(initialDate ?? workspace.anchorDate);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [previewMessage, setPreviewMessage] = useState("");
  const [actionState, action, pending] = useActionState(
    togglePlanCompletion,
    initialPlanActionState,
  );
  const currentWorkspace = applyDemoPlanSession(workspace, session);
  const changeDate = (days: number) => setDate((current) => addDays(current, days));
  const toggleDemo = (id: string) => {
    const plan = currentWorkspace.plans.find((item) => item.id === id);
    if (!plan) return;
    const status = plan.status === "completed" ? "active" : "completed";
    update((current) => ({
      ...current,
      planStatus: { ...current.planStatus, [id]: status },
    }));
  };
  const deleteDemo = (id: string) =>
    update((current) => ({
      ...current,
      deletedPlanIds: [
        ...new Set([
          ...current.deletedPlanIds,
          id,
          ...workspace.plans
            .filter((plan) => plan.parentPlanId === id)
            .map((plan) => plan.id),
        ]),
      ],
    }));

  return (
    <AppShell current="plan" roles={roles} viewer={viewer}>
      <section className="plan-workspace" aria-labelledby="plan-page-title">
        <header className="plan-workspace-header">
          <h1 id="plan-page-title">计划</h1>
          <span className="plan-streak">连续完成 6 天</span>
          <button
            className="plan-add-button"
            onClick={() => {
              if (workspace.source === "unavailable") {
                setPreviewMessage("计划数据仍在准备中，请稍后刷新页面。");
                return;
              }
              setPreviewMessage("");
              setIsCreateOpen(true);
            }}
            type="button"
          >
            ＋ 新建计划
          </button>
        </header>
        <div className="plan-workspace-content">
          <div aria-label="计划范围" className="plan-tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                aria-controls={`plan-panel-${tab.id}`}
                aria-selected={activeTab === tab.id}
                className="plan-tab"
                data-active={activeTab === tab.id || undefined}
                id={`plan-tab-${tab.id}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          {currentWorkspace.source === "unavailable" ? (
            <p className="plan-action-message" role="alert">
              计划数据仍在准备中，请稍后刷新页面。
            </p>
          ) : null}
          {previewMessage ? (
            <p className="plan-preview-message" role="status">
              {previewMessage}
            </p>
          ) : null}
          {actionState.message ? (
            <p className="plan-action-message" role="alert">
              {actionState.message}
            </p>
          ) : null}
          <div
            aria-labelledby={`plan-tab-${activeTab}`}
            id={`plan-panel-${activeTab}`}
            role="tabpanel"
          >
            {activeTab === "day" ? (
              <DayPlanView
                action={action}
                date={date}
                onChangeDate={changeDate}
                onDemoDelete={deleteDemo}
                onDemoToggle={toggleDemo}
                pending={pending}
                workspace={currentWorkspace}
              />
            ) : null}
            {activeTab === "week" || activeTab === "month" ? (
              <ListPlanView
                action={action}
                date={date}
                onChangeDate={changeDate}
                onDemoDelete={deleteDemo}
                onDemoToggle={toggleDemo}
                pending={pending}
                scope={activeTab}
                workspace={currentWorkspace}
              />
            ) : null}
            {activeTab === "year" ? (
              <YearPlanView
                action={action}
                date={date}
                onChangeDate={changeDate}
                onDemoDelete={deleteDemo}
                onDemoToggle={toggleDemo}
                pending={pending}
                workspace={currentWorkspace}
              />
            ) : null}
          </div>
        </div>
      </section>
      {isCreateOpen ? (
        <PlanCreateDialog
          activeScope={activeTab}
          date={date}
          onClose={() => setIsCreateOpen(false)}
          onCreated={(target) => {
            setActiveTab(target.scope);
            setDate(target.date);
            setIsCreateOpen(false);
          }}
          onDemoCreate={(plan) =>
            update((current) => ({ ...current, extraPlans: [...current.extraPlans, plan] }))
          }
          persistLocally={workspace.source === "demo"}
          workspace={currentWorkspace}
        />
      ) : null}
    </AppShell>
  );
}
