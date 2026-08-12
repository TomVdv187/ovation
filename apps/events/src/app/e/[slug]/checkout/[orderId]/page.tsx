import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@ovation/core/db";
import { Container } from "~/components/layout";
import { formatMoney } from "~/lib/format";
import { findPublicEvent } from "~/server/event";
import { paymentsEnabled } from "~/server/stripe";
import { abandonLocalPayment, confirmLocalPayment } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

/**
 * The local checkout — only reachable when no Stripe key is configured.
 *
 * It exists so the ticketing path is complete on a fresh clone: reserve, pay,
 * fulfil, email, check-in code. The "payment" is a button, and the page says so
 * plainly. With Stripe configured this route redirects away, so it can never
 * stand in for a real payment.
 */
export default async function LocalCheckoutPage({
  params,
}: {
  params: Promise<{ slug: string; orderId: string }>;
}) {
  const { slug, orderId } = await params;

  if (paymentsEnabled()) redirect(`/e/${slug}/order/${orderId}`);

  const event = await findPublicEvent(slug);
  if (!event) notFound();

  const order = await db.order.findFirst({
    where: { id: orderId, eventId: event.id },
    include: { tier: { select: { name: true, description: true } } },
  });
  if (!order) notFound();
  if (order.status !== "PENDING") redirect(`/e/${slug}/order/${orderId}`);

  return (
    <Container className="py-16 sm:py-24">
      <div className="max-w-xl">
        <p className="ev-kicker text-ev-accent-text">Test checkout</p>
        <h1 className="ev-display mt-4 text-section">Confirm your order</h1>

        <p className="mt-6 rounded-ev border border-ev-edge bg-ev-wash p-5 text-base leading-relaxed">
          No payment provider is configured on this deployment, so this stands in
          for the card page. Nothing is charged, and the order is settled by the
          same code a real Stripe webhook runs.
        </p>

        <dl className="mt-10 border-t border-ev-line">
          <Row label="Ticket" value={`${order.quantity} × ${order.tier.name}`} />
          <Row label="Email" value={order.email} />
          <Row
            label="Total"
            value={formatMoney(order.amountCents, order.currency)}
          />
        </dl>

        <div className="mt-10 flex flex-wrap gap-3">
          <form action={confirmLocalPayment}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="orderId" value={orderId} />
            <button type="submit" className="ev-button">
              Pay {formatMoney(order.amountCents, order.currency)}
            </button>
          </form>

          <form action={abandonLocalPayment}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="orderId" value={orderId} />
            <button type="submit" className="ev-button ev-button-quiet">
              Cancel and release the seats
            </button>
          </form>
        </div>
      </div>
    </Container>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-ev-line py-4">
      <dt className="ev-kicker text-ev-ink-muted">{label}</dt>
      <dd className="text-right text-base">{value}</dd>
    </div>
  );
}
