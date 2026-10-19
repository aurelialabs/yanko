"use client";

import { useActionState, useEffect, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { deletePlan, updatePlanDetails } from "@/app/plan/actions";
import { updateDemoSession } from "@/modules/demo/demo-session";
import { initialPlanActionState } from "@/modules/plan/plan-action-state";
import type { PlanScope } from "@/modules/plan/plan-presentation";

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

export function PlanDetailActions({
  canDelete,
  canEdit = canDelete,
  initialNotes = null,
  initialTitle = "",
  isSubgoal = false,
  localDemo = false,
  periodEnd,
  periodStart,
  planId,
  removesSubgoals,
  returnHref = "/plan" as Route<"/plan">,
  scheduledAt = null,
  scope,
  timezone = "Asia/Shanghai",
  dueDate = null,
}: {
  canDelete: boolean;
  canEdit?: boolean;
  initialNotes?: string | null;
  initialTitle?: string;
  isSubgoal?: boolean;
  localDemo?: boolean;
  periodEnd: string;
  periodStart: string;
  planId: string;
  removesSubgoals: boolean;
  returnHref?: Route<"/plan">;
  scheduledAt?: string | null;
  scope: PlanScope;
  timezone?: string;
  dueDate?: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [idempotencyKey] = useState(createIdempotencyKey);
  const [editIdempotencyKey, setEditIdempotencyKey] = useState("");
  const [state, action, pending] = useActionState(deletePlan, initialPlanActionState);
  const [updateState, updateAction, updatePending] = useActionState(
    updatePlanDetails,
    initialPlanActionState,
  );

  useEffect(() => {
    if (state.deletedPlanId === planId) {
      router.replace(returnHref);
    }
  }, [planId, returnHref, router, state.deletedPlanId]);

  useEffect(() => {
    if (updateState.updatedPlanId === planId) {
      const timer = window.setTimeout(() => setEditing(false), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [planId, updateState.updatedPlanId]);

  if (!canDelete && !canEdit) {
    if (!localDemo) {
      return (
        <p className="plan-detail-preview-note">
          当前为原型预览，未连接计划服务，不能删除演示数据。
        </p>
      );
    }

    return (
      <button
        className="plan-detail-return"
        type="button"
        onClick={() => {
          updateDemoSession((current) => ({
            ...current,
            deletedPlanIds: [...new Set([...current.deletedPlanIds, planId])],
          }));
          router.replace(returnHref);
        }}
      >
        从这台浏览器移除
      </button>
    );
  }

  return (
    <section className="plan-detail-actions" aria-label="计划操作">
      {canEdit ? (
        editing ? (
          <form
            action={updateAction}
            className="plan-edit-form"
            onSubmit={(event) => {
              if (scope === "day") {
                const form = event.currentTarget;
                const start = form.elements.namedItem("periodStart");
                const end = form.elements.namedItem("periodEnd");
                if (
                  start instanceof HTMLInputElement &&
                  end instanceof HTMLInputElement
                ) {
                  end.value = start.value;
                }
              }
            }}
          >
            <input name="planId" type="hidden" value={planId} />
            <input name="idempotencyKey" type="hidden" value={editIdempotencyKey} />
            <input name="scope" type="hidden" value={scope} />
            <label>
              <span>标题</span>
              <input
                autoFocus
                defaultValue={initialTitle}
                maxLength={200}
                name="title"
                required
                type="text"
              />
            </label>
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
                <input defaultValue={periodStart} name="periodEnd" type="hidden" />
              </>
            ) : (
              <div className="plan-edit-field-grid">
                <label>
                  <span>
                    {scope === "week"
                      ? "周一（开始）"
                      : scope === "month"
                        ? "月初（开始）"
                        : scope === "year"
                          ? "年初（开始）"
                          : "开始日期"}
                  </span>
                  <input
                    defaultValue={periodStart}
                    name="periodStart"
                    required
                    type="date"
                  />
                </label>
                <label>
                  <span>
                    {scope === "week" || scope === "month" || scope === "year"
                      ? "结束日期（自动）"
                      : "结束日期"}
                  </span>
                  <input
                    defaultValue={periodEnd}
                    name="periodEnd"
                    readOnly
                    required
                    type="date"
                  />
                </label>
              </div>
            )}
            {scope === "day" ? (
              <label>
                <span>时间点（可选）</span>
                <input
                  defaultValue={localTime(scheduledAt, timezone)}
                  name="scheduledTime"
                  type="time"
                />
              </label>
            ) : null}
            <label>
              <span>截止日期（可选）</span>
              <input defaultValue={dueDate ?? ""} name="dueDate" type="date" />
            </label>
            <label>
              <span>备注（可选）</span>
              <textarea
                defaultValue={initialNotes ?? ""}
                maxLength={5000}
                name="notes"
                rows={3}
              />
            </label>
            {updateState.message ? (
              <p className="plan-action-message" role="alert">
                {updateState.message}
              </p>
            ) : null}
            <footer>
              <button
                disabled={updatePending}
                onClick={() => setEditing(false)}
                type="button"
              >
                取消
              </button>
              <button disabled={updatePending} type="submit">
                {updatePending ? "保存中…" : "保存修改"}
              </button>
            </footer>
          </form>
        ) : (
          <button
            className="plan-edit-button"
            onClick={() => {
              setEditIdempotencyKey(createIdempotencyKey());
              setEditing(true);
            }}
            type="button"
          >
            {isSubgoal ? "编辑子目标" : "编辑计划"}
          </button>
        )
      ) : null}
      {confirming ? (
        <div className="plan-delete-confirmation">
          <p>
            {removesSubgoals
              ? "删除这个年度大目标后，下面的小目标也会一起删除。"
              : "删除后无法恢复这个计划。"}
          </p>
          <form action={action}>
            <input name="planId" type="hidden" value={planId} />
            <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
            <button disabled={pending} type="submit">
              {pending ? "删除中…" : "确认删除"}
            </button>
            <button
              disabled={pending}
              onClick={() => setConfirming(false)}
              type="button"
            >
              取消
            </button>
          </form>
        </div>
      ) : (
        <button
          className="plan-delete-button"
          onClick={() => setConfirming(true)}
          type="button"
        >
          删除计划
        </button>
      )}
      {state.message ? (
        <p className="plan-action-message" role="alert">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
