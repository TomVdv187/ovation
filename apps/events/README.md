# apps/events — MAISON

The public side of OVATION: branded event microsites, registration and paid
ticketing. Port 3001. Owned by Agent 2 · MAISON.

Everything a guest ever touches lives here. Everything the organiser touches
lives in `apps/console`. The two meet only at the tRPC contracts in
`packages/core`, which this app treats as read-only.

## Routes

| Route | What it is |
| --- | --- |
| `/` | Unthemed index of published events |
| `/e/[slug]` | The event page — server-rendered from `page.render` |
| `/e/[slug]/register` | Registration form, built from `Event.registrationConfig` |
| `/e/[slug]/tickets` | Tier picker |
| `/e/[slug]/checkout/[orderId]` | Local checkout — only when Stripe is unconfigured |
| `/e/[slug]/order/[orderId]` | Where Stripe returns the guest |
| `/e/[slug]/ticket?t=…` | The check-in QR, rendered from a verified token |
| `/e/[slug]/ticket/qr.png?t=…` | The same code as a download |
| `/e/[slug]/calendar.ics` | The event as a calendar file |
| `/api/trpc/[trpc]` | tRPC endpoint (the visit beacon uses it) |
| `/api/stripe/webhook` | Stripe's side of the ticket flow |

## The theme rule

**Flipping `Event.theme.preset` in the database restyles the page with zero code
change.** Try it:

```bash
pnpm --filter @ovation/events theme meridian-summit-2026 blacktie   # reload
pnpm --filter @ovation/events theme meridian-summit-2026 classic
```

The rendered markup — every tag, every class — is byte-identical between the two
themes. Only the `:root` custom-property block the layout writes differs.

That holds because exactly one module is allowed to know themes differ:
`src/lib/theme.ts`. It takes `themePresets` and `themeToCssVars` from
`@ovation/core` and adds the layer core leaves to the consumer:

- **Contrast-guaranteed text.** `--ev-accent-text`, `--ev-ink-muted`,
  `--ev-danger` and `--ev-on-accent` are nudged until they clear WCAG AA against
  *every* ground they can land on — the page, cards, the raised surface and the
  accent wash composited over each. A preset that already passes is returned
  untouched, so this never repaints a theme that was designed properly; a theme
  nobody has designed yet still lands somewhere legible.
- **Structure, not just colour.** Corner radius, rule weight, kicker tracking,
  section rhythm and whether display type is set in capitals are all tokens.
  They are derived from the theme's own typography — a wide-tracked, light
  display face gets the formal treatment — so the two launch themes read as two
  designs rather than one design recoloured, and a third theme still gets a
  point of view.

If you ever find yourself writing `if (preset === "blacktie")` in a component,
the branch belongs in that file instead.

## Never oversell

The one invariant the ticket code is shaped around. Seats are taken with a
single conditional statement and the row count decides:

```sql
UPDATE "TicketTier" SET sold = sold + n
 WHERE id = ? AND status = 'ON_SALE' AND sold + n <= quota
```

Two requests racing for the last seat both reach it; Postgres serialises them on
the row, the second reads the first's write, its guard fails and it comes back
with zero rows updated. No read, no check-then-act, no window to lose.

Seats are reserved when the **order is created**, not when payment lands. An
abandoned checkout gives them back (`checkout.session.expired`, the local
cancel button, or the order page reconciling with Stripe). That costs a little
inventory for a while and buys the guarantee that a guest who reaches the card
page has a seat waiting.

Registration takes the same care with room capacity, using a `SELECT … FOR
UPDATE` on the Event row so two people cannot claim the same last chair.

```bash
pnpm --filter @ovation/events verify:oversell        # 12 buyers, 1 seat
pnpm --filter @ovation/events verify:registration    # the whole registration path
```

Both run against the real database and clean up after themselves.

## Working without credentials

A fresh clone with no keys can still complete a registration and a purchase.

| Missing | What happens instead |
| --- | --- |
| `RESEND_API_KEY` | The confirmation is printed to the server console in full, attachments listed. Nothing is silently dropped. |
| `STRIPE_SECRET_KEY` | Checkout goes to `/e/[slug]/checkout/[orderId]`, which settles the order through the *same* `fulfilOrder` the webhook calls. Disabled the moment a Stripe key exists. |
| `QR_SIGNING_SECRET` | Tokens are signed with a development secret and a warning is logged once. |

`next.config.ts` reads the repo-root `.env` itself, so `next dev` works without
a global `dotenv-cli`. Anything already exported wins.

## The check-in token

A plain HS256 JWT whose claims are `qrTokenPayloadSchema` exactly —
`{ gid, eid, iat, exp }`, seconds since epoch — signed with `QR_SIGNING_SECRET`.
Agent 5 · MAÎTRE D' verifies these at the door with whatever library it likes;
both ends agree without sharing code. See `src/server/qr-token.ts`.

## Analytics

`Event.pageVisits` and `Event.rsvpConversions` are what Agent 4 · TREASURY bills
sponsor impressions against, so they are counted conservatively:

- A visit is an atomic `increment`, fired once per tab session by a client
  beacon and refused again by a per-visitor server guard inside the same
  half-hour. The page body itself is fully server-rendered; the beacon is the
  only thing the browser fetches.
- A conversion is someone arriving at a registered state from outside one.
  Re-submitting the form, or a returning guest updating a dietary requirement,
  is not a second conversion.

## Mounting the page router

`src/server/routers/page.ts` implements `page.render`, `page.updateFromTheme`
and `page.trackVisit` against the signatures in
`packages/core/src/trpc/routers/page.ts`. It imports nothing but `@ovation/core`
and `ctx.db`, so Agent 7 · CRITIC can mount it in the console in Phase 3 by
swapping one line in `apps/console/src/server/router.ts`:

```ts
import { pageRouter } from "…/apps/events/src/server/routers/page";
// page: contractRouters.page,
   page: pageRouter,
```

`updateFromTheme` is an `orgProcedure` and checks that the event belongs to the
caller's organisation. It cannot succeed in this app, which has no sign-in —
that is the point: it is the console's procedure, implemented here.

`preview` is honoured by `page.render` itself. The app's own routes do not
expose it: a nested layout cannot read search params, and letting the chrome
render a draft's title before the body 404s would leak it. A console preview
should call `page.render({ preview: true })` directly.

## Accessibility

Target was Lighthouse ≥ 95. Measured 100 on mobile for `/e/[slug]`,
`/register`, `/tickets` and `/ticket`, in both themes.

The things that get it there: one `h1` per page and a real heading hierarchy
under it; landmarks and a skip link; `<dl>` for facts and `<ol>` with `<time>`
for the programme; labels tied to inputs with `aria-describedby`,
`aria-invalid` and a focusable error summary that takes focus on failure;
errors marked with a symbol as well as a colour; 48px controls and 16px inputs
so iOS does not zoom; fluid `clamp()` type instead of breakpoints; visible
focus rings drawn in a theme colour guaranteed to contrast; and
`prefers-reduced-motion` respected via the shared token stylesheet.

Dates are formatted in the **event's** timezone everywhere, so a page opened in
Lisbon still says doors at 18:30 in Antwerp and the server and client agree.
