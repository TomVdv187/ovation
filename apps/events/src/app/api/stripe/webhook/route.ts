import type Stripe from "stripe";
import { stripeClient, webhookSecret } from "~/server/stripe";
import { fulfilOrder, releaseOrder } from "~/server/ticketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe's side of the ticket flow.
 *
 * The signature is verified against STRIPE_WEBHOOK_SECRET before anything is
 * read — an unverified body is an attacker asking us to hand out tickets.
 *
 * Deliveries are retried and can arrive out of order or more than once, so
 * every handler is idempotent: fulfilOrder claims the PENDING -> PAID
 * transition with a conditional update and does nothing on a replay, and
 * releaseOrder does the same in the other direction. Seats were already taken
 * when the order was created, so nothing here touches TicketTier.sold except
 * the release path giving them back.
 */
export async function POST(request: Request): Promise<Response> {
  const stripe = stripeClient();
  const secret = webhookSecret();

  if (!stripe || !secret) {
    console.warn("[stripe] webhook called but Stripe is not configured.");
    return new Response("Stripe is not configured.", { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature.", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    // The RAW body — parsing it first would break the signature.
    const payload = await request.text();
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      secret,
    );
  } catch (cause) {
    console.error(
      "[stripe] rejected webhook:",
      cause instanceof Error ? cause.message : cause,
    );
    return new Response("Invalid signature.", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        const orderId = orderIdOf(session);
        // Bank transfers and other delayed methods complete the session before
        // the money lands. Only "paid" is paid.
        if (orderId && session.payment_status === "paid") {
          await fulfilOrder(orderId, {
            stripeSessionId: session.id,
            stripePaymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : (session.payment_intent?.id ?? null),
          });
        }
        break;
      }

      case "checkout.session.expired": {
        const orderId = orderIdOf(event.data.object);
        if (orderId) await releaseOrder(orderId, "CANCELLED");
        break;
      }

      case "checkout.session.async_payment_failed": {
        const orderId = orderIdOf(event.data.object);
        if (orderId) await releaseOrder(orderId, "FAILED");
        break;
      }

      default:
        break;
    }
  } catch (cause) {
    // A 500 makes Stripe retry, which is what we want for a transient fault.
    console.error(
      `[stripe] handling ${event.type} failed:`,
      cause instanceof Error ? cause.message : cause,
    );
    return new Response("Handler failed.", { status: 500 });
  }

  return Response.json({ received: true });
}

function orderIdOf(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.orderId ?? session.client_reference_id ?? null;
}
