import { describe, expect, it } from "vitest";

import {
  MEMORY_POLICY_VERSION,
  applyMemoryPolicy,
  type ExistingMemoryForPolicy,
} from "./memory-policy";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  otherRole: "00000000-0000-4000-8000-000000000003",
  message: "00000000-0000-4000-8000-000000000004",
  oldShared: "00000000-0000-4000-8000-000000000005",
  otherUser: "00000000-0000-4000-8000-000000000006",
} as const;

const baseCandidate = {
  action: "auto_write",
  scope: "role_private",
  roleId: ids.role,
  category: "agreement",
  content: "用户难过时希望先倾听。",
  normalizedKey: "support_preference_when_sad",
  sensitivity: "normal",
  confidence: 0.98,
  supersedesMemoryId: null,
};

function apply(
  candidates: readonly unknown[],
  overrides: Partial<Parameters<typeof applyMemoryPolicy>[0]> = {},
) {
  return applyMemoryPolicy({
    currentUserId: ids.user,
    currentRoleId: ids.role,
    sourceMessageId: ids.message,
    rawExtractionOutput: { candidates },
    existingMemories: [],
    hasExplicitUserEvidence: () => true,
    ...overrides,
  });
}

describe("applyMemoryPolicy", () => {
  it("fails closed when a caller has not established explicit user evidence", () => {
    const result = applyMemoryPolicy({
      currentUserId: ids.user,
      currentRoleId: ids.role,
      sourceMessageId: ids.message,
      rawExtractionOutput: { candidates: [baseCandidate] },
      existingMemories: [],
    });

    expect(result).toEqual({
      policyVersion: MEMORY_POLICY_VERSION,
      operations: [
        {
          candidateIndex: 0,
          action: "discard",
          reason: "missing_explicit_user_evidence",
          memory: null,
        },
      ],
    });
  });

  it("permits grounded normal role-private memories to auto-write", () => {
    const result = apply([baseCandidate]);

    expect(result.operations[0]).toMatchObject({
      action: "auto_write",
      reason: "normal_auto_write",
      memory: {
        sourceMessageId: ids.message,
        scope: "role_private",
        roleId: ids.role,
        sensitivity: "normal",
      },
    });
  });

  it("keeps an otherwise grounded shared memory pending until sharing is trusted", () => {
    const result = apply([
      {
        ...baseCandidate,
        scope: "user_shared",
        roleId: null,
        normalizedKey: "preferred_name",
      },
    ]);

    expect(result.operations[0]).toMatchObject({
      action: "create_candidate",
      reason: "shared_scope_requires_confirmation",
      memory: { scope: "user_shared", roleId: null },
    });
  });

  it("allows an explicitly approved shared scope without letting the extractor decide alone", () => {
    const result = apply(
      [
        {
          ...baseCandidate,
          scope: "user_shared",
          roleId: null,
          normalizedKey: "preferred_name",
        },
      ],
      { isUserSharedScopeApproved: () => true },
    );

    expect(result.operations[0]).toMatchObject({
      action: "auto_write",
      memory: { scope: "user_shared", roleId: null },
    });
  });

  it("forces sensitive memories into the current role's confirmation flow", () => {
    const result = apply([
      {
        ...baseCandidate,
        scope: "user_shared",
        roleId: null,
        category: "sensitive",
        content: "用户曾有严重抑郁经历。",
        normalizedKey: "mental_health_history",
        sensitivity: "sensitive",
      },
    ]);

    expect(result.operations[0]).toMatchObject({
      action: "create_candidate",
      reason: "sensitive_requires_confirmation",
      memory: {
        scope: "role_private",
        roleId: ids.role,
        sensitivity: "sensitive",
      },
    });
  });

  it("never persists forbidden content or a cross-role target", () => {
    const result = apply([
      { ...baseCandidate, action: "forbidden", sensitivity: "forbidden" },
      { ...baseCandidate, roleId: ids.otherRole },
    ]);

    expect(result.operations).toEqual([
      {
        candidateIndex: 0,
        action: "discard",
        reason: "forbidden_content",
        memory: null,
      },
      {
        candidateIndex: 1,
        action: "discard",
        reason: "cross_role_target",
        memory: null,
      },
    ]);
  });

  it("creates a same-scope dynamic replacement chain without overwriting the old memory", () => {
    const oldMemory: ExistingMemoryForPolicy = {
      id: ids.oldShared,
      userId: ids.user,
      scope: "user_shared",
      roleId: null,
      normalizedKey: "preference_milk",
      status: "active",
    };
    const result = apply(
      [
        {
          ...baseCandidate,
          scope: "user_shared",
          roleId: null,
          category: "preference",
          content: "用户现在不喜欢牛奶。",
          normalizedKey: "preference_milk",
          supersedesMemoryId: ids.oldShared,
        },
      ],
      {
        existingMemories: [oldMemory],
        isUserSharedScopeApproved: () => true,
      },
    );

    expect(result.operations[0]).toMatchObject({
      action: "auto_write",
      memory: { supersedesMemoryId: ids.oldShared },
    });
  });

  it("refuses a supersession target outside the current user and scope", () => {
    const result = apply([{ ...baseCandidate, supersedesMemoryId: ids.oldShared }], {
      existingMemories: [
        {
          id: ids.oldShared,
          userId: ids.otherUser,
          scope: "role_private",
          roleId: ids.otherRole,
          normalizedKey: "support_preference_when_sad",
          status: "active",
        },
      ],
    });

    expect(result.operations[0]).toEqual({
      candidateIndex: 0,
      action: "discard",
      reason: "invalid_supersession_target",
      memory: null,
    });
  });

  it("does not automatically overwrite a memory the user has confirmed", () => {
    const result = apply([{ ...baseCandidate, supersedesMemoryId: ids.oldShared }], {
      existingMemories: [
        {
          id: ids.oldShared,
          userId: ids.user,
          scope: "role_private",
          roleId: ids.role,
          normalizedKey: "support_preference_when_sad",
          status: "active",
          confirmedByUser: true,
        },
      ],
    });

    expect(result.operations[0]).toMatchObject({
      action: "create_candidate",
      reason: "user_confirmed_conflict_requires_confirmation",
      memory: { supersedesMemoryId: ids.oldShared },
    });
  });
});
