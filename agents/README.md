# Phase 2 — five agents in parallel

Paste-ready prompts for the five feature agents. Each file is self-contained:
an Emdash agent has none of the context from the Architect session, so every
prompt restates the scaffold facts it needs.

| Agent | Prompt | Branch | Owns | Port |
| --- | --- | --- | --- | --- |
| 1 · CONDUCTOR | [1-conductor.md](./1-conductor.md) | `feat/conductor` | `apps/console/` | 3000 |
| 2 · MAISON | [2-maison.md](./2-maison.md) | `feat/maison` | `apps/events/` | 3001 |
| 3 · ORACLE | [3-oracle.md](./3-oracle.md) | `feat/oracle` | `packages/guests/` | — |
| 4 · TREASURY | [4-treasury.md](./4-treasury.md) | `feat/treasury` | `packages/revenue/` | — |
| 5 · MAÎTRE D' | [5-maitre-d.md](./5-maitre-d.md) | `feat/maitre-d` | `apps/live/` | 3002 |

The five branches already exist locally, all pointing at `main`. If Emdash
prefers to create its own, delete them first:

```bash
git branch -D feat/conductor feat/maison feat/oracle feat/treasury feat/maitre-d
```

---

## Before you start

**Every worktree needs its own `.env`.** It is gitignored, so it does not
travel with the branch — copy the root one across after creating each worktree.

**Give each agent its own Neon branch**, or the five will fight over the same
rows. The database is Neon (provisioned through the Vercel Marketplace as
`neon-emerald-sail`), and a Neon branch is a copy-on-write fork that takes
seconds and costs nothing at this size:

1. Neon Console → Branches → **New branch** from `main`, named per agent
   (`conductor`, `maison`, `oracle`, `treasury`, `maitre-d`).
2. Copy that branch's pooled and unpooled connection strings into the
   worktree's `.env` as `DATABASE_URL` and `DIRECT_URL`.

Because the branch forks the already-seeded `main`, each agent starts with the
exact same 200 guests and €28,140 of tickets — and can trash them freely.

Then in each worktree:

```bash
pnpm install
pnpm db:push        # only if you branched from an empty database
pnpm db:seed
```

**Note the connection path.** Prisma talks to Neon through the serverless
driver adapter on **:443**, not TCP :5432 — this network blocks 5432 outbound.
`pnpm db:push` applies DDL over HTTPS too. If an agent reports
"Can't reach database server at …:5432", it has bypassed
`@ovation/core/db` and constructed its own `PrismaClient`. That is the bug;
point it at the shared client.

---

## Why these boundaries make the merge clean

No two agents own the same file. The one file that could have collided —
`apps/console/src/server/router.ts`, where routers get mounted — is owned by
CONDUCTOR alone, and CONDUCTOR mounts only `event` and `agent`.

**Feature agents do not mount themselves.** They export a router with the
contract's signatures; Agent 7 · CRITIC mounts `guests`, `revenue`, `live` and
`page` in Phase 3. That is job #1 on the Critic's list.

The consequence, which every prompt states: during Phase 2 the console's
Guests, Revenue and Live views get `NOT_IMPLEMENTED` back. That is correct and
expected. CONDUCTOR renders a pending state rather than crashing.

---

## Review checklist per agent

Before merging a branch, check the diff in Emdash:

- [ ] **Boundary held** — every changed file is inside the agent's directory.
      `packages/core` untouched. `git diff --stat main...feat/<name>` proves it.
- [ ] **Definition of done met** — each prompt ends with concrete, checkable
      claims. Run them, do not take the agent's word.
- [ ] **`pnpm typecheck` passes** from the repo root, not just in the package.
- [ ] **Contract signatures unchanged** — the router's procedures still match
      `packages/core/src/trpc/routers/<name>.ts` exactly.
- [ ] **Safety rule intact** — nothing sends email, charges a card or mutates
      an event outside an approved `AgentAction`. Grep the diff for `resend`,
      `stripe`, `sendMail` and check each hit.
- [ ] **`CONTRACT_CHANGES.md`** — read any entry the agent appended. Decide
      accept/reject now; the Critic applies it in Phase 3.

## Merge order

Merge one at a time and run `pnpm typecheck` after each, so a break is
attributable:

```bash
git checkout main
git merge --no-ff feat/conductor
pnpm typecheck
git merge --no-ff feat/maison
pnpm typecheck
# ...oracle, treasury, maitre-d
```

Conflicts should be limited to `pnpm-lock.yaml` (regenerate with
`pnpm install`) and `CONTRACT_CHANGES.md` (union-merged by `.gitattributes` —
keep both sides).

Then Phase 3: Agent 7 · CRITIC, solo, wires the routers and runs the
adversarial pass → tag `v0.1`.
