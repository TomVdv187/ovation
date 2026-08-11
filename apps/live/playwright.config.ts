import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the two claims that only a browser can settle: that the
 * ops wall and a host's phone both come alive from the same traffic, and that
 * a scan taken in a dead-zone survives it.
 *
 * These run against a real server and a real database — no mocked harness.
 * If the app is already running on the port they use it; otherwise they start
 * it and shut it down afterwards.
 */
export default defineConfig({
  webServer: {
    command: "pnpm dev",
    url: process.env.SIM_URL ?? "http://127.0.0.1:3002",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.SIM_URL ?? "http://127.0.0.1:3002",
    trace: "retain-on-failure",
    launchOptions: {
      // The door opens a camera on mount. Give it a fake one so the scanner
      // reaches its normal "scanning" state instead of a permission error —
      // the tests drive check-ins through the door list and over HTTP.
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], permissions: ["camera"] },
    },
  ],
});
