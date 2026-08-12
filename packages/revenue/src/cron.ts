/**
 * Queue / cron entry points.
 *
 * A scheduler has no tRPC context, so these bind the shared Prisma client and
 * call the same engine the router does. Same guarantee applies: a rule that
 * wants to fire produces an AgentAction with status PROPOSED, and nothing here
 * opens a tier, changes a price, or sends anything.
 */
import { db } from "@ovation/core/db";
import { sweepAutoOpenRules, type SweepResult } from "./router";

export interface SweepOptions {
  dryRun?: boolean;
  now?: Date;
}

/** Evaluate one event's pricing rules. */
export async function runAutoOpenRuleSweep(
  eventId: string,
  organisationId: string,
  options: SweepOptions = {},
): Promise<SweepResult> {
  return sweepAutoOpenRules(db, {
    eventId,
    organisationId,
    dryRun: options.dryRun ?? false,
    now: options.now,
  });
}

/**
 * Evaluate every published or live event in an organisation — the shape a
 * five-minute cron actually wants.
 */
export async function runAutoOpenRuleSweepForOrganisation(
  organisationId: string,
  options: SweepOptions = {},
): Promise<Map<string, SweepResult>> {
  const events = await db.event.findMany({
    where: { organisationId, status: { in: ["PUBLISHED", "LIVE"] } },
    select: { id: true },
  });

  const results = new Map<string, SweepResult>();
  for (const event of events) {
    results.set(event.id, await runAutoOpenRuleSweep(event.id, organisationId, options));
  }
  return results;
}
