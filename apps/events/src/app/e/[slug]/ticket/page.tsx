import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { db } from "@ovation/core/db";
import { Container } from "~/components/layout";
import { formatDateLong, formatTimeRange, timezoneLabel } from "~/lib/format";
import { getPage } from "~/server/page-data";
import { qrSvg } from "~/server/qr-image";
import { verifyQrToken } from "~/server/qr-token";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your ticket",
  // A ticket is a credential in a URL. It must never reach an index.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * What a guest sees after registering, and what they open at the door.
 *
 * The QR is rendered here from the signed token in the URL, verified
 * server-side first — an expired or tampered token gets an explanation, not a
 * code that will fail at the entrance in front of a queue.
 */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string; waitlisted?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const page = await getPage(slug);
  if (!page) notFound();

  const { event } = page;
  const when = `${formatDateLong(event.date, event.timezone)}, ${formatTimeRange(
    event.date,
    event.endsAt,
    event.timezone,
  )} ${timezoneLabel(event.date, event.timezone)}`;

  if (query.waitlisted === "1") {
    return (
      <Shell kicker="Waiting list" title="You are on the list">
        <p className="mt-6 text-lede text-ev-ink-muted">
          Every seat for {event.title} is taken, so we have put you on the
          waiting list and emailed you a copy. People do drop out — if a seat
          frees up we will write to you with your check-in code.
        </p>
        <BackLink slug={slug} />
      </Shell>
    );
  }

  const token = query.t;
  if (!token) {
    return (
      <Shell kicker="Ticket" title="No ticket in this link">
        <p className="mt-6 text-lede text-ev-ink-muted">
          Open the link from your confirmation email — it carries the code.
        </p>
        <BackLink slug={slug} />
      </Shell>
    );
  }

  const verified = verifyQrToken(token);
  if (!verified.ok) {
    return (
      <Shell kicker="Ticket" title={reasonTitle(verified.reason)}>
        <p className="mt-6 text-lede text-ev-ink-muted">
          {reasonBody(verified.reason)}
        </p>
        <BackLink slug={slug} />
      </Shell>
    );
  }

  const guest =
    verified.payload.eid === event.id
      ? await db.guest.findFirst({
          where: { id: verified.payload.gid, eventId: event.id },
          select: { name: true, plusOnes: true, rsvpStatus: true },
        })
      : null;

  if (!guest) {
    return (
      <Shell kicker="Ticket" title="That code is for another event">
        <p className="mt-6 text-lede text-ev-ink-muted">
          Check you have opened the right confirmation email.
        </p>
        <BackLink slug={slug} />
      </Shell>
    );
  }

  // Black on white, whatever the theme: a scanner reads contrast, not brand.
  const svg = await qrSvg(token, { dark: "#000000ff", light: "#ffffffff" });

  return (
    <Shell kicker="You're in" title={event.title}>
      <p className="mt-6 text-lede text-ev-ink-muted">
        {guest.name}
        {guest.plusOnes > 0
          ? ` plus ${guest.plusOnes} ${guest.plusOnes === 1 ? "guest" : "guests"}`
          : ""}{" "}
        · {when} · {event.venue}
      </p>

      <div className="mt-10 max-w-sm rounded-ev border border-ev-line bg-white p-5">
        <div
          role="img"
          aria-label="Your check-in code, as a QR code. Show it at the door."
          className="[&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <p className="mt-5 max-w-prose text-base leading-relaxed text-ev-ink-muted">
        Show this at the door. Take a screenshot if you would rather not rely on
        signal on the night — it stays valid either way.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <a
          className="ev-button ev-button-quiet"
          href={`/e/${slug}/ticket/qr.png?t=${encodeURIComponent(token)}`}
          download="check-in-code.png"
        >
          Download the code
        </a>
        <a className="ev-button ev-button-quiet" href={`/e/${slug}/calendar.ics`}>
          Add to calendar
        </a>
        <a className="ev-button ev-button-quiet" href={`/e/${slug}`}>
          Event details
        </a>
      </div>
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

function BackLink({ slug }: { slug: string }) {
  return (
    <p className="mt-8">
      <a href={`/e/${slug}`} className="ev-button ev-button-quiet">
        Back to the event
      </a>
    </p>
  );
}

function reasonTitle(reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED"): string {
  return reason === "EXPIRED" ? "That code has expired" : "We cannot read that code";
}

function reasonBody(reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED"): string {
  return reason === "EXPIRED"
    ? "Check-in codes stop working the day after the event. If the evening has not happened yet, ask the organiser for a fresh link."
    : "The link looks incomplete — email clients sometimes break long ones across lines. Try copying the whole link from your confirmation email.";
}
