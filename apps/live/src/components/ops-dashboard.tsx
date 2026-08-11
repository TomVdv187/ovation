"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveEvent, OpsSnapshot } from "@ovation/core/schemas";
import { api } from "~/trpc/react";
import { useLiveFeed } from "~/lib/use-live-feed";
import { ArrivalsChart } from "./arrivals-chart";
import { AnnouncementComposer } from "./announcement-composer";
import { Meter, StatTile } from "./stat-tile";
import { FeedList } from "./feed-list";

const BUCKET_MS = 15 * 60 * 1000;

/**
 * The ops wall.
 *
 * The snapshot query is the source of truth; the feed patches it in place
 * between refetches. That split matters: recomputing the whole dashboard from
 * the database on every arrival would put a query on the check-in hot path,
 * and driving it purely from the socket would let one dropped event skew the
 * counter for the rest of the night. Applying deltas locally *and* re-syncing
 * on a slow interval gets both.
 */
export function OpsDashboard({
  eventId,
  eventTitle,
  venue,
}: {
  eventId: string;
  eventTitle: string;
  venue: string;
}) {
  const snapshot = api.live.ops.useQuery(
    { eventId },
    { refetchInterval: 30_000 },
  );

  const [local, setLocal] = useState<OpsSnapshot | null>(null);

  useEffect(() => {
    if (snapshot.data) setLocal(snapshot.data);
  }, [snapshot.data]);

  const onEvent = useCallback((event: LiveEvent) => {
    setLocal((prev) => (prev ? applyEvent(prev, event) : prev));
  }, []);

  const feed = useLiveFeed({ eventId, channel: "ops", limit: 200, onEvent });

  const data = local ?? snapshot.data ?? null;

  const arrivalBuckets = useMemo(
    () =>
      (data?.arrivalsPer15Min ?? []).map((b) => ({
        bucketStart: new Date(b.bucketStart),
        count: b.count,
      })),
    [data],
  );

  if (snapshot.error) {
    return (
      <p className="p-8 text-sm text-critical">
        {snapshot.error.message}
      </p>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gold">
            Live ops
          </p>
          <h1 className="ov-display text-2xl">{eventTitle}</h1>
          <p className="text-xs text-ink-subtle">{venue}</p>
        </div>
        <FeedStatus
          status={feed.status}
          transport={feed.transport}
          lastEventAt={feed.lastEventAt}
        />
      </header>

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-line bg-surface px-4 py-3 sm:col-span-1">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
                Checked in
              </p>
              <p className="mt-1 text-5xl font-semibold leading-none text-ink">
                {data?.checkedIn ?? "—"}
              </p>
              <p className="mt-1.5 text-xs text-ink-muted">
                of {data?.expected ?? "—"} expected
              </p>
              <Meter percent={data?.capacityPercent ?? 0} />
            </div>

            <StatTile
              label="Capacity"
              value={`${data ? data.capacityPercent.toFixed(1) : "—"}%`}
              note={`${data?.checkedIn ?? 0} of ${data?.capacity ?? 0} seats`}
              tone={
                (data?.capacityPercent ?? 0) >= 95
                  ? "critical"
                  : (data?.capacityPercent ?? 0) >= 70
                    ? "warning"
                    : "default"
              }
            />

            <StatTile
              label="VIPs arrived"
              value={`${data?.vipsArrived ?? 0}/${data?.vipsExpected ?? 0}`}
              note={
                data && data.vipsExpected > 0
                  ? `${data.vipsExpected - data.vipsArrived} still out`
                  : "No VIPs expected"
              }
            />
          </div>

          <div className="rounded border border-line bg-surface p-4">
            <h2 className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
              Arrival rate
            </h2>
            <ArrivalsChart buckets={arrivalBuckets} className="mt-2" />
          </div>

          <div className="rounded border border-line bg-surface p-4">
            <h2 className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
              By lane
            </h2>
            <ul className="mt-2 flex flex-wrap gap-4">
              {(data?.byLane ?? []).map((l) => (
                <li key={l.lane} className="text-sm">
                  <span className="text-ink-muted uppercase tracking-wider">
                    {l.lane}
                  </span>{" "}
                  <span className="[font-variant-numeric:tabular-nums] text-ink">
                    {l.count}
                  </span>
                </li>
              ))}
              {(data?.byLane ?? []).length === 0 ? (
                <li className="text-sm text-ink-subtle">No arrivals yet.</li>
              ) : null}
            </ul>
          </div>

          <AnnouncementComposer eventId={eventId} />
        </section>

        <section className="rounded border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-xs uppercase tracking-[0.16em] text-ink-subtle">
            Feed
          </h2>
          <FeedList events={feed.events} />
        </section>
      </div>
    </div>
  );
}

function FeedStatus({
  status,
  transport,
  lastEventAt,
}: {
  status: string;
  transport: string;
  lastEventAt: Date | null;
}) {
  const tone =
    status === "live"
      ? "border-good text-good"
      : status === "offline"
        ? "border-critical text-critical"
        : "border-warning text-warning";
  return (
    <div className="text-right">
      <span
        className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.14em] ${tone}`}
      >
        {status}
      </span>
      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-subtle">
        {transport}
        {lastEventAt
          ? ` · last ${lastEventAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
          : ""}
      </p>
    </div>
  );
}

/**
 * Fold one live event into the snapshot.
 *
 * COUNTER carries the authoritative checked-in total straight from the server,
 * so it wins over any local increment; CHECKIN only moves the derived numbers
 * the counter does not carry (lanes, buckets, VIPs).
 */
function applyEvent(prev: OpsSnapshot, event: LiveEvent): OpsSnapshot {
  switch (event.kind) {
    case "COUNTER":
      return {
        ...prev,
        checkedIn: event.checkedIn,
        capacityPercent: event.capacityPercent,
      };

    case "CHECKIN": {
      const at = new Date(event.at);
      const bucketStart = new Date(
        Math.floor(at.getTime() / BUCKET_MS) * BUCKET_MS,
      );
      const buckets = [...prev.arrivalsPer15Min];
      const idx = buckets.findIndex(
        (b) => new Date(b.bucketStart).getTime() === bucketStart.getTime(),
      );
      if (idx >= 0) {
        buckets[idx] = {
          bucketStart: buckets[idx]!.bucketStart,
          count: buckets[idx]!.count + 1,
        };
      } else {
        buckets.push({ bucketStart, count: 1 });
        buckets.sort(
          (a, b) =>
            new Date(a.bucketStart).getTime() - new Date(b.bucketStart).getTime(),
        );
      }

      const byLane = [...prev.byLane];
      const laneIdx = byLane.findIndex((l) => l.lane === event.lane);
      if (laneIdx >= 0) {
        byLane[laneIdx] = {
          lane: event.lane,
          count: byLane[laneIdx]!.count + 1,
        };
      } else {
        byLane.push({ lane: event.lane, count: 1 });
      }
      byLane.sort((a, b) => b.count - a.count || a.lane.localeCompare(b.lane));

      return {
        ...prev,
        arrivalsPer15Min: buckets,
        byLane,
        vipsArrived:
          event.segment === "VIP" ? prev.vipsArrived + 1 : prev.vipsArrived,
      };
    }

    default:
      return prev;
  }
}
