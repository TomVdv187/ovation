import type { LiveEvent } from "@ovation/core";
import * as bus from "./bus";
import { liveChannelSchema, type LiveChannel } from "../../lib/channels";
import { publishRemote, remoteSubscriberCount } from "./pusher";

export * from "../../lib/channels";
export { subscribe, stats, resetRoom, type Envelope } from "./bus";

const ALL_CHANNELS = liveChannelSchema.options as readonly LiveChannel[];

/**
 * Who is allowed to see each kind of event, by default.
 *
 * This table is a privacy boundary, not a convenience. `live.guestFeed` is a
 * `publicProcedure` — anyone in the room can subscribe with nothing but an
 * event id — so a CHECKIN frame carrying a guest's name and employer must
 * never reach the `guest-app` or `screens` channels. Fanning out to everyone
 * by default and trimming later is the wrong way round; the default is the
 * narrow set and a caller has to ask for more.
 *
 * COUNTER is aggregate and safe to show a room. ANNOUNCEMENT is addressed
 * explicitly by the organiser, so it always passes its own channel list.
 */
const DEFAULT_AUDIENCE: Record<LiveEvent["kind"], readonly LiveChannel[]> = {
  CHECKIN: ["ops", "host", "door"],
  VIP_ARRIVAL: ["ops", "host"],
  CUE: ["ops", "host"],
  COUNTER: ALL_CHANNELS,
  ANNOUNCEMENT: ["ops", "host", "screens", "guest-app"],
};

/**
 * The one way an event reaches a screen.
 *
 * Local fan-out is synchronous so the caller can rely on it having happened
 * before it returns (the delivery count and the sim's "no dropped updates"
 * assertion both need that). The remote mirror is fire-and-forget: a broker
 * round trip must never sit inside the check-in latency budget.
 */
export function emit(
  eventId: string,
  event: LiveEvent,
  channels?: readonly LiveChannel[],
): void {
  const audience = channels ?? DEFAULT_AUDIENCE[event.kind];
  bus.publish(eventId, event, audience);
  void publishRemote(eventId, event, audience);
}

/**
 * How many clients an announcement actually reached. Prefers the broker's
 * count when one is configured (it sees every app instance); otherwise the
 * local bus is the whole truth.
 */
export async function deliveryCount(
  eventId: string,
  channels: readonly LiveChannel[],
): Promise<number> {
  const local = bus.subscriberCount(eventId, channels);
  const remote = await remoteSubscriberCount(eventId, channels);
  return remote === null ? local : Math.max(local, remote);
}
