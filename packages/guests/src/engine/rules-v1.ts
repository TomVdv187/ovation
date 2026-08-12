import { scoreEngagement } from "./engagement";
import { predictNoShow } from "./no-show";
import { recommendRecovery } from "./recovery";
import type {
  Assessment,
  EventContext,
  GuestSignals,
  ScoreOutcome,
  ScoringEngine,
  SeatPressure,
} from "./types";

/** The hand-written engine. Its id travels to the console on every score. */
export const rulesV1: ScoringEngine = {
  id: "rules-v1",

  assess(signals: GuestSignals, ctx: EventContext): Assessment {
    const engagement = scoreEngagement(signals, ctx);
    const risk = predictNoShow(signals, ctx, engagement.score);
    return {
      guestId: signals.id,
      engagementScore: engagement.score,
      contributions: engagement.contributions,
      factors: engagement.factors,
      noShowRisk: risk.noShowRisk,
      noShowProbability: risk.noShowProbability,
      riskDrivers: risk.drivers,
    };
  },

  recommend(assessment, signals, ctx, pressure) {
    return recommendRecovery(assessment, signals, ctx, pressure);
  },
};

const ENGINES: Record<string, ScoringEngine> = { [rulesV1.id]: rulesV1 };

export const DEFAULT_ENGINE_ID = rulesV1.id;

/**
 * Look an engine up by id.
 *
 * A model-backed engine registers here under its own id and every consumer keeps
 * working: the contract only ever sees `engine: string` alongside the same
 * result shape.
 */
export function getEngine(id: string = DEFAULT_ENGINE_ID): ScoringEngine {
  const engine = ENGINES[id];
  if (!engine) {
    throw new Error(
      `Unknown scoring engine "${id}". Registered engines: ${Object.keys(ENGINES).join(", ")}.`,
    );
  }
  return engine;
}

export function registerEngine(engine: ScoringEngine): void {
  ENGINES[engine.id] = engine;
}

/**
 * Seats we expect to be filled, counting each attendee plus the guests they bring.
 *
 * Only people who actually hold a seat are counted — an unanswered invitation is
 * not a seat, and a waitlisted guest does not have one yet.
 */
export function predictAttendance(
  rows: Array<{ signals: GuestSignals; assessment: Assessment }>,
): number {
  const seats = rows.reduce((total, { signals, assessment }) => {
    if (signals.rsvpStatus !== "CONFIRMED" && signals.rsvpStatus !== "CHECKED_IN") {
      return total;
    }
    const party = 1 + Math.max(0, signals.plusOnes);
    return total + (1 - assessment.noShowProbability) * party;
  }, 0);
  return Math.round(seats);
}

export function seatPressureFrom(
  rows: Array<{ signals: GuestSignals; assessment: Assessment }>,
  ctx: EventContext,
): SeatPressure {
  const waitlisted = rows.filter((r) => r.signals.rsvpStatus === "WAITLISTED").length;
  const predictedAttending = predictAttendance(rows);
  return {
    capacity: ctx.capacity,
    waitlisted,
    predictedAttending,
    // Bumping a shaky guest only helps when somebody is actually waiting and the
    // room is nearly full. With 90 empty chairs, a seat swap costs goodwill for
    // nothing.
    seatSwapWorthwhile: waitlisted > 0 && predictedAttending >= ctx.capacity * 0.9,
  };
}

/**
 * Score a whole event in two passes.
 *
 * Pass one produces every assessment, which is what capacity pressure is derived
 * from; pass two turns each assessment into a recommendation now that we know
 * whether a freed seat would be re-sold. Splitting it this way keeps both halves
 * pure — nothing here reads a clock or a database.
 */
export function runEngine(
  engine: ScoringEngine,
  guests: GuestSignals[],
  ctx: EventContext,
  pressureOverride?: SeatPressure,
): { outcomes: ScoreOutcome[]; pressure: SeatPressure; assessments: Assessment[] } {
  const rows = guests.map((signals) => ({ signals, assessment: engine.assess(signals, ctx) }));
  const pressure = pressureOverride ?? seatPressureFrom(rows, ctx);

  const outcomes = rows.map(({ signals, assessment }) => ({
    guestId: assessment.guestId,
    engagementScore: assessment.engagementScore,
    factors: assessment.factors,
    noShowRisk: assessment.noShowRisk,
    noShowProbability: assessment.noShowProbability,
    recoveryAction: engine.recommend(assessment, signals, ctx, pressure),
  }));

  return { outcomes, pressure, assessments: rows.map((r) => r.assessment) };
}
