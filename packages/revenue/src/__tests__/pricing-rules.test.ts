import { describe, expect, it } from "vitest";
import {
  evaluateAutoOpenRules,
  evaluateTrigger,
  parseAutoOpenRule,
  percentSold,
} from "../pricing/rules";
import type { TierSnapshot } from "../pricing/rules";
import { SEED_NOW, SEED_TIERS } from "./fixtures";

function tiersWithStandardSold(sold: number): TierSnapshot[] {
  return SEED_TIERS.map((tier) =>
    tier.name === "Standard" ? { ...tier, sold } : { ...tier },
  );
}

describe("the 90% Standard rule", () => {
  it("does not fire on untouched seed data (92 of 120 = 76.7%)", () => {
    const hits = evaluateAutoOpenRules({ tiers: tiersWithStandardSold(92), now: SEED_NOW });
    expect(hits).toEqual([]);
  });

  it("does not fire one sale short of the threshold (107 of 120 = 89.2%)", () => {
    const hits = evaluateAutoOpenRules({ tiers: tiersWithStandardSold(107), now: SEED_NOW });
    expect(hits).toEqual([]);
  });

  it("fires at exactly 90% — 108 of 120 — and asks for Late at €175 x 30", () => {
    const hits = evaluateAutoOpenRules({ tiers: tiersWithStandardSold(108), now: SEED_NOW });
    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.tierId).toBe("tier-standard");
    expect(hit.rule.then.openTier).toEqual({
      name: "Late",
      priceCents: 17_500,
      quota: 30,
    });
    expect(hit.reason).toContain("90%");
  });

  it("keeps firing above the threshold", () => {
    expect(
      evaluateAutoOpenRules({ tiers: tiersWithStandardSold(120), now: SEED_NOW }),
    ).toHaveLength(1);
  });

  it("stops once the Late tier exists — a cron must not re-propose it", () => {
    const tiers = tiersWithStandardSold(108);
    tiers.push({
      id: "tier-late",
      name: "Late",
      priceCents: 17_500,
      quota: 30,
      sold: 0,
      status: "ON_SALE",
    });
    expect(evaluateAutoOpenRules({ tiers, now: SEED_NOW })).toEqual([]);
  });

  it("matches the target tier name case-insensitively", () => {
    const tiers = tiersWithStandardSold(108);
    tiers.push({
      id: "tier-late",
      name: "  late ",
      priceCents: 17_500,
      quota: 30,
      sold: 0,
      status: "ON_SALE",
    });
    expect(evaluateAutoOpenRules({ tiers, now: SEED_NOW })).toEqual([]);
  });
});

describe("percentSold", () => {
  it("is exact at the boundary", () => {
    expect(percentSold({ quota: 120, sold: 108 })).toBe(90);
  });

  it("treats a zero-quota tier as unsellable rather than infinitely sold", () => {
    expect(percentSold({ quota: 0, sold: 0 })).toBe(0);
    expect(percentSold({ quota: 0, sold: 3 })).toBe(100);
  });
});

describe("other triggers", () => {
  const base: TierSnapshot[] = [
    { id: "a", name: "Early", priceCents: 9500, quota: 80, sold: 80, status: "SOLD_OUT" },
    { id: "b", name: "Standard", priceCents: 14500, quota: 120, sold: 40, status: "ON_SALE" },
  ];

  it("TIER_SOLD_OUT fires on a sold-out tier and not on an open one", () => {
    expect(
      evaluateTrigger({ type: "TIER_SOLD_OUT", tierName: "Early" }, { tiers: base, now: SEED_NOW })
        .fires,
    ).toBe(true);
    expect(
      evaluateTrigger(
        { type: "TIER_SOLD_OUT", tierName: "Standard" },
        { tiers: base, now: SEED_NOW },
      ).fires,
    ).toBe(false);
  });

  it("DATE fires once the date has passed", () => {
    expect(
      evaluateTrigger(
        { type: "DATE", at: new Date("2026-08-01T00:00:00Z") },
        { tiers: base, now: SEED_NOW },
      ).fires,
    ).toBe(true);
    expect(
      evaluateTrigger(
        { type: "DATE", at: new Date("2026-09-01T00:00:00Z") },
        { tiers: base, now: SEED_NOW },
      ).fires,
    ).toBe(false);
  });

  it("never fires when the named tier is missing", () => {
    const verdict = evaluateTrigger(
      { type: "PERCENT_SOLD", tierName: "Nonexistent", percent: 1 },
      { tiers: base, now: SEED_NOW },
    );
    expect(verdict.fires).toBe(false);
  });
});

describe("parseAutoOpenRule", () => {
  it("ignores null and malformed JSON rather than throwing", () => {
    expect(parseAutoOpenRule(null)).toBeNull();
    expect(parseAutoOpenRule({ when: { type: "NONSENSE" } })).toBeNull();
    expect(parseAutoOpenRule({ when: { type: "PERCENT_SOLD", tierName: "X" } })).toBeNull();
  });

  it("defaults autoFire to false", () => {
    const rule = parseAutoOpenRule({
      when: { type: "PERCENT_SOLD", tierName: "Standard", percent: 90 },
      then: { openTier: { name: "Late", priceCents: 17_500, quota: 30 } },
    });
    expect(rule?.autoFire).toBe(false);
  });

  it("a rule marked autoFire still only ever reaches the proposal stage", () => {
    // The safety property lives in the router (OPERATIONAL risk floor), but the
    // parser must not drop the flag on the floor either.
    const rule = parseAutoOpenRule({
      when: { type: "PERCENT_SOLD", tierName: "Standard", percent: 90 },
      then: { openTier: { name: "Late", priceCents: 17_500, quota: 30 } },
      autoFire: true,
    });
    expect(rule?.autoFire).toBe(true);
  });
});
