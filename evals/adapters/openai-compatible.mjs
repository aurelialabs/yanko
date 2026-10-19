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

export { getCandidateAdapterFailureDiagnostics } from "./candidate-adapter-error.mjs";

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

function parseBaseUrl(env, prefix) {
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

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

function readConfig(env, prefix) {
  parseEnabled(env, prefix);
  const baseUrl = parseBaseUrl(env, prefix);
  const timeoutName = environmentName(prefix, "TIMEOUT_MS");
  const timeoutMs = parseNumber(env, timeoutName, 1000, 300000);

  return {
    apiKey: requiredValue(env, environmentName(prefix, "API_KEY")),
    endpoint: new URL("chat/completions", baseUrl).toString(),
    model: requiredValue(env, environmentName(prefix, "MODEL")),
    temperature: parseNumber(env, environmentName(prefix, "TEMPERATURE"), 0, 2),
    timeoutMs,
  };
}

function parseUsage(value) {
  if (!value || typeof value !== "object") return undefined;

  const inputTokens = Number.isInteger(value.prompt_tokens)
    ? value.prompt_tokens
    : undefined;
  const outputTokens = Number.isInteger(value.completion_tokens)
    ? value.completion_tokens
    : undefined;
  const totalTokens = Number.isInteger(value.total_tokens)
    ? value.total_tokens
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
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const reasoningContent = message?.reasoning_content;

  return {
    finishReason: normalizeCandidateFinishReason(choice?.finish_reason),
    contentPresent: typeof content === "string",
    contentLength: typeof content === "string" ? content.length : 0,
    reasoningContentPresent: typeof reasoningContent === "string",
    reasoningContentLength:
      typeof reasoningContent === "string" ? reasoningContent.length : 0,
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
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
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

export function createOpenAiCompatibleEvaluationAdapter(options) {
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
              messages: [
                {
                  role: "system",
                  content: buildEvaluationSystemPrompt(promptVersion, capability),
                },
                { role: "user", content: JSON.stringify(input) },
              ],
              max_tokens: MAX_OUTPUT_TOKENS,
              response_format: { type: "json_object" },
              stream: false,
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
