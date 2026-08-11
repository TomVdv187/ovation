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

**Set `DATABASE_URL`.** Every agent needs a live database — ORACLE and
TREASURY cannot reach their Definition of Done without one, since their targets
are stated in terms of seed data. Each worktree needs its own `.env` (it is
gitignored, so it does not travel with the branch).

**Give each worktree its own database**, or the five agents will fight over the
same rows. On Neon/Supabase, a separate branch or schema per agent is cheapest:

```bash
DATABASE_URL="postgresql://.../ovation?schema=conductor"
```

Then in each worktree:

```bash
pnpm install
pnpm db:push
pnpm db:seed
```

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
