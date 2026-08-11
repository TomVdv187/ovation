import { defineConfig, devices } from "@playwright/test";

/**
 * Owned by Agent 7 · CRITIC. The golden path spans three apps, so the config
 * starts all of them and addresses each by base URL in the specs.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.CONSOLE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: "pnpm --filter @ovation/console dev",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: "pnpm --filter @ovation/events dev",
          url: "http://localhost:3001",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
