import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmMemoryCandidate = vi.hoisted(() => vi.fn());
const rejectMemoryCandidate = vi.hoisted(() => vi.fn());

vi.mock("@/app/me/actions", () => ({
  confirmMemoryCandidate,
  rejectMemoryCandidate,
}));

import { MemoryCandidateCard } from "./memory-candidate-card";

const roleId = "10000000-0000-4000-8000-000000000001";
const candidate = {
  id: "20000000-0000-4000-8000-000000000002",
  content: "用户难过时希望先被倾听。",
  category: "agreement",
  suggestedScope: "role_private" as const,
  roleId,
  roleName: "林知夏",
  sensitivity: "normal" as const,
  expiresAt: "2026-10-01T00:00:00.000Z",
};

describe("MemoryCandidateCard", () => {
  beforeEach(() => {
    confirmMemoryCandidate.mockReset();
    rejectMemoryCandidate.mockReset();
  });

  it("submits edited content and an explicit scope through the confirm action", async () => {
    confirmMemoryCandidate.mockResolvedValue({
      message: "",
      memoryId: "30000000-0000-4000-8000-000000000003",
      succeeded: true,
    });
    render(<MemoryCandidateCard candidate={candidate} />);

    fireEvent.change(screen.getByLabelText("记忆内容"), {
      target: { value: "用户难过时希望先安静听完。" },
    });
    fireEvent.change(screen.getByLabelText("作用范围"), {
      target: { value: "user_shared" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() => expect(confirmMemoryCandidate).toHaveBeenCalledOnce());
    const formData = confirmMemoryCandidate.mock.calls[0][1] as FormData;
    expect(formData.get("editedContent")).toBe("用户难过时希望先安静听完。");
    expect(formData.get("editedScope")).toBe("user_shared");
    expect(formData.get("editedRoleId")).toBe("");
    expect(await screen.findByText("已保存这条记忆")).toBeInTheDocument();
  });

  it("locks a sensitive candidate to its source role", () => {
    render(
      <MemoryCandidateCard
        candidate={{
          ...candidate,
          sensitivity: "sensitive",
          category: "sensitive",
        }}
      />,
    );

    expect(screen.getByText(/只有你确认后才会保存/)).toBeInTheDocument();
    expect(screen.getByLabelText("作用范围")).toBeDisabled();
    expect(screen.getByDisplayValue(/仅当前角色/)).toBeInTheDocument();
  });

  it("rejects a candidate without sending editable memory fields", async () => {
    rejectMemoryCandidate.mockResolvedValue({ message: "", succeeded: true });
    render(<MemoryCandidateCard candidate={candidate} />);

    fireEvent.click(screen.getByRole("button", { name: "不保存" }));

    await waitFor(() => expect(rejectMemoryCandidate).toHaveBeenCalledOnce());
    const formData = rejectMemoryCandidate.mock.calls[0][1] as FormData;
    expect(formData.get("candidateId")).toBe(candidate.id);
    expect(formData.has("editedContent")).toBe(false);
    expect(await screen.findByText("已选择不保存")).toBeInTheDocument();
  });
});
