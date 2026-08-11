import { db } from "@ovation/core/db";

export const dynamic = "force-dynamic";

/**
 * Shell. Agent 5 · MAÎTRE D' builds /live/[eventId]/{door,host,ops}.
 */
export default async function Index() {
  const event = await db.event.findFirst({
    where: { status: { in: ["PUBLISHED", "LIVE"] } },
    orderBy: { date: "asc" },
    select: { id: true, title: true, capacity: true },
  });

  return (
    <main className="mx-auto max-w-2xl px-8 py-24">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">Ovation</p>
      <h1 className="mt-3 text-4xl">Live ops</h1>
      <p className="mt-4 text-ink-muted">
        Shell only — the door scanner, host companion and ops dashboard are
        owned by Agent 5 · MAÎTRE D&apos;.
      </p>

      {event ? (
        <ul className="mt-10 space-y-2 text-sm text-ink-subtle">
          <li>
            <code className="text-gold">/live/{event.id}/door</code> — check-in
            PWA
          </li>
          <li>
            <code className="text-gold">/live/{event.id}/host</code> — VIP
            arrivals &amp; matchmaking
          </li>
          <li>
            <code className="text-gold">/live/{event.id}/ops</code> — counters,
            feed, announcements
          </li>
        </ul>
      ) : (
        <p className="mt-10 text-sm text-ink-subtle">
          No event found. Run <code>pnpm db:seed</code>.
        </p>
      )}
    </main>
  );
}
