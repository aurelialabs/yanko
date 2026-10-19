"use client";

import Link from "next/link";
import type { Route } from "next";

import { applyDemoPlanSession } from "@/modules/demo/demo-session";
import { useDemoSession } from "@/modules/demo/use-demo-session";
import { AppShell } from "@/modules/shell/app-shell";
import type { ShellRole, ShellViewer } from "@/modules/shell/navigation";

import type { PlanDetailData } from "./plan-data";
import { PlanDetailActions } from "./plan-detail-actions";
import { PlanDetailInlineEditor } from "./plan-detail-inline-editor";
import type { PlanPresentation, PlanScope } from "./plan-presentation";

function scopeLabel(scope: PlanPresentation["scope"]) {
  return {
    day: "日计划",
    week: "周计划",
    month: "月计划",
    year: "年度目标",
  }[scope];
}

function periodLabel(plan: PlanPresentation, timezone: string) {
  if (plan.scope === "day") {
    if (!plan.scheduledAt) return plan.periodStart + " · 全天";

    const time = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(plan.scheduledAt));
    return plan.periodStart + " · " + time;
  }

  if (plan.scope === "week") {
    return plan.periodStart + " 至 " + plan.periodEnd;
  }

  if (plan.scope === "month") {
    return plan.periodStart.slice(0, 7);
  }

  return plan.periodStart.slice(0, 4) + " 年";
}

function returnHref(
  scope: PlanScope | undefined,
  date: string | undefined,
): Route<"/plan"> {
  if (!scope) return "/plan";
  return ("/plan?scope=" +
    scope +
    (date ? "&date=" + encodeURIComponent(date) : "")) as Route<"/plan">;
}

export function PlanDetail({
  detail,
  requestedPlanId,
  roles,
  returnDate,
  returnScope,
  viewer,
}: {
  detail: PlanDetailData;
  requestedPlanId?: string;
  roles?: ReadonlyArray<ShellRole>;
  returnDate?: string;
  returnScope?: PlanScope;
  viewer?: ShellViewer;
}) {
  const { session } = useDemoSession();
  const backHref = returnHref(returnScope, returnDate);
  const demoWorkspace =
    detail.source === "demo"
      ? applyDemoPlanSession(
          {
            source: "demo",
            anchorDate: "",
            timezone: detail.timezone,
            plans: detail.plan ? [detail.plan] : [],
          },
          session,
        )
      : null;
  const plan =
    detail.source === "demo"
      ? (demoWorkspace?.plans.find(
          (item) => item.id === (detail.plan?.id ?? requestedPlanId),
        ) ?? null)
      : detail.plan;

  if (detail.source === "unavailable") {
    return (
      <AppShell current="plan" roles={roles} viewer={viewer}>
        <section className="plan-detail-page" aria-labelledby="plan-detail-title">
          <header className="plan-detail-header">
            <Link aria-label="返回计划" href={backHref}>
              ‹
            </Link>
            <h1 id="plan-detail-title">计划详情</h1>
          </header>
          <p className="plan-detail-message" role="alert">
            计划数据仍在准备中，请稍后回到计划页刷新。
          </p>
        </section>
      </AppShell>
    );
  }

  if (!plan) {
    return (
      <AppShell current="plan" roles={roles} viewer={viewer}>
        <section className="plan-detail-page" aria-labelledby="plan-detail-title">
          <header className="plan-detail-header">
            <Link aria-label="返回计划" href={backHref}>
              ‹
            </Link>
            <h1 id="plan-detail-title">计划详情</h1>
          </header>
          <p className="plan-detail-message" role="alert">
            这个计划不存在，或你没有访问权限。
          </p>
        </section>
      </AppShell>
    );
  }

  const completed = plan.status === "completed";

  return (
    <AppShell current="plan" roles={roles} viewer={viewer}>
      <section className="plan-detail-page" aria-labelledby="plan-detail-title">
        <header className="plan-detail-header">
          <Link aria-label="返回计划" href={backHref}>
            ‹
          </Link>
          <h1 id="plan-detail-title">计划详情</h1>
        </header>
        <article className="plan-detail-card" data-completed={completed || undefined}>
          <span className="plan-detail-scope" data-scope={plan.scope}>
            {scopeLabel(plan.scope)}
          </span>
          <PlanDetailInlineEditor
            canEdit={detail.source === "database" || detail.source === "demo"}
            localDemo={detail.source === "demo"}
            completed={completed}
            dueDate={plan.dueDate}
            initialNotes={plan.notes}
            initialTitle={plan.title}
            isSubgoal={plan.scope === "year" && Boolean(plan.parentPlanId)}
            parentLabel={plan.parentPlanId ? "年度目标下的小目标" : undefined}
            periodEnd={plan.periodEnd}
            periodLabel={periodLabel(plan, detail.timezone)}
            periodStart={plan.periodStart}
            planId={plan.id}
            scheduledAt={plan.scheduledAt}
            scope={plan.scope}
            timezone={detail.timezone}
          />
          <PlanDetailActions
            canDelete={detail.source === "database"}
            canEdit={false}
            localDemo={detail.source === "demo"}
            periodEnd={plan.periodEnd}
            periodStart={plan.periodStart}
            planId={plan.id}
            removesSubgoals={plan.scope === "year" && !plan.parentPlanId}
            returnHref={backHref}
            scheduledAt={plan.scheduledAt}
            scope={plan.scope}
            timezone={detail.timezone}
            dueDate={plan.dueDate}
          />
          <Link className="plan-detail-return" href={backHref}>
            返回计划
          </Link>
        </article>
      </section>
    </AppShell>
  );
}
