import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GUEST_ONBOARDING_KEY } from "./guest-onboarding";
import { LaunchScreen } from "./launch-screen";

const router = vi.hoisted(() => ({ replace: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("Yanko app entry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    router.replace.mockReset();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("guides a new visitor through login before choosing a companion", () => {
    render(<LaunchScreen authenticated={false} completed={false} />);
    expect(screen.getByRole("heading", { name: "很高兴，遇见你" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /登录，开启陪伴/ })).toHaveAttribute(
      "href",
      "/login?next=%2Fonboarding",
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the welcome and moves returning accounts to the home screen", () => {
    render(<LaunchScreen authenticated completed />);
    expect(screen.getByRole("heading", { name: "欢迎回到 Yanko" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2699));
    expect(router.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(router.replace).toHaveBeenCalledWith("/chat");
  });

  it("recognizes a completed guest visit and respects reduced motion", () => {
    localStorage.setItem(GUEST_ONBOARDING_KEY, "complete");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    render(<LaunchScreen authenticated={false} completed={false} />);
    expect(screen.getByRole("heading", { name: "欢迎回到 Yanko" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(350));
    expect(router.replace).toHaveBeenCalledWith("/chat");
  });

  it("does not let a local guest flag skip a signed-in account's first selection", () => {
    localStorage.setItem(GUEST_ONBOARDING_KEY, "complete");
    render(<LaunchScreen authenticated completed={false} />);
    expect(screen.getByRole("link", { name: /遇见你的 AI 伙伴/ })).toHaveAttribute(
      "href",
      "/onboarding",
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(router.replace).not.toHaveBeenCalled();
  });
});
