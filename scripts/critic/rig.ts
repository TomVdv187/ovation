/**
 * Agent 7 · CRITIC — adversarial test rig.
 *
 * Builds TWO organisations, each with its own event, guests and ticket tiers,
 * entirely separate from Meridian Summit 2026. Every destructive test in this
 * directory runs against these, never against the fixture event.
 *
 * Two orgs, not one, because half the interesting attacks are cross-tenant and
 * the seeded database has exactly one organisation — so a single-org rig cannot
 * even express the question.
 *
 * Everything it creates is prefixed `critic-` and removed by teardown().
 */
import { db } from "@ovation/core/db";

export const TAG = "critic";

export interface Rig {
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
  eventA: string;
  eventB: string;
  slugA: string;
  /** 10-seat tier on event A, used for the oversell test. */
  scarceTier: string;
  /** Roomy tier on event A. */
  roomyTier: string;
  guestsA: string[];
  guestB: string;
}

const NAMES = [
  "Ada Lovelace", "Grace Hopper", "Alan Turing", "Edsger Dijkstra",
  "Barbara Liskov", "Leslie Lamport", "Ken Thompson", "Margaret Hamilton",
];

export async function setup(): Promise<Rig> {
  await teardown();

  const orgA = await db.organisation.create({
    data: { name: "Critic Org A", slug: `${TAG}-org-a` },
  });
  const orgB = await db.organisation.create({
    data: { name: "Critic Org B", slug: `${TAG}-org-b` },
  });

  const userA = await db.user.create({
    data: {
      email: `${TAG}-a@example.invalid`,
      name: "Critic A",
      organisationId: orgA.id,
      role: "OWNER",
    },
  });
  const userB = await db.user.create({
    data: {
      email: `${TAG}-b@example.invalid`,
      name: "Critic B",
      organisationId: orgB.id,
      role: "OWNER",
    },
  });

  const soon = new Date(Date.now() + 30 * 24 * 3600_000);

  const eventA = await db.event.create({
    data: {
      organisationId: orgA.id,
      title: "Critic Rig A",
      slug: `${TAG}-rig-a`,
      date: soon,
      venue: "Rig Hall",
      capacity: 100,
      status: "PUBLISHED",
      theme: { preset: "classic" },
      agenda: {
        items: [
          {
            id: "doors",
            startsAt: new Date(Date.now() - 3600_000).toISOString(),
            title: "Doors",
            kind: "DOORS",
          },
          {
            id: "keynote",
            startsAt: new Date(Date.now() + 3600_000).toISOString(),
            title: "Keynote",
            kind: "TALK",
          },
        ],
      },
    },
  });

  const eventB = await db.event.create({
    data: {
      organisationId: orgB.id,
      title: "Critic Rig B",
      slug: `${TAG}-rig-b`,
      date: soon,
      venue: "Other Hall",
      capacity: 50,
      status: "PUBLISHED",
      theme: { preset: "classic" },
    },
  });

  const scarce = await db.ticketTier.create({
    data: {
      eventId: eventA.id,
      name: "Scarce",
      priceCents: 5000,
      quota: 10,
      sold: 0,
      currency: "EUR",
      status: "ON_SALE",
      sortOrder: 1,
    },
  });
  const roomy = await db.ticketTier.create({
    data: {
      eventId: eventA.id,
      name: "Roomy",
      priceCents: 1000,
      quota: 500,
      sold: 0,
      currency: "EUR",
      status: "ON_SALE",
      sortOrder: 2,
    },
  });

  const guestsA: string[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const g = await db.guest.create({
      data: {
        eventId: eventA.id,
        name: NAMES[i]!,
        email: `${TAG}-a${i}@example.invalid`,
        company: i % 2 === 0 ? "Rig Industries" : "Other Co",
        title: i === 0 ? "CEO" : "Engineer",
        segment: i === 0 ? "VIP" : "PROSPECT",
        rsvpStatus: "CONFIRMED",
        interests: ["ai", "events"],
        source: "seed",
      },
    });
    guestsA.push(g.id);
  }

  const guestB = await db.guest.create({
    data: {
      eventId: eventB.id,
      name: "Other Org Guest",
      email: `${TAG}-b0@example.invalid`,
      rsvpStatus: "CONFIRMED",
      source: "seed",
    },
  });

  return {
    orgA: orgA.id,
    orgB: orgB.id,
    userA: userA.id,
    userB: userB.id,
    eventA: eventA.id,
    eventB: eventB.id,
    slugA: eventA.slug,
    scarceTier: scarce.id,
    roomyTier: roomy.id,
    guestsA,
    guestB: guestB.id,
  };
}

export async function teardown(): Promise<void> {
  const orgs = await db.organisation.findMany({
    where: { slug: { startsWith: `${TAG}-` } },
    select: { id: true },
  });
  if (orgs.length === 0) return;
  const ids = orgs.map((o) => o.id);
  // Event -> Guest/Order/CheckIn/... all cascade from Organisation.
  await db.user.deleteMany({ where: { organisationId: { in: ids } } });
  await db.organisation.deleteMany({ where: { id: { in: ids } } });
}

/** A Context for a caller, as orgProcedure expects one. */
export function ctxFor(
  userId: string,
  organisationId: string,
  headers: Headers | null = null,
) {
  return {
    db,
    session: {
      user: {
        id: userId,
        email: `${userId}@example.invalid`,
        name: "Critic",
        organisationId,
        role: "OWNER" as const,
      },
    },
    headers,
  };
}

export function ok(name: string, detail = ""): void {
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

export function bad(name: string, detail = ""): void {
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  process.exitCode = 1;
}

export function note(name: string, detail = ""): void {
  console.log(`  NOTE  ${name}${detail ? ` — ${detail}` : ""}`);
}
