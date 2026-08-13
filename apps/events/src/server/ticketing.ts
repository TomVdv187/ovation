import { db } from "@ovation/core/db";
import { eventsBaseUrl, findPublicEvent, tierAvailability } from "./event";
import { createOrderId } from "./order-id";
import { sendConfirmation } from "./registration";
import { signQrToken, ticketExpiry } from "./qr-token";
import { paymentsEnabled, stripeClient } from "./stripe";

/**
 * Ticketing.
 *
 * The rule the whole module is shaped around: NEVER OVERSELL. Seats are taken
 * with a single conditional UPDATE —
 *
 *     UPDATE "TicketTier" SET sold = sold + n
 *      WHERE id = ? AND status = 'ON_SALE' AND sold + n <= quota
 *
 * — and the row count decides. Two requests racing for the last seat both hit
 * that statement; Postgres serialises them on the row, the second one reads the
 * first one's write, its guard fails and it comes back with zero rows updated.
 * There is no read, no check-then-act, and therefore no window to lose.
 *
 * The second rule, learned the hard way: ONE STATEMENT, NOT ONE TRANSACTION.
 *
 * Serialising on the row is the design, so the only thing that matters under a
 * rush is how long each buyer holds it. That is the time between the UPDATE and
 * the COMMIT — and in an interactive transaction, every statement in between is
 * a network round trip. Taking the seats, closing the tier and opening the order
 * as three statements held the row for three round trips; on a link with 250 ms
 * of latency that is most of a second, per buyer, strictly one at a time. A
 * hundred buyers queue for a minute and a half, Prisma's 5 s transaction timeout
 * fires long before their turn, and a large minority of a real on-sale gets an
 * exception instead of a ticket.
 *
 * So reservation is one statement — a data-modifying CTE that takes the seats,
 * closes the tier if that was the last one, and inserts the Order, all inside a
 * single implicit transaction. The row is held for one server-side statement
 * instead of three network round trips, and there is no interactive transaction
 * left to time out. Release is one statement for the same reason: it lands on
 * the same contended row, during the same rush.
 *
 * Seats are reserved when the order is created, not when payment lands. An
 * abandoned checkout gives them back (checkout.session.expired, or the order
 * page reconciling), which costs a little inventory for a while and buys the
 * guarantee that a guest who reaches Stripe has a seat waiting.
 */

export class SoldOutError extends Error {
  constructor() {
    super("Those seats went while you were deciding.");
  }
}

/**
 * The database would not hold the seats — busy, unreachable, anything that is
 * not a plain "no room". Distinct from SoldOutError because it means try again,
 * not give up, and because a guest must never be shown either one as a stack
 * trace.
 */
export class ReservationUnavailableError extends Error {
  constructor(cause: unknown) {
    super("We could not hold those seats just now. Please try again.", {
      cause,
    });
  }
}

export interface CheckoutRequest {
  slug: string;
  tierId: string;
  quantity: number;
  email: string;
  name: string;
}

export type CheckoutOutcome =
  | { ok: true; orderId: string; redirectTo: string }
  | { ok: false; errors: Record<string, string>; formError: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_PER_ORDER = 10;

export async function startCheckout(
  request: CheckoutRequest,
): Promise<CheckoutOutcome> {
  const event = await findPublicEvent(request.slug);
  if (!event) {
    return { ok: false, errors: {}, formError: "This event is not on sale." };
  }

  const errors: Record<string, string> = {};
  const email = request.email.trim().toLowerCase();
  const name = request.name.trim();

  if (!EMAIL.test(email)) errors.email = "We need a working email address.";
  if (name.length === 0) errors.name = "Who are the tickets for?";

  const tier = event.ticketTiers.find((t) => t.id === request.tierId);
  if (!tier) {
    return { ok: false, errors, formError: "That ticket no longer exists." };
  }

  const availability = tierAvailability(tier);
  const quantity = Math.floor(request.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    errors.quantity = "Choose at least one ticket.";
  } else if (quantity > Math.min(MAX_PER_ORDER, availability.remaining)) {
    errors.quantity = `Only ${availability.remaining} left in this tier.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, formError: null };
  }
  if (!availability.purchasable) {
    return {
      ok: false,
      errors: {},
      formError: `${tier.name} is not on sale right now.`,
    };
  }

  let orderId: string;
  try {
    orderId = await reserve({
      eventId: event.id,
      tierId: tier.id,
      quantity,
      amountCents: tier.priceCents * quantity,
      currency: tier.currency,
      email,
      buyerName: name,
    });
  } catch (cause) {
    if (cause instanceof SoldOutError) {
      return { ok: false, errors: {}, formError: cause.message };
    }
    // Whatever went wrong, the guest is owed a sentence rather than a 500. The
    // reservation is one statement, so a failure here means it did not commit:
    // no seats were taken, and nothing has been charged either way — payment
    // happens after this point, never before it.
    if (cause instanceof ReservationUnavailableError) {
      console.error(
        "[ticketing] could not reserve seats:",
        cause.cause instanceof Error ? cause.cause.message : cause.cause,
      );
      return {
        ok: false,
        errors: {},
        formError:
          "We could not hold those seats just now — nothing has been charged. Please try again.",
      };
    }
    throw cause;
  }

  // A free tier has nothing to pay for: the reservation IS the ticket.
  if (tier.priceCents === 0) {
    await fulfilOrder(orderId);
    return {
      ok: true,
      orderId,
      redirectTo: `/e/${event.slug}/order/${orderId}`,
    };
  }

  const stripe = stripeClient();
  if (!stripe) {
    // No key configured. The local checkout runs the same fulfilment path.
    // CC-002: the name is on the Order row now, so the URL no longer carries it.
    return {
      ok: true,
      orderId,
      redirectTo: `/e/${event.slug}/checkout/${orderId}`,
    };
  }

  try {
    const base = eventsBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      client_reference_id: orderId,
      metadata: { orderId, eventId: event.id, tierId: tier.id },
      line_items: [
        {
          quantity,
          price_data: {
            currency: tier.currency.toLowerCase(),
            unit_amount: tier.priceCents,
            product_data: {
              name: `${event.title} — ${tier.name}`,
              ...(tier.description ? { description: tier.description } : {}),
            },
          },
        },
      ],
      success_url: `${base}/e/${event.slug}/order/${orderId}`,
      cancel_url: `${base}/e/${event.slug}/tickets?cancelled=1`,
    });

    await db.order.update({
      where: { id: orderId },
      data: { stripeSessionId: session.id },
    });

    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    return { ok: true, orderId, redirectTo: session.url };
  } catch (cause) {
    // The guest never reached a payment page, so the seats are not theirs.
    await releaseOrder(orderId, "FAILED");
    console.error(
      "[ticketing] could not open a checkout session:",
      cause instanceof Error ? cause.message : cause,
    );
    return {
      ok: false,
      errors: {},
      formError: "We could not open the payment page. Nothing has been charged.",
    };
  }
}

interface ReserveInput {
  eventId: string;
  tierId: string;
  quantity: number;
  amountCents: number;
  currency: string;
  email: string;
  buyerName: string;
}

/**
 * Takes the seats and opens a PENDING order in one statement, or throws
 * SoldOutError.
 *
 * The CTE does three things that used to be three round trips:
 *
 *   1. takes the seats, guarded by `sold + n <= quota` — unchanged, and still
 *      the only thing standing between this event and an oversold room;
 *   2. closes the tier if that was the last seat. `sold` inside SET reads the
 *      value from BEFORE this statement, so `sold + n >= quota` is the same
 *      "did I take the last one" test the separate UPDATE used to make. Agent
 *      4's auto-open rules watch for exactly this transition;
 *   3. inserts the Order — but `FROM taken`, so if the guard in step 1 matched
 *      nothing, there is no row to insert from and no order appears.
 *
 * That last join is what makes the pair atomic without an interactive
 * transaction: seats and order are taken by one statement, so they commit
 * together or not at all. Zero rows back means the tier had no room.
 */
async function reserve(input: ReserveInput): Promise<string> {
  const orderId = createOrderId();

  let rows: Array<{ id: string }>;
  try {
    rows = await db.$queryRaw<Array<{ id: string }>>`
      WITH taken AS (
        UPDATE "TicketTier"
           SET sold = sold + ${input.quantity}::int,
               status = CASE
                          WHEN sold + ${input.quantity}::int >= quota
                          THEN 'SOLD_OUT'::"TicketTierStatus"
                          ELSE status
                        END,
               "updatedAt" = NOW()
         WHERE id = ${input.tierId}::text
           AND status = 'ON_SALE'::"TicketTierStatus"
           AND sold + ${input.quantity}::int <= quota
        RETURNING id
      )
      INSERT INTO "Order" (
        id, "eventId", "tierId", email, "buyerName",
        quantity, "amountCents", currency, status, "createdAt", "updatedAt"
      )
      SELECT
        ${orderId}::text,
        ${input.eventId}::text,
        taken.id,
        ${input.email}::text,
        -- CC-002: the name typed at checkout has a column. It used to ride in a
        -- query parameter (local path) or Stripe session metadata (real path)
        -- and be handed back to fulfilOrder out of band.
        ${input.buyerName}::text,
        ${input.quantity}::int,
        ${input.amountCents}::int,
        ${input.currency}::text,
        'PENDING'::"OrderStatus",
        NOW(),
        NOW()
      FROM taken
      RETURNING id`;
  } catch (cause) {
    throw new ReservationUnavailableError(cause);
  }

  const order = rows[0];
  if (!order) throw new SoldOutError();
  return order.id;
}

export interface FulfilInput {
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
}

export interface FulfilResult {
  /** False when the order was already settled — a replayed webhook. */
  applied: boolean;
  guestId: string | null;
  token: string | null;
}

/**
 * Money is in. Flip the order, attach a guest, send the ticket.
 *
 * Idempotent by construction: the PENDING -> PAID transition is a conditional
 * updateMany, so a webhook delivered three times does the work once. Seats were
 * already taken at reservation, which is why nothing here touches `sold`.
 */
export async function fulfilOrder(
  orderId: string,
  input: FulfilInput = {},
): Promise<FulfilResult> {
  const claimed = await db.order.updateMany({
    where: { id: orderId, status: "PENDING" },
    data: {
      status: "PAID",
      ...(input.stripeSessionId ? { stripeSessionId: input.stripeSessionId } : {}),
      ...(input.stripePaymentIntentId
        ? { stripePaymentIntentId: input.stripePaymentIntentId }
        : {}),
    },
  });

  if (claimed.count === 0) {
    const settled = await db.order.findUnique({
      where: { id: orderId },
      select: { guestId: true },
    });
    return { applied: false, guestId: settled?.guestId ?? null, token: null };
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      event: true,
      tier: { select: { name: true } },
    },
  });
  if (!order) return { applied: true, guestId: null, token: null };

  const now = new Date();
  const email = order.email.toLowerCase();

  const { guestId, plusOnes, dietary, name } = await db.$transaction(
    async (tx) => {
      const existing = await tx.guest.findUnique({
        where: { eventId_email: { eventId: order.eventId, email } },
        select: {
          id: true,
          name: true,
          rsvpStatus: true,
          plusOnes: true,
          dietary: true,
          registeredAt: true,
        },
      });

      const wasRegistered =
        existing !== null &&
        ["CONFIRMED", "WAITLISTED", "CHECKED_IN"].includes(existing.rsvpStatus);

      const guest = existing
        ? await tx.guest.update({
            where: { id: existing.id },
            data: {
              // A paid ticket confirms a waitlisted or invited guest. Someone
              // already through the door stays through the door.
              rsvpStatus:
                existing.rsvpStatus === "CHECKED_IN" ? "CHECKED_IN" : "CONFIRMED",
              source: "registration",
              registeredAt: existing.registeredAt ?? now,
              lastSeenAt: now,
              ...(order.buyerName && !existing.name
                ? { name: order.buyerName }
                : {}),
            },
            select: { id: true, name: true, plusOnes: true, dietary: true },
          })
        : await tx.guest.create({
            data: {
              eventId: order.eventId,
              email,
              name: order.buyerName?.trim() || email,
              rsvpStatus: "CONFIRMED",
              source: "registration",
              registeredAt: now,
              lastSeenAt: now,
            },
            select: { id: true, name: true, plusOnes: true, dietary: true },
          });

      await tx.order.update({
        where: { id: order.id },
        data: { guestId: guest.id },
      });

      if (!wasRegistered) {
        await tx.event.update({
          where: { id: order.eventId },
          data: { rsvpConversions: { increment: 1 } },
        });
      }

      return {
        guestId: guest.id,
        plusOnes: guest.plusOnes,
        dietary: guest.dietary,
        name: guest.name,
      };
    },
  );

  const token = signQrToken({
    guestId,
    eventId: order.eventId,
    expiresAt: ticketExpiry(order.event.date, order.event.endsAt),
    issuedAt: now,
  });

  await sendConfirmation({
    event: order.event,
    guestId,
    guest: { name, email, plusOnes, dietary },
    waitlisted: false,
    token,
  });

  return { applied: true, guestId, token };
}

/**
 * Gives the seats back. Used when a checkout expires, fails, or never opens.
 *
 * One statement, like reservation, and for the same two reasons. It touches the
 * same contended TicketTier row during the same rush — a flash sale that sells
 * out is a flash sale full of abandoned checkouts moments later — and the claim
 * and the credit have to be atomic. If they were not, a release interrupted
 * between them would either lose seats forever or, worse, credit them twice.
 *
 * Idempotent by construction: the PENDING -> CANCELLED/FAILED transition is
 * guarded, and `returned` credits seats only `FROM claimed`. A second release
 * claims nothing, so it credits nothing, so `sold` cannot drift downwards.
 */
export async function releaseOrder(
  orderId: string,
  status: "CANCELLED" | "FAILED",
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    WITH claimed AS (
      UPDATE "Order"
         SET status = ${status}::"OrderStatus", "updatedAt" = NOW()
       WHERE id = ${orderId}::text
         AND status = 'PENDING'::"OrderStatus"
      RETURNING id, "tierId", quantity
    ), returned AS (
      UPDATE "TicketTier" t
         SET sold = GREATEST(t.sold - c.quantity, 0),
             -- Back on sale if the returned seats reopened it.
             status = CASE
                        WHEN t.status = 'SOLD_OUT'::"TicketTierStatus"
                         AND GREATEST(t.sold - c.quantity, 0) < t.quota
                        THEN 'ON_SALE'::"TicketTierStatus"
                        ELSE t.status
                      END,
             "updatedAt" = NOW()
        FROM claimed c
       WHERE t.id = c."tierId"
      RETURNING t.id
    )
    SELECT id FROM claimed`;

  return rows.length > 0;
}

/**
 * Asks Stripe what actually happened to an order.
 *
 * The webhook is the source of truth, but a guest landing on the order page
 * seconds after paying should not be told "pending" because a delivery is in
 * flight — and in local development there may be no webhook listener at all.
 */
export async function reconcileOrder(orderId: string): Promise<void> {
  if (!paymentsEnabled()) return;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, stripeSessionId: true },
  });
  if (!order || order.status !== "PENDING" || !order.stripeSessionId) return;

  const stripe = stripeClient();
  if (!stripe) return;

  try {
    const session = await stripe.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    if (session.payment_status === "paid") {
      await fulfilOrder(orderId, {
        stripeSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
      });
    } else if (session.status === "expired") {
      await releaseOrder(orderId, "CANCELLED");
    }
  } catch (cause) {
    console.error(
      "[ticketing] could not reconcile order:",
      cause instanceof Error ? cause.message : cause,
    );
  }
}
