import { z } from "zod";

/**
 * Who is listening.
 *
 * `announceInput.channels` only names the three audience channels, so those
 * three keep their contract spelling exactly. `ops` and `door` are internal
 * operator surfaces: they see everything, and an announcement addressed to
 * "guest-app" must not inflate their delivery count.
 */
export const liveChannelSchema = z.enum([
  "guest-app",
  "host",
  "screens",
  "ops",
  "door",
]);
export type LiveChannel = z.infer<typeof liveChannelSchema>;

/** The subset an organiser can address with `live.announce`. */
export const ANNOUNCEABLE_CHANNELS = [
  "guest-app",
  "host",
  "screens",
] as const satisfies readonly LiveChannel[];

export type AnnounceChannel = (typeof ANNOUNCEABLE_CHANNELS)[number];

/** Lenient parse for a `?channel=` query param or an `x-ovation-live-channel` header. */
export function parseChannel(
  raw: string | null | undefined,
  fallback: LiveChannel = "ops",
): LiveChannel {
  const parsed = liveChannelSchema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

/** Pusher channel name for an event/channel pair. */
export function pusherChannelName(
  eventId: string,
  channel: LiveChannel,
): string {
  return `ovation-live-${eventId}-${channel}`;
}
