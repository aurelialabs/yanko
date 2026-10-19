"use server";

import { generateDemoChatReply } from "@/modules/ai/demo-chat";
import { createMiniMaxAdapter } from "@/modules/ai/providers/minimax-adapter";
import { readMiniMaxConfig } from "@/modules/ai/providers/minimax-config";
import { demoPlanFromClassifier, type DemoPendingPlan } from "@/modules/demo/demo-session";
import { shanghaiCalendarDate } from "@/modules/plan/plan-presentation";
import { classifyPlanMessage } from "@/modules/plan/plan-extraction-runtime";

export async function replyDemoChat(input: {
  templateKey: string;
  personaGuide?: string;
  roleName?: string;
  memories?: { id: string; category: string; content: string }[];
  messages: { sender: "user" | "assistant"; content: string }[];
}): Promise<
  | {
      reply: string;
      plan: Omit<DemoPendingPlan, "afterMessageId"> | null;
      planClassification: "classified" | "unavailable";
    }
  | { error: string }
> {
  try {
    const adapter = createMiniMaxAdapter(readMiniMaxConfig());
    const latest = input.messages.at(-1);
    const [reply, policy] = await Promise.all([
      generateDemoChatReply(input, adapter),
      latest?.sender === "user"
        ? classifyPlanMessage(
            { roleName: input.roleName?.trim() || "林知夏", sourceMessage: latest.content },
            adapter,
          )
        : Promise.resolve(null),
    ]);
    if ("error" in reply) return reply;
    const plan =
      policy === null
        ? null
        : demoPlanFromClassifier({
            flowAction: policy.flowAction,
            scope: policy.draft?.scope ?? null,
            title: policy.draft?.title ?? null,
            parsedPayload: { ...(policy.draft?.parsedPayload ?? {}) },
            anchorDate: shanghaiCalendarDate(),
          });
    return {
      reply: reply.reply,
      plan,
      planClassification: policy === null ? "unavailable" : "classified",
    };
  } catch {
    return { error: "真实回复暂时不可用，请确认模型配置后再试。" };
  }
}
