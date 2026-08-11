import type { Guest, GuestSegmentT, NoShowRiskT, RsvpStatusT } from "@ovation/core";
import { recoveryActionSchema } from "@ovation/core";
import type { GuestSignals, ScoreOutcome } from "./engine/types";
import { emptyHistory } from "./engine/types";
import { readWhiteGlove } from "./engine/white-glove";
import type { AgendaHighlight, EventFacts, GuestFacts } from "./invites/types";

/**
 * Row shapes and the translation into engine/writer inputs.
 *
 * The row interfaces mirror the Prisma models structurally rather than importing
 * their generated types. That keeps the engine testable against plain objects —
 * every scoring test in this package runs without a database.
 */

export interface GuestRow {
  id: string;
  eventId: string;
  name: string;
  email: string;
  company: string | null;
  title: string | null;
  segment: GuestSegmentT;
  rsvpStatus: RsvpStatusT;
  engagementScore: number;
  engagementFactors: unknown;
  noShowRisk: NoShowRiskT;
  noShowProbability: number | null;
  recoveryAction: unknown;
  dietary: string | null;
  plusOnes: number;
  interests: string[];
  notes: string | null;
  whiteGlove: unknown;
  source: string;
  emailOpens: number;
  emailClicks: number;
  pageVisits: number;
  lastSeenAt: Date | null;
  registeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventRow {
  id: string;
  organisationId: string;
  title: string;
  description: string | null;
  date: Date;
  endsAt: Date | null;
  timezone: string;
  venue: string;
  venueAddress: string | null;
  capacity: number;
  theme: unknown;
  agenda: unknown;
}

/** What a guest has actually bought for this event. */
export interface TicketFacts {
  paidCents: number;
  tierName: string | null;
  /** A table, a VIP seat — the tiers that come with an expectation of being looked after. */
  premium: boolean;
}

export function noTicket(): TicketFacts {
  return { paidCents: 0, tierName: null, premium: false };
}

export interface GuestEnrichment {
  ticket: TicketFacts;
  history: { attended: number; noShows: number };
}

export function toSignals(row: GuestRow, enrichment?: Partial<GuestEnrichment>): GuestSignals {
  const ticket = enrichment?.ticket ?? noTicket();
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    title: row.title,
    segment: row.segment,
    rsvpStatus: row.rsvpStatus,
    emailOpens: row.emailOpens,
    emailClicks: row.emailClicks,
    pageVisits: row.pageVisits,
    lastSeenAt: row.lastSeenAt,
    registeredAt: row.registeredAt,
    createdAt: row.createdAt,
    plusOnes: row.plusOnes,
    notes: row.notes,
    paidCents: ticket.paidCents,
    history: enrichment?.history ?? emptyHistory(),
  };
}

export function toGuestFacts(row: GuestRow, ticket: TicketFacts = noTicket()): GuestFacts {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    title: row.title,
    segment: row.segment,
    rsvpStatus: row.rsvpStatus,
    interests: row.interests,
    dietary: row.dietary,
    notes: row.notes,
    plusOnes: row.plusOnes,
    emailOpens: row.emailOpens,
    emailClicks: row.emailClicks,
    pageVisits: row.pageVisits,
    lastSeenAt: row.lastSeenAt,
    registeredAt: row.registeredAt,
    ticketTier: ticket.tierName,
  };
}

export function toEventFacts(event: EventRow, organiser: string): EventFacts {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    date: event.date,
    endsAt: event.endsAt,
    timezone: event.timezone,
    venue: event.venue,
    venueAddress: event.venueAddress,
    capacity: event.capacity,
    dressCode: readDressCode(event.theme),
    organiser,
    agenda: readAgenda(event.agenda),
  };
}

/**
 * The contract `Guest`, with the freshly computed score rather than whatever is
 * sitting in the column. `guests.score` is what makes the two agree; until it
 * has run, the computed value is the honest one.
 */
export function toContractGuest(row: GuestRow, outcome?: ScoreOutcome): Guest {
  const storedAction = recoveryActionSchema.safeParse(row.recoveryAction);
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    email: row.email,
    company: row.company,
    title: row.title,
    segment: row.segment,
    rsvpStatus: row.rsvpStatus,
    engagementScore: outcome?.engagementScore ?? row.engagementScore,
    engagementFactors: outcome?.factors ?? readFactors(row.engagementFactors),
    noShowRisk: outcome?.noShowRisk ?? row.noShowRisk,
    noShowProbability: outcome?.noShowProbability ?? row.noShowProbability,
    recoveryAction: outcome?.recoveryAction ?? (storedAction.success ? storedAction.data : null),
    dietary: row.dietary,
    plusOnes: row.plusOnes,
    interests: row.interests,
    notes: row.notes,
    whiteGlove: row.whiteGlove === null || row.whiteGlove === undefined ? null : readWhiteGlove(row.whiteGlove),
    source: row.source,
    emailOpens: row.emailOpens,
    emailClicks: row.emailClicks,
    pageVisits: row.pageVisits,
    lastSeenAt: row.lastSeenAt,
    registeredAt: row.registeredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function readFactors(raw: unknown): Guest["engagementFactors"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record["factor"] !== "string" || typeof record["detail"] !== "string") return [];
    return [
      {
        factor: record["factor"],
        weight: typeof record["weight"] === "number" ? record["weight"] : 0,
        detail: record["detail"],
      },
    ];
  });
}

function readDressCode(theme: unknown): string | null {
  if (typeof theme !== "object" || theme === null) return null;
  const value = (theme as Record<string, unknown>)["dressCode"];
  return typeof value === "string" && value.trim() ? value : null;
}

function readAgenda(agenda: unknown): AgendaHighlight[] {
  if (typeof agenda !== "object" || agenda === null) return [];
  const items = (agenda as Record<string, unknown>)["items"];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const title = record["title"];
    if (typeof title !== "string") return [];
    return [
      {
        title,
        speaker: typeof record["speaker"] === "string" ? record["speaker"] : null,
        room: typeof record["room"] === "string" ? record["room"] : null,
      },
    ];
  });
}

/** Ticket tiers whose buyers are treated as top-tier guests. */
const PREMIUM_TIER = /\b(vip|table|patron|founder|platinum|gold)\b/i;

export function isPremiumTier(tierName: string | null | undefined): boolean {
  return typeof tierName === "string" && PREMIUM_TIER.test(tierName);
}
