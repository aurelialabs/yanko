import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "言行",
    short_name: "言行",
    description: "一个能持续理解你、陪你聊天，也帮你把想法变成行动的 AI 伙伴。",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    background_color: "#F5F3F9",
    theme_color: "#F5F3F9",
    lang: "zh-CN",
    categories: ["productivity", "lifestyle"],
    icons: [
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
    ],
  };
}
