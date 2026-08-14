/**
 * METRONOME — does a cue stay fired across a restart?
 *
 *   pnpm --filter @ovation/live exec dotenv -e ../../.env -- tsx scripts/critic-cues.ts
 *
 * The bug this exists for is invisible in a single long-lived process, which is
 * exactly why it survived the Critic's pass: the fired marker was a Map in
 * module scope, and inside one `pnpm dev` it behaves perfectly. It only breaks
 * when the process goes away — a redeploy, a crash, a serverless instance
 * recycling — and then every cue that already fired is armed again.
 *
 * A test cannot restart the process, so it does the equivalent: it asks the
 * database what it knows, which is the only thing a new process would have.
 * Under the old in-memory implementation the database knew nothing, so these
 * checks fail on that code and pass on this.
 *
 * Runs against the critic rig's throwaway event A, never Meridian Summit 2026.
 */
import { db } from "@ovation/core/db";
import { bad, ok, setup, teardown } from "../../../scripts/critic/rig";
import { getCues, onCheckin, resetFired } from "../src/server/live/cues";

/** What a freshly started process would see: nothing but the database. */
async function firedAccordingToDb(eventId: string): Promise<number> {
  return db.cue.count({ where: { eventId, firedAt: { not: null } } });
}

async function main() {
  const rig = await setup();
  const eventId = rig.eventA;

  // Seed the default cue set and arm everything.
  const cues = await getCues(db, eventId);
  await resetFired(db, eventId);
  console.log(`\n  ${cues.length} cues on the rig event\n`);

  // ── M1 · firing is recorded in the database, not in this process ──
  {
    const before = await firedAccordingToDb(eventId);
    // A capacity cue fires when the room passes its threshold.
    await onCheckin(db, eventId, { checkedIn: 999, capacity: 1000 });
    const after = await firedAccordingToDb(eventId);

    if (after > before) {
      ok("M1 a fired cue is recorded in the database", `${after} cue(s) marked`);
    } else {
      bad(
        "M1 a fired cue is recorded in the database",
        `still ${after} — the marker did not survive the process boundary`,
      );
    }
  }

  // ── M2 · the restart ─────────────────────────────────────────────
  //
  // Re-reading the cues is what a new process does on its first tick. If the
  // marker lived in memory, this read comes back armed and the cue fires twice.
  {
    const proposalsBefore = await db.agentAction.count({
      where: { eventId, createdById: { startsWith: "cue:" } },
    });

    const reread = await getCues(db, eventId);
    const stillFired = reread.filter((c) => c.firedAt !== null).length;

    await onCheckin(db, eventId, { checkedIn: 999, capacity: 1000 });

    const proposalsAfter = await db.agentAction.count({
      where: { eventId, createdById: { startsWith: "cue:" } },
    });

    if (stillFired > 0) {
      ok("M2 a restart still sees the cue as fired", `${stillFired} cue(s)`);
    } else {
      bad("M2 a restart still sees the cue as fired", "every cue came back armed");
    }

    if (proposalsAfter === proposalsBefore) {
      ok("M2 the second tick proposed nothing", `${proposalsAfter} total`);
    } else {
      bad(
        "M2 the second tick proposed nothing",
        `${proposalsBefore} -> ${proposalsAfter}`,
      );
    }
  }

  // ── M3 · two instances racing produce one firing ──────────────────
  {
    await resetFired(db, eventId);
    await db.agentAction.deleteMany({
      where: { eventId, createdById: { startsWith: "cue:" } },
    });

    // Eight concurrent check-ins, as eight instances of the app would.
    await Promise.all(
      Array.from({ length: 8 }, () =>
        onCheckin(db, eventId, { checkedIn: 999, capacity: 1000 }).catch(() => undefined),
      ),
    );

    const proposals = await db.agentAction.groupBy({
      by: ["createdById"],
      where: { eventId, createdById: { startsWith: "cue:" } },
      _count: true,
    });
    const duplicated = proposals.filter((p) => p._count > 1);

    if (duplicated.length === 0) {
      ok(
        "M3 concurrent ticks fire each cue once",
        `${proposals.length} cue(s) proposed, none twice`,
      );
    } else {
      bad(
        "M3 concurrent ticks fire each cue once",
        duplicated.map((d) => `${d.createdById} x${d._count}`).join(", "),
      );
    }
  }

  // ── M4 · reset re-arms ───────────────────────────────────────────
  {
    await resetFired(db, eventId);
    const stillFired = await firedAccordingToDb(eventId);
    if (stillFired === 0) ok("M4 reset re-arms every cue");
    else bad("M4 reset re-arms every cue", `${stillFired} still marked`);
  }

  await teardown();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (e) => {
    console.error(e);
    await teardown().catch(() => {});
    process.exit(1);
  });
