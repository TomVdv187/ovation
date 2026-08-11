/**
 * Sales-velocity pricing suggestions.
 *
 * Deterministic and explainable: every suggestion carries a rationale built
 * from numbers we actually observed (orders per day, seats left, capacity
 * headroom). No model in the loop — an organiser has to be able to argue with
 * the arithmetic.
 */
import type { z } from "zod";
import type { pricingSuggestionsOutput } from "@ovation/core";
import { formatCount, formatMoney, formatPercent, roundTo, roundUpTo } from "../money";
import { parseAutoOpenRule, percentSold, type TierSnapshot } from "./rules";

export type PricingSuggestions = z.infer<typeof pricingSuggestionsOutput>;
export type PricingSuggestion = PricingSuggestions["suggestions"][number];

const DAY_MS = 86_400_000;

/** A PAID order, reduced to the two fields velocity needs. */
export interface SaleFact {
  tierId: string;
  at: Date;
}

export interface SuggestionInput {
  tiers: TierSnapshot[];
  sales: SaleFact[];
  /** Event capacity in the same units as tier quota — see the note below. */
  capacity: number;
  eventDate: Date;
  now: Date;
  currency: string;
}

export interface TierVelocity {
  /** Orders per day over the observed selling window. */
  perDay: number;
  firstSaleAt: Date | null;
  lastSaleAt: Date | null;
  observedDays: number;
  sampleSize: number;
}

/**
 * Sales per day, measured from the first observed sale to now.
 *
 * "To now" rather than "to the last sale" on purpose: a tier that sold hard
 * for a week and then went quiet is not still selling at last week's rate,
 * and a forecast built on the optimistic window would tell the organiser to
 * do nothing while the tier stalls.
 */
export function tierVelocity(sales: SaleFact[], now: Date): TierVelocity {
  if (sales.length === 0) {
    return { perDay: 0, firstSaleAt: null, lastSaleAt: null, observedDays: 0, sampleSize: 0 };
  }
  const times = sales.map((s) => s.at.getTime()).sort((a, b) => a - b);
  const first = times[0] as number;
  const last = times[times.length - 1] as number;
  // At least one day, so a same-day burst does not divide by ~0 and forecast
  // a sell-out this afternoon.
  const observedDays = Math.max(1, (now.getTime() - first) / DAY_MS);
  return {
    perDay: roundTo(sales.length / observedDays, 4),
    firstSaleAt: new Date(first),
    lastSaleAt: new Date(last),
    observedDays: roundTo(observedDays, 2),
    sampleSize: sales.length,
  };
}

/** When this tier runs out at the current rate. Null if it never will. */
export function forecastSelloutDate(
  tier: TierSnapshot,
  velocity: TierVelocity,
  now: Date,
): Date | null {
  const remaining = tier.quota - tier.sold;
  if (remaining <= 0) return now;
  if (velocity.perDay <= 0) return null;
  const days = remaining / velocity.perDay;
  // A forecast further out than a decade is noise, not information.
  if (!Number.isFinite(days) || days > 3650) return null;
  return new Date(now.getTime() + days * DAY_MS);
}

/**
 * Seats we can still commit without overselling the room.
 *
 * NOTE: this treats one unit of tier quota as one seat. "VIP Table" is really
 * a table of eight, so on the seed this is conservative by design — it will
 * never suggest opening more inventory than the venue can hold, and erring
 * toward under-offering is the right direction for a capacity number.
 */
export function capacityHeadroom(tiers: TierSnapshot[], capacity: number): number {
  const committedSeats = tiers
    .filter((tier) => tier.status !== "CLOSED")
    .reduce((sum, tier) => sum + Math.max(tier.quota, tier.sold), 0);
  return Math.max(0, capacity - committedSeats);
}

function isOnSale(tier: TierSnapshot): boolean {
  return tier.status === "ON_SALE" || tier.status === "DRAFT";
}

export function buildPricingSuggestions(input: SuggestionInput): PricingSuggestions {
  const { tiers, capacity, eventDate, now, currency } = input;
  const headroom = capacityHeadroom(tiers, capacity);
  const daysToDoors = Math.max(0, (eventDate.getTime() - now.getTime()) / DAY_MS);

  const salesByTier = new Map<string, SaleFact[]>();
  for (const sale of input.sales) {
    const bucket = salesByTier.get(sale.tierId);
    if (bucket) bucket.push(sale);
    else salesByTier.set(sale.tierId, [sale]);
  }

  const suggestions: PricingSuggestion[] = [];
  let headroomLeft = headroom;

  const ordered = [...tiers].sort((a, b) => b.priceCents - a.priceCents);

  for (const tier of ordered) {
    const velocity = tierVelocity(salesByTier.get(tier.id) ?? [], now);
    const forecast = forecastSelloutDate(tier, velocity, now);
    const remaining = Math.max(0, tier.quota - tier.sold);
    const pct = percentSold(tier);

    // ── 1. Sold out: the only way to sell more is new inventory. ──────────
    if (remaining === 0 && tier.status !== "CLOSED") {
      if (headroomLeft <= 0) {
        suggestions.push({
          tierId: tier.id,
          kind: "HOLD",
          rationale: `${tier.name} is sold out (${tier.sold} of ${tier.quota}) but the room has no capacity left to sell — hold.`,
          selloutForecast: forecast,
          proposedPriceCents: null,
          proposedQuota: null,
        });
        continue;
      }

      // Prefer the organiser's own rule if they wrote one; otherwise price the
      // next release above the tier that just sold out.
      const rule = parseAutoOpenRule(tier.autoOpenRule);
      const name = rule?.then.openTier.name ?? `${tier.name} — Release 2`;
      const priceCents =
        rule?.then.openTier.priceCents ?? roundUpTo(tier.priceCents * 1.2, 500);
      const quota = Math.min(rule?.then.openTier.quota ?? tier.quota, headroomLeft);
      headroomLeft -= quota;

      suggestions.push({
        tierId: tier.id,
        kind: "OPEN_NEW_TIER",
        rationale: `${tier.name} sold out at ${formatMoney(tier.priceCents, currency)} (${tier.sold} of ${tier.quota}). ${formatCount(headroom)} seats of capacity remain — open ${name} at ${formatMoney(priceCents, currency)} for ${quota}.`,
        selloutForecast: forecast,
        proposedPriceCents: priceCents,
        proposedQuota: quota,
      });
      continue;
    }

    if (!isOnSale(tier)) {
      continue; // CLOSED tiers with stock left are a deliberate choice.
    }

    // ── 2. On pace to sell out before doors: more of the same, if the room
    //      can take it. ──────────────────────────────────────────────────
    const sellsOutBeforeDoors =
      forecast !== null && forecast.getTime() <= eventDate.getTime();

    if (sellsOutBeforeDoors && headroomLeft > 0) {
      const extra = Math.min(headroomLeft, Math.max(1, Math.round(tier.quota * 0.25)));
      headroomLeft -= extra;
      const daysOut = roundTo(
        ((forecast as Date).getTime() - now.getTime()) / DAY_MS,
        1,
      );
      suggestions.push({
        tierId: tier.id,
        kind: "EXTEND_QUOTA",
        rationale: `${tier.name} is ${formatPercent(pct)} sold and selling ${roundTo(velocity.perDay, 2)}/day (${velocity.sampleSize} orders over ${velocity.observedDays} days). The last ${remaining} seats go in about ${daysOut} days, ${roundTo(daysToDoors, 0)} days before doors — raise the quota to ${tier.quota + extra} while demand holds.`,
        selloutForecast: forecast,
        proposedPriceCents: null,
        proposedQuota: tier.quota + extra,
      });
      continue;
    }

    // ── 3. Selling out well ahead of doors with no room to grow: the price
    //      is the lever left. ───────────────────────────────────────────────
    if (sellsOutBeforeDoors && headroomLeft === 0) {
      const proposed = roundUpTo(tier.priceCents * 1.1, 500);
      suggestions.push({
        tierId: tier.id,
        kind: "RAISE_PRICE",
        rationale: `${tier.name} is ${formatPercent(pct)} sold at ${roundTo(velocity.perDay, 2)}/day and will clear before doors, but the room is fully committed — raise the price to ${formatMoney(proposed, currency)} on the remaining ${remaining}.`,
        selloutForecast: forecast,
        proposedPriceCents: proposed,
        proposedQuota: null,
      });
      continue;
    }

    // ── 4. Everything else: hold, but show the forecast. ──────────────────
    suggestions.push({
      tierId: tier.id,
      kind: "HOLD",
      rationale:
        velocity.sampleSize === 0
          ? `${tier.name} has no sales yet (${tier.quota} available at ${formatMoney(tier.priceCents, currency)}) — hold and watch.`
          : `${tier.name} is ${formatPercent(pct)} sold at ${roundTo(velocity.perDay, 2)}/day; ${remaining} seats left and no sell-out expected before doors — hold.`,
      selloutForecast: forecast,
      proposedPriceCents: null,
      proposedQuota: null,
    });
  }

  return { suggestions };
}
