import "server-only";
import {
  TOOL_RISK,
  agentActionPayloadSchema,
  agentActionSchema,
  changeEventDateInput,
  createTicketTierInput,
  draftEmailsInput,
  draftSponsorOfferInput,
  updateAgendaInput,
  updateEventThemeInput,
  type AgentAction,
  type AgentActionPayload,
  type AgentToolName,
  type SideEffect,
} from "@ovation/core";
import type { Db } from "@ovation/core/db";

/**
 * Proposal construction.
 *
 * THE SAFETY RULE lives here and in ./execute.ts: a tool call may only ever
 * write an AgentAction row with status PROPOSED. Nothing in this file touches
 * an Event, a Guest, a TicketTier, a Sponsor or an EmailMessage — the world is
 * only ever changed from ./execute.ts, and only for an action a human (or the
 * COSMETIC auto-approve gate) has cleared.
 */

export const MUTATING_TOOLS = [
  "update_event_theme",
  "update_agenda",
  "change_event_date",
  "draft_emails",
  "create_ticket_tier",
  "draft_sponsor_offer",
] as const satisfies readonly AgentToolName[];

export type MutatingToolName = (typeof MUTATING_TOOLS)[number];

export function isMutatingTool(name: string): name is MutatingToolName {
  return (MUTATING_TOOLS as readonly string[]).includes(name);
}

/** Extra keys the model may send for presentation. Never enter the payload. */
export interface ProposalMeta {
  summary?: string;
  subject?: string;
  body?: string;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function money(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Validate a raw tool input against the contract schema for that tool.
 * `eventId` is injected server-side — the model never chooses which event it
 * is acting on.
 */
export function buildPayload(
  tool: MutatingToolName,
  raw: unknown,
  eventId: string,
): AgentActionPayload {
  const flat = (raw ?? {}) as Record<string, unknown>;
  const input = { ...flat, eventId };
  switch (tool) {
    case "update_event_theme": {
      // The tool schema is flat (preset, dressCode, ...) because a flat shape
      // is far easier for a model to fill in correctly. The contract nests it
      // under `theme`, so reassemble here.
      const theme =
        flat.theme && typeof flat.theme === "object"
          ? (flat.theme as Record<string, unknown>)
          : dropUndefined({
              preset: flat.preset,
              palette: flat.palette,
              typography: flat.typography,
              dressCode: flat.dressCode,
              heroImage: flat.heroImage,
              notes: flat.notes,
            });
      return {
        type: tool,
        input: updateEventThemeInput.parse({ eventId, theme }),
      };
    }
    case "update_agenda":
      return { type: tool, input: updateAgendaInput.parse(input) };
    case "change_event_date":
      return { type: tool, input: changeEventDateInput.parse(input) };
    case "draft_emails":
      return { type: tool, input: draftEmailsInput.parse(input) };
    case "create_ticket_tier":
      return { type: tool, input: createTicketTierInput.parse(input) };
    case "draft_sponsor_offer":
      return { type: tool, input: draftSponsorOfferInput.parse(input) };
  }
}

function dropUndefined(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null),
  );
}

/** A one-line human summary, used when the model does not supply its own. */
export function defaultSummary(payload: AgentActionPayload): string {
  switch (payload.type) {
    case "update_event_theme": {
      const t = payload.input.theme;
      const bits = [
        t.preset ? `${t.preset} preset` : null,
        t.dressCode ? `dress code “${t.dressCode}”` : null,
      ].filter(Boolean);
      return `Restyle the event page${bits.length ? ` — ${bits.join(", ")}` : ""}`;
    }
    case "update_agenda":
      return `Rewrite the agenda (${payload.input.agenda.items.length} items)`;
    case "change_event_date":
      return `Move the event to ${dateFmt.format(payload.input.date)}`;
    case "draft_emails":
      return `Draft ${payload.input.guestIds.length} ${payload.input.intent.toLowerCase().replace(/_/g, " ")} emails`;
    case "create_ticket_tier":
      return `Open a “${payload.input.name}” tier at ${money(payload.input.priceCents)} (${payload.input.quota} seats)`;
    case "draft_sponsor_offer":
      return `Draft a ${payload.input.targetPackage} offer worth ${money(payload.input.incrementalAmountCents)}`;
  }
}

/**
 * What the organiser is agreeing to. This is what makes a card trustworthy, so
 * knock-on effects are spelled out rather than implied — a date change touches
 * calendar invites, the public page and every confirmed guest.
 */
export async function buildSideEffects(
  db: Db,
  payload: AgentActionPayload,
  meta: ProposalMeta = {},
): Promise<SideEffect[]> {
  const eventId = payload.input.eventId;

  switch (payload.type) {
    case "update_event_theme":
      return [
        {
          label: "Restyles the public event page",
          detail: "Applies the moment it is approved — no redeploy",
          count: 1,
        },
        {
          label: "Changes nothing a guest has already received",
          detail: "Emails already sent keep their original styling",
          count: null,
        },
      ];

    case "update_agenda": {
      const items = payload.input.agenda.items.length;
      const confirmed = await db.guest.count({
        where: { eventId, rsvpStatus: { in: ["CONFIRMED", "CHECKED_IN"] } },
      });
      return [
        { label: "Replaces the published programme", count: items },
        {
          label: "Updates the public page and the live host companion",
          detail: "Guests viewing the agenda see the new running order",
          count: null,
        },
        {
          label: "Guests who may notice the change",
          detail: "No email is sent by this action",
          count: confirmed,
        },
      ];
    }

    case "change_event_date": {
      const [confirmed, invited, orders] = await Promise.all([
        db.guest.count({
          where: { eventId, rsvpStatus: { in: ["CONFIRMED", "CHECKED_IN"] } },
        }),
        db.guest.count({ where: { eventId } }),
        db.order.count({ where: { eventId, status: "PAID" } }),
      ]);
      return [
        {
          label: "Invalidates existing calendar invites",
          detail: "Every confirmed guest holds the old date in their diary",
          count: confirmed,
        },
        {
          label: "Rewrites the public event page",
          detail: "Date, countdown and schedule all shift",
          count: 1,
        },
        {
          label: "Guest emails will need to go out",
          detail: "A re-announcement to the full list, drafted separately",
          count: invited,
        },
        {
          label: "Paid orders are affected",
          detail: "Ticket holders may be entitled to a refund on a date change",
          count: orders,
        },
      ];
    }

    case "draft_emails": {
      const n = payload.input.guestIds.length;
      const effects: SideEffect[] = [
        {
          label: "Queues personalised emails for sending",
          detail: "Written individually, one per guest",
          count: n,
        },
        {
          label: "Nothing leaves the building until you approve",
          detail: "Approving marks them ready to send; no message is sent by the agent",
          count: null,
        },
      ];
      if (meta.subject) {
        effects.push({ label: "Subject line", detail: meta.subject, count: null });
      }
      if (meta.body) {
        effects.push({
          label: "Draft copy",
          detail: meta.body.slice(0, 400),
          count: null,
        });
      }
      return effects;
    }

    case "create_ticket_tier": {
      const sold = await db.order.count({ where: { eventId, status: "PAID" } });
      const event = await db.event.findUnique({
        where: { id: eventId },
        select: { capacity: true, currency: true },
      });
      return [
        {
          label: "Adds a tier to the public ticket table",
          detail: `${payload.input.name} at ${money(payload.input.priceCents, event?.currency ?? "EUR")}`,
          count: 1,
        },
        {
          label: "Increases sellable seats",
          detail: event
            ? `${sold} of ${event.capacity} seats sold before this tier`
            : null,
          count: payload.input.quota,
        },
      ];
    }

    case "draft_sponsor_offer": {
      const sponsor = await db.sponsor.findUnique({
        where: { id: payload.input.sponsorId },
        select: { name: true, package: true, contactEmail: true },
      });
      return [
        {
          label: "Emails the sponsor contact",
          detail: sponsor?.contactEmail ?? "Primary contact on the sponsor record",
          count: 1,
        },
        {
          label: "Moves the sponsor's pipeline state",
          detail: sponsor
            ? `${sponsor.package} → ${payload.input.targetPackage} (OFFERED)`
            : null,
          count: null,
        },
        {
          label: "Commercial commitment if accepted",
          detail: money(payload.input.incrementalAmountCents),
          count: null,
        },
      ];
    }
  }
}

/**
 * The only write a tool call is allowed to make: an AgentAction at PROPOSED.
 *
 * Risk comes from TOOL_RISK in packages/core — the contract's floor. It is
 * never lowered here.
 */
export async function proposeAction(
  db: Db,
  args: {
    tool: MutatingToolName;
    rawInput: unknown;
    eventId: string;
    organisationId: string;
    chatMessageId?: string | null;
    createdById?: string | null;
    meta?: ProposalMeta;
  },
): Promise<AgentAction> {
  const payload = buildPayload(args.tool, args.rawInput, args.eventId);
  const meta = args.meta ?? {};
  const sideEffects = await buildSideEffects(db, payload, meta);

  const row = await db.agentAction.create({
    data: {
      organisationId: args.organisationId,
      eventId: args.eventId,
      type: payload.type,
      summary: meta.summary?.trim() || defaultSummary(payload),
      payload: payload as unknown as object,
      sideEffects: sideEffects as unknown as object,
      status: "PROPOSED",
      risk: TOOL_RISK[payload.type],
      createdBy: "AGENT",
      createdById: args.createdById ?? null,
      chatMessageId: args.chatMessageId ?? null,
    },
  });

  return toAgentAction(row);
}

/** Prisma row → the contract's AgentAction shape. */
export function toAgentAction(row: {
  id: string;
  organisationId: string;
  eventId: string | null;
  type: string;
  summary: string;
  payload: unknown;
  sideEffects: unknown;
  status: string;
  risk: string;
  createdBy: string;
  createdById: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  executedAt: Date | null;
  result: unknown;
  error: string | null;
  chatMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AgentAction {
  return agentActionSchema.parse({
    ...row,
    payload: row.payload ?? {},
    sideEffects: Array.isArray(row.sideEffects) ? row.sideEffects : [],
    result: row.result ?? null,
  });
}

/** Parse a stored payload, so the executor can switch exhaustively. */
export function parsePayload(payload: unknown): AgentActionPayload {
  return agentActionPayloadSchema.parse(payload);
}
