import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "~/server/router";

export const runtime = "nodejs";

/**
 * The only HTTP surface the browser talks to. The page body is server-rendered;
 * this endpoint exists for the visit beacon and for anything the console wants
 * to call against the public app.
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
