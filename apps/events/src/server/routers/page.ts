import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  eventSchema,
  eventThemeSchema,
  pageRenderInput,
  pageRenderOutput,
  pageUpdateFromThemeInput,
  publicProcedure,
  orgProcedure,
  router,
  type PageRender,
} from "@ovation/core";
import type { Context } from "@ovation/core";
import type { Prisma } from "@ovation/core/db";
import { shouldCountVisit, visitorKey } from "../analytics";
import {
  findPublicEvent,
  parseAgenda,
  parseRegistrationConfig,
  tierAvailability,
} from "../event";
import { buildSections } from "../sections";
import { parseTheme } from "../../lib/theme";

/**
 * page.* — the public event page as data.
 *
 * Signatures are the contract in packages/core/src/trpc/routers/page.ts, down
 * to which procedures are public: `render` and `trackVisit` are unauthenticated
 * because the people using them are guests, not console users.
 *
 * Deliberately depends on nothing but @ovation/core and ctx.db, so Agent 7 can
 * mount it in the console during Phase 3 without dragging this app's runtime
 * along.
 */

async function renderPage(
  db: Context["db"],
  slug: string,
  preview: boolean,
): Promise<PageRender> {
  const event = await findPublicEvent(slug, preview, db);
  if (!event) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No published event at /e/${slug}.`,
    });
  }

  const theme = parseTheme(event.theme);
  const config = parseRegistrationConfig(event.registrationConfig);
  const ticketTiersAvailable = event.ticketTiers.some(
    (tier) => tierAvailability(tier).purchasable,
  );

  return {
    event: eventSchema.parse(event),
    theme,
    ticketTiersAvailable,
    sections: buildSections({
      event,
      organisationName: event.organisation?.name ?? null,
      theme,
      agenda: parseAgenda(event.agenda),
      sponsors: event.sponsors,
      consentText: config.consentText,
      ticketsAvailable: ticketTiersAvailable,
    }),
  };
}

export const pageRouter = router({
  render: publicProcedure
    .input(pageRenderInput)
    .output(pageRenderOutput)
    .query(({ ctx, input }) => renderPage(ctx.db, input.slug, input.preview)),

  updateFromTheme: orgProcedure
    .input(pageUpdateFromThemeInput)
    .output(pageRenderOutput)
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({
        where: { id: input.eventId },
        select: { slug: true, theme: true, organisationId: true },
      });

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Unknown event." });
      }
      if (event.organisationId !== ctx.session.user.organisationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That event belongs to another organisation.",
        });
      }

      // Partial patch over what is stored: the console sends only what the
      // organiser (or the agent) changed, and palette/typography merge a level
      // deeper so tweaking one colour does not wipe the rest.
      const current = parseTheme(event.theme);
      const merged = eventThemeSchema.parse({
        ...current,
        ...input.theme,
        palette: { ...current.palette, ...(input.theme.palette ?? {}) },
        typography: { ...current.typography, ...(input.theme.typography ?? {}) },
      });

      await ctx.db.event.update({
        where: { id: input.eventId },
        data: { theme: merged as unknown as Prisma.InputJsonValue },
      });

      return renderPage(ctx.db, event.slug, true);
    }),

  /** Fire-and-forget analytics from the public page. */
  trackVisit: publicProcedure
    .input(z.object({ slug: z.string(), referrer: z.string().nullish() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      if (!shouldCountVisit(visitorKey(input.slug, ctx.headers))) {
        return { ok: true as const };
      }

      // Atomic increment, and updateMany so an unknown slug is a no-op rather
      // than an exception on a path the guest can see.
      await ctx.db.event.updateMany({
        where: { slug: input.slug },
        data: { pageVisits: { increment: 1 } },
      });

      return { ok: true as const };
    }),
});
