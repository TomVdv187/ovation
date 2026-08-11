import {
  contractRouters,
  createAppRouter,
  createCallerFactory,
  type Context,
} from "@ovation/core";
import { db } from "@ovation/core/db";
import { pageRouter } from "./routers/page";

/**
 * The public app's router.
 *
 * Only `page` is implemented here — apps/events owns that surface and nothing
 * else. Every other entry stays the contract stub from @ovation/core so a
 * mistaken call fails loudly with NOT_IMPLEMENTED instead of quietly returning
 * something invented.
 *
 * apps/console/src/server/router.ts belongs to Agent 1 and is not touched:
 * Agent 7 · CRITIC swaps `page: contractRouters.page` for this router there in
 * Phase 3, which is why ./routers/page.ts imports nothing app-specific.
 */
export const appRouter = createAppRouter({
  event: contractRouters.event,
  page: pageRouter,
  guests: contractRouters.guests,
  revenue: contractRouters.revenue,
  live: contractRouters.live,
  agent: contractRouters.agent,
});

export type AppRouter = typeof appRouter;

/**
 * There is no sign-in on the public app, so the session is always null. That is
 * not a gap: `page.render` and `page.trackVisit` are publicProcedure by design,
 * and `page.updateFromTheme` is meant to be called from the console, where a
 * session exists.
 */
export function createContext(headers: Headers | null): Context {
  return { db, session: null, headers };
}

const createCaller = createCallerFactory(appRouter);

/** Server-side caller for React Server Components — no HTTP round trip. */
export function api(headers: Headers | null = null) {
  return createCaller(createContext(headers));
}
