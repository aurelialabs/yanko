import "server-only";

export const AI_CHAT_RUNTIME_MODES = ["mock", "minimax-development"] as const;

export type AiChatRuntimeMode = (typeof AI_CHAT_RUNTIME_MODES)[number];

interface RuntimeEnvironment {
  [key: string]: string | undefined;
  AI_CHAT_RUNTIME_MODE?: string;
}

/**
 * Unknown values fail closed instead of silently enabling a provider. An
 * omitted value deliberately retains the existing local Mock behavior.
 */
export function readAiChatRuntimeMode(
  environment: RuntimeEnvironment = process.env,
): AiChatRuntimeMode | null {
  const value = environment.AI_CHAT_RUNTIME_MODE?.trim() || "mock";
  return (AI_CHAT_RUNTIME_MODES as readonly string[]).includes(value)
    ? (value as AiChatRuntimeMode)
    : null;
}
