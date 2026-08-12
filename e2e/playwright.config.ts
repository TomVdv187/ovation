import { defineConfig, devices } from "@playwright/test";

/**
 * Owned by Agent 7 · CRITIC. The golden path spans three apps, so the config
 * starts all of them and addresses each by base URL in the specs.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Next dev compiles a route on its FIRST request, and `/e/[slug]` pulls in
  // the whole themed page. That can take well over Playwright's 30s default on
  // a cold server, which shows up as a page.goto timeout that looks like a
  // product bug and is not one. Generous here; the assertions have their own
  // expect timeout.
  timeout: 120_000,
  expect: { timeout: 15_000 },
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
  /**
   * Production servers, not `next dev`.
   *
   * Two dev servers hold ~600 MB each and compile routes on first request; with
   * a browser alongside they exhaust the machine and the run dies with
   * "JavaScript heap out of memory" from the WebServer process — which reads as
   * a product failure and is not one. `next start` serves the prebuilt output,
   * so it is far lighter, has no first-hit compile, and is what actually
   * deploys. Run `pnpm build` first (the command below does).
   *
   * Set E2E_NO_SERVER=1 to drive servers you started yourself.
   */
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: "pnpm --filter @ovation/console build && pnpm --filter @ovation/console start",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
        },
        {
          command: "pnpm --filter @ovation/events build && pnpm --filter @ovation/events start",
          url: "http://localhost:3001",
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
        },
      ],
});
