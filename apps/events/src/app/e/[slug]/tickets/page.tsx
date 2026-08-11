import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "~/components/layout";
import { TicketPicker, type TierView } from "~/components/ticket-picker";
import { formatDateShort, formatMoney } from "~/lib/format";
import { findPublicEvent, tierAvailability } from "~/server/event";
import { paymentsEnabled } from "~/server/stripe";
import { checkoutAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tickets",
  description: "Choose your ticket.",
  robots: { index: false, follow: true },
};

const MAX_PER_ORDER = 10;

export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { slug } = await params;
  const { cancelled } = await searchParams;

  const event = await findPublicEvent(slug);
  if (!event) notFound();

  const now = new Date();
  const tiers: TierView[] = event.ticketTiers.map((tier) => {
    const availability = tierAvailability(tier, now);
    return {
      id: tier.id,
      name: tier.name,
      description: tier.description,
      priceLabel:
        tier.priceCents === 0
          ? "Free"
          : formatMoney(tier.priceCents, tier.currency),
      free: tier.priceCents === 0,
      remaining: availability.remaining,
      purchasable: availability.purchasable,
      unavailableLabel: availability.purchasable
        ? null
        : unavailableLabel(tier, availability.remaining, now, event.timezone),
    };
  });

  const anyBuyable = tiers.some((tier) => tier.purchasable);

  return (
    <Container className="py-16 sm:py-24">
      <div className="max-w-2xl">
        <p className="ev-kicker text-ev-accent-text">Tickets</p>
        <h1 className="ev-display mt-4 text-section">{event.title}</h1>
        <p className="mt-6 text-lede text-ev-ink-muted">
          {formatDateShort(event.date, event.timezone)} · {event.venue}
        </p>

        {cancelled ? (
          <p
            role="status"
            className="mt-6 rounded-ev border border-ev-line bg-ev-surface p-5 text-base leading-relaxed"
          >
            You left the payment page, so nothing was charged and the seats went
            back on sale. Pick up where you left off whenever you like.
          </p>
        ) : null}

        {!anyBuyable ? (
          <div className="mt-8 rounded-ev border border-ev-edge bg-ev-wash p-6">
            <h2 className="text-xl">Nothing on sale right now</h2>
            <p className="mt-3 text-base leading-relaxed text-ev-ink-muted">
              Every tier is sold out or closed. You can still put your name down
              — we work through the waiting list in order when seats free up.
            </p>
            <p className="mt-6">
              <a href={`/e/${slug}/register`} className="ev-button">
                Join the waiting list
              </a>
            </p>
          </div>
        ) : null}

        <TicketPicker
          action={checkoutAction}
          slug={slug}
          tiers={tiers}
          maxPerOrder={MAX_PER_ORDER}
          paymentsConfigured={paymentsEnabled()}
        />

        {anyBuyable ? (
          <p className="mt-10 border-t border-ev-line pt-6 text-sm leading-relaxed text-ev-ink-muted">
            {paymentsEnabled()
              ? "Payment is handled by Stripe; we never see your card details."
              : "No payment provider is configured on this deployment, so checkout completes locally in test mode. No card is taken."}{" "}
            Invited rather than buying?{" "}
            <a
              href={`/e/${slug}/register`}
              className="underline decoration-ev-edge underline-offset-4"
            >
              Register with your invitation
            </a>
            .
          </p>
        ) : null}
      </div>
    </Container>
  );
}

function unavailableLabel(
  tier: { status: string; opensAt: Date | null; closesAt: Date | null },
  remaining: number,
  now: Date,
  timezone: string,
): string {
  if (tier.status === "SOLD_OUT" || remaining === 0) return "Sold out";
  if (tier.status === "CLOSED") return "Closed";
  if (tier.status === "DRAFT") return "Not on sale yet";
  if (tier.opensAt && tier.opensAt > now) {
    return `On sale from ${formatDateShort(tier.opensAt, timezone)}`;
  }
  if (tier.closesAt && tier.closesAt <= now) return "Sales have closed";
  return "Unavailable";
}
