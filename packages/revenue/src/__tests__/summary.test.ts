import { describe, expect, it } from "vitest";
import { buildRevenueSummary, computeEditionTotals, pickPreviousEdition } from "../summary";
import { previousEdition, seedEdition } from "./fixtures";

describe("revenue.summary on seed data", () => {
  const summary = buildRevenueSummary(seedEdition(), previousEdition());

  it("reports ticket revenue of €28,140", () => {
    expect(summary.tickets.totalCents).toBe(2_814_000);
    expect(summary.tickets.sold).toBe(178);
  });

  it("agrees with the 178 PAID order rows tier by tier", () => {
    // tier.sold x price is the summary's source; these are the same lines the
    // seed writes Order rows from, so the two must reconcile exactly.
    const fromOrders = 9500 * 80 + 14500 * 92 + 120000 * 6;
    expect(summary.tickets.totalCents).toBe(fromOrders);
    const perTier = Object.fromEntries(
      summary.tickets.byTier.map((tier) => [tier.name, tier.revenueCents]),
    );
    expect(perTier).toEqual({ Early: 760_000, Standard: 1_334_000, "VIP Table": 720_000 });
  });

  it("reports sponsor revenue of €24,500 across three signed sponsors", () => {
    expect(summary.sponsors.totalCents).toBe(2_450_000);
    expect(summary.sponsors.signed).toBe(3);
    expect(summary.sponsors.byPackage).toEqual([
      { package: "GOLD", count: 1, totalCents: 1_250_000 },
      { package: "SILVER", count: 2, totalCents: 1_200_000 },
    ]);
  });

  it("counts committed costs only — €26,250, excluding the €950 marketing plan", () => {
    expect(summary.costs.totalCents).toBe(2_625_000);
    expect(summary.costs.byCategory.map((c) => c.category)).not.toContain("MARKETING");
  });

  it("derives margin, margin percent and cost per attendee", () => {
    expect(summary.grossRevenueCents).toBe(5_264_000);
    expect(summary.marginCents).toBe(2_639_000);
    // The three headline numbers must be internally consistent on screen.
    expect(summary.grossRevenueCents - summary.costs.totalCents).toBe(summary.marginCents);
    expect(summary.marginPercent).toBe(50.13);
    // €26,250 over 178 paying attendees.
    expect(summary.costPerAttendeeCents).toBe(14_747);
  });

  it("diffs against the completed 2025 edition", () => {
    expect(summary.previousEdition).not.toBeNull();
    expect(summary.previousEdition?.grossRevenueCents).toBe(3_022_500); // €15,225 + €15,000
    expect(summary.previousEdition?.marginCents).toBe(1_242_500);
    expect(summary.previousEdition?.deltaPercent).toBe(74.16);
  });

  it("omits the delta when comparison is off", () => {
    expect(buildRevenueSummary(seedEdition(), null).previousEdition).toBeNull();
  });
});

describe("edge cases", () => {
  it("never divides by zero on a fresh event", () => {
    const totals = computeEditionTotals({
      id: "empty",
      currency: "EUR",
      capacity: 100,
      tiers: [{ id: "t", name: "General", priceCents: 5000, quota: 100, sold: 0, sortOrder: 0 }],
      sponsors: [],
      costs: [{ category: "VENUE", amountCents: 100_000, committed: true }],
    });
    expect(totals.marginPercent).toBe(0);
    // Falls back to capacity so the tile shows a planning number.
    expect(totals.costPerAttendeeCents).toBe(1000);
  });

  it("ignores sponsors that have not signed", () => {
    const edition = seedEdition();
    edition.sponsors.push({ package: "GOLD", amountCents: 9_999_999, status: "PROSPECT" });
    edition.sponsors.push({ package: "SILVER", amountCents: 8_888_888, status: "OFFERED" });
    expect(computeEditionTotals(edition).sponsorsCents).toBe(2_450_000);
  });

  it("picks the most recent completed edition before this one", () => {
    const current = { id: "now", date: new Date("2026-09-24"), status: "PUBLISHED" };
    const chosen = pickPreviousEdition(current, [
      current,
      { id: "old", date: new Date("2024-09-24"), status: "COMPLETED" },
      { id: "recent", date: new Date("2025-09-25"), status: "COMPLETED" },
      { id: "future", date: new Date("2027-09-24"), status: "COMPLETED" },
      { id: "draft", date: new Date("2026-01-01"), status: "DRAFT" },
    ]);
    expect(chosen?.id).toBe("recent");
  });
});
