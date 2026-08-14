# Agent 8 · LOCKSMITH — narrow the approval door

Branch: `feat/locksmith` · Owns: `packages/core/src/schemas/agent.ts`,
`apps/console/src/server/agent/execute.ts`

---

You are hardening the **safety contract** of OVATION, an AI event-management
platform. The contract is the product: an organiser lets an AI agent act on
their event only because nothing reaches the world without a human approving
it. Your job is to make the approval step narrower than it is.

Read `INTEGRATION_REPORT.md` §10 risk 3 before you start. This is that item.

## The problem

When a human approves a proposal they may also send a `patch` — edits made in
the review UI before clicking approve, e.g. changing the wording of a drafted
email. `applyPatch` in `apps/console/src/server/agent/execute.ts` merges that
patch over the payload the model originally proposed:

```ts
return {
  ...base,
  type: base.type,
  input: {
    ...baseInput,
    ...patchInput,
    eventId: baseInput.eventId,
  },
};
```

Everything the patch contains overwrites the stored input, except `type` and
`eventId`, which are pinned back to the stored values. That is a **blocklist**:
safe only for as long as the two pinned fields happen to be the only ones that
matter.

They are the only ones today because every tool scopes its other identifiers by
event. The Critic's finding is that this holds by luck, not by construction. Add
one tool taking an id that is not scoped by `eventId` — a `sponsorId`, a
`userId`, an `organisationId` — and the door reopens silently, with no test
failing and nothing in review to notice. A blocklist has to be updated by
whoever adds the tool; nobody will remember.

## What to build

Replace the merge-with-exclusions with a **per-tool allowlist of patchable
fields**, declared next to `TOOL_RISK` in `packages/core/src/schemas/agent.ts`
so a new tool cannot be added without stating what a human may edit.

Shape it however reads best, but it must satisfy:

1. **Default deny.** A field not named for that tool is discarded, not merged.
   A tool with no entry accepts no patch at all.
2. **Only content, never targets.** The patchable set is copy a human might
   reasonably rewrite — subject, body, summary, a price, a date being
   corrected. Never an identifier that selects who or what is acted upon.
3. **Adding a tool forces the decision.** Use the type system: if
   `AgentToolName` gains a member and the allowlist does not, it must fail to
   compile — the same way `TOOL_RISK` already does with `Record<AgentToolName, …>`.
4. **The discard is visible.** When a patch contains a field that is not
   allowlisted, do not silently drop it — log it, and treat it as a signal
   worth surfacing. A human editing a field the system ignores should not
   believe their edit landed.

Keep `assertEventInOrg` where it is. It is a second, independent check and it
stays useful even when the allowlist is right.

## Constraints

- **Do not weaken anything that exists.** `requiresApproval()`, the
  `ActionRisk` gate, the transactional execution path and `assertEventInOrg`
  all stay. This narrows the door; it does not replace the lock.
- `TOOL_RISK` and the tool registry keep their current values. You are adding
  a table, not editing risk levels.
- Another agent may be working in `apps/www` at the same time. You will not
  collide with it — stay out of `apps/www` and it will stay out of yours.
- Never run `pnpm db:seed`, `db:reset` or `db:push`. The development database
  is shared and seeded, and other work depends on those fixtures being exact:
  tickets €28,140, sponsors €24,500, 200 guests, 0 check-ins, 3 open PROPOSED
  proposals.
- Destructive testing goes against a throwaway event, never Meridian Summit
  2026. `scripts/critic/rig.ts` builds and tears down two throwaway
  organisations for exactly this.

## Definition of done

- `pnpm typecheck` and `pnpm build` green across the monorepo.
- `apps/console/scripts/critic-approval.ts` still passes every check it passes
  today. It is the adversarial suite for this path — 16 checks, three of which
  exist because they caught real defects here. If you have to change one of
  them to pass, you have changed behaviour that was deliberate; say so
  explicitly in your report rather than editing the test quietly.
- **New tests you add**, in the same file or alongside it, proving:
  - a patch naming an identifier the tool does not allowlist is discarded, and
    the executed action still targets what the model proposed;
  - a patch naming an allowlisted content field is applied;
  - a tool with no allowlist entry accepts no patch;
  - removing a tool's entry (or adding a tool without one) fails to compile.
    A comment showing the compiler error is fine where a test cannot express it.
- A short report: the shape you chose, why, and what a future tool author now
  has to do that they did not have to do before.

## Why this matters

The Critic could not break the approval gate from the outside — it tried, and
the machinery held. This is the one place it said would give way on its own,
later, quietly, when somebody adds a perfectly reasonable tool. Fix it before
that person exists.
