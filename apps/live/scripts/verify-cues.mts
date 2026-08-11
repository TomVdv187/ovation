/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import path from "node:path";
import superjson from "superjson";

/**
 * CUE SAFETY — `pnpm verify:cues`.
 *
 * The one invariant that matters: **a cue proposes, it never acts.** This
 * drives the cue engine hard — thresholds set so every trigger fires at once —
 * and then asserts three things:
 *
 *   1. every AgentAction a cue produced is `PROPOSED`;
 *   2. the event it was watching is byte-identical afterwards (no agenda edit,
 *      no status change, no `updatedAt` bump);
 *   3. nothing left the building — no EmailMessage moved past `PROPOSED`.
 *
 * Time-based cues are reached by configuring `minutesAfterDoors` as a large
 * negative number, which puts "30 minutes after doors" in the past without
 * touching the clock or the seed.
 *
 * This one does hold a database handle: asserting that a write did *not*
 * happen is not something the API can be asked to confirm about itself.
 */

loadEnv(path.join(import.meta.dirname, "../../../.env"));

const BASE = (process.env.SIM_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
const KEY = process.env.LIVE_OPS_KEY ?? null;

const { db } = await import("@ovation/core/db");
const { signQrToken } = await import("../src/server/live/qr");

function loadEnv(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    if (process.env[key] !== undefined) continue;
    process.env[key] = (match[2] as string).replace(/^["']|["']$/g, "");
  }
}

function headers(extra: Record<string, string> = {}) {
  return { ...(KEY ? { "x-ovation-live-key": KEY } : {}), ...extra };
}

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `   ${detail}` : ""}`);
}

async function main() {
  const door = (await (
    await fetch(`${BASE}/api/live/doorlist`, { headers: headers() })
  ).json()) as {
    event: { id: string; title: string };
    guests: Array<{ id: string; checkedInAt: string | null }>;
  };
  const eventId = door.event.id;

  console.log(`\n  Cue safety — ${door.event.title}`);
  console.log(`  ${BASE} · event ${eventId}\n`);

  // Clear anything a previous run proposed, so the dedupe check does not make
  // this a no-op.
  await db.agentAction.deleteMany({
    where: { eventId, createdById: { startsWith: "cue:" } },
  });

  const before = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    select: {
      updatedAt: true,
      agenda: true,
      status: true,
      date: true,
      capacity: true,
    },
  });
  const emailsBefore = await db.emailMessage.count({
    where: { eventId, status: { not: "PROPOSED" } },
  });

  // Thresholds tuned so every trigger is already satisfied.
  const cues = [
    {
      id: "verify-capacity",
      eventId,
      label: "Capacity (forced)",
      trigger: { type: "CAPACITY_PERCENT", percent: 1 },
      auto: false,
      enabled: true,
    },
    {
      id: "verify-vip-late",
      eventId,
      label: "VIP late (forced)",
      // Doors minus ~7 years: "N minutes after doors" is unambiguously past.
      trigger: { type: "VIP_LATE", minutesAfterDoors: -4_000_000 },
      // Flagged auto ON PURPOSE, and it is the OUTBOUND one. If any cue could
      // slip past the approval gate it would be this one; it must still only
      // propose.
      auto: true,
      enabled: true,
    },
  ];

  await fetch(`${BASE}/api/live/cues?eventId=${eventId}&reset=1`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ cues }),
  });

  // One real check-in drives the capacity/arrival-rate path…
  const fresh = door.guests.find((g) => !g.checkedInAt);
  if (fresh) {
    await fetch(`${BASE}/api/trpc/live.checkin`, {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify(
        superjson.serialize({
          eventId,
          token: await signQrToken({ gid: fresh.id, eid: eventId }),
          lane: "verify-cues",
          idempotencyKey: `verify-cues-${Date.now()}`,
          offlineSynced: false,
        }),
      ),
    });
  }
  // …and an explicit tick drives the time-based ones.
  await fetch(`${BASE}/api/live/cues?eventId=${eventId}&tick=1`, {
    method: "POST",
    headers: headers(),
  });

  // Cue evaluation is deliberately off the check-in's critical path.
  await new Promise((r) => setTimeout(r, 1500));

  const actions = await db.agentAction.findMany({
    where: { eventId, createdById: { startsWith: "cue:" } },
    select: {
      id: true,
      type: true,
      status: true,
      risk: true,
      summary: true,
      createdById: true,
      executedAt: true,
      approvedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const after = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    select: {
      updatedAt: true,
      agenda: true,
      status: true,
      date: true,
      capacity: true,
    },
  });
  const emailsAfter = await db.emailMessage.count({
    where: { eventId, status: { not: "PROPOSED" } },
  });

  console.log(`  ${actions.length} cue action(s) produced:\n`);
  for (const a of actions) {
    console.log(`    [${a.status}] ${a.type} (${a.risk}) — ${a.summary}`);
  }
  console.log();

  check(actions.length > 0, "cues fired at all", `${actions.length} action(s)`);
  check(
    actions.every((a) => a.status === "PROPOSED"),
    "every cue action is PROPOSED",
    actions.map((a) => a.status).join(",") || "none",
  );
  check(
    actions.every((a) => a.approvedAt === null && a.executedAt === null),
    "none approved, none executed",
  );
  check(
    actions.every((a) => a.createdById?.startsWith("cue:") ?? false),
    "attributed to the cue that raised them",
  );
  const autoFlagged = actions.find(
    (a) => a.createdById === "cue:verify-vip-late",
  );
  check(
    autoFlagged?.status === "PROPOSED" && autoFlagged.risk === "OUTBOUND",
    "an OUTBOUND cue flagged auto:true still only proposed",
    autoFlagged ? `${autoFlagged.risk}/${autoFlagged.status}` : "did not fire",
  );
  check(
    after.updatedAt.getTime() === before.updatedAt.getTime(),
    "event untouched (updatedAt unchanged)",
    `${before.updatedAt.toISOString()} → ${after.updatedAt.toISOString()}`,
  );
  check(
    JSON.stringify(after.agenda) === JSON.stringify(before.agenda),
    "agenda unchanged, despite update_agenda proposals",
  );
  check(
    after.status === before.status && after.capacity === before.capacity,
    "event status and capacity unchanged",
  );
  check(
    emailsAfter === emailsBefore,
    "nothing left the building (no email past PROPOSED)",
    `${emailsBefore} → ${emailsAfter}`,
  );

  console.log(
    `\n  ${failures === 0 ? "all checks passed" : `${failures} CHECK(S) FAILED`}\n`,
  );

  await db.$disconnect();
  // Not `process.exit()`: it would discard the buffered report when piped.
  process.exitCode = failures ? 1 : 0;
}

main().catch(async (err) => {
  console.error("\n  cue verification failed:", (err as Error).message, "\n");
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
