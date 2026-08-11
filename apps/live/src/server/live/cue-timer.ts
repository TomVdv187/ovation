import type { Db } from "@ovation/core/db";
import { onTick } from "./cues";

/**
 * Time-based cues (a VIP who is late, an agenda item that is overdue) have no
 * check-in to hang off, so they need a clock. It is reference-counted against
 * open feed subscriptions: the timer exists while somebody is watching the
 * event and stops when the last screen closes. A serverless deployment that
 * has no long-lived process should call `/api/live/cues/tick` from a cron
 * instead — same entry point.
 */

const INTERVAL_MS = 30_000;

interface TimerState {
  timers: Map<string, { handle: ReturnType<typeof setInterval>; refs: number }>;
}

const globalForTimers = globalThis as unknown as {
  ovationCueTimers?: TimerState;
};
const state: TimerState = (globalForTimers.ovationCueTimers ??= {
  timers: new Map(),
});

export function startCueTimer(db: Db, eventId: string): void {
  const existing = state.timers.get(eventId);
  if (existing) {
    existing.refs++;
    return;
  }
  const handle = setInterval(() => {
    void onTick(db, eventId).catch((err) => {
      console.error("[live] cue tick failed:", (err as Error).message);
    });
  }, INTERVAL_MS);
  // Never hold the process open just to run cues.
  handle.unref?.();
  state.timers.set(eventId, { handle, refs: 1 });
}

export function stopCueTimer(eventId: string): void {
  const existing = state.timers.get(eventId);
  if (!existing) return;
  existing.refs--;
  if (existing.refs > 0) return;
  clearInterval(existing.handle);
  state.timers.delete(eventId);
}
