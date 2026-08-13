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

### Two databases: development and production

Two databases on one Neon endpoint, each owned by its own role. Postgres cannot
query across databases, so the seeded demo and real data cannot mix.

| | database | role | contains | who points at it |
| :-- | :-- | :-- | :-- | :-- |
| development | `neondb` | `neondb_owner` | the seeded demo — Meridian Summit 2026, 200 guests | local `.env`, Vercel preview + development |
| production | `ovation_prod` | `ovation_prod_app` | real data only | Vercel production, all three apps |

`prisma/provision-prod.ts` creates the role and database and writes
`.env.production`. It is idempotent, and the generated password goes straight
to the file — never to stdout, so it cannot end up in a scrollback or a log.

**What this isolates, tested rather than assumed.** The production role is
refused on `neondb` (`permission denied for table Guest`), so production
credentials cannot reach the demo data. And the destructive commands cannot
reach production by accident: `db:seed` and `db:reset` read `.env`, which names
`neondb`.

**What it does not isolate.** `neondb_owner` is a member of `neon_superuser` —
the project superuser — so it can read every database in the project, including
`ovation_prod`. Revoking grants does not change that; it is a property of the
Neon project, not of these two databases. Compute and point-in-time restore are
shared for the same reason: PITR is per-branch, so restoring development to
undo a mistake would roll production back with it.

**Two Neon branches would fix all three**, and that was the intended shape.
Branches are control-plane only — there is no SQL for them — so they need the
Neon console or a Neon API key. Moving is cheap while production is empty and
expensive once real registrations land: create a `production` branch, point
`.env.production` at it, re-run `db:push:prod` and `db:bootstrap:prod`.

The seed and production are mutually exclusive by design. `db:seed` builds the
fixture every test asserts against; that is precisely what production must not
have. But an empty database is not usable either — nothing in the app creates
an Organisation, NextAuth writes a User with `organisationId` null, and
`protectedProcedure` answers FORBIDDEN to every query until it points
somewhere. `db:bootstrap` writes those two rows and nothing else.

Production credentials live in `.env.production` at the repo root, which is
gitignored like `.env`. The `:prod` scripts are the only ones that read it:

```bash
pnpm db:provision:prod                # create the role, database and .env.production
pnpm db:push:prod                     # apply the schema to production
pnpm db:bootstrap:prod --org "Ovation" --email you@example.com
```

Everything else — `db:seed`, `db:reset`, `db:push` — reads `.env` and can only
ever reach development. That asymmetry is deliberate: the destructive commands
have no path to production without you naming the other file explicitly.
`db:bootstrap` refuses outright if it finds events or guests already there,
since an empty production database has neither.

To rotate or re-point production, set `DATABASE_URL` and `DIRECT_URL` for the
**production** environment only, on all three Vercel projects. The Neon
integration manages the preview and development copies; production is set out
of band so the integration does not overwrite it.

### The development password was rotated by SQL, once

`neondb_owner`'s password was changed with `ALTER ROLE`, not through the Neon
console, because this project uses Neon's **native Vercel integration**: the
Neon project (`gentle-glitter-38023117`) belongs to Vercel's Neon organisation
and does not appear in a personal Neon account. Reaching it means going through
Vercel → Storage → `neon-emerald-sail` → **Open in Neon**, which is not obvious.

Postgres was updated and so were `.env` and every Vercel `DATABASE_URL` /
`DIRECT_URL` for preview and development. **Neon's control plane was not**, so:

- the Neon console and the integration's other exported variables
  (`PGPASSWORD`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, …) still show the old
  password. Nothing in this repo reads them — the apps read `DATABASE_URL` and
  `DIRECT_URL` — but they are stale;
- if the Neon–Vercel integration ever re-syncs, it may push the old password
  back into Vercel. That shows up as `28P01 password authentication failed` on
  preview or development deployments. The fix is to reset the password through
  **Open in Neon** and then run `pull-db-credentials.mjs`, which puts the
  control plane back in charge.

Production is unaffected either way: it runs as `ovation_prod_app` on
`ovation_prod`, a role with its own credential.

### After rotating the development password

```bash
node scripts/pull-db-credentials.mjs
```

Pulls the development credentials from Vercel into `.env` — the Vercel REST
API returns an encrypted envelope, so the CLI is the only way to read the
plaintext, and this wraps it. It writes nothing unless the value actually
changed, and it says which of three things is true: the old credential still
works (**nothing rotated**), the old credential is refused (**rotated, Vercel
not synced yet**), or the database could not be reached at all (**unknown** —
not evidence either way).

That last distinction is the point. A failed connection and a rejected
password are different answers, and only Postgres' `28P01` means the password
was refused. Treating any error as "the credential is dead" reports a rotation
that never happened — which is exactly what it did before it was fixed.
Passwords are only ever compared and displayed as short hashes, so the output
is safe to read aloud.

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
