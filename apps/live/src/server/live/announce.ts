import type { z } from "zod";
import type { Db } from "@ovation/core/db";
import type { announceInput, announceOutput } from "@ovation/core";
import { deliveryCount, emit, type LiveChannel } from "~/server/realtime";

export type AnnounceInput = z.infer<typeof announceInput>;
export type AnnounceOutput = z.infer<typeof announceOutput>;

/**
 * Push a message to every screen on the chosen channels.
 *
 * The delivery count is measured, not estimated: it is the number of clients
 * actually subscribed to those channels at the moment of the push. The row is
 * written first so an announcement is never lost if the process dies mid-fan-
 * out, then updated with the count once we know it.
 *
 * Ordering note: we emit before awaiting the count. Counting can involve a
 * round trip to the broker, and an organiser hitting "send" during a fire
 * drill should not wait on telemetry.
 */
export async function announce(
  db: Db,
  input: AnnounceInput,
  createdBy: string | null,
): Promise<AnnounceOutput> {
  const channels = input.channels as readonly LiveChannel[];

  const row = await db.announcement.create({
    data: {
      eventId: input.eventId,
      title: input.title ?? null,
      body: input.body,
      channels: [...input.channels],
      createdBy,
    },
    select: { id: true, createdAt: true },
  });

  // Operators always see what went out, whoever it was addressed to.
  emit(
    input.eventId,
    {
      kind: "ANNOUNCEMENT",
      at: row.createdAt,
      announcementId: row.id,
      title: input.title ?? null,
      body: input.body,
    },
    [...channels, "ops"],
  );

  const delivered = await deliveryCount(input.eventId, channels);
  await db.announcement.update({
    where: { id: row.id },
    data: { deliveredCount: delivered },
  });

  return {
    announcementId: row.id,
    deliveredCount: delivered,
    sentAt: row.createdAt,
  };
}
