/**
 * Buys a ticket the way a guest does: a real browser, the real form, the real
 * server action, against a running events server.
 *
 * This exists because every other proof that reservation works runs the module
 * directly under tsx. That proves the SQL. It does not prove the path a guest
 * takes — the server action, the Next server runtime, the Neon adapter as it is
 * configured inside a built app. INTEGRATION_REPORT.md risk #2 is precisely
 * that gap, and a reservation rewritten for a flash sale is exactly the kind of
 * change that could pass every script and still 500 in the app.
 *
 * Golden-path test 4 covers the same ground from Playwright, but it reaches
 * into `@ovation/events/ticketing`, and Playwright's CJS transform cannot load
 * that from an ESM workspace. This one only drives the browser, so it runs.
 *
 * Start the server first, then:
 *
 *   pnpm --filter @ovation/events build
 *   pnpm --filter @ovation/events start &
 *   pnpm --filter @ovation/e2e exec dotenv -e ../.env -- \
 *     tsx scripts/browser-purchase.ts
 *
 * Runs against the critic rig's throwaway event A, never Meridian Summit 2026.
 */
import { chromium } from "@playwright/test";
import { db } from "@ovation/core/db";
import { bad, ok, setup, teardown } from "../../scripts/critic/rig";

const EVENTS = process.env.NEXT_PUBLIC_EVENTS_URL ?? "http://localhost:3001";
const QUANTITY = 2;

async function main() {
  const rig = await setup();

  const tier = await db.ticketTier.create({
    data: {
      eventId: rig.eventA,
      name: "Browser",
      priceCents: 6500,
      quota: 5,
      sold: 0,
      currency: "EUR",
      status: "ON_SALE",
      sortOrder: 30,
    },
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Anything the server throws lands in the console before it lands in the
  // page, and a 500 here is the whole reason this script exists.
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));

  try {
    console.log(`\nBuying through ${EVENTS}/e/${rig.slugA}/tickets\n`);

    const response = await page.goto(`${EVENTS}/e/${rig.slugA}/tickets`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (response?.status() === 200) ok("the tickets page loads", "200");
    else bad("the tickets page loads", `status=${response?.status()}`);

    await page.locator(`input[name="tierId"][value="${tier.id}"]`).check();
    await page.selectOption('select[name="quantity"]', String(QUANTITY));
    await page.fill('input[name="name"]', "Browser Buyer");
    await page.fill('input[name="email"]', "browser-buyer@example.invalid");
    await page.getByRole("button", { name: /Continue to payment/ }).click();

    // Stripe is not configured here, so a successful reservation lands on the
    // local checkout page — which is the reservation's receipt.
    await page.waitForURL(/\/checkout\/[a-z0-9]+$/, { timeout: 60_000 });
    const orderId = page.url().split("/").pop()!;
    ok("the form reserved seats and moved on", orderId);

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        quantity: true,
        amountCents: true,
        buyerName: true,
        email: true,
        tierId: true,
      },
    });

    if (
      order &&
      order.status === "PENDING" &&
      order.quantity === QUANTITY &&
      order.amountCents === 6500 * QUANTITY &&
      order.buyerName === "Browser Buyer" &&
      order.tierId === tier.id
    ) {
      ok("the order row is what the guest asked for", JSON.stringify(order));
    } else {
      bad("the order row is what the guest asked for", JSON.stringify(order));
    }

    const after = await db.ticketTier.findUniqueOrThrow({
      where: { id: tier.id },
      select: { sold: true, status: true },
    });
    if (after.sold === QUANTITY) ok("the seats were taken", `sold=${after.sold}/5`);
    else bad("the seats were taken", `sold=${after.sold}`);

    // The id generated for the raw insert must be indistinguishable from one
    // Prisma would have written.
    if (/^c[0-9a-z]{24}$/.test(orderId)) ok("the order id is cuid-shaped", orderId);
    else bad("the order id is cuid-shaped", orderId);

    if (consoleErrors.length === 0) ok("no uncaught error reached the page");
    else bad("no uncaught error reached the page", consoleErrors.join(" | "));
  } finally {
    await browser.close();
    await teardown();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (e) => {
    console.error(e);
    await teardown().catch(() => {});
    process.exit(1);
  });
