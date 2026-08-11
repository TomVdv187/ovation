import { expect, test } from "@playwright/test";

/**
 * Phase 1 smoke: the scaffold boots and auth guards the console.
 * Agent 7 · CRITIC replaces this with the golden-path suite.
 */

test("console redirects an anonymous visitor to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("public events app renders the seeded event", async ({ page }) => {
  await page.goto(process.env.EVENTS_URL ?? "http://localhost:3001");
  await expect(
    page.getByRole("heading", { name: "Meridian Summit 2026" }),
  ).toBeVisible();
});
