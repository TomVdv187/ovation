"use client";

import { api } from "~/trpc/react";
import { ContractState, PendingPanel } from "~/components/pending";

/**
 * The views whose routers belong to other agents.
 *
 * Each one calls the real contract procedure. Today that answers
 * NOT_IMPLEMENTED and the view renders a pending panel; the moment Agent 7
 * mounts the owning router in Phase 3, the same call starts returning data and
 * these views need only their tables written.
 */

export function GuestsView({ eventId }: { eventId: string }) {
  const query = api.guests.list.useQuery(
    { eventId, limit: 50, sortBy: "engagementScore", sortDir: "desc" },
    { retry: false },
  );

  return (
    <ContractState
      query={query}
      pending={
        <PendingPanel
          title="Guest intelligence"
          owner="Agent 3 · ORACLE"
          blurb="Engagement scores with the three factors that drove them, no-show probability, the recommended recovery for each guest at risk, and the VIP white-glove checklist. This view already calls guests.list; it will fill in without a code change here."
          lands="Lands with packages/guests"
        />
      }
    >
      <section className="rounded-lg border border-line bg-surface p-6">
        <p className="text-sm text-ink-muted">
          {query.data?.total ?? 0} guests returned.
        </p>
      </section>
    </ContractState>
  );
}

export function RevenueView({ eventId }: { eventId: string }) {
  const query = api.revenue.summary.useQuery(
    { eventId, compareToPreviousEdition: true },
    { retry: false },
  );

  return (
    <ContractState
      query={query}
      pending={
        <PendingPanel
          title="Revenue and sponsors"
          owner="Agent 4 · TREASURY"
          blurb="Ticket revenue by tier, sponsor revenue by package, committed costs, margin and the delta against the 2025 edition. Also the dynamic pricing radar and the Gold-upgrade upsell candidates. This view already calls revenue.summary."
          lands="Lands with packages/revenue"
        />
      }
    >
      <section className="rounded-lg border border-line bg-surface p-6">
        <p className="text-sm text-ink-muted">
          Gross {(query.data?.grossRevenueCents ?? 0) / 100} {query.data?.currency}
        </p>
      </section>
    </ContractState>
  );
}

export function LiveView({ eventId }: { eventId: string }) {
  const query = api.live.ops.useQuery({ eventId }, { retry: false });

  return (
    <ContractState
      query={query}
      pending={
        <PendingPanel
          title="Live operations"
          owner="Agent 5 · MAÎTRE D'"
          blurb="Arrival rate, queue depth per lane, checked-in against expected, the host companion and the announcement channel. On the night this is the screen nobody looks away from. This view already calls live.ops."
          lands="Lands with apps/live"
        />
      }
    >
      <section className="rounded-lg border border-line bg-surface p-6">
        <p className="text-sm text-ink-muted">Live snapshot loaded.</p>
      </section>
    </ContractState>
  );
}

export function EventPageView({ slug }: { slug: string }) {
  const query = api.page.render.useQuery({ slug, preview: true }, { retry: false });

  return (
    <ContractState
      query={query}
      pending={
        <PendingPanel
          title="The public event page"
          owner="Agent 2 · MAISON"
          blurb="The page a guest actually sees, rendered from Event.theme so an approved theme proposal restyles it with no deploy. Registration, ticket checkout and the waitlist live here too. This view already calls page.render in preview mode."
          lands="Lands with apps/events"
        />
      }
    >
      <section className="rounded-lg border border-line bg-surface p-6">
        <p className="text-sm text-ink-muted">
          {query.data?.sections.length ?? 0} sections rendered.
        </p>
      </section>
    </ContractState>
  );
}
