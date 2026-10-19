import { defineConfig, devices } from "@playwright/test";

process.env.YANKO_NEXT_DIST_DIR = ".next-e2e";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3102",
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run build && npx next start --port 3102",
    url: "http://127.0.0.1:3102/login",
    reuseExistingServer: false,
    timeout: 180_000,
    // Preserve deterministic Figma-shell coverage even when a developer has
    // configured a real local Supabase instance in .env.local. Authenticated
    // database flows have their own integration coverage and must not leak
    // test state into this isolated visual suite.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});
