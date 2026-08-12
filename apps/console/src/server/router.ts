import { createAppRouter, type Context } from "@ovation/core";
import { db } from "@ovation/core/db";
import { pageRouter } from "@ovation/events/page-router";
import { guestsRouter } from "@ovation/guests";
import { liveRouter } from "@ovation/live/live-router";
import { revenueRouter } from "@ovation/revenue";
import { auth } from "./auth";
import { agentRouter } from "./routers/agent";
import { eventRouter } from "./routers/event";

/**
 * The console composes the app router. Phase 3: every contract stub is gone.
 *
 * `guests` and `revenue` are library packages and mounted exactly as designed.
 * `page` and `live` live inside sibling Next apps, so mounting them needed an
 * `exports` subpath on each app's package.json and a workspace dependency here
 * — see INTEGRATION_REPORT.md, "what the one-line claim actually cost".
 */
export const appRouter = createAppRouter({
  // Owned by Agent 1 · CONDUCTOR.
  event: eventRouter,
  agent: agentRouter,
  // Owned by Agents 2–5, mounted by Agent 7 · CRITIC in Phase 3.
  page: pageRouter,
  guests: guestsRouter,
  revenue: revenueRouter,
  live: liveRouter,
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
