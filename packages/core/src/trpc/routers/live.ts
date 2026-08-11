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
  type LiveEvent,
} from "../../schemas/live";
import {
  notImplemented,
  orgProcedure,
  publicProcedure,
  router,
} from "../init";

const OWNER = "Agent 5 · MAÎTRE D' (apps/live)";

export const liveRouter = router({
  /**
   * Door scan. Idempotent by `idempotencyKey` so replaying an offline queue is
   * safe, and rejections come back as outcomes rather than thrown errors — the
   * scanner UI needs to render "wrong event" as fast as a success.
   */
  checkin: orgProcedure
    .input(checkinInput)
    .output(checkinOutput)
    .mutation(() => {
      throw notImplemented("live.checkin", OWNER);
    }),

  ops: orgProcedure
    .input(opsSnapshotInput)
    .output(opsSnapshotOutput)
    .query(() => {
      throw notImplemented("live.ops", OWNER);
    }),

  /**
   * Realtime feed for the ops dashboard, host companion and info screens.
   * `since` lets a reconnecting client replay what it missed.
   */
  feed: orgProcedure
    .input(liveFeedInput)
    // eslint-disable-next-line require-yield
    .subscription(async function* (): AsyncGenerator<LiveEvent, void, unknown> {
      throw notImplemented("live.feed", OWNER);
    }),

  announce: orgProcedure
    .input(announceInput)
    .output(announceOutput)
    .mutation(() => {
      throw notImplemented("live.announce", OWNER);
    }),

  matchmaking: orgProcedure
    .input(matchmakingInput)
    .output(matchmakingOutput)
    .query(() => {
      throw notImplemented("live.matchmaking", OWNER);
    }),

  markIntroduced: orgProcedure
    .input(markIntroducedInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(() => {
      throw notImplemented("live.markIntroduced", OWNER);
    }),

  /** The guest-facing announcement stream needs no console session. */
  guestFeed: publicProcedure
    .input(liveFeedInput)
    // eslint-disable-next-line require-yield
    .subscription(async function* (): AsyncGenerator<LiveEvent, void, unknown> {
      throw notImplemented("live.guestFeed", OWNER);
    }),
});
