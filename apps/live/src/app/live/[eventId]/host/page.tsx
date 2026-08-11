import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@ovation/core/db";
import { HostCompanion } from "~/components/host-companion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Host — OVATION" };

export default async function HostPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  return <HostCompanion eventId={event.id} eventTitle={event.title} />;
}
