import type { LiveEvent } from "@ovation/core";
import { pusherChannelName, type LiveChannel } from "../../lib/channels";

/**
 * Cross-process fan-out over the Pusher protocol.
 *
 * Deliberately behind a capability check rather than a hard dependency: with
 * no REALTIME_* credentials the venue box runs a single Node process and the
 * in-process bus is both sufficient and faster. Point REALTIME_* at Pusher
 * SaaS or a self-hosted Soketi and the same events also leave the process, so
 * several app instances (or an info screen on a different host) stay in sync.
 *
 * The client mirror is ~/lib/realtime-client.ts, which picks pusher-js when
 * NEXT_PUBLIC_REALTIME_KEY is set and the SSE route otherwise.
 */

type PusherServer = {
  trigger: (
    channel: string | string[],
    event: string,
    data: unknown,
  ) => Promise<unknown>;
  get: (opts: {
    path: string;
    params?: Record<string, string>;
  }) => Promise<{ status: number; json: () => Promise<unknown> }>;
};

let client: PusherServer | null | undefined;

export function realtimeConfigured(): boolean {
  return Boolean(
    process.env.REALTIME_APP_ID &&
      process.env.REALTIME_KEY &&
      process.env.REALTIME_SECRET,
  );
}

async function getClient(): Promise<PusherServer | null> {
  if (client !== undefined) return client;
  if (!realtimeConfigured()) {
    client = null;
    return null;
  }
  const mod = (await import("pusher")) as unknown as {
    default: new (opts: Record<string, unknown>) => PusherServer;
  };
  const Pusher = mod.default;
  client = new Pusher({
    appId: process.env.REALTIME_APP_ID as string,
    key: process.env.REALTIME_KEY as string,
    secret: process.env.REALTIME_SECRET as string,
    cluster: process.env.REALTIME_CLUSTER ?? "eu",
    useTLS: true,
    // Self-hosted Soketi: REALTIME_HOST=soketi.internal REALTIME_PORT=6001
    ...(process.env.REALTIME_HOST
      ? {
          host: process.env.REALTIME_HOST,
          port: process.env.REALTIME_PORT ?? "443",
        }
      : {}),
  });
  return client;
}

/**
 * Best-effort mirror to the remote broker. A broker outage must never fail a
 * check-in — the door keeps working on the local bus and the remote catches up
 * on the next event.
 */
export async function publishRemote(
  eventId: string,
  event: LiveEvent,
  channels: readonly LiveChannel[],
): Promise<void> {
  const c = await getClient();
  if (!c) return;
  try {
    await c.trigger(
      channels.map((ch) => pusherChannelName(eventId, ch)),
      event.kind,
      event,
    );
  } catch (err) {
    console.warn("[live] realtime publish failed:", (err as Error).message);
  }
}

/**
 * Subscribers the broker knows about, for the announcement delivery count.
 * Returns null when unavailable so callers fall back to the local count rather
 * than reporting a confident zero.
 */
export async function remoteSubscriberCount(
  eventId: string,
  channels: readonly LiveChannel[],
): Promise<number | null> {
  const c = await getClient();
  if (!c) return null;
  try {
    let total = 0;
    for (const ch of channels) {
      const res = await c.get({
        path: `/channels/${pusherChannelName(eventId, ch)}`,
        params: { info: "subscription_count" },
      });
      if (res.status !== 200) continue;
      const body = (await res.json()) as { subscription_count?: number };
      total += body.subscription_count ?? 0;
    }
    return total;
  } catch (err) {
    console.warn("[live] realtime count failed:", (err as Error).message);
    return null;
  }
}
