import { execFileSync } from "node:child_process";

import { defineConfig, devices } from "@playwright/test";

process.env.YANKO_NEXT_DIST_DIR = ".next-minimax-e2e";

function readLocalServiceRoleKey(): string {
  const configured = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (configured) return configured;

  let localStatus = "";
  try {
    localStatus = execFileSync(
      process.execPath,
      [
        process.cwd() + "/node_modules/supabase/dist/supabase.js",
        "status",
        "--output",
        "env",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
  } catch {
    throw new Error(
      "MiniMax smoke requires a running local Supabase instance or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const assignment = localStatus.match(
    /^SERVICE_ROLE_KEY=(?:"([^"]+)"|'([^']+)'|([^\r\n]+))$/m,
  );
  const serviceRoleKey = assignment?.[1] ?? assignment?.[2] ?? assignment?.[3];
  if (!serviceRoleKey?.trim()) {
    throw new Error("The local Supabase service-role key is unavailable.");
  }
  return serviceRoleKey.trim();
}

function requireMiniMaxSmokeConfiguration(): void {
  if (
    process.env.MINIMAX_AI_ENABLED?.trim().toLowerCase() !== "true" ||
    !process.env.MINIMAX_AI_API_KEY?.trim() ||
    process.env.MINIMAX_AI_MODEL?.trim() !== "MiniMax-M3"
  ) {
    throw new Error(
      "MiniMax smoke configuration is incomplete. Check .env.minimax-ai.local.",
    );
  }
}

requireMiniMaxSmokeConfiguration();
process.env.SUPABASE_SERVICE_ROLE_KEY = readLocalServiceRoleKey();

export default defineConfig({
  testDir: "./tests/minimax-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "line",
  timeout: 600_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: "http://localhost:3002",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "minimax-development-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npx next start --port 3002",
    url: "http://localhost:3002/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      AI_CHAT_RUNTIME_MODE: "minimax-development",
      AUTH_RATE_LIMIT_PEPPER: "local-minimax-smoke-rate-limit-pepper",
      NEXT_PUBLIC_APP_URL: "http://localhost:3002",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  },
});
