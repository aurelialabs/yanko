import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatWorkspaceData } from "./chat-presentation";
import type { RoleWorkspaceData } from "../roles/role-presentation";

const sendChatMessage = vi.hoisted(() => vi.fn());
const retryFailedChatMessage = vi.hoisted(() => vi.fn());
const submitPersonaFeedback = vi.hoisted(() => vi.fn());
const loadOlderChatMessages = vi.hoisted(() => vi.fn());
const confirmMemoryCandidate = vi.hoisted(() => vi.fn());
const rejectMemoryCandidate = vi.hoisted(() => vi.fn());
const confirmPlanProposalFromChat = vi.hoisted(() => vi.fn());
const rejectPlanProposalFromChat = vi.hoisted(() => vi.fn());

vi.mock("@/app/chat/actions", () => ({
  loadOlderChatMessages,
  retryFailedChatMessage,
  sendChatMessage,
  submitPersonaFeedback,
}));
vi.mock("@/app/me/actions", () => ({
  confirmMemoryCandidate,
  rejectMemoryCandidate,
}));
vi.mock("@/app/plan/actions", () => ({
  confirmPlanProposalFromChat,
  rejectPlanProposalFromChat,
}));

import { ChatWorkspace } from "./chat-workspace";

const roleId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

const chatWorkspace: ChatWorkspaceData = {
  source: "database",
  runtimeMode: "mock",
  conversationId,
  history: {
    nextCursor: null,
    hasMore: false,
    messages: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        sender: "assistant",
        content: "你好，我在。",
        status: "completed",
        personaVersionId: "44444444-4444-4444-8444-444444444444",
      },
    ],
  },
  memoryCandidates: [],
  planProposals: [],
};

const todayOverview = {
  dateLabel: "9月2日 · 周三",
  completedCount: 1,
  totalCount: 2,
  nextPlans: [
    {
      id: "plan-1",
      title: "整理作品集",
      timeLabel: "09:30",
    },
  ],
};
const roleWorkspace: RoleWorkspaceData = {
  source: "database",
  roles: [
    {
      id: roleId,
      templateKey: "lin_zhixia",
      name: "林知夏",
      label: "温柔倾听者",
      description: "先接住你的感受，再一起理清方向。",
      direction: "情感和人际关系",
      quote: "我会先听懂你的感受，再陪你把事情一点点理清。",
      initial: "夏",
      tone: "periwinkle",
      stats: { chatCount: "1 条", memoryCount: "—", companionDays: "1 天" },
    },
  ],
  currentRole: {
    id: roleId,
    templateKey: "lin_zhixia",
    name: "林知夏",
    label: "温柔倾听者",
    description: "先接住你的感受，再一起理清方向。",
    direction: "情感和人际关系",
    quote: "我会先听懂你的感受，再陪你把事情一点点理清。",
    initial: "夏",
    tone: "periwinkle",
    stats: { chatCount: "1 条", memoryCount: "—", companionDays: "1 天" },
  },
  viewer: { displayName: "小屿", initial: "屿", companionDays: "1 天" },
};

describe("ChatWorkspace", () => {
  beforeEach(() => {
    sendChatMessage.mockReset();
    retryFailedChatMessage.mockReset();
    submitPersonaFeedback.mockReset();
    loadOlderChatMessages.mockReset();
    confirmMemoryCandidate.mockReset();
    rejectMemoryCandidate.mockReset();
    confirmPlanProposalFromChat.mockReset();
    rejectPlanProposalFromChat.mockReset();
  });

  it("keeps one continuous timeline without a new-chat entry", () => {
    render(
      <ChatWorkspace
        chatWorkspace={chatWorkspace}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    expect(screen.queryByRole("button", { name: /新对话/ })).not.toBeInTheDocument();
    expect(screen.getByText(/本地 Mock 对话/)).toBeInTheDocument();
  });

  it("labels the development model and understandable pending and failed states", () => {
    render(
      <ChatWorkspace
        chatWorkspace={{
          ...chatWorkspace,
          runtimeMode: "minimax-development",
          history: {
            nextCursor: null,
            hasMore: false,
            messages: [
              {
                id: "70000000-0000-4000-8000-000000000007",
                sender: "assistant",
                content: "回复生成中…",
                status: "pending",
                personaVersionId: "44444444-4444-4444-8444-444444444444",
              },
              {
                id: "80000000-0000-4000-8000-000000000008",
                sender: "assistant",
                content: "回复暂时不可用，可使用原消息重试。",
                status: "failed",
                personaVersionId: "44444444-4444-4444-8444-444444444444",
                replyToMessageId: "90000000-0000-4000-8000-000000000009",
              },
            ],
          },
        }}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    expect(screen.getByText(/MiniMax-M3 开发模式：仅用于本地测试/)).toBeInTheDocument();
    expect(screen.getByText("MiniMax-M3 回复生成中…")).toBeInTheDocument();
    expect(
      screen.getByText("回复暂时不可用，可使用原消息重试", {
        selector: "small",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试回复" })).toBeInTheDocument();
  });

  it("retries a failed reply with its original user message reference", async () => {
    retryFailedChatMessage.mockResolvedValue({
      message: "",
      clientMessageId: "retry-key",
      sentMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    render(
      <ChatWorkspace
        chatWorkspace={{
          ...chatWorkspace,
          runtimeMode: "minimax-development",
          history: {
            nextCursor: null,
            hasMore: false,
            messages: [
              {
                id: "80000000-0000-4000-8000-000000000008",
                sender: "assistant",
                content: "回复暂时不可用，可使用原消息重试。",
                status: "failed",
                replyToMessageId: "90000000-0000-4000-8000-000000000009",
              },
            ],
          },
        }}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试回复" }));
    await waitFor(() => expect(retryFailedChatMessage).toHaveBeenCalledTimes(1));
    const payload = retryFailedChatMessage.mock.calls[0][1] as FormData;
    expect(payload.get("userMessageId")).toBe("90000000-0000-4000-8000-000000000009");
    expect(payload.get("idempotencyKey")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("persists consecutive messages with different idempotency keys", async () => {
    sendChatMessage.mockImplementation(
      async (_previousState: unknown, formData: FormData) => {
        const clientMessageId = formData.get("clientMessageId");
        return {
          message: "",
          clientMessageId: typeof clientMessageId === "string" ? clientMessageId : "",
          sentMessageId: "55555555-5555-4555-8555-555555555555",
        };
      },
    );
    render(
      <ChatWorkspace
        chatWorkspace={chatWorkspace}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    const composer = screen.getByLabelText("输入消息");
    fireEvent.change(composer, { target: { value: "第一条消息" } });
    fireEvent.submit(composer.closest("form") as HTMLFormElement);

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const firstPayload = sendChatMessage.mock.calls[0][1] as FormData;
    expect(firstPayload.get("roleId")).toBe(roleId);
    expect(firstPayload.get("conversationId")).toBe(conversationId);
    expect(firstPayload.get("content")).toBe("第一条消息");

    await waitFor(() => expect(composer).toHaveValue(""));

    fireEvent.change(composer, { target: { value: "第二条消息" } });
    fireEvent.submit(composer.closest("form") as HTMLFormElement);

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    const secondPayload = sendChatMessage.mock.calls[1][1] as FormData;
    expect(secondPayload.get("content")).toBe("第二条消息");
    expect(secondPayload.get("clientMessageId")).not.toBe(
      firstPayload.get("clientMessageId"),
    );
  });

  it("keeps the draft available when a send fails", async () => {
    sendChatMessage.mockResolvedValue({
      message: "暂时无法发送消息，请稍后再试。",
      clientMessageId: "not-used-by-success-effect",
    });
    render(
      <ChatWorkspace
        chatWorkspace={chatWorkspace}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    const composer = screen.getByLabelText("输入消息");
    fireEvent.change(composer, { target: { value: "不要丢掉这句话" } });
    fireEvent.submit(composer.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("暂时无法发送消息"),
    );
    expect(composer).toHaveValue("不要丢掉这句话");
  });

  it("loads an older page through the stable cursor without duplicating messages", async () => {
    loadOlderChatMessages.mockResolvedValue({
      status: "success",
      page: {
        messages: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            sender: "user",
            content: "更早的一条消息",
            status: "completed",
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    });
    render(
      <ChatWorkspace
        chatWorkspace={{
          ...chatWorkspace,
          history: {
            ...chatWorkspace.history,
            nextCursor: "opaque-created-at-and-id-cursor",
            hasMore: true,
          },
        }}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
    expect(await screen.findByText("更早的一条消息")).toBeInTheDocument();
    expect(screen.getAllByText("你好，我在。")).toHaveLength(1);
    expect(screen.getByText("已经到达这段时间线的起点")).toBeInTheDocument();

    const payload = loadOlderChatMessages.mock.calls[0][0] as FormData;
    expect(payload.get("roleId")).toBe(roleId);
    expect(payload.get("conversationId")).toBe(conversationId);
    expect(payload.get("cursor")).toBe("opaque-created-at-and-id-cursor");
  });

  it("shows only current-role pending memory candidates in the chat timeline", () => {
    render(
      <ChatWorkspace
        chatWorkspace={{
          ...chatWorkspace,
          memoryCandidates: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              content: "用户难过时希望先被倾听。",
              category: "agreement",
              suggestedScope: "role_private",
              roleId,
              roleName: "林知夏",
              sensitivity: "normal",
              expiresAt: "2026-10-01T00:00:00.000Z",
            },
          ],
        }}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    expect(screen.getByText("想记住这件事")).toBeInTheDocument();
    expect(screen.getByDisplayValue("用户难过时希望先被倾听。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "不保存" })).toBeInTheDocument();
  });

  it("shows an editable current-role plan proposal and confirms final fields", async () => {
    confirmPlanProposalFromChat.mockResolvedValue({
      message: "",
      createdPlanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    render(
      <ChatWorkspace
        chatWorkspace={{
          ...chatWorkspace,
          planProposals: [
            {
              id: "99999999-9999-4999-8999-999999999998",
              sourceMessageId: "99999999-9999-4999-8999-999999999997",
              scope: "day",
              suggestedTitle: "整理作品集首页",
              originalTimeText: "今天晚上七点半",
              missingFields: [],
              expiresAt: "2026-09-14T00:00:00.000Z",
              date: "2026-09-07",
              scheduledTime: "19:30",
              reminderTime: "19:00",
              weekStart: "",
              month: "",
              year: "",
              dueDate: "",
              parentPlanId: "",
            },
          ],
        }}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    expect(screen.getByText("计划建议")).toBeInTheDocument();
    expect(screen.getByText(/今天晚上七点半/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("计划名称"), {
      target: { value: "整理作品集首屏" },
    });
    const confirmButton = screen.getByRole("button", {
      name: "确认并加入计划",
    });
    fireEvent.submit(confirmButton.closest("form") as HTMLFormElement);

    await waitFor(() => expect(confirmPlanProposalFromChat).toHaveBeenCalledTimes(1));
    const payload = confirmPlanProposalFromChat.mock.calls[0][1] as FormData;
    expect(payload.get("title")).toBe("整理作品集首屏");
    expect(payload.get("dayDate")).toBe("2026-09-07");
    expect(payload.get("scheduledTime")).toBe("19:30");
    expect(payload.get("reminderTime")).toBe("19:00");
    expect(await screen.findByText("计划已创建")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看计划 →" })).toHaveAttribute(
      "href",
      "/plan/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("rejects a proposal without creating a formal plan", async () => {
    rejectPlanProposalFromChat.mockResolvedValue({
      message: "",
      rejectedProposalId: "99999999-9999-4999-8999-999999999998",
    });
    render(
      <ChatWorkspace
        chatWorkspace={{
          ...chatWorkspace,
          planProposals: [
            {
              id: "99999999-9999-4999-8999-999999999998",
              sourceMessageId: "99999999-9999-4999-8999-999999999997",
              scope: "week",
              suggestedTitle: "整理本周材料",
              originalTimeText: null,
              missingFields: [],
              expiresAt: "2026-09-14T00:00:00.000Z",
              date: "",
              scheduledTime: "",
              reminderTime: "",
              weekStart: "2026-09-07",
              month: "",
              year: "",
              dueDate: "2026-09-12",
              parentPlanId: "",
            },
          ],
        }}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    const rejectButton = screen.getByRole("button", { name: "暂不创建" });
    fireEvent.submit(rejectButton.closest("form") as HTMLFormElement);

    await waitFor(() => expect(rejectPlanProposalFromChat).toHaveBeenCalledTimes(1));
    expect(confirmPlanProposalFromChat).not.toHaveBeenCalled();
    expect(
      await screen.findByText("这份计划建议不会生成正式计划。"),
    ).toBeInTheDocument();
  });

  it("shows a next-day follow-up only when one is already scheduled", () => {
    render(
      <ChatWorkspace
        chatWorkspace={{
          ...chatWorkspace,
          scheduledFollowupNotice: "如果你没有先继续说，明天会再关心你一次。",
        }}
        planParentOptions={[]}
        roleWorkspace={roleWorkspace}
        todayOverview={todayOverview}
      />,
    );

    expect(
      screen.getByText("如果你没有先继续说，明天会再关心你一次。"),
    ).toBeInTheDocument();
  });
});
