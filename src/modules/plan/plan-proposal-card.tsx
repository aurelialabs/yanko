"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  confirmPlanProposalFromChat,
  rejectPlanProposalFromChat,
} from "@/app/plan/actions";

import { initialPlanActionState } from "./plan-action-state";
import type {
  PendingPlanProposalPresentation,
  PlanParentOption,
  PlanScope,
} from "./plan-presentation";

const scopeLabels: Record<PlanScope, string> = {
  day: "日计划",
  week: "周计划",
  month: "月计划",
  year: "年度计划",
};

const missingFieldLabels: Record<string, string> = {
  title: "计划名称",
  date: "日期",
  scheduledAt: "计划时间",
  reminderAt: "提醒时间",
  weekStart: "周起始日期",
  month: "月份",
  year: "年份",
  dueDate: "截止日期",
  parentPlanId: "年度大目标",
};

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function MissingInput({ name, when }: { name: string; when: boolean }) {
  return when ? <input name={name} type="hidden" value="" /> : null;
}

export function PlanProposalCard({
  proposal,
  parentOptions,
}: {
  proposal: PendingPlanProposalPresentation;
  parentOptions: readonly PlanParentOption[];
}) {
  const [confirmationKey] = useState(newIdempotencyKey);
  const [rejectionKey] = useState(newIdempotencyKey);
  const [confirmationState, confirmationAction, confirmationPending] = useActionState(
    confirmPlanProposalFromChat,
    initialPlanActionState,
  );
  const [rejectionState, rejectionAction, rejectionPending] = useActionState(
    rejectPlanProposalFromChat,
    initialPlanActionState,
  );
  const createdPlanId = confirmationState.createdPlanId;
  const rejected = rejectionState.rejectedProposalId === proposal.id && !createdPlanId;

  if (createdPlanId) {
    return (
      <article className="plan-proposal-card" data-state="completed">
        <p className="caption">计划已创建</p>
        <strong>{proposal.suggestedTitle || scopeLabels[proposal.scope]}</strong>
        <Link href={`/plan/${createdPlanId}`}>查看计划 →</Link>
      </article>
    );
  }

  if (rejected) {
    return (
      <article className="plan-proposal-card" data-state="dismissed">
        <p className="caption">已暂不创建</p>
        <strong>这份计划建议不会生成正式计划。</strong>
      </article>
    );
  }

  const relevantMissingFields = proposal.missingFields
    .map((field) => missingFieldLabels[field] ?? field)
    .join("、");

  return (
    <article className="plan-proposal-card">
      <header>
        <span>
          <small>计划建议</small>
          <strong>{scopeLabels[proposal.scope]}</strong>
        </span>
        <span className="plan-proposal-expiry">
          {proposal.expiresAt.slice(5, 10).replace("-", "/")} 前有效
        </span>
      </header>

      {proposal.originalTimeText ? (
        <p className="plan-proposal-source-time">
          你刚才说的是：“{proposal.originalTimeText}”
        </p>
      ) : null}
      {relevantMissingFields ? (
        <p className="plan-proposal-missing">保存前请补充：{relevantMissingFields}</p>
      ) : null}

      <form action={confirmationAction} className="plan-proposal-form">
        <input name="proposalId" type="hidden" value={proposal.id} />
        <input name="scope" type="hidden" value={proposal.scope} />
        <input name="idempotencyKey" type="hidden" value={confirmationKey} />

        <label>
          计划名称
          <input
            defaultValue={proposal.suggestedTitle}
            maxLength={200}
            name="title"
            placeholder="想完成什么？"
            required
          />
        </label>
        <label>
          备注（可选）
          <textarea
            maxLength={5_000}
            name="notes"
            placeholder="补充预计时长、上下文或完成标准"
          />
        </label>

        {proposal.scope === "day" ? (
          <div className="plan-proposal-field-grid">
            <label>
              日期
              <input defaultValue={proposal.date} name="dayDate" required type="date" />
            </label>
            <label>
              计划时间（可选）
              <input
                defaultValue={proposal.scheduledTime}
                name="scheduledTime"
                type="time"
              />
            </label>
            <label>
              提醒时间（可选）
              <input
                defaultValue={proposal.reminderTime}
                name="reminderTime"
                type="time"
              />
            </label>
          </div>
        ) : null}

        {proposal.scope === "week" ? (
          <div className="plan-proposal-field-grid">
            <label>
              这一周
              <input
                defaultValue={proposal.weekStart}
                name="weekDate"
                required
                type="date"
              />
            </label>
            <label>
              截止日期（可选）
              <input defaultValue={proposal.dueDate} name="dueDate" type="date" />
            </label>
          </div>
        ) : null}

        {proposal.scope === "month" ? (
          <div className="plan-proposal-field-grid">
            <label>
              月份
              <input defaultValue={proposal.month} name="month" required type="month" />
            </label>
            <label>
              截止日期（可选）
              <input defaultValue={proposal.dueDate} name="dueDate" type="date" />
            </label>
          </div>
        ) : null}

        {proposal.scope === "year" ? (
          <div className="plan-proposal-field-grid">
            <label>
              年份
              <input
                defaultValue={proposal.year}
                max={2100}
                min={2000}
                name="year"
                required
                type="number"
              />
            </label>
            <label>
              截止日期（可选）
              <input defaultValue={proposal.dueDate} name="dueDate" type="date" />
            </label>
            <label className="plan-proposal-wide">
              归入年度大目标（可选）
              <select defaultValue={proposal.parentPlanId} name="parentPlanId">
                <option value="">作为新的年度大目标</option>
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <MissingInput name="dayDate" when={proposal.scope !== "day"} />
        <MissingInput name="scheduledTime" when={proposal.scope !== "day"} />
        <MissingInput name="reminderTime" when={proposal.scope !== "day"} />
        <MissingInput name="weekDate" when={proposal.scope !== "week"} />
        <MissingInput name="month" when={proposal.scope !== "month"} />
        <MissingInput name="year" when={proposal.scope !== "year"} />
        <MissingInput name="dueDate" when={proposal.scope === "day"} />
        <MissingInput name="parentPlanId" when={proposal.scope !== "year"} />

        {confirmationState.message ? (
          <p className="plan-proposal-error" role="alert">
            {confirmationState.message}
          </p>
        ) : null}
        <button
          className="plan-proposal-confirm"
          disabled={confirmationPending || rejectionPending}
          type="submit"
        >
          {confirmationPending ? "正在创建…" : "确认并加入计划"}
        </button>
      </form>

      <form action={rejectionAction} className="plan-proposal-reject">
        <input name="proposalId" type="hidden" value={proposal.id} />
        <input name="idempotencyKey" type="hidden" value={rejectionKey} />
        {rejectionState.message ? (
          <p className="plan-proposal-error" role="alert">
            {rejectionState.message}
          </p>
        ) : null}
        <button disabled={confirmationPending || rejectionPending} type="submit">
          {rejectionPending ? "正在处理…" : "暂不创建"}
        </button>
      </form>
    </article>
  );
}
