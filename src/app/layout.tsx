import type { Metadata, Viewport } from "next";

import "@fontsource-variable/noto-sans-sc";
import "./globals.css";
import { DemoAppearance } from "@/modules/demo/demo-appearance";

import { PwaClient } from "./pwa-client";

export const metadata: Metadata = {
  title: {
    default: "言行",
    template: "%s · 言行",
  },
  description: "一个能持续理解你、陪你聊天，也帮你把想法变成行动的 AI 伙伴。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F3F9",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <DemoAppearance />
        <PwaClient />
        {children}
      </body>
    </html>
  );
}
