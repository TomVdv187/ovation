/**
 * @ovation/revenue — revenue, pricing and sponsors. Owned by Agent 4 · TREASURY.
 *
 * The console mounts this by changing one line in
 * apps/console/src/server/router.ts:
 *
 *   import { revenueRouter } from "@ovation/revenue";
 *   ...
 *   revenue: revenueRouter,
 *
 * Invariants this package holds:
 *  - all money crosses the wire as minor units (cents), integers, never floats;
 *  - a pricing rule that wants to fire emits an AgentAction PROPOSED — it
 *    never edits or creates a tier directly, even with autoFire: true, because
 *    the OPERATIONAL risk floor is never exempt from approval;
 *  - sponsor ROI reports are queued as EmailMessage PROPOSED — nothing here
 *    sends email, and no email provider SDK is imported;
 *  - upsell copy is grounded ONLY in the sponsor's observed activity, and the
 *    `evidence` array is the complete set of facts the copy may contain;
 *  - nothing in this package charges a card.
 *
 * Seed expectations: tickets €28,140 (2 814 000 cents), sponsors €24,500
 * (2 450 000 cents) for Meridian Summit 2026.
 */

export { revenueRouter, sweepAutoOpenRules, type SweepResult } from "./router";
export {
  runAutoOpenRuleSweep,
  runAutoOpenRuleSweepForOrganisation,
  type SweepOptions,
} from "./cron";

// ── the pieces, for tests, the agent's tool layer and the console ────────

export {
  formatCount,
  formatMoney,
  formatPercent,
  roundTo,
  roundUpTo,
  toCents,
} from "./money";

export {
  BOOKED_SPONSOR_STATUSES,
  buildRevenueSummary,
  computeEditionTotals,
  isBookedSponsor,
  pickPreviousEdition,
  type CostFacts,
  type EditionFacts,
  type EditionTotals,
  type SponsorFacts as SummarySponsorFacts,
  type TierFacts,
} from "./summary";

export {
  describeRuleHit,
  evaluateAutoOpenRules,
  evaluateTrigger,
  isSoldOut,
  parseAutoOpenRule,
  percentSold,
  type RuleContext,
  type RuleHit,
  type TierSnapshot,
  type TriggerVerdict,
} from "./pricing/rules";

export {
  buildPricingSuggestions,
  capacityHeadroom,
  forecastSelloutDate,
  tierVelocity,
  type PricingSuggestion,
  type PricingSuggestions,
  type SaleFact,
  type SuggestionInput,
  type TierVelocity,
} from "./pricing/suggestions";

export {
  companiesMatch,
  matchTargetAccounts,
  normaliseCompany,
  unmatchedTargetAccounts,
  type GuestFacts,
  type MatchedLead,
} from "./sponsors/match";

export {
  PACKAGE_ENTITLEMENTS,
  PACKAGE_LIST_PRICE_CENTS,
  describeUpgrade,
  entitlementDeltas,
  packageReference,
  parseEntitlements,
  type PackageReference,
  type SponsorEntitlements,
} from "./sponsors/packages";

export {
  PLACEMENT_WEIGHTS,
  buildRoiReport,
  estimateLogoImpressions,
  impressionMultiplier,
  isoWeekKey,
  parseRoiStats,
  placementWeight,
  scoreRenewalIntent,
  type RenewalInput,
  type RenewalSignal,
  type RoiInput,
  type RoiReport,
} from "./sponsors/roi";

export {
  escapeHtml,
  renderSponsorRoiEmail,
  sponsorRoiSubject,
  type RoiEmailInput,
} from "./sponsors/report-html";

export {
  buildEvidence,
  draftGoldOffer,
  findUpsellCandidates,
  groundingViolations,
  templateOffer,
  type DraftedOffer,
  type SponsorFacts,
  type UpsellCandidate,
  type UpsellContext,
} from "./sponsors/upsell";

export { REVENUE_MODEL, copywritingAvailable } from "./anthropic";

export const OWNER = "Agent 4 · TREASURY";
