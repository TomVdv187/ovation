import {
  contractRouters,
  createAppRouter,
  type Context,
} from "@ovation/core";
import { db } from "@ovation/core/db";
import { auth } from "./auth";

/**
 * The console composes the app router.
 *
 * Every entry below is still the NOT_IMPLEMENTED stub from @ovation/core.
 * A feature agent wires itself in by swapping ONE line here for its own
 * router — no edits to packages/core, no cross-worktree conflicts:
 *
 *   import { guestsRouter } from "@ovation/guests";
 *   ...
 *   guests: guestsRouter,
 */
export const appRouter = createAppRouter({
  event: contractRouters.event,
  page: contractRouters.page,
  guests: contractRouters.guests,
  revenue: contractRouters.revenue,
  live: contractRouters.live,
  agent: contractRouters.agent,
});

export type AppRouter = typeof appRouter;

export async function createContext(headers: Headers): Promise<Context> {
  const session = await auth();
  return {
    db,
    session: session?.user
      ? {
          user: {
            id: session.user.id,
            email: session.user.email ?? "",
            name: session.user.name ?? null,
            organisationId: session.user.organisationId,
            role: session.user.role,
          },
        }
      : null,
    headers,
  };
}
