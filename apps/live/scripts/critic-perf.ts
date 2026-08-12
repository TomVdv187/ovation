/**
 * Agent 7 · CRITIC — performance: check-in P95 under a 250-guest simulation.
 *
 * Target from the brief: P95 < 2.5 s.
 *
 * This measures `performCheckin` end to end — token verify, guest read, the
 * transactional write, the feed emit and the cue evaluation tail — against the
 * real Neon database over :443 from this machine. It is therefore a measurement
 * of THIS network path, not of a production deployment sitting next to its
 * database. Both numbers are reported: the wall-clock P95 and the same run's
 * median, because the gap between them is the interesting part.
 *
 * Runs on a throwaway event of its own, never Meridian Summit 2026.
 */
import { db } from "@ovation/core/db";
import { bad, ok, setup, teardown, TAG } from "../../../scripts/critic/rig";
import { performCheckin } from "../src/server/live/checkin";
import { signQrToken } from "../src/server/live/qr";

const GUESTS = 250;
/** Doors do not open onto 250 simultaneous people; lanes do ~8 at a time. */
const LANES = 8;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

async function main() {
  const rig = await setup();

  console.log(`\nL · check-in latency, ${GUESTS} guests, ${LANES} lanes`);
  const ids: string[] = [];
  for (let i = 0; i < GUESTS; i += 50) {
    const batch = Array.from({ length: Math.min(50, GUESTS - i) }, (_, j) => ({
      eventId: rig.eventA,
      name: `Sim Guest ${i + j}`,
      email: `${TAG}-sim-${i + j}@example.invalid`,
      rsvpStatus: "CONFIRMED" as const,
      segment: (i + j) % 20 === 0 ? ("VIP" as const) : ("PROSPECT" as const),
      source: "seed",
    }));
    await db.guest.createMany({ data: batch });
  }
  const rows = await db.guest.findMany({
    where: { eventId: rig.eventA, email: { contains: `${TAG}-sim-` } },
    select: { id: true },
  });
  ids.push(...rows.map((r) => r.id));
  console.log(`      ${ids.length} simulated guests created`);

  const tokens = await Promise.all(
    ids.map((gid) => signQrToken({ gid, eid: rig.eventA })),
  );

  const timings: number[] = [];
  const outcomes = new Map<string, number>();
  let cursor = 0;

  async function lane(laneName: string) {
    for (;;) {
      const i = cursor++;
      if (i >= tokens.length) return;
      const started = performance.now();
      const res = await performCheckin(db, {
        eventId: rig.eventA,
        token: tokens[i]!,
        lane: laneName,
        idempotencyKey: `${TAG}-perf-${i}`,
        offlineSynced: false,
      }).catch((e) => ({ outcome: `THREW:${(e as Error).message.slice(0, 50)}` }));
      timings.push(performance.now() - started);
      outcomes.set(res.outcome, (outcomes.get(res.outcome) ?? 0) + 1);
    }
  }

  const wallStart = performance.now();
  await Promise.all(
    Array.from({ length: LANES }, (_, i) => lane(i < 4 ? "main" : "vip")),
  );
  const wall = performance.now() - wallStart;

  const sorted = [...timings].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const max = sorted[sorted.length - 1] ?? 0;

  console.log(`      outcomes: ${JSON.stringify(Object.fromEntries(outcomes))}`);
  console.log(
    `      n=${timings.length}  p50=${p50.toFixed(0)}ms  p95=${p95.toFixed(0)}ms  p99=${p99.toFixed(0)}ms  max=${max.toFixed(0)}ms`,
  );
  console.log(
    `      wall=${(wall / 1000).toFixed(1)}s  throughput=${(timings.length / (wall / 1000)).toFixed(1)} scans/s`,
  );

  if (p95 < 2500) ok("L1 check-in P95 < 2.5s", `${p95.toFixed(0)}ms`);
  else bad("L1 check-in P95 < 2.5s", `${p95.toFixed(0)}ms`);

  const checkedIn = outcomes.get("CHECKED_IN") ?? 0;
  if (checkedIn === GUESTS) ok("L2 every guest got in", `${checkedIn}/${GUESTS}`);
  else bad("L2 every guest got in", JSON.stringify(Object.fromEntries(outcomes)));

  const stored = await db.checkIn.count({ where: { eventId: rig.eventA } });
  if (stored === GUESTS) ok("L3 one row per guest", `${stored}`);
  else bad("L3 one row per guest", String(stored));

  // ── M · ops snapshot cost at 250 arrivals ──────────────────────────
  {
    const { opsSnapshot } = await import("../src/server/live/ops");
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      await opsSnapshot(db, rig.eventA);
      samples.push(performance.now() - t);
    }
    const s = samples.sort((a, b) => a - b);
    console.log(
      `\nM · live.ops at ${GUESTS} arrivals: p50=${percentile(s, 50).toFixed(0)}ms p95=${percentile(s, 95).toFixed(0)}ms`,
    );
    if (percentile(s, 95) < 2500) ok("M1 ops snapshot P95 < 2.5s");
    else bad("M1 ops snapshot P95 < 2.5s", `${percentile(s, 95).toFixed(0)}ms`);
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
