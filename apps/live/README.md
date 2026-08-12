# apps/live — MAÎTRE D'

Event-day operations: the check-in PWA, the host companion, the ops dashboard
and the cue engine. Port **3002**.

This code runs once, on the night, in a venue with bad wifi, in someone's hand
while they greet a guest. Every decision below follows from that.

```
/live/[eventId]/door        camera check-in, offline-capable
/live/[eventId]/host        VIP arrival alerts, ranked introductions
/live/[eventId]/ops         counters, arrival chart, feed, announcements
/live/[eventId]/dev/passes  scannable test codes (development only)
```

## Running it

```bash
pnpm install
pnpm db:push && pnpm db:seed          # once
pnpm --filter @ovation/live dev       # http://localhost:3002
```

`.env` lives at the workspace root. Next only reads `.env` from the *app*
directory, so `next.config.ts` loads the root file itself — without that the
door starts with no `QR_SIGNING_SECRET`, falls back to a development secret and
refuses every genuine pass. Anything already set in the shell wins.

## Proving it works

```bash
pnpm --filter @ovation/live sim -- --reset --replay   # paced arrivals + replay
pnpm --filter @ovation/live sim -- --burst --count 250 --reset --replay
pnpm --filter @ovation/live verify:outcomes           # every checkinOutcome branch
pnpm --filter @ovation/live verify:cues               # cues propose, never act
pnpm --filter @ovation/live test:e2e                  # two windows, and a dead-zone
```

`sim` holds no database handle. It signs real tokens, speaks HTTP to the
running app and learns everything else from the same endpoints a door tablet
uses — if it can measure something, the product can serve it. It prints
client-observed and server-side latency side by side (the gap is network),
reconciles every arrival against the socket to prove nothing was dropped, times
an announcement to a subscribed client, and with `--replay` re-sends every scan
to prove the check-in count does not move.

The seed carries **200 guests against a capacity of 250**, so `--count 250`
runs 200 distinct check-ins and says so; `--replay` then puts the same volume
through the pipeline again as duplicates.

### Measured

Production build (`next build && next start`), local PostgreSQL 18, one Node
process, no realtime broker. Client figures are the full HTTP round trip from
the harness; server figures are the handler's own histogram — the gap between
them is network and framework.

| | paced (200 over 10 min) | burst (200 across 8 lanes) |
|---|---|---|
| wall clock | 601.8 s | **2.6 s** (~77 scans/s) |
| client p50 / **p95** / p99 | 20 / **47** / 68 ms | 23 / **119** / 164 ms |
| client max | 120 ms | 456 ms |
| server p50 / p95 / max | 4.8 / 16.8 / 100.8 ms | 4.3 / 63.4 / 410.6 ms |
| dropped realtime updates | **0** | **0** |
| sequence gaps | **0** | **0** |
| announcement to a subscribed client | 22 ms | 12 ms |
| replay of all 200, same keys | 200 → 200, no duplicates | 200 → 200, no duplicates |

**P95 is 47 ms paced and 119 ms under burst, against a 2.5 s budget** — roughly
50× and 20× of headroom. The 400 samples per run are 200 check-ins plus 200
replays; every replay returned `ALREADY_CHECKED_IN`.

Caveat worth stating: this is a single machine talking to itself. The budget
exists for a venue tablet on bad wifi, and the client column is the half that
will move there. What these numbers do establish is that none of the budget is
being spent on our side of the wire.

## How it fits together

### The check-in path

`live.checkin` is the only path with a hard latency budget (< 2.5s P95) and the
only one that has to work with no network.

- **Rejections are outcomes, not exceptions.** A forged code, an expired code,
  the wrong event and an unknown guest each return HTTP 200 with a distinct
  `checkinOutcome`, and the door paints a distinct screen for each. Throwing
  would put a generic error boundary in front of a greeter, who cannot act on
  "something went wrong".
- **Token order matters.** Signature first, then expiry, then event. A forged
  token that also claims to be expired reads as `REJECTED_INVALID_TOKEN` — we
  have no reason to believe anything it says. `verify-outcomes.mts` asserts
  exactly that case.
- **Replay is idempotent.** `CheckIn.guestId` is unique, so a second
  application cannot create a second row; it returns `ALREADY_CHECKED_IN` with
  the *original* timestamp. `scannedAt` is persisted, so the arrival curve
  records when the guest walked in, not when the tunnel ended.
- **Publish after commit.** Nothing reaches the ops wall until the write has
  landed.

### Offline

Three separate mechanisms, deliberately not one:

| Piece | Job |
|---|---|
| `lib/offline-queue.ts` | IndexedDB queue of scans, drained on reconnect |
| cached door list | names, white-glove notes and who is already in |
| `public/sw.js` | makes the app *load* offline; touches nothing under `/api` |

A scan is written to the queue **before** it is sent, so a tab that dies
mid-request still replays it. Offline, the device can refuse an expired code, a
wrong-event code and an unknown guest from the token's own claims — but it
cannot verify a signature, because the secret is server-side. Those answers are
marked *unverified* on screen and the server's answer on replay is the one that
counts.

### Realtime

One event bus, two doorways. `emit()` fans out in-process and mirrors to a
Pusher-protocol broker when `REALTIME_*` is configured (Pusher SaaS or a
self-hosted Soketi); a broker round trip never sits inside the check-in budget.

- `live.feed` / `live.guestFeed` — the contract's tRPC subscriptions.
- `GET /api/live/stream` — SSE for browsers, because `EventSource` cannot set
  the header that says which channel is listening. See CONTRACT_CHANGES CC-004;
  when that lands this route goes away.

Every envelope carries a wall time and a sequence number, and the bus keeps a
bounded replay buffer, so a client that reconnects after a dead-zone passes
`since` and gets the gap replayed. A slow subscriber is queued, never sampled —
`stats().dropped` is the count the simulation asserts is zero.

Announcement delivery counts are **measured**: subscribers on the addressed
channels at the moment of the push. Operator surfaces (`ops`, `door`) see every
announcement but are never counted, so a dashboard being open cannot inflate
"delivered to the guest app".

### The cue engine

Cues watch the room and *propose*. `propose()` in `server/live/cues.ts` is the
only place a cue writes, and it hard-codes `status: PROPOSED`; `cue.auto` marks
a cue as eligible for the console's auto-approval policy, it does not let a cue
approve itself. Each cue maps onto a tool the console already executes, so an
approved proposal goes down the existing `APPROVED → EXECUTED` path:

| Trigger | Proposes | Risk |
|---|---|---|
| `CAPACITY_PERCENT` | `update_agenda` — start the keynote early | OPERATIONAL |
| `ARRIVAL_RATE_DROP` | `update_agenda` — hold the keynote | OPERATIONAL |
| `AGENDA_ITEM_DUE` | `update_agenda` — re-time the running order | OPERATIONAL |
| `VIP_LATE` | `draft_emails` — recovery nudge to the missing VIP | OUTBOUND |

Capacity and arrival-rate cues run on the tail of each check-in; time-based
cues run on a timer that exists only while somebody is watching the event.
A serverless deployment should drive them from cron instead:
`POST /api/live/cues?eventId=…&tick=1`.

### Matchmaking

Reads guests and sponsors **through the `guests` and `revenue` contracts** via
an in-process caller (`server/peers.ts`) — no cross-package imports, no queries
against another agent's tables. While `guests.list` is a stub, `live.matchmaking`
rethrows `NOT_IMPLEMENTED` naming the dependency and the host companion renders
a pending panel. An empty list would read as "nobody here is worth meeting",
which is a different and wrong message.

The ranking itself (`server/live/matchmaking.ts`) is pure and complete: shared
interests, industry, peer seniority, and sponsor target accounts — the last of
which outranks the rest, because that is a commercial obligation the event owes
someone. Only guests who have actually arrived are proposed.

## Who is holding the tablet

`server/context.ts`, in priority order:

1. **Console session cookie.** Ports do not scope cookies, so an organiser
   signed in to the console on `:3000` is signed in here. The Session row is
   read straight from the database — the strategy is `database`, so the cookie
   is just a key, and next-auth stays out of this bundle.
2. **`LIVE_OPS_KEY`** as `x-ovation-live-key`, compared in constant time,
   resolving to the organisation's owner. For a tablet wedged on a lectern that
   cannot do a magic-link round trip. Unset by default; no key, no bypass.
3. **Development fallback** to the seed organisation's owner, so `pnpm dev`
   works on a fresh clone. Refused outright in production.

## Non-contract endpoints

The tRPC router is exactly the seven procedures in
`packages/core/src/trpc/routers/live.ts` — adding procedures to a shared router
shape is how five worktrees stop merging. Everything else is a route handler:

| Route | |
|---|---|
| `GET /api/live/doorlist` | offline door list; omit `eventId` for tonight |
| `GET /api/live/stream` | SSE feed |
| `GET/DELETE /api/live/metrics` | measured check-in latency, realtime health |
| `GET/POST /api/live/cues` | cue config; `?tick=1` runs time-based cues |
| `POST /api/live/dev/reset` | clean room for the simulation (dev only) |
