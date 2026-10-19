import "server-only";

import {
  memoryExtractionOutputSchema,
  uuidSchema,
  type MemoryExtractionOutput,
} from "@/server/schemas";
import type { MemoryScope, MemorySensitivity, MemoryStatus } from "@/types/domain";

export const MEMORY_POLICY_VERSION = "v0.1";

type ExtractedMemoryCandidate = MemoryExtractionOutput["candidates"][number];
type PersistedMemorySensitivity = Exclude<MemorySensitivity, "forbidden">;

export type MemoryPolicyAction = "auto_write" | "create_candidate" | "discard";

export type MemoryPolicyReason =
  | "forbidden_content"
  | "ignored_by_extractor"
  | "missing_explicit_user_evidence"
  | "invalid_shared_role_binding"
  | "cross_role_target"
  | "sensitive_requires_confirmation"
  | "shared_scope_requires_confirmation"
  | "explicit_confirmation_requested"
  | "normal_auto_write"
  | "invalid_supersession_target"
  | "ambiguous_active_conflict"
  | "user_confirmed_conflict_requires_confirmation"
  | "duplicate_candidate";

/**
 * This is the smallest trusted view needed to validate a proposed dynamic
 * memory update. Callers must load it from the current user's server-side
 * data access layer; client-supplied memory records are never acceptable.
 */
export interface ExistingMemoryForPolicy {
  id: string;
  userId: string;
  scope: MemoryScope;
  roleId: string | null;
  normalizedKey: string | null;
  status: MemoryStatus;
  confirmedByUser?: boolean;
  deletedAt?: string | null;
}

export interface MemoryPolicyCandidate {
  sourceMessageId: string;
  scope: MemoryScope;
  roleId: string | null;
  category: string;
  content: string;
  normalizedKey: string | null;
  sensitivity: PersistedMemorySensitivity;
  confidence: number;
  supersedesMemoryId: string | null;
}

export interface MemoryPolicyOperation {
  candidateIndex: number;
  action: MemoryPolicyAction;
  reason: MemoryPolicyReason;
  memory: MemoryPolicyCandidate | null;
}

export interface MemoryPolicyInput {
  currentUserId: string;
  currentRoleId: string;
  sourceMessageId: string;
  rawExtractionOutput: unknown;
  existingMemories: readonly ExistingMemoryForPolicy[];
  /**
   * The extraction schema deliberately does not trust a model's private chain
   * of thought. A future server-side grounding step must explicitly attest
   * that a candidate is a fact the user actually stated before this policy
   * permits it to be persisted in any form. Defaults to fail closed.
   */
  hasExplicitUserEvidence?: (
    candidate: ExtractedMemoryCandidate,
    candidateIndex: number,
  ) => boolean;
  /**
   * User-shared memory affects every persona. It needs an explicit, trusted
   * cross-role decision; otherwise the same candidate stays pending for the
   * user's confirmation instead of being auto-written.
   */
  isUserSharedScopeApproved?: (
    candidate: ExtractedMemoryCandidate,
    candidateIndex: number,
  ) => boolean;
}

export interface MemoryPolicyResult {
  policyVersion: typeof MEMORY_POLICY_VERSION;
  operations: readonly MemoryPolicyOperation[];
}

export class MemoryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryPolicyError";
  }
}

interface ResolvedScope {
  scope: MemoryScope;
  roleId: string | null;
}

function normalizedText(value: string | null): string | null {
  if (value === null) return null;

  const normalized = value.trim();
  return normalized || null;
}

function requireUuid(value: string, label: string): void {
  if (!uuidSchema.safeParse(value).success) {
    throw new MemoryPolicyError(`${label} must be a UUID.`);
  }
}

function discarded(
  candidateIndex: number,
  reason: MemoryPolicyReason,
): MemoryPolicyOperation {
  return { candidateIndex, action: "discard", reason, memory: null };
}

function resolveScope(
  candidate: ExtractedMemoryCandidate,
  currentRoleId: string,
): ResolvedScope | MemoryPolicyReason {
  if (candidate.roleId !== null && candidate.roleId !== currentRoleId) {
    return "cross_role_target";
  }

  // Family, health, relationships, and material emotional experiences remain
  // role-private even if an untrusted extractor incorrectly labels them shared.
  if (candidate.sensitivity === "sensitive") {
    return { scope: "role_private", roleId: currentRoleId };
  }

  if (candidate.scope === "user_shared") {
    return candidate.roleId === null
      ? { scope: "user_shared", roleId: null }
      : "invalid_shared_role_binding";
  }

  return { scope: "role_private", roleId: currentRoleId };
}

function isReason(
  value: ResolvedScope | MemoryPolicyReason,
): value is MemoryPolicyReason {
  return typeof value === "string";
}

function activeScopedMemories(
  existingMemories: readonly ExistingMemoryForPolicy[],
  currentUserId: string,
  scope: MemoryScope,
  roleId: string | null,
): readonly ExistingMemoryForPolicy[] {
  return existingMemories.filter(
    (memory) =>
      memory.userId === currentUserId &&
      memory.status === "active" &&
      memory.deletedAt == null &&
      memory.scope === scope &&
      memory.roleId === roleId,
  );
}

function resolveSupersession(
  candidate: ExtractedMemoryCandidate,
  memoriesInScope: readonly ExistingMemoryForPolicy[],
): string | null | MemoryPolicyReason {
  const normalizedKey = normalizedText(candidate.normalizedKey);
  const requestedId = candidate.supersedesMemoryId;

  if (!normalizedKey) {
    return requestedId === null ? null : "invalid_supersession_target";
  }

  const conflicts = memoriesInScope.filter(
    (memory) => normalizedText(memory.normalizedKey) === normalizedKey,
  );

  if (requestedId !== null) {
    const requested = conflicts.find((memory) => memory.id === requestedId);
    return requested ? requested.id : "invalid_supersession_target";
  }

  if (conflicts.length === 0) return null;
  if (conflicts.length === 1) return conflicts[0].id;

  return "ambiguous_active_conflict";
}

function isSupersessionReason(
  value: string | null | MemoryPolicyReason,
): value is MemoryPolicyReason {
  return (
    value === "invalid_supersession_target" || value === "ambiguous_active_conflict"
  );
}

function candidateKey(
  scope: ResolvedScope,
  normalizedKey: string | null,
): string | null {
  return normalizedKey === null
    ? null
    : `${scope.scope}:${scope.roleId ?? "shared"}:${normalizedKey}`;
}

function toMemoryCandidate(
  candidate: ExtractedMemoryCandidate,
  sourceMessageId: string,
  scope: ResolvedScope,
  supersedesMemoryId: string | null,
): MemoryPolicyCandidate {
  const sensitivity: PersistedMemorySensitivity =
    candidate.sensitivity === "sensitive" ? "sensitive" : "normal";

  return {
    sourceMessageId,
    scope: scope.scope,
    roleId: scope.roleId,
    category: candidate.category.trim(),
    content: candidate.content.trim(),
    normalizedKey: normalizedText(candidate.normalizedKey),
    sensitivity,
    confidence: candidate.confidence,
    supersedesMemoryId,
  };
}

/**
 * Applies the V0 memory safety rules to an untrusted structured extraction.
 * It performs no database mutation. A later server-only persistence layer must
 * execute an approved operation atomically and re-check ownership, source
 * message, candidate state, and supersession at the database boundary.
 */
export function applyMemoryPolicy(input: MemoryPolicyInput): MemoryPolicyResult {
  requireUuid(input.currentUserId, "currentUserId");
  requireUuid(input.currentRoleId, "currentRoleId");
  requireUuid(input.sourceMessageId, "sourceMessageId");

  const parsed = memoryExtractionOutputSchema.safeParse(input.rawExtractionOutput);
  if (!parsed.success) {
    throw new MemoryPolicyError("Memory extractor returned invalid structured output.");
  }

  const explicitEvidence = input.hasExplicitUserEvidence ?? (() => false);
  const sharedScopeApproved = input.isUserSharedScopeApproved ?? (() => false);
  const emittedKeys = new Set<string>();
  const operations = parsed.data.candidates.map((candidate, candidateIndex) => {
    if (candidate.action === "ignore") {
      return discarded(candidateIndex, "ignored_by_extractor");
    }

    if (candidate.action === "forbidden" || candidate.sensitivity === "forbidden") {
      return discarded(candidateIndex, "forbidden_content");
    }

    if (!explicitEvidence(candidate, candidateIndex)) {
      return discarded(candidateIndex, "missing_explicit_user_evidence");
    }

    const scope = resolveScope(candidate, input.currentRoleId);
    if (isReason(scope)) {
      return discarded(candidateIndex, scope);
    }

    const normalizedKey = normalizedText(candidate.normalizedKey);
    const dedupeKey = candidateKey(scope, normalizedKey);
    if (dedupeKey && emittedKeys.has(dedupeKey)) {
      return discarded(candidateIndex, "duplicate_candidate");
    }

    const supersedesMemoryId = resolveSupersession(
      candidate,
      activeScopedMemories(
        input.existingMemories,
        input.currentUserId,
        scope.scope,
        scope.roleId,
      ),
    );
    if (isSupersessionReason(supersedesMemoryId)) {
      return discarded(candidateIndex, supersedesMemoryId);
    }

    if (dedupeKey) emittedKeys.add(dedupeKey);

    const memory = toMemoryCandidate(
      candidate,
      input.sourceMessageId,
      scope,
      supersedesMemoryId,
    );

    if (candidate.sensitivity === "sensitive") {
      return {
        candidateIndex,
        action: "create_candidate" as const,
        reason: "sensitive_requires_confirmation" as const,
        memory,
      };
    }

    if (candidate.action === "confirm") {
      return {
        candidateIndex,
        action: "create_candidate" as const,
        reason: "explicit_confirmation_requested" as const,
        memory,
      };
    }

    if (
      scope.scope === "user_shared" &&
      !sharedScopeApproved(candidate, candidateIndex)
    ) {
      return {
        candidateIndex,
        action: "create_candidate" as const,
        reason: "shared_scope_requires_confirmation" as const,
        memory,
      };
    }

    const supersededMemory = supersedesMemoryId
      ? input.existingMemories.find((item) => item.id === supersedesMemoryId)
      : null;
    if (supersededMemory?.confirmedByUser) {
      return {
        candidateIndex,
        action: "create_candidate" as const,
        reason: "user_confirmed_conflict_requires_confirmation" as const,
        memory,
      };
    }

    return {
      candidateIndex,
      action: "auto_write" as const,
      reason: "normal_auto_write" as const,
      memory,
    };
  });

  return { policyVersion: MEMORY_POLICY_VERSION, operations };
}
