export class CandidateAdapterError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = "CandidateAdapterError";
    Object.defineProperty(this, "evaluationDiagnostics", {
      configurable: false,
      enumerable: false,
      value: normalizeFailureDiagnostics(diagnostics),
      writable: false,
    });
  }
}

export function getCandidateAdapterFailureDiagnostics(error) {
  return error instanceof CandidateAdapterError
    ? error.evaluationDiagnostics
    : undefined;
}

export function normalizeCandidateFinishReason(value) {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,64}$/iu.test(value)
    ? value
    : null;
}

function normalizeFailureUsage(value) {
  if (!value || typeof value !== "object") return undefined;

  const usage = {};
  for (const field of ["inputTokens", "outputTokens", "totalTokens"]) {
    if (Number.isInteger(value[field]) && value[field] >= 0) {
      usage[field] = value[field];
    }
  }
  return Object.keys(usage).length > 0 ? Object.freeze(usage) : undefined;
}

function normalizeFailureDiagnostics(value) {
  if (!value || typeof value !== "object") return undefined;

  const diagnostics = {};
  if (Number.isInteger(value.latencyMs) && value.latencyMs >= 0) {
    diagnostics.latencyMs = value.latencyMs;
  }

  const usage = normalizeFailureUsage(value.usage);
  if (usage) diagnostics.usage = usage;

  if (value.response && typeof value.response === "object") {
    diagnostics.response = Object.freeze({
      finishReason: normalizeCandidateFinishReason(value.response.finishReason),
      contentPresent: value.response.contentPresent === true,
      contentLength:
        Number.isInteger(value.response.contentLength) &&
        value.response.contentLength >= 0
          ? value.response.contentLength
          : 0,
      reasoningContentPresent: value.response.reasoningContentPresent === true,
      reasoningContentLength:
        Number.isInteger(value.response.reasoningContentLength) &&
        value.response.reasoningContentLength >= 0
          ? value.response.reasoningContentLength
          : 0,
    });
  }

  if (
    value.rawOutput &&
    typeof value.rawOutput === "object" &&
    !Array.isArray(value.rawOutput)
  ) {
    diagnostics.rawOutput = value.rawOutput;
  }

  return Object.keys(diagnostics).length > 0 ? Object.freeze(diagnostics) : undefined;
}
