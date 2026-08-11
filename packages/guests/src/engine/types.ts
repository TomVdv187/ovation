import type {
  EngagementFactor,
  GuestSegmentT,
  NoShowRiskT,
  RecoveryAction,
  RsvpStatusT,
} from "@ovation/core";

/**
 * The engine's input/output shapes.
 *
 * Everything here is plain data. No Prisma, no tRPC, no clock, no network — the
 * engine is a pure function of (signals, event context). That is what makes
 * `guests.score` byte-reproducible and what lets an ML model replace the rules
 * later without touching the contract: a new engine is a new implementation of
 * `ScoringEngine`, not a new response shape.
 */

/** Everything the engine is allowed to look at for one guest. */
export interface GuestSignals {
  id: string;
  name: string;
  email: string;
  company: string | null;
  title: string | null;
  segment: GuestSegmentT;
  rsvpStatus: RsvpStatusT;
  emailOpens: number;
  emailClicks: number;
  pageVisits: number;
  /** Last time we saw them on the event page. */
  lastSeenAt: Date | null;
  registeredAt: Date | null;
  /** When the guest landed on the list — used to avoid punishing brand-new contacts. */
  createdAt: Date;
  plusOnes: number;
  /** Organiser notes / logged replies. The closest thing the schema gives us to reply text. */
  notes: string | null;
  /** Total PAID order value for this event, in cents. 0 means a free or unbought seat. */
  paidCents: number;
  /** How this person behaved at the organisation's previous events. */
  history: GuestHistory;
}

export interface GuestHistory {
  /** Times they checked in at an earlier event of this organisation. */
  attended: number;
  /** Times they were marked NO_SHOW at an earlier event of this organisation. */
  noShows: number;
}

export function emptyHistory(): GuestHistory {
  return { attended: 0, noShows: 0 };
}

/**
 * Event-level facts every guest is scored against.
 *
 * `asOf` is the reference instant for every recency calculation. The router sets
 * it to the event's own start time rather than `new Date()` on purpose: a score
 * must be a property of the data, not of the moment somebody pressed the button.
 * Run `guests.score` twice a week apart and you get the same bytes.
 */
export interface EventContext {
  eventId: string;
  asOf: Date;
  capacity: number;
  timezone: string;
}

/** Capacity pressure, needed only to choose between recovery actions. */
export interface SeatPressure {
  capacity: number;
  waitlisted: number;
  predictedAttending: number;
  /** True when a freed seat would actually be re-sold rather than left empty. */
  seatSwapWorthwhile: boolean;
}

/** One factor's contribution, plus a fixed tie-break rank so ordering is stable. */
export interface Contribution extends EngagementFactor {
  /** Lower wins ties. Fixed per factor kind, never data-dependent. */
  rank: number;
}

export interface Assessment {
  guestId: string;
  engagementScore: number;
  /** Every contribution considered, in fixed order. `topFactors` picks 3 of these. */
  contributions: Contribution[];
  factors: EngagementFactor[];
  noShowRisk: NoShowRiskT;
  noShowProbability: number;
  /** Human-readable drivers of the risk number, for debugging and future evals. */
  riskDrivers: Contribution[];
}

export interface ScoreOutcome {
  guestId: string;
  engagementScore: number;
  factors: EngagementFactor[];
  noShowRisk: NoShowRiskT;
  noShowProbability: number;
  recoveryAction: RecoveryAction;
}

/**
 * The swappable brain.
 *
 * `rules-v1` is the hand-written implementation. A model-backed engine ships as
 * a second implementation with a different `id` (e.g. `"noshow-gbm-2026-03"`);
 * `guestScoreOutput.engine` carries that id to the console, so swapping the
 * brain is a value change, not a schema change.
 */
export interface ScoringEngine {
  readonly id: string;
  /** Score + risk for one guest. Must be pure. */
  assess(signals: GuestSignals, ctx: EventContext): Assessment;
  /** Which intervention to recommend, given the assessment and the room's capacity. */
  recommend(
    assessment: Assessment,
    signals: GuestSignals,
    ctx: EventContext,
    pressure: SeatPressure,
  ): RecoveryAction;
}
