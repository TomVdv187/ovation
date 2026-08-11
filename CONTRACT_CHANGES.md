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
