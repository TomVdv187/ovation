# Agent 9 · VITRINE — the marketing site

Branch: `feat/vitrine` · Owns: `apps/www/` · Port 3003

---

You are building **apps/www**, the public marketing site for OVATION — an AI
event-management platform. Its pitch: *an event agent that runs the whole event
business.* An organiser describes what they want in plain language; the agent
drafts the change; a human approves it; it happens.

This directory does not exist yet. You are creating it. Work **ONLY** in
`apps/www/`. Another agent is hardening the approval path in `packages/core`
and `apps/console` at the same time — you will not collide with it as long as
you stay in your own directory.

`packages/core` is **READ-ONLY**. You will use its design tokens and nothing
else from it.

## What already exists

`pnpm install && pnpm typecheck && pnpm build` are green. Before writing
anything, read:

- `apps/events/` — the closest sibling. A public-facing Next 15 App Router app
  with the same tokens, the same Tailwind preset, the same layout primitives.
  Match its conventions rather than inventing your own.
- `packages/core/src/design/tokens.css` and `.../tailwind-preset.ts` — the
  design system. Use it. The product has a look already; the marketing site
  should be recognisably the same product.
- `README.md` — what the thing actually does, in the words the team uses.
- `ovation-landing.html` at the repo root — an early visual prototype. Treat it
  as a mood board, not a spec: take the intent, ignore the markup.

The three running apps for reference: console on 3000, events on 3001, live on
3002. Yours is **3003**. Add it to the workspace the same way the others are —
`pnpm dev` should start four apps after you are done.

## What to build

A marketing site that makes a first-time visitor understand the product in
about fifteen seconds and want a demo. At minimum:

- **A landing page** that leads with the agent: what an organiser types, what
  comes back, and the fact that a human approves before anything happens. The
  approval gate is a feature, not a footnote — it is the reason a serious
  organiser would trust this.
- **The five capabilities** — event pages, ticketing, guest intelligence,
  sponsors and revenue, live ops — each shown as an outcome rather than a
  feature list.
- **A pricing page**, even if the numbers are placeholders. Mark them clearly
  as placeholders in the copy so nobody ships them by accident.
- **A contact or demo-request route.** No backend: post to a stub that logs and
  returns success, or link to an email address. Do not add a database
  dependency to this app — it must build and run with no `DATABASE_URL`.

## Constraints

- **No database, no auth, no tRPC.** This app is static as far as it can be.
  Anything it needs to say about a real event, hard-code. Keeping it free of
  those dependencies is what lets it deploy independently and never break
  because a migration ran.
- **Do not invent proof.** No fake customer logos, no fabricated testimonials,
  no made-up metrics ("used by 500 event teams"). Nobody is using this yet.
  Write copy that is honest about a product at v0.1 — that is a constraint on
  wording, not on ambition, and it is a shorter path to something believable
  than borrowed credibility would be.
- Use the design tokens. If you need a token that does not exist, use a local
  CSS variable inside `apps/www` — do not edit `packages/core`.
- Never run `pnpm db:seed`, `db:reset` or `db:push`. You have no reason to
  touch the database at all.

## Definition of done

- `pnpm dev` starts four apps; yours serves on <http://localhost:3003>.
- `pnpm typecheck` and `pnpm build` green across the monorepo.
- Every page is responsive from 360px up. Test it — do not assume it.
- Lighthouse **≥ 95 on performance and accessibility** for the landing page.
  This is the one place in the repo where that target has never been met, and
  a marketing site with no database is where it is easiest to hit. Put the
  score in your report.
- Real HTML semantics: one `h1` per page, landmarks, alt text, visible focus
  states, and it must be usable by keyboard alone.
- No console errors or hydration warnings.
- A short report: the pages you built, the score you measured, and any copy you
  invented that a human should check before it goes public.

## Why this matters

Everything built so far is the machine. This is the only part a stranger will
ever see first, and right now it does not exist — the product has no front
door.
