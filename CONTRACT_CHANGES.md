# Contract change requests

`packages/core` is **read-only** for feature agents. If you need a schema,
zod type or tRPC signature changed, do **not** edit it — append a request here
and code against the contract as it stands.

This file is **append-only**. Add your entry at the bottom, never edit or
reorder someone else's. Merge conflicts here are resolved by keeping both
sides (union merge) — see `.gitattributes`.

Agent 7 · CRITIC applies accepted changes to `packages/core` during Phase 3
and updates every consumer.

---

## Template

```
### CC-00N · <short title>
- **Requested by:** Agent N · CODENAME
- **Date:** YYYY-MM-DD
- **What:** the exact field / procedure / type you need.
- **Why:** what you cannot build without it.
- **Workaround in place:** what you shipped instead, so the Critic knows what
  to unwind.
- **Blast radius:** which other agents' code the change would touch.
```

---

<!-- append below this line -->

### CC-001 · `revenue.sponsorUpsellCandidates` should be a mutation
- **Requested by:** Agent 4 · TREASURY
- **Date:** 2026-08-11
- **What:** change `sponsorUpsellCandidates` from `.query()` to `.mutation()` in
  `packages/core/src/trpc/routers/revenue.ts`. No input/output schema change.
- **Why:** `sponsorUpsellCandidatesOutput` has an `agentActionId` field, and the
  drafted Gold-upgrade copy has nowhere else to live — the output schema has no
  field for it, so the copy must be persisted on an AgentAction. That makes the
  procedure a writer. It is also the one place that calls the Anthropic API, so
  a cold call takes seconds; as a query the console may prefetch it on every
  Overview load and tRPC may serve it over a cacheable GET.
- **Workaround in place:** it is implemented as a query that writes, and the
  write is made idempotent — an existing PROPOSED `draft_sponsor_offer` tagged
  `payload.source === "revenue.upsell_radar"` for the same sponsor is reused and
  returned rather than re-drafted, so repeat calls cost nothing and create
  nothing. Flipping it to a mutation needs only the one-word change above plus
  `useQuery` → `useMutation` at the call site.
- **Blast radius:** Agent 1 · CONSOLE, if it has already wired the call site.
  Nothing else consumes it.

### CC-002 · `@ovation/core` typecheck and build race on `prisma generate`
- **Requested by:** Agent 4 · TREASURY
- **Date:** 2026-08-11
- **What:** in `packages/core/package.json`, `typecheck` runs
  `prisma generate && tsc --noEmit` while `build` runs `prisma generate`. Turbo
  schedules both concurrently, so two `prisma generate` processes race on the
  same engine binary. Suggested fix: drop `prisma generate` from `typecheck` and
  let `"dependsOn": ["^build"]` supply it, since `@ovation/core#build` already
  does exactly that.
- **Why:** `pnpm typecheck` from the repo root fails on Windows with
  `EPERM: operation not permitted, rename '…/query_engine-windows.dll.node.tmp…'`.
  It is a race, so it is intermittent, and it fails the whole run rather than
  one task. `pnpm typecheck --concurrency=1` is a clean pass.
- **Workaround in place:** none needed inside packages/revenue — run the root
  typecheck with `--concurrency=1`, or run it twice (the second run is cached).
- **Blast radius:** every agent running the root typecheck on Windows.
