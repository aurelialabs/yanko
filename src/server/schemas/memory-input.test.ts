import { describe, expect, it } from "vitest";

import { deleteMemorySchema, memoryCandidateDecisionSchema } from "./index";

const ids = {
  candidate: "00000000-0000-4000-8000-000000000001",
  role: "00000000-0000-4000-8000-000000000002",
  memory: "00000000-0000-4000-8000-000000000003",
} as const;

describe("memory action input schemas", () => {
  it("accepts a minimal confirmation for an owned pending candidate", () => {
    expect(
      memoryCandidateDecisionSchema.safeParse({
        candidateId: ids.candidate,
        action: "confirm",
        idempotencyKey: "memory-confirm-001",
      }).success,
    ).toBe(true);
  });

  it("rejects editing fields on a rejection request", () => {
    expect(
      memoryCandidateDecisionSchema.safeParse({
        candidateId: ids.candidate,
        action: "reject",
        editedContent: "不要保存这条内容",
        idempotencyKey: "memory-reject-001",
      }).success,
    ).toBe(false);
  });

  it("requires a role when a confirmation explicitly chooses role-private scope", () => {
    expect(
      memoryCandidateDecisionSchema.safeParse({
        candidateId: ids.candidate,
        action: "confirm",
        editedScope: "role_private",
        idempotencyKey: "memory-private-001",
      }).success,
    ).toBe(false);
  });

  it("does not allow a user-shared confirmation to carry a role", () => {
    expect(
      memoryCandidateDecisionSchema.safeParse({
        candidateId: ids.candidate,
        action: "confirm",
        editedScope: "user_shared",
        editedRoleId: ids.role,
        idempotencyKey: "memory-shared-001",
      }).success,
    ).toBe(false);
  });

  it("requires a valid memory identifier and idempotency key before deletion", () => {
    expect(
      deleteMemorySchema.safeParse({
        memoryId: ids.memory,
        idempotencyKey: "memory-delete-001",
      }).success,
    ).toBe(true);
    expect(
      deleteMemorySchema.safeParse({
        memoryId: "not-a-memory-id",
        idempotencyKey: "short",
      }).success,
    ).toBe(false);
  });
});
