import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { currencySchema, protectedProcedure, router } from "@ovation/core";

/**
 * First run.
 *
 * Every other procedure in the console is an `orgProcedure`, which answers
 * FORBIDDEN until `User.organisationId` points somewhere. Nothing in the
 * application ever set it: NextAuth's adapter writes a User with the column
 * null, `db:seed` fills it for the demo, and `db:bootstrap` fills it from a
 * terminal with the database credentials to hand. On a fresh production
 * database that leaves a console you can sign into and cannot use — which is
 * exactly what production was: schema pushed, zero rows, no way in from the
 * product itself.
 *
 * So this is the one mutation that runs BEFORE an organisation exists. It is a
 * `protectedProcedure` for that reason, and it refuses anyone who already has
 * one, so it cannot be used to hop tenants or to rename an organisation from
 * the sign-in path.
 *
 * The first event is created in the same transaction on purpose. An
 * organisation with no event is the other half of the same dead end: the
 * layout says "No event yet", the agent panel has nothing to work on, and the
 * public site has nothing to serve.
 */

const firstEvent = z.object({
  title: z.string().min(1).max(200),
  date: z.coerce.date(),
  venue: z.string().min(1).max(200),
  capacity: z.number().int().positive().max(1_000_000),
  timezone: z.string().default("Europe/Brussels"),
  currency: currencySchema.default("EUR"),
  /**
   * Published, or the public pages stay empty and the first thing the owner
   * sees is the same "nothing published yet" they came here to fix. Opt-out
   * rather than opt-in, and reversible from the event page.
   */
  publish: z.boolean().default(true),
});

export const organisationCreateInput = z.object({
  name: z.string().min(1).max(120),
  event: firstEvent.optional(),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 60) || "org"
  );
}

/** `slug` is unique on both tables, and a first run must not fail on a clash. */
async function freeSlug(
  taken: (candidate: string) => Promise<boolean>,
  base: string,
): Promise<string> {
  if (!(await taken(base))) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "Could not find a free slug for that name.",
  });
}

export const organisationRouter = router({
  create: protectedProcedure
    .input(organisationCreateInput)
    .output(
      z.object({
        organisationId: z.string(),
        eventId: z.string().nullable(),
        eventSlug: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Read the row, not the session: a session is minted at sign-in and a
      // second submit of the same form would otherwise still look org-less.
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { organisationId: true },
      });
      if (user?.organisationId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already belong to an organisation.",
        });
      }

      const orgSlug = await freeSlug(
        async (candidate) =>
          (await ctx.db.organisation.count({ where: { slug: candidate } })) > 0,
        slugify(input.name),
      );

      const eventSlug = input.event
        ? await freeSlug(
            async (candidate) =>
              (await ctx.db.event.count({ where: { slug: candidate } })) > 0,
            slugify(input.event.title),
          )
        : null;

      return ctx.db.$transaction(async (tx) => {
        const organisation = await tx.organisation.create({
          data: {
            name: input.name,
            slug: orgSlug,
            settings: {
              autoApproveCosmetic: false,
              defaultCurrency: input.event?.currency ?? "EUR",
              locale: "en-GB",
            },
          },
          select: { id: true },
        });

        // OWNER: whoever stands the organisation up owns it. Conditional on
        // organisationId still being null so two submits in flight cannot both
        // claim the user — the loser updates nothing and its transaction is
        // rolled back by the check below.
        const claimed = await tx.user.updateMany({
          where: { id: ctx.session.user.id, organisationId: null },
          data: { organisationId: organisation.id, role: "OWNER" },
        });
        if (claimed.count === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "You already belong to an organisation.",
          });
        }

        if (!input.event || !eventSlug) {
          return {
            organisationId: organisation.id,
            eventId: null,
            eventSlug: null,
          };
        }

        const event = await tx.event.create({
          data: {
            organisationId: organisation.id,
            title: input.event.title,
            slug: eventSlug,
            date: input.event.date,
            venue: input.event.venue,
            capacity: input.event.capacity,
            timezone: input.event.timezone,
            currency: input.event.currency,
            status: input.event.publish ? "PUBLISHED" : "DRAFT",
            theme: { preset: "classic", palette: {}, typography: {} },
            agenda: { items: [] },
            registrationConfig: {},
          },
          select: { id: true, slug: true },
        });

        return {
          organisationId: organisation.id,
          eventId: event.id,
          eventSlug: event.slug,
        };
      });
    }),
});
