"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckinOutcome } from "@ovation/core/schemas";
import { api } from "~/trpc/react";
import {
  allScans,
  markFailed,
  markSynced,
  pendingScans,
  prune,
  type QueuedScan,
} from "./offline-queue";

/**
 * Drains the offline queue.
 *
 * Serial, not parallel: every entry in the queue is a write against the same
 * unique index, and firing them together only manufactures contention. One at
 * a time is also kinder to a venue uplink that has just come back.
 *
 * Triggers: on mount, on `online`, and on a slow interval as a backstop for
 * the case the browser never fires `online` (captive portals do this).
 * Re-entrancy is guarded — two drains replaying the same key would be safe on
 * the server but would double-count in the UI.
 */

const DRAIN_INTERVAL_MS = 15_000;

export interface SyncState {
  pending: number;
  syncing: boolean;
  lastSyncAt: Date | null;
  /** Outcomes the server returned for previously-offline scans. */
  resolved: Array<{ key: string; outcome: CheckinOutcome; name: string | null }>;
  online: boolean;
  refresh: () => Promise<void>;
  drain: () => Promise<void>;
}

export function useSyncQueue(eventId: string): SyncState {
  const checkin = api.live.checkin.useMutation();
  const checkinRef = useRef(checkin);
  checkinRef.current = checkin;

  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [resolved, setResolved] = useState<SyncState["resolved"]>([]);
  const [online, setOnline] = useState(true);

  const draining = useRef(false);

  const refresh = useCallback(async () => {
    setPending((await pendingScans(eventId)).length);
  }, [eventId]);

  const drain = useCallback(async () => {
    if (draining.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    draining.current = true;
    setSyncing(true);
    try {
      const queue = await pendingScans(eventId);
      for (const scan of queue) {
        try {
          const result = await sendOne(checkinRef.current, scan);
          await markSynced(
            scan.idempotencyKey,
            result.outcome,
            result.guest?.name ?? null,
          );
          setResolved((prev) => [
            {
              key: scan.idempotencyKey,
              outcome: result.outcome,
              name: result.guest?.name ?? null,
            },
            ...prev,
          ]);
        } catch (err) {
          await markFailed(scan.idempotencyKey, (err as Error).message);
          // Network is still bad; stop hammering and wait for the next trigger.
          if (typeof navigator !== "undefined" && !navigator.onLine) break;
        }
      }
      setLastSyncAt(new Date());
      await prune();
      await refresh();
    } finally {
      draining.current = false;
      setSyncing(false);
    }
  }, [eventId, refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refresh();
    void drain();

    const onOnline = () => {
      setOnline(true);
      void drain();
    };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = setInterval(() => void drain(), DRAIN_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(timer);
    };
  }, [drain, refresh]);

  return { pending, syncing, lastSyncAt, resolved, online, refresh, drain };
}

type CheckinMutation = ReturnType<typeof api.live.checkin.useMutation>;

function sendOne(mutation: CheckinMutation, scan: QueuedScan) {
  return mutation.mutateAsync({
    eventId: scan.eventId,
    token: scan.token,
    guestId: scan.guestId,
    lane: scan.lane,
    deviceId: scan.deviceId,
    idempotencyKey: scan.idempotencyKey,
    // Tells the server this arrived late, and hands it the moment the code was
    // actually read so the arrival curve stays honest.
    offlineSynced: true,
    scannedAt: new Date(scan.scannedAt),
  });
}

/** Debug helper for the queue panel. */
export async function inspectQueue(): Promise<QueuedScan[]> {
  return allScans();
}
