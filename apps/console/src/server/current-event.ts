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
  // No organisation means every procedure below answers FORBIDDEN, so the
  // console would render a shell with nothing in it. /welcome is the way out
  // and it is the only page that works in this state.
  if (!session.user.organisationId) redirect("/welcome");

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

  const organisation = await db.organisation.findUnique({
    where: { id: session.user.organisationId },
    select: { name: true, settings: true },
  });
  const settings = (organisation?.settings ?? {}) as Record<string, unknown>;

  return {
    session,
    event,
    organisationId: session.user.organisationId,
    organisationName: organisation?.name ?? null,
    // The contract has no procedure that reads organisation settings, and the
    // chat's switch must not claim "off" while the database says "on". The
    // console owns this read, so take it here and hand it down.
    autoApproveCosmetic: settings.autoApproveCosmetic === true,
  } as const;
}
