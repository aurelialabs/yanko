import { createOpenAiCompatibleEvaluationAdapter } from "./openai-compatible.mjs";

const ADAPTER_ID = "deepseek-ai-candidate-2";
const PROVIDER_ID = "deepseek";
const ENV_PREFIX = "DEEPSEEK_AI";

export const DEEPSEEK_ADAPTER_ID = ADAPTER_ID;

export function createDeepSeekAdapter(options = {}) {
  return createOpenAiCompatibleEvaluationAdapter({
    ...options,
    adapterId: ADAPTER_ID,
    providerId: PROVIDER_ID,
    envPrefix: ENV_PREFIX,
  });
}
