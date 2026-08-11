import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@ovation/core/db";
import { DoorScanner } from "~/components/door-scanner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Door — OVATION",
};

export default async function DoorPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, capacity: true },
  });
  if (!event) notFound();

  return (
    <DoorScanner
      eventId={event.id}
      eventTitle={event.title}
      capacity={event.capacity}
    />
  );
}
