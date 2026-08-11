import "server-only";
import { redirect } from "next/navigation";
import { db } from "@ovation/core/db";
import { auth } from "./auth";

/**
 * Which event the console is looking at.
 *
 * One organisation, one live event is the shape today; an event switcher is a
 * later problem. Everything downstream takes an eventId, so adding one does not
 * reach into the views.
 */
export async function requireConsoleEvent() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!session.user.organisationId) {
    return { session, event: null, organisationId: null } as const;
  }

  const event =
    (await db.event.findFirst({
      where: {
        organisationId: session.user.organisationId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      orderBy: { date: "asc" },
    })) ??
    (await db.event.findFirst({
      where: { organisationId: session.user.organisationId },
      orderBy: { date: "desc" },
    }));

  return {
    session,
    event,
    organisationId: session.user.organisationId,
  } as const;
}
