import { createCallerFactory, router, type Context } from "@ovation/core";
import { guestsRouter } from "@ovation/guests";
import { revenueRouter } from "@ovation/revenue";

/**
 * In-process caller for the other agents' contracts.
 *
 * The host companion needs guests and sponsors. It gets them by calling
 * `guests.list` and `revenue.sponsors` exactly as any other consumer would —
 * no queries against tables this app does not own.
 *
 * Phase 3 (Agent 7 · CRITIC) note. This used to build the caller from *this
 * app's* composed `appRouter`. That was correct while the live router only ever
 * ran inside apps/live, but `liveRouter` is now also mounted in the console's
 * app router, and the peer caller followed the import — so `live.matchmaking`
 * called from the console resolved `guests.list` against apps/live's copy of
 * the router, where it was still a NOT_IMPLEMENTED stub. Matchmaking would have
 * reported "waiting on Agent 3 · ORACLE" forever, in the one app where ORACLE
 * is actually mounted.
 *
 * Binding the two peer routers directly makes the answer identical in every
 * host, and removes the router cycle that forced the lazy import at the call
 * site.
 */
const peerRouter = router({
  guests: guestsRouter,
  revenue: revenueRouter,
});

const caller = createCallerFactory(peerRouter);

export function createPeerCaller(ctx: Context) {
  return caller(ctx);
}
