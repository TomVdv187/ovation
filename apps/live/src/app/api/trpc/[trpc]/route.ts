import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "~/server/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The live app serves its own tRPC endpoint so the door tablet talks to the
 * box in the venue, not across the internet to the console. Same router
 * shape either way.
 */
function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req.headers),
    onError({ path, error }) {
      if (error.code === "NOT_IMPLEMENTED") {
        console.warn(`[trpc] ${path ?? "<no-path>"} — not implemented yet`);
        return;
      }
      console.error(`[trpc] ${path ?? "<no-path>"}:`, error.message);
    },
  });
}

export { handler as GET, handler as POST };
