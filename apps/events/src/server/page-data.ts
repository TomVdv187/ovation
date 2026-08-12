import { cache } from "react";
import { TRPCError } from "@trpc/server";
import type { PageRender } from "@ovation/core";
import { api } from "./router";

/**
 * The page as the router returns it, memoised for the render pass.
 *
 * The layout needs the theme and the page needs the sections; React's `cache`
 * makes that one database round trip rather than two. Everything the public
 * surface displays comes through here, which is what keeps page.render honest —
 * if the procedure is wrong, the page is visibly wrong.
 */
export const getPage = cache(
  async (slug: string, preview = false): Promise<PageRender | null> => {
    try {
      return await api().page.render({ slug, preview });
    } catch (cause) {
      // A missing event is a 404, not a 500. Anything else is a real fault and
      // must not be disguised as one.
      if (cause instanceof TRPCError && cause.code === "NOT_FOUND") return null;
      throw cause;
    }
  },
);
