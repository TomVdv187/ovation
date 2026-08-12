/**
 * Sponsor ROI aggregation.
 *
 * Three of the six numbers on a sponsor report are *computed* from live data;
 * three are *observed* counters maintained elsewhere. Keeping that distinction
 * explicit matters, because the report goes to a paying sponsor:
 *
 *   computed   logoImpressions   modelled from Event.pageVisits x placements
 *              leads             Sponsor.targetAccounts joined to Guest.company
 *              renewalIntent     scored from the five numbers above it
 *
 *   observed   meetings          1:1s booked, maintained by the ops/CRM flow
 *              reportOpens       email tracking
 *              benefitsPageClicks email/link tracking
 *
 * Event.pageVisits is written by Agent 2 · MAISON. We only ever read it.
 */
import type { SponsorRoiStats } from "@ovation/core";
import { sponsorRoiStatsSchema } from "@ovation/core";
import { roundTo } from "../money";
import type { SponsorEntitlements } from "./packages";
import type { MatchedLead } from "./match";

/**
 * How much of one public-page visit each placement is worth as an impression.
 *
 * These are modelling assumptions, not measurements — a hero logo is seen by
 * essentially everyone who loads the page, a programme logo by the share who
 * scroll that far. Placements that are not on the web page at all score zero:
 * a logo on the dinner menu is real value, but it is not a page impression and
 * counting it as one would inflate the number we bill against.
 *
 * The report labels the figure "estimated" for exactly this reason.
 */
export const PLACEMENT_WEIGHTS: Record<string, number> = {
  hero: 1,
  header: 1,
  banner: 0.9,
  sidebar: 0.7,
  "partners wall": 0.6,
  programme: 0.6,
  agenda: 0.6,
  footer: 0.5,
  "email footer": 0,
  "dinner menu": 0,
  stage: 0,
  stand: 0,
  badge: 0,
  lanyard: 0,
  "printed programme": 0,
};

/** Unknown web placements get a conservative share of a visit. */
const DEFAULT_WEIGHT = 0.4;

export function placementWeight(placement: string): number {
  const key = placement.trim().toLowerCase();
  const known = PLACEMENT_WEIGHTS[key];
  return known === undefined ? DEFAULT_WEIGHT : known;
}

/** Sum of the placement weights that actually render on the public page. */
export function impressionMultiplier(placements: readonly string[]): number {
  return roundTo(
    placements.reduce((sum, placement) => sum + placementWeight(placement), 0),
    2,
  );
}

export function estimateLogoImpressions(
  placements: readonly string[],
  pageVisits: number,
): number {
  if (pageVisits <= 0) return 0;
  return Math.round(pageVisits * impressionMultiplier(placements));
}

export interface RenewalSignal {
  intent: SponsorRoiStats["renewalIntent"];
  score: number;
  /** One line per point scored — rendered in the report so it is auditable. */
  drivers: string[];
}

export interface RenewalInput {
  engagementScore: number;
  leads: number;
  meetings: number;
  reportOpens: number;
  benefitsPageClicks: number;
  targetAccountIntros: number;
}

/**
 * Renewal intent from observed behaviour.
 *
 * Deliberately a small integer score rather than a model: a sponsor manager
 * has to be able to read the drivers and disagree with one of them.
 */
export function scoreRenewalIntent(input: RenewalInput): RenewalSignal {
  const drivers: string[] = [];
  let score = 0;

  if (input.engagementScore >= 70) {
    score += 2;
    drivers.push(`Engagement score ${input.engagementScore}/100 (high).`);
  } else if (input.engagementScore >= 45) {
    score += 1;
    drivers.push(`Engagement score ${input.engagementScore}/100 (moderate).`);
  } else {
    drivers.push(`Engagement score ${input.engagementScore}/100 (low).`);
  }

  if (input.leads >= 10) {
    score += 1;
    drivers.push(`${input.leads} guests from their target-account list are attending.`);
  }

  if (input.targetAccountIntros > 0 && input.meetings >= input.targetAccountIntros) {
    score += 1;
    drivers.push(
      `${input.meetings} of ${input.targetAccountIntros} contracted introductions delivered.`,
    );
  }

  if (input.reportOpens >= 5) {
    score += 1;
    drivers.push(`Opened ${input.reportOpens} sponsor reports.`);
  }

  if (input.benefitsPageClicks >= 10) {
    score += 1;
    drivers.push(`${input.benefitsPageClicks} clicks through to the benefits page.`);
  }

  // UNKNOWN means "we have observed nothing", not "we have observed bad
  // news". A sponsor with weak-but-real activity is a LOW renewal risk we can
  // act on; collapsing that into UNKNOWN would hide the sponsor most in need
  // of a call.
  const observedSomething =
    input.engagementScore > 0 ||
    input.leads > 0 ||
    input.meetings > 0 ||
    input.reportOpens > 0 ||
    input.benefitsPageClicks > 0;

  const intent: SponsorRoiStats["renewalIntent"] =
    score >= 5 ? "HIGH" : score >= 3 ? "MEDIUM" : observedSomething ? "LOW" : "UNKNOWN";

  return { intent, score, drivers };
}

export interface RoiInput {
  /** Stored roiStats JSON — source of the observed counters. */
  storedStats: unknown;
  entitlements: SponsorEntitlements;
  engagementScore: number;
  /** Event.pageVisits, read-only. */
  pageVisits: number;
  matchedLeads: readonly MatchedLead[];
}

export interface RoiReport {
  stats: SponsorRoiStats;
  renewal: RenewalSignal;
  impressionMultiplier: number;
}

/** Parse the stored roiStats JSON, falling back to schema defaults. */
export function parseRoiStats(value: unknown): SponsorRoiStats {
  const parsed = sponsorRoiStatsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : sponsorRoiStatsSchema.parse({});
}

export function buildRoiReport(input: RoiInput): RoiReport {
  const stored = parseRoiStats(input.storedStats);

  // Computed, live, this week.
  const modelled = estimateLogoImpressions(
    input.entitlements.logoPlacements,
    input.pageVisits,
  );
  // If the page has no traffic recorded yet, fall back to the last stored
  // snapshot rather than reporting a regression to zero.
  const logoImpressions = modelled > 0 ? modelled : stored.logoImpressions;
  const leads = input.matchedLeads.length;

  const renewal = scoreRenewalIntent({
    engagementScore: input.engagementScore,
    leads,
    meetings: stored.meetings,
    reportOpens: stored.reportOpens,
    benefitsPageClicks: stored.benefitsPageClicks,
    targetAccountIntros: input.entitlements.targetAccountIntros,
  });

  return {
    stats: sponsorRoiStatsSchema.parse({
      logoImpressions,
      leads,
      meetings: stored.meetings,
      reportOpens: stored.reportOpens,
      benefitsPageClicks: stored.benefitsPageClicks,
      renewalIntent: renewal.intent,
    }),
    renewal,
    impressionMultiplier: impressionMultiplier(input.entitlements.logoPlacements),
  };
}

/** ISO-8601 week key, so a weekly report is idempotent within its week. */
export function isoWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Thursday of the current week decides the year, per ISO-8601.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
