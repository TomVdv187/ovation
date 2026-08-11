import { db } from "@ovation/core/db";
import { eventsBaseUrl, findPublicEvent, tierAvailability } from "./event";
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
    });
  } catch (cause) {
    if (cause instanceof SoldOutError) {
      return { ok: false, errors: {}, formError: cause.message };
    }
    throw cause;
  }

  // A free tier has nothing to pay for: the reservation IS the ticket.
  if (tier.priceCents === 0) {
    await fulfilOrder(orderId, { buyerName: name });
    return {
      ok: true,
      orderId,
      redirectTo: `/e/${event.slug}/order/${orderId}`,
    };
  }

  const stripe = stripeClient();
  if (!stripe) {
    // No key configured. The local checkout runs the same fulfilment path.
    // The buyer's name rides in the URL because Order has no column for it —
    // in the Stripe path it travels in the session metadata instead.
    return {
      ok: true,
      orderId,
      redirectTo: `/e/${event.slug}/checkout/${orderId}?n=${encodeURIComponent(name)}`,
    };
  }

  try {
    const base = eventsBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      client_reference_id: orderId,
      metadata: { orderId, eventId: event.id, tierId: tier.id, buyerName: name },
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
}

/** Takes the seats and opens a PENDING order, or throws SoldOutError. */
async function reserve(input: ReserveInput): Promise<string> {
  return db.$transaction(async (tx) => {
    const taken = await tx.$executeRaw`
      UPDATE "TicketTier"
         SET sold = sold + ${input.quantity}, "updatedAt" = NOW()
       WHERE id = ${input.tierId}
         AND status = 'ON_SALE'::"TicketTierStatus"
         AND sold + ${input.quantity} <= quota`;

    if (taken === 0) throw new SoldOutError();

    // Whoever took the last seat closes the tier. Agent 4's auto-open rules
    // watch for exactly this transition.
    await tx.$executeRaw`
      UPDATE "TicketTier"
         SET status = 'SOLD_OUT'::"TicketTierStatus", "updatedAt" = NOW()
       WHERE id = ${input.tierId}
         AND status = 'ON_SALE'::"TicketTierStatus"
         AND sold >= quota`;

    const order = await tx.order.create({
      data: {
        eventId: input.eventId,
        tierId: input.tierId,
        email: input.email,
        quantity: input.quantity,
        amountCents: input.amountCents,
        currency: input.currency,
        status: "PENDING",
      },
      select: { id: true },
    });

    return order.id;
  });
}

export interface FulfilInput {
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  buyerName?: string | null;
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
              ...(input.buyerName && !existing.name
                ? { name: input.buyerName }
                : {}),
            },
            select: { id: true, name: true, plusOnes: true, dietary: true },
          })
        : await tx.guest.create({
            data: {
              eventId: order.eventId,
              email,
              name: input.buyerName?.trim() || email,
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
 */
export async function releaseOrder(
  orderId: string,
  status: "CANCELLED" | "FAILED",
): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, tierId: true, quantity: true, status: true },
  });
  if (!order || order.status !== "PENDING") return false;

  const claimed = await db.order.updateMany({
    where: { id: orderId, status: "PENDING" },
    data: { status },
  });
  if (claimed.count === 0) return false;

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "TicketTier"
         SET sold = GREATEST(sold - ${order.quantity}, 0), "updatedAt" = NOW()
       WHERE id = ${order.tierId}`;

    // Back on sale if the returned seats reopened it.
    await tx.$executeRaw`
      UPDATE "TicketTier"
         SET status = 'ON_SALE'::"TicketTierStatus", "updatedAt" = NOW()
       WHERE id = ${order.tierId}
         AND status = 'SOLD_OUT'::"TicketTierStatus"
         AND sold < quota`;
  });

  return true;
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
        buyerName: session.metadata?.buyerName ?? null,
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
