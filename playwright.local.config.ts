import { execFileSync } from "node:child_process";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

process.env.YANKO_NEXT_DIST_DIR = ".next-local-e2e";

/**
 * Local-only browser regressions need the same server-only deletion credential
 * as the application. Derive it at runtime from the loopback Supabase CLI
 * rather than committing it, exposing it to page code, or reading any remote
 * environment. A missing local container remains an ordinary test failure.
 */
function readLocalServiceRoleKey(): string | undefined {
  const configured = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (configured) return configured;

  try {
    const executable = path.join(
      process.cwd(),
      "node_modules",
      "supabase",
      "dist",
      "supabase.js",
    );
    const output = execFileSync(process.execPath, [executable, "status", "-o", "env"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const match = output.match(/^SERVICE_ROLE_KEY=['"]?([^'"\r\n]+)['"]?$/m);
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const localServiceRoleKey = readLocalServiceRoleKey();

export default defineConfig({
  testDir: "./tests/local-e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "html",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3002",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "local-supabase-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npx next start --port 3002",
    url: "http://localhost:3002/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      AI_CHAT_RUNTIME_MODE: "mock",
      AUTH_RATE_LIMIT_PEPPER: "local-playwright-rate-limit-pepper",
      NEXT_PUBLIC_APP_URL: "http://localhost:3002",
      ...(localServiceRoleKey
        ? { SUPABASE_SERVICE_ROLE_KEY: localServiceRoleKey }
        : {}),
    },
  },
});
