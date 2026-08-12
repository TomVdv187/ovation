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

## Phase 3 disposition (Agent 7 · CRITIC, 2026-08-12)

Four agents each opened a "CC-001" because they numbered independently. The
nine requests are renumbered below into one sequence, in the order they appear
in this file. Old id → new id:

| Requester | Old id | New id | Verdict |
| --- | --- | --- | --- |
| Agent 1 · CONDUCTOR | CC-001 | **CC-001** | Accepted |
| Agent 2 · MAISON | CC-001 | **CC-002** | Accepted |
| Agent 2 · MAISON | CC-002 | **CC-003** | Accepted with amendment |
| Agent 4 · TREASURY | CC-001 | **CC-004** | Accepted |
| Agent 4 · TREASURY | CC-002 | **CC-005** | Accepted, proposed fix replaced |
| Agent 5 · MAÎTRE D' | CC-001 | **CC-006** | Accepted |
| Agent 5 · MAÎTRE D' | CC-002 | **CC-007** | Accepted |
| Agent 5 · MAÎTRE D' | CC-003 | **CC-008** | Accepted |
| Agent 5 · MAÎTRE D' | CC-004 | **CC-009** | Accepted, partially applied |

Four of them (CC-002, CC-006, CC-007, CC-008) needed a Prisma schema change.
They were sequenced into **one** additive migration —
`scripts/critic/migrate-cc.ts` — applied through `@ovation/core/db` rather than
`db:push`, which was off-limits for this run. Reasoning per request is under
each entry below; the wider story is in `INTEGRATION_REPORT.md`.

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
> **VERDICT — ACCEPTED (Agent 7 · CRITIC, 2026-08-12).**
>
> The workaround was worse than the requester admitted. `execute.ts` read the
> body back out of the `"Draft copy"` side effect, and `actions.ts` wrote that
> side effect as `meta.body.slice(0, 400)`. So for any draft over 400
> characters the organiser approved one message and a *different, truncated*
> message is what got written to `EmailMessage`. Approving specific words was
> the entire point of the card; the workaround silently defeated it.
>
> Applied: `draftCopySchema` (`{ subject, body }`) in
> `packages/core/src/schemas/agent.ts`, optional on both `draftEmailsInput` and
> `draftSponsorOfferInput`. Consumers updated — `readDraftCopy` and the two
> synthetic side effects are deleted, `ProposalMeta` no longer carries
> `subject`/`body`, `buildPayload` folds the model's flat `subject`/`body` into
> `input.draft`, and `proposal-card.tsx` renders `payload.input.draft` in full.
> A subject without a body (or the reverse) is not a draft and is dropped, so
> the executor falls back to its template rather than sending half a message.

### CC-002 · Order needs the buyer's name
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

> **VERDICT — ACCEPTED (Agent 7 · CRITIC, 2026-08-12).**
>
> `Order.buyerName String?` added; applied in the single Phase 3 migration.
> Both halves of the workaround are unwound: `reserve()` persists the name,
> `fulfilOrder` reads it off the order row, `FulfilInput.buyerName` is gone,
> the Stripe session no longer carries `metadata.buyerName`, and the local
> checkout redirect no longer carries `?n=`.
>
> Worth stating: the query-parameter half was not merely inelegant. `?n=` was
> attacker-controlled and fed straight into the created Guest's `name`, so a
> crafted URL could name someone else's ticket buyer. That is closed now.

### CC-003 · page.render carries no ticket tiers
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
> **VERDICT — ACCEPTED WITH AMENDMENT (Agent 7 · CRITIC, 2026-08-12).**
>
> The problem is real: `/e/[slug]/tickets` queried Prisma and re-derived
> availability with its own copy of the rules, so there were two sources of
> truth for what was on sale.
>
> The proposed shape is rejected. `page.render` is a `publicProcedure` and
> `ticketTierSchema` carries `quota` and `sold`, so shipping it would publish
> this event's sell-through to anyone who can load the page. `remaining` is the
> fact a buyer needs; `sold` is the fact a rival wants. Raw `TicketTierStatus`
> is left off for the same reason.
>
> Applied: `publicTicketTierSchema` (id, name, description, priceCents,
> currency, remaining, purchasable, soldOut, opensAt, closesAt) and
> `tiers: publicTicketTierSchema[]` on `pageRenderOutput`. `tierAvailability`
> runs once inside `page.render`, and the tickets page consumes
> `api().page.render(...)`. One consequence, stated because it is a real
> regression: "Closed" and "Not on sale yet" now both render as "Not on sale",
> because the status that distinguished them is exactly what must not be public.

### CC-004 · `revenue.sponsorUpsellCandidates` should be a mutation
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

> **VERDICT — ACCEPTED (Agent 7 · CRITIC, 2026-08-12).**
>
> A procedure that must persist an `AgentAction` in order to answer is a
> writer, and a writer is a mutation. `.query()` → `.mutation()` in both the
> contract stub and `packages/revenue/src/router.ts`. No schema change.
>
> The idempotent-write workaround stays: it is good behaviour on its own terms
> (a repeated call reuses the open PROPOSED action rather than re-drafting and
> paying for another Anthropic call), not merely a prop for the query shape.
>
> Blast radius was smaller than the requester feared — the console has no call
> site for `sponsorUpsellCandidates` at all, so no `useQuery` → `useMutation`
> was needed anywhere. `packages/revenue/scripts/verify-seed.ts` reaches it
> through a server-side caller, which is shape-agnostic.

### CC-005 · `@ovation/core` typecheck and build race on `prisma generate`
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
> **VERDICT — ACCEPTED, BUT THE PROPOSED FIX WOULD HAVE BROKEN A COLD CHECKOUT
> (Agent 7 · CRITIC, 2026-08-12).**
>
> The race is real and `prisma generate` is now gone from `@ovation/core`'s
> `typecheck` script. The suggested remedy — "let `dependsOn: ["^build"]`
> supply it" — does not work: `^build` means the builds of the package's
> *dependencies*, and `@ovation/core` has no workspace dependencies. So
> `@ovation/core#typecheck` would have run `tsc --noEmit` against an ungenerated
> client on any checkout without a warm `node_modules/.prisma`. It would have
> passed on the requester's machine, where the client already existed, and
> failed in CI.
>
> Applied instead: an explicit `"@ovation/core#typecheck": { "dependsOn":
> ["@ovation/core#build"] }` in `turbo.json`, which both supplies the client and
> serialises the two generates so they cannot race.
>
> Separately, and not what this request describes: on this network
> `prisma generate` fails outright with `unable to verify the first certificate`
> when it fetches the engine checksum from `binaries.prisma.sh`. That is TLS
> interception, not a race. See `INTEGRATION_REPORT.md`.

### CC-006 · Persist the check-in idempotency key
- **Requested by:** Agent 5 · MAÎTRE D'
- **Date:** 2026-08-11
- **What:** `CheckIn.idempotencyKey String? @unique` (or `@@unique([eventId, idempotencyKey])`) in `prisma/schema.prisma`.
- **Why:** `checkinInput` carries `idempotencyKey` and the contract's own comment
  says it is what makes replaying an offline queue safe — but there is nowhere
  to store it, so the key currently survives only in one process's memory.
  Today's correctness rests entirely on `CheckIn.guestId @unique`, which is a
  *different* guarantee: it dedupes by guest, not by scan. Two consequences.
  A restart between a write and its acknowledgement loses the record that this
  key was applied, and two app instances behind a load balancer cannot dedupe
  concurrent replays of the same key at all — they collide on the unique index
  and one of them takes the `P2002` recovery path.
- **Workaround in place:** an in-process `Map` of in-flight promises keyed by
  `eventId:idempotencyKey` coalesces concurrent duplicates, and a caught `P2002`
  is translated into `ALREADY_CHECKED_IN` with the winning row's timestamp. The
  externally visible behaviour is already correct — this change makes it correct
  for reasons that survive a restart. See `apps/live/src/server/live/checkin.ts`.
- **Blast radius:** additive, nullable column. No consumer reads it; Agent 2 ·
  MAISON does not write `CheckIn`. Nothing else changes.

> **VERDICT — ACCEPTED (Agent 7 · CRITIC, 2026-08-12).**
>
> `CheckIn.idempotencyKey String?` with `@@unique([eventId, idempotencyKey])`,
> applied in the single Phase 3 migration. `performCheckin` now looks the key up
> before anything else and answers `ALREADY_CHECKED_IN` from the row it wrote,
> the create persists the key, and the `P2002` recovery reads back the winner on
> either unique index.
>
> The in-process in-flight `Map` stays, correctly relabelled as an optimisation
> rather than the correctness mechanism. The requester's analysis was accurate:
> `CheckIn.guestId @unique` dedupes by guest, which is a different guarantee
> from deduping by scan, and only the latter makes an offline queue replay safe
> across a restart or a second instance.

### CC-007 · Somewhere to record an introduction
- **Requested by:** Agent 5 · MAÎTRE D'
- **Date:** 2026-08-11
- **What:** an `Introduction` model — `{ id, eventId, guestId, withGuestId, introducedBy String?, createdAt }`
  with `@@unique([eventId, guestId, withGuestId])`.
- **Why:** `live.markIntroduced` is in the contract and the matchmaking output
  carries an `introduced` flag, but no table backs either. A host who marks an
  introduction and then reloads their phone loses it, and a second host is
  offered the same introduction the first already made.
- **Workaround in place:** an in-process `Map<eventId, Set<pairKey>>` in
  `apps/live/src/server/live/matchmaking.ts`. It covers one night on one box and
  is honest about it. Writing this onto `Guest.notes` — a column Agent 3 · ORACLE
  owns — would have been worse than losing it.
- **Blast radius:** new model, new relation on `Guest`/`Event`. Only
  `live.markIntroduced` and `live.matchmaking` read or write it, both of which
  are ours.

> **VERDICT — ACCEPTED (Agent 7 · CRITIC, 2026-08-12).**
>
> `Introduction` model added as specified, applied in the single Phase 3
> migration. The `globalThis` `Map<eventId, Set<pairKey>>` is deleted.
> `markIntroduced` is an upsert and records `introducedBy` from the session;
> `matchmaking` reads the pairs back from the table. Rows are written with the
> pair already ordered by `pairKey`, so the unique constraint means "this pair,
> once" rather than "this pair in this direction, once".

### CC-008 · Somewhere to keep cue configuration
- **Requested by:** Agent 5 · MAÎTRE D'
- **Date:** 2026-08-11
- **What:** a `Cue` model mirroring `cueSchema` — `{ id, eventId, label, trigger Json, auto Boolean, enabled Boolean }`.
- **Why:** `cueSchema` and `cueTriggerSchema` are in the contract, so cues are
  meant to be configurable per event, but there is no table to configure. An
  organiser who disables the capacity cue at 19:00 gets it back on the next
  deploy.
- **Workaround in place:** a default cue set defined in code, overridable at
  runtime through `POST /api/live/cues?eventId=…` and held in memory
  (`apps/live/src/server/live/cues.ts`). Behaviour is correct; persistence is not.
- **Blast radius:** new model. Only the live app reads it.

> **VERDICT — ACCEPTED (Agent 7 · CRITIC, 2026-08-12).**
>
> `Cue` model added, applied in the single Phase 3 migration. `getCues` and
> `setCues` are database-backed and seed the default set on first read of an
> event, so an unconfigured event still has working cues. `/api/live/cues`
> reads and writes rows.
>
> The fired-once-per-night marker stays in memory deliberately, and that is a
> narrower claim than "cues are persistent": it is state about tonight, not
> configuration. What actually stops a duplicate card after a restart is the
> existing "is there already an open PROPOSED action for this cue" query, which
> was already persistent.

### CC-009 · Let a feed subscriber say which channel it is
- **Requested by:** Agent 5 · MAÎTRE D'
- **Date:** 2026-08-11
- **What:** add `channel: z.enum(["guest-app", "host", "screens", "ops", "door"]).optional()`
  to `liveFeedInput`.
- **Why:** `announceInput.channels` addresses an announcement to a subset of
  clients, so a subscriber has to declare which subset it belongs to — otherwise
  a message meant for the guest app also lands on the info screens, and the
  delivery count in `announceOutput` cannot be anything better than a guess.
  `liveFeedInput` has no room for it. The awkward part is `EventSource`, which
  cannot set request headers, so a browser cannot pass it out of band either.
- **Workaround in place:** the tRPC `live.feed` subscription reads an
  `x-ovation-live-channel` header (fine for a server-side caller or any client
  that can set headers), and the browser uses `GET /api/live/stream?channel=…`,
  a route handler over the same event bus. Both doorways, one bus — but two
  doorways exist only because of this gap.
- **Blast radius:** optional field on an existing input. No consumer breaks;
  once it lands, `/api/live/stream` becomes redundant and we delete it.

> **VERDICT — ACCEPTED, PARTIALLY APPLIED (Agent 7 · CRITIC, 2026-08-12).**
>
> `channel: z.enum([...]).optional()` added to `liveFeedInput`. Both `live.feed`
> and `live.guestFeed` prefer `input.channel` and fall back to the
> `x-ovation-live-channel` header, so an existing server-side caller keeps
> working. The reasoning about `EventSource` is right, and the input is the only
> place a browser can supply it.
>
> **Not done: deleting `/api/live/stream`.** The requester said it becomes
> redundant. It does in principle, but the live app's browser clients consume
> that route today and moving them onto a tRPC subscription link is a client
> refactor with no user-visible gain, in a session whose stated priority was the
> adversarial pass. Both doorways still sit on one bus, so there is no
> correctness cost — only the duplication the requester objected to. Logged as a
> remaining risk, not as done.
