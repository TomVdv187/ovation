import "server-only";
import {
  eventThemeSchema,
  requiresApproval,
  type AgentActionPayload,
  type ActionRiskT,
  type AgentActionStatusT,
  type JsonValue,
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

/**
 * The compare-and-swap below found the row already claimed.
 *
 * Distinct from every other failure because NOTHING WENT WRONG: another
 * request is executing this action, or already has. The distinction is
 * load-bearing — see the catch in executeOne.
 */
class AlreadyDecidedError extends Error {
  constructor() {
    super("Action was already decided.");
  }
}

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
      /**
       * CLAIM THE ROW FIRST — Agent 7 · CRITIC, Phase 3.
       *
       * This used to be a `findUnique` followed by a status check, with the
       * comment "so two concurrent approvals cannot both execute the same
       * proposal". It did not: at READ COMMITTED both transactions read
       * PROPOSED, both passed the check, and both ran the mutation. Check A7 in
       * apps/console/scripts/critic-approval.ts fired two `agent.approve` calls
       * for one `draft_emails` action and got TWO sets of EmailMessage rows —
       * i.e. a double-clicked Approve button drafts the campaign twice.
       *
       * A conditional updateMany is a compare-and-swap: exactly one transaction
       * can move the row out of PROPOSED/APPROVED, and the loser sees count 0
       * and rolls back before touching anything.
       */
      const claimed = await tx.agentAction.updateMany({
        where: { id: actionId, status: { in: ["PROPOSED", "APPROVED"] } },
        data: {
          status: "EXECUTED",
          approvedBy:
            source.kind === "HUMAN" ? source.userId : "auto-approve:COSMETIC",
          approvedAt: new Date(),
          executedAt: new Date(),
        },
      });
      if (claimed.count === 0) throw new AlreadyDecidedError();

      const row = await tx.agentAction.findUnique({ where: { id: actionId } });
      if (!row) throw new AlreadyDecidedError();

      const payload = parsePayload(applyPatch(row.payload, patch));
      await assertEventInOrg(tx, payload.input.eventId, row.organisationId);

      const mutationResult = await performMutation(tx, payload);

      await tx.agentAction.update({
        where: { id: actionId },
        data: {
          result: mutationResult as unknown as object,
          error: null,
          ...(patch !== undefined ? { payload: payload as unknown as object } : {}),
        },
      });

      return mutationResult;
    });

    return { actionId, status: "EXECUTED", result, error: null };
  } catch (error) {
    /**
     * LOSING THE RACE IS NOT A FAILURE — and writing it down as one corrupts
     * the winner.
     *
     * The compare-and-swap above is what stops two concurrent approvals both
     * executing. The loser claims nothing and rolls back, which is correct.
     * But this catch used to mark the row FAILED unconditionally, and the row
     * it marked is the one the WINNER had just set to EXECUTED — so a
     * double-clicked Approve drafted the campaign once (right) and then
     * reported it as failed (wrong), leaving an EXECUTED mutation behind a
     * FAILED status that no retry can clear, because FAILED is not a status
     * executeOne will pick up again.
     *
     * So: claimed-and-then-broke writes FAILED, never-claimed reads the row
     * back and reports what actually happened to it.
     */
    if (error instanceof AlreadyDecidedError) {
      const settled = await db.agentAction.findUnique({
        where: { id: actionId },
        select: { status: true, result: true, error: true },
      });
      return {
        actionId,
        status: settled?.status ?? "FAILED",
        result: (settled?.result as JsonValue | null) ?? null,
        error: settled?.status === "EXECUTED" ? null : (settled?.error ?? null),
      };
    }

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

/**
 * Organiser tweaks to the payload before executing (agent.approve `patch`).
 *
 * SECURITY — Agent 7 · CRITIC, Phase 3. `eventId` and `type` are pinned from
 * the STORED payload and cannot be patched.
 *
 * Found by testing, not by reading: `agent.approve` checks that the ACTION
 * belongs to the caller's organisation (`assertActionsBelongToOrg`) but nothing
 * re-checked the event named inside the payload. Approving an action of your
 * own with `patch: { input: { eventId: "<someone else's event>" } }` executed
 * the mutation against that event — a signed-in user of any organisation could
 * restyle, re-date or rewrite the agenda of any event in the database. The
 * reproduction is check A2 in apps/console/scripts/critic-approval.ts, which
 * rewrote org B's theme from an org A session.
 *
 * Pinning here closes it for every tool at once: `draft_emails` already scopes
 * its guests by `eventId`, and `draft_sponsor_offer` already scopes its sponsor
 * by `eventId`, so an unpatched `eventId` makes every other id in the payload
 * unreachable outside the event. `assertEventInOrg` below is the second lock.
 */
function applyPatch(payload: unknown, patch: unknown): unknown {
  if (patch === undefined || patch === null) return payload;
  if (typeof patch !== "object" || Array.isArray(patch)) return payload;
  const base = (payload ?? {}) as Record<string, unknown>;
  const baseInput = (base.input as Record<string, unknown>) ?? {};
  const p = patch as Record<string, unknown>;
  const patchInput = (p.input as Record<string, unknown>) ?? p;
  return {
    ...base,
    type: base.type,
    input: {
      ...baseInput,
      ...patchInput,
      eventId: baseInput.eventId,
    },
  };
}

/**
 * The event a proposal names must belong to the organisation that owns the
 * proposal. Belt to applyPatch's braces: if a future tool ever grows a second
 * way to choose its target, this still refuses.
 */
async function assertEventInOrg(
  tx: Tx,
  eventId: string,
  organisationId: string,
): Promise<void> {
  const event = await tx.event.findFirst({
    where: { id: eventId, organisationId },
    select: { id: true },
  });
  if (!event) {
    throw new Error("Event does not belong to this organisation.");
  }
}

type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

async function performMutation(
  tx: Tx,
  payload: AgentActionPayload,
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
      const { eventId, guestIds, intent, brief, draft } = payload.input;
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

      const campaignId = `cmp_${Date.now().toString(36)}`;

      await tx.emailMessage.createMany({
        data: guests.map((g) => ({
          eventId,
          guestId: g.id,
          kind: EMAIL_KIND_BY_INTENT[intent],
          subject: (draft?.subject ?? fallbackSubject(intent, event?.title)).slice(0, 200),
          body: renderBody(draft?.body ?? brief ?? "", {
            name: g.name,
            title: event?.title ?? "",
            venue: event?.venue ?? "",
            date: event?.date ?? null,
            intent,
          }),
          personalised: Boolean(draft?.body),
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
      const { eventId, sponsorId, targetPackage, incrementalAmountCents, draft } =
        payload.input;
      const sponsor = await tx.sponsor.findFirst({
        where: { id: sponsorId, eventId },
        select: { id: true, name: true, contactEmail: true, package: true },
      });
      if (!sponsor) throw new Error("Sponsor not found on this event.");

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
            draft?.subject ??
            `${sponsor.name} — ${targetPackage} partnership for the next edition`,
          body:
            draft?.body ??
            `Hello ${sponsor.name},\n\nWe would like to offer you a ${targetPackage} package for an additional ${(incrementalAmountCents / 100).toFixed(0)} EUR.`,
          personalised: Boolean(draft?.body),
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
