"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { CachedGuest } from "~/lib/offline-queue";

/**
 * The fallback for the guest who lost their code — which, on any given night,
 * is roughly one in twenty.
 *
 * Reads from the cached list, so it works with no network. Search matches name,
 * company and email, and the list is capped at 60 rows: past that a greeter is
 * scrolling, not finding, and should type another letter.
 */
export function ManualDoorList({
  guests,
  checkedInIds,
  onPick,
  onClose,
}: {
  guests: CachedGuest[];
  checkedInIds: ReadonlySet<string>;
  onPick: (guestId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);

  const results = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    const pool = q
      ? guests.filter(
          (g) =>
            g.name.toLowerCase().includes(q) ||
            (g.company ?? "").toLowerCase().includes(q) ||
            g.email.toLowerCase().includes(q),
        )
      : guests;
    return pool.slice(0, 60);
  }, [guests, deferred]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b border-line p-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, company or email"
          // The global no-select rule is right for the rest of the door; a
          // text field is the one place a greeter needs to edit.
          className="flex-1 select-text rounded border border-line bg-surface-sunken px-3 py-3 text-base text-ink placeholder:text-ink-subtle"
          inputMode="search"
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-line px-3 text-sm uppercase tracking-[0.14em] text-ink-muted"
        >
          Close
        </button>
      </div>

      {guests.length === 0 ? (
        <p className="p-6 text-sm text-ink-subtle">
          No cached door list yet. Connect once and it is stored on this device.
        </p>
      ) : (
        <ul className="flex-1 divide-y divide-line overflow-y-auto">
          {results.map((g) => {
            const isIn = checkedInIds.has(g.id) || Boolean(g.checkedInAt);
            return (
              <li key={g.id}>
                <button
                  type="button"
                  disabled={isIn}
                  onClick={() => onPick(g.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-45"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base text-ink">
                      {g.name}
                      {g.plusOnes > 0 ? (
                        <span className="ml-2 text-xs text-ink-subtle">
                          +{g.plusOnes}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-ink-subtle">
                      {[g.company, g.segment !== "PROSPECT" ? g.segment : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-xs uppercase tracking-[0.14em] ${
                      isIn ? "text-good" : "text-gold"
                    }`}
                  >
                    {isIn ? "In" : "Check in"}
                  </span>
                </button>
              </li>
            );
          })}
          {results.length === 0 ? (
            <li className="px-4 py-6 text-sm text-ink-subtle">No match.</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
