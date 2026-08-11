import type { z } from "zod";
import type { Db } from "@ovation/core/db";
import type { opsSnapshotOutput } from "@ovation/core";

export type OpsSnapshot = z.infer<typeof opsSnapshotOutput>;

export const BUCKET_MS = 15 * 60 * 1000;

/**
 * The numbers on the wall.
 *
 * Definitions, because "checked in" is ambiguous once plus-ones exist:
 *  - `checkedIn` counts CheckIn rows — scans through the door, one per guest.
 *  - `expected` counts guests who said they are coming (CONFIRMED) plus those
 *    already through, so the ratio checkedIn/expected reads as "how much of the
 *    confirmed room is here".
 *  - `capacityPercent` is against the venue's hard capacity, which is the
 *    number the fire officer cares about and the number the capacity cue fires
 *    on.
 *
 * Plus-ones are attached to a guest and arrive with them; they are surfaced in
 * the dashboard as a separate head count rather than folded into these, so the
 * two never silently disagree.
 */
export async function opsSnapshot(
  db: Db,
  eventId: string,
): Promise<OpsSnapshot> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, capacity: true },
  });
  if (!event) {
    throw Object.assign(new Error(`Unknown event ${eventId}`), {
      code: "NOT_FOUND",
    });
  }

  const [expected, checkedIn, vipsExpected, vipsArrived, laneGroups, arrivals] =
    await Promise.all([
      db.guest.count({
        where: {
          eventId,
          rsvpStatus: { in: ["CONFIRMED", "CHECKED_IN"] },
        },
      }),
      db.checkIn.count({ where: { eventId } }),
      db.guest.count({
        where: {
          eventId,
          segment: "VIP",
          rsvpStatus: { in: ["CONFIRMED", "CHECKED_IN"] },
        },
      }),
      db.checkIn.count({ where: { eventId, guest: { segment: "VIP" } } }),
      db.checkIn.groupBy({
        by: ["lane"],
        where: { eventId },
        _count: { _all: true },
      }),
      db.checkIn.findMany({
        where: { eventId },
        select: { timestamp: true },
        orderBy: { timestamp: "asc" },
      }),
    ]);

  return {
    eventId,
    capacity: event.capacity,
    expected,
    checkedIn,
    capacityPercent:
      event.capacity > 0
        ? Math.round((checkedIn / event.capacity) * 1000) / 10
        : 0,
    vipsExpected,
    vipsArrived,
    arrivalsPer15Min: bucketArrivals(arrivals.map((a) => a.timestamp)),
    byLane: laneGroups
      .map((g) => ({ lane: g.lane, count: g._count._all }))
      .sort((a, b) => b.count - a.count || a.lane.localeCompare(b.lane)),
  };
}

/**
 * Fixed 15-minute buckets aligned to the wall clock, gap-filled from the first
 * arrival to the last. Gap-filling matters: a bar chart with the empty quarter
 * hours missing compresses a lull into nothing and hides the arrival-rate drop
 * the organiser is watching for.
 */
export function bucketArrivals(
  timestamps: Date[],
  now: Date = new Date(),
): Array<{ bucketStart: Date; count: number }> {
  if (timestamps.length === 0) return [];

  const counts = new Map<number, number>();
  let min = Infinity;
  for (const ts of timestamps) {
    const bucket = Math.floor(ts.getTime() / BUCKET_MS) * BUCKET_MS;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    if (bucket < min) min = bucket;
  }

  const last = Math.max(
    Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS,
    Math.max(...counts.keys()),
  );

  const out: Array<{ bucketStart: Date; count: number }> = [];
  for (let t = min; t <= last; t += BUCKET_MS) {
    out.push({ bucketStart: new Date(t), count: counts.get(t) ?? 0 });
  }
  return out;
}
