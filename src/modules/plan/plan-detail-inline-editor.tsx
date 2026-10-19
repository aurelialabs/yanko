"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { updatePlanDetails } from "@/app/plan/actions";
import { demoPlanPatchFromForm, updateDemoSession } from "@/modules/demo/demo-session";
import { initialPlanActionState } from "@/modules/plan/plan-action-state";

import type { PlanScope } from "./plan-presentation";

type EditableField = "title" | "period" | "notes";

function createIdempotencyKey() {
  return crypto.randomUUID();
}

function localTime(value: string | null, timezone: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return read("hour") + ":" + read("minute");
}

function fieldLabel(field: EditableField, isSubgoal: boolean) {
  if (field === "title") return isSubgoal ? "编辑子目标标题" : "编辑计划标题";
  if (field === "period") return "编辑时间范围";
  return "编辑备注";
}

export function PlanDetailInlineEditor({
  canEdit,
  completed,
  dueDate,
  initialNotes,
  initialTitle,
  isSubgoal,
  localDemo = false,
  periodEnd,
  periodLabel,
  periodStart,
  planId,
  parentLabel,
  scheduledAt,
  scope,
  timezone,
}: {
  canEdit: boolean;
  completed: boolean;
  dueDate: string | null;
  initialNotes: string | null;
  initialTitle: string;
  isSubgoal: boolean;
  localDemo?: boolean;
  periodEnd: string;
  periodLabel: string;
  periodStart: string;
  planId: string;
  parentLabel?: string;
  scheduledAt: string | null;
  scope: PlanScope;
  timezone: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [state, action, pending] = useActionState(
    updatePlanDetails,
    initialPlanActionState,
  );

  useEffect(() => {
    if (state.updatedPlanId !== planId) return undefined;

    const timer = window.setTimeout(() => {
      setEditing(null);
      router.refresh();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [planId, router, state.updatedPlanId]);

  const openEditor = (field: EditableField) => {
    if (!canEdit) return;
    setIdempotencyKey(createIdempotencyKey());
    setEditing(field);
  };

  const closeEditor = () => {
    if (!pending) setEditing(null);
  };

  const editForm = (field: EditableField) => (
    <form
      action={action}
      className={"plan-inline-form plan-inline-form-" + field}
      onSubmit={(event) => {
        if (scope === "day") {
          const form = event.currentTarget;
          const start = form.elements.namedItem("periodStart");
          const end = form.elements.namedItem("periodEnd");
          if (start instanceof HTMLInputElement && end instanceof HTMLInputElement) {
            end.value = start.value;
          }
        }
        if (!localDemo) return;

        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const read = (name: string) => {
          const value = data.get(name);
          return typeof value === "string" ? value : "";
        };
        const patch = demoPlanPatchFromForm({
          scope,
          title: read("title"),
          notes: read("notes"),
          periodStart: read("periodStart"),
          dueDate: read("dueDate"),
          scheduledTime: read("scheduledTime"),
        });
        if (!patch) return;

        updateDemoSession((current) => ({
          ...current,
          planEdits: { ...current.planEdits, [planId]: patch },
        }));
        setEditing(null);
      }}
    >
      <input name="planId" type="hidden" value={planId} />
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      <input name="scope" type="hidden" value={scope} />
      {field !== "title" ? (
        <input name="title" type="hidden" value={initialTitle} />
      ) : null}
      {field !== "notes" ? (
        <input name="notes" type="hidden" value={initialNotes ?? ""} />
      ) : null}
      {field !== "period" ? (
        <>
          <input name="periodStart" type="hidden" value={periodStart} />
          <input name="periodEnd" type="hidden" value={periodEnd} />
          <input name="dueDate" type="hidden" value={dueDate ?? ""} />
          <input
            name="scheduledTime"
            type="hidden"
            value={localTime(scheduledAt, timezone)}
          />
        </>
      ) : (
        <input name="periodEnd" type="hidden" value={periodEnd} />
      )}
      {field === "title" ? (
        <input
          autoFocus
          defaultValue={initialTitle}
          maxLength={200}
          name="title"
          required
          type="text"
        />
      ) : null}
      {field === "period" ? (
        <>
          {scope === "day" ? (
            <>
              <label>
                <span>日期</span>
                <input
                  defaultValue={periodStart}
                  name="periodStart"
                  required
                  type="date"
                />
              </label>
              <label>
                <span>时间点（可选）</span>
                <input
                  defaultValue={localTime(scheduledAt, timezone)}
                  name="scheduledTime"
                  type="time"
                />
              </label>
            </>
          ) : (
            <label>
              <span>
                {scope === "week"
                  ? "周一（开始）"
                  : scope === "month"
                    ? "月初（开始）"
                    : "年初（开始）"}
              </span>
              <input
                defaultValue={periodStart}
                name="periodStart"
                required
                type="date"
              />
            </label>
          )}
          <label>
            <span>截止日期（可选）</span>
            <input defaultValue={dueDate ?? ""} name="dueDate" type="date" />
          </label>
        </>
      ) : null}
      {field === "notes" ? (
        <textarea
          autoFocus
          defaultValue={initialNotes ?? ""}
          maxLength={5000}
          name="notes"
          placeholder="写下一点说明或提醒"
          rows={3}
        />
      ) : null}
      {state.message ? (
        <p className="plan-action-message" role="alert">
          {state.message}
        </p>
      ) : null}
      <footer>
        <button disabled={pending} onClick={closeEditor} type="button">
          取消
        </button>
        <button disabled={pending} type="submit">
          {pending ? "保存中…" : "保存"}
        </button>
      </footer>
    </form>
  );

  return (
    <>
      {editing === "title" ? (
        editForm("title")
      ) : (
        <h2 aria-label={initialTitle}>
          <button
            aria-label={fieldLabel("title", isSubgoal)}
            className="plan-inline-title-button"
            disabled={!canEdit}
            onClick={() => openEditor("title")}
            type="button"
          >
            {initialTitle}
          </button>
        </h2>
      )}
      <dl>
        <div>
          <dt>时间范围</dt>
          <dd>
            {editing === "period" ? (
              editForm("period")
            ) : (
              <button
                aria-label={fieldLabel("period", isSubgoal)}
                className="plan-inline-value-button"
                disabled={!canEdit}
                onClick={() => openEditor("period")}
                type="button"
              >
                {periodLabel}
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>当前状态</dt>
          <dd>{completed ? "已完成" : "进行中"}</dd>
        </div>
        {dueDate && editing !== "period" ? (
          <div>
            <dt>截止日期</dt>
            <dd>
              <button
                aria-label="编辑截止日期"
                className="plan-inline-value-button"
                disabled={!canEdit}
                onClick={() => openEditor("period")}
                type="button"
              >
                {dueDate}
              </button>
            </dd>
          </div>
        ) : null}
        {parentLabel ? (
          <div>
            <dt>目标层级</dt>
            <dd>{parentLabel}</dd>
          </div>
        ) : null}
      </dl>
      <div className="plan-detail-notes">
        <h3>备注</h3>
        {editing === "notes" ? (
          editForm("notes")
        ) : (
          <button
            aria-label={fieldLabel("notes", isSubgoal)}
            className="plan-inline-notes-button"
            disabled={!canEdit}
            onClick={() => openEditor("notes")}
            type="button"
          >
            <p>{initialNotes ?? "还没有添加备注。"}</p>
          </button>
        )}
      </div>
    </>
  );
}
