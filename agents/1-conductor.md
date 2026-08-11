# Agent 1 · CONDUCTOR — console shell + the agent brain

Branch: `feat/conductor` · Owns: `apps/console/` · Port 3000

---

You are building **apps/console** for OVATION, an AI event-management platform —
"an event agent that runs the whole event business": event pages, ticketing,
sponsors, guest intelligence, live ops.

Work **ONLY** in `apps/console/`. Four other agents are building
`apps/events`, `packages/guests`, `packages/revenue` and `apps/live` in
parallel right now. You integrate with them through the tRPC contracts in
`packages/core` and nothing else.

`packages/core` is **READ-ONLY**. Do not edit it. If you need a schema, type or
procedure signature changed, append a request to `CONTRACT_CHANGES.md` at the
repo root (append-only — add at the bottom, never edit someone else's entry)
and code against the contract as it stands.

You are the most important agent in Phase 2: the agent brain is the product.

## What already exists

The Architect has landed the scaffold. `pnpm install && pnpm typecheck &&
pnpm build` are green. Read these before writing code:

- `packages/core/src/schemas/agent.ts` — **the safety contract.** Tool registry,
  `TOOL_RISK`, `requiresApproval()`, the `AgentAction` payload union.
- `packages/core/src/trpc/routers/agent.ts` and `.../event.ts` — the exact
  procedure signatures you must implement.
- `packages/core/src/trpc/init.ts` — `router`, `publicProcedure`,
  `protectedProcedure`, `orgProcedure`, and the `Context` type
  (`{ db, session, headers }`).
- `packages/core/prisma/schema.prisma` — the data model.
- `packages/core/src/design/tokens.css` — the design tokens.

Already wired in your app:

- `apps/console/src/server/auth.ts` — NextAuth v5, email magic link. With no
  `RESEND_API_KEY` the link prints to the terminal.
- `apps/console/src/server/router.ts` — **you own this file.** It composes the
  app router. Today every entry is the `NOT_IMPLEMENTED` stub.
- `apps/console/src/app/api/trpc/[trpc]/route.ts` — the tRPC handler.
- `apps/console/src/trpc/react.tsx` — typed client (`api.agent.command.useMutation()`).
- `apps/console/src/trpc/server.ts` — server-side caller for RSCs.
- `apps/console/src/app/page.tsx` and `signin/page.tsx` — placeholder shells.
  **Replace `page.tsx` entirely.** It exists only to prove the scaffold boots.

Imports: `@ovation/core` for schemas/contracts/tokens, `@ovation/core/db` for
the Prisma client (`import { db } from "@ovation/core/db"`). Path alias `~/*`
maps to `apps/console/src/*`.

Seed data (`pnpm db:seed`): org "Meridian Collective", event **Meridian Summit
2026** (slug `meridian-summit-2026`, 24 Sep 2026, Horta Hall Antwerp, capacity
250), 200 guests, 3 ticket tiers, 3 sponsors, and **3 open AgentActions with
status PROPOSED** — use those to build the approval UI before your brain
produces its own.

## Mount only your own routers

In `apps/console/src/server/router.ts`, replace the stubs for **`event` and
`agent` only**. Leave `page`, `guests`, `revenue` and `live` pointing at
`contractRouters.*` — those belong to other agents and Agent 7 · CRITIC mounts
them in Phase 3.

**This means your Guests, Revenue and Live views will get `NOT_IMPLEMENTED`
back for the whole of Phase 2. That is correct.** Render a calm pending state
("Guest intelligence lands with Agent 3") — never an error boundary, never a
crash. Treat `NOT_IMPLEMENTED` as a first-class UI state.

## Build

### 1. Console layout

- 64px icon rail: Overview, Event Page, Guests, Revenue, Live.
- 360px persistent agent-chat panel.
- Main content area.

Use the design tokens (`--ov-*`, dark + gold, serif display headings) via the
Tailwind preset — `bg-surface`, `text-ink-muted`, `text-gold` etc. **Never
hardcode a hex.** The rail and chat widths are `--ov-rail` / `--ov-chat`,
available as `w-rail` / `w-chat`.

Views other than Overview render placeholder panels that **actually call** the
contract procedures, so they light up the moment another agent's router is
mounted.

### 2. Overview view

- Stat tiles: registrations, predicted show-rate, revenue, agent actions today.
  Source from `event.stats`.
- Registrations-over-time line chart. **Hand-rolled SVG, no chart library.**
  Hover tooltips, accessible (`role="img"` + a text summary for screen readers).
  Source from `event.registrationsOverTime`.
- Agent activity feed from `AgentAction` records.
- "Needs your eye" cards driven by `AgentAction` where `status = PROPOSED`.

Revenue on the tile comes from `revenue.summary`, which is not implemented yet
— show a dash, not a zero. A zero is a lie; a dash is honest.

### 3. THE AGENT BRAIN — the core of the product

Server-side in `apps/console/src/server/agent/`.

- **Anthropic tool-use loop.** Use `@anthropic-ai/sdk` (already a dependency).
  Model: `claude-opus-5`. System prompt: an elite event director who knows the
  full event state — inject the event, a guests summary, a revenue summary and
  the agenda via `packages/core` queries. Keep the injected state compact and
  factual; the model must not invent numbers.
- **Tools**, mapping 1:1 to `agentToolNameSchema` in
  `packages/core/src/schemas/agent.ts`. Do not invent tool names — the enum is
  the contract:
  - mutating: `update_event_theme`, `update_agenda`, `change_event_date`,
    `draft_emails`, `create_ticket_tier`, `draft_sponsor_offer`
  - read-only: `get_no_show_risks`, `get_budget_summary`
- **THE CRITICAL SAFETY RULE — tools never mutate.** Every mutating tool call
  becomes an `AgentAction` row with `status = PROPOSED` and the `risk` from
  `TOOL_RISK`. The chat renders proposal cards with Approve / Reject.
  `agent.approve` is **the only code path in the entire app allowed to cause a
  side effect**, and it must flip the status to `EXECUTED` and perform the
  mutation **in one Prisma transaction** — both or neither.
  - Read-only `get_*` tools answer inline and create no action.
  - Gate auto-approval through `requiresApproval(risk, autoApproveCosmetic)`
    from `packages/core`. Call it; do not reimplement the check. `OUTBOUND` and
    `DESTRUCTIVE` can never auto-approve regardless of org settings — the
    Critic's adversarial pass will try to break exactly this.
  - `autoApproveCosmetic` lives in `Organisation.settings` and is toggled by
    `agent.setAutoApprove`.
- Every proposal carries `sideEffects` — what the organiser is agreeing to.
  A date change must list the knock-on effects (calendar invites, public page,
  guest emails). This is what makes the card trustworthy.
- **Streaming** responses into the chat UI. Suggestion chips after each reply.
- Persist the conversation as `ChatMessage` rows so a reload restores the
  thread and any open proposal cards (`agent.history` returns both).

### 4. Implement the routers

`agent` (all of: `command`, `approve`, `reject`, `actions`, `history`,
`setAutoApprove`) and `event` (`get`, `list`, `create`, `update`, `stats`,
`registrationsOverTime`) — inside `apps/console/src/server/`, keeping the exact
input/output signatures from `packages/core`.

## Definition of done

Each of these is checkable. Run them.

1. With the seed event, typing **"Make it black-tie"** in the chat produces a
   themed proposal card. Approving it sets `Event.theme.preset` to `blacktie`
   in the database and the console reflects it.
2. **"Move the event to 1 October"** proposes a date change whose card lists
   the side effects — calendar invites, public page, guest emails — and is
   marked `DESTRUCTIVE`, so it cannot auto-approve even with
   `autoApproveCosmetic` on.
3. **"Email the 20 guests most likely to no-show"** creates a `draft_emails`
   proposal and **sends nothing**. Verify: no `EmailMessage` leaves `PROPOSED`
   until approval.
4. Rejecting a proposal sets `REJECTED` and mutates nothing.
5. A reload restores the chat thread and any open proposal cards.
6. The Guests / Revenue / Live views render a pending state, not an error.
7. `pnpm typecheck` passes **from the repo root**.
8. `git diff --stat main...feat/conductor` shows changes only under
   `apps/console/` (plus `pnpm-lock.yaml` / `CONTRACT_CHANGES.md` if needed).

A visual reference may exist at the repo root as `ovation-app.html` — if it is
there, match its spirit, not its exact markup.
