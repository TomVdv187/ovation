import { redirect } from "next/navigation";
import { db } from "@ovation/core/db";
import { auth, signOut } from "~/server/auth";

export const dynamic = "force-dynamic";

/**
 * Scaffold shell. Agent 1 (CONDUCTOR) replaces this with the real console:
 * 64px icon rail, 360px agent chat, main content area.
 *
 * It exists so `pnpm dev` proves the whole chain end to end — auth session,
 * Prisma connection, seeded data, design tokens.
 */
export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const event = await db.event.findFirst({
    where: { status: { not: "COMPLETED" } },
    orderBy: { date: "asc" },
    include: {
      organisation: true,
      _count: { select: { guests: true, sponsors: true, agentActions: true } },
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-8 py-20">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">Ovation</p>
      <h1 className="mt-3 text-4xl">Console scaffold</h1>
      <p className="mt-4 max-w-prose text-ink-muted">
        Phase 1 is complete: contracts, schema, tokens and seed data are in
        place. Every tRPC procedure answers <code>NOT_IMPLEMENTED</code> until
        its owning agent lands.
      </p>

      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Tile label="Signed in as" value={session.user.email ?? "—"} />
        <Tile
          label="Organisation"
          value={event?.organisation.name ?? "none seeded"}
        />
        <Tile label="Guests" value={String(event?._count.guests ?? 0)} />
        <Tile
          label="Open proposals"
          value={String(event?._count.agentActions ?? 0)}
        />
      </dl>

      {event ? (
        <section className="mt-10 rounded-lg border border-line bg-surface p-6">
          <h2 className="text-2xl">{event.title}</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {event.date.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}{" "}
            · {event.venue} · capacity {event.capacity}
          </p>
          <p className="mt-4 text-sm text-ink-subtle">
            Public page will live at{" "}
            <code className="text-gold">/e/{event.slug}</code> once Agent 2
            lands apps/events.
          </p>
        </section>
      ) : (
        <p className="mt-10 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          No event found. Run <code>pnpm db:seed</code>.
        </p>
      )}

      <form
        className="mt-10"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <button
          type="submit"
          className="text-sm text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-5">
      <dt className="text-[11px] uppercase tracking-widest text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-ink">{value}</dd>
    </div>
  );
}
