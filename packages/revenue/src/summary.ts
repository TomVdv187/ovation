/**
 * revenue.summary — the Overview dashboard aggregate.
 *
 * Pure math over plain shapes so it can be unit-tested without a database;
 * the router hydrates these shapes from ONE Prisma query (see router.ts).
 *
 * ── Two decisions worth stating up front ─────────────────────────────────
 *
 * 1. TICKET REVENUE COMES FROM `tier.sold x tier.priceCents`, not from summing
 *    PAID Order rows. `sold` is the denormalised counter the ticketing flow
 *    maintains and the same number the public page uses for availability, so
 *    the dashboard can never disagree with what a guest sees. It also keeps
 *    the whole summary to a single query with no per-tier fan-out. On the seed
 *    the two agree exactly (€28,140 across 178 tickets) and there is a test
 *    pinning that.
 *
 * 2. MARGIN USES COMMITTED COSTS ONLY. A cost with `committed = false` is a
 *    plan, not an obligation: the organiser can still cancel the marketing
 *    spend. Reporting a margin against money we have not agreed to spend
 *    understates profitability and makes the number un-actionable. The `costs`
 *    block therefore also reports the committed set, so
 *    `grossRevenue - costs.total === margin` always holds on screen.
 *    Seed: committed €26,250 (the €950 uncommitted marketing line is excluded).
 */
import type {
  CostCategoryT,
  RevenueSummary,
  SponsorPackageT,
  SponsorStatusT,
} from "@ovation/core";
import { roundTo, toCents } from "./money";

/** Sponsor pipeline states whose money is actually booked. */
export const BOOKED_SPONSOR_STATUSES: readonly SponsorStatusT[] = [
  "SIGNED",
  "SERVICED",
];

export interface TierFacts {
  id: string;
  name: string;
  priceCents: number;
  quota: number;
  sold: number;
  sortOrder: number;
}

export interface SponsorFacts {
  package: SponsorPackageT;
  amountCents: number;
  status: SponsorStatusT;
}

export interface CostFacts {
  category: CostCategoryT;
  amountCents: number;
  committed: boolean;
}

export interface EditionFacts {
  id: string;
  currency: string;
  capacity: number;
  tiers: TierFacts[];
  sponsors: SponsorFacts[];
  costs: CostFacts[];
}

export interface EditionTotals {
  ticketsCents: number;
  ticketsSold: number;
  byTier: RevenueSummary["tickets"]["byTier"];
  sponsorsCents: number;
  sponsorsBooked: number;
  byPackage: RevenueSummary["sponsors"]["byPackage"];
  committedCostCents: number;
  byCategory: RevenueSummary["costs"]["byCategory"];
  grossRevenueCents: number;
  marginCents: number;
  marginPercent: number;
  costPerAttendeeCents: number;
}

export function isBookedSponsor(sponsor: SponsorFacts): boolean {
  return BOOKED_SPONSOR_STATUSES.includes(sponsor.status);
}

export function computeEditionTotals(edition: EditionFacts): EditionTotals {
  const byTier = [...edition.tiers]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((tier) => ({
      tierId: tier.id,
      name: tier.name,
      priceCents: tier.priceCents,
      sold: tier.sold,
      quota: tier.quota,
      revenueCents: tier.priceCents * tier.sold,
    }));

  const ticketsCents = byTier.reduce((sum, t) => sum + t.revenueCents, 0);
  const ticketsSold = byTier.reduce((sum, t) => sum + t.sold, 0);

  const booked = edition.sponsors.filter(isBookedSponsor);
  const sponsorsCents = booked.reduce((sum, s) => sum + s.amountCents, 0);

  const packageTotals = new Map<SponsorPackageT, { count: number; totalCents: number }>();
  for (const sponsor of booked) {
    const bucket = packageTotals.get(sponsor.package) ?? { count: 0, totalCents: 0 };
    bucket.count += 1;
    bucket.totalCents += sponsor.amountCents;
    packageTotals.set(sponsor.package, bucket);
  }
  const byPackage = [...packageTotals.entries()]
    .map(([pkg, bucket]) => ({
      package: pkg,
      count: bucket.count,
      totalCents: bucket.totalCents,
    }))
    .sort((a, b) => b.totalCents - a.totalCents || a.package.localeCompare(b.package));

  // Committed only — see the header note.
  const committed = edition.costs.filter((cost) => cost.committed);
  const committedCostCents = committed.reduce((sum, c) => sum + c.amountCents, 0);

  const categoryTotals = new Map<CostCategoryT, number>();
  for (const cost of committed) {
    categoryTotals.set(
      cost.category,
      (categoryTotals.get(cost.category) ?? 0) + cost.amountCents,
    );
  }
  const byCategory = [...categoryTotals.entries()]
    .map(([category, totalCents]) => ({ category, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));

  const grossRevenueCents = ticketsCents + sponsorsCents;
  const marginCents = grossRevenueCents - committedCostCents;
  const marginPercent =
    grossRevenueCents === 0 ? 0 : roundTo((marginCents / grossRevenueCents) * 100, 2);

  // Cost per attendee is per PAYING attendee — that is who the catering,
  // seating and staffing is actually bought for. Before a single ticket sells
  // we fall back to capacity so the tile shows a planning number instead of
  // dividing by zero.
  const attendees = ticketsSold > 0 ? ticketsSold : edition.capacity > 0 ? edition.capacity : 1;
  const costPerAttendeeCents = toCents(committedCostCents / attendees);

  return {
    ticketsCents,
    ticketsSold,
    byTier,
    sponsorsCents,
    sponsorsBooked: booked.length,
    byPackage,
    committedCostCents,
    byCategory,
    grossRevenueCents,
    marginCents,
    marginPercent,
    costPerAttendeeCents,
  };
}

/**
 * Assemble the contract payload. `previous` is the most recent completed
 * edition before this one; the delta is on gross revenue, which is the number
 * an organiser quotes when they say "we're up on last year".
 */
export function buildRevenueSummary(
  current: EditionFacts,
  previous: EditionFacts | null,
): RevenueSummary {
  const totals = computeEditionTotals(current);

  let previousEdition: RevenueSummary["previousEdition"] = null;
  if (previous) {
    const prior = computeEditionTotals(previous);
    previousEdition = {
      grossRevenueCents: prior.grossRevenueCents,
      marginCents: prior.marginCents,
      deltaPercent:
        prior.grossRevenueCents === 0
          ? 0
          : roundTo(
              ((totals.grossRevenueCents - prior.grossRevenueCents) /
                prior.grossRevenueCents) *
                100,
              2,
            ),
    };
  }

  return {
    eventId: current.id,
    currency: current.currency,
    tickets: {
      totalCents: totals.ticketsCents,
      sold: totals.ticketsSold,
      byTier: totals.byTier,
    },
    sponsors: {
      totalCents: totals.sponsorsCents,
      signed: totals.sponsorsBooked,
      byPackage: totals.byPackage,
    },
    costs: {
      totalCents: totals.committedCostCents,
      byCategory: totals.byCategory,
    },
    grossRevenueCents: totals.grossRevenueCents,
    marginCents: totals.marginCents,
    marginPercent: totals.marginPercent,
    costPerAttendeeCents: totals.costPerAttendeeCents,
    previousEdition,
  };
}

/**
 * Pick the edition to compare against: same organisation, completed, dated
 * before this one, most recent first.
 */
export function pickPreviousEdition<T extends { id: string; date: Date; status: string }>(
  current: T,
  candidates: T[],
): T | null {
  const prior = candidates
    .filter(
      (e) =>
        e.id !== current.id &&
        e.status === "COMPLETED" &&
        e.date.getTime() < current.date.getTime(),
    )
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  return prior[0] ?? null;
}
