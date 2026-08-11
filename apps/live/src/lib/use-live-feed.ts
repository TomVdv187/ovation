"use client";

import { useEffect, useRef, useState } from "react";
// Schema subpath, not the barrel: `@ovation/core` re-exports the tRPC builder,
// which calls `initTRPC.create()` at module scope and throws in a browser.
import { liveEventSchema, type LiveEvent } from "@ovation/core/schemas";
import type { LiveChannel } from "~/lib/channels";

/**
 * The one hook every live surface uses.
 *
 * Transport is chosen at runtime, not at build time:
 *
 *  - **Pusher protocol** when NEXT_PUBLIC_REALTIME_KEY is set. Works across
 *    app instances and hosts, which is what an info screen on the venue's
 *    other wifi needs. Pusher SaaS or a self-hosted Soketi, same client.
 *  - **SSE** otherwise. One process, no broker, nothing to configure — which
 *    is what `pnpm dev` and a single box in a venue actually are.
 *
 * Either way the reconnect story is the same: remember the timestamp of the
 * last event seen and pass it as `since`, so the gap is replayed rather than
 * lost. A counter that quietly drifts after one dropped socket is worse than
 * no counter.
 */

export type FeedStatus = "connecting" | "live" | "reconnecting" | "offline";

export interface UseLiveFeedOptions {
  eventId: string;
  channel: LiveChannel;
  /** Retained history length. The ops feed shows the last 200 lines. */
  limit?: number;
  onEvent?: (event: LiveEvent) => void;
}

export interface LiveFeedState {
  status: FeedStatus;
  events: LiveEvent[];
  lastEventAt: Date | null;
  transport: "pusher" | "sse";
}

const RECONNECT_MIN = 500;
const RECONNECT_MAX = 10_000;

export function useLiveFeed(opts: UseLiveFeedOptions): LiveFeedState {
  const { eventId, channel, limit = 200 } = opts;
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);

  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;

  // Resume point survives reconnects without re-rendering on every event.
  const sinceRef = useRef<string | null>(null);

  const transport: "pusher" | "sse" = process.env.NEXT_PUBLIC_REALTIME_KEY
    ? "pusher"
    : "sse";

  useEffect(() => {
    let cancelled = false;

    const ingest = (raw: unknown) => {
      const parsed = liveEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const event = parsed.data;
      sinceRef.current = new Date(event.at).toISOString();
      setLastEventAt(new Date(event.at));
      setEvents((prev) => {
        const next = [event, ...prev];
        return next.length > limit ? next.slice(0, limit) : next;
      });
      onEventRef.current?.(event);
    };

    if (transport === "pusher") {
      let teardown = () => {};
      void connectPusher(eventId, channel, ingest, setStatus).then((fn) => {
        if (cancelled) fn();
        else teardown = fn;
      });
      return () => {
        cancelled = true;
        teardown();
      };
    }

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = RECONNECT_MIN;

    const connect = () => {
      if (cancelled) return;
      const url = new URL("/api/live/stream", window.location.origin);
      url.searchParams.set("eventId", eventId);
      url.searchParams.set("channel", channel);
      if (sinceRef.current) url.searchParams.set("since", sinceRef.current);

      source = new EventSource(url.toString());

      source.addEventListener("ready", () => {
        backoff = RECONNECT_MIN;
        setStatus("live");
      });
      source.addEventListener("live", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent<string>).data) as {
            event: unknown;
          };
          ingest(data.event);
        } catch {
          /* a truncated frame is a dropped frame; the next `since` recovers it */
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled) return;
        setStatus(navigator.onLine ? "reconnecting" : "offline");
        retry = setTimeout(connect, backoff);
        backoff = Math.min(RECONNECT_MAX, backoff * 2);
      };
    };

    connect();

    const onOnline = () => {
      // Do not wait out the backoff when the radio comes back.
      if (retry) clearTimeout(retry);
      source?.close();
      source = null;
      backoff = RECONNECT_MIN;
      connect();
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      source?.close();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [eventId, channel, limit, transport]);

  return { status, events, lastEventAt, transport };
}

async function connectPusher(
  eventId: string,
  channel: LiveChannel,
  ingest: (raw: unknown) => void,
  setStatus: (s: FeedStatus) => void,
): Promise<() => void> {
  const { default: Pusher } = await import("pusher-js");
  const client = new Pusher(process.env.NEXT_PUBLIC_REALTIME_KEY as string, {
    cluster: process.env.NEXT_PUBLIC_REALTIME_CLUSTER ?? "eu",
    ...(process.env.NEXT_PUBLIC_REALTIME_HOST
      ? {
          wsHost: process.env.NEXT_PUBLIC_REALTIME_HOST,
          forceTLS: true,
          enabledTransports: ["ws", "wss"] as ("ws" | "wss")[],
        }
      : {}),
  });

  client.connection.bind("connected", () => setStatus("live"));
  client.connection.bind("connecting", () => setStatus("reconnecting"));
  client.connection.bind("unavailable", () => setStatus("offline"));

  const name = `ovation-live-${eventId}-${channel}`;
  const sub = client.subscribe(name);
  for (const kind of [
    "CHECKIN",
    "VIP_ARRIVAL",
    "ANNOUNCEMENT",
    "COUNTER",
    "CUE",
  ]) {
    sub.bind(kind, ingest);
  }

  return () => {
    client.unsubscribe(name);
    client.disconnect();
  };
}
