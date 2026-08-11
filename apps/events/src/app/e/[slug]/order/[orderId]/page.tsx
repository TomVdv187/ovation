import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { db } from "@ovation/core/db";
import { Container } from "~/components/layout";
import { OrderPoller } from "~/components/order-poller";
import { formatMoney } from "~/lib/format";
import { findPublicEvent } from "~/server/event";
import { signQrToken, ticketExpiry } from "~/server/qr-token";
import { reconcileOrder } from "~/server/ticketing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

/**
 * Where Stripe sends the guest back to.
 *
 * The webhook is what settles an order, but a guest arrives here within a
 * second of paying and a delivery may still be in flight — so the page asks
 * Stripe directly before deciding what to say, and only falls back to "we are
 * confirming" when the answer really is not in yet.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ slug: string; orderId: string }>;
}) {
  const { slug, orderId } = await params;
  const event = await findPublicEvent(slug);
  if (!event) notFound();

  // Cheap when there is nothing to do, decisive when there is.
  await reconcileOrder(orderId);

  const order = await db.order.findFirst({
    where: { id: orderId, eventId: event.id },
    include: { tier: { select: { name: true } } },
  });
  if (!order) notFound();

  const summary = `${order.quantity} × ${order.tier.name} · ${formatMoney(
    order.amountCents,
    order.currency,
  )}`;

  if (order.status === "PAID" && order.guestId) {
    const token = signQrToken({
      guestId: order.guestId,
      eventId: event.id,
      expiresAt: ticketExpiry(event.date, event.endsAt),
    });
    return (
      <Shell kicker="Paid" title="Your tickets are booked">
        <p className="mt-6 text-lede text-ev-ink-muted">
          {summary}. We have emailed {order.email} with your check-in code and a
          calendar invitation.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            className="ev-button"
            href={`/e/${slug}/ticket?t=${encodeURIComponent(token)}`}
          >
            Open your check-in code
          </a>
          <a className="ev-button ev-button-quiet" href={`/e/${slug}`}>
            Event details
          </a>
        </div>
      </Shell>
    );
  }

  if (order.status === "CANCELLED" || order.status === "FAILED") {
    return (
      <Shell kicker="Order" title="That order did not go through">
        <p className="mt-6 text-lede text-ev-ink-muted">
          Nothing was charged and the seats are back on sale.
        </p>
        <p className="mt-8">
          <a className="ev-button" href={`/e/${slug}/tickets`}>
            Try again
          </a>
        </p>
      </Shell>
    );
  }

  return (
    <Shell kicker="Order" title="Confirming your payment">
      <p className="mt-6 text-lede text-ev-ink-muted">
        {summary}. Your seats are held. This page updates itself the moment the
        payment settles — it usually takes a few seconds.
      </p>
      <p className="mt-6 text-base text-ev-ink-muted">
        Nothing to do at your end: the confirmation goes to {order.email} either
        way.
      </p>
      <OrderPoller />
    </Shell>
  );
}

function Shell({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Container className="py-16 sm:py-24">
      <div className="max-w-2xl">
        <p className="ev-kicker text-ev-accent-text">{kicker}</p>
        <h1 className="ev-display mt-4 text-section">{title}</h1>
        {children}
      </div>
    </Container>
  );
}
