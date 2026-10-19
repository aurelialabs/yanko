import "server-only";

import { type OocPolicyResult, applyOocPolicy } from "./ooc-policy";

export interface OocGateDependencies {
  /** Returns raw structured checker output; schema validation happens in the gate. */
  checkDraft: (draft: string, attemptNo: 1 | 2) => Promise<unknown>;
  /** Produces one replacement draft after a first failed check. */
  rewriteDraft: (draft: string, instructions: readonly string[]) => Promise<string>;
}

export interface OocGateCheckRecord {
  attemptNo: 1 | 2;
  checkerRetries: 0;
  policy: OocPolicyResult;
}

export type OocGateResult =
  | {
      outcome: "pass";
      finalDraft: string;
      rewritten: boolean;
      checks: readonly OocGateCheckRecord[];
    }
  | {
      outcome: "blocked";
      reason: "policy-block";
      rewritten: boolean;
      checks: readonly OocGateCheckRecord[];
    }
  | {
      outcome: "failed";
      reason: "checker-unavailable" | "rewrite-unavailable";
      rewritten: boolean;
      checks: readonly OocGateCheckRecord[];
    };

function hasText(value: string): boolean {
  return Boolean(value.trim());
}

/**
 * Checks a draft at most twice when the checker endpoint itself is unavailable
 * or returns malformed data. The retry is for the same draft and is distinct
 * from the one permitted content rewrite.
 */
async function checkOnce(
  checkDraft: OocGateDependencies["checkDraft"],
  draft: string,
  attemptNo: 1 | 2,
): Promise<OocGateCheckRecord | null> {
  try {
    const rawAssessment = await checkDraft(draft, attemptNo);
    return {
      attemptNo,
      checkerRetries: 0,
      policy: applyOocPolicy(rawAssessment, attemptNo),
    };
  } catch {
    // Provider details and checker output never cross this boundary. A failed
    // checker closes the turn without issuing another provider request.
    return null;
  }
}

/**
 * Enforces the PRD's fixed OOC sequence before any assistant message is
 * persisted or returned to a Client Component. This function never returns an
 * unchecked draft, even if the checker or rewrite provider is unavailable.
 */
export async function runOocGate(
  initialDraft: string,
  dependencies: OocGateDependencies,
): Promise<OocGateResult> {
  if (!hasText(initialDraft)) {
    return {
      outcome: "failed",
      reason: "rewrite-unavailable",
      rewritten: false,
      checks: [],
    };
  }

  const firstCheck = await checkOnce(dependencies.checkDraft, initialDraft, 1);
  if (!firstCheck) {
    return {
      outcome: "failed",
      reason: "checker-unavailable",
      rewritten: false,
      checks: [],
    };
  }

  if (firstCheck.policy.action === "pass") {
    return {
      outcome: "pass",
      finalDraft: initialDraft,
      rewritten: false,
      checks: [firstCheck],
    };
  }

  if (firstCheck.policy.action === "block") {
    return {
      outcome: "blocked",
      reason: "policy-block",
      rewritten: false,
      checks: [firstCheck],
    };
  }

  let rewrittenDraft: string;
  try {
    rewrittenDraft = await dependencies.rewriteDraft(
      initialDraft,
      firstCheck.policy.rewriteInstructions,
    );
  } catch {
    return {
      outcome: "failed",
      reason: "rewrite-unavailable",
      rewritten: true,
      checks: [firstCheck],
    };
  }

  if (!hasText(rewrittenDraft)) {
    return {
      outcome: "failed",
      reason: "rewrite-unavailable",
      rewritten: true,
      checks: [firstCheck],
    };
  }

  const secondCheck = await checkOnce(dependencies.checkDraft, rewrittenDraft, 2);
  if (!secondCheck) {
    return {
      outcome: "failed",
      reason: "checker-unavailable",
      rewritten: true,
      checks: [firstCheck],
    };
  }

  if (secondCheck.policy.action === "pass") {
    return {
      outcome: "pass",
      finalDraft: rewrittenDraft,
      rewritten: true,
      checks: [firstCheck, secondCheck],
    };
  }

  return {
    outcome: "blocked",
    reason: "policy-block",
    rewritten: true,
    checks: [firstCheck, secondCheck],
  };
}
