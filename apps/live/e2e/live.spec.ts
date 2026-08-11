import { expect, test, type Page } from "@playwright/test";
import {
  checkedInCount,
  checkinOverHttp,
  doorList,
  resetEvent,
  type DoorGuest,
} from "./helpers";

/**
 * The two claims that only a browser can settle.
 */

let eventId: string;

test.beforeAll(async () => {
  const list = await doorList();
  eventId = list.event.id;
  await resetEvent(eventId);
});

test("arrivals drive the ops wall and a host's phone at the same time", async ({
  browser,
}) => {
  // Two contexts, not two tabs: separate storage, separate sockets — the same
  // isolation two people holding two devices have.
  const opsCtx = await browser.newContext();
  const hostCtx = await browser.newContext();
  const ops = await opsCtx.newPage();
  const host = await hostCtx.newPage();

  await ops.goto(`/live/${eventId}/ops`);
  await host.goto(`/live/${eventId}/host`);

  // Both must be actually subscribed before anything is sent, otherwise this
  // would pass on the snapshot query alone and prove nothing about realtime.
  await expect(ops.getByText("live", { exact: true })).toBeVisible();
  await expect(host.getByText(/feed live/)).toBeVisible();

  const before = await checkedInCount(eventId);

  const list = await doorList(eventId);
  const vip = pick(list.guests, (g) => g.segment === "VIP" && !g.checkedInAt);
  const others = list.guests
    .filter((g) => !g.checkedInAt && g.id !== vip.id && g.segment !== "VIP")
    .slice(0, 4);

  for (const g of others) {
    expect(await checkinOverHttp({ eventId, guestId: g.id })).toBe("CHECKED_IN");
  }
  expect(await checkinOverHttp({ eventId, guestId: vip.id })).toBe("CHECKED_IN");

  // Ops: the counter moved, and the feed named the people who walked in.
  await expect(heroCount(ops)).toHaveText(String(before + others.length + 1));
  for (const g of others.slice(0, 2)) {
    await expect(ops.getByText(g.name, { exact: false }).first()).toBeVisible();
  }
  await expect(ops.getByText(vip.name).first()).toBeVisible();

  // Host: the VIP alert, with the greeting card the greeter reads out.
  await expect(host.getByText(vip.name).first()).toBeVisible();
  await expect(host.getByRole("button", { name: "Mark greeted" })).toBeVisible();

  // Exactly one alert, from five arrivals. The host channel receives every
  // CHECKIN, but only a VIP is worth interrupting someone mid-conversation.
  await expect(
    host.getByRole("button", { name: "Mark greeted" }),
  ).toHaveCount(1);
  for (const g of others) {
    await expect(host.getByText(g.name)).toHaveCount(0);
  }

  await opsCtx.close();
  await hostCtx.close();
});

test("a scan taken in a dead-zone syncs on reconnect and does not double-count", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const door = await ctx.newPage();

  await door.goto(`/live/${eventId}/door`);

  // Wait until the door list is cached on the device — that cache is what
  // makes the dead-zone survivable.
  await expect(door.getByText(/on the list/)).toBeVisible();
  await door.waitForFunction(
    () => !/· 0 on the list/.test(document.body.innerText),
    undefined,
    { timeout: 20_000 },
  );

  const list = await doorList(eventId);
  const guest = pick(list.guests, (g) => !g.checkedInAt);
  const before = await checkedInCount(eventId);

  // ── kill the network ──────────────────────────────────────
  await ctx.setOffline(true);
  await door.waitForFunction(() => navigator.onLine === false);

  await door.getByRole("button", { name: "Door list" }).click();
  await door.getByPlaceholder("Name, company or email").fill(guest.name);
  await door.getByRole("button", { name: new RegExp(escape(guest.name)) }).click();

  // Answered locally, marked unverified, and queued.
  await expect(door.getByText("Saved offline")).toBeVisible();
  await expect(door.getByText(/Unverified/)).toBeVisible();
  await door.getByText("Saved offline").click();
  await expect(door.getByText("Offline")).toBeVisible();
  await expect(door.getByRole("button", { name: /Sync 1/ })).toBeVisible();

  // Nothing reached the server while the tunnel was dark.
  expect(await checkedInCount(eventId)).toBe(before);

  // ── signal returns ────────────────────────────────────────
  await ctx.setOffline(false);
  await door.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(door.getByRole("button", { name: /Sync/ })).toBeHidden({
    timeout: 30_000,
  });
  await expect(door.getByText("Online")).toBeVisible();

  expect(await checkedInCount(eventId)).toBe(before + 1);

  // ── replay ────────────────────────────────────────────────
  // The same scan applied a second time. The count must not move, and the
  // answer must be ALREADY_CHECKED_IN rather than an error.
  expect(
    await checkinOverHttp({
      eventId,
      guestId: guest.id,
      idempotencyKey: `replay-${guest.id}`,
    }),
  ).toBe("ALREADY_CHECKED_IN");
  expect(
    await checkinOverHttp({
      eventId,
      guestId: guest.id,
      idempotencyKey: `replay-${guest.id}`,
    }),
  ).toBe("ALREADY_CHECKED_IN");
  expect(await checkedInCount(eventId)).toBe(before + 1);

  // The door itself refuses to queue the same guest twice.
  await door.getByRole("button", { name: "Door list" }).click();
  await door.getByPlaceholder("Name, company or email").fill(guest.name);
  await expect(
    door.getByRole("button", { name: new RegExp(escape(guest.name)) }),
  ).toBeDisabled();

  await ctx.close();
});

test("an announcement reaches a connected client in under a second", async ({
  browser,
}) => {
  const opsCtx = await browser.newContext();
  const hostCtx = await browser.newContext();
  const ops = await opsCtx.newPage();
  const host = await hostCtx.newPage();

  await ops.goto(`/live/${eventId}/ops`);
  await host.goto(`/live/${eventId}/host`);
  await expect(ops.getByText("live", { exact: true })).toBeVisible();
  await expect(host.getByText(/feed live/)).toBeVisible();

  const body = `Dinner is served in the Salon Horta. ${Date.now()}`;
  await ops.getByPlaceholder("Dinner is served in the Salon Horta.").fill(body);

  const started = Date.now();
  await ops.getByRole("button", { name: "Push now" }).click();
  await expect(host.getByText(body)).toBeVisible({ timeout: 5_000 });
  const elapsed = Date.now() - started;

  // Includes the click, the round trip, the socket and the host's render.
  expect(elapsed).toBeLessThan(1_000);

  // And the count is measured, not the guest list: at least the host we opened.
  await expect(ops.getByText(/Delivered to/)).toBeVisible();
  const delivered = await ops
    .getByText(/Delivered to/)
    .innerText()
    .then((t) => Number(/(\d+)/.exec(t)?.[1] ?? 0));
  expect(delivered).toBeGreaterThanOrEqual(1);

  await opsCtx.close();
  await hostCtx.close();
});

function pick(
  guests: DoorGuest[],
  predicate: (g: DoorGuest) => boolean,
): DoorGuest {
  const found = guests.find(predicate);
  if (!found) throw new Error("No guest matches — reseed the database.");
  return found;
}

/** The seed has names like "De Smet"; regex-escape before matching on them. */
function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function heroCount(page: Page) {
  return page.locator("p", { hasText: /^\d+$/ }).first();
}
