import { createAnthropicCompatibleEvaluationAdapter } from "./anthropic-compatible.mjs";

const ADAPTER_ID = "minimax-ai-candidate-3";
const PROVIDER_ID = "minimax";
const ENV_PREFIX = "MINIMAX_AI";

export const MINIMAX_ADAPTER_ID = ADAPTER_ID;

export function createMiniMaxAdapter(options = {}) {
  return createAnthropicCompatibleEvaluationAdapter({
    ...options,
    adapterId: ADAPTER_ID,
    providerId: PROVIDER_ID,
    envPrefix: ENV_PREFIX,
  });
}
