"use client";

import type { ReactNode } from "react";

/**
 * NOT_IMPLEMENTED as a first-class UI state.
 *
 * During Phase 2 the guests, revenue, live and page routers are still the
 * contract stubs, so these views genuinely cannot have data. That is a known
 * position in the build, not a fault, and it should read like one: no error
 * boundary, no red, no stack trace. The view still calls the real procedure, so
 * it lights up the moment the owning agent's router is mounted.
 */

export function isNotImplemented(error: unknown): boolean {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  return code === "NOT_IMPLEMENTED";
}

export function PendingPanel({
  title,
  owner,
  blurb,
  lands,
}: {
  title: string;
  owner: string;
  blurb: string;
  lands: string;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-8">
      <p className="text-[11px] uppercase tracking-widest text-ink-subtle">
        Not wired up yet
      </p>
      <h2 className="ov-display mt-2 text-2xl text-ink">{title}</h2>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
        {blurb}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4 text-xs">
        <span className="text-ink-subtle">
          Owner <span className="text-gold">{owner}</span>
        </span>
        <span className="text-ink-subtle">{lands}</span>
      </div>
    </section>
  );
}

/**
 * Renders children when the query has data, a calm pending panel when the
 * router is still a stub, and a plain message for anything else.
 */
export function ContractState({
  query,
  pending,
  children,
}: {
  query: { isLoading: boolean; error: unknown; data: unknown };
  pending: ReactNode;
  children: ReactNode;
}) {
  if (query.isLoading) {
    return (
      <section className="rounded-lg border border-line bg-surface p-8">
        <p className="text-sm text-ink-subtle">Loading…</p>
      </section>
    );
  }
  if (query.error) {
    if (isNotImplemented(query.error)) return <>{pending}</>;
    return (
      <section className="rounded-lg border border-line bg-surface p-8">
        <p className="text-[11px] uppercase tracking-widest text-ink-subtle">
          Could not load
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          {(query.error as { message?: string }).message ?? "Unknown error."}
        </p>
      </section>
    );
  }
  return <>{children}</>;
}
