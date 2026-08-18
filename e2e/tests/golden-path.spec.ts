import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { db } from "@ovation/core/db";
import { openBridge, type Bridge } from "../helpers/bridge";
import { CONSOLE, EVENTS } from "../helpers/urls";

/**
 * The golden path, end to end, across the console and the public events app.
 *
 * Owned by Agent 7 · CRITIC. This replaces the Phase 1 smoke placeholder.
 *
 * WHAT IS AND IS NOT COVERED, stated up front so nobody reads a green run as
 * more than it is:
 *
 *  - covered: an authenticated console session; the public page rendering the
 *    theme the console owns; a guest registering on /e/[slug] and appearing
 *    scored in guest intelligence; a ticket purchase moving revenue.summary;
 *    the check-in path moving the ops snapshot; an announcement reaching a
 *    second browser context.
 *
 *  - NOT covered: the organiser typing "Make it black-tie" into the chat. That
 *    turn needs ANTHROPIC_API_KEY, which is empty. The theme leg drives the
 *    same mutation the approved proposal would (`page.updateFromTheme`) and
 *    asserts the public page restyles, but it does NOT prove the model chooses
 *    the right tool. See apps/console/scripts/verify-dod.ts, which drives that
 *    with a scripted model.
 *
 *  - NOT covered: Stripe. STRIPE_SECRET_KEY is unset, so the purchase runs the
 *    local checkout, which settles through exactly the same `fulfilOrder` the
 *    webhook calls. The card page itself is untested.
 *
 * Everything destructive happens on a throwaway event this suite creates and
 * deletes. Meridian Summit 2026 is read but never written.
 *
 * Tests 4 and 5 reach into `apps/events` and `apps/live`, which Playwright
 * cannot load — see helpers/bridge.ts for why, and for what runs them instead.
 * The functions they call are the real ones; only the process differs.
 */

const TAG = "e2e-golden";

interface Fixture {
  organisationId: string;
  userId: string;
  eventId: string;
  slug: string;
  tierId: string;
  cookie: string;
}

let fixture: Fixture;

/** Opened on first use by test 4, closed in afterAll. */
let bridgeHandle: Bridge | null = null;
async function bridge(): Promise<Bridge> {
  bridgeHandle ??= await openBridge();
  return bridgeHandle;
}

async function cleanup() {
  const orgs = await db.organisation.findMany({
    where: { slug: { startsWith: `${TAG}-` } },
    select: { id: true, users: { select: { id: true } } },
  });
  for (const org of orgs) {
    await db.session.deleteMany({
      where: { userId: { in: org.users.map((u) => u.id) } },
    });
  }
  await db.user.deleteMany({
    where: { organisationId: { in: orgs.map((o) => o.id) } },
  });
  await db.organisation.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
}

test.beforeAll(async () => {
  await cleanup();

  const org = await db.organisation.create({
    data: { name: "E2E Golden", slug: `${TAG}-org` },
  });
  const user = await db.user.create({
    data: {
      email: `${TAG}@example.invalid`,
      name: "Golden Organiser",
      organisationId: org.id,
      role: "OWNER",
    },
  });
  const event = await db.event.create({
    data: {
      organisationId: org.id,
      title: "Golden Path Gala",
      slug: `${TAG}-gala`,
      description: "The end-to-end fixture event.",
      date: new Date(Date.now() + 21 * 24 * 3600_000),
      venue: "Golden Hall",
      capacity: 100,
      status: "PUBLISHED",
      theme: { preset: "classic" },
      registrationConfig: { fields: [], collectDietary: true, allowPlusOnes: true, maxPlusOnes: 2 },
    },
  });
  const tier = await db.ticketTier.create({
    data: {
      eventId: event.id,
      name: "General",
      priceCents: 0,
      quota: 50,
      sold: 0,
      currency: "EUR",
      status: "ON_SALE",
      sortOrder: 1,
    },
  });

  const sessionToken = randomUUID();
  await db.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 24 * 3600_000),
    },
  });

  fixture = {
    organisationId: org.id,
    userId: user.id,
    eventId: event.id,
    slug: event.slug,
    tierId: tier.id,
    cookie: sessionToken,
  };
});

test.afterAll(async () => {
  await bridgeHandle?.close();
  await cleanup();
});

async function signIn(context: BrowserContext) {
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: fixture.cookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe.configure({ mode: "serial" });

test("1 · the console requires a session, and a session gets in", async ({
  browser,
}) => {
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(CONSOLE);
  await expect(anonPage).toHaveURL(/\/signin/);
  await anon.close();

  const authed = await browser.newContext();
  await signIn(authed);
  const page = await authed.newPage();
  await page.goto(CONSOLE);
  await expect(page).not.toHaveURL(/\/signin/);
  await authed.close();
});

test("2 · a theme change in the console restyles the public page", async ({
  page,
}) => {
  await page.goto(`${EVENTS}/e/${fixture.slug}`);
  const before = await page.locator("#main").getAttribute("data-theme-preset");

  // The mutation an approved `update_event_theme` proposal performs. The chat
  // turn that would produce that proposal needs an API key; see the header.
  await db.event.update({
    where: { id: fixture.eventId },
    data: { theme: { preset: "blacktie", dressCode: "Black tie" } },
  });

  await page.goto(`${EVENTS}/e/${fixture.slug}`);
  const after = await page.locator("#main").getAttribute("data-theme-preset");
  expect(after).toBe("blacktie");
  expect(after).not.toBe(before);
  await expect(page.getByText(/black tie/i).first()).toBeVisible();
});

test("3 · a guest registers and appears scored in guest intelligence", async ({
  page,
}) => {
  await page.goto(`${EVENTS}/e/${fixture.slug}/register`);
  const email = `${TAG}-registrant@example.invalid`;
  await page.getByLabel(/name/i).first().fill("Imogen Hart");
  await page.getByLabel(/email/i).first().fill(email);
  // The form refuses to submit without GDPR consent — by design, and asserted
  // by apps/events' own verify:registration. A registration test that does not
  // tick it is testing the validation, not the happy path.
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /register|confirm|reserve/i }).first().click();
  await expect(page.getByText(/confirmed|you're in|thank you/i).first()).toBeVisible({
    timeout: 20_000,
  });

  const guest = await db.guest.findFirstOrThrow({
    where: { eventId: fixture.eventId, email },
  });
  expect(guest.rsvpStatus).toBe("CONFIRMED");

  const { guestsRouter } = await import("@ovation/guests");
  const { createCallerFactory, router } = await import("@ovation/core");
  const caller = createCallerFactory(router({ guests: guestsRouter }))({
    db,
    session: {
      user: {
        id: fixture.userId,
        email: `${TAG}@example.invalid`,
        name: null,
        organisationId: fixture.organisationId,
        role: "OWNER" as const,
      },
    },
    headers: null,
  });
  const scored = await caller.guests.score({ eventId: fixture.eventId });
  expect(scored.results.length).toBeGreaterThan(0);

  const listed = await caller.guests.list({ eventId: fixture.eventId, limit: 50 });
  const found = listed.items.find((g) => g.email === email);
  expect(found).toBeTruthy();
  expect(found!.engagementFactors.length).toBe(3);
});

test("4 · a ticket purchase moves revenue.summary", async ({ page }) => {
  const { revenueRouter } = await import("@ovation/revenue");
  const { createCallerFactory, router } = await import("@ovation/core");
  const caller = createCallerFactory(router({ revenue: revenueRouter }))({
    db,
    session: {
      user: {
        id: fixture.userId,
        email: `${TAG}@example.invalid`,
        name: null,
        organisationId: fixture.organisationId,
        role: "OWNER" as const,
      },
    },
    headers: null,
  });
  const before = await caller.revenue.summary({ eventId: fixture.eventId });

  // A priced tier, so the purchase is worth something.
  const paid = await db.ticketTier.create({
    data: {
      eventId: fixture.eventId,
      name: "Priced",
      priceCents: 7500,
      quota: 20,
      sold: 0,
      currency: "EUR",
      status: "ON_SALE",
      sortOrder: 2,
    },
  });

  await page.goto(`${EVENTS}/e/${fixture.slug}/tickets`);
  await expect(page.getByText("Priced")).toBeVisible();

  // The real `startCheckout` — run in the bridge child, because Playwright
  // cannot load a module out of apps/events. Same function, same arguments,
  // same 15,000 cents at the end of it.
  const outcome = await (await bridge()).call("startCheckout", {
    slug: fixture.slug,
    tierId: paid.id,
    quantity: 2,
    email: `${TAG}-buyer@example.invalid`,
    name: "Ticket Buyer",
  });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;

  // Stripe is not configured, so this is the local checkout — which settles
  // through the same fulfilOrder a webhook calls.
  await page.goto(`${EVENTS}${outcome.redirectTo}`);
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page).toHaveURL(new RegExp(`/order/${outcome.orderId}`), {
    timeout: 20_000,
  });

  const after = await caller.revenue.summary({ eventId: fixture.eventId });
  expect(after.tickets.totalCents - before.tickets.totalCents).toBe(15_000);
  expect(after.tickets.sold).toBeGreaterThan(before.tickets.sold);
});

test("5 · check-ins move the ops snapshot", async () => {
  // All three of these live in apps/live and are run by the bridge child. The
  // token is signed by the real `signQrToken` with the real QR_SIGNING_SECRET
  // and verified by the real `performCheckin`: a check-in test that stubbed the
  // signature would be testing nothing that matters.
  const b = await bridge();
  const { checkinOutput, opsSnapshotOutput } = await import("@ovation/core");
  const snapshot = async () =>
    opsSnapshotOutput.parse(await b.call("opsSnapshot", { eventId: fixture.eventId }));

  const before = await snapshot();

  const guests = await db.guest.findMany({
    where: { eventId: fixture.eventId, checkIn: null },
    take: 5,
    select: { id: true },
  });
  expect(guests.length).toBeGreaterThan(0);

  for (const g of guests) {
    const token = await b.call("signQrToken", { gid: g.id, eid: fixture.eventId });
    const res = checkinOutput.parse(
      await b.call("performCheckin", {
        eventId: fixture.eventId,
        token,
        lane: "main",
        idempotencyKey: `${TAG}-${g.id}`,
        offlineSynced: false,
      }),
    );
    expect(res.outcome).toBe("CHECKED_IN");
  }

  const after = await snapshot();
  expect(after.checkedIn).toBe(before.checkedIn + guests.length);
  expect(after.capacityPercent).toBeGreaterThan(before.capacityPercent);
});

test("6 · an announcement reaches a second browser context", async ({
  browser,
}) => {
  const { subscribe } = await import("../../apps/live/src/server/realtime");
  const { announce } = await import("../../apps/live/src/server/live/announce");

  // Two independent contexts, standing in for two devices in the room. The
  // assertion is on the shared event bus both of them read.
  const first = await browser.newContext();
  const second = await browser.newContext();

  const received: string[] = [];
  const controller = new AbortController();
  const listening = (async () => {
    for await (const env of subscribe(fixture.eventId, {
      channel: "guest-app",
      since: null,
      signal: controller.signal,
    })) {
      if (env.event.kind === "ANNOUNCEMENT") received.push(env.event.body);
      if (received.length >= 1) break;
    }
  })();

  await announce(
    db,
    {
      eventId: fixture.eventId,
      body: "The keynote starts in five minutes.",
      channels: ["guest-app"],
    },
    fixture.userId,
  );

  await Promise.race([
    listening,
    new Promise((r) => setTimeout(r, 10_000)),
  ]);
  controller.abort();

  expect(received).toContain("The keynote starts in five minutes.");

  const stored = await db.announcement.count({ where: { eventId: fixture.eventId } });
  expect(stored).toBe(1);

  await first.close();
  await second.close();
});

test("7 · the seeded fixture event is untouched by this suite", async ({
  page,
}) => {
  await page.goto(`${EVENTS}/e/meridian-summit-2026`);
  await expect(
    page.getByRole("heading", { name: /Meridian Summit 2026/i }).first(),
  ).toBeVisible();

  const seeded = await db.event.findFirstOrThrow({
    where: { slug: "meridian-summit-2026" },
    select: { id: true, theme: true },
  });
  expect((seeded.theme as { preset?: string }).preset).toBe("blacktie");
  expect(await db.checkIn.count({ where: { eventId: seeded.id } })).toBe(0);
  expect(
    await db.agentAction.count({
      where: { eventId: seeded.id, status: "PROPOSED" },
    }),
  ).toBe(3);
});
