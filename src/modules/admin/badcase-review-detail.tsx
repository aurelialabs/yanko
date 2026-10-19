"use client";

import type { Route } from "next";
import Link from "next/link";
import { useActionState } from "react";

import { updateBadcaseReviewStatus } from "@/app/admin/badcases/actions";
import {
  FEEDBACK_STATUSES,
  type AiRunStatus,
  type FeedbackStatus,
  type OocVerdict,
} from "@/types/domain";

import { initialBadcaseReviewActionState } from "./badcase-review-action-state";
import type { AdminBadcaseDetail, AdminBadcaseDetailData } from "./badcase-review-data";

const statusLabels: Record<FeedbackStatus, string> = {
  open: "待处理",
  triaged: "已分诊",
  resolved: "已解决",
  dismissed: "已关闭",
};

const aiRunStatusLabels: Record<AiRunStatus, string> = {
  running: "生成中",
  completed: "已完成",
  blocked: "已拦截",
  failed: "失败",
};

const oocVerdictLabels: Record<OocVerdict, string> = {
  pass: "通过",
  rewrite: "已改写",
  block: "拦截",
  error: "校验失败",
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function DetailNotice({
  source,
}: {
  source: Exclude<AdminBadcaseDetailData["source"], "database">;
}) {
  const content =
    source === "forbidden"
      ? ["你没有访问此后台的权限", "Badcase 诊断只对已启用的管理员账户开放。"]
      : source === "not_found"
        ? ["这条 Badcase 不存在或已被清理", "请返回列表查看当前可用的已脱敏诊断。"]
        : ["后台服务尚未就绪", "当前无法验证管理员权限或读取脱敏诊断，请稍后重试。"];

  return (
    <main className="admin-badcase-page">
      <section className="admin-badcase-empty" role="alert">
        <h1>{content[0]}</h1>
        <p>{content[1]}</p>
        <Link href={"/admin/badcases" as Route}>返回 Badcase 列表</Link>
      </section>
    </main>
  );
}

function DatabaseBadcaseReviewDetail({ item }: { item: AdminBadcaseDetail }) {
  const [state, action, pending] = useActionState(
    updateBadcaseReviewStatus,
    initialBadcaseReviewActionState,
  );
  const currentStatus = state.succeeded && state.status ? state.status : item.status;
  const currentRevision =
    state.succeeded && typeof state.reviewRevision === "number"
      ? state.reviewRevision
      : item.reviewRevision;

  return (
    <main className="admin-badcase-page">
      <header className="admin-badcase-detail-header">
        <Link href={"/admin/badcases" as Route}>← 返回 Badcase 列表</Link>
        <p>受控开发者后台 · 已脱敏诊断</p>
        <h1>{item.capability}</h1>
        <span data-severity={item.severity}>{item.severity}</span>
      </header>

      <section className="admin-badcase-detail-grid">
        <article className="admin-badcase-detail-card">
          <h2>复核摘要</h2>
          <dl>
            <div>
              <dt>来源</dt>
              <dd>{item.source}</dd>
            </div>
            <div>
              <dt>当前状态</dt>
              <dd>{statusLabels[currentStatus]}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{dateTime(item.createdAt)}</dd>
            </div>
            <div>
              <dt>解决时间</dt>
              <dd>{dateTime(item.resolvedAt)}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-badcase-detail-card">
          <h2>已脱敏片段</h2>
          <p>{item.redactedExcerpt ?? "未保留可展示的已脱敏片段。"}</p>
        </article>

        <article className="admin-badcase-detail-card">
          <h2>诊断摘要</h2>
          <p>{item.diagnosis ?? "尚未填写诊断摘要。"}</p>
        </article>

        {item.aiRun ? (
          <article className="admin-badcase-detail-card admin-badcase-ai-run-card">
            <h2>AI Run 摘要</h2>
            <dl>
              <div>
                <dt>运行状态</dt>
                <dd>{aiRunStatusLabels[item.aiRun.status]}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>
                  {item.aiRun.provider} · {item.aiRun.model}
                </dd>
              </div>
              <div>
                <dt>尝试次数</dt>
                <dd>{item.aiRun.attemptNo}</dd>
              </div>
              <div>
                <dt>是否改写</dt>
                <dd>{item.aiRun.rewritten ? "是" : "否"}</dd>
              </div>
              <div>
                <dt>延迟</dt>
                <dd>
                  {item.aiRun.latencyMs === null ? "—" : `${item.aiRun.latencyMs} ms`}
                </dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>
                  {item.aiRun.inputTokens ?? "—"} / {item.aiRun.outputTokens ?? "—"}
                </dd>
              </div>
            </dl>
            {item.aiRun.errorCode ? (
              <p className="admin-badcase-ai-run-error">
                失败分类：{item.aiRun.errorCode}
              </p>
            ) : null}
            {item.aiRun.oocChecks.length ? (
              <div className="admin-badcase-ooc-list">
                <strong>OOC 检查</strong>
                <ul>
                  {item.aiRun.oocChecks.map((check) => (
                    <li key={check.attemptNo}>
                      第 {check.attemptNo} 次 · {oocVerdictLabels[check.verdict]}
                      {check.overallScore === null
                        ? ""
                        : ` · ${(check.overallScore * 100).toFixed(0)} 分`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="admin-badcase-ai-run-note">
              仅显示运行元数据和 OOC 结果，不显示聊天正文、Prompt、reasoning
              或原始产物。
            </p>
          </article>
        ) : null}

        <section
          className="admin-badcase-status-form"
          aria-labelledby="badcase-status-title"
        >
          <h2 id="badcase-status-title">更新复核状态</h2>
          <p>保存前会重新验证管理员权限和记录版本；较新的复核不会被静默覆盖。</p>
          <form action={action}>
            <input name="badcaseId" type="hidden" value={item.id} />
            <input name="expectedRevision" type="hidden" value={currentRevision} />
            <label>
              状态
              <select
                defaultValue={currentStatus}
                disabled={pending}
                key={`${item.id}:${currentRevision}`}
                name="status"
              >
                {FEEDBACK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={pending} type="submit">
              {pending ? "正在更新…" : "保存复核状态"}
            </button>
          </form>
          {state.message ? (
            <p role={state.succeeded ? "status" : "alert"}>{state.message}</p>
          ) : null}
        </section>
      </section>
    </main>
  );
}

export function BadcaseReviewDetail({ data }: { data: AdminBadcaseDetailData }) {
  if (data.source !== "database") return <DetailNotice source={data.source} />;

  return <DatabaseBadcaseReviewDetail item={data.item} />;
}
