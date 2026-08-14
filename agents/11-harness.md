# Agent 11 · HARNESS — get the last two golden-path tests running

Branch: `feat/harness` · Owns: `e2e/`

---

You are fixing the **test harness** of OVATION, not the product. Two of the
seven golden-path tests have never run. They fail before they reach a single
assertion, which means two of the product's most important guarantees —
a ticket purchase moving revenue, and a check-in moving the ops snapshot — are
currently unverified end to end.

Work **ONLY** in `e2e/`, plus package manifests if the fix genuinely requires
them. If you conclude the fix belongs in product code, stop and say so in your
report rather than reaching into `apps/` or `packages/` — see Constraints.

## The problem

`e2e/tests/golden-path.spec.ts` tests 4 and 5 import workspace internals:

```ts
const { startCheckout } = await import("@ovation/events/ticketing");
const { revenueRouter } = await import("@ovation/revenue");
const { signQrToken } = await import("../../apps/live/src/server/live/qr");
```

Under Playwright's CommonJS transform, against an ESM workspace, these fail
with:

```
Cannot read properties of undefined (reading 'exports')
'./schemas/index' is not in cache
```

Tests 1, 2, 3, 6 and 7 pass because they drive the apps through a browser and
never import package internals. The two failures are entirely about module
loading, not about the product: the same code paths are exercised successfully
by `apps/events/scripts/critic-rush.ts` and `apps/live/scripts/critic-door.ts`,
which run under `tsx` and work fine.

## What to build

Make tests 4 and 5 run, without weakening what they assert.

Several shapes could work — pick one and justify it:

- configure Playwright so its transform handles the ESM workspace (a
  `tsconfig`/loader/`transform` setting, or running the specs as true ESM);
- drive those two assertions through the running servers over HTTP instead of
  importing modules, the way tests 1–3 already do;
- move the setup those tests need behind a small helper that runs in a child
  process under `tsx` and returns its result to the spec.

What they must still prove when you are done:

- **Test 4**: a real ticket purchase moves `revenue.summary` — the delta is
  exactly the amount purchased, and `tickets.sold` increases. It currently
  buys 2 × €75 and asserts a 15,000-cent delta. Keep an assertion that strong.
- **Test 5**: a check-in moves the ops snapshot, using a QR token signed the
  way the real one is. Do not stub the signing — a check-in test that does not
  exercise the signature is testing nothing that matters.

## Constraints

- **Do not weaken an assertion to make it pass.** Replacing an exact-amount
  check with "greater than zero", or deleting a case, converts a failing test
  into a passing one that proves less. If an assertion genuinely cannot be
  kept, say which and why in your report and leave it failing — an honest red
  is worth more than a dishonest green.
- **Do not change product code to suit the test runner.** If the only real fix
  is in `apps/` or `packages/` — a package export shape, say — write up what
  you found and what you would change, and stop. That is a contract change and
  it needs a human, not a worktree.
- Tests 1, 2, 3, 6 and 7 must still pass. Run the whole file, not just the two.
- `e2e/playwright.config.ts` builds and runs the apps with `next start` rather
  than `next dev`, deliberately: two dev servers plus a browser exhausted the
  machine and the run died with a heap OOM that read like a product failure.
  Keep that. If you need servers you started yourself, `E2E_NO_SERVER=1` is
  already supported.
- Never run `pnpm db:seed`, `db:reset` or `db:push`. The suite creates and
  tears down its own fixtures, and test 7 exists to prove the seeded event is
  untouched by the run — it must still pass.
- The suite runs against Meridian Summit 2026's database. Anything you create,
  remove.

## Definition of done

- `pnpm --filter @ovation/e2e test` — **7 passed, 0 failed.**
- Test 7 ("the seeded fixture event is untouched by this suite") still passes,
  and `npx tsx --env-file=.env scripts/critic/fixtures.ts` shows the fixtures
  unchanged: tickets €28,140, sponsors €24,500, 200 guests, 0 with `.test`
  emails, 0 check-ins, 3 open PROPOSED proposals.
- `pnpm typecheck` green.
- A short report: the cause in one paragraph, the shape you chose and why the
  alternatives lost, and confirmation that no assertion was weakened.

## Why this matters

`INTEGRATION_REPORT.md` records these as "a harness limitation, not a product
defect", which is true and is also how an untested path stays untested. Ticket
purchase and check-in are the two moments where OVATION touches money and the
door. They deserve a test that actually runs.
