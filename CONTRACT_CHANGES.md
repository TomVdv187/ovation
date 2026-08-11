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

### CC-002 · Persist the check-in idempotency key
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

### CC-003 · Somewhere to record an introduction
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

### CC-004 · Somewhere to keep cue configuration
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

### CC-005 · Let a feed subscriber say which channel it is
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
