import type { GuestSegmentT } from "@ovation/core";
import type { Assessment, EventContext, GuestSignals } from "./types";
import { plural, round } from "./util";

/**
 * Capacity-aware waitlist promotion.
 *
 * Seats are the unit throughout: a guest bringing a plus-one occupies two of
 * them, and predicted attendance is discounted by each holder's own no-show
 * probability. That discount is the whole point — an event with 200 confirmed
 * seats and a realistic 15% no-show rate can promote from the waitlist long
 * before it looks empty.
 */

/** How much a segment is worth beyond raw engagement when choosing who to promote. */
const SEGMENT_BONUS: Record<GuestSegmentT, number> = {
  VIP: 25,
  PARTNER: 12,
  PRESS: 10,
  CLIENT: 8,
  PROSPECT: 0,
};

export interface WaitlistRow {
  signals: GuestSignals;
  assessment: Assessment;
}

export interface WaitlistPromotion {
  guestId: string;
  name: string;
  reason: string;
  rank: number;
}

export interface WaitlistPlan {
  capacity: number;
  /** Seats currently committed — confirmed and checked-in guests, plus-ones included. */
  confirmed: number;
  /** Seats we actually expect to be sat in, after discounting for predicted no-shows. */
  predictedAttending: number;
  freeSeats: number;
  promote: WaitlistPromotion[];
}

function partySize(signals: GuestSignals): number {
  return 1 + Math.max(0, signals.plusOnes);
}

function holdsSeat(signals: GuestSignals): boolean {
  return signals.rsvpStatus === "CONFIRMED" || signals.rsvpStatus === "CHECKED_IN";
}

export function promotionScore(row: WaitlistRow): number {
  return round(
    row.assessment.engagementScore +
      SEGMENT_BONUS[row.signals.segment] -
      row.assessment.noShowProbability * 20,
    2,
  );
}

export function planWaitlist(rows: WaitlistRow[], ctx: EventContext): WaitlistPlan {
  const holders = rows.filter((r) => holdsSeat(r.signals));
  const confirmed = holders.reduce((sum, r) => sum + partySize(r.signals), 0);
  const predictedAttending = Math.round(
    holders.reduce(
      (sum, r) => sum + (1 - r.assessment.noShowProbability) * partySize(r.signals),
      0,
    ),
  );
  const freeSeats = ctx.capacity - predictedAttending;

  const waiting = rows
    .filter((r) => r.signals.rsvpStatus === "WAITLISTED")
    .sort(compareCandidates);

  const promote: WaitlistPromotion[] = [];
  let remaining = Math.max(0, freeSeats);

  for (const row of waiting) {
    const seats = partySize(row.signals);
    if (seats > remaining) continue; // A smaller party further down the list may still fit.
    remaining -= seats;
    promote.push({
      guestId: row.signals.id,
      name: row.signals.name,
      rank: promote.length + 1,
      reason: promotionReason(row, seats, freeSeats, confirmed, predictedAttending),
    });
  }

  return { capacity: ctx.capacity, confirmed, predictedAttending, freeSeats, promote };
}

/**
 * Ranking is fully determined by the data: promotion score, then who asked
 * first, then id. No ties are ever broken by array order.
 */
function compareCandidates(a: WaitlistRow, b: WaitlistRow): number {
  const byScore = promotionScore(b) - promotionScore(a);
  if (byScore !== 0) return byScore;
  const byAge = a.signals.createdAt.getTime() - b.signals.createdAt.getTime();
  if (byAge !== 0) return byAge;
  return a.signals.id < b.signals.id ? -1 : a.signals.id > b.signals.id ? 1 : 0;
}

function promotionReason(
  row: WaitlistRow,
  seats: number,
  freeSeats: number,
  confirmed: number,
  predictedAttending: number,
): string {
  const { signals, assessment } = row;
  const where = signals.company ? ` at ${signals.company}` : "";
  const party = seats > 1 ? ` They are bringing ${plural(seats - 1, "guest")}, so this takes ${seats} seats.` : "";
  const headroom = `${confirmed} seats are committed but only ${predictedAttending} are likely to be used, which leaves ${plural(Math.max(0, freeSeats), "seat")} to fill.`;
  return `${signals.segment === "PROSPECT" ? "Prospect" : signals.segment}${where}, engagement ${assessment.engagementScore}/100 and only a ${Math.round(assessment.noShowProbability * 100)}% chance of not turning up. ${headroom}${party}`;
}
