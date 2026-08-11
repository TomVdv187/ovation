"use client";

import type { LiveEvent } from "@ovation/core/schemas";

/**
 * The check-in feed. Every kind of live event gets its own accent so the
 * organiser can scan the column for the one they care about — a VIP arrival
 * and a routine check-in must not look the same at 2am.
 */
export function FeedList({ events }: { events: LiveEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-ink-subtle">
        Waiting for the first event.
      </p>
    );
  }

  return (
    <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
      {events.map((e, i) => (
        <li key={`${e.kind}-${keyOf(e)}-${i}`} className="px-4 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-[10px] uppercase tracking-[0.16em] ${accent(e.kind)}`}
            >
              {label(e.kind)}
            </span>
            <span className="shrink-0 text-[10px] [font-variant-numeric:tabular-nums] text-ink-subtle">
              {new Date(e.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-ink">{line(e)}</p>
          {detail(e) ? (
            <p className="mt-0.5 text-xs text-ink-muted">{detail(e)}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function keyOf(e: LiveEvent): string {
  switch (e.kind) {
    case "CHECKIN":
    case "VIP_ARRIVAL":
      return e.guestId;
    case "ANNOUNCEMENT":
      return e.announcementId;
    case "CUE":
      return e.agentActionId;
    case "COUNTER":
      return String(e.checkedIn);
  }
}

function label(kind: LiveEvent["kind"]): string {
  return kind === "VIP_ARRIVAL" ? "VIP" : kind.toLowerCase();
}

function accent(kind: LiveEvent["kind"]): string {
  switch (kind) {
    case "VIP_ARRIVAL":
      return "text-gold";
    case "ANNOUNCEMENT":
      return "text-[var(--ov-chart-5)]";
    case "CUE":
      return "text-warning";
    case "COUNTER":
      return "text-ink-subtle";
    default:
      return "text-[var(--ov-chart-1)]";
  }
}

function line(e: LiveEvent): string {
  switch (e.kind) {
    case "CHECKIN":
      return `${e.name}${e.company ? ` · ${e.company}` : ""}`;
    case "VIP_ARRIVAL":
      return `${e.name} has arrived`;
    case "ANNOUNCEMENT":
      return e.title ? `${e.title} — ${e.body}` : e.body;
    case "COUNTER":
      return `${e.checkedIn} in · ${e.capacityPercent.toFixed(1)}% capacity`;
    case "CUE":
      return e.summary;
  }
}

function detail(e: LiveEvent): string | null {
  switch (e.kind) {
    case "CHECKIN":
      return `${e.lane} lane${e.segment !== "PROSPECT" ? ` · ${e.segment}` : ""}`;
    case "VIP_ARRIVAL":
      return e.notes.length > 0 ? e.notes.join(" · ") : e.conversationOpener;
    case "CUE":
      return e.auto ? "Auto-eligible · still proposed" : "Proposed — needs approval";
    default:
      return null;
  }
}
