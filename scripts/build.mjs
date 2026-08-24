import { mkdir, copyFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/code.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
});
await copyFile("src/ui.html", "dist/ui.html");
