import { z } from "zod";
import type { Db } from "@ovation/core/db";
import { Prisma } from "@ovation/core/db";
import {
  cueSchema,
  eventAgendaSchema,
  type AgentToolName,
  type Cue,
} from "@ovation/core";
import { emit } from "../realtime";

/**
 * THE CUE ENGINE.
 *
 * A cue watches the room and *proposes*. It writes an AgentAction with status
 * PROPOSED and emits a CUE onto the feed; it never edits the agenda, never
 * sends anything, never touches the event. That is not a stylistic choice —
 * it is the same safety contract packages/core states for the agent brain, and
 * the cue engine is just another actor under it. `assertProposalOnly` below is
 * the single place a status is set, so the invariant is checkable by reading
 * one function.
 *
 * Each cue maps onto a tool the console already knows how to execute, so an
 * approved proposal goes down the existing APPROVED -> EXECUTED path with no
 * special-casing:
 *
 *   CAPACITY_PERCENT    -> update_agenda  (pull the keynote forward)
 *   ARRIVAL_RATE_DROP   -> update_agenda  (hold the keynote, the room is thin)
 *   AGENDA_ITEM_DUE     -> update_agenda  (an item is overdue, re-time it)
 *   VIP_LATE            -> draft_emails   (RECOVERY nudge to the missing VIP)
 *
 * `draft_emails` is OUTBOUND, so `requiresApproval` refuses to auto-approve it
 * whatever the org settings say — a machine cannot email a VIP because a timer
 * went off.
 *
 * CC-008 accepted: cue definitions are rows in the `Cue` table now. The first
 * read of an event seeds the default set, and after that an organiser who
 * disables the capacity cue at 19:00 keeps it disabled across a deploy.
 *
 * METRONOME: the fired-once-per-night marker is `Cue.firedAt`, a column. It
 * used to be a Map in this module, which meant the once-per-night guarantee
 * was enforced by process memory while every other guarantee here is enforced
 * by the database. A redeploy, a crash, or a serverless instance recycling —
 * routine on Vercel — emptied it and re-armed every cue that had already gone
 * off. The open-proposal check below hid most of that, because a duplicate card
 * was still refused; what it could not hide is a cue whose proposal had already
 * been approved or rejected, which has no open proposal and fired again.
 */

const CUE_ACTION_MARKER = "ovationCue";

export const DOORS_KIND = "DOORS";

export function defaultCues(eventId: string): Cue[] {
  return [
    {
      id: "capacity-70",
      eventId,
      label: "Room is full enough to start",
      trigger: { type: "CAPACITY_PERCENT", percent: 70 },
      auto: false,
      enabled: true,
      firedAt: null,
    },
    {
      id: "vip-late-30",
      eventId,
      label: "VIP with transport arranged has not arrived",
      trigger: { type: "VIP_LATE", minutesAfterDoors: 30 },
      auto: false,
      enabled: true,
      firedAt: null,
    },
    {
      id: "arrival-rate-drop-60",
      eventId,
      label: "Arrivals have fallen off a cliff",
      trigger: { type: "ARRIVAL_RATE_DROP", percent: 60 },
      auto: false,
      enabled: true,
      firedAt: null,
    },
  ];
}

/**
 * CC-008. Rows, not a Map. The default set is seeded on first read so an event
 * that nobody has configured still has working cues.
 */
export async function getCues(db: Db, eventId: string): Promise<Cue[]> {
  const rows = await db.cue.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length > 0) return rows.map(toCue);

  const defaults = defaultCues(eventId);
  await db.cue.createMany({
    data: defaults.map((c) => ({
      eventId,
      label: c.label,
      trigger: c.trigger as unknown as object,
      auto: c.auto,
      enabled: c.enabled,
    })),
    skipDuplicates: true,
  });
  return (
    await db.cue.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } })
  ).map(toCue);
}

export async function setCues(
  db: Db,
  eventId: string,
  cues: unknown,
): Promise<Cue[]> {
  const parsed = z.array(cueSchema).parse(cues);
  await db.$transaction([
    db.cue.deleteMany({ where: { eventId } }),
    db.cue.createMany({
      data: parsed.map((c) => ({
        eventId,
        label: c.label,
        trigger: c.trigger as unknown as object,
        auto: c.auto,
        enabled: c.enabled,
      })),
    }),
  ]);
  return (
    await db.cue.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } })
  ).map(toCue);
}

function toCue(row: {
  id: string;
  eventId: string;
  label: string;
  trigger: unknown;
  auto: boolean;
  enabled: boolean;
  firedAt: Date | null;
}): Cue {
  return cueSchema.parse({
    id: row.id,
    eventId: row.eventId,
    label: row.label,
    trigger: row.trigger,
    auto: row.auto,
    enabled: row.enabled,
    firedAt: row.firedAt,
  });
}

/** Re-arms every cue on an event. Used by the dev reset and `?reset=1`. */
export async function resetFired(db: Db, eventId: string): Promise<void> {
  await db.cue.updateMany({
    where: { eventId, firedAt: { not: null } },
    data: { firedAt: null },
  });
}

/**
 * Claim a cue for tonight. Returns true for exactly one caller.
 *
 * The guarded UPDATE is the whole mechanism: `firedAt: null` in the WHERE means
 * two instances evaluating the same cue at the same moment both attempt it, one
 * matches a row and one matches none, and the count settles it. Same shape as
 * `reserve()` in apps/events/src/server/ticketing.ts, and for the same reason —
 * a read-then-write here would let both through.
 *
 * Claimed BEFORE proposing, not after, so the loser never reaches the proposal
 * at all. If proposing then fails, `release` puts it back.
 */
async function claim(db: Db, cueId: string): Promise<boolean> {
  const claimed = await db.cue.updateMany({
    where: { id: cueId, firedAt: null },
    data: { firedAt: new Date() },
  });
  return claimed.count > 0;
}

/** Undo a claim whose proposal did not land, so the cue can fire later tonight. */
async function release(db: Db, cueId: string): Promise<void> {
  await db.cue.updateMany({ where: { id: cueId }, data: { firedAt: null } });
}

// ── evaluation ────────────────────────────────────────────────

export interface CueContext {
  checkedIn: number;
  capacity: number;
}

/** Called after every successful check-in. Cheap enough to run on the hot path's tail. */
export async function onCheckin(
  db: Db,
  eventId: string,
  ctx: CueContext,
): Promise<void> {
  await evaluate(db, eventId, ctx, ["CAPACITY_PERCENT", "ARRIVAL_RATE_DROP"]);
}

/** Called on a timer while anyone is watching the event. */
export async function onTick(db: Db, eventId: string): Promise<void> {
  const [checkedIn, event] = await Promise.all([
    db.checkIn.count({ where: { eventId } }),
    db.event.findUnique({ where: { id: eventId }, select: { capacity: true } }),
  ]);
  await evaluate(
    db,
    eventId,
    { checkedIn, capacity: event?.capacity ?? 0 },
    ["VIP_LATE", "ARRIVAL_RATE_DROP", "AGENDA_ITEM_DUE"],
  );
}

type TriggerType = Cue["trigger"]["type"];

async function evaluate(
  db: Db,
  eventId: string,
  ctx: CueContext,
  only: readonly TriggerType[],
): Promise<void> {
  const cues = (await getCues(db, eventId)).filter(
    (c) => c.enabled && only.includes(c.trigger.type),
  );
  if (cues.length === 0) return;

  for (const cue of cues) {
    // Already fired tonight, according to the database rather than this process.
    if (cue.firedAt !== null) continue;
    try {
      const proposal = await assess(db, eventId, cue, ctx);
      if (!proposal) continue;
      // Claim first: only one instance may go on to propose.
      if (!(await claim(db, cue.id))) continue;
      try {
        await propose(db, eventId, cue, proposal);
      } catch (err) {
        await release(db, cue.id);
        throw err;
      }
    } catch (err) {
      console.error(
        `[live] cue ${cue.id} failed:`,
        (err as Error).message,
      );
    }
  }
}

interface Proposal {
  type: AgentToolName;
  summary: string;
  payload: unknown;
  sideEffects: Array<{ label: string; detail?: string; count?: number }>;
}

async function assess(
  db: Db,
  eventId: string,
  cue: Cue,
  ctx: CueContext,
): Promise<Proposal | null> {
  switch (cue.trigger.type) {
    case "CAPACITY_PERCENT":
      return assessCapacity(db, eventId, cue.trigger.percent, ctx);
    case "VIP_LATE":
      return assessVipLate(db, eventId, cue.trigger.minutesAfterDoors);
    case "ARRIVAL_RATE_DROP":
      return assessArrivalDrop(db, eventId, cue.trigger.percent);
    case "AGENDA_ITEM_DUE":
      return assessAgendaDue(db, eventId, cue.trigger.itemId);
  }
}

async function assessCapacity(
  db: Db,
  eventId: string,
  percent: number,
  ctx: CueContext,
): Promise<Proposal | null> {
  if (ctx.capacity <= 0) return null;
  const reached = (ctx.checkedIn / ctx.capacity) * 100;
  if (reached < percent) return null;

  const agenda = await readAgenda(db, eventId);
  const keynote = agenda.items.find(
    (i) => i.kind === "TALK" || /keynote/i.test(i.title),
  );
  if (!keynote) return null;

  const startsAt = new Date(keynote.startsAt);
  const now = new Date();
  // Only worth proposing if it is still in the future.
  if (startsAt.getTime() <= now.getTime()) return null;

  const pullForwardMs = Math.min(
    10 * 60 * 1000,
    startsAt.getTime() - now.getTime(),
  );
  const newStart = new Date(startsAt.getTime() - pullForwardMs);

  return {
    type: "update_agenda",
    summary: `Capacity at ${reached.toFixed(0)}% (${ctx.checkedIn}/${ctx.capacity}) — propose starting "${keynote.title}" ${Math.round(pullForwardMs / 60000)} min early.`,
    payload: {
      type: "update_agenda",
      input: {
        eventId,
        agenda: {
          items: agenda.items.map((item) =>
            item.id === keynote.id
              ? {
                  ...item,
                  startsAt: newStart.toISOString(),
                  endsAt: item.endsAt
                    ? new Date(
                        new Date(item.endsAt).getTime() - pullForwardMs,
                      ).toISOString()
                    : null,
                }
              : { ...item, startsAt: new Date(item.startsAt).toISOString() },
          ),
        },
      },
    },
    sideEffects: [
      {
        label: "Moves one agenda item",
        detail: `${keynote.title} → ${newStart.toISOString()}`,
      },
      { label: "Public agenda page re-renders" },
    ],
  };
}

async function assessVipLate(
  db: Db,
  eventId: string,
  minutesAfterDoors: number,
): Promise<Proposal | null> {
  const doors = await doorsTime(db, eventId);
  if (!doors) return null;
  const due = doors.getTime() + minutesAfterDoors * 60_000;
  if (Date.now() < due) return null;

  const vips = await db.guest.findMany({
    where: {
      eventId,
      segment: "VIP",
      rsvpStatus: "CONFIRMED",
      checkIn: null,
      whiteGlove: { not: Prisma.DbNull },
    },
    select: { id: true, name: true, company: true, whiteGlove: true },
  });

  // "with transport arranged" — the cue in the brief is specifically about the
  // VIPs someone has already spent money getting to the door.
  const withTransport = vips.filter((g) => hasTransport(g.whiteGlove));
  if (withTransport.length === 0) return null;

  const names = withTransport.map((g) => g.name).join(", ");
  // Describes what was observed, not how the cue was configured — the card is
  // read by an organiser, and "-4000000 minutes after doors" is not a fact
  // about the room.
  const doorsAt = doors.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    type: "draft_emails",
    summary: `${withTransport.length} VIP${withTransport.length === 1 ? "" : "s"} with transport arranged have not arrived (doors ${doorsAt}): ${names}. Propose a recovery nudge.`,
    payload: {
      type: "draft_emails",
      input: {
        eventId,
        guestIds: withTransport.map((g) => g.id),
        intent: "RECOVERY",
        brief:
          "Car service was arranged and they have not arrived. Short, warm, ask if they are en route and offer to re-send the driver's number.",
      },
    },
    sideEffects: [
      {
        label: "Drafts recovery emails",
        count: withTransport.length,
        detail: names,
      },
      { label: "Nothing sends until you approve" },
    ],
  };
}

async function assessArrivalDrop(
  db: Db,
  eventId: string,
  percent: number,
): Promise<Proposal | null> {
  const now = Date.now();
  const window = 15 * 60_000;
  const [recent, previous] = await Promise.all([
    db.checkIn.count({
      where: { eventId, timestamp: { gte: new Date(now - window) } },
    }),
    db.checkIn.count({
      where: {
        eventId,
        timestamp: {
          gte: new Date(now - 2 * window),
          lt: new Date(now - window),
        },
      },
    }),
  ]);

  // Needs a real prior peak, otherwise the first quarter hour of the night
  // reads as a 100% collapse.
  if (previous < 10) return null;
  const drop = ((previous - recent) / previous) * 100;
  if (drop < percent) return null;

  const agenda = await readAgenda(db, eventId);
  const keynote = agenda.items.find(
    (i) => i.kind === "TALK" || /keynote/i.test(i.title),
  );
  if (!keynote) return null;
  const startsAt = new Date(keynote.startsAt);
  if (startsAt.getTime() <= now) return null;

  const holdMs = 10 * 60_000;
  return {
    type: "update_agenda",
    summary: `Arrivals down ${drop.toFixed(0)}% on the previous 15 min (${recent} vs ${previous}) — propose holding "${keynote.title}" 10 min.`,
    payload: {
      type: "update_agenda",
      input: {
        eventId,
        agenda: {
          items: agenda.items.map((item) =>
            item.id === keynote.id
              ? {
                  ...item,
                  startsAt: new Date(
                    startsAt.getTime() + holdMs,
                  ).toISOString(),
                  endsAt: item.endsAt
                    ? new Date(new Date(item.endsAt).getTime() + holdMs).toISOString()
                    : null,
                }
              : { ...item, startsAt: new Date(item.startsAt).toISOString() },
          ),
        },
      },
    },
    sideEffects: [
      { label: "Delays one agenda item", detail: `${keynote.title} +10 min` },
    ],
  };
}

async function assessAgendaDue(
  db: Db,
  eventId: string,
  itemId: string,
): Promise<Proposal | null> {
  const agenda = await readAgenda(db, eventId);
  const item = agenda.items.find((i) => i.id === itemId);
  if (!item) return null;
  const startsAt = new Date(item.startsAt).getTime();
  if (Date.now() < startsAt) return null;

  return {
    type: "update_agenda",
    summary: `"${item.title}" was due to start — confirm the running order or re-time it.`,
    payload: {
      type: "update_agenda",
      input: {
        eventId,
        agenda: {
          items: agenda.items.map((i) => ({
            ...i,
            startsAt: new Date(i.startsAt).toISOString(),
          })),
        },
      },
    },
    sideEffects: [{ label: "Re-times the running order" }],
  };
}

// ── proposal ──────────────────────────────────────────────────

/**
 * The only place a cue writes. Status is hard-coded PROPOSED: `cue.auto`
 * marks a cue as *eligible* for the console's auto-approval policy, it does
 * not grant the cue permission to approve itself. Every one of these tools is
 * OPERATIONAL or OUTBOUND, so `requiresApproval` in @ovation/core would refuse
 * anyway — this just means the refusal does not depend on that lookup.
 */
async function propose(
  db: Db,
  eventId: string,
  cue: Cue,
  proposal: Proposal,
): Promise<void> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { organisationId: true },
  });
  if (!event) return;

  // Survives a restart: if this cue already has an open proposal, do not stack
  // a second card on the organiser.
  const open = await db.agentAction.findFirst({
    where: {
      eventId,
      status: "PROPOSED",
      type: proposal.type,
      payload: { path: [CUE_ACTION_MARKER], equals: cue.id },
    },
    select: { id: true },
  });
  // An open proposal for this cue already exists — the claim stands, so it
  // will not be raised again tonight.
  if (open) return;

  const action = await db.agentAction.create({
    data: {
      organisationId: event.organisationId,
      eventId,
      type: proposal.type,
      summary: proposal.summary,
      payload: {
        ...(proposal.payload as Record<string, unknown>),
        [CUE_ACTION_MARKER]: cue.id,
      },
      sideEffects: proposal.sideEffects,
      status: "PROPOSED",
      risk: proposal.type === "draft_emails" ? "OUTBOUND" : "OPERATIONAL",
      createdBy: "AGENT",
      createdById: `cue:${cue.id}`,
    },
    select: { id: true, status: true },
  });

  assertProposalOnly(action.status);

  emit(eventId, {
    kind: "CUE",
    at: new Date(),
    agentActionId: action.id,
    summary: proposal.summary,
    auto: cue.auto,
  });
}

/** Guard rail with teeth: a cue that ever produced anything else is a bug. */
function assertProposalOnly(status: string): asserts status is "PROPOSED" {
  if (status !== "PROPOSED") {
    throw new Error(
      `Cue engine produced an action with status ${status}; cues may only PROPOSE.`,
    );
  }
}

// ── helpers ───────────────────────────────────────────────────

async function readAgenda(db: Db, eventId: string) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { agenda: true },
  });
  const parsed = eventAgendaSchema.safeParse(event?.agenda ?? {});
  return parsed.success ? parsed.data : { items: [] };
}

async function doorsTime(db: Db, eventId: string): Promise<Date | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { agenda: true, date: true },
  });
  if (!event) return null;
  const parsed = eventAgendaSchema.safeParse(event.agenda ?? {});
  const doors = parsed.success
    ? parsed.data.items.find((i) => i.kind === DOORS_KIND)
    : undefined;
  return doors ? new Date(doors.startsAt) : event.date;
}

function hasTransport(whiteGlove: unknown): boolean {
  if (!whiteGlove || typeof whiteGlove !== "object") return false;
  const t = (whiteGlove as { transport?: unknown }).transport;
  return typeof t === "string" && t.trim().length > 0;
}
