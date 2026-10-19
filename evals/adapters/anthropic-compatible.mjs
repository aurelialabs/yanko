import {
  CandidateAdapterError,
  normalizeCandidateFinishReason,
} from "./candidate-adapter-error.mjs";
import { prepareCandidateEvaluationInput } from "../policies/candidate-input.mjs";
import { applyCandidateOutputPolicy } from "../policies/candidate-output.mjs";
import {
  assertEvaluationPromptVersion,
  buildEvaluationSystemPrompt,
  DEFAULT_EVALUATION_PROMPT_VERSION,
  DETERMINISTIC_EVALUATION_PROMPT_VERSION,
} from "../prompts/yanxing-evaluation-prompts.mjs";
import { parseCandidateEvaluationOutput } from "../schemas/candidate-output.mjs";

const MAX_OUTPUT_TOKENS = 1200;

function environmentName(prefix, suffix) {
  return `${prefix}_${suffix}`;
}

function requiredValue(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new CandidateAdapterError(`${name} is required.`);
  }
  return value;
}

function parseEnabled(env, prefix) {
  const name = environmentName(prefix, "ENABLED");
  const value = requiredValue(env, name).toLowerCase();
  if (value !== "true" && value !== "false") {
    throw new CandidateAdapterError(`${name} must be true or false.`);
  }
  if (value !== "true") {
    throw new CandidateAdapterError(`${prefix} candidate is not enabled.`);
  }
}

function parseNumber(env, name, minimum, maximum) {
  const value = Number(requiredValue(env, name));
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CandidateAdapterError(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function parseMessagesEndpoint(env, prefix) {
  const name = environmentName(prefix, "BASE_URL");
  let url;
  try {
    url = new URL(requiredValue(env, name));
  } catch {
    throw new CandidateAdapterError(`${name} must be a valid URL.`);
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CandidateAdapterError(
      `${name} must be an HTTPS URL without credentials, query, or hash.`,
    );
  }

  const pathname = url.pathname.replace(/\/+$/u, "");
  if (pathname.endsWith("/v1/messages")) {
    url.pathname = pathname;
    return url.toString();
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return new URL("v1/messages", url).toString();
}

function readConfig(env, prefix) {
  parseEnabled(env, prefix);
  const timeoutName = environmentName(prefix, "TIMEOUT_MS");
  const timeoutMs = parseNumber(env, timeoutName, 1000, 300000);

  return {
    apiKey: requiredValue(env, environmentName(prefix, "API_KEY")),
    endpoint: parseMessagesEndpoint(env, prefix),
    model: requiredValue(env, environmentName(prefix, "MODEL")),
    temperature: parseNumber(env, environmentName(prefix, "TEMPERATURE"), 0, 2),
    timeoutMs,
  };
}

function contentBlocks(payload) {
  return Array.isArray(payload?.content) ? payload.content : [];
}

function textContent(payload) {
  return contentBlocks(payload)
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function reasoningText(block) {
  if (block?.type === "thinking" && typeof block.thinking === "string") {
    return block.thinking;
  }
  if (block?.type === "reasoning" && typeof block.reasoning === "string") {
    return block.reasoning;
  }
  if (block?.type === "reasoning" && typeof block.text === "string") {
    return block.text;
  }
  return "";
}

function parseUsage(value) {
  if (!value || typeof value !== "object") return undefined;

  const inputTokens = Number.isInteger(value.input_tokens)
    ? value.input_tokens
    : undefined;
  const outputTokens = Number.isInteger(value.output_tokens)
    ? value.output_tokens
    : undefined;
  const totalTokens = Number.isInteger(value.total_tokens)
    ? value.total_tokens
    : inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined;

  return inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
    ? undefined
    : { inputTokens, outputTokens, totalTokens };
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function readResponseDiagnostics(payload) {
  const blocks = contentBlocks(payload);
  const textBlocks = blocks.filter(
    (block) => block?.type === "text" && typeof block.text === "string",
  );
  const reasoningBlocks = blocks.map(reasoningText).filter(Boolean);

  return {
    finishReason: normalizeCandidateFinishReason(payload?.stop_reason),
    contentPresent: textBlocks.length > 0,
    contentLength: textBlocks.reduce((total, block) => total + block.text.length, 0),
    reasoningContentPresent: reasoningBlocks.length > 0,
    reasoningContentLength: reasoningBlocks.reduce(
      (total, reasoning) => total + reasoning.length,
      0,
    ),
  };
}

function failureDiagnosticsFor(payload, startedAt, rawOutput) {
  return {
    latencyMs: elapsedMilliseconds(startedAt),
    usage: parseUsage(payload?.usage),
    response: readResponseDiagnostics(payload),
    ...(rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)
      ? { rawOutput }
      : {}),
  };
}

function failureMessage(error) {
  return error instanceof Error
    ? error.message
    : "Candidate model output processing failed.";
}

function parseOutput(payload) {
  const content = textContent(payload);
  if (!content.trim()) {
    throw new CandidateAdapterError(
      "Candidate model returned an empty or unsupported response.",
    );
  }

  let output;
  try {
    output = JSON.parse(content);
  } catch {
    throw new CandidateAdapterError(
      "Candidate model returned invalid structured JSON.",
    );
  }

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new CandidateAdapterError(
      "Candidate model returned a non-object structured response.",
    );
  }
  return output;
}

function validateFactoryOptions({ adapterId, providerId, envPrefix }) {
  if (typeof adapterId !== "string" || !adapterId.trim()) {
    throw new CandidateAdapterError("adapterId is required.");
  }
  if (typeof providerId !== "string" || !providerId.trim()) {
    throw new CandidateAdapterError("providerId is required.");
  }
  if (typeof envPrefix !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(envPrefix)) {
    throw new CandidateAdapterError(
      "envPrefix must contain uppercase letters, digits, and underscores.",
    );
  }
}

export function createAnthropicCompatibleEvaluationAdapter(options) {
  validateFactoryOptions(options);
  const {
    adapterId,
    providerId,
    envPrefix,
    env = process.env,
    fetchImpl = globalThis.fetch,
    promptVersion = DEFAULT_EVALUATION_PROMPT_VERSION,
  } = options;
  assertEvaluationPromptVersion(promptVersion);
  if (typeof fetchImpl !== "function") {
    throw new CandidateAdapterError("Global fetch is unavailable.");
  }

  const config = readConfig(env, envPrefix);

  return {
    descriptor: {
      id: adapterId,
      providerId,
      modelId: config.model,
    },

    async evaluateCase(evalCase) {
      const capability =
        evalCase && typeof evalCase.capability === "string"
          ? evalCase.capability
          : "unknown";
      const input = prepareCandidateEvaluationInput(
        promptVersion,
        capability,
        evalCase.input ?? null,
      );
      const controller = new AbortController();
      const startedAt = performance.now();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      try {
        let response;
        try {
          response = await fetchImpl(config.endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: config.model,
              max_tokens: MAX_OUTPUT_TOKENS,
              messages: [{ role: "user", content: JSON.stringify(input) }],
              system: buildEvaluationSystemPrompt(promptVersion, capability),
              temperature: config.temperature,
            }),
            signal: controller.signal,
          });
        } catch {
          if (controller.signal.aborted) {
            throw new CandidateAdapterError("Candidate model request timed out.", {
              latencyMs: elapsedMilliseconds(startedAt),
            });
          }
          throw new CandidateAdapterError(
            "Candidate model request failed before receiving a response.",
            { latencyMs: elapsedMilliseconds(startedAt) },
          );
        }

        if (!response.ok) {
          throw new CandidateAdapterError(
            `Candidate model request failed with HTTP ${response.status}.`,
            { latencyMs: elapsedMilliseconds(startedAt) },
          );
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new CandidateAdapterError(
            "Candidate model returned an invalid JSON envelope.",
            { latencyMs: elapsedMilliseconds(startedAt) },
          );
        }

        let rawOutput;
        try {
          rawOutput = parseOutput(payload);
        } catch (error) {
          throw new CandidateAdapterError(
            failureMessage(error),
            failureDiagnosticsFor(payload, startedAt),
          );
        }

        let policyResult;
        let output;
        try {
          policyResult = applyCandidateOutputPolicy({
            promptVersion,
            capability,
            input,
            output: rawOutput,
          });
          output = parseCandidateEvaluationOutput({
            promptVersion,
            capability,
            input,
            output: policyResult.output,
          });
        } catch (error) {
          throw new CandidateAdapterError(
            failureMessage(error),
            failureDiagnosticsFor(payload, startedAt, rawOutput),
          );
        }

        return {
          output,
          ...(promptVersion === DETERMINISTIC_EVALUATION_PROMPT_VERSION
            ? { rawOutput }
            : {}),
          policyAdjustments: policyResult.policyAdjustments,
          latencyMs: elapsedMilliseconds(startedAt),
          usage: parseUsage(payload.usage),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
