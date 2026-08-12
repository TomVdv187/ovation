import type { LiveEvent } from "@ovation/core";
import type { LiveChannel } from "../../lib/channels";

/**
 * The in-process fan-out.
 *
 * Everything that reaches a screen on the night goes through `publish()`:
 * check-ins, VIP arrivals, counters, announcements and cues. Subscribers are
 * async generators, so the tRPC `live.feed` subscription and the SSE route
 * handler are two thin adapters over the same buffer rather than two
 * independent code paths that can drift.
 *
 * Two properties the ops dashboard depends on:
 *
 *  - **Replay.** Every envelope is kept in a bounded ring buffer with its wall
 *    time, so a client that reconnects after a dead-zone passes `since` and
 *    gets exactly what it missed. Without this a dropped socket silently loses
 *    arrivals and the counter drifts for the rest of the night.
 *  - **No silent drops.** A slow subscriber gets queued, not sampled. If a
 *    queue ever exceeds `MAX_QUEUE` we count the drop in `stats()` rather than
 *    discarding quietly — the simulation asserts that counter is zero.
 *
 * Cross-process fan-out (several Node instances behind a load balancer) is the
 * Pusher driver's job — see ./pusher.ts. This bus is the single-process path,
 * which is what `pnpm dev` and a single venue box actually run.
 */

const BUFFER_LIMIT = 5_000;
const MAX_QUEUE = 10_000;

export interface Envelope {
  /** Monotonic per event, for gap detection in tests and the simulation. */
  seq: number;
  at: number;
  /** `null` means every channel sees it. */
  channels: readonly LiveChannel[] | null;
  event: LiveEvent;
}

interface Subscriber {
  channel: LiveChannel;
  queue: Envelope[];
  wake: (() => void) | null;
  dropped: number;
}

interface Room {
  seq: number;
  buffer: Envelope[];
  subscribers: Set<Subscriber>;
}

interface BusState {
  rooms: Map<string, Room>;
  dropped: number;
  published: number;
}

// Survives Next's dev-mode module reloads; otherwise a hot reload would orphan
// every open subscription and reset the replay buffer mid-event.
const globalForBus = globalThis as unknown as { ovationLiveBus?: BusState };

const state: BusState = (globalForBus.ovationLiveBus ??= {
  rooms: new Map(),
  dropped: 0,
  published: 0,
});

function room(eventId: string): Room {
  let r = state.rooms.get(eventId);
  if (!r) {
    r = { seq: 0, buffer: [], subscribers: new Set() };
    state.rooms.set(eventId, r);
  }
  return r;
}

function visible(env: Envelope, channel: LiveChannel): boolean {
  return env.channels === null || env.channels.includes(channel);
}

/**
 * Fan an event out to every live subscriber and record it for replay.
 * `channels` restricts the audience; omit it for everything that is not an
 * addressed announcement.
 */
export function publish(
  eventId: string,
  event: LiveEvent,
  channels?: readonly LiveChannel[],
): Envelope {
  const r = room(eventId);
  const env: Envelope = {
    seq: ++r.seq,
    at: Date.now(),
    channels: channels ?? null,
    event,
  };

  r.buffer.push(env);
  if (r.buffer.length > BUFFER_LIMIT) {
    r.buffer.splice(0, r.buffer.length - BUFFER_LIMIT);
  }

  for (const sub of r.subscribers) {
    if (!visible(env, sub.channel)) continue;
    if (sub.queue.length >= MAX_QUEUE) {
      sub.dropped++;
      state.dropped++;
      continue;
    }
    sub.queue.push(env);
    sub.wake?.();
  }

  state.published++;
  return env;
}

export interface SubscribeOptions {
  channel: LiveChannel;
  /** Resume point. Everything strictly newer than this is replayed first. */
  since?: Date | null;
  signal?: AbortSignal;
}

/**
 * Stream events for one event id. Yields the replay window first, then live
 * traffic, and cleans up on `return()` or abort.
 */
export async function* subscribe(
  eventId: string,
  opts: SubscribeOptions,
): AsyncGenerator<Envelope, void, unknown> {
  const r = room(eventId);
  const sub: Subscriber = {
    channel: opts.channel,
    queue: [],
    wake: null,
    dropped: 0,
  };

  if (opts.since) {
    const cutoff = opts.since.getTime();
    for (const env of r.buffer) {
      if (env.at > cutoff && visible(env, opts.channel)) sub.queue.push(env);
    }
  }

  r.subscribers.add(sub);

  const onAbort = () => sub.wake?.();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    while (!opts.signal?.aborted) {
      while (sub.queue.length > 0) {
        yield sub.queue.shift() as Envelope;
        if (opts.signal?.aborted) return;
      }
      // Park until the next publish or an abort. `wake` is cleared before the
      // next loop so a publish during a yield cannot resolve a stale promise.
      await new Promise<void>((resolve) => {
        sub.wake = resolve;
      });
      sub.wake = null;
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    r.subscribers.delete(sub);
  }
}

/** Live subscriber count on the given channels — the delivery count for an announcement. */
export function subscriberCount(
  eventId: string,
  channels: readonly LiveChannel[],
): number {
  const r = state.rooms.get(eventId);
  if (!r) return 0;
  let n = 0;
  for (const sub of r.subscribers) {
    if (channels.includes(sub.channel)) n++;
  }
  return n;
}

export function stats(eventId?: string) {
  if (eventId) {
    const r = state.rooms.get(eventId);
    return {
      published: state.published,
      dropped: state.dropped,
      subscribers: r ? r.subscribers.size : 0,
      buffered: r ? r.buffer.length : 0,
      seq: r ? r.seq : 0,
    };
  }
  return {
    published: state.published,
    dropped: state.dropped,
    rooms: state.rooms.size,
    subscribers: [...state.rooms.values()].reduce(
      (n, r) => n + r.subscribers.size,
      0,
    ),
  };
}

/** Test hook — drops every buffer and subscriber for one event. */
export function resetRoom(eventId: string): void {
  state.rooms.delete(eventId);
}
