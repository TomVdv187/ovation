import type { RecoveryAction } from "@ovation/core";
import type { Assessment, EventContext, GuestSignals, SeatPressure } from "./types";
import { DAY_MS, pct, plural } from "./util";

/**
 * Every risk number ships with the intervention it implies, so the console never
 * has to invent one. Deadlines are derived from the event date, not the clock,
 * which keeps the whole result reproducible.
 */

const LEAD_DAYS = { high: 14, medium: 7 } as const;

/** Segments where a person, not a template, should make the approach. */
const CALL_WORTHY = new Set(["VIP", "CLIENT", "PARTNER"]);

export function recommendRecovery(
  assessment: Assessment,
  signals: GuestSignals,
  ctx: EventContext,
  pressure: SeatPressure,
): RecoveryAction {
  const none = (reason: string): RecoveryAction => ({
    action: "NONE",
    reason,
    dueBy: null,
  });

  switch (signals.rsvpStatus) {
    case "CHECKED_IN":
      return none("Already checked in — there is nothing left to chase.");
    case "NO_SHOW":
      return none("Recorded as a no-show; the recovery that matters now is the invitation to the next event.");
    case "DECLINED":
      return none("They have declined, so they are not holding a seat that needs saving.");
    case "WAITLISTED":
      return none("On the waitlist — a promotion offer, not a recovery nudge, is what moves this person.");
    default:
      break;
  }

  const risk = assessment.noShowRisk;
  const chance = pct(assessment.noShowProbability);

  if (risk === "LOW") {
    return none(
      `A ${chance} chance of missing the night is normal — spending an intervention here would be noise.`,
    );
  }

  if (risk === "MEDIUM") {
    return {
      action: "RECONFIRMATION_EMAIL",
      reason: `${chance} likely to miss the night. One short re-confirmation email, asking them to click to hold the seat, is the cheapest thing that moves this number.`,
      dueBy: dueBy(ctx, LEAD_DAYS.medium),
    };
  }

  // HIGH from here down.
  if (signals.segment === "VIP") {
    return {
      action: "PERSONAL_CALL",
      reason: `A VIP at ${chance} predicted no-show is worth a call from the host. Another email will not shift someone who has already stopped opening them.`,
      dueBy: dueBy(ctx, LEAD_DAYS.high),
    };
  }

  if (signals.rsvpStatus === "CONFIRMED" && pressure.seatSwapWorthwhile) {
    return {
      action: "SEAT_SWAP_WAITLIST",
      reason: `Confirmed but ${chance} likely to miss the night, while ${plural(pressure.waitlisted, "person", "people")} wait for a seat and the room is already at ${pct(pressure.predictedAttending / Math.max(1, pressure.capacity))} of capacity. Offer the seat on rather than serve dinner to an empty chair.`,
      dueBy: dueBy(ctx, LEAD_DAYS.high),
    };
  }

  if (CALL_WORTHY.has(signals.segment)) {
    return {
      action: "PERSONAL_CALL",
      reason: `${chance} likely to miss the night, and the relationship is worth more than the seat. A two-minute call from whoever owns the account will do what an email cannot.`,
      dueBy: dueBy(ctx, LEAD_DAYS.high),
    };
  }

  return {
    action: "RECONFIRMATION_EMAIL",
    reason: `${chance} likely to miss the night. Ask them directly to re-confirm, and free the seat if they do not.`,
    dueBy: dueBy(ctx, LEAD_DAYS.high),
  };
}

function dueBy(ctx: EventContext, leadDays: number): Date {
  return new Date(ctx.asOf.getTime() - leadDays * DAY_MS);
}
