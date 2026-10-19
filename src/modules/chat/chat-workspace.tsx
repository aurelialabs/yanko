"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  loadOlderChatMessages,
  retryFailedChatMessage,
  sendChatMessage,
  submitPersonaFeedback,
} from "@/app/chat/actions";
import { replyDemoChat } from "@/app/chat/demo-actions";
import {
  applyDemoMemories,
  applyDemoPlanSession,
  demoConfirmedPlan,
  demoRoleKey,
  memoryDraftFromMessage,
  planDraftFromMessage,
  readDemoSession,
  updateDemoSession,
  type DemoPendingPlan,
  type DemoSession,
} from "@/modules/demo/demo-session";
import { useDemoSession } from "@/modules/demo/use-demo-session";
import { demoMemoryManagementData } from "@/modules/profile/memory-presentation";
import { createDemoPlanWorkspace } from "@/modules/plan/plan-presentation";
import { buildChatTodayOverview } from "@/modules/chat/chat-today-overview";
import { buildChatThread, scriptedMessageTime } from "@/modules/chat/chat-time";
import {
  initialChatActionState,
  initialPersonaFeedbackActionState,
} from "@/modules/chat/chat-action-state";
import type {
  ChatMessagePresentation,
  ChatTodayOverview,
  ChatWorkspaceData,
} from "@/modules/chat/chat-presentation";
import { MemoryCandidateCard } from "@/modules/profile/memory-candidate-card";
import { PlanProposalCard } from "@/modules/plan/plan-proposal-card";
import type {
  PendingPlanProposalPresentation,
  PlanParentOption,
} from "@/modules/plan/plan-presentation";
import type {
  RolePresentation,
  RoleWorkspaceData,
} from "@/modules/roles/role-presentation";
import { AppShell } from "@/modules/shell/app-shell";
import type { PersonaFeedbackCategory } from "@/types/domain";

const feedbackReasons = [
  { label: "语气不符合", category: "tone_mismatch" },
  { label: "事实错误", category: "fact_error" },
  { label: "太冷漠", category: "too_cold" },
  { label: "超界了", category: "boundary_violation" },
] as const satisfies readonly {
  label: string;
  category: PersonaFeedbackCategory;
}[];

type FeedbackTarget = {
  messageId: string;
  content: string;
  personaVersionId: string | null | undefined;
  entryPoint: "long_press" | "context_menu";
};

function newClientMessageId() {
  return crypto.randomUUID();
}

function greetingFor(role: RolePresentation) {
  if (!role.templateKey) {
    return `你好，我是${role.name}。今天想从哪里开始？`;
  }

  if (role.templateKey === "zhou_yuan") {
    return "早上好。今天最需要先理清的，是哪一件事？";
  }

  if (role.templateKey === "nanzhi") {
    return "早上好！今天先选一件最小、最容易开始的事，好吗？";
  }

  return "早上好。今天醒来时，心里最先冒出来的感觉是什么？";
}

function rolesForDemo(
  workspace: RoleWorkspaceData,
  session: DemoSession,
): RolePresentation[] {
  return [
    ...workspace.roles,
    ...session.customRoles.map((role) => ({
      id: role.id,
      templateKey: null,
      name: role.name,
      label: role.label,
      description: role.description,
      direction: "自定义陪伴",
      quote: role.quote,
      initial: role.name.slice(0, 1) || "角",
      tone: "periwinkle" as const,
      stats: { chatCount: "新角色", memoryCount: "0 条", companionDays: "刚刚" },
    })),
  ];
}

function pendingPlanLabel(draft: DemoPendingPlan) {
  if (draft.scope === "week") return `本周 · ${draft.title}`;
  if (draft.scope === "month") return `这个月 · ${draft.title}`;
  if (draft.scope === "year") return `今年 · ${draft.title}`;
  return draft.time ? `今天 ${draft.time} · ${draft.title}` : `今天 · ${draft.title}`;
}

function pendingPlanAction(draft: DemoPendingPlan) {
  const scopeName = {
    day: "日计划",
    week: "周计划",
    month: "月计划",
    year: "年度目标",
  }[draft.scope];
  return draft.flowAction === "ask_to_create" ? `记成${scopeName} →` : `确认加入${scopeName} →`;
}

function mergeMessages(
  ...groups: readonly ChatMessagePresentation[][]
): ChatMessagePresentation[] {
  const byId = new Map<string, ChatMessagePresentation>();
  for (const group of groups) {
    for (const message of group) byId.set(message.id, message);
  }
  return Array.from(byId.values());
}

function messageStatusLabel(
  message: ChatMessagePresentation,
  runtimeMode: ChatWorkspaceData["runtimeMode"],
): string | null {
  if (message.status === "pending") {
    return message.sender === "assistant"
      ? runtimeMode === "minimax-development"
        ? "MiniMax-M3 回复生成中…"
        : "本地回复生成中…"
      : "发送中…";
  }
  if (message.status === "failed") {
    return message.sender === "assistant"
      ? "回复暂时不可用，可使用原消息重试"
      : "发送失败，原消息已保留";
  }
  return null;
}

function MessageComposer({
  chatWorkspace,
  role,
  onDemoTurn,
}: {
  chatWorkspace: ChatWorkspaceData;
  role: RolePresentation;
  onDemoTurn: (content: string) => void;
}) {
  const [state, action, pending] = useActionState(
    sendChatMessage,
    initialChatActionState,
  );
  const [clientMessageId, setClientMessageId] = useState(newClientMessageId);
  const formRef = useRef<HTMLFormElement>(null);
  const canPersist = Boolean(
    chatWorkspace.source === "database" && chatWorkspace.conversationId && role.id,
  );
  useEffect(() => {
    if (!state.sentMessageId || state.clientMessageId !== clientMessageId) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      formRef.current?.reset();
      setClientMessageId(newClientMessageId());
    }, 0);

    return () => window.clearTimeout(timer);
  }, [clientMessageId, state.clientMessageId, state.sentMessageId]);
  return (
    <>
      <form
        ref={formRef}
        className="message-composer"
        onSubmit={(event) => {
          event.preventDefault();

          if (!canPersist) {
            const value = new FormData(event.currentTarget).get("content");
            if (typeof value === "string" && value.trim()) {
              onDemoTurn(value.trim());
              event.currentTarget.reset();
            }
            return;
          }

          const formData = new FormData(event.currentTarget);
          startTransition(() => action(formData));
        }}
      >
        <input name="roleId" type="hidden" value={role.id ?? ""} />
        <input
          name="conversationId"
          type="hidden"
          value={chatWorkspace.conversationId ?? ""}
        />
        <input name="clientMessageId" type="hidden" value={clientMessageId} />
        <label className="sr-only" htmlFor="message">
          输入消息
        </label>
        <div className="message-input-wrap">
          <input
            className="message-input"
            disabled={pending || chatWorkspace.source === "unavailable"}
            id="message"
            maxLength={20_000}
            name="content"
            placeholder={
              chatWorkspace.source === "unavailable"
                ? "聊天服务仍在准备中"
                : "说点什么…"
            }
            required
            autoComplete="off"
          />
          <span className="composer-voice" aria-hidden="true">
            ◉
          </span>
        </div>
        <button
          className="round-button"
          disabled={pending || chatWorkspace.source === "unavailable"}
          type="submit"
          aria-label="发送消息"
        >
          ↑
        </button>
      </form>
      {state.message ? (
        <p className="chat-action-message" role="alert">
          {state.message}
        </p>
      ) : null}
      {pending && chatWorkspace.runtimeMode === "minimax-development" ? (
        <p className="chat-action-message" role="status">
          MiniMax-M3 正在生成并检查回复…
        </p>
      ) : null}
    </>
  );
}

function RetryFailedReply({ userMessageId }: { userMessageId: string }) {
  const [state, action, pending] = useActionState(
    retryFailedChatMessage,
    initialChatActionState,
  );
  const [idempotencyKey] = useState(newClientMessageId);

  return (
    <>
      <form
        className="message-retry-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(() => action(formData));
        }}
      >
        <input name="userMessageId" type="hidden" value={userMessageId} />
        <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <button className="message-retry-button" disabled={pending} type="submit">
          {pending ? "重试中…" : "重试回复"}
        </button>
      </form>
      {state.message ? (
        <p className="chat-action-message" role="alert">
          {state.message}
        </p>
      ) : null}
    </>
  );
}

export function ChatWorkspace({
  chatWorkspace,
  roleWorkspace,
  todayOverview,
  planParentOptions,
}: {
  chatWorkspace: ChatWorkspaceData;
  roleWorkspace: RoleWorkspaceData;
  todayOverview: ChatTodayOverview;
  planParentOptions: readonly PlanParentOption[];
}) {
  const { session, update } = useDemoSession();
  const demoPlanWorkspace = createDemoPlanWorkspace();
  const demoRoles =
    chatWorkspace.source === "demo" ? rolesForDemo(roleWorkspace, session) : roleWorkspace.roles;
  const role =
    chatWorkspace.source === "demo"
      ? (demoRoles.find((item) => demoRoleKey(item) === session.activeRoleKey) ??
        roleWorkspace.currentRole)
      : roleWorkspace.currentRole;
  const roleKey = demoRoleKey(role);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null);
  const [reason, setReason] = useState<(typeof feedbackReasons)[number]>(
    feedbackReasons[0],
  );
  const [feedbackId, setFeedbackId] = useState(newClientMessageId);
  const [demoFeedbackSubmitted, setDemoFeedbackSubmitted] = useState(false);
  const [feedbackActionState, feedbackAction, feedbackPending] = useActionState(
    submitPersonaFeedback,
    initialPersonaFeedbackActionState,
  );
  const [demoMessages, setDemoMessages] = useState<ChatMessagePresentation[]>([]);
  const [messagesHydrated, setMessagesHydrated] = useState(
    chatWorkspace.source !== "demo",
  );
  const [demoMessage, setDemoMessage] = useState("");
  const [olderMessages, setOlderMessages] = useState<ChatMessagePresentation[]>([]);
  const [visiblePlanProposals] = useState<PendingPlanProposalPresentation[]>(() => [
    ...chatWorkspace.planProposals,
  ]);
  const [nextCursor, setNextCursor] = useState(chatWorkspace.history.nextCursor);
  const [hasMore, setHasMore] = useState(chatWorkspace.history.hasMore);
  const [historyError, setHistoryError] = useState("");
  const [hasUnseenMessages, setHasUnseenMessages] = useState(false);
  const [historyPending, startHistoryTransition] = useTransition();
  const conversationRef = useRef<HTMLDivElement>(null);
  const seenMessageIds = useRef<Set<string> | null>(null);
  const restoreScrollHeight = useRef<number | null>(null);
  const initialScrollDone = useRef(false);
  const nearBottom = useRef(true);
  const demoReplyPending = useRef(false);
  const skipMessageWrite = useRef(true);
  const latestServerMessageId = chatWorkspace.history.messages.at(-1)?.id ?? null;
  const previousLatestServerMessageId = useRef(latestServerMessageId);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialMessages = chatWorkspace.history.messages.length
    ? chatWorkspace.history.messages
    : [
        {
          id: "chat-welcome",
          sender: "assistant" as const,
          content: greetingFor(role),
          status: "completed" as const,
        },
      ];
  const scriptedSource =
    chatWorkspace.source === "demo" && role.templateKey !== "lin_zhixia"
      ? [
          {
            id: `greeting-${roleKey}`,
            sender: "assistant" as const,
            content: greetingFor(role),
            status: "completed" as const,
          },
        ]
      : initialMessages;
  const scriptedMessages = scriptedSource.map((message, index) =>
    message.createdAt
      ? message
      : {
          ...message,
          createdAt: scriptedMessageTime(demoPlanWorkspace.anchorDate, index),
        },
  );
  const messages =
    chatWorkspace.source === "demo"
      ? [...scriptedMessages, ...demoMessages]
      : mergeMessages(olderMessages, initialMessages);
  if (messagesHydrated && seenMessageIds.current === null) {
    seenMessageIds.current = new Set(messages.map((message) => message.id));
  }
  const messageIsFresh = (id: string) =>
    messagesHydrated &&
    seenMessageIds.current !== null &&
    !seenMessageIds.current.has(id);

  useEffect(() => {
    if (chatWorkspace.source !== "demo") return;
    skipMessageWrite.current = true;
    setDemoMessages(readDemoSession().messagesByRole[roleKey] ?? []);
    setMessagesHydrated(true);
  }, [chatWorkspace.source, roleKey]);

  useEffect(() => {
    if (chatWorkspace.source !== "demo") return;
    if (skipMessageWrite.current) {
      skipMessageWrite.current = false;
      return;
    }
    updateDemoSession((current) => ({
      ...current,
      messagesByRole: {
        ...current.messagesByRole,
        [roleKey]: demoMessages
          .filter((message) => message.status !== "pending")
          .map((message) => ({
            id: message.id,
            sender: message.sender,
            content: message.content,
            status: message.status,
            ...(message.createdAt ? { createdAt: message.createdAt } : {}),
          })),
      },
    }));
  }, [chatWorkspace.source, demoMessages, roleKey]);

  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;

    if (restoreScrollHeight.current !== null) {
      const previousHeight = restoreScrollHeight.current;
      restoreScrollHeight.current = null;
      conversation.scrollTop += conversation.scrollHeight - previousHeight;
      return;
    }

    if (!initialScrollDone.current) {
      conversation.scrollTop = conversation.scrollHeight;
      initialScrollDone.current = true;
    }
  }, [olderMessages]);

  useLayoutEffect(() => {
    if (chatWorkspace.source !== "demo" || !nearBottom.current) return;
    const conversation = conversationRef.current;
    if (!conversation) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [chatWorkspace.source, demoMessages]);

  useEffect(() => {
    if (
      !latestServerMessageId ||
      latestServerMessageId === previousLatestServerMessageId.current
    ) {
      return undefined;
    }
    previousLatestServerMessageId.current = latestServerMessageId;

    const timer = window.setTimeout(() => {
      const conversation = conversationRef.current;
      if (!conversation) return;
      if (nearBottom.current) {
        conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
      } else {
        setHasUnseenMessages(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [latestServerMessageId]);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const canPersistFeedback = Boolean(
    chatWorkspace.source === "database" &&
    role.id &&
    feedbackTarget?.personaVersionId &&
    feedbackTarget.messageId,
  );
  const feedbackWasSubmitted = Boolean(
    feedbackActionState.submitted && feedbackActionState.idempotencyKey === feedbackId,
  );
  const feedbackStatusMessage = canPersistFeedback
    ? feedbackActionState.idempotencyKey === feedbackId
      ? feedbackActionState.message
      : ""
    : demoFeedbackSubmitted
      ? chatWorkspace.source === "demo"
      ? "已进入待复核。可以在「我的」里查看。"
        : "这条回复的反馈数据仍在准备中，请稍后再试。"
      : "";

  function openFeedback(
    message: ChatMessagePresentation,
    entryPoint: FeedbackTarget["entryPoint"],
  ) {
    clearLongPress();
    setFeedbackTarget({
      messageId: message.id,
      content: message.content,
      personaVersionId: message.personaVersionId,
      entryPoint,
    });
    setReason(feedbackReasons[0]);
    setFeedbackId(newClientMessageId());
    setDemoFeedbackSubmitted(false);
    setIsFeedbackOpen(true);
  }

  function startLongPress(message: ChatMessagePresentation) {
    clearLongPress();
    longPressTimer.current = setTimeout(() => openFeedback(message, "long_press"), 500);
  }

  async function appendDemoTurn(content: string) {
    if (demoReplyPending.current) return;
    demoReplyPending.current = true;
    const sentAt = new Date().toISOString();
    const userMessage: ChatMessagePresentation = {
      id: "demo-user-" + newClientMessageId(),
      sender: "user",
      content,
      status: "completed",
      createdAt: sentAt,
    };
    const pendingId = "demo-assistant-" + newClientMessageId();
    const history = [...messages, userMessage]
      .filter(
        (message) =>
          message.status === "completed" &&
          (message.sender === "user" || message.sender === "assistant"),
      )
      .slice(-12)
      .map((message) => ({ sender: message.sender, content: message.content }));

    setDemoMessages((current) => [
      ...current,
      userMessage,
      { id: pendingId, sender: "assistant", content: "", status: "pending", createdAt: sentAt },
    ]);
    setDemoMessage("");

    try {
      const remembered = applyDemoMemories(demoMemoryManagementData, session)
        .memories.filter(
          (memory) => memory.scope === "user_shared" || memory.roleId === roleKey,
        )
        .slice(-8)
        .map((memory) => ({
          id: memory.id,
          category: memory.category,
          content: memory.content,
        }));
      const result = await replyDemoChat({
        templateKey: role.templateKey ?? "lin_zhixia",
        roleName: role.name,
        personaGuide: role.templateKey
          ? undefined
          : session.customRoles.find((item) => item.id === role.id)?.guide,
        memories: remembered,
        messages: history,
      });
      setDemoMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? {
                ...message,
                content: "reply" in result ? result.reply : result.error,
                status: "reply" in result ? "completed" : "failed",
              }
            : message,
        ),
      );
      if ("error" in result) setDemoMessage(result.error);
      else {
        const planDraft =
          result.planClassification === "classified"
            ? result.plan
            : planDraftFromMessage(content, demoPlanWorkspace.anchorDate);
        const memoryDraft = memoryDraftFromMessage(content);
        if (planDraft || memoryDraft) {
          update((current) => ({
            ...current,
            pendingPlan: planDraft
              ? {
                  ...planDraft,
                  afterMessageId: pendingId,
                }
              : current.pendingPlan,
            pendingMemory: memoryDraft ?? current.pendingMemory,
            pendingMemoryAfterId: memoryDraft ? pendingId : current.pendingMemoryAfterId,
          }));
        }
      }
    } finally {
      demoReplyPending.current = false;
    }
  }

  function scrollToLatest() {
    const conversation = conversationRef.current;
    if (!conversation) return;
    nearBottom.current = true;
    setHasUnseenMessages(false);
    conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
  }

  function loadEarlierMessages() {
    if (
      historyPending ||
      !hasMore ||
      !nextCursor ||
      !role.id ||
      !chatWorkspace.conversationId
    ) {
      return;
    }

    const conversation = conversationRef.current;
    if (conversation) restoreScrollHeight.current = conversation.scrollHeight;
    const formData = new FormData();
    formData.set("roleId", role.id);
    formData.set("conversationId", chatWorkspace.conversationId);
    formData.set("cursor", nextCursor);

    startHistoryTransition(async () => {
      const result = await loadOlderChatMessages(formData);
      if (result.status !== "success") {
        restoreScrollHeight.current = null;
        setHistoryError(result.message);
        return;
      }
      setHistoryError("");
      setOlderMessages((current) => mergeMessages(result.page.messages, current));
      setNextCursor(result.page.nextCursor);
      setHasMore(result.page.hasMore);
    });
  }

  const suggestionAfterId = messages.some((message) => message.id === "demo-assistant-plan")
    ? "demo-assistant-plan"
    : (scriptedMessages.at(-1)?.id ?? null);
  const thread = buildChatThread({
    messages,
    markers:
      chatWorkspace.source === "demo"
        ? [
            { id: "suggestion", afterMessageId: suggestionAfterId },
            ...(session.pendingPlan
              ? [
                  {
                    id: "pending-plan",
                    afterMessageId: session.pendingPlan.afterMessageId ?? null,
                  },
                ]
              : []),
            ...(session.pendingMemory
              ? [
                  {
                    id: "pending-memory",
                    afterMessageId: session.pendingMemoryAfterId,
                  },
                ]
              : []),
          ]
        : visiblePlanProposals.map((proposal) => ({
            id: `proposal:${proposal.id}`,
            afterMessageId: proposal.sourceMessageId,
          })),
  });

  const shownToday =
    chatWorkspace.source === "demo"
      ? buildChatTodayOverview(applyDemoPlanSession(demoPlanWorkspace, session))
      : todayOverview;

  return (
    <AppShell current="chat" roles={demoRoles} viewer={{
      ...roleWorkspace.viewer,
      displayName:
        chatWorkspace.source === "demo" ? session.displayName : roleWorkspace.viewer.displayName,
      initial:
        chatWorkspace.source === "demo"
          ? session.displayName.slice(0, 1) || roleWorkspace.viewer.initial
          : roleWorkspace.viewer.initial,
    }}>
      <section className="chat-page" aria-labelledby="chat-role-name">
        <header className="chat-header">
          <Link className="current-role" href="/roles" aria-label="切换或修改角色">
            <span className="role-avatar" aria-hidden="true">
              {role.initial}
            </span>
            <span>
              <h1 className="role-name" id="chat-role-name">
                {role.name} ⌄
              </h1>
              <p className="role-meta">
                {role.label} ·{" "}
                {chatWorkspace.source === "unavailable"
                  ? "服务不可用"
                  : chatWorkspace.source === "demo"
                    ? "MiniMax 演示"
                    : chatWorkspace.runtimeMode === "minimax-development"
                      ? "MiniMax-M3 开发模式"
                      : chatWorkspace.runtimeMode === "mock"
                        ? "本地 Mock"
                        : "运行模式不可用"}
              </p>
            </span>
          </Link>
        </header>

        <div className="chat-workspace">
          <div
            ref={conversationRef}
            className="conversation"
            aria-live="polite"
            onScroll={(event) => {
              const element = event.currentTarget;
              nearBottom.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 120;
              if (nearBottom.current) setHasUnseenMessages(false);
            }}
          >
            {chatWorkspace.source === "database" &&
            chatWorkspace.runtimeMode === "minimax-development" ? (
              <p className="chat-runtime-note">
                MiniMax-M3 开发模式：仅用于本地测试，尚未获得生产合规批准。
              </p>
            ) : chatWorkspace.source === "database" &&
              chatWorkspace.runtimeMode === "mock" ? (
              <p className="chat-runtime-note">
                本地 Mock 对话：消息会保存，但回复不是由真实模型生成。
              </p>
            ) : chatWorkspace.source === "demo" ? (
              <p className="chat-runtime-note">
                免登录演示：回复由 MiniMax-M3 按你的话生成，对话会留在这台浏览器里。
              </p>
            ) : null}
            {hasMore ? (
              <button
                className="chat-history-button"
                disabled={historyPending}
                type="button"
                onClick={loadEarlierMessages}
              >
                {historyPending ? "正在加载更早消息…" : "加载更早消息"}
              </button>
            ) : chatWorkspace.source === "database" && olderMessages.length > 0 ? (
              <p className="chat-history-end">已经到达这段时间线的起点</p>
            ) : null}
            {historyError ? (
              <p className="chat-history-error" role="alert">
                {historyError}
              </p>
            ) : null}
            {chatWorkspace.source === "demo"
              ? applyDemoMemories(demoMemoryManagementData, session)
                  .memories.filter(
                    (memory) =>
                      memory.scope === "user_shared" || memory.roleId === roleKey,
                  )
                  .slice(-2)
                  .map((memory) => (
                    <p className="memory-hint" key={memory.id}>
                      记得：{memory.content}
                    </p>
                  ))
              : null}
            {chatWorkspace.source === "unavailable" ? (
              <p className="chat-data-message" role="alert">
                聊天数据仍在准备中，请稍后刷新页面。
              </p>
            ) : null}
            {thread.map((entry) => {
              if (entry.kind === "time") {
                return (
                  <p
                    className={
                      "chat-time" +
                      (messageIsFresh(entry.id.slice("time-".length)) ? " is-fresh" : "")
                    }
                    key={entry.id}
                  >
                    {entry.label}
                  </p>
                );
              }
              if (entry.kind === "marker") {
                if (entry.id === "suggestion" && !session.suggestionAccepted) {
                  return (
                    <article className="plan-suggestion" key={entry.id}>
                      <p className="caption">计划建议</p>
                      <p>
                        <strong>今天 19:30 · 整理作品集首页</strong>
                      </p>
                      <button
                        className="plan-action"
                        type="button"
                        onClick={() =>
                          update((current) => ({
                            ...current,
                            suggestionAccepted: true,
                            deletedPlanIds: current.deletedPlanIds.filter(
                              (id) => id !== "demo-day-portfolio-home",
                            ),
                          }))
                        }
                      >
                        添加到日计划 →
                      </button>
                    </article>
                  );
                }
                if (entry.id === "suggestion") {
                  return (
                    <article className="plan-suggestion" key={entry.id}>
                      <p className="caption">计划建议</p>
                      <p>
                        <strong>已放进今天 19:30 · 整理作品集首页</strong>
                      </p>
                      <Link className="plan-action" href="/plan">
                        去日计划查看 →
                      </Link>
                    </article>
                  );
                }
                if (entry.id === "pending-plan" && session.pendingPlan) {
                  return (
                    <article className="plan-suggestion" key={entry.id}>
                      <p className="caption">
                        {session.pendingPlan.flowAction === "ask_to_create"
                          ? "要不要记下来"
                          : "从这句话里听到的安排"}
                      </p>
                      <p>
                        <strong>{pendingPlanLabel(session.pendingPlan)}</strong>
                      </p>
                      <button
                        className="plan-action"
                        type="button"
                        onClick={() => {
                          const draft = session.pendingPlan;
                          if (!draft) return;
                          update((current) => ({
                            ...current,
                            pendingPlan: null,
                            extraPlans: [...current.extraPlans, demoConfirmedPlan(draft)],
                          }));
                        }}
                      >
                        {pendingPlanAction(session.pendingPlan)}
                      </button>
                    </article>
                  );
                }
                if (entry.id === "pending-memory" && session.pendingMemory) {
                  return (
                    <article className="plan-suggestion" key={entry.id}>
                      <p className="caption">可以记住</p>
                      <p>
                        <strong>{session.pendingMemory}</strong>
                      </p>
                      <button
                        className="plan-action"
                        type="button"
                        onClick={() => {
                          const content = session.pendingMemory;
                          if (!content) return;
                          update((current) => ({
                            ...current,
                            pendingMemory: null,
                            pendingMemoryAfterId: null,
                            extraMemories: [
                              ...current.extraMemories,
                              {
                                id: `demo-memory-${crypto.randomUUID()}`,
                                content,
                                category: "agreement",
                                scope: "user_shared",
                                roleId: null,
                              },
                            ],
                          }));
                        }}
                      >
                        保存为记忆 →
                      </button>
                    </article>
                  );
                }
                if (entry.id.startsWith("proposal:")) {
                  const proposal = visiblePlanProposals.find(
                    (item) => entry.id === `proposal:${item.id}`,
                  );
                  return proposal ? (
                    <PlanProposalCard
                      key={proposal.id}
                      parentOptions={planParentOptions}
                      proposal={proposal}
                    />
                  ) : null;
                }
                return null;
              }

              const message = entry.message;
              const index = messages.findIndex((item) => item.id === message.id);
              if (message.sender === "user") {
                const statusLabel = messageStatusLabel(
                  message,
                  chatWorkspace.source === "demo"
                    ? "minimax-development"
                    : chatWorkspace.runtimeMode,
                );
                return (
                  <div
                    className={
                      "message-row user" + (messageIsFresh(message.id) ? " is-fresh" : "")
                    }
                    data-status={message.status}
                    key={message.id}
                  >
                    <p className="message-bubble message-bubble--user">
                      {message.content}
                      {statusLabel ? (
                        <small className="message-status">{statusLabel}</small>
                      ) : null}
                    </p>
                  </div>
                );
              }

              const statusLabel = messageStatusLabel(
                message,
                chatWorkspace.source === "demo"
                  ? "minimax-development"
                  : chatWorkspace.runtimeMode,
              );
              return (
                <div
                  className={
                    "message-row" + (messageIsFresh(message.id) ? " is-fresh" : "")
                  }
                  data-status={message.status}
                  key={message.id}
                >
                  <span className="mini-avatar" aria-hidden="true">
                    {role.initial}
                  </span>
                  <div className="message-content-column">
                    {message.status === "completed" ? (
                      <button
                        className={
                          "message-bubble message-bubble--reply message-bubble--feedback-target" +
                          (index === 0 ? " message-bubble--greeting" : "")
                        }
                        type="button"
                        aria-label="长按反馈这条消息不符合人设"
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openFeedback(message, "context_menu");
                        }}
                        onPointerCancel={clearLongPress}
                        onPointerDown={() => startLongPress(message)}
                        onPointerUp={clearLongPress}
                      >
                        {message.content}
                      </button>
                    ) : (
                      <p className="message-bubble message-bubble--reply">
                        {message.status === "pending" && !message.content ? (
                          <span className="typing-dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          message.content
                        )}
                        {statusLabel ? (
                          <small className="message-status">{statusLabel}</small>
                        ) : null}
                      </p>
                    )}
                    {message.status === "failed" &&
                    message.replyToMessageId &&
                    chatWorkspace.source === "database" &&
                    chatWorkspace.runtimeMode === "minimax-development" ? (
                      <RetryFailedReply userMessageId={message.replyToMessageId} />
                    ) : null}
                  </div>
                </div>
              );
            })}
            {chatWorkspace.scheduledFollowupNotice ? (
              <p className="memory-hint">{chatWorkspace.scheduledFollowupNotice}</p>
            ) : null}
            {chatWorkspace.memoryCandidates.map((candidate) => (
              <MemoryCandidateCard candidate={candidate} key={candidate.id} />
            ))}
            {hasUnseenMessages ? (
              <button
                className="chat-new-message"
                type="button"
                onClick={scrollToLatest}
              >
                有新消息 · 回到底部
              </button>
            ) : null}
          </div>

          <aside className="chat-today-card" aria-label="今日计划概览">
            <header>
              <h2>今天</h2>
              <p>{shownToday.dateLabel}</p>
            </header>
            <div className="chat-today-progress">
              <strong>
                {shownToday.completedCount} / {shownToday.totalCount}
              </strong>
              <span>今日计划已完成</span>
            </div>
            <p className="chat-today-label">接下来</p>
            {shownToday.nextPlans.length ? (
              <ol className="chat-next-list">
                {shownToday.nextPlans.map((plan) => (
                  <li key={plan.id}>
                    <time>{plan.timeLabel}</time>
                    <span>{plan.title}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="chat-next-empty">今天还没有待办，留一点空白也很好。</p>
            )}
            <div className="chat-today-reminder">
              <strong>{role.name}</strong>
              <p>
                {shownToday.totalCount
                  ? "你为自己留出的时间，已经是很好的开始。"
                  : "今天可以先从照顾自己开始。"}
              </p>
            </div>
          </aside>

          <div className="chat-composer-area">
            <MessageComposer
              chatWorkspace={chatWorkspace}
              onDemoTurn={appendDemoTurn}
              role={role}
            />
            {demoMessage ? (
              <p className="chat-preview-message" role="status">
                {demoMessage}
              </p>
            ) : null}
          </div>
        </div>

        {isFeedbackOpen && feedbackTarget ? (
          <div className="ooc-overlay" role="presentation">
            <form
              className="ooc-dialog"
              aria-labelledby="ooc-title"
              aria-modal="true"
              role="dialog"
              onSubmit={(event) => {
                event.preventDefault();

                if (!canPersistFeedback) {
                  if (chatWorkspace.source === "demo" && feedbackTarget) {
                    const note = new FormData(event.currentTarget).get("additionalText");
                    update((current) => ({
                      ...current,
                      feedbackQueue: [
                        ...current.feedbackQueue,
                        {
                          id: feedbackId,
                          messageId: feedbackTarget.messageId,
                          roleName: role.name,
                          excerpt: feedbackTarget.content.slice(0, 80),
                          reason: reason.label,
                          note: typeof note === "string" ? note.trim().slice(0, 200) : "",
                          createdAt: new Date().toISOString(),
                          status: "pending_review" as const,
                        },
                      ].slice(-20),
                    }));
                  }
                  setDemoFeedbackSubmitted(true);
                  return;
                }

                const feedbackFormData = new FormData(event.currentTarget);
                startTransition(() => feedbackAction(feedbackFormData));
              }}
            >
              <input name="messageId" type="hidden" value={feedbackTarget.messageId} />
              <input name="roleId" type="hidden" value={role.id ?? ""} />
              <input
                name="personaVersionId"
                type="hidden"
                value={feedbackTarget.personaVersionId ?? ""}
              />
              <input name="categories" type="hidden" value={reason.category} />
              <input
                name="entryPoint"
                type="hidden"
                value={feedbackTarget.entryPoint}
              />
              <input name="idempotencyKey" type="hidden" value={feedbackId} />
              <header>
                <span>人设反馈</span>
                <button
                  type="button"
                  aria-label="关闭反馈"
                  onClick={() => setIsFeedbackOpen(false)}
                >
                  ×
                </button>
              </header>
              <h2 id="ooc-title">这句话哪里不符合人设？</h2>
              <p>你的反馈会帮助我更懂得这段关系，也更贴近设定。</p>
              <blockquote>
                <small>{role.name}</small>“{feedbackTarget.content}”
              </blockquote>
              <fieldset>
                <legend>选择原因</legend>
                <div className="ooc-reason-list">
                  {feedbackReasons.map((item) => (
                    <button
                      className="ooc-reason"
                      data-active={reason.category === item.category || undefined}
                      key={item.category}
                      type="button"
                      onClick={() => setReason(item)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="sr-only" htmlFor="ooc-note">
                补充说明
              </label>
              <textarea
                id="ooc-note"
                name="additionalText"
                placeholder="补充说明（可选）"
              />
              <small className="ooc-note">
                不会影响你与角色的当前聊天；我们会用它调整后续回应。
              </small>
              {feedbackStatusMessage ? (
                <p className="chat-action-message" role="status">
                  {feedbackStatusMessage}
                </p>
              ) : null}
              <footer>
                <button type="button" onClick={() => setIsFeedbackOpen(false)}>
                  取消
                </button>
                <button
                  disabled={feedbackPending || feedbackWasSubmitted}
                  type="submit"
                >
                  {feedbackPending
                    ? "提交中…"
                    : feedbackWasSubmitted
                      ? "已提交"
                      : "提交反馈"}
                </button>
              </footer>
            </form>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
