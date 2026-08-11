import { db, type Prisma } from "@ovation/core/db";
import {
  registrationConfigSchema,
  type RegistrationConfig,
  eventAgendaSchema,
  type AgendaItem,
} from "@ovation/core";

/**
 * Reads for the public surfaces. One place, so /e/[slug], the register form and
 * the ticket picker all agree on what "a public event" means.
 */

/** A draft event is not public. Preview mode is how the console sees one. */
export const PUBLIC_STATUSES = ["PUBLISHED", "LIVE"] as const;

export type PublicEvent = NonNullable<
  Awaited<ReturnType<typeof findPublicEvent>>
>;

export async function findPublicEvent(
  slug: string,
  preview = false,
  client: Prisma.TransactionClient | typeof db = db,
) {
  const event = await client.event.findUnique({
    where: { slug },
    include: {
      organisation: { select: { name: true, slug: true } },
      sponsors: {
        where: { status: { in: ["SIGNED", "SERVICED"] } },
        orderBy: [{ amountCents: "desc" }, { name: "asc" }],
        select: { id: true, name: true, package: true, logoUrl: true },
      },
      ticketTiers: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!event) return null;
  if (!preview && !(PUBLIC_STATUSES as readonly string[]).includes(event.status)) {
    return null;
  }
  return event;
}

/** Tolerant parse — a half-written config must not take the page down. */
export function parseRegistrationConfig(raw: unknown): RegistrationConfig {
  const parsed = registrationConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : registrationConfigSchema.parse({});
}

export function parseAgenda(raw: unknown): AgendaItem[] {
  const parsed = eventAgendaSchema.safeParse(raw ?? {});
  if (!parsed.success) return [];
  return [...parsed.data.items].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

/**
 * Seats consumed by people who are actually coming. A guest bringing a plus-one
 * occupies two chairs, so capacity has to count chairs, not rows.
 */
export async function seatsTaken(
  eventId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<number> {
  const attending = await client.guest.findMany({
    where: { eventId, rsvpStatus: { in: ["CONFIRMED", "CHECKED_IN"] } },
    select: { plusOnes: true },
  });
  return attending.reduce((total, guest) => total + 1 + guest.plusOnes, 0);
}

export interface TierAvailability {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  quota: number;
  sold: number;
  remaining: number;
  status: string;
  /** True when a guest can buy it right now: on sale, in window, seats left. */
  purchasable: boolean;
  soldOut: boolean;
}

export function tierAvailability(
  tier: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    quota: number;
    sold: number;
    status: string;
    opensAt: Date | null;
    closesAt: Date | null;
  },
  now = new Date(),
): TierAvailability {
  const remaining = Math.max(0, tier.quota - tier.sold);
  const open =
    tier.status === "ON_SALE" &&
    (!tier.opensAt || tier.opensAt <= now) &&
    (!tier.closesAt || tier.closesAt > now);

  return {
    id: tier.id,
    name: tier.name,
    description: tier.description,
    priceCents: tier.priceCents,
    currency: tier.currency,
    quota: tier.quota,
    sold: tier.sold,
    remaining,
    status: tier.status,
    purchasable: open && remaining > 0,
    soldOut: tier.status === "SOLD_OUT" || remaining === 0,
  };
}

/** Public base URL of this app — used in emails and Stripe redirects. */
export function eventsBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_EVENTS_URL?.replace(/\/$/, "") ??
    "http://localhost:3001"
  );
}
