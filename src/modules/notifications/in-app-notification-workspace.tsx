"use client";

import type { Route } from "next";
import Link from "next/link";
import { useActionState } from "react";

import { markInAppNotificationRead } from "@/app/me/notifications/actions";
import { useDemoSession } from "@/modules/demo/use-demo-session";
import { AppShell } from "@/modules/shell/app-shell";

import { initialInAppNotificationActionState } from "./in-app-notification-action-state";
import type {
  InAppNotificationData,
  InAppNotificationItem,
} from "./in-app-notification-data";

function deliveredAtLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function NotificationCard({
  item,
  locallyRead,
  onDemoToggle,
}: {
  item: InAppNotificationItem;
  locallyRead: boolean | null;
  onDemoToggle: ((read: boolean) => void) | null;
}) {
  const [state, action, pending] = useActionState(
    markInAppNotificationRead,
    initialInAppNotificationActionState,
  );
  const isRead = locallyRead ?? item.readAt !== null;

  return (
    <article className="in-app-notification-card" data-read={isRead || undefined}>
      <span className="in-app-notification-dot" aria-hidden="true" />
      <div>
        <header>
          <span>{isRead ? "已读提醒" : "新提醒"}</span>
          <time dateTime={item.deliveredAt}>{deliveredAtLabel(item.deliveredAt)}</time>
        </header>
        <h2>{item.planTitle}</h2>
        <p>这项日计划已到提醒时间，你可以打开详情查看当前状态。</p>
        <footer>
          <Link href={`/plan/${item.planId}` as Route}>查看计划</Link>
          {onDemoToggle ? (
            <button
              type="button"
              onClick={() => onDemoToggle(!isRead)}
            >
              {isRead ? "标为未读" : "标为已读"}
            </button>
          ) : (
            <form action={action}>
              <input name="notificationId" type="hidden" value={item.id} />
              <input name="read" type="hidden" value={isRead ? "false" : "true"} />
              <button disabled={pending} type="submit">
                {pending ? "更新中…" : isRead ? "标为未读" : "标为已读"}
              </button>
            </form>
          )}
        </footer>
        {state.message ? (
          <p className="in-app-notification-error" role="alert">
            {state.message}
          </p>
        ) : state.succeeded ? (
          <p className="in-app-notification-success" role="status">
            提醒状态已更新。
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function InAppNotificationWorkspace({ data }: { data: InAppNotificationData }) {
  const { session, update } = useDemoSession();
  const demo = data.source === "demo";
  const unreadCount = demo
    ? data.items.filter((item) => {
        const read =
          item.id in session.notificationRead
            ? session.notificationRead[item.id]
            : item.readAt !== null;
        return !read;
      }).length
    : data.unreadCount;

  return (
    <AppShell current="me">
      <section
        className="in-app-notification-page"
        aria-labelledby="in-app-notification-title"
      >
        <header className="in-app-notification-header">
          <Link href="/me">← 返回我的</Link>
          <div>
            <span className="in-app-notification-icon" aria-hidden="true">
              ◌
            </span>
            <div>
              <h1 id="in-app-notification-title">应用内提醒</h1>
              <p>
                {unreadCount > 0 ? `${unreadCount} 条未读提醒` : "当前没有未读提醒"}
              </p>
            </div>
          </div>
        </header>

        <aside className="in-app-notification-notice">
          <strong>系统通知尚未启用</strong>
          <p>日计划到了提醒时间后，会显示在这里。当前不会向设备发送 Push。</p>
        </aside>

        {data.source === "unavailable" ? (
          <div className="in-app-notification-empty" role="alert">
            <strong>提醒服务仍在准备中</strong>
            <p>暂时无法读取应用内提醒，请稍后刷新页面。</p>
          </div>
        ) : data.items.length ? (
          <div className="in-app-notification-list">
            {data.items.map((item) => (
              <NotificationCard
                item={item}
                key={item.id}
                locallyRead={
                  demo && item.id in session.notificationRead
                    ? session.notificationRead[item.id]
                    : null
                }
                onDemoToggle={
                  demo
                    ? (read) =>
                        update((current) => ({
                          ...current,
                          notificationRead: { ...current.notificationRead, [item.id]: read },
                        }))
                    : null
                }
              />
            ))}
          </div>
        ) : (
          <div className="in-app-notification-empty">
            <strong>这里还没有应用内提醒</strong>
            <p>日计划到了提醒时间后，打开这个页面就会显示在这里。</p>
            <Link href="/plan">查看我的计划</Link>
          </div>
        )}
      </section>
    </AppShell>
  );
}
