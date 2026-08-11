import type { NoShowRiskT } from "@ovation/core";
import type { Contribution, EventContext, GuestSignals } from "./types";
import { NEW_CONTACT_DAYS } from "./engagement";
import { clamp, daysBetween, emailTld, plural, round } from "./util";

/**
 * No-show prediction, rules v1.
 *
 * Risk points accumulate from five families — engagement decay, ticket type,
 * travel distance, historic behaviour and recency — and map onto a probability.
 * Every term carries a sentence so the number can be argued with.
 *
 * A model replaces this file, not the contract: `assess()` keeps its signature
 * and `guestScoreOutput.engine` changes from "rules-v1" to the model's id.
 */

const RISK_BANDS = { medium: 0.2, high: 0.45 } as const;
const FLOOR = 0.02;
const CEILING = 0.95;

/** How far a full 100-point engagement deficit can push the probability. */
const DECAY_WEIGHT = 0.42;

/** Spend at which the sunk cost of a ticket is doing all the work it can. */
const FULL_SUNK_COST_CENTS = 15_000;

/**
 * Where the venue is, so an email domain can stand in for travel distance.
 *
 * The Guest model carries no address, so the top-level domain is the only
 * location signal available. It is a proxy and is labelled as one in the
 * factor text; swap it for a real distance the day the schema grows one.
 */
const VENUE_REGIONS: Record<string, { home: string; near: string[]; country: string }> = {
  "Europe/Brussels": { home: "be", near: ["nl", "lu", "fr", "de"], country: "Belgium" },
  "Europe/Amsterdam": { home: "nl", near: ["be", "lu", "de"], country: "the Netherlands" },
  "Europe/Luxembourg": { home: "lu", near: ["be", "fr", "de"], country: "Luxembourg" },
  "Europe/Paris": { home: "fr", near: ["be", "lu", "de", "es"], country: "France" },
  "Europe/Berlin": { home: "de", near: ["nl", "be", "lu", "at", "pl"], country: "Germany" },
};

/** Domains that say nothing about where somebody actually is. */
const PLACELESS_TLDS = new Set(["com", "eu", "org", "net", "io", "co", "ai", "dev"]);

export interface RiskResult {
  noShowRisk: NoShowRiskT;
  noShowProbability: number;
  drivers: Contribution[];
}

export function predictNoShow(
  signals: GuestSignals,
  ctx: EventContext,
  engagementScore: number,
): RiskResult {
  const settled = settledOutcome(signals);
  if (settled) return settled;

  const drivers: Contribution[] = [];

  drivers.push(engagementDecay(signals, ctx, engagementScore));
  drivers.push(rsvpRisk(signals));
  drivers.push(ticketRisk(signals));
  drivers.push(travelRisk(signals, ctx));

  const history = historyRisk(signals);
  if (history) drivers.push(history);

  drivers.push(dormancyRisk(signals, ctx));

  const points = drivers.reduce((sum, d) => sum + d.weight, 0);
  const noShowProbability = round(clamp(points / 100, FLOOR, CEILING), 3);

  return { noShowRisk: band(noShowProbability), noShowProbability, drivers };
}

export function band(probability: number): NoShowRiskT {
  if (probability < RISK_BANDS.medium) return "LOW";
  if (probability < RISK_BANDS.high) return "MEDIUM";
  return "HIGH";
}

/**
 * Some RSVP states are not predictions at all — they are facts. Short-circuit
 * them rather than running a probability model over a settled outcome.
 */
function settledOutcome(s: GuestSignals): RiskResult | null {
  if (s.rsvpStatus === "CHECKED_IN") {
    return {
      noShowRisk: "LOW",
      noShowProbability: 0,
      drivers: [
        { factor: "checked_in", weight: 0, rank: 0, detail: "They are already in the room." },
      ],
    };
  }
  if (s.rsvpStatus === "NO_SHOW") {
    return {
      noShowRisk: "HIGH",
      noShowProbability: 1,
      drivers: [
        {
          factor: "already_no_show",
          weight: 0,
          rank: 0,
          detail: "Already recorded as a no-show for this event — this is history, not a forecast.",
        },
      ],
    };
  }
  if (s.rsvpStatus === "DECLINED") {
    return {
      noShowRisk: "HIGH",
      noShowProbability: CEILING,
      drivers: [
        {
          factor: "declined",
          weight: 0,
          rank: 0,
          detail: "They have declined, so treat them as not attending.",
        },
      ],
    };
  }
  return null;
}

function engagementDecay(
  s: GuestSignals,
  ctx: EventContext,
  engagementScore: number,
): Contribution {
  const deficit = 100 - engagementScore;
  const tenureDays = Math.max(0, daysBetween(s.createdAt, ctx.asOf));
  // Silence from somebody who joined the list yesterday is not disengagement.
  const fairness = clamp(tenureDays / NEW_CONTACT_DAYS, 0, 1);
  const weight = round(deficit * DECAY_WEIGHT * fairness, 1);
  const detail =
    fairness < 1
      ? `Engagement is ${engagementScore}/100, but they only joined the list ${plural(tenureDays, "day")} before the event, so the silence counts for less.`
      : `Engagement is ${engagementScore}/100; the gap to a fully engaged guest is what drives most of this number.`;
  return { factor: "engagement_decay", weight, rank: 1, detail };
}

function rsvpRisk(s: GuestSignals): Contribution {
  if (s.rsvpStatus === "WAITLISTED") {
    return {
      factor: "rsvp_state",
      weight: 6,
      rank: 2,
      detail: "On the waitlist, so they have no seat to turn up to yet.",
    };
  }
  if (s.rsvpStatus === "INVITED") {
    return {
      factor: "rsvp_state",
      weight: 14,
      rank: 2,
      detail: "Invited but never confirmed — an unanswered invitation is the single most common way a seat goes empty.",
    };
  }
  return {
    factor: "rsvp_state",
    weight: 0,
    rank: 2,
    detail: "They have confirmed, which is the strongest commitment we ask for.",
  };
}

function ticketRisk(s: GuestSignals): Contribution {
  if (s.paidCents <= 0) {
    return {
      factor: "ticket_type",
      weight: 12,
      rank: 3,
      detail: "Holding a free or unpaid seat — nothing is lost by staying home.",
    };
  }
  const relief = round(-8 * clamp(s.paidCents / FULL_SUNK_COST_CENTS, 0, 1), 1);
  return {
    factor: "ticket_type",
    weight: relief,
    rank: 3,
    detail: `Paid €${(s.paidCents / 100).toFixed(0)} for their ticket, and people rarely write off a ticket they bought.`,
  };
}

function travelRisk(s: GuestSignals, ctx: EventContext): Contribution {
  const region = VENUE_REGIONS[ctx.timezone];
  const tld = emailTld(s.email);

  if (!region || !tld) {
    return {
      factor: "travel_distance",
      weight: 0,
      rank: 4,
      detail: "We have nothing to judge travel distance from, so distance is not counted here.",
    };
  }
  if (tld === region.home) {
    return {
      factor: "travel_distance",
      weight: 0,
      rank: 4,
      detail: `Their address is domestic and the venue is in ${region.country}, so travel is not a barrier.`,
    };
  }
  if (region.near.includes(tld)) {
    return {
      factor: "travel_distance",
      weight: 5,
      rank: 4,
      detail: `A .${tld} address means a neighbouring-country trip to reach ${region.country}.`,
    };
  }
  if (PLACELESS_TLDS.has(tld)) {
    return {
      factor: "travel_distance",
      weight: 4,
      rank: 4,
      detail: `A .${tld} address tells us nothing about where they are, so we allow for some travel.`,
    };
  }
  return {
    factor: "travel_distance",
    weight: 8,
    rank: 4,
    detail: `A .${tld} address suggests a trip from outside the region to reach ${region.country}.`,
  };
}

function historyRisk(s: GuestSignals): Contribution | null {
  const { attended, noShows } = s.history;
  if (attended === 0 && noShows === 0) return null;

  const penalty = Math.min(noShows * 15, 25);
  const credit = Math.min(attended * 8, 20);
  const weight = penalty - credit;

  let detail: string;
  if (noShows > 0 && attended > 0) {
    detail = `They have turned up to ${plural(attended, "previous event")} and missed ${noShows} of them.`;
  } else if (noShows > 0) {
    detail = `They booked ${plural(noShows, "previous event")} and did not turn up to any of them.`;
  } else {
    detail = `They have turned up to ${plural(attended, "previous event")} without fail.`;
  }
  return { factor: "historic_behaviour", weight, rank: 5, detail };
}

function dormancyRisk(s: GuestSignals, ctx: EventContext): Contribution {
  if (!s.lastSeenAt) {
    return {
      factor: "dormancy",
      weight: 9,
      rank: 6,
      detail: "They have never looked at the event page, so nothing tells us the date is still in their diary.",
    };
  }
  const gap = Math.max(0, daysBetween(s.lastSeenAt, ctx.asOf));
  const weight = gap > 45 ? 6 : gap > 21 ? 3 : 0;
  const detail =
    weight === 0
      ? `They were on the event page ${plural(gap, "day")} before the doors open, so the date is clearly still live for them.`
      : `Their last visit was ${plural(gap, "day")} before the doors open, which is long enough for an event to fall out of someone's diary.`;
  return { factor: "dormancy", weight, rank: 6, detail };
}
