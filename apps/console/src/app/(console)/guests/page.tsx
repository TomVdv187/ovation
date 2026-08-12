import { GuestsView } from "~/components/views/stub-views";
import { requireConsoleEvent } from "~/server/current-event";

export const dynamic = "force-dynamic";

export default async function GuestsPage() {
  const { event } = await requireConsoleEvent();
  if (!event) return null;
  return (
    <div className="px-6 py-6">
      <GuestsView eventId={event.id} />
    </div>
  );
}
