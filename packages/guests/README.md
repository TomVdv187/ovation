# @ovation/guests — guest intelligence

Owned by **Agent 3 · ORACLE**. Scoring, no-show prediction, segmentation,
personalised invitations and the waitlist. The console (Agent 1) and live ops
(Agent 5) reach all of it through the `guests` tRPC contract in
`@ovation/core`; nothing else in this package is load-bearing for them.

```
pnpm --filter @ovation/guests typecheck
pnpm --filter @ovation/guests test     # 102 tests, no database, no API key
pnpm --filter @ovation/guests eval     # writes real emails, needs ANTHROPIC_API_KEY
```

## Layout

| Path | What lives there |
| --- | --- |
| `src/engine/` | Pure scoring. No Prisma, no clock, no network. |
| `src/invites/` | Prompt construction, the writer, rate limiting, draft checks. |
| `src/service.ts` | Everything that touches the database. |
| `src/router.ts` | The tRPC procedures. Thin. |
| `eval/` | The invitation eval and its fixtures. |

## Three decisions worth knowing about

**Recency is measured against the event date, not the wall clock.** Every
`daysBetween` call in the engine ends at `EventContext.asOf`, which the router
sets to `event.date`. That is what makes `guests.score` reproducible: run it
today and again next week and the bytes match, because nothing in the
calculation moved. It also reads better to an organiser — "last seen 48 days
before the doors open" is the sentence they need, not "48 days ago".

**The rules live behind a named engine.** `ScoringEngine` has two methods,
`assess` and `recommend`. `rules-v1` implements them by hand; a model
implements them differently and registers under its own id via
`registerEngine`. `guestScoreOutput.engine` carries that id to the console, so
swapping the brain changes a string, not a schema.

**Guest text is data, never instructions.** A guest types their own name and
company into a public registration form, so every one of those fields is
attacker-controlled text that ends up a few characters from a system prompt.
`src/invites/sanitise.ts` escapes angle brackets and flattens newlines and
invisible characters so a value cannot close the block it sits in; the system
prompt then tells the model that the block is data and where its own
instructions come from. Both halves are tested, and the eval runs two hostile
fixtures on every pass.

## Scoring, in one paragraph

Engagement is 0–100, assembled from named contributions: link clicks (24
points at the ceiling), RSVP commitment (22), email opens (18), page visits
(18), activity recency (12), registration lead (10), reply sentiment (±10) and
plus-ones (3). The three largest contributions by absolute weight ship with
every score, ties broken on a fixed rank so the same guest always produces the
same three in the same order — including a guest whose every contribution is
zero, where the factors explain the silence instead of returning nothing.

No-show risk accumulates points from engagement decay, RSVP state, ticket type
(a free seat costs nothing to skip), travel distance, historic behaviour at the
organisation's earlier events, and dormancy, then maps onto a probability and a
LOW/MEDIUM/HIGH band. Settled states short-circuit it: somebody who has checked
in is not a forecast. A brand-new contact's silence is discounted in proportion
to how long they have actually been on the list.

Two proxies are worth flagging, because both would be replaced by better data
the day the schema grows it:

- **Travel distance** comes from the email's top-level domain against the
  venue's country, since `Guest` carries no address. The factor text says so.
- **Reply sentiment** is read from `Guest.notes`, which is the only free text
  the schema gives us for what a guest said back.

## Invitations

`guests.personaliseInvite` writes one email per guest with `claude-opus-5`,
forced through a `compose_email` tool call, batched through a limiter (4
concurrent, 250 ms between starts) so a 500-guest campaign does not arrive as
500 simultaneous requests. Every draft is checked before it is stored; a draft
that fails is retried with the failures fed back, and one that keeps failing is
dropped and logged rather than stored.

**Nothing here sends anything.** Drafts land as `EmailMessage` rows with
`status = PROPOSED` and `personalised = true`, and the Conductor's approval flow
owns delivery. There is no email-delivery client anywhere in this package, not
even in a dependency — a case-insensitive search of `packages/guests/` for the
delivery provider's name returns nothing, and it should stay that way.

### The eval

```
pnpm --filter @ovation/guests eval
```

Writes a real email for each of five fixture guests and asserts the four things
an organiser is entitled to assume — the right name and company, nothing
invented, a subject that fits an inbox, no marketing language — plus two things
the feature would be pointless without: the five emails are not variations of
one template, and a guest who types an instruction into a form field cannot
steer the writer.

It calls the real API on purpose. The prompt is the part most likely to
regress, and a stubbed model would not exercise it. Without
`ANTHROPIC_API_KEY` the eval exits non-zero with instructions rather than
pretending to pass. The checker itself (`src/invites/checks.ts`) is covered by
`pnpm test`, which needs neither a key nor a database.
