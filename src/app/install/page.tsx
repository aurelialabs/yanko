import type { Metadata } from "next";

import { InstallInstructions } from "../pwa-client";

export const metadata: Metadata = {
  title: "添加到 iPhone 主屏幕",
  description: "通过 Safari 将言行添加到 iPhone 主屏幕的操作说明。",
};

export default function InstallPage() {
  return <InstallInstructions />;
}
