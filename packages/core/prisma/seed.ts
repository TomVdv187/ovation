/**
 * OVATION seed — "Meridian Summit 2026".
 *
 * Deterministic on purpose: a fixed PRNG seed means every agent, every eval and
 * every e2e run sees byte-identical guests. If you change the generator, expect
 * the Oracle's eval fixtures and the Treasury's revenue assertions to move.
 *
 * Target numbers the feature agents assert against:
 *   tickets  €28,140  (Early 95 x80 + Standard 145 x92 + VIP Table 1200 x6)
 *   sponsors €24,500  (Helvion 12,500 + Nexa 6,000 + Corda 6,000)
 */
// Use the shared client, not a fresh PrismaClient: it carries the Neon
// serverless adapter, so seeding works on networks that block port 5432.
import { db, Prisma } from "../src/db";

// ── deterministic randomness ──────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260924);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function int(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function chance(p: number): boolean {
  return rng() < p;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

// ── name pools (Benelux) ──────────────────────────────────────

const FIRST_NAMES = [
  "Lotte", "Jasper", "Fien", "Wout", "Marieke", "Bram", "Elke", "Stijn",
  "Anneleen", "Thijs", "Sofie", "Ruben", "Hanne", "Joris", "Evelien", "Sander",
  "Charlotte", "Maarten", "Griet", "Niels", "Katrien", "Pieter", "Lien", "Bart",
  "Amélie", "Guillaume", "Camille", "Antoine", "Margaux", "Florian", "Juliette",
  "Mathieu", "Céline", "Laurent", "Élodie", "Benoît", "Noémie", "Sébastien",
  "Femke", "Daan", "Sanne", "Thomas", "Jeroen", "Iris", "Bas", "Nienke",
  "Koen", "Roos", "Tim", "Anouk", "Vincent", "Saskia", "Willem", "Eline",
  "Michèle", "Pol", "Astrid", "Gilles", "Véronique", "Xavier",
] as const;

const LAST_NAMES = [
  "Peeters", "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes",
  "Goossens", "Wouters", "De Smet", "Dubois", "Lambert", "Dupont", "Martin",
  "Simon", "Leroy", "Lefebvre", "Renard", "Van den Berg", "De Vries",
  "Van Dijk", "Bakker", "Visser", "Smit", "Meijer", "Mulder", "De Boer",
  "Vermeulen", "Van Damme", "Coppens", "Segers", "Declercq", "Vandenberghe",
  "Verhoeven", "Michiels", "Cools", "Aerts", "Hermans", "Schmit", "Weber",
  "Thill", "Reuter", "Vanhove", "De Clercq", "Verstraeten", "Nijssen",
] as const;

const COMPANIES = [
  "Helvion Group", "Nexa Systems", "Corda Capital", "Meridian Partners",
  "Arclight Media", "Bruxelles Ventures", "Kestrel Logistics", "Vantage Pharma",
  "Northgate Bank", "Solvenda", "Delta Maritime", "Orbis Consulting",
  "Lumen Energy", "Ardent Legal", "Rivo Technologies", "Stellara Retail",
  "Quintessa", "Verdant Foods", "Atlas Insurance", "Caelum Aerospace",
  "Portmann & Co", "Silvex Industries", "Novara Health", "Brightwater",
  "Kaleido Studios", "Ferrum Steel", "Ondine Water", "Praxis Architects",
] as const;

const TITLES = [
  "CEO", "CFO", "COO", "Managing Director", "Head of Marketing",
  "Head of Partnerships", "VP Sales", "Innovation Lead", "Programme Director",
  "Board Member", "Chief of Staff", "Head of Communications", "Editor",
  "Senior Correspondent", "Investment Manager", "Product Director",
] as const;

const PRESS_OUTLETS = [
  "De Tijd", "L'Echo", "Trends Magazine", "Sprout", "Bloomberg Benelux",
  "Het Laatste Nieuws Business",
] as const;

const INTERESTS = [
  "sustainability", "AI", "fintech", "logistics", "circular economy",
  "leadership", "family business", "export markets", "private equity",
  "hospitality", "design", "energy transition", "talent", "regulation",
] as const;

const DOMAINS = ["com", "be", "nl", "eu", "lu"] as const;

function emailFor(first: string, last: string, company: string): string {
  const slugFirst = deaccent(first).toLowerCase().replace(/[^a-z]/g, "");
  const slugLast = deaccent(last).toLowerCase().replace(/[^a-z]/g, "");
  const slugCompany = deaccent(company)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
  return `${slugFirst}.${slugLast}@${slugCompany}.${pick(DOMAINS)}`;
}

function deaccent(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// ── the event ─────────────────────────────────────────────────

// Doors 18:30 CEST on 24 September 2026 == 16:30Z.
const EVENT_DATE = new Date("2026-09-24T16:30:00.000Z");
const EVENT_END = new Date("2026-09-24T21:00:00.000Z");
const NOW = new Date("2026-08-10T09:00:00.000Z");

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "tomvdvenne@gmail.com";

async function main() {
  console.log("→ resetting seed data");
  await db.organisation.deleteMany({ where: { slug: "meridian-collective" } });

  console.log("→ organisation + owner");
  const org = await db.organisation.create({
    data: {
      name: "Meridian Collective",
      slug: "meridian-collective",
      settings: {
        autoApproveCosmetic: false,
        defaultCurrency: "EUR",
        locale: "en-BE",
      },
    },
  });

  await db.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { organisationId: org.id, role: "OWNER" },
    create: {
      email: OWNER_EMAIL,
      name: "Tom Van Devenne",
      role: "OWNER",
      organisationId: org.id,
    },
  });

  console.log("→ event: Meridian Summit 2026");
  const event = await db.event.create({
    data: {
      organisationId: org.id,
      title: "Meridian Summit 2026",
      slug: "meridian-summit-2026",
      description:
        "An evening for the people who build Belgium's next decade — 250 founders, investors and operators at Horta Hall.",
      date: EVENT_DATE,
      endsAt: EVENT_END,
      timezone: "Europe/Brussels",
      venue: "Horta Hall",
      venueAddress: "Grasmarkt 105, 1000 Antwerpen",
      capacity: 250,
      currency: "EUR",
      status: "PUBLISHED",
      theme: {
        preset: "classic",
        palette: {},
        typography: {},
        dressCode: "Business",
        notes: "Launch theme. Flip preset to 'blacktie' to see the restyle.",
      },
      agenda: {
        items: [
          {
            id: "ag-doors",
            startsAt: "2026-09-24T16:30:00.000Z",
            endsAt: "2026-09-24T17:15:00.000Z",
            title: "Doors & welcome reception",
            kind: "DOORS",
            room: "Foyer",
          },
          {
            id: "ag-keynote",
            startsAt: "2026-09-24T17:15:00.000Z",
            endsAt: "2026-09-24T18:00:00.000Z",
            title: "Keynote — Building for the next decade",
            speaker: "Amélie Dubois",
            kind: "TALK",
            room: "Main Hall",
          },
          {
            id: "ag-panel",
            startsAt: "2026-09-24T18:00:00.000Z",
            endsAt: "2026-09-24T18:45:00.000Z",
            title: "Panel — Capital, talent and the Benelux advantage",
            speaker: "Moderated by Joris Vermeulen",
            kind: "PANEL",
            room: "Main Hall",
          },
          {
            id: "ag-dinner",
            startsAt: "2026-09-24T19:00:00.000Z",
            endsAt: "2026-09-24T20:30:00.000Z",
            title: "Seated dinner",
            kind: "DINNER",
            room: "Salon Horta",
          },
          {
            id: "ag-close",
            startsAt: "2026-09-24T20:30:00.000Z",
            endsAt: "2026-09-24T21:00:00.000Z",
            title: "Nightcap & networking",
            kind: "NETWORKING",
            room: "Foyer",
          },
        ],
      },
      registrationConfig: {
        fields: [
          { key: "name", label: "Full name", type: "text", required: true, options: [] },
          { key: "email", label: "Email", type: "email", required: true, options: [] },
          { key: "company", label: "Company", type: "text", required: false, options: [] },
          {
            key: "dietary",
            label: "Dietary requirements",
            type: "select",
            required: false,
            options: ["None", "Vegetarian", "Vegan", "Gluten-free", "Halal", "Other"],
          },
        ],
        collectDietary: true,
        allowPlusOnes: true,
        maxPlusOnes: 1,
        consentText:
          "We store your details to manage your attendance and will email you about this event only. You can ask us to delete them at any time.",
        waitlistWhenFull: true,
      },
      pageVisits: 4820,
      rsvpConversions: 178,
    },
  });

  console.log("→ ticket tiers");
  const early = await db.ticketTier.create({
    data: {
      eventId: event.id,
      name: "Early",
      description: "First 80 seats. Gone in nine days.",
      priceCents: 9500,
      quota: 80,
      sold: 80,
      status: "SOLD_OUT",
      sortOrder: 0,
    },
  });

  const standard = await db.ticketTier.create({
    data: {
      eventId: event.id,
      name: "Standard",
      description: "General admission, seated dinner included.",
      priceCents: 14500,
      quota: 120,
      sold: 92,
      status: "ON_SALE",
      sortOrder: 1,
      autoOpenRule: {
        when: { type: "PERCENT_SOLD", tierName: "Standard", percent: 90 },
        then: {
          openTier: { name: "Late", priceCents: 17500, quota: 30 },
        },
        autoFire: false,
      },
    },
  });

  const vip = await db.ticketTier.create({
    data: {
      eventId: event.id,
      name: "VIP Table",
      description: "Table of eight, front row, host at your table.",
      priceCents: 120000,
      quota: 10,
      sold: 6,
      status: "ON_SALE",
      sortOrder: 2,
    },
  });

  console.log("→ sponsors");
  await db.sponsor.createMany({
    data: [
      {
        eventId: event.id,
        name: "Helvion Group",
        package: "GOLD",
        amountCents: 1250000,
        status: "SIGNED",
        contactName: "Griet Segers",
        contactEmail: "griet.segers@helviongroup.be",
        entitlements: {
          logoPlacements: ["hero", "stage", "dinner menu", "email footer"],
          vipDinnerSeats: 8,
          targetAccountIntros: 5,
          standSize: "6x3m",
          speakingSlot: true,
        },
        targetAccounts: ["Northgate Bank", "Vantage Pharma", "Lumen Energy"],
        roiStats: {
          logoImpressions: 18400,
          leads: 26,
          meetings: 4,
          reportOpens: 6,
          benefitsPageClicks: 11,
          renewalIntent: "HIGH",
        },
        engagementScore: 78,
      },
      {
        eventId: event.id,
        name: "Nexa Systems",
        package: "SILVER",
        amountCents: 600000,
        status: "SIGNED",
        contactName: "Bram Willems",
        contactEmail: "bram.willems@nexasystems.com",
        entitlements: {
          logoPlacements: ["programme", "email footer"],
          vipDinnerSeats: 2,
          targetAccountIntros: 2,
          speakingSlot: false,
        },
        targetAccounts: ["Kestrel Logistics", "Delta Maritime", "Ferrum Steel"],
        roiStats: {
          logoImpressions: 9100,
          leads: 14,
          meetings: 2,
          reportOpens: 9,
          benefitsPageClicks: 17,
          renewalIntent: "MEDIUM",
        },
        // Deliberately above the default upsell threshold: the Treasury's
        // radar should surface Nexa as a Gold candidate on seed data alone.
        engagementScore: 72,
      },
      {
        eventId: event.id,
        name: "Corda Capital",
        package: "SILVER",
        amountCents: 600000,
        status: "SIGNED",
        contactName: "Laurent Renard",
        contactEmail: "laurent.renard@cordacapital.be",
        entitlements: {
          logoPlacements: ["programme"],
          vipDinnerSeats: 2,
          targetAccountIntros: 2,
          speakingSlot: false,
        },
        targetAccounts: ["Solvenda", "Orbis Consulting"],
        roiStats: {
          logoImpressions: 8700,
          leads: 9,
          meetings: 1,
          reportOpens: 2,
          benefitsPageClicks: 3,
          renewalIntent: "LOW",
        },
        engagementScore: 31,
      },
    ],
  });

  console.log("→ committed costs");
  await db.costEntry.createMany({
    data: [
      { eventId: event.id, label: "Horta Hall hire", category: "VENUE", amountCents: 850000, vendor: "Horta Hall" },
      { eventId: event.id, label: "Seated dinner, 250 covers", category: "CATERING", amountCents: 1125000, vendor: "Maison Tavernier" },
      { eventId: event.id, label: "Stage, sound & light", category: "PRODUCTION", amountCents: 470000, vendor: "Arclight Media" },
      { eventId: event.id, label: "Crew & hosts", category: "STAFF", amountCents: 180000 },
      { eventId: event.id, label: "Campaign & print", category: "MARKETING", amountCents: 95000, committed: false },
    ],
  });

  console.log("→ 200 guests");
  const usedEmails = new Set<string>();
  const guestRows: Prisma.GuestCreateManyInput[] = [];

  for (let i = 0; i < 200; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);

    // Roughly: 8% VIP, 30% client, 14% partner, 5% press, rest prospects.
    const roll = rng();
    const segment =
      roll < 0.08
        ? "VIP"
        : roll < 0.38
          ? "CLIENT"
          : roll < 0.52
            ? "PARTNER"
            : roll < 0.57
              ? "PRESS"
              : "PROSPECT";

    const company =
      segment === "PRESS" ? pick(PRESS_OUTLETS) : pick(COMPANIES);
    const title =
      segment === "PRESS"
        ? pick(["Editor", "Senior Correspondent", "Business Reporter"] as const)
        : segment === "VIP"
          ? pick(["CEO", "Managing Director", "Board Member", "CFO"] as const)
          : pick(TITLES);

    let email = emailFor(first, last, company);
    let suffix = 2;
    while (usedEmails.has(email)) {
      email = email.replace("@", `${suffix}@`);
      suffix++;
    }
    usedEmails.add(email);

    // rsvp mix: 178 of 200 land in a paid/confirmed state to match ticket sales.
    const rsvpRoll = rng();
    const rsvpStatus =
      rsvpRoll < 0.78
        ? "CONFIRMED"
        : rsvpRoll < 0.87
          ? "INVITED"
          : rsvpRoll < 0.94
            ? "WAITLISTED"
            : "DECLINED";

    const opens = segment === "VIP" ? int(2, 9) : int(0, 6);
    const clicks = Math.min(opens, int(0, 4));
    const visits = clicks > 0 ? int(1, 7) : int(0, 2);

    // Engagement leans on real signals so the Oracle's v1 rules have something
    // to reproduce; it will recompute and overwrite these.
    const base =
      opens * 6 + clicks * 9 + visits * 4 + (rsvpStatus === "CONFIRMED" ? 22 : 0);
    const engagementScore = Math.max(2, Math.min(100, base + int(-8, 8)));

    const noShowRisk =
      engagementScore > 62 ? "LOW" : engagementScore > 32 ? "MEDIUM" : "HIGH";
    const noShowProbability =
      noShowRisk === "LOW"
        ? 0.04 + rng() * 0.08
        : noShowRisk === "MEDIUM"
          ? 0.14 + rng() * 0.16
          : 0.34 + rng() * 0.3;

    const daysAgo = int(3, 60);
    const createdAt = new Date(NOW.getTime() - daysAgo * 86400000);

    guestRows.push({
      eventId: event.id,
      name: `${first} ${last}`,
      email,
      company,
      title,
      segment,
      rsvpStatus,
      engagementScore,
      engagementFactors: [
        { factor: "email_opens", weight: opens * 6, detail: `${opens} opens` },
        { factor: "link_clicks", weight: clicks * 9, detail: `${clicks} clicks` },
        { factor: "page_visits", weight: visits * 4, detail: `${visits} visits` },
      ],
      noShowRisk,
      noShowProbability: Number(noShowProbability.toFixed(3)),
      recoveryAction:
        noShowRisk === "HIGH"
          ? {
              action: chance(0.5) ? "RECONFIRMATION_EMAIL" : "PERSONAL_CALL",
              reason: "Low engagement and no page visit in the last 14 days.",
              dueBy: new Date(EVENT_DATE.getTime() - 7 * 86400000).toISOString(),
            }
          : Prisma.DbNull,
      dietary: chance(0.22)
        ? pick(["Vegetarian", "Vegan", "Gluten-free", "Halal"] as const)
        : null,
      plusOnes: segment === "VIP" && chance(0.6) ? 1 : chance(0.15) ? 1 : 0,
      interests: shuffle([...INTERESTS]).slice(0, int(1, 3)),
      whiteGlove:
        segment === "VIP"
          ? {
              transport: chance(0.5) ? "Car service from Antwerpen-Centraal" : null,
              seating: chance(0.7) ? "Table 1, near the stage" : null,
              dietary: null,
              host: chance(0.6) ? pick(["Lotte", "Joris", "Amélie"] as const) : null,
              done: [],
            }
          : Prisma.DbNull,
      source: "seed",
      emailOpens: opens,
      emailClicks: clicks,
      pageVisits: visits,
      lastSeenAt:
        visits > 0 ? new Date(NOW.getTime() - int(1, 21) * 86400000) : null,
      registeredAt: rsvpStatus === "CONFIRMED" ? createdAt : null,
      createdAt,
    });
  }

  await db.guest.createMany({ data: guestRows });

  console.log("→ orders matching ticket sales");
  const confirmed = await db.guest.findMany({
    where: { eventId: event.id, rsvpStatus: "CONFIRMED" },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const plan: Array<{ tierId: string; priceCents: number; count: number }> = [
    { tierId: early.id, priceCents: early.priceCents, count: early.sold },
    { tierId: standard.id, priceCents: standard.priceCents, count: standard.sold },
    { tierId: vip.id, priceCents: vip.priceCents, count: vip.sold },
  ];

  const orders: Prisma.OrderCreateManyInput[] = [];
  let cursor = 0;
  for (const line of plan) {
    for (let n = 0; n < line.count; n++) {
      const guest = confirmed[cursor % confirmed.length];
      cursor++;
      orders.push({
        eventId: event.id,
        tierId: line.tierId,
        guestId: guest?.id ?? null,
        email: guest?.email ?? `guest${cursor}@example.com`,
        quantity: 1,
        amountCents: line.priceCents,
        status: "PAID",
        createdAt: new Date(NOW.getTime() - int(2, 55) * 86400000),
      });
    }
  }
  await db.order.createMany({ data: orders });

  console.log("→ a small invite campaign");
  const campaignId = "seed-invite-wave-1";
  const inviteTargets = confirmed.slice(0, 40);
  await db.emailMessage.createMany({
    data: inviteTargets.map((g, i) => ({
      eventId: event.id,
      guestId: g.id,
      kind: "INVITE" as const,
      subject: "An evening at Horta Hall — 24 September",
      body: "Seeded invitation body.",
      personalised: false,
      status: "SENT" as const,
      campaignId,
      sentAt: new Date(NOW.getTime() - (30 - (i % 20)) * 86400000),
      openedAt:
        i % 3 === 0 ? new Date(NOW.getTime() - (25 - (i % 15)) * 86400000) : null,
    })),
  });

  console.log("→ open agent proposals for the console's 'needs your eye'");
  await db.agentAction.createMany({
    data: [
      {
        organisationId: org.id,
        eventId: event.id,
        type: "draft_emails",
        summary: "Re-confirm 23 guests at high no-show risk",
        payload: {
          type: "draft_emails",
          input: { eventId: event.id, guestIds: [], intent: "RECOVERY" },
        },
        sideEffects: [
          { label: "Sends personalised emails", count: 23, detail: "One per guest, written individually" },
        ],
        status: "PROPOSED",
        risk: "OUTBOUND",
        createdBy: "AGENT",
        createdAt: new Date(NOW.getTime() - 4 * 3600000),
      },
      {
        organisationId: org.id,
        eventId: event.id,
        type: "create_ticket_tier",
        summary: "Open a Late tier at €175 (30 seats) — Standard is 77% sold",
        payload: {
          type: "create_ticket_tier",
          input: {
            eventId: event.id,
            name: "Late",
            priceCents: 17500,
            quota: 30,
          },
        },
        sideEffects: [
          { label: "Adds a public ticket tier", count: 1 },
          { label: "Raises capacity pressure", detail: "178 of 250 seats sold" },
        ],
        status: "PROPOSED",
        risk: "OPERATIONAL",
        createdBy: "AGENT",
        createdAt: new Date(NOW.getTime() - 26 * 3600000),
      },
      {
        organisationId: org.id,
        eventId: event.id,
        type: "draft_sponsor_offer",
        summary: "Pitch Nexa Systems a Gold upgrade (+€6,500)",
        payload: {
          type: "draft_sponsor_offer",
          input: {
            eventId: event.id,
            sponsorId: "",
            targetPackage: "GOLD",
            incrementalAmountCents: 650000,
          },
        },
        sideEffects: [
          { label: "Emails the sponsor contact", count: 1 },
          { label: "Moves pipeline state", detail: "SIGNED → OFFERED" },
        ],
        status: "PROPOSED",
        risk: "OUTBOUND",
        createdBy: "AGENT",
        createdAt: new Date(NOW.getTime() - 2 * 3600000),
      },
    ],
  });

  console.log("→ previous edition, so revenue can show a delta");
  const prev = await db.event.create({
    data: {
      organisationId: org.id,
      title: "Meridian Summit 2025",
      slug: "meridian-summit-2025",
      date: new Date("2025-09-25T16:30:00.000Z"),
      timezone: "Europe/Brussels",
      venue: "De Studio",
      capacity: 180,
      status: "COMPLETED",
      theme: { preset: "classic" },
      agenda: { items: [] },
      registrationConfig: {},
      pageVisits: 3100,
      rsvpConversions: 141,
    },
  });

  await db.ticketTier.createMany({
    data: [
      { eventId: prev.id, name: "Early", priceCents: 8500, quota: 60, sold: 60, status: "SOLD_OUT", sortOrder: 0 },
      { eventId: prev.id, name: "Standard", priceCents: 12500, quota: 120, sold: 81, status: "CLOSED", sortOrder: 1 },
    ],
  });

  await db.sponsor.createMany({
    data: [
      { eventId: prev.id, name: "Helvion Group", package: "GOLD", amountCents: 1000000, status: "SERVICED" },
      { eventId: prev.id, name: "Corda Capital", package: "SILVER", amountCents: 500000, status: "SERVICED" },
    ],
  });

  await db.costEntry.createMany({
    data: [
      { eventId: prev.id, label: "De Studio hire", category: "VENUE", amountCents: 620000 },
      { eventId: prev.id, label: "Dinner, 180 covers", category: "CATERING", amountCents: 810000 },
      { eventId: prev.id, label: "Production", category: "PRODUCTION", amountCents: 350000 },
    ],
  });

  // ── report ──────────────────────────────────────────────────
  const ticketCents =
    early.priceCents * early.sold +
    standard.priceCents * standard.sold +
    vip.priceCents * vip.sold;
  const sponsorCents = 1250000 + 600000 + 600000;

  console.log("");
  console.log("  Seeded Meridian Summit 2026");
  console.log(`  guests            200`);
  console.log(`  tickets sold      ${early.sold + standard.sold + vip.sold}`);
  console.log(`  ticket revenue    €${(ticketCents / 100).toLocaleString("en-BE")}`);
  console.log(`  sponsor revenue   €${(sponsorCents / 100).toLocaleString("en-BE")}`);
  console.log(`  owner login       ${OWNER_EMAIL}`);
  console.log("");
}

main()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
