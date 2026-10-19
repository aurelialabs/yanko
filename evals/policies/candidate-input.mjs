import {
  DETERMINISTIC_EVALUATION_PROMPT_VERSION,
  isStrictEvaluationPromptVersion,
} from "../prompts/yanxing-evaluation-prompts.mjs";

const HISTORY_QUERY_MARKERS = ["以前", "后来", "变化", "什么时候变", "过去"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asksForHistory(input) {
  const message = typeof input.userMessage === "string" ? input.userMessage : "";
  return HISTORY_QUERY_MARKERS.some((marker) => message.includes(marker));
}

function memorySelectionLimit(capability, input, includeSuperseded) {
  if (includeSuperseded) return 2;
  if (capability === "role_isolation") return 5;

  const message = typeof input.userMessage === "string" ? input.userMessage : "";
  if (/本地|城市|住在|住哪|哪里|哪儿|所在地/u.test(message)) return 1;
  return 3;
}

function isAllowedMemory(memory, currentPersonaKey, includeSuperseded) {
  if (!isObject(memory) || typeof memory.id !== "string") return false;
  if (memory.status === "deleted") return false;
  if (memory.status === "superseded" && !includeSuperseded) return false;
  if (memory.status !== "active" && memory.status !== "superseded") return false;

  if (memory.scope === "user_shared") {
    return memory.roleKey === null;
  }

  return (
    memory.scope === "role_private" &&
    typeof currentPersonaKey === "string" &&
    memory.roleKey === currentPersonaKey
  );
}

export function prepareCandidateEvaluationInput(promptVersion, capability, rawInput) {
  if (
    !isStrictEvaluationPromptVersion(promptVersion) ||
    (capability !== "role_isolation" && capability !== "memory_recall") ||
    !isObject(rawInput) ||
    !Array.isArray(rawInput.memories)
  ) {
    return rawInput;
  }

  const includeSuperseded = asksForHistory(rawInput);
  const currentPersonaKey = rawInput.currentPersonaKey;

  const preparedInput = {
    ...rawInput,
    memories: rawInput.memories.filter((memory) =>
      isAllowedMemory(memory, currentPersonaKey, includeSuperseded),
    ),
  };

  if (promptVersion !== DETERMINISTIC_EVALUATION_PROMPT_VERSION) {
    return preparedInput;
  }

  return {
    ...preparedInput,
    selectionLimit: memorySelectionLimit(capability, rawInput, includeSuperseded),
  };
}
