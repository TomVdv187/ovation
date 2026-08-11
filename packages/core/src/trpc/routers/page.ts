import { z } from "zod";
import {
  pageRenderInput,
  pageRenderOutput,
  pageUpdateFromThemeInput,
} from "../../schemas/event";
import {
  notImplemented,
  orgProcedure,
  publicProcedure,
  router,
} from "../init";

const OWNER = "Agent 2 · MAISON (apps/events)";

/**
 * The public event page. `render` is deliberately public and unauthenticated —
 * it is the guest-facing surface — and returns the page as data so flipping
 * Event.theme restyles it with no code change.
 */
export const pageRouter = router({
  render: publicProcedure
    .input(pageRenderInput)
    .output(pageRenderOutput)
    .query(() => {
      throw notImplemented("page.render", OWNER);
    }),

  updateFromTheme: orgProcedure
    .input(pageUpdateFromThemeInput)
    .output(pageRenderOutput)
    .mutation(() => {
      throw notImplemented("page.updateFromTheme", OWNER);
    }),

  /** Fire-and-forget analytics from the public page. */
  trackVisit: publicProcedure
    .input(z.object({ slug: z.string(), referrer: z.string().nullish() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(() => {
      throw notImplemented("page.trackVisit", OWNER);
    }),
});
