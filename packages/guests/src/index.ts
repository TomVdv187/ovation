/**
 * @ovation/guests — guest intelligence. Owned by Agent 3 · ORACLE.
 *
 * Build the real `guestsRouter` here with the SAME procedure signatures as the
 * contract stub in @ovation/core (packages/core/src/trpc/routers/guests.ts),
 * then the console mounts it by changing one line in
 * apps/console/src/server/router.ts:
 *
 *   import { guestsRouter } from "@ovation/guests";
 *   ...
 *   guests: guestsRouter,
 *
 * Rules that are not yours to change:
 *  - every score returns its top-3 factors (deterministic, explainable);
 *  - risk always comes with a recommended recovery action;
 *  - personaliseInvite writes EmailMessage rows as PROPOSED and NEVER sends.
 */
export { guestsRouter } from "@ovation/core";

export const OWNER = "Agent 3 · ORACLE";
