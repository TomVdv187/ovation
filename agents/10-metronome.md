# Agent 10 · METRONOME — make a cue survive a restart

Branch: `feat/metronome` · Owns: `apps/live/src/server/live/cues.ts`,
`apps/live/src/server/live/cue-timer.ts`

---

You are fixing one defect in **apps/live**, the live-ops app of OVATION — the
part an event team runs on the night: check-in, the host companion, the ops
dashboard, and **cues**.

A cue is a rule that watches the night and proposes something when it triggers:
*when 60% of guests have arrived, propose announcing the keynote.* Cues fire
**once per night** — that is the guarantee.

Read `INTEGRATION_REPORT.md` §10 risk 10 before you start. This is that item.

Work **ONLY** in `apps/live/`. `packages/core` is **READ-ONLY** except for the
one schema change described below, which you must make and keep minimal.

## The problem

`apps/live/src/server/live/cues.ts` keeps the fired marker in memory:

```ts
/** `${eventId}:${cueId}` -> when it last fired, so it fires once per night. */
fired: Map<string, number>;
```

CC-008 persisted cue *configuration* — the `Cue` model in
`packages/core/prisma/schema.prisma` has `label`, `trigger`, `auto`, `enabled`.
It did not persist the fact that a cue already went off. So a process restart
mid-event — a redeploy, a crash, a serverless instance recycling, which on
Vercel happens routinely — empties that Map and **re-arms every cue that has
already fired**.

Be accurate about the blast radius, because it changes what you build. A
duplicate proposal card is *already* prevented: before proposing, the code
checks whether an open PROPOSED action exists for that cue, and that check hits
the database. So the visible symptom is small. What is actually broken is the
guarantee: "fires once per night" is enforced by process memory, and every
other guarantee in this system is enforced by the database. A cue whose
proposal was approved and executed, or rejected, no longer has an open
proposal — and after a restart it can fire again.

## What to build

Persist the fired marker so that the once-per-night guarantee holds across
restarts and across concurrent instances.

- Add the minimum to `packages/core/prisma/schema.prisma` — a nullable
  `firedAt DateTime?` on `Cue` is the obvious shape, but if a cue can legitimately
  fire on more than one night for a recurring event, model it so that "this
  night" is expressible. Decide, and say why in your report.
- Apply it with **one additive migration**. Additive: no column drops, no type
  changes, nothing that could fail against a database with live rows in it.
- Replace the reads and writes of `state.fired` with the persisted value. Keep
  an in-memory cache if it helps latency, but the database must be the source
  of truth — on a cold start the answer must come from the database, not from
  an empty Map.
- Make the write **race-safe**. Two instances evaluating the same cue at the
  same moment must produce one firing, not two. A conditional update whose row
  count decides the winner is the pattern already used elsewhere in this
  codebase for exactly this — see `reserve()` in
  `apps/events/src/server/ticketing.ts`, which takes seats with a guarded
  UPDATE and lets the row count settle the race.
- Keep the existing open-proposal check. It is a second, independent guard and
  it stays useful.
- The dev reset route (`apps/live/src/app/api/live/dev/reset/route.ts`) clears
  fired state today. It must keep working — clearing the persisted marker now.

## Constraints

- **One additive migration, applied with `pnpm db:push`.** Never
  `pnpm db:seed`, `db:reset`, or `db:push --force`. The development database is
  shared and seeded, and other work depends on those fixtures being exact:
  tickets €28,140, sponsors €24,500, 200 guests, 0 check-ins, 3 open PROPOSED
  proposals. Verify them after your migration with
  `npx tsx --env-file=.env scripts/critic/fixtures.ts`.
- **Production runs a separate database** (`ovation_prod`). Your migration must
  be safe to apply there too — it is empty today, but write it as though it is
  not.
- Destructive testing goes against a throwaway event, never Meridian Summit
  2026. `scripts/critic/rig.ts` builds and tears down two throwaway
  organisations for exactly this.
- Do not change what a cue *does* when it fires. This is about remembering that
  it did.

## Definition of done

- `pnpm typecheck` and `pnpm build` green across the monorepo.
- `apps/live/scripts/critic-door.ts` still passes everything it passes today.
- **A test that fails on the current code and passes on yours**: fire a cue,
  discard the in-memory state the way a restart would, evaluate again, and
  assert it does not fire twice. Without that test this change is unverified —
  the bug is invisible in a single long-lived process, which is exactly why it
  survived the Critic's pass.
- A test for the concurrent case: two evaluations racing produce one firing.
- Seed fixtures unchanged, verified with the command above and quoted in your
  report.
- A short report: the shape you chose for "this night", the migration you
  applied, and how you proved the restart case.

## Why this matters

The night of an event is the one moment this software cannot be redeployed to
fix. Everything that matters then must survive a process dying, because on
Vercel a process dying is routine rather than exceptional.
