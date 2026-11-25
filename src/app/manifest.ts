import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Yanko · 言行",
    short_name: "Yanko",
    description: "一个能持续理解你、陪你聊天，也帮你把想法变成行动的 AI 伙伴。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F5F3F9",
    theme_color: "#F5F3F9",
    lang: "zh-CN",
    categories: ["productivity", "lifestyle"],
    icons: [
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
    ],
  };
}
