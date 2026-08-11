import type { EngagementFactor } from "@ovation/core";
import type { Contribution, EventContext, GuestSignals } from "./types";
import { clamp, daysBetween, plural, round } from "./util";

/**
 * Engagement scoring, 0–100.
 *
 * Deterministic and explainable by construction: every point on the scale comes
 * from exactly one named contribution, and the top three contributions ship with
 * the score so an organiser can see why it is what it is. The `detail` strings
 * are rendered verbatim in the console, so they are sentences, not debug dumps.
 */

/** Ceilings past which more of the same signal stops telling us anything new. */
const CAP = { opens: 8, clicks: 4, visits: 6 } as const;

/** Points each signal is worth at its ceiling. These sum to more than 100 on purpose. */
const WORTH = { opens: 18, clicks: 24, visits: 18 } as const;

const RSVP_POINTS = {
  CHECKED_IN: 25,
  CONFIRMED: 22,
  WAITLISTED: 8,
  INVITED: 0,
  DECLINED: -15,
  NO_SHOW: -20,
} as const;

/** A contact newer than this has not had a fair chance to show engagement. */
export const NEW_CONTACT_DAYS = 14;

const POSITIVE_PHRASES = [
  "looking forward",
  "can't wait",
  "cannot wait",
  "delighted",
  "excited",
  "thank you",
  "thanks",
  "great to",
  "happy to",
  "pleasure",
  "keen to",
  "count me in",
  "see you there",
  "confirmed",
];

const NEGATIVE_PHRASES = [
  "unfortunately",
  "can't make",
  "cannot make",
  "won't make",
  "will not make",
  "clash",
  "conflict",
  "not sure",
  "unlikely",
  "too busy",
  "double booked",
  "double-booked",
  "another commitment",
  "have to decline",
  "sorry",
  "apologies",
];

export interface EngagementResult {
  score: number;
  contributions: Contribution[];
  factors: EngagementFactor[];
}

export function scoreEngagement(
  signals: GuestSignals,
  ctx: EventContext,
): EngagementResult {
  const contributions: Contribution[] = [];
  const tenureDays = Math.max(0, daysBetween(signals.createdAt, ctx.asOf));

  if (tenureDays < NEW_CONTACT_DAYS) {
    contributions.push({
      factor: "new_contact",
      weight: 0,
      rank: 0,
      detail:
        tenureDays <= 0
          ? "Added to the list on the day of the event — there has been no time for a signal either way."
          : `Added to the list ${plural(tenureDays, "day")} before the doors open, so there has barely been time for a signal either way.`,
    });
  }

  contributions.push(clicksContribution(signals));
  contributions.push(rsvpContribution(signals));
  contributions.push(opensContribution(signals));
  contributions.push(visitsContribution(signals, ctx));
  contributions.push(recencyContribution(signals, ctx));
  contributions.push(registrationContribution(signals, ctx));

  const sentiment = sentimentContribution(signals);
  if (sentiment) contributions.push(sentiment);

  if (signals.plusOnes > 0) {
    contributions.push({
      factor: "plus_ones",
      weight: 3,
      rank: 8,
      detail: `Bringing ${plural(signals.plusOnes, "guest")} — booking a seat for someone else is a strong sign they intend to use it.`,
    });
  }

  const raw = contributions.reduce((sum, c) => sum + c.weight, 0);
  const score = Math.round(clamp(raw, 0, 100));

  return { score, contributions, factors: topFactors(contributions) };
}

/**
 * The top three drivers, largest absolute weight first.
 *
 * Ties break on the fixed `rank`, never on array order or data, so two runs over
 * the same guest always pick the same three factors in the same order — including
 * for a guest whose every contribution is zero.
 */
export function topFactors(contributions: Contribution[]): EngagementFactor[] {
  return [...contributions]
    .sort((a, b) => {
      const byWeight = Math.abs(b.weight) - Math.abs(a.weight);
      return byWeight !== 0 ? byWeight : a.rank - b.rank;
    })
    .slice(0, 3)
    .map(({ factor, weight, detail }) => ({ factor, weight, detail }));
}

// ── individual contributions ──────────────────────────────────

function clicksContribution(s: GuestSignals): Contribution {
  const clicks = Math.max(0, s.emailClicks);
  const weight = round((Math.min(clicks, CAP.clicks) / CAP.clicks) * WORTH.clicks, 1);
  return {
    factor: "link_clicks",
    weight,
    rank: 1,
    detail:
      clicks === 0
        ? "Has never clicked a link in one of our emails — the signal we trust most is missing."
        : `Clicked through ${plural(clicks, "time")} from our emails, which is the strongest intent signal we track.`,
  };
}

function rsvpContribution(s: GuestSignals): Contribution {
  const weight = RSVP_POINTS[s.rsvpStatus];
  const detail: Record<GuestSignals["rsvpStatus"], string> = {
    CHECKED_IN: "Already checked in at the door.",
    CONFIRMED: "Confirmed their RSVP.",
    WAITLISTED: "On the waitlist — they have asked for a seat but do not hold one.",
    INVITED: "Invited, but has not replied yet.",
    DECLINED: "Declined the invitation.",
    NO_SHOW: "Recorded as a no-show for this event.",
  };
  return { factor: "rsvp_commitment", weight, rank: 2, detail: detail[s.rsvpStatus] };
}

function opensContribution(s: GuestSignals): Contribution {
  const opens = Math.max(0, s.emailOpens);
  const weight = round((Math.min(opens, CAP.opens) / CAP.opens) * WORTH.opens, 1);
  return {
    factor: "email_opens",
    weight,
    rank: 3,
    detail:
      opens === 0
        ? "Has not opened a single email from this campaign."
        : `Opened ${plural(opens, "email")} from this campaign.`,
  };
}

function visitsContribution(s: GuestSignals, ctx: EventContext): Contribution {
  const visits = Math.max(0, s.pageVisits);
  const weight = round((Math.min(visits, CAP.visits) / CAP.visits) * WORTH.visits, 1);
  let detail: string;
  if (visits === 0) {
    detail = "Has never opened the event page.";
  } else if (s.lastSeenAt) {
    const gap = Math.max(0, daysBetween(s.lastSeenAt, ctx.asOf));
    detail = `Visited the event page ${plural(visits, "time")}, most recently ${plural(gap, "day")} before the doors open.`;
  } else {
    detail = `Visited the event page ${plural(visits, "time")}.`;
  }
  return { factor: "page_visits", weight, rank: 4, detail };
}

function recencyContribution(s: GuestSignals, ctx: EventContext): Contribution {
  if (!s.lastSeenAt) {
    return {
      factor: "activity_recency",
      weight: 0,
      rank: 5,
      detail: "We have no record of them looking at the event at all.",
    };
  }
  const gap = Math.max(0, daysBetween(s.lastSeenAt, ctx.asOf));
  const weight =
    gap <= 7 ? 12 : gap <= 14 ? 10 : gap <= 30 ? 7 : gap <= 60 ? 4 : gap <= 90 ? 2 : 1;
  const detail =
    gap <= 14
      ? `Last seen ${plural(gap, "day")} before the doors open — still warm.`
      : `Last seen ${plural(gap, "day")} before the doors open, and quiet since.`;
  return { factor: "activity_recency", weight, rank: 5, detail };
}

function registrationContribution(s: GuestSignals, ctx: EventContext): Contribution {
  if (!s.registeredAt) {
    return {
      factor: "registration_lead",
      weight: 0,
      rank: 6,
      detail: "Has not completed a registration.",
    };
  }
  const lead = Math.max(0, daysBetween(s.registeredAt, ctx.asOf));
  const early = lead >= 30;
  return {
    factor: "registration_lead",
    weight: early ? 10 : 6,
    rank: 6,
    detail: early
      ? `Registered a full ${plural(lead, "day")} ahead of the event — early bookers turn up.`
      : `Registered ${plural(lead, "day")} before the event.`,
  };
}

function sentimentContribution(s: GuestSignals): Contribution | null {
  const notes = (s.notes ?? "").toLowerCase().trim();
  if (!notes) {
    return {
      factor: "reply_sentiment",
      weight: 0,
      rank: 7,
      detail: "No reply from them on file, so there is no tone to read.",
    };
  }
  const positive = POSITIVE_PHRASES.filter((p) => notes.includes(p)).length;
  const negative = NEGATIVE_PHRASES.filter((p) => notes.includes(p)).length;
  const weight = clamp((positive - negative) * 5, -10, 10);
  const detail =
    weight > 0
      ? "Their last reply reads warmly."
      : weight < 0
        ? "Their last reply reads hesitantly — worth a human follow-up."
        : "They have replied, but the tone is neutral.";
  return { factor: "reply_sentiment", weight, rank: 7, detail };
}
