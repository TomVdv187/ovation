/**
 * Agent 7 · CRITIC — the integration check the five agents could not run.
 *
 * Every one of them verified its own router in isolation. Nobody could call a
 * router they did not own, because none were mounted. This calls all six
 * through ONE composed console router, in the order a real evening goes, and
 * checks the seeded numbers that other agents assert against.
 *
 * Read-only against Meridian Summit 2026 except where marked; the destructive
 * half runs on the critic rig.
 */
import {
  createAppRouter,
  createCallerFactory,
  type Context,
} from "@ovation/core";
import { db } from "@ovation/core/db";
import { pageRouter } from "@ovation/events/page-router";
import { guestsRouter } from "@ovation/guests";
import { liveRouter } from "@ovation/live/live-router";
import { revenueRouter } from "@ovation/revenue";
import { agentRouter } from "../src/server/routers/agent";
import { eventRouter } from "../src/server/routers/event";
import { bad, ctxFor, note, ok, setup, teardown } from "../../../scripts/critic/rig";

const appRouter = createAppRouter({
  event: eventRouter,
  agent: agentRouter,
  page: pageRouter,
  guests: guestsRouter,
  revenue: revenueRouter,
  live: liveRouter,
});
const call = createCallerFactory(appRouter);

async function main() {
  // ── I · the seeded event, through the console router ────────────────
  const seeded = await db.event.findFirstOrThrow({
    where: { slug: "meridian-summit-2026" },
    select: { id: true, organisationId: true, slug: true },
  });
  const user = await db.user.findFirstOrThrow({
    where: { organisationId: seeded.organisationId },
    select: { id: true },
  });
  const api = call(ctxFor(user.id, seeded.organisationId) as unknown as Context);

  console.log("\nI · every mounted router answers through the console");
  {
    const checks: Array<[string, () => Promise<unknown>]> = [
      ["event.get", () => api.event.get({ id: seeded.id })],
      ["agent.actions", () => api.agent.actions({ eventId: seeded.id, limit: 5 })],
      ["page.render", () => api.page.render({ slug: seeded.slug, preview: false })],
      ["guests.list", () => api.guests.list({ eventId: seeded.id, limit: 5 })],
      ["revenue.summary", () => api.revenue.summary({ eventId: seeded.id })],
      ["live.ops", () => api.live.ops({ eventId: seeded.id })],
      ["live.matchmaking", () => api.live.matchmaking({ eventId: seeded.id, limit: 5 })],
    ];
    for (const [name, run] of checks) {
      try {
        await run();
        ok(`I1 ${name}`);
      } catch (e) {
        const code = (e as { code?: string }).code ?? "";
        bad(`I1 ${name}`, `${code} ${(e as Error).message.slice(0, 120)}`);
      }
    }
  }

  console.log("\nJ · the seeded numbers, read through the contract");
  {
    const summary = await api.revenue.summary({ eventId: seeded.id });
    const tickets = summary.tickets.totalCents;
    if (tickets === 2_814_000) ok("J1 ticket revenue", "EUR 28,140");
    else bad("J1 ticket revenue", `${tickets} cents`);

    const sponsors = summary.sponsors.totalCents;
    if (sponsors === 2_450_000) ok("J2 sponsor revenue", "EUR 24,500");
    else bad("J2 sponsor revenue", `${sponsors} cents`);

    const guests = await api.guests.list({ eventId: seeded.id, limit: 200 });
    if (guests.total === 200) ok("J3 200 guests through guests.list");
    else bad("J3 200 guests through guests.list", String(guests.total));

    const dotTest = guests.items.filter((g) => g.email.includes(".test"));
    if (dotTest.length === 0) ok("J4 no .test emails");
    else bad("J4 no .test emails", `${dotTest.length}`);

    const ops = await api.live.ops({ eventId: seeded.id });
    if (ops.checkedIn === 0) ok("J5 zero check-ins on the seeded event");
    else bad("J5 zero check-ins on the seeded event", String(ops.checkedIn));

    const proposed = await api.agent.actions({
      eventId: seeded.id,
      status: "PROPOSED",
      limit: 50,
    });
    if (proposed.items.length === 3) ok("J6 three open PROPOSED proposals");
    else bad("J6 three open PROPOSED proposals", String(proposed.items.length));

    const page = await api.page.render({ slug: seeded.slug, preview: false });
    if (page.theme.preset === "blacktie") ok("J7 theme.preset is blacktie");
    else bad("J7 theme.preset is blacktie", String(page.theme.preset));

    // CC-003: the public tier projection.
    if (page.tiers.length === 3) ok("J8 page.render carries the tiers", `${page.tiers.length}`);
    else bad("J8 page.render carries the tiers", String(page.tiers.length));
    const leaks = page.tiers.some(
      (t) => "sold" in t || "quota" in t || "status" in t,
    );
    if (!leaks) ok("J9 no sell-through on the public projection");
    else bad("J9 no sell-through on the public projection", JSON.stringify(page.tiers[0]));
  }

  // ── K · cross-agent flows that only exist once everything is mounted ─
  console.log("\nK · cross-agent flows");
  {
    const rig = await setup();
    const rigApi = call(ctxFor(rig.userA, rig.orgA) as unknown as Context);

    // K1 · live.matchmaking reads guests through ORACLE's contract. Before the
    // Phase 3 peers fix this threw NOT_IMPLEMENTED naming Agent 3.
    const { signQrToken } = await import("../../live/src/server/live/qr");
    for (const gid of rig.guestsA.slice(0, 4)) {
      const token = await signQrToken({ gid, eid: rig.eventA });
      await rigApi.live.checkin({
        eventId: rig.eventA,
        token,
        lane: "main",
        idempotencyKey: `critic-int-${gid}`,
        offlineSynced: false,
      });
    }
    try {
      const matches = await rigApi.live.matchmaking({ eventId: rig.eventA, limit: 5 });
      ok("K1 live.matchmaking resolves guests.list", `${matches.matches.length} match(es)`);

      // K2 · CC-007: marking an introduction survives a reload.
      const first = matches.matches[0];
      if (first) {
        await rigApi.live.markIntroduced({
          eventId: rig.eventA,
          guestId: rig.guestsA[0]!,
          withGuestId: first.guestId,
        });
        const rows = await db.introduction.count({ where: { eventId: rig.eventA } });
        if (rows === 1) ok("K2 CC-007 introduction persisted", `${rows} row`);
        else bad("K2 CC-007 introduction persisted", String(rows));

        // Idempotent, and order-independent.
        await rigApi.live.markIntroduced({
          eventId: rig.eventA,
          guestId: first.guestId,
          withGuestId: rig.guestsA[0]!,
        });
        const rows2 = await db.introduction.count({ where: { eventId: rig.eventA } });
        if (rows2 === 1) ok("K2 reversed pair does not duplicate");
        else bad("K2 reversed pair does not duplicate", String(rows2));
      } else {
        note("K2", "no matches to introduce");
      }
    } catch (e) {
      bad(
        "K1 live.matchmaking resolves guests.list",
        `${(e as { code?: string }).code} ${(e as Error).message.slice(0, 140)}`,
      );
    }

    // K3 · CC-008: cue configuration persists.
    {
      const { getCues, setCues } = await import("../../live/src/server/live/cues");
      const seededCues = await getCues(db, rig.eventA);
      if (seededCues.length === 3) ok("K3 default cues seeded on first read", "3");
      else bad("K3 default cues seeded on first read", String(seededCues.length));

      const disabled = seededCues.map((c) => ({ ...c, enabled: false }));
      await setCues(db, rig.eventA, disabled);
      const reread = await getCues(db, rig.eventA);
      if (reread.every((c) => !c.enabled)) ok("K3 disabling a cue survives a re-read");
      else bad("K3 disabling a cue survives a re-read", JSON.stringify(reread.map((c) => c.enabled)));

      const rows = await db.cue.count({ where: { eventId: rig.eventA } });
      if (rows === 3) ok("K3 cues are rows, not a Map", `${rows}`);
      else bad("K3 cues are rows, not a Map", String(rows));
    }

    // K4 · CC-009: the channel travels on the input.
    {
      const { parseChannel } = await import("../../live/src/lib/channels");
      const cases: Array<[unknown, string]> = [
        ["screens", "screens"],
        ["door", "door"],
        ["nonsense", "ops"],
        [null, "ops"],
      ];
      let allOk = true;
      for (const [input, want] of cases) {
        const got = parseChannel(input as string | null, "ops");
        if (got !== want) {
          allOk = false;
          bad("K4 channel parsing", `${String(input)} -> ${got}, wanted ${want}`);
        }
      }
      if (allOk) ok("K4 CC-009 channel parsing", `${cases.length} cases`);
    }

    // K5 · announce respects channels.
    {
      const res = await rigApi.live.announce({
        eventId: rig.eventA,
        body: "Doors close in five minutes.",
        channels: ["guest-app"],
      });
      note("K5 announce delivery", `deliveredCount=${res.deliveredCount}`);
      const stored = await db.announcement.count({ where: { eventId: rig.eventA } });
      if (stored === 1) ok("K5 announcement persisted", "1");
      else bad("K5 announcement persisted", String(stored));
    }

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
