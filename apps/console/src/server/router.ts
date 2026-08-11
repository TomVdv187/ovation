import {
  contractRouters,
  createAppRouter,
  type Context,
} from "@ovation/core";
import { db } from "@ovation/core/db";
import { auth } from "./auth";
import { agentRouter } from "./routers/agent";
import { eventRouter } from "./routers/event";

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
  // Owned by Agent 1 · CONDUCTOR.
  event: eventRouter,
  agent: agentRouter,
  // Owned by Agents 2–5. Still the NOT_IMPLEMENTED stubs; Agent 7 · CRITIC
  // mounts them in Phase 3. The console renders a pending state for these,
  // which is the correct Phase 2 behaviour rather than a fault.
  page: contractRouters.page,
  guests: contractRouters.guests,
  revenue: contractRouters.revenue,
  live: contractRouters.live,
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
