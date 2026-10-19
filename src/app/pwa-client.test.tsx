import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PwaClient } from "./pwa-client";

const register = vi.fn();

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("PwaClient", () => {
  beforeEach(() => {
    setOnline(true);
    register.mockReset();
    register.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "serviceWorker");
    Reflect.deleteProperty(window, "isSecureContext");
  });

  it("registers the same-origin worker only from a secure browser context", () => {
    render(<PwaClient />);

    expect(register).toHaveBeenCalledWith("/service-worker.js", { scope: "/" });
  });

  it("only exposes installation when the browser offers its native prompt", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt,
        userChoice: Promise.resolve({ outcome: "dismissed" as const, platform: "web" }),
      },
    );
    render(<PwaClient />);

    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "安装言行" })).toBeVisible();

    await act(async () => {
      screen.getByRole("button", { name: "安装言行" }).click();
    });

    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "安装言行" })).not.toBeInTheDocument();
  });

  it("shows a clear status and stops offline form submissions before their action runs", async () => {
    setOnline(false);
    const onSubmit = vi.fn();
    const { container } = render(
      <>
        <PwaClient />
        <form onSubmit={onSubmit}>
          <button type="submit">保存</button>
        </form>
      </>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("当前处于离线状态");

    const form = container.querySelector("form");
    if (!form) throw new Error("测试表单没有渲染");

    const event = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => {
      form.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("本次提交未发送");

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
