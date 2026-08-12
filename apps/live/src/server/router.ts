import { contractRouters, createAppRouter } from "@ovation/core";
import { guestsRouter } from "@ovation/guests";
import { revenueRouter } from "@ovation/revenue";
import { liveRouter } from "./live/router";

/**
 * This app's router.
 *
 * `live` is ours. Phase 3 also mounts `guests` and `revenue` here: the host
 * companion reads both through the contract, and leaving them as stubs meant
 * the host phone showed a permanent pending panel even though ORACLE and
 * TREASURY had shipped. `event`, `page` and `agent` stay stubs deliberately —
 * this app never calls them, and a stub fails loudly rather than inventing.
 */
export const appRouter = createAppRouter({
  event: contractRouters.event,
  page: contractRouters.page,
  guests: guestsRouter,
  revenue: revenueRouter,
  live: liveRouter,
  agent: contractRouters.agent,
});

export type AppRouter = typeof appRouter;

export { createContext } from "./context";
