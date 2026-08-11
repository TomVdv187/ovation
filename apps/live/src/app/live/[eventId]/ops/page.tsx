import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@ovation/core/db";
import { OpsDashboard } from "~/components/ops-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ops — OVATION" };

export default async function OpsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, venue: true },
  });
  if (!event) notFound();

  return (
    <OpsDashboard
      eventId={event.id}
      eventTitle={event.title}
      venue={event.venue}
    />
  );
}
