import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallInstructions, PwaClient } from "./pwa-client";

const register = vi.fn();
let displayMode: EventTarget & { matches: boolean };

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

describe("PwaClient", () => {
  beforeEach(() => {
    setOnline(true);
    register.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    displayMode = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => displayMode),
    );
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "serviceWorker");
    Reflect.deleteProperty(navigator, "onLine");
    Reflect.deleteProperty(navigator, "standalone");
    Reflect.deleteProperty(window, "isSecureContext");
    vi.unstubAllGlobals();
  });

  it("registers the same-origin worker without reusing a stale HTTP cache", () => {
    render(<PwaClient />);
    expect(register).toHaveBeenCalledWith("/service-worker.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("works when service workers are unavailable or registration fails", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    const { unmount } = render(<PwaClient />);
    expect(register).not.toHaveBeenCalled();
    unmount();
    register.mockRejectedValue(new Error("unavailable"));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
    await act(async () => {
      render(<PwaClient />);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps install guidance user initiated and does not claim automatic Safari installation", () => {
    const { rerender } = render(<PwaClient />);
    expect(screen.queryByText(/主屏幕/)).not.toBeInTheDocument();
    rerender(<InstallInstructions />);
    expect(screen.getByRole("heading", { name: "在 Safari 中添加" })).toBeVisible();
    expect(screen.getByText("轻点“分享”")).toBeVisible();
    expect(screen.getByText("选择“添加到主屏幕”")).toBeVisible();
    expect(screen.getByText(/作为网页 App 打开/)).toBeVisible();
    expect(screen.getByText("确认名称“Yanko”，轻点“添加”")).toBeVisible();
    expect(screen.queryByLabelText("使用提醒")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续使用言行" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["media", "navigator"])(
    "recognizes standalone mode through %s without urging reinstallation",
    (source) => {
      if (source === "media") displayMode.matches = true;
      else
        Object.defineProperty(navigator, "standalone", {
          configurable: true,
          value: true,
        });
      render(<InstallInstructions />);
      expect(screen.getByRole("heading", { name: "已从主屏幕打开言行" })).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "在 Safari 中添加" }),
      ).not.toBeInTheDocument();
    },
  );

  it("updates install guidance when the display mode changes and removes listeners on unmount", () => {
    const remove = vi.spyOn(displayMode, "removeEventListener");
    const { unmount } = render(<InstallInstructions />);
    act(() => {
      displayMode.matches = true;
      displayMode.dispatchEvent(new Event("change"));
    });
    expect(screen.getByRole("heading", { name: "已从主屏幕打开言行" })).toBeVisible();
    unmount();
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("blocks offline writes before React handlers run, never queues them, and allows a new online submission", () => {
    setOnline(false);
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { container } = render(
      <>
        <PwaClient />
        <form onSubmit={onSubmit}>
          <button type="submit">保存</button>
        </form>
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("当前处于离线状态");
    const form = container.querySelector("form")!;
    const event = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      form.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("本次提交未发送");
    expect(screen.getByRole("status")).toHaveTextContent("不会自动补交");
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("blocks a sudden offline submission before the browser offline event arrives", () => {
    const { container } = render(
      <>
        <PwaClient />
        <form />
      </>,
    );
    setOnline(false);
    act(() => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("本次提交未发送");
  });

  it("fits the visible viewport when the keyboard opens without reacting to pinch zoom", () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, scale: 1 });
    vi.stubGlobal("visualViewport", viewport);
    const remove = vi.spyOn(viewport, "removeEventListener");
    const { unmount } = render(<PwaClient />);
    const height = () =>
      document.documentElement.style.getPropertyValue("--yanko-viewport-height");
    expect(height()).toBe("800px");
    act(() => {
      viewport.height = 420;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(height()).toBe("420px");
    act(() => {
      viewport.scale = 2;
      viewport.height = 210;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(height()).toBe("420px");
    act(() => {
      viewport.scale = 1;
      viewport.height = 800;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(height()).toBe("800px");
    unmount();
    expect(height()).toBe("");
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("removes offline interception after unmount", () => {
    const { unmount } = render(<PwaClient />);
    unmount();
    setOnline(false);
    const form = document.createElement("form");
    document.body.appendChild(form);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    form.remove();
  });
});
