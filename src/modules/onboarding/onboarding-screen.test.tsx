import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readDemoSession } from "@/modules/demo/demo-session";
import { demoRoleWorkspace } from "@/modules/roles/role-presentation";
import { GUEST_ONBOARDING_KEY } from "./guest-onboarding";
import { OnboardingScreen } from "./onboarding-screen";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/onboarding/actions", () => ({ completeOnboarding: vi.fn() }));

describe("Companion onboarding", () => {
  beforeEach(() => {
    localStorage.clear();
    router.replace.mockReset();
  });
  afterEach(cleanup);

  it("requires a deliberate choice and keeps that companion when entering chat", () => {
    render(<OnboardingScreen workspace={demoRoleWorkspace} />);
    expect(screen.getByRole("button", { name: /选择一位伙伴/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /周予安/ }));
    fireEvent.click(screen.getByRole("button", { name: /和周予安开始聊天/ }));
    expect(readDemoSession().activeRoleKey).toBe("zhou_yuan");
    expect(localStorage.getItem(GUEST_ONBOARDING_KEY)).toBe("complete");
    expect(router.replace).toHaveBeenCalledWith("/chat");
  });

  it("does not offer unusable fallback roles if the signed-in role lookup fails", () => {
    render(
      <OnboardingScreen workspace={{ ...demoRoleWorkspace, source: "unavailable" }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("请刷新后重试");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});
