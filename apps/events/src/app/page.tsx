import { db } from "@ovation/core/db";

export const dynamic = "force-dynamic";

/**
 * Shell. Agent 2 · MAISON builds the real thing at /e/[slug].
 * This index only proves the app boots against the seeded database.
 */
export default async function Index() {
  const events = await db.event.findMany({
    where: { status: { in: ["PUBLISHED", "LIVE"] } },
    orderBy: { date: "asc" },
    select: { slug: true, title: true, date: true, venue: true },
  });

  return (
    <main className="mx-auto max-w-2xl px-8 py-24">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">Ovation</p>
      <h1 className="mt-3 text-4xl">Public events</h1>
      <p className="mt-4 text-ink-muted">
        Shell only — <code>/e/[slug]</code> is owned by Agent 2 · MAISON.
      </p>

      <ul className="mt-10 space-y-3">
        {events.map((event) => (
          <li
            key={event.slug}
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 className="text-xl">{event.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {event.date.toLocaleDateString("en-GB")} · {event.venue}
            </p>
            <p className="mt-2 text-sm text-ink-subtle">
              will render at <code className="text-gold">/e/{event.slug}</code>
            </p>
          </li>
        ))}
        {events.length === 0 ? (
          <li className="text-sm text-ink-subtle">
            Nothing published. Run <code>pnpm db:seed</code>.
          </li>
        ) : null}
      </ul>
    </main>
  );
}
