import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getChatWorkspace } from "@/modules/chat/chat-data";
import { buildChatTodayOverview } from "@/modules/chat/chat-today-overview";
import { getPlanWorkspace } from "@/modules/plan/plan-data";
import { getRoleWorkspace } from "@/modules/roles/role-data";
import { ChatWorkspace } from "@/modules/chat/chat-workspace";

export const metadata: Metadata = { title: "聊天" };

export default async function ChatPage() {
  const user = await requireAuthenticatedUser("/chat");
  const roleWorkspace = await getRoleWorkspace(user);
  const [chatWorkspace, planWorkspace] = await Promise.all([
    getChatWorkspace(user, roleWorkspace.currentRole.id),
    getPlanWorkspace(user),
  ]);
  const planParentOptions =
    planWorkspace.source === "database"
      ? planWorkspace.plans
          .filter(
            (plan) =>
              plan.scope === "year" &&
              plan.parentPlanId === null &&
              plan.status === "active",
          )
          .map((plan) => ({ id: plan.id, title: plan.title }))
      : [];

  return (
    <ChatWorkspace
      key={roleWorkspace.currentRole.id ?? "chat-demo"}
      chatWorkspace={chatWorkspace}
      roleWorkspace={roleWorkspace}
      todayOverview={buildChatTodayOverview(planWorkspace)}
      planParentOptions={planParentOptions}
    />
  );
}
