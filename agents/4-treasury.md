# Agent 4 · TREASURY — revenue & sponsors

Branch: `feat/treasury` · Owns: `packages/revenue/`

---

You are building **packages/revenue** for OVATION, an AI event-management
platform. You own the module that makes events **profitable** — our sharpest
edge over competitors like Attendu. Everyone else builds features; you build
the reason an organiser renews.

Work **ONLY** in `packages/revenue/`. Four other agents are building the
console, public pages, guest intelligence and live ops in parallel. You expose
everything through the `revenue` tRPC contract.

`packages/core` is **READ-ONLY**. Do not edit it. Need a contract change? Append
a request to `CONTRACT_CHANGES.md` at the repo root (append-only) and code
against the contract as it stands.

## What already exists

The Architect has landed the scaffold. `pnpm install && pnpm typecheck &&
pnpm build` are green. Read before writing code:

- `packages/core/src/schemas/revenue.ts` — **your contract.**
  `autoOpenRuleSchema`, `sponsorEntitlementsSchema`, `sponsorRoiStatsSchema`,
  `revenueSummaryOutput`, and the IO for every procedure.
- `packages/core/src/trpc/routers/revenue.ts` — the exact signatures:
  `summary`, `pricingSuggestions`, `evaluateAutoOpenRules`, `sponsors`,
  `sponsorUpsellCandidates`, `sponsorRoiReport`.
- `packages/core/src/schemas/agent.ts` — `AgentAction`, `ActionRisk`, and
  `requiresApproval()`. You emit proposals; read this first.
- `packages/core/prisma/schema.prisma` — `TicketTier`, `Order`, `Sponsor`,
  `CostEntry`.

`packages/revenue/src/index.ts` currently re-exports the stub router. Replace
that with your real `revenueRouter`, built from `router` and `orgProcedure` in
`@ovation/core`, with **identical procedure signatures**. Prisma client:
`import { db } from "@ovation/core/db"`. Anthropic SDK is already a dependency.

**Do not edit `apps/console/src/server/router.ts`** to mount yourself — that
file belongs to Agent 1. Agent 7 · CRITIC mounts you in Phase 3. Test your
router directly with `createCallerFactory` from `@ovation/core`.

**All money is minor units (cents) on the wire.** Never floats, never a
`number` that means euros. `€145` is `14500`.

### Seed numbers you must reproduce

Event **Meridian Summit 2026** (capacity 250):

| Tier | Price | Sold / Quota | Status |
| --- | --- | --- | --- |
| Early | €95 | 80 / 80 | `SOLD_OUT` |
| Standard | €145 | 92 / 120 | `ON_SALE` |
| VIP Table | €1,200 | 6 / 10 | `ON_SALE` |

**Ticket revenue: €28,140.** (There are 178 matching `PAID` `Order` rows —
`tier.sold` and the order rows agree, and your summary must agree with both.)

| Sponsor | Package | Amount | Engagement |
| --- | --- | --- | --- |
| Helvion Group | GOLD | €12,500 | 78 |
| Nexa Systems | SILVER | €6,000 | **72** |
| Corda Capital | SILVER | €6,000 | 31 |

**Sponsor revenue: €24,500.**

Costs: venue €8,500 · catering €11,250 · production €4,700 · staff €1,800 (all
committed) · marketing €950 (`committed = false`). **Committed total €26,250**;
€27,200 including uncommitted. Decide which your margin uses and say so in the
code — just be consistent and defensible.

A completed **Meridian Summit 2025** is also seeded (tickets €15,225, sponsors
€15,000) so `previousEdition` has real numbers to diff against.

Standard's seeded `autoOpenRule` fires at **90% sold** and opens a **Late tier
at €175, quota 30**. It is at 76.7% today, so it does not fire on seed data —
that is deliberate, so you can prove both the negative and the positive case.

Nexa's engagement of 72 is seeded **above** the default upsell threshold of 60
on purpose: your radar should surface Nexa, and not Corda, on seed data alone.

## Build

### 1. `revenue.summary`

Tickets by tier, sponsor income, committed costs, margin, cost per attendee, and
the vs-last-edition delta. **One query, dashboard-ready** — the console renders
it on every Overview load, so do not fan out into N+1 queries per tier.

### 2. Dynamic pricing engine

- Evaluate `TicketTier.autoOpenRule` on a cron/queue entry point
  (`evaluateAutoOpenRules`, which supports `dryRun`).
- When a rule wants to fire, **emit an `AgentAction` with `status = PROPOSED`**
  so the organiser approves. **Never open a tier directly.** A rule may carry
  `autoFire: true`, but even then the risk floor is `OPERATIONAL`, which
  `requiresApproval()` never exempts — call that helper, do not reimplement it.
- Pricing suggestions from sales velocity: a sell-out forecast date, and a
  proposal for a new tier when demand outruns supply.

### 3. Sponsor CRM

Packages (Gold/Silver/Custom) with entitlements — logo placements, VIP dinner
mentions, target-account intros — and pipeline states
`PROSPECT → OFFERED → SIGNED → SERVICED`.

### 4. Sponsor ROI reporting

A weekly per-sponsor report:

- **logo impressions** from page analytics (`Event.pageVisits`, maintained by
  Agent 2 · MAISON — read it, do not write it);
- **leads matched to their target-account list** — join `Sponsor.targetAccounts`
  against `Guest.company`. Match case- and punctuation-insensitively; "Helvion
  Group" and "helvion group" are the same company;
- 1:1 meetings booked;
- a renewal-intent signal.

Render as **email-ready HTML** — inline styles, table layout, no external CSS —
and queue it as an `EmailMessage` with `status = PROPOSED`. **You never send.**
There must be no Resend import anywhere in your package.

### 5. Upsell radar

Track sponsor engagement (report opens, benefits-page clicks). When a Silver
sponsor crosses the threshold, draft a **Gold upgrade offer** as an
`AgentAction` `PROPOSED` with the incremental amount.

The offer copy comes from the Anthropic API (model `claude-opus-5`) and must be
**grounded ONLY in their actual activity and entitlement deltas**. Pass the real
numbers in and instruct the model to use nothing else. An invented statistic in
a sponsor offer is a commercial liability, not a bug — the `evidence` array in
`sponsorUpsellCandidatesOutput` exists to make the grounding auditable, so
populate it with the facts the copy actually leans on.

## Definition of done

1. `revenue.summary` on the seed returns **tickets €28,140 (2814000 cents)** and
   **sponsors €24,500 (2450000 cents)**, with a correct margin, cost per
   attendee and a non-null `previousEdition` delta.
2. `evaluateAutoOpenRules` on untouched seed data fires **nothing**. Push
   Standard's `sold` to 108 (90%) and it emits exactly one `AgentAction`
   `PROPOSED` for the Late tier at €175 × 30 — and **does not create the tier**.
3. `sponsorUpsellCandidates` returns **Nexa Systems and not Corda Capital**, with
   a drafted Gold-upgrade offer whose every factual claim traces to a seeded
   number. Read the generated copy yourself and verify this.
4. `sponsorRoiReport` matches Helvion's target accounts to real seeded guest
   companies and renders HTML that survives an email client.
5. Nothing in your package sends email or charges a card.
   `grep -ri "resend\|stripe" packages/revenue/` returns nothing.
6. Unit tests on the pricing rules (fires / does not fire / boundary at exactly
   90%) and the ROI aggregation.
7. `pnpm typecheck` passes **from the repo root**.
8. `git diff --stat main...feat/treasury` shows changes only under
   `packages/revenue/` (plus `pnpm-lock.yaml` / `CONTRACT_CHANGES.md` if needed).
