import { createContext } from "~/server/context";
import { parseChannel, subscribe } from "~/server/realtime";
import { startCueTimer, stopCueTimer } from "~/server/live/cue-timer";
import { db } from "@ovation/core/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The browser's realtime transport when no Pusher broker is configured.
 *
 * Why not the tRPC `live.feed` subscription from the browser? Because
 * EventSource cannot set request headers, and the listening channel has to
 * travel with the request — the contract's `liveFeedInput` has no room for it.
 * A query parameter is the one place left. Both this route and `live.feed`
 * read the same bus, so there is one source of events, two doorways.
 *
 * `since` is the reconnect resume point: a phone that went through a dead-zone
 * reconnects with the timestamp of the last event it saw and gets the gap
 * replayed before live traffic resumes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");
  if (!eventId) {
    return new Response("eventId is required", { status: 400 });
  }

  const channel = parseChannel(url.searchParams.get("channel"), "ops");
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;

  // Operator channels need a session; the guest app and info screens do not —
  // they are in the room, not in the organisation. What they can see is
  // constrained by the audience table in ~/server/realtime, not by this check.
  const operator = channel === "ops" || channel === "host" || channel === "door";
  if (operator) {
    const ctx = await createContext(req.headers);
    if (!ctx.session?.user.organisationId) {
      return new Response("Unauthorised", { status: 401 });
    }
  }

  const encoder = new TextEncoder();
  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());

  // Only an operator watching keeps the cue clock running; an anonymous phone
  // on the guest app should not be able to start background work.
  if (operator) startCueTimer(db, eventId);

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (event: string, data: unknown) => {
        ctrl.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("ready", { eventId, channel, at: new Date().toISOString() });

      // Proxies and phone radios drop an idle connection; a comment frame every
      // 15s is cheap and keeps the socket warm through a quiet patch.
      const ping = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(ping);
        }
      }, 15_000);
      ping.unref?.();

      try {
        for await (const env of subscribe(eventId, {
          channel,
          since: since && !Number.isNaN(since.getTime()) ? since : null,
          signal: controller.signal,
        })) {
          send("live", { seq: env.seq, at: env.at, event: env.event });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("[live] stream failed:", (err as Error).message);
        }
      } finally {
        clearInterval(ping);
        if (operator) stopCueTimer(eventId);
        try {
          ctrl.close();
        } catch {
          /* already closed by the client hanging up */
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // nginx in front of the venue box would otherwise buffer the whole thing.
      "x-accel-buffering": "no",
    },
  });
}
