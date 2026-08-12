/**
 * Sponsor package catalogue and entitlement deltas.
 *
 * The catalogue is a *fallback*. Wherever possible the Gold reference price
 * and entitlements are derived from the Gold sponsors this event actually
 * signed, because that is a number the organiser can defend in the room:
 * "Gold at this event is €12,500" beats "our rate card says €12,500".
 */
import { sponsorEntitlementsSchema, type SponsorPackageT } from "@ovation/core";
import type { z } from "zod";
import { formatMoney } from "../money";

export type SponsorEntitlements = z.infer<typeof sponsorEntitlementsSchema>;

/** Rate-card fallback, used only when the event has no signed Gold sponsor. */
export const PACKAGE_LIST_PRICE_CENTS: Record<SponsorPackageT, number> = {
  GOLD: 1_250_000,
  SILVER: 600_000,
  CUSTOM: 0,
};

export const PACKAGE_ENTITLEMENTS: Record<SponsorPackageT, SponsorEntitlements> = {
  GOLD: sponsorEntitlementsSchema.parse({
    logoPlacements: ["hero", "stage", "dinner menu", "email footer"],
    vipDinnerSeats: 8,
    targetAccountIntros: 5,
    standSize: "6x3m",
    speakingSlot: true,
  }),
  SILVER: sponsorEntitlementsSchema.parse({
    logoPlacements: ["programme", "email footer"],
    vipDinnerSeats: 2,
    targetAccountIntros: 2,
    speakingSlot: false,
  }),
  CUSTOM: sponsorEntitlementsSchema.parse({}),
};

/** Parse the JSON entitlements column, falling back to the schema defaults. */
export function parseEntitlements(value: unknown): SponsorEntitlements {
  const parsed = sponsorEntitlementsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : sponsorEntitlementsSchema.parse({});
}

export interface PackageReference {
  package: SponsorPackageT;
  amountCents: number;
  entitlements: SponsorEntitlements;
  /** True when derived from a sponsor at this event rather than the rate card. */
  fromThisEvent: boolean;
}

interface SponsorLike {
  package: SponsorPackageT;
  amountCents: number;
  status: string;
  entitlements: unknown;
}

const BOOKED = new Set(["SIGNED", "SERVICED"]);

/**
 * What a package is worth at this event.
 *
 * Price is the median of the booked sponsors on that package — median rather
 * than max so one over-paying sponsor cannot inflate the ask. Entitlements
 * come from the sponsor on that package with the richest package (most logo
 * placements), which is what the upsell is actually offering.
 */
export function packageReference(
  sponsors: readonly SponsorLike[],
  target: SponsorPackageT,
): PackageReference {
  const peers = sponsors.filter(
    (s) => s.package === target && BOOKED.has(s.status) && s.amountCents > 0,
  );

  if (peers.length === 0) {
    return {
      package: target,
      amountCents: PACKAGE_LIST_PRICE_CENTS[target],
      entitlements: PACKAGE_ENTITLEMENTS[target],
      fromThisEvent: false,
    };
  }

  const amounts = peers.map((s) => s.amountCents).sort((a, b) => a - b);
  const mid = Math.floor(amounts.length / 2);
  const amountCents =
    amounts.length % 2 === 1
      ? (amounts[mid] as number)
      : Math.round(((amounts[mid - 1] as number) + (amounts[mid] as number)) / 2);

  const richest = peers
    .map((s) => parseEntitlements(s.entitlements))
    .sort(
      (a, b) =>
        b.logoPlacements.length - a.logoPlacements.length ||
        b.vipDinnerSeats - a.vipDinnerSeats ||
        b.targetAccountIntros - a.targetAccountIntros,
    )[0] as SponsorEntitlements;

  return { package: target, amountCents, entitlements: richest, fromThisEvent: true };
}

/**
 * Plain-English differences between two entitlement sets, one clause each.
 *
 * These strings become evidence for the upsell offer, so every one of them is
 * a comparison of two stored values — nothing is invented or rounded up.
 */
export function entitlementDeltas(
  from: SponsorEntitlements,
  to: SponsorEntitlements,
): string[] {
  const deltas: string[] = [];

  const have = new Set(from.logoPlacements.map((p) => p.trim().toLowerCase()));
  const added = to.logoPlacements.filter((p) => !have.has(p.trim().toLowerCase()));
  if (added.length > 0) {
    deltas.push(`Adds logo placement on ${formatList(added)}.`);
  }

  if (to.vipDinnerSeats > from.vipDinnerSeats) {
    deltas.push(
      `VIP dinner seats go from ${from.vipDinnerSeats} to ${to.vipDinnerSeats} (+${to.vipDinnerSeats - from.vipDinnerSeats}).`,
    );
  }

  if (to.targetAccountIntros > from.targetAccountIntros) {
    deltas.push(
      `Target-account introductions go from ${from.targetAccountIntros} to ${to.targetAccountIntros} (+${to.targetAccountIntros - from.targetAccountIntros}).`,
    );
  }

  if (to.speakingSlot && !from.speakingSlot) {
    deltas.push("Adds a speaking slot on the main stage.");
  }

  if (to.standSize && to.standSize !== from.standSize) {
    deltas.push(
      from.standSize
        ? `Stand grows from ${from.standSize} to ${to.standSize}.`
        : `Adds a ${to.standSize} stand.`,
    );
  }

  return deltas;
}

export function describeUpgrade(
  fromPackage: SponsorPackageT,
  fromAmountCents: number,
  reference: PackageReference,
  currency = "EUR",
): string {
  return `${titleCase(fromPackage)} at ${formatMoney(fromAmountCents, currency)} to ${titleCase(reference.package)} at ${formatMoney(reference.amountCents, currency)} — an increment of ${formatMoney(reference.amountCents - fromAmountCents, currency)}.`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function formatList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
