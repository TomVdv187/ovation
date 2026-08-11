/**
 * @ovation/revenue — revenue, pricing and sponsors. Owned by Agent 4 · TREASURY.
 *
 * Build the real `revenueRouter` here with the SAME procedure signatures as the
 * contract stub in @ovation/core, then the console mounts it by changing one
 * line in apps/console/src/server/router.ts:
 *
 *   import { revenueRouter } from "@ovation/revenue";
 *   ...
 *   revenue: revenueRouter,
 *
 * Rules that are not yours to change:
 *  - all money crosses the wire as minor units (cents);
 *  - a pricing rule that wants to fire emits an AgentAction PROPOSED — it
 *    never edits a tier directly;
 *  - upsell copy is grounded ONLY in the sponsor's observed activity.
 *
 * Seed expectations: tickets €28,140, sponsors €24,500 for Meridian Summit 2026.
 */
export { revenueRouter } from "@ovation/core";

export const OWNER = "Agent 4 · TREASURY";
