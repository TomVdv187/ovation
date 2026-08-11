import Link from "next/link";
import { db } from "@ovation/core/db";

export const dynamic = "force-dynamic";

/**
 * Launcher. On the night somebody hands a tablet to a greeter and says "open
 * the door page" — this is that page, and nothing more.
 */
export default async function Index() {
  const events = await db.event.findMany({
    where: { status: { in: ["PUBLISHED", "LIVE"] } },
    orderBy: { date: "asc" },
    take: 8,
    select: {
      id: true,
      title: true,
      venue: true,
      date: true,
      capacity: true,
      _count: { select: { checkIns: true } },
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">Ovation</p>
      <h1 className="ov-display mt-2 text-4xl">Live ops</h1>

      {events.length === 0 ? (
        <p className="mt-10 text-sm text-ink-subtle">
          No published event found. Run <code>pnpm db:seed</code>.
        </p>
      ) : (
        <ul className="mt-10 space-y-4">
          {events.map((e) => (
            <li key={e.id} className="rounded border border-line bg-surface p-5">
              <p className="ov-display text-2xl">{e.title}</p>
              <p className="mt-1 text-xs text-ink-subtle">
                {e.venue} ·{" "}
                {e.date.toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · {e._count.checkIns}/{e.capacity} in
              </p>
              <nav className="mt-4 flex flex-wrap gap-2">
                <Tile href={`/live/${e.id}/door`} label="Door" hint="Scan check-in" />
                <Tile href={`/live/${e.id}/host`} label="Host" hint="VIP arrivals" />
                <Tile href={`/live/${e.id}/ops`} label="Ops" hint="Counters & feed" />
                {process.env.NODE_ENV !== "production" ? (
                  <Tile
                    href={`/live/${e.id}/dev/passes`}
                    label="Test passes"
                    hint="Dev only"
                  />
                ) : null}
              </nav>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Tile({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="rounded border border-line px-4 py-3 transition-colors hover:border-gold"
    >
      <span className="block text-sm uppercase tracking-[0.14em] text-ink">
        {label}
      </span>
      <span className="block text-xs text-ink-subtle">{hint}</span>
    </Link>
  );
}
