import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter } from "./model-adapter";
import {
  processCompletedUserMessageUnderstanding,
  readMessageUnderstandingSwitches,
} from "./post-message-understanding";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  memory: "00000000-0000-4000-8000-000000000011",
  plan: "00000000-0000-4000-8000-000000000012",
  emotion: "00000000-0000-4000-8000-000000000013",
  message: "00000000-0000-4000-8000-000000000014",
};

const adapter = { descriptor: { id: "test" } } as ModelAdapter;

describe("post-message understanding", () => {
  it("stays off for the default Mock chat runtime", () => {
    expect(readMessageUnderstandingSwitches({})).toEqual({
      memory: false,
      plan: false,
      emotion: false,
    });
  });

  it("turns on memory, plan, and emotion together for MiniMax development chat", () => {
    expect(
      readMessageUnderstandingSwitches({ AI_CHAT_RUNTIME_MODE: "minimax-development" }),
    ).toEqual({
      memory: true,
      plan: true,
      emotion: true,
    });
  });

  it("can enable a single Mock worker without calling the model", async () => {
    const createAdapter = vi.fn();
    const result = await processCompletedUserMessageUnderstanding(
      { userId: ids.user, sourceMessageId: ids.message },
      {
        switches: { memory: false, plan: false, emotion: false },
        createAdapter,
      },
    );

    expect(result).toEqual({ status: "skipped", reason: "disabled" });
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("runs only the exact jobs for the completed message", async () => {
    const runMemory = vi.fn().mockResolvedValue({ type: "processed" });
    const runPlan = vi.fn().mockResolvedValue({ type: "processed" });
    const runEmotion = vi.fn().mockRejectedValue(new Error("classifier down"));

    const result = await processCompletedUserMessageUnderstanding(
      { userId: ids.user, sourceMessageId: ids.message },
      {
        switches: { memory: true, plan: true, emotion: true },
        createAdapter: () => adapter,
        loadJobIds: async () => ({
          memoryJobId: ids.memory,
          planJobId: null,
          emotionJobId: ids.emotion,
        }),
        runMemory,
        runPlan,
        runEmotion,
      },
    );

    expect(result).toEqual({
      status: "processed",
      memory: "ran",
      plan: "skipped",
      emotion: "failed",
    });
    expect(runMemory).toHaveBeenCalledWith({
      adapter,
      enabled: true,
      jobId: ids.memory,
    });
    expect(runPlan).not.toHaveBeenCalled();
    expect(runEmotion).toHaveBeenCalledWith({
      adapter,
      enabled: true,
      jobId: ids.emotion,
    });
  });

  it("keeps the chat reply usable when the development model is not configured", async () => {
    const result = await processCompletedUserMessageUnderstanding(
      { userId: ids.user, sourceMessageId: ids.message },
      {
        switches: { memory: true, plan: false, emotion: false },
        createAdapter: () => {
          throw new Error("missing key");
        },
      },
    );

    expect(result).toEqual({ status: "skipped", reason: "adapter-unavailable" });
  });
});
