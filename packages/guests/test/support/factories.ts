import type { GuestSignals } from "../../src/engine/types";
import type { EventRow, GuestRow } from "../../src/mappers";

/** Fixed points in time. Nothing in the engine reads a clock, so these are the clock. */
export const EVENT_DATE = new Date("2026-09-24T16:30:00.000Z");
export const EVENT_END = new Date("2026-09-24T21:00:00.000Z");

export function daysBefore(days: number, from: Date = EVENT_DATE): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

export const ORG_ID = "org-meridian";

export const EVENT: EventRow = {
  id: "evt-meridian-2026",
  organisationId: ORG_ID,
  title: "Meridian Summit 2026",
  description:
    "An evening for the people who build Belgium's next decade — 250 founders, investors and operators at Horta Hall.",
  date: EVENT_DATE,
  endsAt: EVENT_END,
  timezone: "Europe/Brussels",
  venue: "Horta Hall",
  venueAddress: "Grasmarkt 105, 1000 Antwerpen",
  capacity: 250,
  theme: { preset: "classic", dressCode: "Business" },
  agenda: {
    items: [
      { id: "ag-keynote", title: "Keynote — Building for the next decade", speaker: "Amélie Dubois", room: "Main Hall" },
      { id: "ag-dinner", title: "Seated dinner", room: "Salon Horta" },
    ],
  },
};

export function guestRow(overrides: Partial<GuestRow> & { id: string }): GuestRow {
  return {
    eventId: EVENT.id,
    name: "Lotte Peeters",
    email: `${overrides.id}@example.be`,
    company: "Helvion Group",
    title: "Head of Marketing",
    segment: "PROSPECT",
    rsvpStatus: "INVITED",
    engagementScore: 0,
    engagementFactors: [],
    noShowRisk: "LOW",
    noShowProbability: null,
    recoveryAction: null,
    dietary: null,
    plusOnes: 0,
    interests: [],
    notes: null,
    whiteGlove: null,
    source: "seed",
    emailOpens: 0,
    emailClicks: 0,
    pageVisits: 0,
    lastSeenAt: null,
    registeredAt: null,
    createdAt: daysBefore(90),
    updatedAt: daysBefore(90),
    ...overrides,
  };
}

export function signals(overrides: Partial<GuestSignals> & { id: string }): GuestSignals {
  return {
    name: "Lotte Peeters",
    email: `${overrides.id}@example.be`,
    company: "Helvion Group",
    title: "Head of Marketing",
    segment: "PROSPECT",
    rsvpStatus: "INVITED",
    emailOpens: 0,
    emailClicks: 0,
    pageVisits: 0,
    lastSeenAt: null,
    registeredAt: null,
    createdAt: daysBefore(90),
    plusOnes: 0,
    notes: null,
    paidCents: 0,
    history: { attended: 0, noShows: 0 },
    ...overrides,
  };
}
