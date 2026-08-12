/**
 * revenue router — the real implementation of the @ovation/core contract.
 *
 * Signatures are identical to packages/core/src/trpc/routers/revenue.ts; only
 * the bodies differ. Agent 7 · CRITIC mounts this in the console.
 *
 * ── The safety contract, as it applies here ──────────────────────────────
 * Nothing in this file opens a ticket tier, changes a price, moves a sponsor
 * down the pipeline, or sends an email. Pricing rules produce AgentActions
 * with status PROPOSED; sponsor reports produce EmailMessages with status
 * PROPOSED. `agent.approve` is the only path to execution, and it belongs to
 * someone else. No email provider and no payment provider is imported here.
 */
import { TRPCError } from "@trpc/server";
import {
  TOOL_RISK,
  evaluateAutoOpenRulesInput,
  evaluateAutoOpenRulesOutput,
  orgProcedure,
  pricingSuggestionsInput,
  pricingSuggestionsOutput,
  requiresApproval,
  revenueSummaryInput,
  revenueSummaryOutput,
  router,
  sponsorListInput,
  sponsorListOutput,
  sponsorRoiReportInput,
  sponsorRoiReportOutput,
  sponsorSchema,
  sponsorUpsellCandidatesInput,
  sponsorUpsellCandidatesOutput,
} from "@ovation/core";
import type { Context, Db } from "./context";
import { formatMoney } from "./money";
import { describeRuleHit, evaluateAutoOpenRules, type TierSnapshot } from "./pricing/rules";
import { buildPricingSuggestions } from "./pricing/suggestions";
import { buildRevenueSummary, pickPreviousEdition, type EditionFacts } from "./summary";
import { matchTargetAccounts, unmatchedTargetAccounts, type GuestFacts } from "./sponsors/match";
import { parseEntitlements } from "./sponsors/packages";
import { buildRoiReport, isoWeekKey, parseRoiStats } from "./sponsors/roi";
import { renderSponsorRoiEmail, sponsorRoiSubject } from "./sponsors/report-html";
import {
  draftGoldOffer,
  findUpsellCandidates,
  type SponsorFacts,
  type UpsellCandidate,
} from "./sponsors/upsell";

/** Marks the AgentActions this engine owns, so a cron does not duplicate them. */
const RULE_SOURCE = "revenue.auto_open_rule";
const OFFER_SOURCE = "revenue.upsell_radar";

// ── shared helpers ──────────────────────────────────────────────────────

function organisationId(ctx: Context): string {
  const id = ctx.session?.user.organisationId;
  if (!id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User is not attached to an organisation.",
    });
  }
  return id;
}

/**
 * Fetch an event scoped to the caller's organisation. Every query in this
 * router goes through an organisation-scoped `where` — a valid event id from
 * another tenant must read as "not found", not as data.
 */
async function requireEvent(db: Db, orgId: string, eventId: string) {
  const event = await db.event.findFirst({
    where: { id: eventId, organisationId: orgId },
    select: {
      id: true,
      organisationId: true,
      title: true,
      date: true,
      currency: true,
      capacity: true,
      pageVisits: true,
    },
  });
  if (!event) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Event ${eventId} not found.` });
  }
  return event;
}

async function autoApproveCosmetic(db: Db, orgId: string): Promise<boolean> {
  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const settings = org?.settings as { autoApproveCosmetic?: unknown } | null;
  return settings?.autoApproveCosmetic === true;
}

function asGuestFacts(rows: { id: string; name: string; company: string | null }[]): GuestFacts[] {
  return rows.map((row) => ({ id: row.id, name: row.name, company: row.company }));
}

// ── the rule engine, usable from a queue worker as well as tRPC ─────────

export interface SweepResult {
  fired: {
    tierId: string;
    tierName: string;
    rule: ReturnType<typeof evaluateAutoOpenRules>[number]["rule"];
    agentActionId: string | null;
  }[];
}

/**
 * Evaluate every autoOpenRule on an event and propose the tiers that want to
 * open. Exported so a cron/queue entry point can call it without a tRPC
 * context; the mutation below is a thin wrapper.
 *
 * NEVER creates a TicketTier. The most it does is write one AgentAction with
 * status PROPOSED per rule that fired.
 */
export async function sweepAutoOpenRules(
  db: Db,
  args: { eventId: string; organisationId: string; dryRun: boolean; now?: Date },
): Promise<SweepResult> {
  const event = await requireEvent(db, args.organisationId, args.eventId);

  const tiers = await db.ticketTier.findMany({
    where: { eventId: event.id },
    select: {
      id: true,
      name: true,
      priceCents: true,
      quota: true,
      sold: true,
      status: true,
      autoOpenRule: true,
    },
  });

  const snapshots: TierSnapshot[] = tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    priceCents: tier.priceCents,
    quota: tier.quota,
    sold: tier.sold,
    status: tier.status,
    autoOpenRule: tier.autoOpenRule,
  }));

  const hits = evaluateAutoOpenRules({
    tiers: snapshots,
    now: args.now ?? new Date(),
    currency: event.currency,
  });

  if (hits.length === 0) return { fired: [] };

  // A cron runs this every few minutes. Suppress rules we have already
  // proposed and that are still waiting on the organiser — but only OUR
  // proposals: an action a human or another agent wrote is not ours to
  // deduplicate against.
  const open = await db.agentAction.findMany({
    where: { eventId: event.id, type: "create_ticket_tier", status: "PROPOSED" },
    select: { id: true, payload: true },
  });
  const alreadyProposed = new Map<string, string>();
  for (const action of open) {
    const payload = action.payload as { source?: unknown; ruleTierId?: unknown } | null;
    if (payload?.source === RULE_SOURCE && typeof payload.ruleTierId === "string") {
      alreadyProposed.set(payload.ruleTierId, action.id);
    }
  }

  // The gate. create_ticket_tier has an OPERATIONAL risk floor, and
  // requiresApproval() never exempts OPERATIONAL — so this engine can only
  // ever propose, even for a rule carrying autoFire: true. We call the helper
  // rather than restating the rule, and fail closed if it ever stops holding.
  const risk = TOOL_RISK.create_ticket_tier;
  const autoApprove = await autoApproveCosmetic(db, event.organisationId);
  if (!requiresApproval(risk, autoApprove)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Refusing to open a ticket tier from a rule: the approval gate no longer requires approval for OPERATIONAL actions.",
    });
  }

  const fired: SweepResult["fired"] = [];

  for (const hit of hits) {
    const existing = alreadyProposed.get(hit.tierId);
    if (existing) {
      fired.push({ ...hit, agentActionId: existing });
      continue;
    }

    if (args.dryRun) {
      fired.push({ ...hit, agentActionId: null });
      continue;
    }

    const target = hit.rule.then.openTier;
    const action = await db.agentAction.create({
      data: {
        organisationId: event.organisationId,
        eventId: event.id,
        type: "create_ticket_tier",
        summary: describeRuleHit(hit, event.currency),
        payload: {
          type: "create_ticket_tier",
          input: {
            eventId: event.id,
            name: target.name,
            priceCents: target.priceCents,
            quota: target.quota,
          },
          // Provenance for this engine's own deduplication. The executor reads
          // `input`; these two keys are inert to it.
          source: RULE_SOURCE,
          ruleTierId: hit.tierId,
        },
        sideEffects: [
          {
            label: "Adds a public ticket tier",
            count: 1,
            detail: `${target.name} at ${formatMoney(target.priceCents, event.currency)}, ${target.quota} seats`,
          },
          { label: "Triggered by", detail: hit.reason },
        ],
        status: "PROPOSED",
        risk,
        createdBy: "AGENT",
      },
      select: { id: true },
    });

    fired.push({ ...hit, agentActionId: action.id });
  }

  return { fired };
}

// ── the router ──────────────────────────────────────────────────────────

export const revenueRouter = router({
  /**
   * One query, dashboard-ready: tickets + sponsors - costs, with the delta.
   *
   * Literally one round trip. Editions are fetched together and reduced in
   * memory — there is no per-tier, per-sponsor or per-cost query anywhere in
   * this procedure, because the console renders it on every Overview load.
   */
  summary: orgProcedure
    .input(revenueSummaryInput)
    .output(revenueSummaryOutput)
    .query(async ({ ctx, input }) => {
      const orgId = organisationId(ctx);

      // When comparing, we also pull the organisation's completed editions in
      // the same statement. An organisation runs a handful of editions, so
      // this stays a bounded read — and it keeps the whole summary to one
      // query rather than a lookup followed by a second, dependent one.
      const editions = await ctx.db.event.findMany({
        where: input.compareToPreviousEdition
          ? { organisationId: orgId, OR: [{ id: input.eventId }, { status: "COMPLETED" }] }
          : { organisationId: orgId, id: input.eventId },
        select: {
          id: true,
          date: true,
          status: true,
          currency: true,
          capacity: true,
          ticketTiers: {
            select: {
              id: true,
              name: true,
              priceCents: true,
              quota: true,
              sold: true,
              sortOrder: true,
            },
          },
          sponsors: { select: { package: true, amountCents: true, status: true } },
          costs: { select: { category: true, amountCents: true, committed: true } },
        },
        orderBy: { date: "desc" },
      });

      const current = editions.find((edition) => edition.id === input.eventId);
      if (!current) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Event ${input.eventId} not found.`,
        });
      }

      const toFacts = (edition: (typeof editions)[number]): EditionFacts => ({
        id: edition.id,
        currency: edition.currency,
        capacity: edition.capacity,
        tiers: edition.ticketTiers,
        sponsors: edition.sponsors,
        costs: edition.costs,
      });

      const previous = input.compareToPreviousEdition
        ? pickPreviousEdition(current, editions)
        : null;

      return buildRevenueSummary(toFacts(current), previous ? toFacts(previous) : null);
    }),

  /**
   * Sell-out forecasts and what to do about them, from observed sales
   * velocity. Read-only: suggestions are advice, not proposals.
   */
  pricingSuggestions: orgProcedure
    .input(pricingSuggestionsInput)
    .output(pricingSuggestionsOutput)
    .query(async ({ ctx, input }) => {
      const orgId = organisationId(ctx);
      const event = await requireEvent(ctx.db, orgId, input.eventId);

      const [tiers, orders] = await Promise.all([
        ctx.db.ticketTier.findMany({
          where: { eventId: event.id },
          select: {
            id: true,
            name: true,
            priceCents: true,
            quota: true,
            sold: true,
            status: true,
            autoOpenRule: true,
          },
        }),
        ctx.db.order.findMany({
          where: { eventId: event.id, status: "PAID" },
          select: { tierId: true, createdAt: true },
        }),
      ]);

      return buildPricingSuggestions({
        tiers: tiers.map((tier) => ({
          id: tier.id,
          name: tier.name,
          priceCents: tier.priceCents,
          quota: tier.quota,
          sold: tier.sold,
          status: tier.status,
          autoOpenRule: tier.autoOpenRule,
        })),
        sales: orders.map((order) => ({ tierId: order.tierId, at: order.createdAt })),
        capacity: event.capacity,
        eventDate: event.date,
        now: new Date(),
        currency: event.currency,
      });
    }),

  /**
   * Cron/queue entry point. Firing a rule emits an AgentAction PROPOSED —
   * and never creates the tier itself.
   */
  evaluateAutoOpenRules: orgProcedure
    .input(evaluateAutoOpenRulesInput)
    .output(evaluateAutoOpenRulesOutput)
    .mutation(async ({ ctx, input }) => {
      const orgId = organisationId(ctx);
      return sweepAutoOpenRules(ctx.db, {
        eventId: input.eventId,
        organisationId: orgId,
        dryRun: input.dryRun,
      });
    }),

  /** Sponsor CRM: the pipeline, with entitlements and ROI parsed out of JSON. */
  sponsors: orgProcedure
    .input(sponsorListInput)
    .output(sponsorListOutput)
    .query(async ({ ctx, input }) => {
      const orgId = organisationId(ctx);
      const event = await requireEvent(ctx.db, orgId, input.eventId);

      const rows = await ctx.db.sponsor.findMany({
        where: {
          eventId: event.id,
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: [{ amountCents: "desc" }, { name: "asc" }],
      });

      return {
        items: rows.map((row) =>
          sponsorSchema.parse({
            ...row,
            entitlements: parseEntitlements(row.entitlements),
            roiStats: parseRoiStats(row.roiStats),
          }),
        ),
      };
    }),

  /**
   * Upsell radar. Silver sponsors past the engagement threshold get a drafted
   * Gold offer, grounded strictly in `evidence`.
   *
   * NOTE: the contract types this as a query, but the drafted copy has nowhere
   * to live except an AgentAction, so this writes one. The write is idempotent
   * — a second call returns the same action id and does not re-draft — but a
   * mutation would be the honest shape. See CONTRACT_CHANGES.md, CC-001.
   */
  sponsorUpsellCandidates: orgProcedure
    .input(sponsorUpsellCandidatesInput)
    .output(sponsorUpsellCandidatesOutput)
    .query(async ({ ctx, input }) => {
      const orgId = organisationId(ctx);
      const event = await requireEvent(ctx.db, orgId, input.eventId);

      const [sponsorRows, guestRows, openOffers] = await Promise.all([
        ctx.db.sponsor.findMany({ where: { eventId: event.id } }),
        ctx.db.guest.findMany({
          where: { eventId: event.id },
          select: { id: true, name: true, company: true },
        }),
        ctx.db.agentAction.findMany({
          where: { eventId: event.id, type: "draft_sponsor_offer", status: "PROPOSED" },
          select: { id: true, payload: true },
        }),
      ]);

      const guests = asGuestFacts(guestRows);
      const sponsors: SponsorFacts[] = sponsorRows.map((row) => ({
        id: row.id,
        name: row.name,
        package: row.package,
        amountCents: row.amountCents,
        status: row.status,
        contactName: row.contactName,
        entitlements: row.entitlements,
        roiStats: row.roiStats,
        engagementScore: row.engagementScore,
        targetAccounts: row.targetAccounts,
      }));

      const leadsBySponsor = new Map(
        sponsors.map((sponsor) => [
          sponsor.id,
          matchTargetAccounts(sponsor.targetAccounts, guests),
        ]),
      );
      const activityBySponsor = new Map(
        sponsors.map((sponsor) => {
          const stats = parseRoiStats(sponsor.roiStats);
          return [
            sponsor.id,
            {
              reportOpens: stats.reportOpens,
              benefitsPageClicks: stats.benefitsPageClicks,
              meetings: stats.meetings,
            },
          ];
        }),
      );

      const candidates = findUpsellCandidates({
        sponsors,
        threshold: input.threshold,
        currency: event.currency,
        eventTitle: event.title,
        eventDate: event.date,
        leadsBySponsor,
        activityBySponsor,
      });

      // Reuse an offer this radar already proposed rather than drafting a
      // second one on every dashboard load.
      const existingBySponsor = new Map<string, string>();
      for (const action of openOffers) {
        const payload = action.payload as
          | { source?: unknown; input?: { sponsorId?: unknown; targetPackage?: unknown } }
          | null;
        const sponsorId = payload?.input?.sponsorId;
        if (
          payload?.source === OFFER_SOURCE &&
          typeof sponsorId === "string" &&
          payload.input?.targetPackage === "GOLD"
        ) {
          existingBySponsor.set(sponsorId, action.id);
        }
      }

      const results = [];
      for (const candidate of candidates) {
        const existing = existingBySponsor.get(candidate.sponsorId);
        const agentActionId =
          existing ??
          (await proposeGoldOffer(ctx.db, {
            candidate,
            eventId: event.id,
            organisationId: event.organisationId,
            eventTitle: event.title,
            currency: event.currency,
          }));

        results.push({
          sponsorId: candidate.sponsorId,
          name: candidate.name,
          currentPackage: candidate.currentPackage,
          suggestedPackage: candidate.suggestedPackage,
          incrementalAmountCents: candidate.incrementalAmountCents,
          engagementScore: candidate.engagementScore,
          evidence: candidate.evidence,
          agentActionId,
        });
      }

      return { candidates: results };
    }),

  /**
   * Weekly per-sponsor ROI report, rendered as email-ready HTML and queued as
   * an EmailMessage with status PROPOSED. We never send.
   */
  sponsorRoiReport: orgProcedure
    .input(sponsorRoiReportInput)
    .output(sponsorRoiReportOutput)
    .mutation(async ({ ctx, input }) => {
      const orgId = organisationId(ctx);
      const event = await requireEvent(ctx.db, orgId, input.eventId);

      const [sponsorRows, guestRows] = await Promise.all([
        ctx.db.sponsor.findMany({
          where: {
            eventId: event.id,
            ...(input.sponsorId ? { id: input.sponsorId } : {}),
          },
          orderBy: [{ amountCents: "desc" }, { name: "asc" }],
        }),
        ctx.db.guest.findMany({
          where: { eventId: event.id },
          select: { id: true, name: true, company: true },
        }),
      ]);

      if (input.sponsorId && sponsorRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Sponsor ${input.sponsorId} not found on event ${event.id}.`,
        });
      }

      const guests = asGuestFacts(guestRows);
      const periodLabel = isoWeekKey(new Date());
      const campaignId = `sponsor-roi-${event.id}-${periodLabel}`;

      const reports = [];

      for (const sponsor of sponsorRows) {
        const entitlements = parseEntitlements(sponsor.entitlements);
        const matchedLeads = matchTargetAccounts(sponsor.targetAccounts, guests);
        const report = buildRoiReport({
          storedStats: sponsor.roiStats,
          entitlements,
          engagementScore: sponsor.engagementScore,
          pageVisits: event.pageVisits,
          matchedLeads,
        });

        const html = renderSponsorRoiEmail({
          sponsorName: sponsor.name,
          sponsorPackage: sponsor.package,
          amountCents: sponsor.amountCents,
          currency: sponsor.currency,
          eventTitle: event.title,
          eventDate: event.date,
          periodLabel,
          stats: report.stats,
          renewal: report.renewal,
          entitlements,
          matchedLeads,
          unmatchedAccounts: unmatchedTargetAccounts(sponsor.targetAccounts, matchedLeads),
          pageVisits: event.pageVisits,
          impressionMultiplier: report.impressionMultiplier,
          contactName: sponsor.contactName,
        });

        const subject = sponsorRoiSubject({
          sponsorName: sponsor.name,
          eventTitle: event.title,
          periodLabel,
        });

        // One report per sponsor per ISO week. Re-running refreshes the draft
        // instead of stacking duplicates in the approval queue.
        const existing = await ctx.db.emailMessage.findFirst({
          where: {
            eventId: event.id,
            sponsorId: sponsor.id,
            kind: "SPONSOR_REPORT",
            status: "PROPOSED",
            campaignId,
          },
          select: { id: true },
        });

        const email = existing
          ? await ctx.db.emailMessage.update({
              where: { id: existing.id },
              data: { subject, body: html },
              select: { id: true },
            })
          : await ctx.db.emailMessage.create({
              data: {
                eventId: event.id,
                sponsorId: sponsor.id,
                kind: "SPONSOR_REPORT",
                subject,
                body: html,
                personalised: true,
                status: "PROPOSED",
                campaignId,
              },
              select: { id: true },
            });

        reports.push({
          sponsorId: sponsor.id,
          name: sponsor.name,
          stats: report.stats,
          matchedLeads: matchedLeads.map((lead) => ({
            guestId: lead.guestId,
            name: lead.name,
            company: lead.company,
          })),
          html,
          emailMessageId: email.id,
        });
      }

      return { reports };
    }),
});

/** Draft and propose a Gold upgrade. Returns the AgentAction id. */
async function proposeGoldOffer(
  db: Db,
  args: {
    candidate: UpsellCandidate;
    eventId: string;
    organisationId: string;
    eventTitle: string;
    currency: string;
  },
): Promise<string> {
  const { candidate } = args;
  const offer = await draftGoldOffer(candidate, args.eventTitle, args.currency);

  // draft_sponsor_offer carries an OUTBOUND risk floor, which requiresApproval
  // never exempts under any organisation setting.
  const risk = TOOL_RISK.draft_sponsor_offer;
  if (!requiresApproval(risk, true)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Refusing to draft a sponsor offer: the approval gate is not holding.",
    });
  }

  const action = await db.agentAction.create({
    data: {
      organisationId: args.organisationId,
      eventId: args.eventId,
      type: "draft_sponsor_offer",
      summary: `Pitch ${candidate.name} a ${candidate.suggestedPackage} upgrade (+${formatMoney(candidate.incrementalAmountCents, args.currency)})`,
      payload: {
        type: "draft_sponsor_offer",
        input: {
          eventId: args.eventId,
          sponsorId: candidate.sponsorId,
          targetPackage: "GOLD",
          incrementalAmountCents: candidate.incrementalAmountCents,
        },
        source: OFFER_SOURCE,
        // The copy and the facts it is allowed to contain, side by side, so a
        // reviewer can check every claim against the evidence that produced it.
        offer: { subject: offer.subject, body: offer.body, writtenBy: offer.source },
        evidence: candidate.evidence,
      },
      sideEffects: [
        { label: "Emails the sponsor contact", count: 1 },
        { label: "Moves pipeline state", detail: "SIGNED → OFFERED" },
        {
          label: "Increases sponsor revenue",
          detail: `${formatMoney(candidate.currentAmountCents, args.currency)} → ${formatMoney(candidate.targetAmountCents, args.currency)}`,
        },
      ],
      status: "PROPOSED",
      risk,
      createdBy: "AGENT",
    },
    select: { id: true },
  });

  return action.id;
}
