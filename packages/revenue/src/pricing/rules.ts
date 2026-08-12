/**
 * Dynamic pricing rules — the evaluation half.
 *
 * This module decides *whether* a TicketTier.autoOpenRule wants to fire. It
 * never touches the database and never opens a tier: firing produces a
 * `RuleHit`, and the router turns that into an AgentAction with status
 * PROPOSED for the organiser to approve. See router.ts for the safety gate.
 */
import { autoOpenRuleSchema, type AutoOpenRule } from "@ovation/core";
import { formatMoney, formatPercent, roundTo } from "../money";

/** Comparisons at the boundary must not lose to binary float noise. */
const EPSILON = 1e-9;

export interface TierSnapshot {
  id: string;
  name: string;
  priceCents: number;
  quota: number;
  sold: number;
  status: string;
  /** Raw JSON column; parsed defensively. */
  autoOpenRule?: unknown;
}

export interface RuleContext {
  tiers: TierSnapshot[];
  now: Date;
  currency?: string;
}

export interface RuleHit {
  tierId: string;
  tierName: string;
  rule: AutoOpenRule;
  /** Human sentence for the proposal card — every number in it is observed. */
  reason: string;
}

/** Percent of a tier's quota that has sold. A zero-quota tier is never "sold". */
export function percentSold(tier: Pick<TierSnapshot, "quota" | "sold">): number {
  if (tier.quota <= 0) return tier.sold > 0 ? 100 : 0;
  return (tier.sold / tier.quota) * 100;
}

export function isSoldOut(tier: TierSnapshot): boolean {
  return tier.status === "SOLD_OUT" || (tier.quota > 0 && tier.sold >= tier.quota);
}

function findTier(tiers: TierSnapshot[], name: string): TierSnapshot | undefined {
  const wanted = name.trim().toLowerCase();
  return tiers.find((tier) => tier.name.trim().toLowerCase() === wanted);
}

/** Parse a JSON autoOpenRule column. Malformed rules are ignored, not thrown. */
export function parseAutoOpenRule(value: unknown): AutoOpenRule | null {
  if (value == null) return null;
  const parsed = autoOpenRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface TriggerVerdict {
  fires: boolean;
  reason: string;
}

/**
 * Evaluate a single trigger against the current tier snapshot.
 *
 * PERCENT_SOLD fires at *or above* the threshold — a rule written for 90%
 * must fire the moment the tier touches 90%, not one sale later.
 */
export function evaluateTrigger(
  trigger: AutoOpenRule["when"],
  ctx: RuleContext,
): TriggerVerdict {
  switch (trigger.type) {
    case "PERCENT_SOLD": {
      const tier = findTier(ctx.tiers, trigger.tierName);
      if (!tier) {
        return { fires: false, reason: `No tier named "${trigger.tierName}".` };
      }
      const pct = percentSold(tier);
      const fires = pct + EPSILON >= trigger.percent;
      const detail = `${tier.name} is ${formatPercent(pct)} sold (${tier.sold} of ${tier.quota}), threshold ${formatPercent(trigger.percent)}`;
      return {
        fires,
        reason: fires ? `${detail} — reached.` : `${detail} — not reached.`,
      };
    }
    case "TIER_SOLD_OUT": {
      const tier = findTier(ctx.tiers, trigger.tierName);
      if (!tier) {
        return { fires: false, reason: `No tier named "${trigger.tierName}".` };
      }
      const fires = isSoldOut(tier);
      const detail = `${tier.name} is ${tier.sold} of ${tier.quota} sold`;
      return {
        fires,
        reason: fires ? `${detail} — sold out.` : `${detail} — not sold out.`,
      };
    }
    case "DATE": {
      const fires = ctx.now.getTime() >= trigger.at.getTime();
      const at = trigger.at.toISOString().slice(0, 10);
      return {
        fires,
        reason: fires ? `Scheduled date ${at} has passed.` : `Scheduled for ${at}.`,
      };
    }
    default: {
      // Exhaustive: a new trigger type must be handled explicitly rather than
      // silently defaulting to "fire".
      const never: never = trigger;
      return { fires: false, reason: `Unsupported trigger ${JSON.stringify(never)}.` };
    }
  }
}

/**
 * Which rules want to fire right now.
 *
 * A rule is suppressed when the tier it would open already exists — the rule
 * has done its job and re-proposing it would be noise on every cron tick.
 */
export function evaluateAutoOpenRules(ctx: RuleContext): RuleHit[] {
  const hits: RuleHit[] = [];

  for (const tier of ctx.tiers) {
    const rule = parseAutoOpenRule(tier.autoOpenRule);
    if (!rule) continue;

    const verdict = evaluateTrigger(rule.when, ctx);
    if (!verdict.fires) continue;

    if (findTier(ctx.tiers, rule.then.openTier.name)) {
      continue; // Target tier already exists — nothing to open.
    }

    const target = rule.then.openTier;
    hits.push({
      tierId: tier.id,
      tierName: tier.name,
      rule,
      reason: `${verdict.reason} Opens ${target.name} at ${formatMoney(target.priceCents, ctx.currency ?? "EUR")} for ${target.quota} seats.`,
    });
  }

  return hits;
}

/** One-line summary for the AgentAction card. */
export function describeRuleHit(hit: RuleHit, currency = "EUR"): string {
  const target = hit.rule.then.openTier;
  const pctOf = hit.rule.when.type === "PERCENT_SOLD" ? hit.rule.when.percent : null;
  const trigger =
    pctOf === null
      ? `${hit.tierName} triggered its auto-open rule`
      : `${hit.tierName} is ${formatPercent(roundTo(pctOf, 1))} sold`;
  return `Open a ${target.name} tier at ${formatMoney(target.priceCents, currency)} (${target.quota} seats) — ${trigger}`;
}
