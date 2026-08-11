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

### CC-001 · `draft_emails` / `draft_sponsor_offer` payloads cannot carry the copy being approved

- **Requested by:** Agent 1 · CONDUCTOR
- **Date:** 2026-08-11
- **What:** add an optional drafted-message field to `draftEmailsInput` and
  `draftSponsorOfferInput` in `packages/core/src/schemas/agent.ts`, e.g.

  ```ts
  draft: z.object({ subject: z.string().max(200), body: z.string() }).optional()
  ```

- **Why:** approval is only meaningful if the organiser approves *specific
  words*. The card has to show the subject and body that will actually go out,
  and `agent.approve` has to send exactly what was on the card. Today
  `draftEmailsInput` carries `guestIds`, `intent` and a free-text `brief`, so
  there is nowhere in the payload for the copy the model wrote. `brief` is the
  steer behind the copy, not the copy, and overloading it would lose the
  subject line entirely.
- **Workaround in place:** the model writes `subject` and `body` on the tool
  call; the console stores them as two `SideEffect` entries labelled
  `"Subject line"` and `"Draft copy"` so they render on the card, and
  `execute.ts` reads them back out of `sideEffects` at approval time
  (`readDraftCopy`). It works and it keeps the contract payload untouched, but
  it uses `sideEffects` as a data channel, which it is not meant to be, and it
  silently truncates the body preview at 400 characters. With the field above,
  `readDraftCopy` and the two synthetic side effects should be deleted and the
  card should read `payload.input.draft`.
- **Blast radius:** `packages/core` (two zod schemas, both additive and
  optional, so nothing breaks), `apps/console`
  (`src/server/agent/actions.ts`, `execute.ts`, `tools.ts`), and
  `packages/guests` if the Oracle's `personaliseInvite` wants to hand finished
  copy to a `draft_emails` action rather than writing `EmailMessage` rows
  itself.
### CC-001 · Order needs the buyer's name
- **Requested by:** Agent 2 · MAISON
- **Date:** 2026-08-11
- **What:** a `buyerName String?` column on `Order` (or an equivalent field in
  the ticketing contract), set when a checkout is opened.
- **Why:** a ticket buyer is not a Guest until the payment settles, so between
  `startCheckout` and `fulfilOrder` there is nowhere to keep the name they
  typed. Without it the Guest created on payment has no name, which is what the
  console's guest list and the door list both read.
- **Workaround in place:** the name travels out-of-band and is put back on the
  Guest at fulfilment — in `metadata.buyerName` on the Stripe Checkout Session
  for the real path, and in a query parameter for the local no-Stripe checkout.
  Both are read in `apps/events/src/server/ticketing.ts` (`fulfilOrder`), which
  is the only place to unwind.
- **Blast radius:** `packages/core/prisma/schema.prisma` (one nullable column),
  and `apps/events/src/server/ticketing.ts`. Nobody else reads it. Agent 4 ·
  TREASURY sums `Order.amountCents` and is unaffected.

### CC-002 · page.render carries no ticket tiers
- **Requested by:** Agent 2 · MAISON
- **Date:** 2026-08-11
- **What:** `pageRenderOutput` exposes `ticketTiersAvailable: boolean` but no
  tier detail. A `tiers: ticketTierSchema[]` field (or a `pageSectionSchema`
  variant of kind `"tickets"`) would let the whole public surface come from one
  procedure.
- **Why:** the tier picker needs name, price, quota, sold and status, so
  `/e/[slug]/tickets` queries Prisma directly instead of going through the
  contract. That is a second source of truth for what is on sale, and it means
  the console cannot preview the ticket step the way it can preview the page.
- **Workaround in place:** `apps/events/src/server/event.ts` (`findPublicEvent`,
  `tierAvailability`) reads the tiers itself. Availability rules — on sale, in
  window, seats left — live in `tierAvailability` and would move with the
  contract.
- **Blast radius:** `packages/core/src/schemas/event.ts` (additive), plus the
  `page.render` implementation and the tickets page in `apps/events`. Additive,
  so no existing consumer breaks.
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
