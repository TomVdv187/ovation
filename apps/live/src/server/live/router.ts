import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  announceInput,
  announceOutput,
  checkinInput,
  checkinOutput,
  liveFeedInput,
  markIntroducedInput,
  matchmakingInput,
  matchmakingOutput,
  opsSnapshotInput,
  opsSnapshotOutput,
  orgProcedure,
  publicProcedure,
  router,
  type Context,
  type Guest,
  type LiveEvent,
  type Sponsor,
} from "@ovation/core";
import { parseChannel, subscribe } from "../realtime";
import { announce } from "./announce";
import { performCheckin } from "./checkin";
import { opsSnapshot } from "./ops";
import {
  introductionsFor,
  markIntroduced as recordIntroduction,
  pairKey,
  rankMatches,
} from "./matchmaking";
import { startCueTimer, stopCueTimer } from "./cue-timer";

/**
 * Agent 5 · MAÎTRE D' — the live router.
 *
 * Same seven procedures, same signatures as the stub in
 * packages/core/src/trpc/routers/live.ts. Agent 7 · CRITIC swaps one line in
 * apps/console/src/server/router.ts (`live: liveRouter`) and the console is
 * wired to the real thing.
 */
export const liveRouter = router({
  checkin: orgProcedure
    .input(checkinInput)
    .output(checkinOutput)
    .mutation(async ({ ctx, input }) => performCheckin(ctx.db, input)),

  ops: orgProcedure
    .input(opsSnapshotInput)
    .output(opsSnapshotOutput)
    .query(async ({ ctx, input }) => {
      try {
        return await opsSnapshot(ctx.db, input.eventId);
      } catch (err) {
        if ((err as { code?: string }).code === "NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Unknown event." });
        }
        throw err;
      }
    }),

  /**
   * Operator feed. The listening surface comes from the
   * `x-ovation-live-channel` header (ops | host | door | screens) and defaults
   * to `ops`, because the input schema is fixed by the contract and a header
   * is the only place left to say who is asking. Browsers use the SSE route at
   * /api/live/stream, which takes the same thing as a query param.
   */
  feed: orgProcedure
    .input(liveFeedInput)
    .subscription(async function* ({
      ctx,
      input,
      signal,
    }): AsyncGenerator<LiveEvent, void, unknown> {
      const channel = parseChannel(
        ctx.headers?.get("x-ovation-live-channel"),
        "ops",
      );
      startCueTimer(ctx.db, input.eventId);
      try {
        for await (const env of subscribe(input.eventId, {
          channel,
          since: input.since ?? null,
          signal,
        })) {
          yield env.event;
        }
      } finally {
        stopCueTimer(input.eventId);
      }
    }),

  announce: orgProcedure
    .input(announceInput)
    .output(announceOutput)
    .mutation(async ({ ctx, input }) =>
      announce(ctx.db, input, ctx.session.user.id),
    ),

  /**
   * Ranked introductions.
   *
   * The guest and sponsor data is read through the contracts, never off
   * another agent's tables. While Agent 3 · ORACLE's `guests.list` is still a
   * stub this rethrows NOT_IMPLEMENTED naming the dependency, and the host
   * companion renders it as a pending panel rather than an empty list — an
   * empty list would read as "nobody here is worth meeting".
   */
  matchmaking: orgProcedure
    .input(matchmakingInput)
    .output(matchmakingOutput)
    .query(async ({ ctx, input }) => {
      const peers = await peerCaller(ctx);

      let guests: Guest[];
      try {
        const page = await peers.guests.list({
          eventId: input.eventId,
          limit: 200,
          sortBy: "engagementScore",
          sortDir: "desc",
        });
        guests = page.items;
      } catch (err) {
        throw pendingDependency(err, "guests.list", "Agent 3 · ORACLE");
      }

      // A missing Treasury only costs us the sponsor-driven matches, so this
      // one degrades instead of blocking.
      let sponsors: Sponsor[] = [];
      try {
        sponsors = (await peers.revenue.sponsors({ eventId: input.eventId }))
          .items;
      } catch (err) {
        if (!isNotImplemented(err)) throw err;
      }

      const arrived = new Set(
        (
          await ctx.db.checkIn.findMany({
            where: { eventId: input.eventId },
            select: { guestId: true },
          })
        ).map((c) => c.guestId),
      );

      return rankMatches({
        subject: input.guestId
          ? (guests.find((g) => g.id === input.guestId) ?? null)
          : null,
        guests,
        sponsors,
        arrived,
        introduced: introductionsFor(input.eventId),
        limit: input.limit,
      });
    }),

  markIntroduced: orgProcedure
    .input(markIntroducedInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ input }) => {
      recordIntroduction(input.eventId, input.guestId, input.withGuestId);
      return { ok: true as const };
    }),

  /** Guest app and info screens. No console session — they are in the room, not in the org. */
  guestFeed: publicProcedure
    .input(liveFeedInput)
    .subscription(async function* ({
      ctx,
      input,
      signal,
    }): AsyncGenerator<LiveEvent, void, unknown> {
      const channel = parseChannel(
        ctx.headers?.get("x-ovation-live-channel"),
        "guest-app",
      );
      // Guests get the audience channels only; never `ops`, never `door`.
      const audience = channel === "screens" ? "screens" : "guest-app";
      for await (const env of subscribe(input.eventId, {
        channel: audience,
        since: input.since ?? null,
        signal,
      })) {
        yield env.event;
      }
    }),
});

export type LiveRouter = typeof liveRouter;

export { pairKey };

// ── peer contracts ────────────────────────────────────────────

/**
 * A caller for the other agents' procedures.
 *
 * Imported lazily because the composed app router contains this router — a
 * static import would be a cycle. This is the only way this app reaches
 * another agent's data.
 */
async function peerCaller(ctx: Context) {
  const { createPeerCaller } = await import("../peers");
  return createPeerCaller(ctx);
}

function isNotImplemented(err: unknown): boolean {
  return err instanceof TRPCError && err.code === "NOT_IMPLEMENTED";
}

function pendingDependency(
  err: unknown,
  procedure: string,
  owner: string,
): unknown {
  if (!isNotImplemented(err)) return err;
  return new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `live.matchmaking is waiting on ${procedure} — owned by ${owner}.`,
  });
}
