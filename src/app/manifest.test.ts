import { describe, expect, it } from "vitest";

import manifest from "./manifest";

describe("PWA manifest", () => {
  it("declares a standalone Chinese app with public install icons", () => {
    expect(manifest()).toMatchObject({
      id: "/",
      name: "言行",
      short_name: "言行",
      start_url: "/chat",
      scope: "/",
      display: "standalone",
      background_color: "#F5F3F9",
      theme_color: "#F5F3F9",
      lang: "zh-CN",
    });
    expect(manifest().icons).toEqual([
      {
        src: "/pwa/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
    ]);
  });
});
