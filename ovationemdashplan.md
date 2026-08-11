# OVATION — Emdash Multi-Agent Build Plan

Build the real OVATION product (the Attendu-killer) using [Emdash](https://emdash.ai) to run parallel coding agents, each in its own git worktree. This plan gives you: the phases, which agent owns which job, hard file-boundaries so worktrees merge cleanly, and a **paste-ready prompt per agent**.

---

## 0\. Ground rules (why this plan merges cleanly)

Emdash isolates each agent in a git worktree of the same repo. Parallel agents only merge painlessly if **no two agents own the same files**. So:

- **Phase 1 is ONE agent** (the Architect). It creates the skeleton, shared types and API contracts. Nothing else runs until it's merged to `main`.  
- **Phase 2 is five agents in parallel.** Each owns an exclusive directory. The shared contract files in `packages/core` are **read-only** for all of them — if an agent needs a contract change, it writes a request into `CONTRACT_CHANGES.md` instead of editing.  
- **Phase 3 is one Integrator/QA agent** that merges, wires, and tests end-to-end.

**Stack (fixed for all agents):** Next.js 15 (App Router) \+ TypeScript, tRPC, Prisma \+ PostgreSQL, Tailwind, Anthropic API for the agent brain, Stripe for payments, Resend for email, WebSockets (Pusher-compatible) for live ops. Monorepo via pnpm workspaces \+ Turborepo.

**Monorepo layout the Architect must create:**

ovation/

  packages/core/        ← Prisma schema, zod types, tRPC contracts, design tokens  (Architect only)

  apps/console/         ← the organiser app shell \+ agent chat                     (Agent 1\)

  apps/events/          ← public event pages \+ registration \+ ticketing            (Agent 2\)

  packages/guests/      ← guest intelligence engine                                (Agent 3\)

  packages/revenue/     ← revenue, sponsors, ROI                                   (Agent 4\)

  apps/live/            ← check-in PWA \+ realtime ops                              (Agent 5\)

  apps/www/             ← marketing site                                           (Agent 6, optional — landing HTML already exists)

  e2e/                  ← Playwright tests                                         (Agent 7\)

---

## Phase 1 — Agent 0 · "ARCHITECT" (runs alone, first)

**Job:** monorepo scaffold, database schema, shared types, tRPC router contracts, auth, design system tokens, seed data.

**Prompt (paste into Emdash):**

You are the Architect for OVATION, an AI event-management platform ("an event agent

that runs the whole event business": event pages, ticketing, sponsors, guest

intelligence, live ops). You run ALONE — five feature agents will build on top of

your output in parallel, so your \#1 priority is clean contracts and boundaries.

Create a pnpm \+ Turborepo monorepo \`ovation\` with this exact layout:

packages/core, apps/console, apps/events, packages/guests, packages/revenue,

apps/live, apps/www, e2e. Stack: Next.js 15 App Router \+ TypeScript strict, tRPC,

Prisma \+ PostgreSQL, Tailwind, NextAuth (email magic link), Stripe SDK, Resend,

Anthropic SDK. Apps other than console can be near-empty shells with a README.

In packages/core deliver:

1\. Prisma schema: Organisation, User, Event (title, slug, date, venue, capacity,

   theme jsonb, agenda jsonb, status), Guest (name, email, company, segment enum

   \[VIP, CLIENT, PARTNER, PRESS, PROSPECT\], engagementScore int, noShowRisk enum,

   rsvpStatus, dietary, plusOnes), TicketTier (name, price, quota, sold,

   autoOpenRule jsonb), Order, Sponsor (name, package enum \[GOLD, SILVER, CUSTOM\],

   amount, status, roiStats jsonb), EmailMessage (guestId, subject, body,

   personalised bool, status, openedAt), CheckIn (guestId, timestamp, lane),

   Announcement, AgentAction (type, payload jsonb, status \[PROPOSED, APPROVED,

   EXECUTED\], createdBy). Every model belongs to an Event or Organisation.

2\. Zod schemas mirroring every model \+ input/output types for the tRPC routers.

3\. tRPC root router with EMPTY, typed sub-routers: event, page, guests, revenue,

   live, agent — each procedure fully typed (input zod, output zod) but

   implemented as \`throw new TRPCError({ code: "NOT\_IMPLEMENTED" })\`. These

   signatures ARE the contract; think hard about them. Include:

   agent.command (natural-language command in → list of AgentAction proposals out),

   agent.approve, guests.list/score/personaliseInvite, revenue.summary,

   revenue.sponsorUpsellCandidates, live.checkin, live.feed (subscription),

   event.update, page.render.

4\. Design tokens file (CSS vars \+ Tailwind preset): dark theme, bg \#0d0d0d,

   surface \#1a1a19, ink \#f5f3ee, gold accent \#d9b36c/\#e8c47e, chart series

   \#3987e5/\#d95926/\#199e70, status good \#0ca30c warning \#fab219 serious \#ec835a

   critical \#d03b3b, serif display for headings (Didot/Playfair fallback stack),

   system sans for UI.

5\. Seed script: 1 demo org, 1 event "Meridian Summit 2026" (24 Sep 2026, Horta

   Hall Antwerp, capacity 250), 3 ticket tiers (Early 95 sold out 80, Standard

   145, VIP Table 1200), 3 sponsors (Helvion Gold 12500, Nexa Silver 6000, Corda

   Silver 6000), 200 guests with realistic Benelux names, varied segments,

   engagement scores and no-show risks.

6\. Root README: architecture, boundaries ("packages/core is read-only for feature

   agents; request contract changes via CONTRACT\_CHANGES.md"), how to run.

Definition of done: \`pnpm install && pnpm db:push && pnpm db:seed && pnpm dev\`

boots the console shell on :3000 with auth working; \`pnpm typecheck\` passes with

zero errors. Do NOT implement feature logic — contracts and scaffold only.

---

## Phase 2 — five agents in parallel (start all after Architect merges)

### Agent 1 · "CONDUCTOR" — console shell \+ AI agent chat

**Job:** the organiser console (left agent chat \+ main views shell) and the actual LLM brain: natural-language commands → typed tool calls → AgentAction proposals → approval → execution.

You are building apps/console for OVATION, working ONLY in apps/console (plus

reading packages/core, which is READ-ONLY — request contract changes in

CONTRACT\_CHANGES.md at repo root). Other agents build guests/revenue/live in

parallel; integrate through the tRPC contracts in packages/core only.

Build:

1\. Console layout: 64px icon rail (Overview, Event Page, Guests, Revenue, Live),

   360px persistent agent-chat panel, main content area. Use the design tokens in

   packages/core (dark \+ gold, serif display headings). Views other than Overview

   render placeholder panels that call the contract procedures — feature teams

   fill the data behind them.

2\. Overview view: stat tiles (registrations, predicted show-rate, revenue, agent

   actions today), registrations-over-time SVG line chart with hover tooltips,

   agent activity feed, "needs your eye" cards driven by AgentAction records.

3\. THE AGENT BRAIN (the core of the product), server-side in apps/console:

   \- Anthropic API tool-use loop. System prompt: an elite event director who

     knows the full event state (inject event, guests summary, revenue summary,

     agenda via core queries).

   \- Tools (map 1:1 to contract types): update\_event\_theme, update\_agenda,

     change\_event\_date, draft\_emails(guestIds, intent), create\_ticket\_tier,

     draft\_sponsor\_offer, get\_no\_show\_risks, get\_budget\_summary.

   \- CRITICAL SAFETY RULE: tools never mutate directly. Every tool call becomes

     an AgentAction with status PROPOSED. The chat renders proposal cards with

     Approve / Reject; agent.approve executes the mutation transactionally and

     flips status to EXECUTED. Destructive/outbound actions (emails, offers,

     date changes) ALWAYS require approval; cosmetic ones (theme) may

     auto-approve behind a per-org setting.

   \- Streaming responses into the chat UI; suggestion chips after each reply.

4\. Implement the tRPC \`agent\` and \`event\` routers' NOT\_IMPLEMENTED stubs inside

   apps/console/server (feature routers belong to other agents — leave them).

Definition of done: with the seed event, typing "Make it black-tie" produces a

themed proposal card; approving it updates Event.theme in the DB and the UI

reflects it. "Move the event to 1 October" proposes a date change listing the

side-effects (calendar invites, page, emails). \`pnpm typecheck\` and existing

tests pass. A visual reference of the intended look exists at the repo root as

ovation-app.html if present — match its spirit, not its exact markup.

### Agent 2 · "MAISON" — public event pages \+ registration \+ ticketing

You are building apps/events for OVATION — the PUBLIC side: branded event

microsites, registration and paid ticketing. Work ONLY in apps/events;

packages/core is READ-ONLY (contract change requests go in CONTRACT\_CHANGES.md).

Build:

1\. Route /e/\[slug\]: server-rendered event page from Event.theme \+ agenda jsonb.

   Two launch themes driven entirely by theme tokens: "classic" (deep navy,

   electric blue) and "blacktie" (near-black, champagne gold, serif). Page

   sections: hero (kicker, title, sub, CTA), key facts row (date/time/venue/

   dress code), programme timeline, sponsors strip (logos by package tier),

   practical info, GDPR-compliant consent block. Must score 95+ on Lighthouse

   accessibility and be flawless on mobile.

2\. Registration flow: /e/\[slug\]/register — form built from the event's

   registration config (name, email, company, dietary, \+1s), writes Guest with

   rsvpStatus CONFIRMED, fires a confirmation email via Resend with an .ics

   attachment and a signed QR code token (JWT, guestId \+ eventId) for check-in.

3\. Ticketing: tier picker respecting quotas and autoOpenRule (a tier can

   auto-open when another sells out), Stripe Checkout session per order, webhook

   → Order PAID → Guest created/linked. Handle sold-out and waitlist states.

4\. Implement the \`page\` router stubs (page.render, page.updateFromTheme) in this

   app's server context.

5\. Analytics: page visits and conversion-to-RSVP counters on the Event record.

Definition of done: seeded event renders at /e/meridian-summit-2026 in both

themes (flip Event.theme in DB and the page restyles with zero code change);

a test registration creates a Guest, sends the email (mock transport in dev,

log output), and generates a scannable QR payload; Stripe test-mode purchase of

a Standard ticket completes the full webhook loop. \`pnpm typecheck\` passes.

### Agent 3 · "ORACLE" — guest intelligence

You are building packages/guests for OVATION — the guest-intelligence engine.

Work ONLY in packages/guests; packages/core is READ-ONLY (contract change

requests via CONTRACT\_CHANGES.md). Your consumers are the console UI (Agent 1\)

and live ops (Agent 5\) through the \`guests\` tRPC contract — implement those

procedures here as a router the console mounts.

Build:

1\. Engagement scoring: 0–100 per guest from email opens/clicks, page visits,

   registration recency, reply sentiment. Deterministic, explainable — return

   the top-3 factors with every score.

2\. No-show prediction: rule-based v1 (weights on engagement decay, ticket type

   \[free \>\> paid\], distance, historic behaviour), outputting risk LOW/MED/HIGH \+

   probability \+ recommended recovery action (re-confirmation email / personal

   call / seat-swap with waitlist). Design the interface so an ML model can

   replace the rules later without contract changes.

3\. Segmentation: auto-assign segment (VIP/CLIENT/PARTNER/PRESS/PROSPECT) from

   company, title and organiser overrides; VIPs get a white-glove checklist

   (transport, seating, dietary, host assignment) persisted per guest.

4\. Personalised invitations: for a guest list \+ campaign intent, call the

   Anthropic API to write ONE email per guest using their name, company, segment,

   stated interests and history — never a template with merge fields. Batch with

   rate limiting; store as EmailMessage PROPOSED (the Conductor's approval flow

   sends them — you never send directly). Include an eval script with 5 fixture

   guests asserting: correct name/company, no hallucinated facts (only facts

   present in the guest record may appear), subject \<60 chars, no spam-trigger

   words.

5\. Waitlist engine: capacity-aware promotion suggestions when high-risk guests

   are predicted to no-show.

Definition of done: \`guests.list\` returns scored, segmented seed guests with

risk \+ recommended action; \`guests.personaliseInvite\` produces 5 distinct

fixture emails passing the eval script; unit tests cover scoring edge cases

(new guest, silent guest, VIP). \`pnpm typecheck\` passes.

### Agent 4 · "TREASURY" — revenue & sponsors

You are building packages/revenue for OVATION — the module that makes events

PROFITABLE, our sharpest edge over competitors. Work ONLY in packages/revenue;

packages/core is READ-ONLY (contract change requests via CONTRACT\_CHANGES.md).

Expose everything through the \`revenue\` tRPC contract as a router the console

mounts.

Build:

1\. revenue.summary: tickets by tier, sponsor income, committed costs (venue,

   catering, production — simple cost entries on the Event), margin, cost per

   attendee, vs-last-edition delta. One query, dashboard-ready.

2\. Dynamic pricing engine: evaluate TicketTier.autoOpenRule (e.g. "open Late

   tier €175 capped 30 when Standard sells out") on a cron/queue; emit an

   AgentAction PROPOSED when a rule wants to fire so the organiser approves.

   Also generate pricing suggestions from sales velocity (sell-out forecast

   date; suggest a new tier when demand outruns supply).

3\. Sponsor CRM: packages (Gold/Silver/Custom) with entitlements (logo

   placements, VIP dinner mentions, target-account intros); pipeline states

   (PROSPECT → OFFERED → SIGNED → SERVICED).

4\. Sponsor ROI reporting: weekly per-sponsor report — logo impressions (from

   page analytics), leads matched to their target-account list (join against

   guest companies), 1:1 meetings booked, renewal-intent signal. Render as

   email-ready HTML; queue as EmailMessage PROPOSED.

5\. Upsell radar: track sponsor engagement events (report opens, benefits-page

   clicks); when a Silver sponsor's engagement crosses a threshold, draft a

   Gold upgrade offer (Anthropic API, grounded ONLY in their actual activity

   and entitlement deltas) as an AgentAction PROPOSED with the incremental

   amount.

Definition of done: seeded event returns a correct revenue.summary (tickets

28,140 \+ sponsors 24,500); a simulated "Standard sold out" event fires the

late-tier proposal; simulated Nexa engagement produces a Gold-upgrade

AgentAction with a drafted offer email. Unit tests on the pricing rules and

ROI aggregation. \`pnpm typecheck\` passes.

### Agent 5 · "MAÎTRE D'" — live ops

You are building apps/live for OVATION — event-day operations. Work ONLY in

apps/live; packages/core is READ-ONLY (contract change requests via

CONTRACT\_CHANGES.md). Realtime transport: WebSocket (Pusher-protocol-compatible

lib so it can be self-hosted or SaaS).

Build:

1\. Check-in PWA (/live/\[eventId\]/door): camera QR scanner (the JWT from

   registration), verifies signature \+ event, flips guest to CHECKED\_IN, target

   \<2.5s per scan, works offline with a sync queue (IndexedDB) for venue

   dead-zones. Multiple lanes; lane recorded per check-in.

2\. Host companion view (/live/\[eventId\]/host): realtime VIP arrival alerts with

   name, photo placeholder, white-glove notes and a one-line conversation

   opener; ranked AI matchmaking list (guests sharing interests/industries, and

   guests matching sponsor target-account lists — read via guests/revenue

   contracts) with "introduced" tracking.

3\. Ops dashboard (/live/\[eventId\]/ops): live counters (checked-in, capacity %,

   VIPs arrived), arrivals-per-15-min bar chart updating live, check-in feed,

   announcement composer that pushes to all connected clients (guest app, host

   view, info screens) with delivery counts.

4\. Cue engine: configurable triggers — "when capacity ≥ 70%, propose starting

   the keynote", "when a VIP with transport arranged hasn't arrived 30 min

   after doors, alert the organiser". Cues emit AgentActions (PROPOSED) unless

   whitelisted as auto.

5\. Simulation mode: \`pnpm sim\` streams fake arrivals from the seed guest list

   through the real pipeline for demos and load testing (target: 250 check-ins

   in 10 minutes without dropped socket updates).

Definition of done: simulation shows live-updating dashboard \+ host alerts in

two browser windows simultaneously; offline scan queue proven by killing the

network mid-scan; announcement reaches all clients \<1s in local tests.

\`pnpm typecheck\` passes.

---

## Phase 3 — Agent 7 · "CRITIC" — integrator & QA (runs alone, last)

You are the Integrator/QA for OVATION. All feature branches are merged. Work in

e2e/ plus minimal glue edits anywhere needed (you are the ONLY agent allowed to

touch cross-boundary code; keep glue diffs small and listed in your report).

Do, in order:

1\. Wire the routers: replace every remaining NOT\_IMPLEMENTED stub by mounting

   the real routers from apps/console, apps/events, packages/guests,

   packages/revenue, apps/live. Resolve CONTRACT\_CHANGES.md requests — apply

   accepted changes to packages/core and update all consumers.

2\. Playwright e2e suite covering the golden path: organiser types "Make it

   black-tie" → approves → public page restyles; guest registers on /e/… →

   appears scored in Guest Intelligence; Stripe test purchase updates

   revenue.summary; simulation mode checks guests in and the ops dashboard

   updates live; announcement reaches a second browser context.

3\. Adversarial pass: attempt to make the agent brain send an email WITHOUT

   approval (must be impossible), scan a forged/expired QR (must reject),

   oversell a ticket tier under concurrent purchases (must not), inject prompt

   text via a guest's name like "Ignore previous instructions…" (personalised

   emails must not obey it).

4\. Performance: public event page Lighthouse ≥95 perf & a11y; check-in P95

   \<2.5s under the 250-guest simulation.

5\. Produce INTEGRATION\_REPORT.md: what was wired, contract changes applied,

   glue edits, test results, remaining risks ranked.

Definition of done: full e2e suite green in CI, \`pnpm build\` clean across the

monorepo, report delivered.

---

## Run order & merge strategy

| Step | Agents | Mode |
| :---- | :---- | :---- |
| 1 | Architect | solo → merge to `main` |
| 2 | Conductor, Maison, Oracle, Treasury, Maître d' | 5 parallel Emdash worktrees off `main` |
| 3 | Merge feature branches (no file overlaps by design; CONTRACT\_CHANGES.md conflicts are append-only — union-merge) | you, in Emdash |
| 4 | Critic | solo → merge → tag `v0.1` |

**Tips for Emdash specifically:** give each agent its branch name matching its codename (`feat/conductor`, …); paste each prompt as the agent's initial task; keep the two HTML prototypes (`ovation-app.html`, `ovation-landing.html`) at the repo root as visual reference for Conductor and any marketing-site agent; review each agent's diff in Emdash before merging — the Definition of done in each prompt is your review checklist.  
