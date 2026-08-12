import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@ovation/core/db";
import { formatDateLong } from "~/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What's on — OVATION",
  description: "Public event pages, registration and ticketing.",
};

/**
 * The index.
 *
 * Deliberately plain and deliberately unthemed: it belongs to no single event,
 * so it wears the OVATION chrome tokens rather than any Event.theme. The
 * designed surface is /e/[slug], which is themed per event.
 */
export default async function Index() {
  const events = await db.event.findMany({
    where: { status: { in: ["PUBLISHED", "LIVE"] } },
    orderBy: { date: "asc" },
    select: {
      slug: true,
      title: true,
      description: true,
      date: true,
      timezone: true,
      venue: true,
    },
  });

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-20 sm:px-8 sm:py-28">
      <p className="ev-kicker text-gold">Ovation</p>
      <h1 className="mt-4 text-4xl">What&rsquo;s on</h1>
      <p className="mt-5 max-w-prose text-base leading-relaxed text-ink-muted">
        Every published event has its own page, its own theme and its own
        registration form.
      </p>

      {events.length === 0 ? (
        <p className="mt-12 text-base text-ink-muted">
          Nothing published yet. Run <code>pnpm db:seed</code> to load the
          Meridian Summit.
        </p>
      ) : (
        <ul className="mt-12 space-y-4">
          {events.map((event) => (
            <li key={event.slug}>
              <Link
                href={`/e/${event.slug}`}
                className="block rounded-lg border border-line bg-surface p-6 hover:border-gold-dim"
              >
                <h2 className="text-xl">{event.title}</h2>
                <p className="mt-2 text-sm text-ink-muted">
                  {formatDateLong(event.date, event.timezone)} · {event.venue}
                </p>
                {event.description ? (
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-muted">
                    {event.description}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
