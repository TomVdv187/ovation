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
