import { db } from "@ovation/core/db";
import { createContext } from "~/server/context";
import {
  conversationOpener,
  whiteGloveNotes,
} from "~/server/live/guest-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The offline door list.
 *
 * The scanner caches this in IndexedDB the moment it has signal, which is what
 * makes a dead-zone survivable: with the list on the device, a scan taken with
 * no network can still show the greeter a name, the white-glove notes and
 * whether that guest is already through, instead of a spinner and a shrug.
 *
 * It is not a security boundary. The device cannot verify a JWT signature —
 * the secret stays on the server — so an offline scan is provisional and the
 * server's answer on replay is the one that counts. The UI says so.
 *
 * Not a tRPC procedure because it is not in the contract, and adding
 * procedures to a shared router shape is how five worktrees stop merging.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedId = url.searchParams.get("eventId");

  const ctx = await createContext(req.headers);
  if (!ctx.session?.user.organisationId) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // No id means "tonight" — a door tablet is opened for whatever is on, and
  // making someone paste a cuid into a URL at 18:00 is a design failure.
  const event = await db.event.findFirst({
    where: {
      ...(requestedId ? { id: requestedId } : { status: { in: ["PUBLISHED", "LIVE"] } }),
      organisationId: ctx.session.user.organisationId,
    },
    orderBy: { date: "asc" },
    select: { id: true, title: true, capacity: true, date: true, venue: true },
  });
  if (!event) return Response.json({ error: "Unknown event" }, { status: 404 });

  const eventId = event.id;

  const guests = await db.guest.findMany({
    where: { eventId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      company: true,
      title: true,
      segment: true,
      rsvpStatus: true,
      dietary: true,
      plusOnes: true,
      interests: true,
      notes: true,
      whiteGlove: true,
      checkIn: { select: { timestamp: true, lane: true } },
    },
  });

  return Response.json(
    {
      event,
      fetchedAt: new Date().toISOString(),
      guests: guests.map((g) => ({
        id: g.id,
        name: g.name,
        email: g.email,
        company: g.company,
        segment: g.segment,
        rsvpStatus: g.rsvpStatus,
        plusOnes: g.plusOnes,
        dietary: g.dietary,
        whiteGloveNotes: whiteGloveNotes(g),
        conversationOpener: conversationOpener(g),
        checkedInAt: g.checkIn?.timestamp.toISOString() ?? null,
        lane: g.checkIn?.lane ?? null,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
