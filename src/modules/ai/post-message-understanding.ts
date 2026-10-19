import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import {
  isPlanExtractionWorkerEnabled,
  runConfiguredPlanExtractionWorker,
} from "@/modules/plan/plan-extraction-worker";
import { uuidSchema } from "@/server/schemas";

import {
  isEmotionSignalWorkerEnabled,
  runConfiguredEmotionSignalWorker,
} from "./emotion-signal-worker";
import {
  isMemoryExtractionWorkerEnabled,
  runConfiguredMemoryExtractionWorker,
} from "./memory-extraction-worker";
import type { ModelAdapter } from "./model-adapter";
import { createMiniMaxAdapter } from "./providers/minimax-adapter";
import { readMiniMaxConfig } from "./providers/minimax-config";
import { readAiChatRuntimeMode } from "./runtime-config";

export interface MessageUnderstandingSwitches {
  memory: boolean;
  plan: boolean;
  emotion: boolean;
}

/**
 * MiniMax development chat understands each completed user message inline.
 * Mock chat stays off unless a worker switch is explicitly enabled.
 */
export function readMessageUnderstandingSwitches(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): MessageUnderstandingSwitches {
  const liveChat = readAiChatRuntimeMode(environment) === "minimax-development";
  return {
    memory: liveChat || isMemoryExtractionWorkerEnabled(environment),
    plan: liveChat || isPlanExtractionWorkerEnabled(environment),
    emotion: liveChat || isEmotionSignalWorkerEnabled(environment),
  };
}

export interface CompletedMessageJobIds {
  memoryJobId: string | null;
  planJobId: string | null;
  emotionJobId: string | null;
}

function jobId(value: unknown): string | null {
  return typeof value === "string" && uuidSchema.safeParse(value).success
    ? value
    : null;
}

export async function loadCompletedMessageJobIds(input: {
  userId: string;
  sourceMessageId: string;
}): Promise<CompletedMessageJobIds | null> {
  if (
    !uuidSchema.safeParse(input.userId).success ||
    !uuidSchema.safeParse(input.sourceMessageId).success
  ) {
    return null;
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return null;

  const [memory, plan, emotion] = await Promise.all([
    supabase
      .from("memory_extraction_jobs")
      .select("id")
      .eq("user_id", input.userId)
      .eq("source_message_id", input.sourceMessageId)
      .maybeSingle(),
    supabase
      .from("plan_extraction_jobs")
      .select("id")
      .eq("user_id", input.userId)
      .eq("source_message_id", input.sourceMessageId)
      .maybeSingle(),
    supabase
      .from("emotion_signal_jobs")
      .select("id")
      .eq("user_id", input.userId)
      .eq("source_message_id", input.sourceMessageId)
      .maybeSingle(),
  ]);

  if (memory.error || plan.error || emotion.error) return null;

  return {
    memoryJobId: jobId(memory.data?.id),
    planJobId: jobId(plan.data?.id),
    emotionJobId: jobId(emotion.data?.id),
  };
}

export interface MessageUnderstandingDependencies {
  switches: MessageUnderstandingSwitches;
  createAdapter: () => ModelAdapter;
  loadJobIds: (input: {
    userId: string;
    sourceMessageId: string;
  }) => Promise<CompletedMessageJobIds | null>;
  runMemory: typeof runConfiguredMemoryExtractionWorker;
  runPlan: typeof runConfiguredPlanExtractionWorker;
  runEmotion: typeof runConfiguredEmotionSignalWorker;
}

export type MessageUnderstandingResult =
  | {
      status: "skipped";
      reason: "disabled" | "adapter-unavailable" | "jobs-unavailable";
    }
  | {
      status: "processed";
      memory: "ran" | "skipped" | "failed";
      plan: "ran" | "skipped" | "failed";
      emotion: "ran" | "skipped" | "failed";
    };

function defaultAdapter(): ModelAdapter {
  return createMiniMaxAdapter(readMiniMaxConfig());
}

/**
 * Runs the exact jobs created for one completed user message. A missing model,
 * database, or worker failure leaves the saved chat reply in place.
 */
export async function processCompletedUserMessageUnderstanding(
  input: {
    userId: string;
    sourceMessageId: string;
  },
  dependencies: Partial<MessageUnderstandingDependencies> = {},
): Promise<MessageUnderstandingResult> {
  const switches = dependencies.switches ?? readMessageUnderstandingSwitches();
  if (!switches.memory && !switches.plan && !switches.emotion) {
    return { status: "skipped", reason: "disabled" };
  }
  if (
    !uuidSchema.safeParse(input.userId).success ||
    !uuidSchema.safeParse(input.sourceMessageId).success
  ) {
    return { status: "skipped", reason: "jobs-unavailable" };
  }

  let adapter: ModelAdapter;
  try {
    adapter = (dependencies.createAdapter ?? defaultAdapter)();
  } catch {
    return { status: "skipped", reason: "adapter-unavailable" };
  }

  let jobs: CompletedMessageJobIds | null;
  try {
    jobs = await (dependencies.loadJobIds ?? loadCompletedMessageJobIds)(input);
  } catch {
    return { status: "skipped", reason: "jobs-unavailable" };
  }
  if (!jobs) return { status: "skipped", reason: "jobs-unavailable" };

  const runMemory = dependencies.runMemory ?? runConfiguredMemoryExtractionWorker;
  const runPlan = dependencies.runPlan ?? runConfiguredPlanExtractionWorker;
  const runEmotion = dependencies.runEmotion ?? runConfiguredEmotionSignalWorker;

  async function runOne(
    enabled: boolean,
    jobIdValue: string | null,
    run: (jobIdValue: string) => Promise<unknown>,
  ): Promise<"ran" | "skipped" | "failed"> {
    if (!enabled || !jobIdValue) return "skipped";
    try {
      await run(jobIdValue);
      return "ran";
    } catch {
      return "failed";
    }
  }

  const [memory, plan, emotion] = await Promise.all([
    runOne(switches.memory, jobs.memoryJobId, (currentJobId) =>
      runMemory({ adapter, enabled: true, jobId: currentJobId }),
    ),
    runOne(switches.plan, jobs.planJobId, (currentJobId) =>
      runPlan({ adapter, enabled: true, jobId: currentJobId }),
    ),
    runOne(switches.emotion, jobs.emotionJobId, (currentJobId) =>
      runEmotion({ adapter, enabled: true, jobId: currentJobId }),
    ),
  ]);

  return { status: "processed", memory, plan, emotion };
}
