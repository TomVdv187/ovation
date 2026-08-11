"use client";

import { useCallback, useMemo, useState } from "react";
import type { LiveEvent } from "@ovation/core/schemas";
import { api } from "~/trpc/react";
import { useLiveFeed } from "~/lib/use-live-feed";

/**
 * The host's phone.
 *
 * Two jobs, in priority order. **Who just walked in that I need to greet** —
 * a VIP arrival, with the white-glove notes and one true thing to say. Then
 * **who should I introduce to whom** — the ranked matches.
 *
 * Matchmaking reads guests and sponsors through their contracts. While Agent 3
 * · ORACLE's `guests.list` is a stub the query comes back NOT_IMPLEMENTED and
 * this renders a pending panel that names the dependency. Deliberately not an
 * empty list: "nobody worth meeting" and "the data is not wired yet" are very
 * different messages to put in front of a host.
 */

interface VipAlert {
  guestId: string;
  name: string;
  company: string | null;
  notes: string[];
  opener: string | null;
  hostAssigned: string | null;
  at: Date;
  acknowledged: boolean;
}

export function HostCompanion({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const [alerts, setAlerts] = useState<VipAlert[]>([]);
  const [subject, setSubject] = useState<string | null>(null);

  const onEvent = useCallback((event: LiveEvent) => {
    if (event.kind !== "VIP_ARRIVAL") return;
    setAlerts((prev) => [
      {
        guestId: event.guestId,
        name: event.name,
        company: event.company,
        notes: event.notes,
        opener: event.conversationOpener,
        hostAssigned: event.hostAssigned,
        at: new Date(event.at),
        acknowledged: false,
      },
      ...prev.filter((a) => a.guestId !== event.guestId),
    ]);
  }, []);

  const feed = useLiveFeed({ eventId, channel: "host", limit: 80, onEvent });

  const matches = api.live.matchmaking.useQuery(
    { eventId, guestId: subject ?? undefined, limit: 10 },
    { retry: false, refetchInterval: 60_000 },
  );

  const markIntroduced = api.live.markIntroduced.useMutation({
    onSuccess: () => void matches.refetch(),
  });

  const announcements = useMemo(
    () => feed.events.filter((e) => e.kind === "ANNOUNCEMENT").slice(0, 3),
    [feed.events],
  );

  const pending = alerts.filter((a) => !a.acknowledged);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-[0.2em] text-gold">
            Host · {eventTitle}
          </p>
          <p className="text-xs text-ink-subtle">
            {pending.length} to greet · feed {feed.status}
          </p>
        </div>
      </header>

      {announcements.length > 0 ? (
        <ul className="border-b border-line bg-surface-sunken">
          {announcements.map((a) =>
            a.kind === "ANNOUNCEMENT" ? (
              <li key={a.announcementId} className="px-4 py-2 text-sm">
                <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--ov-chart-5)]">
                  Announcement
                </span>
                <p className="text-ink">
                  {a.title ? <strong>{a.title} — </strong> : null}
                  {a.body}
                </p>
              </li>
            ) : null,
          )}
        </ul>
      ) : null}

      <section className="p-4">
        <h2 className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
          VIP arrivals
        </h2>

        {alerts.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-line px-4 py-8 text-center text-sm text-ink-subtle">
            No VIP has arrived yet. This lights up the moment one scans in.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {alerts.map((a) => (
              <li
                key={a.guestId}
                className={`rounded border px-4 py-3 ${
                  a.acknowledged
                    ? "border-line bg-surface opacity-60"
                    : "border-gold bg-gold-wash"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Photo placeholder — no guest avatars in the schema yet. */}
                  <div
                    aria-hidden
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-gold-dim bg-surface-raised text-lg text-gold"
                  >
                    {initials(a.name)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="ov-display text-xl leading-tight">{a.name}</p>
                    <p className="text-xs text-ink-muted">
                      {[a.company, a.hostAssigned ? `Host: ${a.hostAssigned}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>

                    {a.notes.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 text-sm text-ink">
                        {a.notes.map((n) => (
                          <li key={n}>• {n}</li>
                        ))}
                      </ul>
                    ) : null}

                    {a.opener ? (
                      <p className="mt-2 text-sm italic text-ink-muted">
                        “{a.opener}”
                      </p>
                    ) : null}

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setAlerts((prev) =>
                            prev.map((x) =>
                              x.guestId === a.guestId
                                ? { ...x, acknowledged: true }
                                : x,
                            ),
                          )
                        }
                        className="rounded border border-line px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-ink-muted"
                      >
                        {a.acknowledged ? "Greeted" : "Mark greeted"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubject(a.guestId)}
                        className={`rounded px-3 py-1.5 text-xs uppercase tracking-[0.12em] ${
                          subject === a.guestId
                            ? "bg-gold text-ink-inverse"
                            : "border border-gold text-gold"
                        }`}
                      >
                        Who to introduce
                      </button>
                    </div>
                  </div>

                  <span className="shrink-0 text-[10px] [font-variant-numeric:tabular-nums] text-ink-subtle">
                    {a.at.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="p-4 pb-16">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
            {subject ? "Introduce them to" : "Worth meeting"}
          </h2>
          {subject ? (
            <button
              type="button"
              onClick={() => setSubject(null)}
              className="text-xs uppercase tracking-[0.12em] text-ink-subtle"
            >
              Clear
            </button>
          ) : null}
        </div>

        {matches.isPending ? (
          <p className="mt-3 text-sm text-ink-subtle">Ranking…</p>
        ) : matches.error ? (
          <PendingPanel message={matches.error.message} />
        ) : matches.data && matches.data.matches.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {matches.data.matches.map((m) => (
              <li
                key={m.guestId}
                className={`rounded border border-line bg-surface px-4 py-3 ${m.introduced ? "opacity-55" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-base text-ink">
                    {m.name}
                    {m.sponsorId ? (
                      <span className="ml-2 rounded-full border border-gold px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-gold">
                        Sponsor target
                      </span>
                    ) : null}
                  </p>
                  <span className="shrink-0 [font-variant-numeric:tabular-nums] text-xs text-ink-subtle">
                    {Math.round(m.score * 100)}
                  </span>
                </div>
                <p className="text-xs text-ink-muted">{m.company}</p>
                <ul className="mt-1 text-xs text-ink-muted">
                  {m.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
                {subject ? (
                  <button
                    type="button"
                    disabled={m.introduced || markIntroduced.isPending}
                    onClick={() =>
                      markIntroduced.mutate({
                        eventId,
                        guestId: subject,
                        withGuestId: m.guestId,
                      })
                    }
                    className="mt-2 rounded border border-line px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-ink-muted disabled:opacity-45"
                  >
                    {m.introduced ? "Introduced" : "Mark introduced"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-subtle">
            Nobody to suggest yet — matches are drawn from guests who have
            already arrived.
          </p>
        )}
      </section>
    </div>
  );
}

function PendingPanel({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded border border-dashed border-warning/50 bg-warning-wash px-4 py-4">
      <p className="text-xs uppercase tracking-[0.16em] text-warning">
        Pending dependency
      </p>
      <p className="mt-1 text-sm text-ink-muted">{message}</p>
      <p className="mt-2 text-xs text-ink-subtle">
        Ranking is built and tested; it starts producing matches the moment the
        contract it reads from is implemented.
      </p>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
