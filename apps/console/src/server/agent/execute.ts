import "server-only";
import {
  eventThemeSchema,
  requiresApproval,
  type AgentActionPayload,
  type ActionRiskT,
  type AgentActionStatusT,
  type JsonValue,
  type SideEffect,
} from "@ovation/core";
import type { Db } from "@ovation/core/db";
import { parsePayload } from "./actions";

/**
 * THE ONLY CODE PATH IN THE APPLICATION ALLOWED TO CAUSE A SIDE EFFECT.
 *
 * Nothing else — not a tool call, not a router, not the chat UI — may write to
 * an Event, Guest, TicketTier, Sponsor or EmailMessage. Everything arrives here
 * as an AgentAction a human approved, or one the COSMETIC auto-approve gate
 * cleared, and each executes in a single transaction: the status flips to
 * EXECUTED and the mutation lands together, or neither does.
 *
 * The agent still sends no email. `draft_emails` and `draft_sponsor_offer`
 * write EmailMessage rows at APPROVED — ready for a sender that does not exist
 * in Phase 2. No row ever reaches SENT from this file.
 */

export interface ExecutionOutcome {
  actionId: string;
  status: AgentActionStatusT;
  result: JsonValue | null;
  error: string | null;
}

export type ApprovalSource =
  /** An organiser pressed Approve. The gate has already been satisfied. */
  | { kind: "HUMAN"; userId: string }
  /** The agent turn itself, gated by `requiresApproval` from packages/core. */
  | { kind: "AUTO"; autoApproveCosmetic: boolean };

/** Risks that no organisation setting may ever wave through. */
const NEVER_AUTO: readonly ActionRiskT[] = ["OUTBOUND", "DESTRUCTIVE"];

export async function executeApprovedActions(
  db: Db,
  actionIds: string[],
  source: ApprovalSource,
  patch?: unknown,
): Promise<ExecutionOutcome[]> {
  const outcomes: ExecutionOutcome[] = [];
  for (const actionId of actionIds) {
    outcomes.push(await executeOne(db, actionId, source, patch));
  }
  return outcomes;
}

async function executeOne(
  db: Db,
  actionId: string,
  source: ApprovalSource,
  patch?: unknown,
): Promise<ExecutionOutcome> {
  const existing = await db.agentAction.findUnique({ where: { id: actionId } });
  if (!existing) {
    return {
      actionId,
      status: "FAILED",
      result: null,
      error: "Action not found.",
    };
  }

  if (existing.status !== "PROPOSED" && existing.status !== "APPROVED") {
    // Idempotent: approving an already-decided action is a no-op, not a crash.
    return {
      actionId,
      status: existing.status,
      result: (existing.result as JsonValue | null) ?? null,
      error:
        existing.status === "EXECUTED"
          ? null
          : `Action is ${existing.status}; nothing to execute.`,
    };
  }

  const risk = existing.risk as ActionRiskT;

  if (source.kind === "AUTO") {
    // The single gate, called — never reimplemented. OUTBOUND and DESTRUCTIVE
    // return true here regardless of the organisation setting.
    if (requiresApproval(risk, source.autoApproveCosmetic)) {
      return {
        actionId,
        status: "PROPOSED",
        result: null,
        error: null,
      };
    }
    // Belt and braces: if `requiresApproval` were ever weakened, this still
    // refuses to let anything outbound or destructive skip a human.
    if (NEVER_AUTO.includes(risk)) {
      return {
        actionId,
        status: "PROPOSED",
        result: null,
        error: null,
      };
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // Re-read inside the transaction so two concurrent approvals cannot both
      // execute the same proposal.
      const row = await tx.agentAction.findUnique({ where: { id: actionId } });
      if (!row || (row.status !== "PROPOSED" && row.status !== "APPROVED")) {
        throw new Error("Action was already decided.");
      }

      const payload = parsePayload(applyPatch(row.payload, patch));
      const sideEffects = Array.isArray(row.sideEffects)
        ? (row.sideEffects as unknown as SideEffect[])
        : [];

      const mutationResult = await performMutation(tx, payload, sideEffects);

      await tx.agentAction.update({
        where: { id: actionId },
        data: {
          status: "EXECUTED",
          approvedBy:
            source.kind === "HUMAN" ? source.userId : "auto-approve:COSMETIC",
          approvedAt: new Date(),
          executedAt: new Date(),
          result: mutationResult as unknown as object,
          error: null,
          ...(patch !== undefined ? { payload: payload as unknown as object } : {}),
        },
      });

      return mutationResult;
    });

    return { actionId, status: "EXECUTED", result, error: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Execution failed.";
    // The transaction rolled back, so the world is untouched. Record why.
    await db.agentAction.update({
      where: { id: actionId },
      data: { status: "FAILED", error: message },
    });
    return { actionId, status: "FAILED", result: null, error: message };
  }
}

/** Organiser tweaks to the payload before executing (agent.approve `patch`). */
function applyPatch(payload: unknown, patch: unknown): unknown {
  if (patch === undefined || patch === null) return payload;
  if (typeof patch !== "object" || Array.isArray(patch)) return payload;
  const base = (payload ?? {}) as Record<string, unknown>;
  const p = patch as Record<string, unknown>;
  return {
    ...base,
    input: {
      ...((base.input as Record<string, unknown>) ?? {}),
      ...((p.input as Record<string, unknown>) ?? p),
    },
  };
}

type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

async function performMutation(
  tx: Tx,
  payload: AgentActionPayload,
  sideEffects: SideEffect[],
): Promise<JsonValue> {
  switch (payload.type) {
    case "update_event_theme": {
      const { eventId, theme } = payload.input;
      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { theme: true },
      });
      if (!event) throw new Error("Event not found.");

      const current = eventThemeSchema.parse(
        typeof event.theme === "object" && event.theme !== null ? event.theme : {},
      );
      const next = {
        ...current,
        ...theme,
        palette: { ...current.palette, ...(theme.palette ?? {}) },
        typography: { ...current.typography, ...(theme.typography ?? {}) },
      };

      await tx.event.update({
        where: { id: eventId },
        data: { theme: next as unknown as object },
      });
      return { theme: next as unknown as JsonValue };
    }

    case "update_agenda": {
      const { eventId, agenda } = payload.input;
      await tx.event.update({
        where: { id: eventId },
        data: { agenda: agenda as unknown as object },
      });
      return { items: agenda.items.length };
    }

    case "change_event_date": {
      const { eventId, date, endsAt } = payload.input;
      const before = await tx.event.findUnique({
        where: { id: eventId },
        select: { date: true },
      });
      await tx.event.update({
        where: { id: eventId },
        data: { date, ...(endsAt !== undefined ? { endsAt: endsAt ?? null } : {}) },
      });
      return {
        from: before?.date.toISOString() ?? null,
        to: date.toISOString(),
      };
    }

    case "draft_emails": {
      const { eventId, guestIds, intent, brief } = payload.input;
      const guests = await tx.guest.findMany({
        where: { id: { in: guestIds }, eventId },
        select: { id: true, name: true, email: true },
      });
      if (guests.length === 0) {
        throw new Error("None of the proposed guests belong to this event.");
      }
      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { title: true, date: true, venue: true },
      });

      const draft = readDraftCopy(sideEffects);
      const campaignId = `cmp_${Date.now().toString(36)}`;

      await tx.emailMessage.createMany({
        data: guests.map((g) => ({
          eventId,
          guestId: g.id,
          kind: EMAIL_KIND_BY_INTENT[intent],
          subject: (draft.subject ?? fallbackSubject(intent, event?.title)).slice(0, 200),
          body: renderBody(draft.body ?? brief ?? "", {
            name: g.name,
            title: event?.title ?? "",
            venue: event?.venue ?? "",
            date: event?.date ?? null,
            intent,
          }),
          personalised: Boolean(draft.body),
          // APPROVED, never SENT. Approving a draft_emails proposal marks the
          // copy ready to go out; the agent does not send it.
          status: "APPROVED" as const,
          campaignId,
        })),
      });

      return { campaignId, drafted: guests.length, sent: 0 };
    }

    case "create_ticket_tier": {
      const { eventId, name, priceCents, quota, opensAt } = payload.input;
      const clash = await tx.ticketTier.findFirst({
        where: { eventId, name },
        select: { id: true },
      });
      if (clash) throw new Error(`A tier called “${name}” already exists.`);

      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { currency: true },
      });
      const max = await tx.ticketTier.aggregate({
        where: { eventId },
        _max: { sortOrder: true },
      });

      const tier = await tx.ticketTier.create({
        data: {
          eventId,
          name,
          priceCents,
          quota,
          currency: event?.currency ?? "EUR",
          opensAt: opensAt ?? null,
          status: !opensAt || opensAt <= new Date() ? "ON_SALE" : "DRAFT",
          sortOrder: (max._max.sortOrder ?? 0) + 1,
        },
      });
      return { tierId: tier.id, name: tier.name, status: tier.status };
    }

    case "draft_sponsor_offer": {
      const { eventId, sponsorId, targetPackage, incrementalAmountCents } =
        payload.input;
      const sponsor = await tx.sponsor.findFirst({
        where: { id: sponsorId, eventId },
        select: { id: true, name: true, contactEmail: true, package: true },
      });
      if (!sponsor) throw new Error("Sponsor not found on this event.");

      const draft = readDraftCopy(sideEffects);
      await tx.sponsor.update({
        where: { id: sponsor.id },
        data: { status: "OFFERED" },
      });

      const email = await tx.emailMessage.create({
        data: {
          eventId,
          sponsorId: sponsor.id,
          kind: "SPONSOR_OFFER",
          subject:
            draft.subject ??
            `${sponsor.name} — ${targetPackage} partnership for the next edition`,
          body:
            draft.body ??
            `Hello ${sponsor.name},\n\nWe would like to offer you a ${targetPackage} package for an additional ${(incrementalAmountCents / 100).toFixed(0)} EUR.`,
          personalised: Boolean(draft.body),
          // APPROVED, never SENT.
          status: "APPROVED",
        },
      });

      return {
        sponsorId: sponsor.id,
        from: sponsor.package,
        to: targetPackage,
        emailMessageId: email.id,
      };
    }
  }
}

const EMAIL_KIND_BY_INTENT = {
  INVITE: "INVITE",
  REMINDER: "REMINDER",
  RECOVERY: "RECOVERY",
  VIP_UPGRADE: "ANNOUNCEMENT",
  WAITLIST_PROMOTION: "ANNOUNCEMENT",
} as const;

/**
 * The copy the organiser actually saw on the proposal card. Using it verbatim
 * is the point: approve means "send this", not "send something like this".
 */
function readDraftCopy(sideEffects: SideEffect[]): {
  subject?: string;
  body?: string;
} {
  const subject = sideEffects.find((s) => s.label === "Subject line")?.detail;
  const body = sideEffects.find((s) => s.label === "Draft copy")?.detail;
  return {
    subject: subject ?? undefined,
    body: body ?? undefined,
  };
}

function fallbackSubject(intent: string, title?: string): string {
  const name = title ?? "your event";
  switch (intent) {
    case "REMINDER":
      return `A reminder about ${name}`;
    case "RECOVERY":
      return `Still joining us at ${name}?`;
    case "VIP_UPGRADE":
      return `An invitation to the ${name} VIP table`;
    case "WAITLIST_PROMOTION":
      return `A seat has opened up at ${name}`;
    default:
      return `You are invited to ${name}`;
  }
}

function renderBody(
  template: string,
  ctx: { name: string; title: string; venue: string; date: Date | null; intent: string },
): string {
  const when = ctx.date
    ? ctx.date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
  const base =
    template.trim() ||
    `We would love to see you at ${ctx.title}${when ? ` on ${when}` : ""}${ctx.venue ? `, ${ctx.venue}` : ""}.`;
  return `Dear ${ctx.name},\n\n${base
    .replace(/\{\{\s*name\s*\}\}/gi, ctx.name)
    .replace(/\{\{\s*event\s*\}\}/gi, ctx.title)
    .replace(/\{\{\s*venue\s*\}\}/gi, ctx.venue)
    .replace(/\{\{\s*date\s*\}\}/gi, when)}`;
}
