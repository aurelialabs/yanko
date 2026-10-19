/**
 * Offline-only deterministic adapter used by the evaluation runner's smoke
 * tests. This module has no credentials and never contacts a model provider.
 */
export const deterministicMockAdapter = {
  descriptor: {
    id: "local-deterministic-mock",
    providerId: "local-mock",
    modelId: "deterministic-v0",
  },

  async evaluateCase(evalCase) {
    const capability =
      typeof evalCase.capability === "string"
        ? evalCase.capability
        : typeof evalCase.task === "string"
          ? evalCase.task
          : "unknown";

    return {
      output: {
        type: "deterministic-mock",
        capability,
        note: "本地模拟结果，仅用于验证横评管线。",
      },
      latencyMs: 0,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    };
  },
};
