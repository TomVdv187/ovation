import "server-only";
import type { Db } from "@ovation/core/db";
import { eventThemeSchema } from "@ovation/core";

/**
 * State injection.
 *
 * The model is told the event's real numbers and nothing else, in a compact
 * factual block. Everything it can assert about this event comes from here or
 * from a read-only tool result — which is what stops it inventing figures.
 */

export interface AgentContext {
  eventId: string;
  organisationId: string;
  organisationName: string;
  autoApproveCosmetic: boolean;
  currency: string;
  stateBlock: string;
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export async function buildAgentContext(
  db: Db,
  eventId: string,
): Promise<AgentContext> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: { organisation: true },
  });
  if (!event) throw new Error("Event not found.");

  const [
    guestTotal,
    byRsvp,
    byRisk,
    tiers,
    paid,
    sponsors,
    costs,
    pendingApprovals,
  ] = await Promise.all([
    db.guest.count({ where: { eventId } }),
    db.guest.groupBy({ by: ["rsvpStatus"], where: { eventId }, _count: true }),
    db.guest.groupBy({ by: ["noShowRisk"], where: { eventId }, _count: true }),
    db.ticketTier.findMany({
      where: { eventId },
      orderBy: { sortOrder: "asc" },
      select: { name: true, priceCents: true, sold: true, quota: true, status: true },
    }),
    db.order.aggregate({
      where: { eventId, status: "PAID" },
      _sum: { amountCents: true },
      _count: true,
    }),
    db.sponsor.findMany({
      where: { eventId },
      select: {
        id: true,
        name: true,
        package: true,
        amountCents: true,
        status: true,
        engagementScore: true,
      },
    }),
    db.costEntry.aggregate({ where: { eventId }, _sum: { amountCents: true } }),
    db.agentAction.count({ where: { eventId, status: "PROPOSED" } }),
  ]);

  const settings = (event.organisation.settings ?? {}) as Record<string, unknown>;
  const autoApproveCosmetic = settings.autoApproveCosmetic === true;
  const currency = event.currency;

  const theme = eventThemeSchema.parse(
    typeof event.theme === "object" && event.theme !== null ? event.theme : {},
  );
  const agendaItems = Array.isArray(
    (event.agenda as { items?: unknown } | null)?.items,
  )
    ? ((event.agenda as { items: { title: string; startsAt: string; kind?: string }[] })
        .items ?? [])
    : [];

  const count = (rows: { _count: number }[], key: string, field: string) =>
    (rows as unknown as Record<string, unknown>[]).find((r) => r[field] === key)
      ?._count ?? 0;

  const euros = (cents: number) =>
    new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const ticketRevenue = paid._sum.amountCents ?? 0;
  const sponsorRevenue = sponsors
    .filter((s) => s.status === "SIGNED" || s.status === "SERVICED")
    .reduce((a, s) => a + s.amountCents, 0);
  const costTotal = costs._sum.amountCents ?? 0;

  const stateBlock = [
    "<event_state>",
    `Today: ${fmtDate(new Date())}`,
    `Organisation: ${event.organisation.name}`,
    `Event: ${event.title} (id ${event.id}, slug ${event.slug})`,
    `Status: ${event.status}`,
    `Date: ${fmtDate(event.date)} at ${event.date.toISOString().slice(11, 16)} UTC${
      event.endsAt ? ` — ends ${fmtDate(event.endsAt)}` : ""
    }`,
    `Timezone: ${event.timezone}`,
    `Venue: ${event.venue}${event.venueAddress ? `, ${event.venueAddress}` : ""}`,
    `Capacity: ${event.capacity}`,
    `Theme: preset=${theme.preset}${theme.dressCode ? `, dress code=${theme.dressCode}` : ""}`,
    "",
    `Guests: ${guestTotal} total`,
    `  confirmed ${count(byRsvp, "CONFIRMED", "rsvpStatus")}, invited ${count(byRsvp, "INVITED", "rsvpStatus")}, waitlisted ${count(byRsvp, "WAITLISTED", "rsvpStatus")}, declined ${count(byRsvp, "DECLINED", "rsvpStatus")}`,
    `  no-show risk: high ${count(byRisk, "HIGH", "noShowRisk")}, medium ${count(byRisk, "MEDIUM", "noShowRisk")}, low ${count(byRisk, "LOW", "noShowRisk")}`,
    "",
    "Ticket tiers:",
    ...tiers.map(
      (t) =>
        `  ${t.name} — ${euros(t.priceCents)}, ${t.sold}/${t.quota} sold, ${t.status}`,
    ),
    `Ticket revenue (paid orders): ${euros(ticketRevenue)} across ${paid._count} orders`,
    "",
    "Sponsors:",
    ...sponsors.map(
      (s) =>
        `  ${s.name} (id ${s.id}) — ${s.package}, ${euros(s.amountCents)}, ${s.status}, engagement ${s.engagementScore}/100`,
    ),
    `Sponsor revenue (signed): ${euros(sponsorRevenue)}`,
    `Committed costs: ${euros(costTotal)}`,
    `Margin: ${euros(ticketRevenue + sponsorRevenue - costTotal)}`,
    "",
    `Agenda (${agendaItems.length} items):`,
    ...agendaItems
      .slice(0, 12)
      .map((i) => `  ${String(i.startsAt).slice(11, 16)} ${i.title}${i.kind ? ` [${i.kind}]` : ""}`),
    "",
    `Proposals awaiting the organiser: ${pendingApprovals}`,
    `Organisation setting autoApproveCosmetic: ${autoApproveCosmetic}`,
    "</event_state>",
  ].join("\n");

  return {
    eventId: event.id,
    organisationId: event.organisationId,
    organisationName: event.organisation.name,
    autoApproveCosmetic,
    currency,
    stateBlock,
  };
}

export function systemPrompt(ctx: AgentContext): string {
  return `You are the event director for ${ctx.organisationName}: elite, unflappable, and known for catching the thing nobody else did. You run this event's operations through the OVATION console.

HOW YOU WORK

You do not change anything yourself. Every mutating tool you call becomes a proposal card in the organiser's chat, which they approve or reject. Say so plainly ("I've put that up for your approval"), never "I've done that". The read-only tools, get_no_show_risks and get_budget_summary, answer immediately and create no card.

GROUNDING. This is the rule you never bend.

Every number, name, date and id you state must come from <event_state> below, or from a tool result in this conversation. If you do not have a figure, say so and offer to fetch it. Never estimate a revenue number. Never invent a guest id or a sponsor id. Never round a real figure into a nicer one. Money is in minor units when you pass it to a tool, so 175 euro is 17500.

When you need specific guests, for an email campaign or a recovery push or a VIP list, call get_no_show_risks first and use the ids it returns. Guest ids are never guessable.

WHEN YOU PROPOSE

Give every proposal a summary written for a busy organiser: what changes, and the number that matters.
Be decisive. If the organiser says "make it black-tie", propose the theme change; do not ask which shade of black.
Ask a clarifying question only when a wrong guess would be expensive and you genuinely cannot infer the answer.
One turn may raise several proposals when the request needs them, but do not pad.

WHAT THE ORGANISER IS AGREEING TO

Some proposals are heavier than others, and your reply must reflect that.

Moving the date is destructive. Calendar invites already sitting in diaries become wrong, the public page changes under people who have seen it, every guest needs telling, and paid ticket holders may be owed a refund. Spell that out.

Emails and sponsor offers leave the building. They can never be auto-approved, whatever the organisation's settings say. Nothing is sent until the organiser approves, and even then the console only marks the copy ready. You do not send.

Theme changes are cosmetic and reversible. Treat them lightly.

TONE

Short paragraphs. No bullet-point soup, no filler, no restating the request back at the organiser. Understated, precise, warm. Use the euro sign and write dates as "24 September 2026".

${ctx.stateBlock}`;
}

/**
 * Read-only tools. These query and answer inline — they create no AgentAction
 * and mutate nothing.
 */
export async function runReadOnlyTool(
  db: Db,
  tool: "get_no_show_risks" | "get_budget_summary",
  raw: unknown,
  eventId: string,
): Promise<unknown> {
  const args = (raw ?? {}) as Record<string, unknown>;

  if (tool === "get_no_show_risks") {
    const minRisk =
      args.minRisk === "LOW" || args.minRisk === "HIGH" ? args.minRisk : "MEDIUM";
    const include =
      minRisk === "LOW"
        ? (["LOW", "MEDIUM", "HIGH"] as const)
        : minRisk === "MEDIUM"
          ? (["MEDIUM", "HIGH"] as const)
          : (["HIGH"] as const);
    const limit = Math.min(
      Math.max(typeof args.limit === "number" ? args.limit : 20, 1),
      100,
    );

    const guests = await db.guest.findMany({
      where: {
        eventId,
        noShowRisk: { in: [...include] },
        rsvpStatus: { notIn: ["DECLINED", "CHECKED_IN", "NO_SHOW"] },
      },
      orderBy: [{ noShowProbability: "desc" }, { engagementScore: "asc" }],
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        segment: true,
        rsvpStatus: true,
        noShowRisk: true,
        noShowProbability: true,
        engagementScore: true,
      },
    });

    return {
      note: "Deterministic scores from the guest records. packages/guests will replace this engine in Phase 3; the shape will not change.",
      count: guests.length,
      guests: guests.map((g) => ({
        guestId: g.id,
        name: g.name,
        company: g.company,
        segment: g.segment,
        rsvpStatus: g.rsvpStatus,
        noShowRisk: g.noShowRisk,
        noShowProbability: g.noShowProbability,
        engagementScore: g.engagementScore,
      })),
    };
  }

  const [tiers, paid, sponsors, costs, event] = await Promise.all([
    db.ticketTier.findMany({
      where: { eventId },
      select: { name: true, priceCents: true, sold: true, quota: true, status: true },
    }),
    db.order.aggregate({
      where: { eventId, status: "PAID" },
      _sum: { amountCents: true },
      _count: true,
    }),
    db.sponsor.findMany({
      where: { eventId },
      select: { name: true, package: true, amountCents: true, status: true },
    }),
    db.costEntry.groupBy({
      by: ["category"],
      where: { eventId },
      _sum: { amountCents: true },
    }),
    db.event.findUnique({ where: { id: eventId }, select: { currency: true } }),
  ]);

  const ticketCents = paid._sum.amountCents ?? 0;
  const sponsorCents = sponsors
    .filter((s) => s.status === "SIGNED" || s.status === "SERVICED")
    .reduce((a, s) => a + s.amountCents, 0);
  const costCents = costs.reduce((a, c) => a + (c._sum.amountCents ?? 0), 0);
  const gross = ticketCents + sponsorCents;

  return {
    note: "Computed from paid orders, signed sponsors and committed costs. revenue.summary (packages/revenue) is the canonical source once Agent 4 lands.",
    currency: event?.currency ?? "EUR",
    ticketsCents: ticketCents,
    ticketOrders: paid._count,
    tiers,
    sponsorsCents: sponsorCents,
    sponsors,
    costsCents: costCents,
    costsByCategory: costs.map((c) => ({
      category: c.category,
      amountCents: c._sum.amountCents ?? 0,
    })),
    grossRevenueCents: gross,
    marginCents: gross - costCents,
  };
}
