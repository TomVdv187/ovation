# OVATION — Integration report

**Agent 7 · CRITIC · Phase 3 · branch `feat/critic` · 2026-08-12**

Ten commits, each landed as it was finished. `pnpm typecheck` 9/9 and
`pnpm build` 4/4 from the repo root, both re-run with `TURBO_FORCE=true` so the
numbers are not a replay of a warm cache.

This report is written to be useful, not reassuring. The headline is that
**four security or correctness defects were found by testing and fixed**, three
of them in the one code path the whole product's safety story rests on, and
that **the three Next apps cannot reach the database from this machine at all**,
so a large part of the product has still never been seen working in a browser.

---

## 1 · Summary

| | |
| --- | --- |
| Routers wired | 4 of 4 (`page`, `guests`, `revenue`, `live`) |
| Contract requests resolved | 9 of 9 — 8 accepted, 1 accepted with the proposed shape rejected |
| Prisma migrations | 1, additive, idempotent, applied without `db:push` |
| Defects found and fixed | 4 (1 critical, 3 serious) |
| Adversarial checks run | 79 |
| Claims reproduced independently | CONDUCTOR 57/57 · ORACLE 102/102 · MAÎTRE D' 11/11 · TREASURY €28,140 / €24,500 |
| Claims that did **not** survive | MAISON's oversell claim survived and then some; nobody's approval-gate claim survived |
| e2e | written, typechecked, **not green** — cannot run here (§7) |
| Lighthouse | **not run** (§8) |
| Fixtures | intact (§9) |

---

## 2 · What was wired, and what the "one line" actually cost

`apps/console/src/server/router.ts` mounted `event` and `agent` and left four
`contractRouters.*` stubs. All four are now real.

The brief said each should be about one line plus an import, and that if it was
not, that is itself a finding. **It was one line for two of the four.**

| Router | Lives in | Cost |
| --- | --- | --- |
| `guests` | `packages/guests` | one line + import, exactly as designed |
| `revenue` | `packages/revenue` | one line + import, exactly as designed |
| `page` | `apps/events` — a Next app | needed an `exports` subpath + workspace dep + `transpilePackages` |
| `live` | `apps/live` — a Next app | the above, **plus** 9 import rewrites, **plus** a peer-caller rewrite |

The contract was designed on the assumption that a router lives in a library.
Two of them live inside Next applications, which are not packages anybody can
import. Concretely:

1. **No package entry point.** `apps/events` and `apps/live` had no `exports`
   field. Each now publishes exactly one subpath — `@ovation/events/page-router`
   and `@ovation/live/live-router` — and the console takes a workspace
   dependency plus a `transpilePackages` entry, because both ship TypeScript
   source rather than a build artifact.

2. **`apps/live` used the `~/` tsconfig alias in server code.** `~/*` maps to
   *the consuming app's* `src`, so importing `liveRouter` from the console would
   have resolved `~/server/realtime` to `apps/console/src/server/realtime`.
   Nine imports across six files are now relative. `apps/events` had none, which
   is why `page` was cheaper.

3. **The worst of it: `apps/live/src/server/peers.ts`.** `live.matchmaking`
   reads guests and sponsors "through the contract" by building a caller from
   *apps/live's own composed appRouter* — where `guests` and `revenue` were
   still `NOT_IMPLEMENTED` stubs. Mounted in the console, `live.matchmaking`
   would have reported *"waiting on Agent 3 · ORACLE"* from inside the one
   application where ORACLE is actually mounted. It would have looked like a
   pending state rather than a bug, indefinitely. It now binds `guestsRouter`
   and `revenueRouter` directly, which is host-independent and also removes the
   router cycle that forced a lazy import at the call site. `apps/live`'s own
   router mounts them too, so the host companion stops showing a permanent
   pending panel.

**Verified, not assumed.** `apps/console/scripts/critic-integration.ts` calls
all seven procedures through one composed console router: `event.get`,
`agent.actions`, `page.render`, `guests.list`, `revenue.summary`, `live.ops`,
`live.matchmaking`. All seven answer. `live.matchmaking` returns four real
matches. 24/24 checks pass.

### Build-graph consequence

Console → events/live workspace dependencies made `pnpm typecheck` schedule two
full Next builds it does not need: **9 tasks and 8 s became 11 tasks and 2 m 30**.
The console consumes sibling TypeScript *source* through `transpilePackages`,
never their `.next` output, so `turbo.json` now pins `@ovation/console#typecheck`,
`@ovation/console#build` and `@ovation/e2e#typecheck` to `@ovation/core#build`.
Back to 9/9 in 30 s cold.

---

## 3 · Contract changes

Four agents each opened a "CC-001". Renumbered in file order; full reasoning and
the old→new mapping are in `CONTRACT_CHANGES.md`.

| New | Requester | Old | Verdict |
| --- | --- | --- | --- |
| CC-001 | CONDUCTOR | CC-001 | **Accepted** |
| CC-002 | MAISON | CC-001 | **Accepted** |
| CC-003 | MAISON | CC-002 | **Accepted, proposed shape rejected** |
| CC-004 | TREASURY | CC-001 | **Accepted** |
| CC-005 | TREASURY | CC-002 | **Accepted, proposed fix replaced** |
| CC-006 | MAÎTRE D' | CC-001 | **Accepted** |
| CC-007 | MAÎTRE D' | CC-002 | **Accepted** |
| CC-008 | MAÎTRE D' | CC-003 | **Accepted** |
| CC-009 | MAÎTRE D' | CC-004 | **Accepted, partially applied** |

Four needed schema changes and were sequenced into **one** migration, per the
brief.

### The three worth arguing about

**CC-001 was more urgent than its author said.** CONDUCTOR described using
`sideEffects` as a data channel as inelegant. It was not inelegant, it was
wrong: `actions.ts` wrote the draft body as `meta.body.slice(0, 400)` and
`execute.ts` read it back out at approval time. **For any draft over 400
characters the organiser approved one message and a different, truncated
message is what got written to `EmailMessage`.** The card's entire purpose is
that approve means "send *these words*". `draftCopySchema` is now on both tool
inputs; `readDraftCopy` and the two synthetic side effects are deleted; the
card renders `payload.input.draft` in full. Regression-tested at 1,200
characters (check A5).

**CC-003's shape is rejected on privacy grounds.** The request asked for
`tiers: ticketTierSchema[]` on `pageRenderOutput`. `page.render` is a
`publicProcedure` and `ticketTierSchema` carries `quota` and `sold` — that
would publish the event's sell-through curve to anyone who can load the page.
`remaining` is the fact a buyer needs; `sold` is the fact a competitor wants.
The problem the request identifies is real and is fixed: a new
`publicTicketTierSchema` carries id, name, description, priceCents, currency,
remaining, purchasable, soldOut, opensAt, closesAt; `tierAvailability` moved
into `page.render`; the tickets page now consumes `api().page.render(...)`
instead of querying Prisma with its own copy of the rules. **Cost, stated:**
"Closed" and "Not on sale yet" now both render as "Not on sale", because the
status that distinguished them is exactly what must not be public. Verified no
sell-through leaks (check J9).

**CC-005's proposed fix would have broken CI.** TREASURY suggested dropping
`prisma generate` from `@ovation/core`'s typecheck and letting
`"dependsOn": ["^build"]` supply it. `^build` means the builds of the package's
*dependencies*, and `@ovation/core` has none — so `@ovation/core#typecheck`
would have run `tsc --noEmit` against an ungenerated client on any checkout
without a warm `node_modules/.prisma`. It would have passed on the author's
machine and failed in CI. Replaced with an explicit
`"@ovation/core#typecheck": { "dependsOn": ["@ovation/core#build"] }`.

**CC-009 is only partly done, and says so.** The `channel` field landed and both
subscriptions prefer it over the header. `/api/live/stream` is **not** deleted:
the live app's browser clients consume it, and moving them to a tRPC
subscription link is a client refactor with no user-visible gain. Logged as a
risk, not claimed as done.

### The migration

`scripts/critic/migrate-cc.ts`. `db:push` was off-limits for this run, and its
`--force` variant is what `db:reset` uses to drop the fixture set — so the SQL
is `prisma migrate diff --from-schema-datamodel <pre-Phase-3>
--to-schema-datamodel <current> --script` verbatim, made idempotent, applied
through `@ovation/core/db` over :443. It contains no `DROP`, no type change and
no `NOT NULL` on an existing table. Row counts identical before and after. It is
re-runnable as a no-op.

---

## 4 · The adversarial pass

79 checks across five harnesses. **Four defects found, all fixed, all
regression-tested.** Raw output is in `scripts/critic/out-*.txt`.

### 4.1 · Four defects

#### D1 · CROSS-TENANT WRITE via the approval `patch` — **critical**

`agent.approve` verified that the *action* belongs to the caller's organisation
(`assertActionsBelongToOrg`). Nothing re-checked the event named *inside the
payload*, and `patch` is merged into `payload.input` before `performMutation`
runs. So:

```ts
approve({ actionIds: [an action I legitimately own],
          patch: { input: { eventId: "<any event id in the database>" } } })
```

executed the mutation against that event. **Any signed-in user of any
organisation could restyle, re-date or rewrite the agenda of any event in the
product**, needing nothing but an event id.

Reproduced against two throwaway organisations: org A rewrote org B's theme,
status `EXECUTED` (check A2). Fixed by pinning `eventId` and `type` from the
stored payload in `applyPatch`, plus `assertEventInOrg` inside the transaction
as a second lock. `draft_emails` and `draft_sponsor_offer` already scope their
guests and sponsors by `eventId`, so pinning it closes every tool at once.

CONDUCTOR's claim — "the only path to a side effect is `agent.approve`" — is
true. It was the wrong thing to have been confident about.

#### D2 · DOUBLE EXECUTION under concurrent approval — **serious**

`executeOne` re-read the row inside the transaction and checked its status,
under a comment stating that this stopped two concurrent approvals both
executing. It did not: at READ COMMITTED both transactions read `PROPOSED`, both
passed the check, both ran the mutation. Two parallel `agent.approve` calls for
one `draft_emails` action produced **two** sets of `EmailMessage` rows — a
double-clicked Approve button drafts the campaign twice (check A7). Fixed with a
conditional `updateMany` claim (compare-and-swap) before the mutation; the loser
sees `count === 0` and rolls back.

#### D3 · CROSS-TENANT READ in `agent.history` — **serious**

`agentAction` was filtered by `organisationId`; `chatMessage` was filtered only
by `eventId`. Any signed-in user could read the full agent transcript of any
event by id, including whatever the organiser typed into the chat (check A9).
Fixed by scoping through the event relation. `agent.actions` was already correct.

#### D4 · Idempotency-key collision refuses a genuine guest — **moderate**

Introduced by CC-006 as specified, caught by a case MAÎTRE D' had no way to try
before the column existed. The unique index is `(eventId, idempotencyKey)` and
the key is generated **client-side**. Looking a replay up by key alone meant a
second, unrelated guest scanning with a colliding key was answered
`ALREADY_CHECKED_IN` at the *first* guest's arrival time and never got a
`CheckIn` row — a device with a weak key generator could refuse entry to a
stranger (check E5). Fixed: the replay lookup matches on `guestId` too, and a
key already taken by another guest is namespaced on write, so a genuine guest is
never turned away and replay dedupe still holds per guest (E5, E6).

### 4.2 · What held

**The approval gate, everything else about it.** Cross-tenant approve is
`FORBIDDEN`. Nothing anywhere reaches `SENT`. `OUTBOUND` refuses `AUTO`
approval even with `autoApproveCosmetic: true`. A rejected action cannot be
approved. A firing `autoFire: true` pricing rule creates no tier and only
proposes — 2 tiers before, 2 after (check A10). `personaliseInvite` writes
nothing without a key.

**Overselling — MAISON's claim survived a much harder push than 12.**

| Scenario | Result |
| --- | --- |
| 120 concurrent single-seat buyers, 10 seats | exactly 10 sold, tier closed itself |
| 200 concurrent buyers, 1–4 seats each, 60 seats | exactly 60 sold, `sold` == sum of live order quantities |
| 300 concurrent attempts at one remaining seat | exactly 1 winner |

Release gives seats back; a double release does not go negative. Foreign,
`DRAFT`, `CLOSED` and `SOLD_OUT` tiers are refused, as are negative, zero, NaN,
Infinity and 1,000,000-seat quantities. A fractional quantity is floored and
charged on the floored figure.

**The door — 11/11 reproduced, plus 11 cases MAÎTRE D' did not try, all
correct.** `alg=none`; a genuine token with its signature stripped; a payload
swapped to another guest with the original signature; a correctly signed token
with **no `exp`** (a door pass that never dies); a token that is *both* expired
and forged, which reads `INVALID` rather than `EXPIRED` so the door does not
tell a forger which half of the forgery worked; a forged token with a
hundred-year expiry; a guest deleted between issue and scan; a 64 KB token;
control characters; SQL in the manual `guestId` field; and a whitespace-padded
genuine token, which is correctly accepted.

**Numbers.** `revenue.summary` returns exactly 2,814,000 and 2,450,000 cents
through the mounted router. ORACLE's 102 unit tests pass (9 files). TREASURY's
83 pass. CONDUCTOR's `verify:dod` is 57/57.

### 4.3 · Prompt injection — what is proven and what is not

`ANTHROPIC_API_KEY` is empty. **This does not test whether a real
`claude-opus-5` resists injection, and nothing here should be read as saying it
does.** What it does is drive the real production path with a scripted model
that *obeys the injection completely*, which is the stronger deterministic
claim.

Six payloads — `"Ignore previous instructions…"`, a `</guest_record>` block
escape, SQL, a bidi-override name, an embedded `SYSTEM OVERRIDE` line, a
`<script>` tag — written into a guest's `name`, `company` and `notes`, carried
by `buildAgentContext` into the real system prompt. The scripted model then
calls `draft_emails` with subject *"The event is cancelled"* and asks for
`status: "EXECUTED"`, `risk: "COSMETIC"`, `autoApprove: true`.

Outcome: **one `PROPOSED` card and nothing else.** The model's `status`, `risk`
and `autoApprove` never reach the payload (zod strips them — the stored input is
exactly `draft, intent, eventId, guestIds`), risk comes from `TOOL_RISK`,
`eventId` is injected server-side, and **no injection string reaches the prompt
verbatim** — angle brackets, newlines, control characters and bidi marks are all
neutralised on the way in.

ORACLE: `sanitiseValue` neutralises all six; a value cannot fake the line
structure of its own `<guest_record>` block; `safeFirstName` strips bidi and
zero-width marks; `inspectEmail` flags invented proper nouns, invented numbers
and injection-shaped copy before a human reads it.

TREASURY: `groundingViolations` passes grounded copy and catches `4200`, `850`
and `99000` as unsupported.

**Still unverified pending a key:** whether the model refuses the instruction;
whether it picks the right tool at all; whether ORACLE's personalisation or
TREASURY's offer drafting produce usable copy. That is the largest untested
surface in the product and no amount of scripting closes it.

---

## 5 · Every cross-boundary edit

Grouped by why, not by file. Nothing outside this list was touched.

**Wiring (step 1)**
- `apps/console/src/server/router.ts` — four stubs → four real routers.
- `apps/console/next.config.ts` — four `transpilePackages` entries. `serverExternalPackages` (all four) and `outputFileTracingRoot` untouched.
- `apps/console/package.json`, `apps/events/package.json`, `apps/live/package.json`, `e2e/package.json` — workspace deps and two `exports` subpaths. Every direct `@prisma/client` dependency untouched.
- `apps/live/src/server/{live/announce,live/checkin,live/cues,live/router,realtime/bus,realtime/index,realtime/pusher}.ts` — 9 `~/` imports → relative.
- `apps/live/src/server/peers.ts` — peer caller binds `guestsRouter`/`revenueRouter` directly.
- `apps/live/src/server/router.ts` — mounts the real `guests` and `revenue`; `event`, `page`, `agent` stay stubs deliberately, because this app never calls them and a stub fails loudly.
- `turbo.json` — three task overrides (§2), plus CC-005's ordering fix.

**Contract changes (step 2)**
- `packages/core/prisma/schema.prisma` — `Order.buyerName`, `CheckIn.idempotencyKey` + unique, `Introduction`, `Cue`, two back-relations on `Event`.
- `packages/core/src/schemas/agent.ts` — `draftCopySchema`, optional `draft` on two inputs.
- `packages/core/src/schemas/event.ts` — `publicTicketTierSchema`, `tiers` on `pageRenderOutput`.
- `packages/core/src/schemas/live.ts` — `channel` on `liveFeedInput`.
- `packages/core/src/trpc/routers/revenue.ts` + `packages/revenue/src/router.ts` — `sponsorUpsellCandidates` query → mutation.
- `packages/core/package.json` — `prisma generate` out of `typecheck`.
- `apps/console/src/server/agent/{actions,brain,execute}.ts` + `components/chat/proposal-card.tsx` — CC-001 unwind.
- `apps/events/src/server/ticketing.ts`, `routers/page.ts`, `app/api/stripe/webhook/route.ts`, `app/e/[slug]/checkout/[orderId]/{actions.ts,page.tsx}`, `app/e/[slug]/tickets/page.tsx` — CC-002 and CC-003 unwinds.
- `apps/live/src/server/live/{checkin,cues,matchmaking,router}.ts`, `app/api/live/cues/route.ts` — CC-006/007/008/009.

**Security fixes (step 3)**
- `apps/console/src/server/agent/execute.ts` — `applyPatch` pins `eventId`/`type`; `assertEventInOrg`; compare-and-swap claim.
- `apps/console/src/server/routers/agent.ts` — `agent.history` tenant scoping.
- `apps/live/src/server/live/checkin.ts` — key-collision handling.

**Test-only, no production code**
`scripts/critic/*`, `apps/console/scripts/critic-*.ts`,
`apps/events/scripts/critic-oversell.ts`, `apps/live/scripts/critic-{door,perf}.ts`,
`e2e/tests/golden-path.spec.ts` (replacing `smoke.spec.ts`), and
`@ovation/core`/`guests`/`revenue`/`tsx` as root devDependencies so the scripts
resolve.

---

## 6 · Test results

| Suite | Result |
| --- | --- |
| `pnpm typecheck` (`TURBO_FORCE=true`) | **9/9** |
| `pnpm build` (`TURBO_FORCE=true`) | **4/4** |
| `@ovation/guests` vitest | 102/102, 9 files |
| `@ovation/revenue` vitest | 83/83, 4 files |
| `@ovation/console verify:dod` | 57/57 |
| Critic — approval gate (A1–A11) | 16/16 after fixes; 3 failures before |
| Critic — oversell (B1–B8) | 17/17 |
| Critic — door (C1–C11, D1–D11, E1–E6) | 28/28 after fix; 1 failure before |
| Critic — injection (F1–F5, G1–G5, H1–H2) | 12/12 |
| Critic — integration (I, J, K) | 24/24 |
| Playwright golden path | written, typechecked, **not run** (§7) |
| Lighthouse | **not run** (§8) |

### CONDUCTOR's 57/57 has four stale checks

`verify:dod` section 6 asserts that `guests.list`, `revenue.summary`,
`live.ops` and `page.render` throw `NOT_IMPLEMENTED`. That was correct in
Phase 2 and is now **the exact opposite of what Phase 3 delivered**. They still
pass only because the harness composes its own router from `contractRouters`
rather than importing the console's. Left alone, because it is CONDUCTOR's
evidence file and rewriting it would erase their record — but a green 57/57
should not be read as evidence the integration works. `critic-integration.ts`
is the check that says that.

---

## 7 · Why the e2e suite is not green

`e2e/tests/golden-path.spec.ts` replaces the Phase 1 placeholder with seven
serial specs on a throwaway event: the auth gate, a theme change restyling the
public page, registration appearing scored in guest intelligence, a purchase
moving `revenue.summary`, check-ins moving the ops snapshot, an announcement
crossing to a second browser context, and a final assertion that the seeded
event is untouched. It typechecks.

**It cannot run on this machine.** Every Next dev server answers 500 on its
first database query. `scripts/critic/ws-probe.ts` isolates it:

| Transport | Outside Next | Inside Next |
| --- | --- | --- |
| `neon()` over HTTP | ok, 1072 ms | — |
| default WebSocket `Pool` | ok, 973 ms | `Received network error or non-101 status code` |
| `poolQueryViaFetch` | ok, **247 ms** | `unable to verify the first certificate` |

101 is the WebSocket upgrade. Forcing the fetch transport surfaces the real
cause: `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — the same TLS interception that makes
`prisma generate` fail against `binaries.prisma.sh` (it needs
`NODE_TLS_REJECT_UNAUTHORIZED=0` to complete here). Under plain `tsx` Node
trusts the chain; inside Next's server runtime it does not.

This is the network, not the product. But the consequence is worth stating
plainly: **nobody has seen these three applications render against real data
from this environment.** Every claim in this report, and in the five agents'
reports, comes from driving server modules in-process.

`neonConfig.poolQueryViaFetch = true` was tried and **deliberately reverted**:
it did not fix the local failure and I cannot verify it on Vercel. It is a
recommendation (§10), not a shipped change.

---

## 8 · Performance

**Check-in P95 misses the 2.5 s target here.** 250 simulated guests, 8 lanes,
on a throwaway event.

| | p50 | p95 | p99 | max | throughput |
| --- | --- | --- | --- | --- | --- |
| run 1 | 2664 ms | **3371 ms** | 3808 ms | 4402 ms | 2.9 scans/s |
| run 2 | 4710 ms | **8099 ms** | 9384 ms | 9775 ms | 1.6 scans/s |

All 250 got in, one row each, no duplicates. But the 2.4× spread between two
identical runs means this is not a controlled measurement. The attribution is in
`scripts/critic/rtt.ts`: a bare `SELECT 1` through the same adapter costs
**p50 250 ms** from this machine and a two-statement transaction **1027 ms**. A
scan makes four to five sequential round trips, so roughly 1.3 s of the median
is wire before any work happens. Co-located with the database this would be
~5–15 ms per trip and the target is comfortable.

`live.ops` at 250 arrivals: p50 963 ms, p95 1434 ms — passes.

One real code observation independent of the network: the check-in path makes
more round trips than it needs, and CC-006 initially added two more. One is now
folded into the existing lookup — a single query answers both "is this a replay
for this guest" and "is this key taken by someone else".

**Lighthouse was not run.** It needs the events app serving real pages, which
§7 rules out. Reported as not done rather than estimated.

---

## 9 · Fixture state

Verified after every destructive run and again last:

| | Expected | Actual |
| --- | --- | --- |
| Ticket revenue | €28,140 | €28,140 (2,814,000 c, 178 PAID) |
| Sponsor revenue | €24,500 | €24,500 (2,450,000 c, 3 SIGNED) |
| Guests | 200, no `.test` | 200, 0 with `.test` |
| Check-ins on the seeded event | 0 | 0 |
| Open `PROPOSED` proposals | 3 | 3 |
| `Event.theme.preset` | `blacktie` | **`blacktie`** |
| Organisations | 1 | 1 |
| Events | 2 | 2 |

`theme.preset` is untouched: no test of mine wrote to Meridian Summit 2026. All
destructive work ran on `critic-org-a` / `critic-org-b` and their events, torn
down by `scripts/critic/rig.ts`. `pnpm db:seed`, `db:reset` and `db:push` were
never run.

The database schema now has four additions (§3) that the seed script does not
know about. They are all nullable or new tables, so a future `db:seed` is
unaffected.

---

## 10 · Remaining risks, most severe first

**1 · No LLM path has ever run against a real model.**
Tool selection, ORACLE's personalisation and TREASURY's offer drafting are
unproven end to end. Everything in §4.3 proves the *machinery around* the model
is safe when the model misbehaves; nothing proves the model behaves. This is
the single largest gap and it is not closable without a key.

> **CLOSED — the key was there all along.** The Vercel API returns an empty
> string for every `type=sensitive` variable, so reading `ANTHROPIC_API_KEY`
> back and seeing `""` proved nothing; `AUTH_SECRET` and `DIRECT_URL` read the
> same way, and production signs users in and reaches Postgres. All four paths
> now run against `claude-opus-5`: tool selection (`verify:dod`, 61/61),
> ORACLE's personalisation (`pnpm --filter @ovation/guests eval`, every fixture
> grounded, distinct and injection-resistant), TREASURY's offer drafting
> (`offer:preview`, every claim traceable to the evidence list), and prompt
> injection (`critic-injection.ts` §F6 — the real model refused the injected
> instruction and told the organiser to clean the poisoned records).
>
> The first live turn found a real defect: the SDK was pinned at **0.32.1**, two
> years older than the model it calls. On `claude-opus-5` thinking is on when
> the parameter is omitted — the reverse of the previous generation — and
> `display` defaults to `omitted`, which returns thinking blocks with an empty
> `thinking` field. The tool loop echoes assistant blocks back on the next
> round, and the API rejects a blank one: `messages.17.content.0.thinking: each
> thinking block must contain thinking`. Fixed by upgrading to 0.116.0 and
> stating the intent — `thinking: {type: "adaptive", display: "summarized"}` —
> plus `max_tokens` 4096 → 16000, since that ceiling now covers thinking and the
> reply together.
>
> §F6 is evidence, not a guarantee: one model, one day. The guarantee remains
> the machinery in §4.3, which does not depend on the model behaving.

**2 · No application has been seen serving a page against real data.**
§7. Three Next apps, zero verified browser renders in this environment. A defect
that only manifests in the Next runtime — a serialization boundary, a client
component boundary, an RSC caching interaction — would be invisible to
everything in this report. The Playwright suite exists precisely to catch that
class and has not been able to.

**3 · The approval `patch` is a wide door, now bolted rather than narrowed.**
D1 is fixed by pinning `eventId`, which closes every tool *today* because every
tool scopes its other ids by event. A new tool that takes an id not scoped by
`eventId` reopens it silently. The right shape is a per-tool allowlist of
patchable fields, not a merge with exclusions. Recommended before `v0.2`.

> **NARROWED — Agent 8 · LOCKSMITH, 2026-08-14.** `PATCHABLE_FIELDS` in
> `packages/core/src/schemas/agent.ts` now declares, per tool, the fields a
> human may edit at approval time; `applyApprovalPatch` merges those and
> discards the rest. Default deny: a tool with no entry accepts no patch.
>
> The recommendation was to stop relying on luck. Two things enforce that now
> rather than one. `satisfies PatchableFields` fails to compile until a new
> member of `AgentToolName` has an entry — the same shape as `TOOL_RISK`. And an
> entry may only name fields that exist on that tool's own input, excluding
> anything spelled `…Id` or `…Ids`, so the `sponsorId`/`userId`/
> `organisationId` this risk describes cannot be allowlisted even deliberately.
> A target named `recipient` still could; the human writing the entry is what
> stops that, which is a smaller gap than the one it replaces.
>
> A refused field is not dropped quietly — it is logged, and returned to the
> organiser as `ignoredPatchFields` on the action's result. Evidence:
> `apps/console/scripts/critic-patch-allowlist.ts`, 24 checks, no database
> needed; check A12 in `critic-approval.ts` for the end-to-end version.
> `assertEventInOrg` and the `eventId` pin both stay.

**4 · Ticket reservation collapses under a flash sale.**
Above roughly 30 simultaneous buyers on one tier, a large minority of
reservations die with `Transaction already closed: the timeout for this
transaction was 5000 ms` — 22 of 620 attempts across the oversell runs. Nothing
oversells and no seat leaks, but those buyers get an unhandled throw rather than
"sold out": `startCheckout` translates `SoldOutError` and nothing else. Partly
the 250 ms network here, but the reservation serialises on one `TicketTier` row
by design, so a real on-sale rush will hit this. Needs a caught-and-translated
timeout at minimum.

> **RESOLVED — and it was worse than this.** `critic-oversell.ts` wraps every
> call in `.catch()`, which folds a crash into the same shape as a polite
> refusal, so it could only ever see these as losses. `critic-rush.ts` separates
> them and asks the one question that has no legitimate failure: with room for
> everybody, does everybody get served? At 120 concurrent buyers and 240 seats,
> **55 of 120 threw, and `sold` came back 72 against 65 orders — seven seats
> taken with nothing behind them.** Not just an ugly error: leaked inventory,
> and a p50 of 33 s. Release leaked too: 33 reserved, 24 released, 10 seats
> never came back.
>
> The cause was not the 5 s timeout, which is a symptom. Reservation held the
> contended `TicketTier` row across three network round trips — take seats,
> close tier, insert order — while every other buyer queued behind it. It is now
> one data-modifying CTE that does all three, so the row is held for one
> server-side statement and there is no interactive transaction left to expire.
> Release is one statement for the same reason. After: **120/120 and 300/300
> served, 0 threw, no leak, p50 33 s → 3.3 s.** Losers still lose, in a sentence.
> See `apps/events/scripts/critic-rush.ts` and §10a below.

**5 · `verify:dod` asserts the opposite of the shipped integration.**
§6. Four of its 57 checks encode "the other routers are stubs". Anyone reading
57/57 as a health check after Phase 3 is reading it wrong.

**6 · Check-in P95 is unmeasured in a realistic topology.**
§8. The target may well be met in production; nothing here demonstrates it, and
the two runs disagreed by 2.4×.

**7 · `/api/live/stream` still duplicates `live.feed`.**
CC-009 landed the field that makes the extra doorway unnecessary but the browser
clients were not migrated. Two doorways, one bus — no correctness cost, ongoing
maintenance cost.

**8 · `neonConfig.poolQueryViaFetch` is an unshipped 4× improvement.**
247 ms against 973 ms for the same query. It should be tried on a preview
deployment. It was not shipped because it could not be verified here and the
deploy has already been broken twice.

**9 · The Neon WebSocket path is untested under load.**
Interactive transactions need it and it is exactly the transport that fails in
the Next runtime here. If the same failure occurs anywhere in production, every
`$transaction` — including the approval path and the reservation path — fails.

**10 · Cue "fires once per night" state is still in memory.**
CC-008 persists cue *configuration*, not the fired marker. A restart mid-event
re-arms every cue. Mitigated by the persistent "is there already an open
proposal for this cue" check, which is what actually prevents a duplicate card,
so the exposure is small — but the guarantee is narrower than "cues are
persistent".

**11 · Sanitised guest names can still read oddly.**
`safeFirstName` on a bidi-override name yields `ZoetseuGIGNORE`. Inert, but an
organiser would see it in a draft. Cosmetic.

**12 · CC-005's EPERM has a second cause nobody has written down.**
The `prisma generate` rename failure is not only the concurrency race TREASURY
diagnosed. A *running* `next dev` holds `query_engine-windows.dll.node` open, so
`pnpm typecheck` from another terminal fails with the identical EPERM while the
dev server is up. Fixing the race does not fix that. Stop the dev servers before
a root typecheck on Windows.

---

## 10a · Fixed after this report was written

Kept separate from §10 on purpose: §10 is what the Critic found, and it should
stay readable as the snapshot it was. This is what happened next.

**Risk #2 — no application seen serving a page against real data. CLOSED.**
The cause was TLS interception on this machine regenerating its root CA
mid-run, not anything in the product. `scripts/trust-local-tls.mjs` pins that CA
and `NODE_EXTRA_CA_CERTS` points at it — a CA already in the machine's root
store, never `NODE_TLS_REJECT_UNAUTHORIZED=0`. All three apps now serve real
Neon data, and 5 of the 7 golden-path tests pass. Tests 4 and 5 still fail
inside Playwright's CJS transform when importing package internals from an ESM
workspace: a harness limitation, not a product defect.

**Risk #4 — reservation under a flash sale. FIXED.** Detailed inline above.
Two scripts came out of it, both of which now guard the fix:

- `apps/events/scripts/critic-rush.ts` — the concurrency question, with crashes
  counted separately from refusals so a regression cannot hide in a total.
- `e2e/scripts/browser-purchase.ts` — one purchase through a real browser, the
  real form and the real server action against a running server. Everything else
  that exercises reservation runs the module under tsx, which proves the SQL and
  not the path a guest takes.

---

## 11 · How to reproduce everything here

```bash
cp /path/to/.env .env && pnpm install

# The claims of the five agents
pnpm --filter @ovation/guests test          # 102
pnpm --filter @ovation/revenue test         #  83
pnpm --filter @ovation/console verify:dod   #  57

# The critic's passes (each builds and tears down its own organisations)
pnpm --filter @ovation/console exec dotenv -e ../../.env -- \
  node --conditions=react-server --import tsx scripts/critic-approval.ts
pnpm --filter @ovation/console exec dotenv -e ../../.env -- \
  node --conditions=react-server --import tsx scripts/critic-injection.ts
pnpm --filter @ovation/console exec dotenv -e ../../.env -- \
  node --conditions=react-server --import tsx scripts/critic-integration.ts
pnpm --filter @ovation/events  exec dotenv -e ../../.env -- tsx scripts/critic-oversell.ts
pnpm --filter @ovation/events  exec dotenv -e ../../.env -- tsx scripts/critic-rush.ts 300
pnpm --filter @ovation/live    exec dotenv -e ../../.env -- tsx scripts/critic-door.ts
pnpm --filter @ovation/live    exec dotenv -e ../../.env -- tsx scripts/critic-perf.ts

# Fixtures and diagnostics
npx tsx --env-file=.env scripts/critic/fixtures.ts
npx tsx --env-file=.env scripts/critic/rtt.ts
npx tsx --env-file=.env scripts/critic/ws-probe.ts

pnpm typecheck && pnpm build
```

The browser purchase needs a server to drive:

```bash
pnpm --filter @ovation/events build && pnpm --filter @ovation/events start &
pnpm --filter @ovation/e2e exec dotenv -e ../.env -- tsx scripts/browser-purchase.ts
```

The two console scripts **must** run under `--conditions=react-server`; the
console's server modules import `server-only`.

`prisma generate` fails fetching the engine checksum from `binaries.prisma.sh`
on a TLS-intercepting network. Run `node scripts/trust-local-tls.mjs` once — it
pins the intercepting root CA from the machine's own root store and points
`NODE_EXTRA_CA_CERTS` at it. Do **not** use `NODE_TLS_REJECT_UNAUTHORIZED=0`,
which this report originally suggested: it disables certificate verification for
every connection the process makes, including the ones to the database.
