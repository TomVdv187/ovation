import { describe, expect, it } from "vitest";
import {
  buildPricingSuggestions,
  capacityHeadroom,
  forecastSelloutDate,
  tierVelocity,
  type SaleFact,
} from "../pricing/suggestions";
import { CAPACITY, EVENT_DATE, SEED_NOW, SEED_TIERS } from "./fixtures";

const DAY = 86_400_000;

/** `count` evenly spaced sales for `tierId`, ending today. */
function sales(tierId: string, count: number, overDays: number, now: Date): SaleFact[] {
  return Array.from({ length: count }, (_, i) => ({
    tierId,
    at: new Date(now.getTime() - (overDays - (i * overDays) / count) * DAY),
  }));
}

describe("velocity", () => {
  it("measures to now, not to the last sale — a stalled tier reads as stalled", () => {
    const stalled = [
      { tierId: "t", at: new Date(SEED_NOW.getTime() - 60 * DAY) },
      { tierId: "t", at: new Date(SEED_NOW.getTime() - 59 * DAY) },
    ];
    const velocity = tierVelocity(stalled, SEED_NOW);
    expect(velocity.observedDays).toBe(60);
    expect(velocity.perDay).toBeCloseTo(2 / 60, 4);
  });

  it("does not forecast a sell-out this afternoon from a same-day burst", () => {
    const burst = Array.from({ length: 20 }, () => ({ tierId: "t", at: SEED_NOW }));
    expect(tierVelocity(burst, SEED_NOW).perDay).toBe(20); // floored at one day
  });

  it("is zero with no sales", () => {
    const velocity = tierVelocity([], SEED_NOW);
    expect(velocity.perDay).toBe(0);
    expect(velocity.firstSaleAt).toBeNull();
  });
});

describe("sell-out forecast", () => {
  const tier = { ...SEED_TIERS[1]! };

  it("returns null when nothing is selling", () => {
    expect(
      forecastSelloutDate(tier, tierVelocity([], SEED_NOW), SEED_NOW),
    ).toBeNull();
  });

  it("projects the remaining seats at the observed rate", () => {
    // 92 sold over 46 days = 2/day; 28 seats left = 14 days out.
    const velocity = tierVelocity(sales(tier.id, 92, 46, SEED_NOW), SEED_NOW);
    const forecast = forecastSelloutDate(tier, velocity, SEED_NOW);
    expect(forecast).not.toBeNull();
    const days = ((forecast as Date).getTime() - SEED_NOW.getTime()) / DAY;
    expect(days).toBeGreaterThan(12);
    expect(days).toBeLessThan(17);
  });

  it("says 'now' for a tier with nothing left", () => {
    const soldOut = { ...SEED_TIERS[0]! };
    expect(forecastSelloutDate(soldOut, tierVelocity([], SEED_NOW), SEED_NOW)).toEqual(SEED_NOW);
  });
});

describe("capacity headroom", () => {
  it("counts committed quota, not seats sold", () => {
    // 80 + 120 + 10 = 210 committed against a 250 room.
    expect(capacityHeadroom(SEED_TIERS, CAPACITY)).toBe(40);
  });

  it("never goes negative on an oversold room", () => {
    expect(capacityHeadroom(SEED_TIERS, 100)).toBe(0);
  });

  it("frees the quota of a closed tier", () => {
    const tiers = SEED_TIERS.map((tier) =>
      tier.name === "Early" ? { ...tier, status: "CLOSED" } : tier,
    );
    expect(capacityHeadroom(tiers, CAPACITY)).toBe(120);
  });
});

describe("suggestions on seed data", () => {
  const suggestions = buildPricingSuggestions({
    tiers: SEED_TIERS,
    sales: [
      ...sales("tier-early", 80, 40, SEED_NOW),
      ...sales("tier-standard", 92, 46, SEED_NOW),
      ...sales("tier-vip", 6, 50, SEED_NOW),
    ],
    capacity: CAPACITY,
    eventDate: EVENT_DATE,
    now: SEED_NOW,
    currency: "EUR",
  }).suggestions;

  const byTier = new Map(suggestions.map((s) => [s.tierId, s]));

  it("covers every tier exactly once", () => {
    expect(suggestions).toHaveLength(3);
  });

  it("wants new inventory behind the sold-out Early tier", () => {
    const early = byTier.get("tier-early")!;
    expect(early.kind).toBe("OPEN_NEW_TIER");
    expect(early.proposedQuota).toBeGreaterThan(0);
    expect(early.proposedQuota).toBeLessThanOrEqual(40); // within capacity headroom
    expect(early.proposedPriceCents).toBeGreaterThan(9500);
    expect(early.rationale).toContain("sold out");
  });

  it("wants more Standard seats while it is still selling", () => {
    const standard = byTier.get("tier-standard")!;
    expect(standard.kind).toBe("EXTEND_QUOTA");
    expect(standard.proposedQuota).toBeGreaterThan(120);
    expect(standard.selloutForecast).not.toBeNull();
  });

  it("never proposes more seats than the room can hold", () => {
    const proposedExtra = suggestions.reduce((sum, s) => {
      if (s.kind === "OPEN_NEW_TIER") return sum + (s.proposedQuota ?? 0);
      if (s.kind === "EXTEND_QUOTA" && s.tierId === "tier-standard")
        return sum + ((s.proposedQuota ?? 120) - 120);
      return sum;
    }, 0);
    expect(proposedExtra).toBeLessThanOrEqual(capacityHeadroom(SEED_TIERS, CAPACITY));
  });

  it("quotes real numbers in every rationale", () => {
    for (const suggestion of suggestions) {
      expect(suggestion.rationale.length).toBeGreaterThan(20);
      expect(suggestion.rationale).toMatch(/\d/);
    }
  });

  it("holds a tier that has not sold anything", () => {
    const quiet = buildPricingSuggestions({
      tiers: [
        {
          id: "t",
          name: "General",
          priceCents: 5000,
          quota: 100,
          sold: 0,
          status: "ON_SALE",
        },
      ],
      sales: [],
      capacity: 200,
      eventDate: EVENT_DATE,
      now: SEED_NOW,
      currency: "EUR",
    }).suggestions;
    expect(quiet[0]!.kind).toBe("HOLD");
    expect(quiet[0]!.selloutForecast).toBeNull();
  });

  it("holds rather than overselling when a sold-out tier has no room to grow", () => {
    const full = buildPricingSuggestions({
      tiers: [
        { id: "t", name: "Only", priceCents: 5000, quota: 100, sold: 100, status: "SOLD_OUT" },
      ],
      sales: sales("t", 100, 30, SEED_NOW),
      capacity: 100,
      eventDate: EVENT_DATE,
      now: SEED_NOW,
      currency: "EUR",
    }).suggestions;
    expect(full[0]!.kind).toBe("HOLD");
    expect(full[0]!.proposedQuota).toBeNull();
  });

  it("mirrors the organiser's own auto-open rule when it exists", () => {
    const soldOutStandard = SEED_TIERS.map((tier) =>
      tier.name === "Standard"
        ? { ...tier, sold: 120, status: "SOLD_OUT" }
        : { ...tier, status: "ON_SALE", sold: 0 },
    );
    const result = buildPricingSuggestions({
      tiers: soldOutStandard,
      sales: sales("tier-standard", 120, 40, SEED_NOW),
      capacity: 400, // plenty of headroom, so the rule's own numbers survive
      eventDate: EVENT_DATE,
      now: SEED_NOW,
      currency: "EUR",
    }).suggestions;
    const standard = result.find((s) => s.tierId === "tier-standard")!;
    expect(standard.kind).toBe("OPEN_NEW_TIER");
    expect(standard.proposedPriceCents).toBe(17_500);
    expect(standard.proposedQuota).toBe(30);
  });
});
