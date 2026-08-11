import { contractRouters, createAppRouter } from "@ovation/core";
import { liveRouter } from "./live/router";

/**
 * This app's router.
 *
 * `live` is ours; every other entry is still the NOT_IMPLEMENTED stub from
 * @ovation/core, which is exactly what the host companion's pending state is
 * built against. Agent 7 · CRITIC makes the same one-line swap in
 * apps/console/src/server/router.ts to mount us there.
 */
export const appRouter = createAppRouter({
  event: contractRouters.event,
  page: contractRouters.page,
  guests: contractRouters.guests,
  revenue: contractRouters.revenue,
  live: liveRouter,
  agent: contractRouters.agent,
});

export type AppRouter = typeof appRouter;

export { createContext } from "./context";
