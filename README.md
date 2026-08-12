# OVATION

An event agent that runs the whole event business — event pages, ticketing,
sponsors, guest intelligence and live ops, driven by natural language and
gated by human approval.

Phase 1 (the Architect) is complete: this repo holds the contracts, the data
model, the design system and seed data. Five feature agents build on top of it
in parallel.

---

## Run it

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL and DIRECT_URL
pnpm db:push                  # create the schema
pnpm db:seed                  # Meridian Summit 2026, 200 guests
pnpm dev                      # console on :3000, events on :3001, live on :3002
```

Sign in at <http://localhost:3000> with the seeded owner address. Without a
`RESEND_API_KEY` the magic link is **printed to the terminal** running
`pnpm dev` — paste it into the browser.

Other useful commands:

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | strict `tsc` across every workspace |
| `pnpm build` | production build of all apps |
| `pnpm db:studio` | Prisma Studio against your database |
| `pnpm db:reset` | drop the schema, re-push and re-seed |
| `pnpm db:push:tcp` | plain `prisma db push` (see below) |

**Requirements:** Node ≥ 20.11, pnpm 10, a PostgreSQL database.

### One `.env`, at the repo root

There is a single `.env` at the repo root and it is the source of truth.
Neither Prisma nor Next.js looks outside its own package for one, so the `dev`
and `db:*` scripts load it explicitly via `dotenv-cli`. Add a new variable once,
at the root — do not scatter per-package `.env` files.

`build` and `start` deliberately do **not** load it: on Vercel and in CI the
platform injects the environment.

### Talking to Neon over HTTPS

Against a Neon database the Prisma client goes through the serverless driver
adapter (`@prisma/adapter-neon`), which speaks Postgres over WebSocket on
**:443** instead of raw TCP on :5432. That is the right shape for serverless —
no pool exhaustion when Vercel runs a function per request — and it also means
the repo works on networks that block 5432 outbound, which many corporate ones
do.

`pnpm db:push` follows the same path: it generates the DDL locally with
`prisma migrate diff` (no connection needed) and applies it over HTTPS. It
refuses to touch a non-empty schema unless you pass `--force`, which drops and
recreates `public`.

Anything that is not a Neon URL — local Postgres, CI, a container — falls
through to the plain TCP client and `pnpm db:push:tcp`. Nothing here forces a
hosted database on you.

---

## Architecture

```
packages/core/      Prisma schema, zod types, tRPC contracts, design tokens   ARCHITECT
apps/console/       organiser console + the agent brain                       Agent 1 · CONDUCTOR
apps/events/        public event pages, registration, ticketing               Agent 2 · MAISON
packages/guests/    guest intelligence — scoring, risk, personalisation       Agent 3 · ORACLE
packages/revenue/   revenue, dynamic pricing, sponsors, ROI                   Agent 4 · TREASURY
apps/live/          check-in PWA, host companion, ops dashboard               Agent 5 · MAÎTRE D'
apps/www/           marketing site                                            Agent 6 (optional)
e2e/                Playwright golden-path suite                              Agent 7 · CRITIC
```

**Stack:** Next.js 15 (App Router) · TypeScript strict · tRPC v11 · Prisma +
PostgreSQL · Tailwind · NextAuth (email magic link) · Anthropic API · Stripe ·
Resend · Pusher-protocol realtime. pnpm workspaces + Turborepo.

### The contract

`packages/core` exports six tRPC sub-routers — `event`, `page`, `guests`,
`revenue`, `live`, `agent` — where every procedure is fully typed (zod in, zod
out) and throws `NOT_IMPLEMENTED`. **Those signatures are the contract.**

A feature agent implements a router with the same signatures inside its own
package and gets mounted by changing one line in
`apps/console/src/server/router.ts`:

```ts
import { guestsRouter } from "@ovation/guests";

export const appRouter = createAppRouter({
  ...contractRouters,
  guests: guestsRouter,   // ← the only edit needed
});
```

Nobody edits `packages/core` to be wired in. That is what lets five worktrees
merge cleanly.

### Boundaries

- **`packages/core` is READ-ONLY for feature agents.** Need a change? Append a
  request to [`CONTRACT_CHANGES.md`](./CONTRACT_CHANGES.md) — it is
  append-only and union-merged — and code against the contract as it stands.
- Each agent works **only** inside its own directory. No two agents own the
  same file, so parallel worktrees do not conflict.
- Cross-feature data flows through the tRPC contracts, never through direct
  imports of another agent's internals.
- Only Agent 7 · CRITIC may touch cross-boundary code, in Phase 3.

### The safety rule

The agent brain **never mutates anything directly**. Every tool call becomes an
`AgentAction` with status `PROPOSED`; `agent.approve` is the only path to
`EXECUTED` and performs the mutation transactionally.

`ActionRisk` decides what may skip a human:

| Risk | Example | Auto-approve? |
| --- | --- | --- |
| `COSMETIC` | change the theme | only if the org opts in |
| `OPERATIONAL` | open a ticket tier | never |
| `OUTBOUND` | send emails, sponsor offers | **never** |
| `DESTRUCTIVE` | move the event date | **never** |

Enforced by `requiresApproval()` in
`packages/core/src/schemas/agent.ts`. Do not route around it.

---

## Seed data

`pnpm db:seed` creates **Meridian Summit 2026** — 24 September 2026, Horta
Hall Antwerp, capacity 250 — deterministically (fixed PRNG seed), so every
agent, eval and e2e run sees identical data.

| | |
| --- | --- |
| Guests | 200, Benelux names, varied segments, engagement and risk |
| Ticket tiers | Early €95 (80 sold out) · Standard €145 (92 sold) · VIP Table €1,200 (6 sold) |
| Ticket revenue | **€28,140** |
| Sponsors | Helvion Gold €12,500 · Nexa Silver €6,000 · Corda Silver €6,000 |
| Sponsor revenue | **€24,500** |
| Also seeded | committed costs, a 40-message invite campaign, 3 open agent proposals, and a completed 2025 edition so revenue can show a delta |

Nexa's sponsor engagement is seeded above the upsell threshold on purpose — the
Treasury's Gold-upgrade radar should fire on seed data alone.

---

## Phase plan

1. **Architect** — solo → merge to `main` ✅
2. **Conductor, Maison, Oracle, Treasury, Maître d'** — 5 parallel worktrees
3. **Merge** feature branches (no file overlaps by design)
4. **Critic** — wire, test, adversarial pass → tag `v0.1`

Full prompts per agent: [`ovationemdashplan.md`](./ovationemdashplan.md).
