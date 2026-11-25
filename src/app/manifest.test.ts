import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import manifest from "./manifest";

describe("PWA manifest", () => {
  it("launches the public root in standalone mode with portable PNG icons", () => {
    expect(manifest()).toMatchObject({
      id: "/",
      name: "Yanko · 言行",
      short_name: "Yanko",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#F5F3F9",
      theme_color: "#F5F3F9",
      lang: "zh-CN",
    });
    expect(manifest().icons).toEqual([
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ]);
  });

  it.each([
    ["apple-touch-icon", 180],
    ["icon-192", 192],
    ["icon-512", 512],
  ])("ships an opaque, correctly sized %s PNG", (name, size) => {
    const bytes = readFileSync(resolve(process.cwd(), `public/icons/${name}.png`));
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
    expect(bytes[25]).toBe(2); // RGB, without an alpha channel: iOS applies the mask.
  });
});

type WorkerFetchEvent = {
  request: { method: string; url: string; mode: string; headers: Headers };
  respondWith: ReturnType<typeof vi.fn>;
};

function workerHarness() {
  const listeners: Record<string, (event: WorkerFetchEvent) => void> = {};
  const cache = {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn(),
    addAll: vi.fn(),
  };
  const fetch = vi.fn();
  runInNewContext(
    readFileSync(resolve(process.cwd(), "public/service-worker.js"), "utf8"),
    {
      self: {
        location: { origin: "https://yanko.test" },
        addEventListener: (name: string, callback: (typeof listeners)[string]) => {
          listeners[name] = callback;
        },
      },
      caches: { open: vi.fn().mockResolvedValue(cache) },
      fetch,
      URL,
      Response,
    },
  );
  function dispatch(
    path: string,
    options: { method?: string; mode?: string; headers?: Record<string, string> } = {},
  ) {
    const event = {
      request: {
        method: options.method ?? "GET",
        url: new URL(path, "https://yanko.test").href,
        mode: options.mode ?? "cors",
        headers: new Headers(options.headers),
      },
      respondWith: vi.fn(),
    };
    listeners.fetch(event);
    return event;
  }
  return { cache, fetch, dispatch };
}

describe("PWA worker privacy and offline policy", () => {
  it.each([
    "/api/chat",
    "/auth/callback?code=secret",
    "/chat",
    "/me",
    "/install",
    "/login",
    "https://other.test/icons/icon-192.png",
  ])("does not intercept or cache private or non-static request %s", (path) => {
    const { dispatch, fetch } = workerHarness();
    expect(dispatch(path).respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<{ method?: string; headers?: Record<string, string> }>([
    { method: "POST" },
    { headers: { authorization: "Bearer private" } },
    { headers: { "next-action": "action-id" } },
    { headers: { rsc: "1" } },
  ])(
    "passes writes and authenticated/RSC static lookalikes directly to the browser: %j",
    (options) => {
      const { dispatch } = workerHarness();
      expect(
        dispatch("/icons/icon-192.png", options).respondWith,
      ).not.toHaveBeenCalled();
    },
  );

  it("does not cache query parameters on public icon paths", () => {
    const { dispatch } = workerHarness();
    expect(
      dispatch("/icons/icon-192.png?token=secret").respondWith,
    ).not.toHaveBeenCalled();
  });

  it.each(["private", "no-store", "no-cache"])(
    "does not store a public asset response marked %s",
    async (policy) => {
      const { dispatch, fetch, cache } = workerHarness();
      const response = {
        ok: true,
        type: "basic",
        redirected: false,
        headers: new Headers({ "cache-control": policy }),
      };
      fetch.mockResolvedValue(response);
      const event = dispatch("/_next/static/chunks/app.js");
      expect(await event.respondWith.mock.calls[0][0]).toBe(response);
      expect(cache.put).not.toHaveBeenCalled();
    },
  );

  it("never stores redirected responses even when the final response is public", async () => {
    const { dispatch, fetch, cache } = workerHarness();
    fetch.mockResolvedValue({
      ok: true,
      type: "basic",
      redirected: true,
      headers: new Headers(),
    });
    await dispatch("/icons/icon-192.png").respondWith.mock.calls[0][0];
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("returns a generic uncached 503 when offline, even if the cached offline page was evicted", async () => {
    const { dispatch, fetch, cache } = workerHarness();
    fetch.mockRejectedValue(new Error("offline"));
    const response: Response = await dispatch("/chat?private=secret", {
      mode: "navigate",
    }).respondWith.mock.calls[0][0];
    expect(cache.match).toHaveBeenCalledWith("/offline.html");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("暂时无法连接网络");
    expect(body).not.toContain("secret");
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("uses only the generic offline document on a failed auth navigation", async () => {
    const { dispatch, fetch, cache } = workerHarness();
    fetch.mockRejectedValue(new Error("offline"));
    cache.match.mockResolvedValue(new Response("<h1>暂时无法连接网络</h1>"));
    const response: Response = await dispatch("/auth/callback?code=secret", {
      mode: "navigate",
    }).respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("<h1>暂时无法连接网络</h1>");
    expect(cache.put).not.toHaveBeenCalled();
  });
});
