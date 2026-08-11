import { eventsBaseUrl, findPublicEvent } from "~/server/event";
import { buildIcs } from "~/server/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The event as a calendar file. Same builder the confirmation email attaches,
 * so what a guest downloads and what we posted them agree.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const event = await findPublicEvent(slug);
  if (!event) {
    return new Response("No such event.", { status: 404 });
  }

  const ics = buildIcs({
    uid: `${event.id}@ovation`,
    title: event.title,
    description: event.description,
    location: event.venueAddress
      ? `${event.venue}, ${event.venueAddress}`
      : event.venue,
    start: event.date,
    end: event.endsAt,
    url: `${eventsBaseUrl()}/e/${event.slug}`,
  });

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${event.slug}.ics"`,
    },
  });
}
