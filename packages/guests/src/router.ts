import { TRPCError } from "@trpc/server";
import {
  guestGetInput,
  guestListInput,
  guestListOutput,
  guestSchema,
  guestScoreInput,
  guestScoreOutput,
  guestSegmentInput,
  guestSegmentOutput,
  orgProcedure,
  personaliseInviteInput,
  personaliseInviteOutput,
  router,
  vipChecklistInput,
  vipChecklistOutput,
  waitlistSuggestionsInput,
  waitlistSuggestionsOutput,
  type EmailKindT,
  type Guest,
  type RecoveryAction,
} from "@ovation/core";
import { db as sharedDb, type Db } from "@ovation/core/db";
import type { ScoreOutcome } from "./engine/types";
import { assignSegments, type SegmentationSubject } from "./engine/segmentation";
import { planWaitlist, type WaitlistRow } from "./engine/waitlist";
import { openWhiteGlove, outstandingWhiteGlove, readWhiteGlove } from "./engine/white-glove";
import { anthropicWriter, hasApiKey } from "./invites/writer";
import { newCampaignId, personaliseBatch } from "./invites/personalise";
import type { CampaignIntent } from "./invites/types";
import { noTicket, toContractGuest, toEventFacts, toGuestFacts, type GuestRow } from "./mappers";
import {
  applyInWaves,
  loadEvent,
  loadOrganisationName,
  loadScoredEvent,
  loadSegmentationContext,
} from "./service";

/**
 * @ovation/guests — the guest-intelligence router.
 *
 * Same procedure signatures as the contract stub in @ovation/core; only the
 * bodies are ours. Three invariants the console and live ops can rely on:
 *
 *  - every score carries its top-3 factors and is a pure function of the data,
 *    so two runs produce byte-identical results;
 *  - every risk carries a recommended recovery action, so the UI never invents one;
 *  - personaliseInvite writes EmailMessage rows as PROPOSED and never sends.
 *    There is no delivery client anywhere in this package.
 */

/** Intent → the EmailKind the row is filed under for the approval queue. */
const INTENT_KIND: Record<CampaignIntent, EmailKindT> = {
  INVITE: "INVITE",
  REMINDER: "REMINDER",
  RECOVERY: "RECOVERY",
  VIP_UPGRADE: "OTHER",
  WAITLIST_PROMOTION: "INVITE",
};

interface OrgContext {
  db: Db;
  session: { user: { organisationId: string | null } };
}

function dbOf(ctx: OrgContext): Db {
  return ctx.db ?? sharedDb;
}

function requireOrg(ctx: OrgContext): string {
  const organisationId = ctx.session.user.organisationId;
  if (!organisationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This user is not attached to an organisation.",
    });
  }
  return organisationId;
}

export const guestsRouter = router({
  list: orgProcedure
    .input(guestListInput)
    .output(guestListOutput)
    .query(async ({ ctx, input }) => {
      const db = dbOf(ctx);
      const event = await loadEvent(db, input.eventId, requireOrg(ctx));
      const scored = await loadScoredEvent(db, event);

      // Scores are computed for the whole event and filtered in memory. Risk and
      // recovery are derived values — filtering on the stored columns would sort
      // by whatever the last `guests.score` left behind, which is the one thing
      // an organiser must never see.
      let items = scored.rows.map((row) => toContractGuest(row, scored.outcomes.get(row.id)));

      if (input.segment) items = items.filter((g) => g.segment === input.segment);
      if (input.rsvpStatus) items = items.filter((g) => g.rsvpStatus === input.rsvpStatus);
      if (input.noShowRisk) items = items.filter((g) => g.noShowRisk === input.noShowRisk);

      const search = input.search?.trim().toLowerCase();
      if (search) {
        items = items.filter((g) =>
          [g.name, g.email, g.company ?? ""].some((field) =>
            field.toLowerCase().includes(search),
          ),
        );
      }

      items.sort(comparator(input.sortBy, input.sortDir));

      const total = items.length;
      let start = 0;
      if (input.cursor) {
        const index = items.findIndex((g) => g.id === input.cursor);
        // A cursor that no longer resolves means the row was filtered away or
        // deleted between pages. Ending the walk beats silently restarting it.
        if (index < 0) return { items: [], nextCursor: null, total };
        start = index + 1;
      }

      const page = items.slice(start, start + input.limit);
      const more = start + page.length < total;
      return {
        items: page,
        nextCursor: more ? (page[page.length - 1]?.id ?? null) : null,
        total,
      };
    }),

  get: orgProcedure
    .input(guestGetInput)
    .output(guestSchema)
    .query(async ({ ctx, input }) => {
      const db = dbOf(ctx);
      const organisationId = requireOrg(ctx);

      const guest = await db.guest.findFirst({
        where: { id: input.id, event: { organisationId } },
        select: { id: true, eventId: true },
      });
      if (!guest) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No guest ${input.id}.` });
      }

      const event = await loadEvent(db, guest.eventId, organisationId);
      const scored = await loadScoredEvent(db, event);
      const row = scored.rows.find((r) => r.id === input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No guest ${input.id}.` });
      }
      return toContractGuest(row, scored.outcomes.get(row.id));
    }),

  /** Deterministic and explainable: every score carries its top-3 factors. */
  score: orgProcedure
    .input(guestScoreInput)
    .output(guestScoreOutput)
    .mutation(async ({ ctx, input }) => {
      const db = dbOf(ctx);
      const event = await loadEvent(db, input.eventId, requireOrg(ctx));
      const scored = await loadScoredEvent(db, event);

      // The whole event is always scored — capacity pressure is a property of
      // the room, not of the subset somebody asked about — and only the
      // requested guests come back.
      const wanted = input.guestIds?.length ? new Set(input.guestIds) : null;
      const rows = wanted ? scored.rows.filter((r) => wanted.has(r.id)) : scored.rows;

      const results = rows.flatMap((row) => {
        const outcome = scored.outcomes.get(row.id);
        return outcome ? [outcome] : [];
      });

      if (input.persist) {
        const stale = rows.filter((row) => hasDrifted(row, scored.outcomes.get(row.id)));
        await applyInWaves(stale, (row) => {
          const outcome = scored.outcomes.get(row.id);
          if (!outcome) return Promise.resolve(null);
          return db.guest.update({
            where: { id: row.id },
            data: {
              engagementScore: outcome.engagementScore,
              engagementFactors: outcome.factors,
              noShowRisk: outcome.noShowRisk,
              noShowProbability: outcome.noShowProbability,
              recoveryAction: serialiseAction(outcome.recoveryAction),
            },
          });
        });
      }

      return { results, engine: scored.engineId };
    }),

  segment: orgProcedure
    .input(guestSegmentInput)
    .output(guestSegmentOutput)
    .mutation(async ({ ctx, input }) => {
      const db = dbOf(ctx);
      const event = await loadEvent(db, input.eventId, requireOrg(ctx));

      const [scored, segmentation] = await Promise.all([
        loadScoredEvent(db, event),
        loadSegmentationContext(db, event.id),
      ]);

      // An override for a guest outside the requested set still has to be
      // honoured — dropping it would be the one thing the contract forbids.
      const requested = input.guestIds?.length
        ? new Set([...input.guestIds, ...input.overrides.map((o) => o.guestId)])
        : null;
      const rows = requested ? scored.rows.filter((r) => requested.has(r.id)) : scored.rows;

      const subjects: SegmentationSubject[] = rows.map((row) => {
        const ticket = scored.tickets.get(row.id) ?? noTicket();
        return {
          id: row.id,
          email: row.email,
          company: row.company,
          title: row.title,
          paidCents: ticket.paidCents,
          hasPremiumTicket: ticket.premium,
          hasWhiteGlove: row.whiteGlove !== null && row.whiteGlove !== undefined,
        };
      });

      const assignments = assignSegments(subjects, segmentation, input.overrides);
      const byId = new Map(rows.map((row) => [row.id, row]));

      const changed = assignments.filter((a) => byId.get(a.guestId)?.segment !== a.segment);
      await applyInWaves(changed, (assignment) => {
        const row = byId.get(assignment.guestId);
        if (!row) return Promise.resolve(null);

        // A new VIP gets a checklist opened for them straight away; an existing
        // one keeps whatever the organiser has already filled in.
        const needsChecklist =
          assignment.segment === "VIP" && (row.whiteGlove === null || row.whiteGlove === undefined);

        return db.guest.update({
          where: { id: row.id },
          data: {
            segment: assignment.segment,
            ...(needsChecklist ? { whiteGlove: openWhiteGlove(row) } : {}),
          },
        });
      });

      return { assignments };
    }),

  /**
   * Writes EmailMessage rows with status PROPOSED and returns them. It must
   * never send: the Conductor's approval flow owns delivery.
   */
  personaliseInvite: orgProcedure
    .input(personaliseInviteInput)
    .output(personaliseInviteOutput)
    .mutation(async ({ ctx, input }) => {
      const db = dbOf(ctx);
      const organisationId = requireOrg(ctx);
      const event = await loadEvent(db, input.eventId, organisationId);

      if (!hasApiKey()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ANTHROPIC_API_KEY is not configured, so invitations cannot be written. This feature has no template fallback by design.",
        });
      }

      const [scored, organiser] = await Promise.all([
        loadScoredEvent(db, event),
        loadOrganisationName(db, organisationId),
      ]);

      const wanted = new Set(input.guestIds);
      const rows = scored.rows.filter((row) => wanted.has(row.id));
      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "None of those guests belong to this event.",
        });
      }

      const intent = input.intent as CampaignIntent;
      const result = await personaliseBatch({
        event: toEventFacts(event, organiser),
        guests: rows.map((row) => toGuestFacts(row, scored.tickets.get(row.id) ?? noTicket())),
        intent,
        brief: input.brief,
        writer: anthropicWriter(),
      });

      const campaignId = input.campaignId ?? newCampaignId(intent);

      // PROPOSED, personalised, and that is where this package's involvement
      // ends. Nothing here talks to an email provider.
      const emails = await Promise.all(
        result.drafts.map(async (draft) => {
          const row = await db.emailMessage.create({
            data: {
              eventId: event.id,
              guestId: draft.guest.id,
              kind: INTENT_KIND[intent],
              subject: draft.email.subject,
              body: draft.email.body,
              personalised: true,
              status: "PROPOSED",
              campaignId,
            },
            select: { id: true },
          });
          return {
            guestId: draft.guest.id,
            emailMessageId: row.id,
            subject: draft.email.subject,
            body: draft.email.body,
            groundedOn: draft.email.groundedOn,
          };
        }),
      );

      if (result.rejected.length > 0) {
        // Surfaced rather than swallowed: an organiser approving 47 of 50 drafts
        // needs to know which three never got written, and why.
        console.warn(
          `[guests.personaliseInvite] ${result.rejected.length} of ${rows.length} drafts failed their checks and were not stored:`,
          result.rejected.map((r) => `${r.guestId}: ${r.reasons.at(-1) ?? "unknown"}`).join(" | "),
        );
      }

      return { campaignId, emails, status: "PROPOSED" as const };
    }),

  waitlistSuggestions: orgProcedure
    .input(waitlistSuggestionsInput)
    .output(waitlistSuggestionsOutput)
    .query(async ({ ctx, input }) => {
      const db = dbOf(ctx);
      const event = await loadEvent(db, input.eventId, requireOrg(ctx));
      const scored = await loadScoredEvent(db, event);

      const rows: WaitlistRow[] = scored.rows.flatMap((row) => {
        const signals = scored.signals.get(row.id);
        const assessment = scored.assessments.get(row.id);
        return signals && assessment ? [{ signals, assessment }] : [];
      });

      return planWaitlist(rows, scored.context);
    }),

  vipChecklist: orgProcedure
    .input(vipChecklistInput)
    .output(vipChecklistOutput)
    .query(async ({ ctx, input }) => {
      const db = dbOf(ctx);
      const event = await loadEvent(db, input.eventId, requireOrg(ctx));

      const rows = (await db.guest.findMany({
        where: { eventId: event.id, segment: "VIP" },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      })) as unknown as GuestRow[];

      return {
        guests: rows.map((row) => {
          // A VIP with no checklist yet still belongs on this screen — with all
          // four items outstanding, which is exactly the state that needs seeing.
          const whiteGlove = readWhiteGlove(row.whiteGlove);
          return {
            guestId: row.id,
            name: row.name,
            company: row.company,
            whiteGlove,
            outstanding: outstandingWhiteGlove(whiteGlove, row),
          };
        }),
      };
    }),
});

// ── helpers ───────────────────────────────────────────────────

type SortKey = "name" | "engagementScore" | "noShowProbability" | "createdAt";

function comparator(sortBy: SortKey, dir: "asc" | "desc"): (a: Guest, b: Guest) => number {
  const sign = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const primary = compareBy(sortBy, a, b);
    // Ties always fall back to id, so a page boundary can never land in the
    // middle of an ambiguous run and skip or repeat a guest.
    return primary !== 0 ? primary * sign : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

function compareBy(sortBy: SortKey, a: Guest, b: Guest): number {
  switch (sortBy) {
    case "name":
      return a.name.localeCompare(b.name, "en");
    case "engagementScore":
      return a.engagementScore - b.engagementScore;
    case "createdAt":
      return a.createdAt.getTime() - b.createdAt.getTime();
    case "noShowProbability": {
      // Nulls sort as "unknown", always at the low end, whichever way the
      // column is pointed.
      const left = a.noShowProbability;
      const right = b.noShowProbability;
      if (left === null && right === null) return 0;
      if (left === null) return -1;
      if (right === null) return 1;
      return left - right;
    }
  }
}

function hasDrifted(row: GuestRow, outcome: ScoreOutcome | undefined): boolean {
  if (!outcome) return false;
  return (
    row.engagementScore !== outcome.engagementScore ||
    row.noShowRisk !== outcome.noShowRisk ||
    row.noShowProbability !== outcome.noShowProbability ||
    !Array.isArray(row.engagementFactors) ||
    row.engagementFactors.length !== outcome.factors.length ||
    JSON.stringify(row.recoveryAction) !== JSON.stringify(serialiseAction(outcome.recoveryAction))
  );
}

/** Dates are not valid JSON, so the due date goes into the column as ISO text. */
function serialiseAction(action: RecoveryAction): {
  action: string;
  reason: string;
  dueBy: string | null;
} {
  return {
    action: action.action,
    reason: action.reason,
    dueBy: action.dueBy ? action.dueBy.toISOString() : null,
  };
}
