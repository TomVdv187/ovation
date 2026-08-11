# Agent 5 · MAÎTRE D' — live ops

Branch: `feat/maitre-d` · Owns: `apps/live/` · Port 3002

---

You are building **apps/live** for OVATION, an AI event-management platform. You
own **event-day operations**: the check-in PWA, the host companion, the ops
dashboard and the cue engine.

Your code runs once, on the night, in a venue with bad wifi, in someone's hand
while they greet a guest. It cannot be slow and it cannot need the network.
That constraint drives every decision below.

Work **ONLY** in `apps/live/`. Four other agents are building the console,
public pages, guest intelligence and revenue in parallel. You integrate through
the tRPC contracts in `packages/core` and nothing else.

`packages/core` is **READ-ONLY**. Do not edit it. Need a contract change? Append
a request to `CONTRACT_CHANGES.md` at the repo root (append-only) and code
against the contract as it stands.

## What already exists

The Architect has landed the scaffold. `pnpm install && pnpm typecheck &&
pnpm build` are green. Read before writing code:

- `packages/core/src/schemas/live.ts` — **your contract.**
  `qrTokenPayloadSchema`, `checkinInput` / `checkinOutput`,
  `checkinOutcomeSchema`, `liveEventSchema`, `opsSnapshotOutput`, `cueSchema`.
- `packages/core/src/trpc/routers/live.ts` — the signatures: `checkin`, `ops`,
  `feed` (subscription), `announce`, `matchmaking`, `markIntroduced`,
  `guestFeed`.
- `packages/core/prisma/schema.prisma` — `CheckIn`, `Guest`, `Announcement`.

Already wired in your app: `globals.css` disables text selection and tap
highlight (door staff hold a phone one-handed), and the viewport is locked
against pinch-zoom. `apps/live/src/app/page.tsx` is a throwaway index.

Imports: `@ovation/core` for schemas, `@ovation/core/db` for Prisma. Path alias
`~/*` → `apps/live/src/*`. `jose` is already a dependency for JWT verification.
Realtime transport: a **Pusher-protocol-compatible** library, so it can run on
Pusher SaaS or self-hosted Soketi. Env vars `REALTIME_*` are already defined.

**Do not edit `apps/console/src/server/router.ts`** to mount yourself — that
file belongs to Agent 1. Agent 7 · CRITIC mounts you in Phase 3.

Seed data: **Meridian Summit 2026**, capacity 250, 200 guests with segments,
`plusOnes`, dietary notes and VIP `whiteGlove` blobs.

### The QR token — a shared boundary

Agent 2 · MAISON issues the check-in token at registration: a JWT signed with
`QR_SIGNING_SECRET` carrying `{ gid, eid, iat, exp }` — exactly
`qrTokenPayloadSchema`. **You verify it.** Do not invent a different payload;
if you need a field that is not there, that is a `CONTRACT_CHANGES.md` request.

## Build

### 1. Check-in PWA — `/live/[eventId]/door`

- Camera QR scanner. Verifies the JWT **signature and the event id**, then flips
  the guest to `CHECKED_IN` and writes a `CheckIn` row with the lane.
- **Target < 2.5s per scan**, P95. Measure it; do not assume it.
- **Works offline** with an IndexedDB sync queue for venue dead-zones. A scan
  taken offline replays when the network returns.
- **Replay must be idempotent.** `checkinInput` carries an `idempotencyKey` and
  a `scannedAt` for exactly this reason: applying the same scan twice must
  produce `ALREADY_CHECKED_IN`, not a duplicate row or an error, and must record
  the time the scan *happened*, not the time it synced.
- **Rejections are outcomes, not exceptions.** The contract returns
  `REJECTED_INVALID_TOKEN`, `REJECTED_EXPIRED`, `REJECTED_WRONG_EVENT`,
  `REJECTED_UNKNOWN_GUEST` — render each as a distinct, instantly readable
  screen. A forged or expired code must be refused; the Critic will try both.
- Manual door-list fallback by `guestId` when a guest lost their code.
- Multiple lanes; the lane is recorded per check-in.

### 2. Host companion — `/live/[eventId]/host`

- Realtime **VIP arrival alerts**: name, photo placeholder, white-glove notes
  and a one-line conversation opener.
- Ranked **AI matchmaking**: guests sharing interests/industries, plus guests
  matching sponsor target-account lists. Read those through the `guests` and
  `revenue` contracts — **do not query another agent's tables directly and do
  not import their packages.** During Phase 2 those procedures return
  `NOT_IMPLEMENTED`; handle it as a pending state and keep building.
- "Introduced" tracking via `markIntroduced`.

### 3. Ops dashboard — `/live/[eventId]/ops`

- Live counters: checked-in, capacity %, VIPs arrived.
- Arrivals-per-15-min bar chart, updating live. **Hand-rolled SVG, no chart
  library.**
- Check-in feed.
- Announcement composer pushing to all connected clients (guest app, host view,
  info screens) with delivery counts.

### 4. Cue engine

Configurable triggers — "when capacity ≥ 70%, propose starting the keynote";
"when a VIP with transport arranged has not arrived 30 min after doors, alert
the organiser". Trigger shapes are `cueTriggerSchema`.

**Cues emit `AgentAction`s with `status = PROPOSED`** unless explicitly
whitelisted as auto. A cue never changes the event by itself.

### 5. Simulation mode

`pnpm sim` streams fake arrivals from the seed guest list **through the real
pipeline** — not a mocked one — for demos and load testing.

Target: **250 check-ins in 10 minutes with no dropped socket updates.**

## Definition of done

1. Simulation drives a live-updating ops dashboard **and** host alerts in two
   browser windows at once.
2. The offline queue is proven by killing the network mid-scan: the scan
   succeeds locally, syncs on reconnect, and replaying it does not double-count.
3. A forged token and an expired token are both rejected with the correct
   distinct outcome.
4. An announcement reaches all connected clients in **< 1s** in local tests,
   with an accurate delivery count.
5. Check-in **P95 < 2.5s** under the 250-guest simulation. State the measured
   number.
6. Cues produce `PROPOSED` actions, never direct mutations.
7. `pnpm typecheck` passes **from the repo root**.
8. `git diff --stat main...feat/maitre-d` shows changes only under `apps/live/`
   (plus `pnpm-lock.yaml` / `CONTRACT_CHANGES.md` if needed).
