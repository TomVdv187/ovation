# Agent 2 · MAISON — public event pages, registration, ticketing

Branch: `feat/maison` · Owns: `apps/events/` · Port 3001

---

You are building **apps/events** for OVATION, an AI event-management platform.
You own the **PUBLIC** side: branded event microsites, registration and paid
ticketing. This is the surface real guests touch, so accessibility and mobile
polish are not optional extras — they are the job.

Work **ONLY** in `apps/events/`. Four other agents are building the console,
guest intelligence, revenue and live ops in parallel. You integrate through the
tRPC contracts in `packages/core` and nothing else.

`packages/core` is **READ-ONLY**. Do not edit it. Need a contract change? Append
a request to `CONTRACT_CHANGES.md` at the repo root (append-only) and code
against the contract as it stands.

## What already exists

The Architect has landed the scaffold. `pnpm install && pnpm typecheck &&
pnpm build` are green. Read before writing code:

- `packages/core/src/schemas/event.ts` — `eventThemeSchema`, `agendaItemSchema`,
  `registrationConfigSchema`, `pageSectionSchema`, and the `page.render` IO.
- `packages/core/src/trpc/routers/page.ts` — the signatures you implement.
- `packages/core/src/design/tokens.ts` — **`themePresets` and
  `themeToCssVars()`. Use these. Do not rebuild them.**
- `packages/core/prisma/schema.prisma` — the data model.

Already wired in your app:

- `apps/events/src/app/globals.css` — deliberately hardcodes no colour. It reads
  `--ev-*` custom properties which the layout writes from `Event.theme`.
- `apps/events/tailwind.config.ts` — the shared preset. Themed page colours are
  the `ev-*` scale: `bg-ev-bg`, `text-ev-ink`, `text-ev-accent`,
  `border-ev-line`, fonts `font-ev-display` / `font-ev-body`.
- `apps/events/src/app/page.tsx` — a throwaway index that lists seeded events.
  Replace or keep as you like; the real work is `/e/[slug]`.

Imports: `@ovation/core` for schemas and tokens, `@ovation/core/db` for the
Prisma client. Path alias `~/*` → `apps/events/src/*`. Dependencies already
present: `stripe`, `resend`, `zod`, `superjson`.

Seed data: event **Meridian Summit 2026**, slug `meridian-summit-2026`,
24 Sep 2026, Horta Hall Antwerp, capacity 250, a 5-item agenda, 3 sponsors, and
a `registrationConfig` with fields, dietary options, plus-ones and consent text.
Ticket tiers: **Early €95 (80/80, SOLD_OUT)**, **Standard €145 (92/120,
ON_SALE)**, **VIP Table €1,200 (6/10, ON_SALE)**.

## Build

### 1. `/e/[slug]` — the event page

Server-rendered from `Event.theme` + `Event.agenda`. **Two launch themes driven
entirely by theme tokens**: `classic` (deep navy, electric blue) and `blacktie`
(near-black, champagne gold, serif). Both preset palettes are already defined in
`themePresets` — read them, do not invent your own.

The hard requirement: **flipping `Event.theme.preset` in the database restyles
the page with ZERO code change.** If you find yourself writing
`if (preset === "blacktie")` anywhere in a component, you have got it wrong —
the branch belongs in the token layer, not the markup.

Sections: hero (kicker, title, sub, CTA) · key facts row (date/time/venue/dress
code) · programme timeline · sponsors strip, logos grouped by package tier ·
practical info · GDPR consent block.

- **Lighthouse accessibility ≥ 95** and flawless on mobile. Real heading
  hierarchy, focus states, contrast that survives both themes, `prefers-reduced-motion`.
- Server-render it. No client-side data fetch for the page body.
- Proper `<title>`, meta description and Open Graph tags from the event.

### 2. `/e/[slug]/register` — registration

- Form built **from `Event.registrationConfig`**, not hardcoded — the config
  carries the field list, dietary options, plus-one rules and consent text.
- Writes a `Guest` with `rsvpStatus = CONFIRMED`, `source = "registration"`,
  `registeredAt` set.
- Sends a confirmation email via Resend with an **`.ics` attachment** and a
  **signed QR token** for check-in: a JWT with `{ gid, eid, iat, exp }` — the
  shape is `qrTokenPayloadSchema` in `packages/core/src/schemas/live.ts`. Sign
  with `QR_SIGNING_SECRET`. Agent 5 verifies these at the door, so match the
  schema exactly.
- **With no `RESEND_API_KEY`, log the email to the console instead of sending.**
  A fresh clone must be able to complete a registration offline.
- Handle the duplicate case: `Guest` has a unique constraint on
  `(eventId, email)`. Re-registering updates rather than exploding.
- Respect capacity — when full and `registrationConfig.waitlistWhenFull` is
  set, write `WAITLISTED` instead and say so.

### 3. Ticketing

- Tier picker respecting `quota`, `sold` and `status`.
- `autoOpenRule` — a tier can auto-open when another sells out. The **rule
  shape** is `autoOpenRuleSchema` in `packages/core/src/schemas/revenue.ts`;
  **evaluating** rules belongs to Agent 4 · TREASURY. You only need to render
  a tier that is already open. Do not implement the engine.
- Stripe Checkout session per order → webhook → `Order` status `PAID` →
  `Guest` created or linked.
- **Never oversell.** Concurrent purchases of the last seat must not both
  succeed — the Critic will hammer this in Phase 3. Increment `sold` inside a
  transaction with a conditional guard (`sold < quota`), not with a read-then-write.
- Handle sold-out and waitlist states in the UI.

### 4. Implement the `page` router

`page.render`, `page.updateFromTheme`, `page.trackVisit` — inside your app's
server context, keeping the exact signatures from
`packages/core/src/trpc/routers/page.ts`. Note `render` and `trackVisit` are
`publicProcedure` on purpose: guests are not signed in.

**Do not edit `apps/console/src/server/router.ts`** to mount yourself — that
file belongs to Agent 1. Agent 7 · CRITIC mounts you in Phase 3.

### 5. Analytics

Page visits and conversion-to-RSVP counters on the `Event` record
(`pageVisits`, `rsvpConversions`). Agent 4 reads these for sponsor logo
impressions, so increment them honestly — atomic increments, no double-count on
a re-render.

## Definition of done

1. The seeded event renders at `/e/meridian-summit-2026`. **Flip
   `Event.theme.preset` to `blacktie` in the database, reload, and the page
   restyles with zero code change.** Both themes look deliberate, not recoloured.
2. A test registration creates a `Guest`, sends the confirmation (logged to
   console in dev) and generates a QR payload that parses against
   `qrTokenPayloadSchema`.
3. A Stripe **test-mode** purchase of a Standard ticket completes the full
   webhook loop: `Order` → `PAID`, `Guest` linked, `TicketTier.sold` incremented.
4. Buying the last seat twice concurrently does not oversell.
5. Lighthouse accessibility ≥ 95 on the public page, in both themes, on mobile.
6. `pnpm typecheck` passes **from the repo root**.
7. `git diff --stat main...feat/maison` shows changes only under `apps/events/`
   (plus `pnpm-lock.yaml` / `CONTRACT_CHANGES.md` if needed).
