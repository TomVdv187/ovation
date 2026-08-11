import { z } from "zod";
import {
  centsSchema,
  costCategorySchema,
  currencySchema,
  idSchema,
  sponsorPackageSchema,
  sponsorStatusSchema,
  ticketTierStatusSchema,
} from "./common";

/**
 * Revenue, ticketing rules and sponsors (implemented in packages/revenue).
 * Every amount on the wire is minor units.
 */

export const ticketTierSchema = z.object({
  id: idSchema,
  eventId: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  priceCents: centsSchema,
  currency: currencySchema,
  quota: z.number().int().nonnegative(),
  sold: z.number().int().nonnegative(),
  status: ticketTierStatusSchema,
  sortOrder: z.number().int(),
  opensAt: z.coerce.date().nullable(),
  closesAt: z.coerce.date().nullable(),
});
export type TicketTier = z.infer<typeof ticketTierSchema>;

/** Dynamic pricing rule stored on TicketTier.autoOpenRule. */
export const autoOpenTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TIER_SOLD_OUT"), tierName: z.string() }),
  z.object({
    type: z.literal("PERCENT_SOLD"),
    tierName: z.string(),
    percent: z.number().min(0).max(100),
  }),
  z.object({ type: z.literal("DATE"), at: z.coerce.date() }),
]);

export const autoOpenRuleSchema = z.object({
  when: autoOpenTriggerSchema,
  then: z.object({
    openTier: z.object({
      name: z.string(),
      priceCents: centsSchema,
      quota: z.number().int().positive(),
    }),
  }),
  /** Cosmetic rules can auto-fire; pricing changes propose by default. */
  autoFire: z.boolean().default(false),
});
export type AutoOpenRule = z.infer<typeof autoOpenRuleSchema>;

export const sponsorEntitlementsSchema = z.object({
  logoPlacements: z.array(z.string()).default([]),
  vipDinnerSeats: z.number().int().nonnegative().default(0),
  targetAccountIntros: z.number().int().nonnegative().default(0),
  standSize: z.string().nullish(),
  speakingSlot: z.boolean().default(false),
});

export const sponsorRoiStatsSchema = z.object({
  logoImpressions: z.number().int().nonnegative().default(0),
  leads: z.number().int().nonnegative().default(0),
  meetings: z.number().int().nonnegative().default(0),
  reportOpens: z.number().int().nonnegative().default(0),
  benefitsPageClicks: z.number().int().nonnegative().default(0),
  renewalIntent: z.enum(["UNKNOWN", "LOW", "MEDIUM", "HIGH"]).default("UNKNOWN"),
});
export type SponsorRoiStats = z.infer<typeof sponsorRoiStatsSchema>;

export const sponsorSchema = z.object({
  id: idSchema,
  eventId: idSchema,
  name: z.string(),
  package: sponsorPackageSchema,
  amountCents: centsSchema,
  currency: currencySchema,
  status: sponsorStatusSchema,
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  logoUrl: z.string().nullable(),
  entitlements: sponsorEntitlementsSchema,
  targetAccounts: z.array(z.string()),
  roiStats: sponsorRoiStatsSchema,
  engagementScore: z.number().int().min(0).max(100),
});
export type Sponsor = z.infer<typeof sponsorSchema>;

export const costEntrySchema = z.object({
  id: idSchema,
  eventId: idSchema,
  label: z.string(),
  category: costCategorySchema,
  amountCents: centsSchema,
  currency: currencySchema,
  committed: z.boolean(),
  vendor: z.string().nullable(),
});

// ── revenue.summary ───────────────────────────────────────────

export const revenueSummaryInput = z.object({
  eventId: idSchema,
  compareToPreviousEdition: z.boolean().default(true),
});

export const revenueSummaryOutput = z.object({
  eventId: idSchema,
  currency: currencySchema,
  tickets: z.object({
    totalCents: centsSchema,
    sold: z.number().int().nonnegative(),
    byTier: z.array(
      z.object({
        tierId: idSchema,
        name: z.string(),
        priceCents: centsSchema,
        sold: z.number().int().nonnegative(),
        quota: z.number().int().nonnegative(),
        revenueCents: centsSchema,
      }),
    ),
  }),
  sponsors: z.object({
    totalCents: centsSchema,
    signed: z.number().int().nonnegative(),
    byPackage: z.array(
      z.object({
        package: sponsorPackageSchema,
        count: z.number().int().nonnegative(),
        totalCents: centsSchema,
      }),
    ),
  }),
  costs: z.object({
    totalCents: centsSchema,
    byCategory: z.array(
      z.object({ category: costCategorySchema, totalCents: centsSchema }),
    ),
  }),
  grossRevenueCents: centsSchema,
  marginCents: centsSchema,
  marginPercent: z.number(),
  costPerAttendeeCents: centsSchema,
  previousEdition: z
    .object({
      grossRevenueCents: centsSchema,
      marginCents: centsSchema,
      deltaPercent: z.number(),
    })
    .nullable(),
});
export type RevenueSummary = z.infer<typeof revenueSummaryOutput>;

// ── revenue.pricing ───────────────────────────────────────────

export const pricingSuggestionsInput = z.object({ eventId: idSchema });

export const pricingSuggestionsOutput = z.object({
  suggestions: z.array(
    z.object({
      tierId: idSchema.nullable(),
      kind: z.enum(["OPEN_NEW_TIER", "RAISE_PRICE", "EXTEND_QUOTA", "HOLD"]),
      rationale: z.string(),
      selloutForecast: z.coerce.date().nullable(),
      proposedPriceCents: centsSchema.nullable(),
      proposedQuota: z.number().int().nullable(),
    }),
  ),
});

export const evaluateAutoOpenRulesInput = z.object({
  eventId: idSchema,
  /** Dry-run: report what would fire without emitting AgentActions. */
  dryRun: z.boolean().default(false),
});

export const evaluateAutoOpenRulesOutput = z.object({
  fired: z.array(
    z.object({
      tierId: idSchema,
      tierName: z.string(),
      rule: autoOpenRuleSchema,
      agentActionId: idSchema.nullable(),
    }),
  ),
});

// ── revenue.sponsors ──────────────────────────────────────────

export const sponsorListInput = z.object({
  eventId: idSchema,
  status: sponsorStatusSchema.optional(),
});

export const sponsorListOutput = z.object({ items: z.array(sponsorSchema) });

export const sponsorUpsellCandidatesInput = z.object({
  eventId: idSchema,
  /** Engagement score above which a Silver sponsor is worth a Gold pitch. */
  threshold: z.number().int().min(0).max(100).default(60),
});

export const sponsorUpsellCandidatesOutput = z.object({
  candidates: z.array(
    z.object({
      sponsorId: idSchema,
      name: z.string(),
      currentPackage: sponsorPackageSchema,
      suggestedPackage: sponsorPackageSchema,
      incrementalAmountCents: centsSchema,
      engagementScore: z.number().int(),
      /** Only real, observed activity — the offer copy must stay grounded. */
      evidence: z.array(z.string()),
      agentActionId: idSchema.nullable(),
    }),
  ),
});

// ── revenue.sponsorRoiReport ──────────────────────────────────

export const sponsorRoiReportInput = z.object({
  eventId: idSchema,
  sponsorId: idSchema.optional(),
});

export const sponsorRoiReportOutput = z.object({
  reports: z.array(
    z.object({
      sponsorId: idSchema,
      name: z.string(),
      stats: sponsorRoiStatsSchema,
      matchedLeads: z.array(
        z.object({
          guestId: idSchema,
          name: z.string(),
          company: z.string().nullable(),
        }),
      ),
      html: z.string().describe("Email-ready HTML body"),
      emailMessageId: idSchema.nullable(),
    }),
  ),
});
