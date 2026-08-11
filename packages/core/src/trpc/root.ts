import type { AnyRouter } from "@trpc/server";
import { createCallerFactory, router } from "./init";
import { agentRouter } from "./routers/agent";
import { eventRouter } from "./routers/event";
import { guestsRouter } from "./routers/guests";
import { liveRouter } from "./routers/live";
import { pageRouter } from "./routers/page";
import { revenueRouter } from "./routers/revenue";

/**
 * The six sub-routers ARE the contract between the parallel agents.
 *
 * Each feature agent builds a router with the same procedure signatures inside
 * its own package and passes it to `createAppRouter` — nobody has to edit this
 * file to be wired in, which is what keeps five worktrees merging cleanly.
 */
export interface AppRouterParts extends Record<string, AnyRouter> {
  event: AnyRouter;
  page: AnyRouter;
  guests: AnyRouter;
  revenue: AnyRouter;
  live: AnyRouter;
  agent: AnyRouter;
}

export const contractRouters = {
  event: eventRouter,
  page: pageRouter,
  guests: guestsRouter,
  revenue: revenueRouter,
  live: liveRouter,
  agent: agentRouter,
} as const;

export function createAppRouter<T extends AppRouterParts>(parts: T) {
  return router(parts);
}

/** The all-stubs router. Every procedure throws NOT_IMPLEMENTED. */
export const appRouter = createAppRouter(contractRouters);

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
