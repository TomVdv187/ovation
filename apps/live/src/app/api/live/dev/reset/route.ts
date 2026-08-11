import { db } from "@ovation/core/db";
import { createContext } from "~/server/context";
import { resetFired } from "~/server/live/cues";
import { resetRoom } from "~/server/realtime";
import * as metrics from "~/server/live/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Put the night back to the start. **Development only.**
 *
 * The simulation needs a clean room to measure against, and going through the
 * app rather than reaching into Prisma from the harness keeps the database to
 * a single writer — which is also what a venue box is.
 *
 * Deletes check-ins, returns those guests to CONFIRMED, and clears the cue
 * fired-set, the replay buffer and the latency histogram. Cue proposals are
 * left alone: they are AgentActions the organiser may have acted on, and this
 * route does not get to decide that.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not available" }, { status: 404 });
  }

  const ctx = await createContext(req.headers);
  if (!ctx.session?.user.organisationId) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const eventId = new URL(req.url).searchParams.get("eventId");
  if (!eventId) {
    return Response.json({ error: "eventId is required" }, { status: 400 });
  }

  const event = await db.event.findFirst({
    where: { id: eventId, organisationId: ctx.session.user.organisationId },
    select: { id: true },
  });
  if (!event) return Response.json({ error: "Unknown event" }, { status: 404 });

  const removed = await db.checkIn.deleteMany({ where: { eventId } });
  await db.guest.updateMany({
    where: { eventId, rsvpStatus: "CHECKED_IN" },
    data: { rsvpStatus: "CONFIRMED" },
  });

  resetFired(eventId);
  resetRoom(eventId);
  metrics.reset();

  return Response.json({ ok: true, removed: removed.count });
}
