import type { Db } from "@ovation/core/db";
import type { EventRow, GuestRow } from "../../src/mappers";

/**
 * A tiny in-memory stand-in for the Prisma client.
 *
 * The tRPC context carries the client, so the router can be driven end to end
 * without a database. Unsupported query operators throw rather than quietly
 * returning the wrong rows — a fake that silently diverges from Prisma is worse
 * than no fake at all.
 */

export interface FakeOrder {
  id: string;
  eventId: string;
  guestId: string | null;
  amountCents: number;
  status: string;
  tier: { name: string } | null;
}

export interface FakeSponsor {
  id: string;
  eventId: string;
  name: string;
  contactEmail: string | null;
}

export interface FakeEmailMessage {
  id: string;
  eventId: string;
  guestId: string | null;
  kind: string;
  subject: string;
  body: string;
  personalised: boolean;
  status: string;
  campaignId: string | null;
}

export interface World {
  organisations: Array<{ id: string; name: string }>;
  events: EventRow[];
  guests: GuestRow[];
  orders: FakeOrder[];
  sponsors: FakeSponsor[];
  emails: FakeEmailMessage[];
}

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matches(row: Row, where: Where | undefined, world: World): boolean {
  if (!where) return true;

  for (const [key, condition] of Object.entries(where)) {
    if (key === "event") {
      const event = world.events.find((e) => e.id === row["eventId"]);
      if (!event) return false;
      if (!matches(event as unknown as Row, condition as Where, world)) return false;
      continue;
    }

    const value = row[key];

    if (condition !== null && typeof condition === "object") {
      const operators = condition as Record<string, unknown>;
      if ("in" in operators) {
        if (!(operators["in"] as unknown[]).includes(value)) return false;
        continue;
      }
      if ("not" in operators) {
        if (value === operators["not"]) return false;
        continue;
      }
      throw new Error(
        `fake-db: unsupported filter on "${key}": ${JSON.stringify(condition)}. Teach the fake this operator rather than working around it.`,
      );
    }

    if (value !== condition) return false;
  }

  return true;
}

type OrderBy = Record<string, "asc" | "desc">;

function sortRows<T extends Row>(rows: T[], orderBy: OrderBy | OrderBy[] | undefined): T[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];

  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause)) {
        const left = a[field];
        const right = b[field];
        let cmp = 0;
        if (typeof left === "string" && typeof right === "string") cmp = left.localeCompare(right, "en");
        else if (typeof left === "number" && typeof right === "number") cmp = left - right;
        else if (left instanceof Date && right instanceof Date) cmp = left.getTime() - right.getTime();
        if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
}

export interface FakeDb {
  client: Db;
  world: World;
  /** Every guest.update the router issued, in order. */
  writes: Array<{ id: string; data: Record<string, unknown> }>;
}

export function createFakeDb(world: World): FakeDb {
  const writes: FakeDb["writes"] = [];
  let emailSeq = 0;

  const client = {
    organisation: {
      findUnique: async ({ where }: { where: Where }) =>
        world.organisations.find((o) => matches(o as unknown as Row, where, world)) ?? null,
    },
    event: {
      findFirst: async ({ where }: { where: Where }) =>
        world.events.find((e) => matches(e as unknown as Row, where, world)) ?? null,
    },
    guest: {
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where?: Where;
        orderBy?: OrderBy | OrderBy[];
        take?: number;
      }) => {
        const rows = sortRows(
          world.guests.filter((g) => matches(g as unknown as Row, where, world)) as unknown as Row[],
          orderBy,
        );
        return typeof take === "number" ? rows.slice(0, take) : rows;
      },
      findFirst: async ({ where }: { where?: Where }) =>
        world.guests.find((g) => matches(g as unknown as Row, where, world)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const guest = world.guests.find((g) => g.id === where.id);
        if (!guest) throw new Error(`fake-db: no guest ${where.id}`);
        writes.push({ id: where.id, data });
        Object.assign(guest, data);
        return guest;
      },
    },
    order: {
      findMany: async ({ where }: { where?: Where }) =>
        world.orders.filter((o) => matches(o as unknown as Row, where, world)),
    },
    sponsor: {
      findMany: async ({ where }: { where?: Where }) =>
        world.sponsors.filter((s) => matches(s as unknown as Row, where, world)),
    },
    emailMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `email-${++emailSeq}`, ...data } as unknown as FakeEmailMessage;
        world.emails.push(row);
        return row;
      },
    },
  };

  return { client: client as unknown as Db, world, writes };
}
