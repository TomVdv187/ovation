/**
 * Seed fixtures — Meridian Summit 2026 / 2025, transcribed from
 * packages/core/prisma/seed.ts.
 *
 * These are the numbers the whole Treasury is asserted against. If the seed
 * moves, these move with it and the failures tell you exactly what shifted.
 */
import type { EditionFacts } from "../summary";
import type { TierSnapshot } from "../pricing/rules";
import type { SponsorFacts } from "../sponsors/upsell";
import type { GuestFacts } from "../sponsors/match";

export const EVENT_DATE = new Date("2026-09-24T16:30:00.000Z");
export const SEED_NOW = new Date("2026-08-10T09:00:00.000Z");
export const PAGE_VISITS = 4820;
export const CAPACITY = 250;

/** Ticket revenue €28,140 across 178 tickets. */
export const SEED_TIERS: TierSnapshot[] = [
  {
    id: "tier-early",
    name: "Early",
    priceCents: 9500,
    quota: 80,
    sold: 80,
    status: "SOLD_OUT",
  },
  {
    id: "tier-standard",
    name: "Standard",
    priceCents: 14500,
    quota: 120,
    sold: 92,
    status: "ON_SALE",
    autoOpenRule: {
      when: { type: "PERCENT_SOLD", tierName: "Standard", percent: 90 },
      then: { openTier: { name: "Late", priceCents: 17500, quota: 30 } },
      autoFire: false,
    },
  },
  {
    id: "tier-vip",
    name: "VIP Table",
    priceCents: 120000,
    quota: 10,
    sold: 6,
    status: "ON_SALE",
  },
];

export function seedEdition(): EditionFacts {
  return {
    id: "event-2026",
    currency: "EUR",
    capacity: CAPACITY,
    tiers: [
      { id: "tier-early", name: "Early", priceCents: 9500, quota: 80, sold: 80, sortOrder: 0 },
      {
        id: "tier-standard",
        name: "Standard",
        priceCents: 14500,
        quota: 120,
        sold: 92,
        sortOrder: 1,
      },
      {
        id: "tier-vip",
        name: "VIP Table",
        priceCents: 120000,
        quota: 10,
        sold: 6,
        sortOrder: 2,
      },
    ],
    sponsors: [
      { package: "GOLD", amountCents: 1_250_000, status: "SIGNED" },
      { package: "SILVER", amountCents: 600_000, status: "SIGNED" },
      { package: "SILVER", amountCents: 600_000, status: "SIGNED" },
    ],
    costs: [
      { category: "VENUE", amountCents: 850_000, committed: true },
      { category: "CATERING", amountCents: 1_125_000, committed: true },
      { category: "PRODUCTION", amountCents: 470_000, committed: true },
      { category: "STAFF", amountCents: 180_000, committed: true },
      { category: "MARKETING", amountCents: 95_000, committed: false },
    ],
  };
}

/** Meridian Summit 2025: tickets €15,225, sponsors €15,000. */
export function previousEdition(): EditionFacts {
  return {
    id: "event-2025",
    currency: "EUR",
    capacity: 180,
    tiers: [
      { id: "p-early", name: "Early", priceCents: 8500, quota: 60, sold: 60, sortOrder: 0 },
      {
        id: "p-standard",
        name: "Standard",
        priceCents: 12500,
        quota: 120,
        sold: 81,
        sortOrder: 1,
      },
    ],
    sponsors: [
      { package: "GOLD", amountCents: 1_000_000, status: "SERVICED" },
      { package: "SILVER", amountCents: 500_000, status: "SERVICED" },
    ],
    costs: [
      { category: "VENUE", amountCents: 620_000, committed: true },
      { category: "CATERING", amountCents: 810_000, committed: true },
      { category: "PRODUCTION", amountCents: 350_000, committed: true },
    ],
  };
}

export const SEED_SPONSORS: SponsorFacts[] = [
  {
    id: "sponsor-helvion",
    name: "Helvion Group",
    package: "GOLD",
    amountCents: 1_250_000,
    status: "SIGNED",
    contactName: "Griet Segers",
    entitlements: {
      logoPlacements: ["hero", "stage", "dinner menu", "email footer"],
      vipDinnerSeats: 8,
      targetAccountIntros: 5,
      standSize: "6x3m",
      speakingSlot: true,
    },
    roiStats: {
      logoImpressions: 18400,
      leads: 26,
      meetings: 4,
      reportOpens: 6,
      benefitsPageClicks: 11,
      renewalIntent: "HIGH",
    },
    engagementScore: 78,
    targetAccounts: ["Northgate Bank", "Vantage Pharma", "Lumen Energy"],
  },
  {
    id: "sponsor-nexa",
    name: "Nexa Systems",
    package: "SILVER",
    amountCents: 600_000,
    status: "SIGNED",
    contactName: "Bram Willems",
    entitlements: {
      logoPlacements: ["programme", "email footer"],
      vipDinnerSeats: 2,
      targetAccountIntros: 2,
      speakingSlot: false,
    },
    roiStats: {
      logoImpressions: 9100,
      leads: 14,
      meetings: 2,
      reportOpens: 9,
      benefitsPageClicks: 17,
      renewalIntent: "MEDIUM",
    },
    engagementScore: 72,
    targetAccounts: ["Kestrel Logistics", "Delta Maritime", "Ferrum Steel"],
  },
  {
    id: "sponsor-corda",
    name: "Corda Capital",
    package: "SILVER",
    amountCents: 600_000,
    status: "SIGNED",
    contactName: "Laurent Renard",
    entitlements: {
      logoPlacements: ["programme"],
      vipDinnerSeats: 2,
      targetAccountIntros: 2,
      speakingSlot: false,
    },
    roiStats: {
      logoImpressions: 8700,
      leads: 9,
      meetings: 1,
      reportOpens: 2,
      benefitsPageClicks: 3,
      renewalIntent: "LOW",
    },
    engagementScore: 31,
    targetAccounts: ["Solvenda", "Orbis Consulting"],
  },
];

export function guest(id: string, name: string, company: string | null): GuestFacts {
  return { id, name, company };
}

/** A handful of guests spanning matched, unmatched and messy company names. */
export const SEED_GUESTS: GuestFacts[] = [
  guest("g1", "Lotte Peeters", "Northgate Bank"),
  guest("g2", "Jasper Maes", "northgate bank"),
  guest("g3", "Fien Jacobs", "Vantage Pharma NV"),
  guest("g4", "Wout Claes", "Lumen Energy"),
  guest("g5", "Marieke Willems", "Kestrel Logistics"),
  guest("g6", "Bram De Smet", "Delta Maritime"),
  guest("g7", "Elke Goossens", "Ferrum Steel"),
  guest("g8", "Stijn Wouters", "Solvenda"),
  guest("g9", "Anneleen Dubois", "Orbis Consulting"),
  guest("g10", "Thijs Lambert", "Arclight Media"),
  guest("g11", "Sofie Dupont", null),
  guest("g12", "Ruben Martin", "Portmann & Co."),
];
