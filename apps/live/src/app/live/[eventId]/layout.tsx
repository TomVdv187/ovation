import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@ovation/core/db";
import { TRPCProvider } from "~/trpc/react";
import { ServiceWorker } from "~/components/service-worker";

export const dynamic = "force-dynamic";

/**
 * One provider for all three live surfaces. The event is resolved here so a
 * bad id is a 404 rather than three separate empty screens.
 */
export default async function EventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!event) notFound();

  return (
    <TRPCProvider>
      <ServiceWorker />
      {children}
    </TRPCProvider>
  );
}
