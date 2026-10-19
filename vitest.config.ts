import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const srcDirectory = new URL("./src/", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": srcDirectory,
      "server-only": new URL("./src/test/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "evals/**/*.test.mjs"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
