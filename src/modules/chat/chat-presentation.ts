export interface ChatMessagePresentation {
  id: string;
  sender: "user" | "assistant";
  content: string;
  status: "pending" | "completed" | "failed";
  /** Present only for persisted assistant messages that can receive OOC feedback. */
  personaVersionId?: string | null;
  /** Present for persisted assistant replies so a failed turn can be retried. */
  replyToMessageId?: string | null;
  createdAt?: string | null;
}

export interface ChatHistoryPage {
  messages: ChatMessagePresentation[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type ChatHistoryActionResult =
  | { status: "success"; page: ChatHistoryPage }
  | { status: "unavailable"; message: string };

export interface ChatWorkspaceData {
  source: "demo" | "database" | "unavailable";
  runtimeMode: "mock" | "minimax-development" | "unavailable";
  conversationId: string | null;
  history: ChatHistoryPage;
  memoryCandidates: PendingMemoryCandidatePresentation[];
  planProposals: PendingPlanProposalPresentation[];
  /** Set only when this role already has a real scheduled next-day follow-up. */
  scheduledFollowupNotice?: string | null;
}

export interface ChatTodayPlanPresentation {
  id: string;
  title: string;
  timeLabel: string;
}

export interface ChatTodayOverview {
  dateLabel: string;
  completedCount: number;
  totalCount: number;
  nextPlans: ChatTodayPlanPresentation[];
}
export const demoChatWorkspace: ChatWorkspaceData = {
  source: "demo",
  runtimeMode: "mock",
  conversationId: null,
  history: {
    nextCursor: null,
    hasMore: false,
    messages: [
      {
        id: "demo-greeting",
        sender: "assistant",
        content: "早上好。今天醒来时，心里最先冒出来的感觉是什么？",
        status: "completed",
      },
      {
        id: "demo-user-feeling",
        sender: "user",
        content: "有点乱，作品集和工作都堆在一起。",
        status: "completed",
      },
      {
        id: "demo-assistant-plan",
        sender: "assistant",
        content:
          "先不急着把全部解决。我们把“整理作品集首页”放进今天 19:30，给它 30 分钟，好吗？",
        status: "completed",
      },
    ],
  },
  memoryCandidates: [],
  planProposals: [],
};
import type { PendingMemoryCandidatePresentation } from "@/modules/profile/memory-presentation";
import type { PendingPlanProposalPresentation } from "@/modules/plan/plan-presentation";
