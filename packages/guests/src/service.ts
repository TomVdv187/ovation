import { TRPCError } from "@trpc/server";
import type { Db } from "@ovation/core/db";
import type { Assessment, EventContext, GuestSignals, ScoreOutcome, SeatPressure } from "./engine/types";
import { getEngine, runEngine } from "./engine/rules-v1";
import {
  emptySegmentationContext,
  normaliseCompany,
  type SegmentationContext,
} from "./engine/segmentation";
import {
  isPremiumTier,
  noTicket,
  toSignals,
  type EventRow,
  type GuestRow,
  type TicketFacts,
} from "./mappers";

/**
 * Everything that touches the database.
 *
 * The engine is pure, so this layer's whole job is to assemble its inputs: the
 * event, the guests, what each guest paid, and how each guest behaved at the
 * organisation's earlier events. Once assembled, one call to `runEngine` scores
 * the event and every procedure reads from the same result — which is why
 * `guests.list`, `guests.get` and `guests.score` can never disagree.
 */

/**
 * Guests scored per call. An event past this needs a paged scoring job rather
 * than a request-scoped one; at that point `guests.score` grows a cursor. The
 * seeded event is 200, and a large conference is a few thousand.
 */
export const MAX_SCORED_GUESTS = 20_000;

export interface ScoredEvent {
  event: EventRow;
  rows: GuestRow[];
  signals: Map<string, GuestSignals>;
  assessments: Map<string, Assessment>;
  outcomes: Map<string, ScoreOutcome>;
  tickets: Map<string, TicketFacts>;
  pressure: SeatPressure;
  context: EventContext;
  engineId: string;
}

const EVENT_SELECT = {
  id: true,
  organisationId: true,
  title: true,
  description: true,
  date: true,
  endsAt: true,
  timezone: true,
  venue: true,
  venueAddress: true,
  capacity: true,
  theme: true,
  agenda: true,
} as const;

/** Load an event, refusing to look at one that belongs to another organisation. */
export async function loadEvent(
  db: Db,
  eventId: string,
  organisationId: string,
): Promise<EventRow> {
  const event = await db.event.findFirst({
    where: { id: eventId, organisationId },
    select: EVENT_SELECT,
  });

  if (!event) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No event ${eventId} in this organisation.`,
    });
  }
  return event as EventRow;
}

export function eventContextOf(event: EventRow): EventContext {
  return {
    eventId: event.id,
    // Recency is measured against the event itself, never the wall clock. That
    // is what makes two runs of guests.score byte-identical.
    asOf: event.date,
    capacity: event.capacity,
    timezone: event.timezone,
  };
}

export async function loadScoredEvent(
  db: Db,
  event: EventRow,
  engineId?: string,
): Promise<ScoredEvent> {
  const rows = (await db.guest.findMany({
    where: { eventId: event.id },
    orderBy: { id: "asc" },
    take: MAX_SCORED_GUESTS,
  })) as unknown as GuestRow[];

  const [tickets, history] = await Promise.all([
    loadTickets(db, event.id),
    loadHistory(db, event, rows),
  ]);

  const context = eventContextOf(event);
  const signals = rows.map((row) =>
    toSignals(row, {
      ticket: tickets.get(row.id) ?? noTicket(),
      history: history.get(row.email.toLowerCase()) ?? { attended: 0, noShows: 0 },
    }),
  );

  const engine = getEngine(engineId);
  const { outcomes, pressure, assessments } = runEngine(engine, signals, context);

  return {
    event,
    rows,
    signals: new Map(signals.map((s) => [s.id, s])),
    assessments: new Map(assessments.map((a) => [a.guestId, a])),
    outcomes: new Map(outcomes.map((o) => [o.guestId, o])),
    tickets,
    pressure,
    context,
    engineId: engine.id,
  };
}

/** What each guest actually paid, and whether they bought a top-tier seat. */
async function loadTickets(db: Db, eventId: string): Promise<Map<string, TicketFacts>> {
  const orders = await db.order.findMany({
    where: { eventId, status: "PAID" },
    select: { guestId: true, amountCents: true, tier: { select: { name: true } } },
  });

  const tickets = new Map<string, TicketFacts>();
  for (const order of orders) {
    if (!order.guestId) continue;
    const current = tickets.get(order.guestId) ?? noTicket();
    const tierName = order.tier?.name ?? current.tierName;
    tickets.set(order.guestId, {
      paidCents: current.paidCents + order.amountCents,
      // Keep the best seat they bought, not the last one we happened to read.
      tierName: isPremiumTier(tierName) || !current.tierName ? tierName : current.tierName,
      premium: current.premium || isPremiumTier(order.tier?.name),
    });
  }
  return tickets;
}

/**
 * How these people behaved at the organisation's other events. Keyed by email,
 * because the same person is a separate Guest row per event.
 */
async function loadHistory(
  db: Db,
  event: EventRow,
  rows: GuestRow[],
): Promise<Map<string, { attended: number; noShows: number }>> {
  const history = new Map<string, { attended: number; noShows: number }>();
  if (rows.length === 0) return history;

  const past = await db.guest.findMany({
    where: {
      email: { in: rows.map((r) => r.email) },
      eventId: { not: event.id },
      rsvpStatus: { in: ["NO_SHOW", "CHECKED_IN"] },
      event: { organisationId: event.organisationId },
    },
    select: { email: true, rsvpStatus: true },
  });

  for (const entry of past) {
    const key = entry.email.toLowerCase();
    const current = history.get(key) ?? { attended: 0, noShows: 0 };
    if (entry.rsvpStatus === "CHECKED_IN") current.attended++;
    else current.noShows++;
    history.set(key, current);
  }
  return history;
}

export async function loadSegmentationContext(
  db: Db,
  eventId: string,
): Promise<SegmentationContext> {
  const sponsors = await db.sponsor.findMany({
    where: { eventId },
    select: { name: true, contactEmail: true },
  });

  const ctx = emptySegmentationContext();
  for (const sponsor of sponsors) {
    ctx.sponsorCompanies.add(normaliseCompany(sponsor.name));
    if (sponsor.contactEmail) ctx.sponsorContacts.add(sponsor.contactEmail.toLowerCase());
  }
  return ctx;
}

export async function loadOrganisationName(db: Db, organisationId: string): Promise<string> {
  const org = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { name: true },
  });
  return org?.name ?? "the organising team";
}

/**
 * Write updates in small waves.
 *
 * Not a transaction on purpose: scoring is deterministic and idempotent, so a
 * half-applied batch is repaired by the next run rather than corrupted by it.
 * The chunking is there to keep a 20,000-guest rescore from opening 20,000
 * connections at once.
 */
export async function applyInWaves<T>(
  items: readonly T[],
  apply: (item: T) => Promise<unknown>,
  waveSize = 25,
): Promise<number> {
  let applied = 0;
  for (let i = 0; i < items.length; i += waveSize) {
    const wave = items.slice(i, i + waveSize);
    await Promise.all(wave.map(apply));
    applied += wave.length;
  }
  return applied;
}
