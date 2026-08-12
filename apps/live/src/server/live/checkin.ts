import { z } from "zod";
import type { Db } from "@ovation/core/db";
import { Prisma } from "@ovation/core/db";
import { checkinInput, checkinOutput, type LiveEvent } from "@ovation/core";
import { emit } from "../realtime";
import { conversationOpener, whiteGloveNotes } from "./guest-brief";
import { verifyQrToken } from "./qr";
import * as metrics from "./metrics";
import { onCheckin } from "./cues";

export type CheckinInput = z.infer<typeof checkinInput>;
export type CheckinOutput = z.infer<typeof checkinOutput>;

/**
 * The door scan.
 *
 * Three rules, all of them load-bearing on the night:
 *
 *  1. **Rejections are outcomes.** A forged code, an expired code, the wrong
 *     event and an unknown guest each return a distinct outcome with HTTP 200.
 *     Throwing would make the scanner render a generic error boundary, and a
 *     greeter cannot act on "something went wrong".
 *
 *  2. **Replay is idempotent.** `CheckIn.guestId` is unique, so the second
 *     application of the same scan cannot create a second row. It returns
 *     ALREADY_CHECKED_IN carrying the *original* timestamp — the moment the
 *     guest walked in, not the moment the queue drained. `scannedAt` is what
 *     we persist for exactly this reason.
 *
 *  3. **Publish after commit.** The counter on the ops wall must never show an
 *     arrival that later rolls back, so nothing is emitted until the write has
 *     landed.
 */

const GUEST_SELECT = {
  id: true,
  eventId: true,
  name: true,
  email: true,
  company: true,
  title: true,
  segment: true,
  dietary: true,
  plusOnes: true,
  interests: true,
  notes: true,
  whiteGlove: true,
  checkIn: { select: { timestamp: true, lane: true } },
} satisfies Prisma.GuestSelect;

type GuestRow = Prisma.GuestGetPayload<{ select: typeof GUEST_SELECT }>;

/**
 * In-flight coalescing. Two devices scanning the same code in the same second,
 * or a queue that retries before the first reply lands, resolve to one write
 * rather than racing on the unique index.
 *
 * This is a per-process optimisation, not the correctness mechanism — the
 * unique constraint is. See CONTRACT_CHANGES CC-001 for the persisted
 * idempotency key that would make dedupe survive a restart.
 */
const globalForInflight = globalThis as unknown as {
  ovationCheckinInflight?: Map<string, Promise<CheckinOutput>>;
};
const inflight = (globalForInflight.ovationCheckinInflight ??= new Map());

export async function performCheckin(
  db: Db,
  raw: CheckinInput,
): Promise<CheckinOutput> {
  const key = `${raw.eventId}:${raw.idempotencyKey}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const started = performance.now();
  const run = execute(db, raw).finally(() => inflight.delete(key));
  inflight.set(key, run);

  const result = await run;
  metrics.record({
    at: Date.now(),
    ms: performance.now() - started,
    outcome: result.outcome,
    lane: raw.lane,
    offlineSynced: raw.offlineSynced,
  });
  return result;
}

async function execute(db: Db, input: CheckinInput): Promise<CheckinOutput> {
  const resolved = await resolveGuestId(input);
  if (!resolved.ok) return rejection(resolved.outcome);

  const guest = await db.guest.findUnique({
    where: { id: resolved.guestId },
    select: GUEST_SELECT,
  });

  if (!guest) return rejection("REJECTED_UNKNOWN_GUEST");

  // A validly signed token for another event, or a manual door-list entry
  // typed against the wrong event, are the same mistake with the same answer.
  if (guest.eventId !== input.eventId) return rejection("REJECTED_WRONG_EVENT");

  if (guest.checkIn) {
    return {
      outcome: "ALREADY_CHECKED_IN",
      guest: brief(guest),
      checkedInAt: guest.checkIn.timestamp,
      lane: guest.checkIn.lane,
    };
  }

  const scannedAt = input.scannedAt ?? new Date();

  try {
    await db.$transaction([
      db.checkIn.create({
        data: {
          eventId: input.eventId,
          guestId: guest.id,
          timestamp: scannedAt,
          lane: input.lane,
          deviceId: input.deviceId ?? null,
          offlineSynced: input.offlineSynced,
        },
      }),
      db.guest.update({
        where: { id: guest.id },
        data: { rsvpStatus: "CHECKED_IN" },
      }),
    ]);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Lost the race against another lane or a replay that arrived first.
      // Read back the winner so the greeter sees the real arrival time.
      const winner = await db.checkIn.findUnique({
        where: { guestId: guest.id },
        select: { timestamp: true, lane: true },
      });
      return {
        outcome: "ALREADY_CHECKED_IN",
        guest: brief(guest),
        checkedInAt: winner?.timestamp ?? scannedAt,
        lane: winner?.lane ?? input.lane,
      };
    }
    throw err;
  }

  await announceArrival(db, input.eventId, guest, scannedAt, input.lane);

  return {
    outcome: "CHECKED_IN",
    guest: brief(guest),
    checkedInAt: scannedAt,
    lane: input.lane,
  };
}

type Resolution =
  | { ok: true; guestId: string }
  | { ok: false; outcome: CheckinOutput["outcome"] };

async function resolveGuestId(input: CheckinInput): Promise<Resolution> {
  if (input.token) {
    const verified = await verifyQrToken(input.token);
    if (!verified.ok) return { ok: false, outcome: verified.reason };
    if (verified.payload.eid !== input.eventId) {
      return { ok: false, outcome: "REJECTED_WRONG_EVENT" };
    }
    return { ok: true, guestId: verified.payload.gid };
  }

  // Manual door-list fallback — the guest lost their code and a human picked
  // them off the list. No token to verify; the guest lookup is the check.
  if (input.guestId) return { ok: true, guestId: input.guestId };

  return { ok: false, outcome: "REJECTED_INVALID_TOKEN" };
}

function rejection(outcome: CheckinOutput["outcome"]): CheckinOutput {
  return { outcome, guest: null, checkedInAt: null, lane: null };
}

function brief(guest: GuestRow): NonNullable<CheckinOutput["guest"]> {
  return {
    id: guest.id,
    name: guest.name,
    company: guest.company,
    segment: guest.segment,
    plusOnes: guest.plusOnes,
    dietary: guest.dietary,
    whiteGloveNotes: whiteGloveNotes(guest),
    conversationOpener: conversationOpener(guest),
  };
}

/**
 * Everything the room learns from one arrival: the feed line, the VIP alert on
 * the host's phone, the counter, and whatever cues that tips over.
 */
async function announceArrival(
  db: Db,
  eventId: string,
  guest: GuestRow,
  at: Date,
  lane: string,
): Promise<void> {
  const checkin: LiveEvent = {
    kind: "CHECKIN",
    at,
    guestId: guest.id,
    name: guest.name,
    company: guest.company,
    segment: guest.segment,
    lane,
  };
  emit(eventId, checkin);

  if (guest.segment === "VIP") {
    emit(eventId, {
      kind: "VIP_ARRIVAL",
      at,
      guestId: guest.id,
      name: guest.name,
      company: guest.company,
      notes: whiteGloveNotes(guest),
      conversationOpener: conversationOpener(guest),
      hostAssigned: assignedHost(guest.whiteGlove),
    });
  }

  const [checkedIn, event] = await Promise.all([
    db.checkIn.count({ where: { eventId } }),
    db.event.findUnique({ where: { id: eventId }, select: { capacity: true } }),
  ]);
  const capacity = event?.capacity ?? 0;
  const capacityPercent = capacity > 0 ? (checkedIn / capacity) * 100 : 0;

  emit(eventId, {
    kind: "COUNTER",
    at,
    checkedIn,
    capacityPercent: Math.round(capacityPercent * 10) / 10,
  });

  // Cue evaluation is deliberately not awaited into the scan's latency budget;
  // it proposes, it never blocks the door.
  void onCheckin(db, eventId, { checkedIn, capacity }).catch((err) => {
    console.error("[live] cue evaluation failed:", (err as Error).message);
  });
}

function assignedHost(whiteGlove: unknown): string | null {
  if (whiteGlove && typeof whiteGlove === "object" && "host" in whiteGlove) {
    const host = (whiteGlove as { host?: unknown }).host;
    return typeof host === "string" ? host : null;
  }
  return null;
}
