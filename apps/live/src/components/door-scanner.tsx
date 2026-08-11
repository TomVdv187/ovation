"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckinOutcome } from "@ovation/core/schemas";
import { api } from "~/trpc/react";
import {
  deviceId,
  enqueue,
  loadDoorList,
  locallyCheckedIn,
  newIdempotencyKey,
  saveDoorList,
  type CachedDoorList,
  type CachedGuest,
} from "~/lib/offline-queue";
import { peekQrToken } from "~/lib/token-peek";
import { useQrScanner } from "~/lib/use-qr-scanner";
import { useSyncQueue } from "~/lib/use-sync-queue";
import { OutcomeScreen, type DoorOutcome } from "./outcome-screen";
import { ManualDoorList } from "./manual-door-list";

/**
 * THE DOOR.
 *
 * One screen, held one-handed, in a venue whose wifi may or may not exist.
 * The order of operations is chosen around that:
 *
 *  1. Decode locally. The clock starts here — this is the moment the greeter
 *     pointed the camera, and every latency number below is measured from it
 *     to the paint of the answer, not to the HTTP response.
 *  2. If we are offline, answer from the cached door list and queue the scan.
 *     A provisional answer in 40ms beats a correct answer in thirty seconds.
 *  3. If we are online, send it. Rejections come back as outcomes, so there is
 *     exactly one rendering path for all seven results.
 *
 * Nothing here decides whether a token is genuine. That is the server's job
 * and it is the only party holding the signing secret; the offline path says
 * "unverified" on the screen and means it.
 */

const LANES = ["main", "side", "vip", "press"] as const;
const OUTCOME_DWELL_MS = 2_600;

interface Props {
  eventId: string;
  eventTitle: string;
  capacity: number;
}

interface Shown {
  outcome: DoorOutcome;
  guestName?: string | null;
  company?: string | null;
  segment?: string | null;
  plusOnes?: number;
  notes?: string[];
  opener?: string | null;
  detail?: string | null;
  decodedAt: number;
}

export function DoorScanner({ eventId, eventTitle, capacity }: Props) {
  const [lane, setLane] = useState("main");
  const [shown, setShown] = useState<Shown | null>(null);
  const [paintMs, setPaintMs] = useState<number | null>(null);
  const [samples, setSamples] = useState<number[]>([]);
  const [doorList, setDoorList] = useState<CachedDoorList | null>(null);
  const [showList, setShowList] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [checkedInIds, setCheckedInIds] = useState<Set<string>>(new Set());

  const checkin = api.live.checkin.useMutation();
  const sync = useSyncQueue(eventId);

  const busyRef = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(`ovation.lane.${eventId}`);
    if (saved) setLane(saved);
  }, [eventId]);

  const pickLane = useCallback(
    (next: string) => {
      setLane(next);
      localStorage.setItem(`ovation.lane.${eventId}`, next);
    },
    [eventId],
  );

  // Pull the door list whenever we have signal, so the dead-zone has something
  // to answer from. Cheap enough to refresh on reconnect.
  const refreshDoorList = useCallback(async () => {
    try {
      const res = await fetch(`/api/live/doorlist?eventId=${eventId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const payload = (await res.json()) as Omit<CachedDoorList, "key">;
      await saveDoorList(eventId, payload);
      setDoorList({ key: `doorlist:${eventId}`, ...payload });
    } catch {
      const cached = await loadDoorList(eventId);
      if (cached) setDoorList(cached);
    }
    setCheckedInIds(await locallyCheckedIn(eventId));
  }, [eventId]);

  useEffect(() => {
    void refreshDoorList();
    const onOnline = () => void refreshDoorList();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refreshDoorList]);

  // Late outcomes from the sync queue refresh the local "already in" set, so a
  // re-scan after a replay is answered correctly without a round trip.
  useEffect(() => {
    if (sync.resolved.length === 0) return;
    void locallyCheckedIn(eventId).then(setCheckedInIds);
  }, [sync.resolved, eventId]);

  const guestsById = useMemo(() => {
    const map = new Map<string, CachedGuest>();
    for (const g of doorList?.guests ?? []) map.set(g.id, g);
    return map;
  }, [doorList]);

  const present = useCallback((next: Shown) => {
    setShown(next);
    setPaintMs(null);
    // Measured after the browser has actually painted: what the greeter waited
    // for, not what the network did.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ms = Date.now() - next.decodedAt;
        setPaintMs(ms);
        setSamples((prev) => [...prev.slice(-499), ms]);
      });
    });
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setShown(null), OUTCOME_DWELL_MS);
  }, []);

  const submit = useCallback(
    async (
      source: { token?: string; guestId?: string },
      decodedAt: number,
    ) => {
      if (busyRef.current) return;
      busyRef.current = true;

      const idempotencyKey = newIdempotencyKey();
      const scannedAt = new Date(decodedAt);
      const device = deviceId();

      // Which guest is this, as far as the device can tell? Used for the
      // offline answer only.
      const peeked = source.token ? peekQrToken(source.token) : null;
      const localGuestId =
        source.guestId ?? (peeked?.ok ? peeked.payload.gid : undefined);
      const localGuest = localGuestId ? guestsById.get(localGuestId) : undefined;

      const offline = typeof navigator !== "undefined" && !navigator.onLine;

      if (offline) {
        // Refusals we can make on the device without trusting the signature.
        if (source.token && (!peeked || !peeked.ok)) {
          present({ outcome: "REJECTED_INVALID_TOKEN", decodedAt });
          busyRef.current = false;
          return;
        }
        if (peeked?.ok && peeked.expired) {
          present({ outcome: "REJECTED_EXPIRED", decodedAt });
          busyRef.current = false;
          return;
        }
        if (peeked?.ok && peeked.payload.eid !== eventId) {
          present({ outcome: "REJECTED_WRONG_EVENT", decodedAt });
          busyRef.current = false;
          return;
        }
        if (localGuestId && doorList && !localGuest) {
          present({ outcome: "REJECTED_UNKNOWN_GUEST", decodedAt });
          busyRef.current = false;
          return;
        }
        if (localGuestId && checkedInIds.has(localGuestId)) {
          present({
            outcome: "ALREADY_CHECKED_IN",
            guestName: localGuest?.name,
            company: localGuest?.company,
            detail: "Recorded on this device",
            decodedAt,
          });
          busyRef.current = false;
          return;
        }

        await enqueue({
          idempotencyKey,
          eventId,
          token: source.token,
          guestId: source.guestId,
          lane,
          deviceId: device,
          scannedAt: scannedAt.toISOString(),
          state: "pending",
          attempts: 0,
          guestName: localGuest?.name,
        });
        if (localGuestId) {
          setCheckedInIds((prev) => new Set(prev).add(localGuestId));
        }
        await sync.refresh();

        present({
          outcome: "QUEUED_OFFLINE",
          guestName: localGuest?.name,
          company: localGuest?.company,
          segment: localGuest?.segment,
          plusOnes: localGuest?.plusOnes,
          notes: localGuest?.whiteGloveNotes,
          opener: localGuest?.conversationOpener,
          decodedAt,
        });
        busyRef.current = false;
        return;
      }

      // Online. Queue first, then send: if the tab dies between the two, the
      // scan is still on the device and replays on the next load.
      await enqueue({
        idempotencyKey,
        eventId,
        token: source.token,
        guestId: source.guestId,
        lane,
        deviceId: device,
        scannedAt: scannedAt.toISOString(),
        state: "pending",
        attempts: 0,
        guestName: localGuest?.name,
      });

      try {
        const result = await checkin.mutateAsync({
          eventId,
          token: source.token,
          guestId: source.guestId,
          lane,
          deviceId: device,
          idempotencyKey,
          offlineSynced: false,
          scannedAt,
        });

        await markResolved(idempotencyKey, result.outcome, result.guest?.name);
        await sync.refresh();
        if (result.guest?.id) {
          setCheckedInIds((prev) => new Set(prev).add(result.guest!.id));
        }

        present({
          outcome: result.outcome,
          guestName: result.guest?.name ?? localGuest?.name ?? null,
          company: result.guest?.company ?? null,
          segment: result.guest?.segment ?? null,
          plusOnes: result.guest?.plusOnes ?? 0,
          notes: result.guest?.whiteGloveNotes ?? [],
          opener: result.guest?.conversationOpener ?? null,
          detail:
            result.outcome === "ALREADY_CHECKED_IN" && result.checkedInAt
              ? `In since ${new Date(result.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${result.lane ? ` · ${result.lane} lane` : ""}`
              : null,
          decodedAt,
        });
      } catch (err) {
        // The request failed, not the guest. Leave it queued and say so.
        present({
          outcome: "QUEUED_OFFLINE",
          guestName: localGuest?.name,
          detail: `Network failed — queued (${(err as Error).message.slice(0, 40)})`,
          decodedAt,
        });
        await sync.refresh();
      } finally {
        busyRef.current = false;
      }
    },
    [checkin, checkedInIds, doorList, eventId, guestsById, lane, present, sync],
  );

  const onDecode = useCallback(
    (value: string, decodedAt: number) => {
      void submit({ token: value }, decodedAt);
    },
    [submit],
  );

  const scanner = useQrScanner({ onDecode, enabled: cameraOn && !showList });

  const dismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setShown(null);
    scanner.clearDedupe();
  }, [scanner]);

  const p95 = useMemo(() => percentile(samples, 95), [samples]);

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-[0.2em] text-gold">
            {eventTitle}
          </p>
          <p className="text-xs text-ink-subtle">
            Capacity {capacity} · {doorList?.guests.length ?? 0} on the list
          </p>
        </div>
        <ConnectionPill
          online={sync.online}
          pending={sync.pending}
          syncing={sync.syncing}
        />
      </header>

      <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2">
        {LANES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => pickLane(l)}
            className={`shrink-0 rounded px-3 py-1.5 text-sm uppercase tracking-wider transition-colors ${
              lane === l
                ? "bg-gold text-ink-inverse"
                : "border border-line text-ink-muted"
            }`}
          >
            {l}
          </button>
        ))}
        <span className="ml-auto shrink-0 self-center font-mono text-xs text-ink-subtle">
          {samples.length > 0
            ? `${samples.length} scans · p95 ${Math.round(p95)}ms`
            : "no scans yet"}
        </span>
      </div>

      <main className="relative flex-1">
        {showList ? (
          <ManualDoorList
            guests={doorList?.guests ?? []}
            checkedInIds={checkedInIds}
            onPick={(guestId) => {
              setShowList(false);
              void submit({ guestId }, Date.now());
            }}
            onClose={() => setShowList(false)}
          />
        ) : (
          <ScannerViewport scanner={scanner} lane={lane} />
        )}
      </main>

      <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          className="flex-1 rounded border border-line bg-surface px-4 py-3 text-sm uppercase tracking-[0.14em] text-ink"
        >
          {showList ? "Back to camera" : "Door list"}
        </button>
        <button
          type="button"
          onClick={() => setCameraOn((v) => !v)}
          className="rounded border border-line bg-surface px-4 py-3 text-sm uppercase tracking-[0.14em] text-ink-muted"
        >
          {cameraOn ? "Pause" : "Resume"}
        </button>
        {sync.pending > 0 ? (
          <button
            type="button"
            onClick={() => void sync.drain()}
            className="rounded border border-gold bg-gold-wash px-4 py-3 text-sm uppercase tracking-[0.14em] text-gold"
          >
            Sync {sync.pending}
          </button>
        ) : null}
      </footer>

      {shown ? (
        <OutcomeScreen
          outcome={shown.outcome}
          guestName={shown.guestName}
          company={shown.company}
          segment={shown.segment}
          plusOnes={shown.plusOnes}
          notes={shown.notes}
          opener={shown.opener}
          detail={shown.detail}
          latencyMs={paintMs}
          onDismiss={dismiss}
        />
      ) : null}
    </div>
  );
}

function ScannerViewport({
  scanner,
  lane,
}: {
  scanner: ReturnType<typeof useQrScanner>;
  lane: string;
}) {
  return (
    <div className="relative h-full min-h-[50vh] w-full overflow-hidden bg-black">
      <video
        ref={scanner.videoRef}
        muted
        playsInline
        className="h-full w-full object-cover"
      />
      <canvas ref={scanner.canvasRef} className="hidden" />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-56 w-56 rounded-lg border-2 border-gold/70 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
      </div>

      <p className="pointer-events-none absolute bottom-4 left-0 right-0 text-center text-sm uppercase tracking-[0.2em] text-ink-muted">
        {scanner.status === "scanning"
          ? `${lane} lane — point at the code`
          : scanner.status === "starting"
            ? "Starting camera…"
            : scanner.status === "denied" || scanner.status === "unsupported"
              ? (scanner.error ?? "Camera unavailable")
              : scanner.status === "idle"
                ? "Camera paused"
                : (scanner.error ?? "Camera error")}
      </p>
    </div>
  );
}

function ConnectionPill({
  online,
  pending,
  syncing,
}: {
  online: boolean;
  pending: number;
  syncing: boolean;
}) {
  const tone = !online
    ? "border-critical text-critical"
    : pending > 0
      ? "border-warning text-warning"
      : "border-good text-good";
  const label = !online
    ? "Offline"
    : syncing
      ? "Syncing…"
      : pending > 0
        ? `${pending} queued`
        : "Online";
  return (
    <span
      className={`shrink-0 rounded-full border px-3 py-1 text-xs uppercase tracking-[0.14em] ${tone}`}
    >
      {label}
    </span>
  );
}

async function markResolved(
  key: string,
  outcome: CheckinOutcome,
  name?: string,
) {
  const { markSynced } = await import("~/lib/offline-queue");
  await markSynced(key, outcome, name ?? null);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}
