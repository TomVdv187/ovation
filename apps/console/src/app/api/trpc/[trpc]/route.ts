import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "~/server/router";

export const runtime = "nodejs";

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
