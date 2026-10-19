import { getCandidateAdapterFailureDiagnostics } from "../adapters/candidate-adapter-error.mjs";

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown evaluation error.";
}

export function createEvaluationFailureFields(error) {
  const diagnostics = getCandidateAdapterFailureDiagnostics(error);

  return {
    latencyMs: diagnostics?.latencyMs ?? null,
    usage: diagnostics?.usage ?? null,
    ...(diagnostics?.response ? { responseDiagnostics: diagnostics.response } : {}),
    ...(isRecord(diagnostics?.rawOutput) ? { rawOutput: diagnostics.rawOutput } : {}),
    output: null,
    score: null,
    error: safeErrorMessage(error),
  };
}
