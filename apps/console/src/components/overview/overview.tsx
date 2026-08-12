"use client";

import type { ReactNode } from "react";
import type { AgentAction } from "@ovation/core";
import { api } from "~/trpc/react";
import { ProposalCard } from "~/components/chat/proposal-card";
import { isNotImplemented } from "~/components/pending";
import { RegistrationsChart } from "./registrations-chart";

/**
 * The Overview. Four numbers, the curve, what the agent has been doing, and
 * what it needs a decision on.
 */
export function Overview({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const stats = api.event.stats.useQuery({ eventId }, { retry: false });
  const series = api.event.registrationsOverTime.useQuery(
    { eventId, days: 60 },
    { retry: false },
  );
  const actions = api.agent.actions.useQuery(
    { eventId, limit: 40 },
    { retry: false },
  );
  // Owned by Agent 4. Until packages/revenue is mounted this stays
  // NOT_IMPLEMENTED and the tile shows a dash: a zero would be a lie.
  const revenue = api.revenue.summary.useQuery(
    { eventId, compareToPreviousEdition: true },
    { retry: false },
  );

  const refresh = async () => {
    await Promise.all([
      utils.agent.actions.invalidate(),
      utils.agent.history.invalidate(),
      utils.event.stats.invalidate(),
    ]);
  };

  const approve = api.agent.approve.useMutation({ onSuccess: refresh });
  const reject = api.agent.reject.useMutation({ onSuccess: refresh });

  const items = actions.data?.items ?? [];
  const proposed = items.filter((a) => a.status === "PROPOSED");
  const busy = approve.isPending || reject.isPending;

  const revenueValue = revenue.data
    ? formatMoney(revenue.data.grossRevenueCents, revenue.data.currency)
    : "—";
  const revenueNote = revenue.data
    ? "gross, tickets and sponsors"
    : isNotImplemented(revenue.error)
      ? "waiting on packages/revenue"
      : revenue.isLoading
        ? "loading"
        : "unavailable";

  return (
    <div className="space-y-6 px-6 py-6">
      <section aria-label="Key numbers">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
          <Tile
            label="Registrations"
            value={
              stats.data ? stats.data.registrations.toLocaleString("en-GB") : "—"
            }
            note={stats.data ? `of ${stats.data.capacity} capacity` : "loading"}
          />
          <Tile
            label="Predicted show-rate"
            value={
              stats.data
                ? `${Math.round(stats.data.predictedShowRate * 100)}%`
                : "—"
            }
            note={
              stats.data
                ? `${stats.data.confirmed} confirmed, ${stats.data.waitlisted} waitlisted`
                : "loading"
            }
          />
          <Tile label="Revenue" value={revenueValue} note={revenueNote} />
          <Tile
            label="Agent actions today"
            value={stats.data ? String(stats.data.agentActionsToday) : "—"}
            note={
              stats.data
                ? `${stats.data.pendingApprovals} awaiting you`
                : "loading"
            }
          />
        </dl>
      </section>

      <section
        aria-label="Registrations over time"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="ov-display text-lg text-ink">Registrations over time</h2>
          <p className="text-xs text-ink-subtle">last 60 days</p>
        </div>
        <div className="mt-4">
          {series.isLoading ? (
            <p className="py-10 text-center text-sm text-ink-subtle">Loading…</p>
          ) : series.data ? (
            <RegistrationsChart
              points={series.data.points}
              capacity={stats.data?.capacity ?? 0}
            />
          ) : (
            <p className="py-10 text-center text-sm text-ink-subtle">
              The curve could not be loaded.
            </p>
          )}
        </div>
      </section>

      {proposed.length > 0 && (
        <section aria-label="Needs your eye" className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="ov-display text-lg text-ink">Needs your eye</h2>
            <span className="text-xs text-ink-subtle">
              {proposed.length} waiting
            </span>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {proposed.map((action) => (
              <ProposalCard
                key={action.id}
                action={action}
                busy={busy}
                onApprove={(id) => approve.mutate({ actionIds: [id] })}
                onReject={(id) => reject.mutate({ actionIds: [id] })}
              />
            ))}
          </div>
        </section>
      )}

      <section
        aria-label="Agent activity"
        className="rounded-lg border border-line bg-surface"
      >
        <h2 className="ov-display border-b border-line px-5 py-3 text-lg text-ink">
          Agent activity
        </h2>
        {actions.isLoading ? (
          <p className="px-5 py-6 text-sm text-ink-subtle">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-subtle">
            Nothing yet. Ask the agent for something in the panel on the right.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.slice(0, 12).map((action) => (
              <ActivityRow key={action.id} action={action} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-[11px] uppercase tracking-widest text-ink-subtle">
        {label}
      </dt>
      <dd className="ov-display mt-1.5 text-3xl leading-none text-ink">{value}</dd>
      <p className="mt-1.5 text-xs text-ink-subtle">{note}</p>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  PROPOSED: "text-gold",
  EXECUTED: "text-good",
  APPROVED: "text-good",
  REJECTED: "text-ink-subtle",
  FAILED: "text-critical",
};

function ActivityRow({ action }: { action: AgentAction }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span
        aria-hidden="true"
        className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
          action.status === "PROPOSED"
            ? "bg-gold"
            : action.status === "EXECUTED"
              ? "bg-good"
              : action.status === "FAILED"
                ? "bg-critical"
                : "bg-ink-subtle"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{action.summary}</p>
        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-ink-subtle">
          {action.type.replace(/_/g, " ")} · {action.risk.toLowerCase()} ·{" "}
          <span className={STATUS_STYLE[action.status] ?? "text-ink-subtle"}>
            {action.status.toLowerCase()}
          </span>
        </p>
      </div>
      <time
        className="shrink-0 text-[11px] text-ink-subtle"
        dateTime={action.createdAt.toISOString()}
      >
        {relative(action.createdAt)}
      </time>
    </li>
  );
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function relative(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
