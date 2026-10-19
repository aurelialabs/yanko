import type { Route } from "next";
import Link from "next/link";

import {
  BADCASE_SEVERITIES,
  BADCASE_SOURCES,
  defaultBadcaseListFilter,
  type AdminBadcaseListData,
  type BadcaseFilterValue,
  type BadcaseListFilter,
  type BadcaseSeverity,
  type BadcaseSource,
} from "./badcase-review-data";
import { FEEDBACK_STATUSES, type FeedbackStatus } from "@/types/domain";

const statusLabels: Record<FeedbackStatus, string> = {
  open: "待处理",
  triaged: "已分诊",
  resolved: "已解决",
  dismissed: "已关闭",
};

const severityLabels: Record<BadcaseSeverity, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

const sourceLabels: Record<BadcaseSource, string> = {
  persona_feedback: "人设反馈",
  automatic_eval: "自动评测",
  manual: "人工记录",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function filterHref(
  current: BadcaseListFilter,
  key: keyof BadcaseListFilter,
  value: string,
) {
  const next = { ...current, [key]: value } as BadcaseListFilter;
  const params = new URLSearchParams();
  if (next.status !== "all") params.set("status", next.status);
  if (next.severity !== "all") params.set("severity", next.severity);
  if (next.source !== "all") params.set("source", next.source);
  const search = params.toString();
  return `/admin/badcases${search ? `?${search}` : ""}` as Route;
}

function FilterGroup<T extends string>({
  current,
  filter,
  label,
  values,
  labels,
}: {
  current: BadcaseListFilter;
  filter: keyof BadcaseListFilter;
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
}) {
  const selected = current[filter] as BadcaseFilterValue<T>;
  const options: ReadonlyArray<BadcaseFilterValue<T>> = ["all", ...values];

  return (
    <section className="admin-badcase-filter" aria-label={label}>
      <strong>{label}</strong>
      <div>
        {options.map((value) => {
          const active = value === selected;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              href={filterHref(current, filter, value)}
              key={value}
            >
              {value === "all" ? "全部" : labels[value]}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function AccessNotice({
  source,
}: {
  source: Exclude<AdminBadcaseListData["source"], "database">;
}) {
  const content =
    source === "forbidden"
      ? {
          title: "你没有访问此后台的权限",
          body: "Badcase 诊断只对已启用的管理员账户开放。",
        }
      : {
          title: "后台服务尚未就绪",
          body: "当前无法验证管理员权限或读取脱敏诊断，请稍后重试。",
        };

  return (
    <main className="admin-badcase-page">
      <section className="admin-badcase-empty" role="alert">
        <h1>{content.title}</h1>
        <p>{content.body}</p>
        <Link href="/chat">返回言行</Link>
      </section>
    </main>
  );
}

export function BadcaseReviewList({
  data,
  filter = defaultBadcaseListFilter,
}: {
  data: AdminBadcaseListData;
  filter?: BadcaseListFilter;
}) {
  if (data.source !== "database") return <AccessNotice source={data.source} />;

  return (
    <main className="admin-badcase-page">
      <header className="admin-badcase-header">
        <span aria-hidden="true">◆</span>
        <div>
          <p>受控开发者后台</p>
          <h1>Badcase 复核</h1>
          <small>
            仅显示已脱敏的诊断摘要，不显示用户身份、聊天正文或模型原始产物。
          </small>
        </div>
      </header>

      <nav className="admin-badcase-filters" aria-label="Badcase 筛选">
        <FilterGroup
          current={filter}
          filter="status"
          label="状态"
          labels={statusLabels}
          values={FEEDBACK_STATUSES}
        />
        <FilterGroup
          current={filter}
          filter="severity"
          label="严重程度"
          labels={severityLabels}
          values={BADCASE_SEVERITIES}
        />
        <FilterGroup
          current={filter}
          filter="source"
          label="来源"
          labels={sourceLabels}
          values={BADCASE_SOURCES}
        />
      </nav>

      {data.items.length ? (
        <section className="admin-badcase-list" aria-label="Badcase 列表">
          {data.items.map((item) => (
            <article className="admin-badcase-card" key={item.id}>
              <header>
                <span data-severity={item.severity}>
                  {severityLabels[item.severity]}
                </span>
                <span>{statusLabels[item.status]}</span>
                <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
              </header>
              <h2>{item.capability}</h2>
              <p>{item.redactedExcerpt ?? "未保留可展示的已脱敏片段。"}</p>
              <footer>
                <span>{sourceLabels[item.source]}</span>
                <Link href={`/admin/badcases/${item.id}` as Route}>查看复核详情</Link>
              </footer>
            </article>
          ))}
        </section>
      ) : (
        <section className="admin-badcase-empty">
          <h2>没有符合条件的 Badcase</h2>
          <p>切换筛选条件，或等待新的已脱敏诊断进入后台。</p>
        </section>
      )}
    </main>
  );
}
