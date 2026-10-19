import { createOpenAiCompatibleEvaluationAdapter } from "./openai-compatible.mjs";

const ADAPTER_ID = "taoke-tag-ai-candidate-1";
const PROVIDER_ID = "alibaba-cloud-dashscope";
const ENV_PREFIX = "TAOKE_TAG_AI";

export const TAOKE_TAG_QWEN_ADAPTER_ID = ADAPTER_ID;

export function createTaokeTagQwenAdapter(options = {}) {
  return createOpenAiCompatibleEvaluationAdapter({
    ...options,
    adapterId: ADAPTER_ID,
    providerId: PROVIDER_ID,
    envPrefix: ENV_PREFIX,
  });
}
