import { Overview } from "~/components/overview/overview";
import { requireConsoleEvent } from "~/server/current-event";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { event } = await requireConsoleEvent();

  if (!event) {
    return (
      <div className="px-6 py-6">
        <section className="rounded-lg border border-line bg-surface p-8">
          <h2 className="ov-display text-2xl text-ink">No event yet</h2>
          <p className="mt-3 max-w-prose text-sm text-ink-muted">
            Seed Meridian Summit 2026 with <code className="text-gold">pnpm db:seed</code>,
            or create one through event.create.
          </p>
        </section>
      </div>
    );
  }

  return <Overview eventId={event.id} />;
}
