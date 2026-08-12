import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  eventCreateInput,
  eventGetInput,
  eventListInput,
  eventSchema,
  eventStatsSchema,
  eventUpdateInput,
  orgProcedure,
  registrationsOverTimeSchema,
  router,
} from "@ovation/core";
import type { Db } from "@ovation/core/db";

/**
 * Event lifecycle. The console owns the write path; every other surface reads
 * through it.
 *
 * `update` is the ORGANISER's own edit. Anything the agent wants changed goes
 * agent.command -> AgentAction -> agent.approve instead.
 */
export const eventRouter = router({
  get: orgProcedure
    .input(eventGetInput)
    .output(eventSchema)
    .query(async ({ ctx, input }) => {
      if (!input.id && !input.slug) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Provide an id or a slug.",
        });
      }
      const event = await ctx.db.event.findFirst({
        where: {
          organisationId: ctx.session.user.organisationId!,
          ...(input.id ? { id: input.id } : {}),
          ...(input.slug ? { slug: input.slug } : {}),
        },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }
      return eventSchema.parse(event);
    }),

  list: orgProcedure
    .input(eventListInput)
    .output(z.object({ items: z.array(eventSchema) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.event.findMany({
        where: {
          // An organisationId on the input may never widen the caller's scope.
          organisationId: ctx.session.user.organisationId!,
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { date: "asc" },
      });
      return { items: items.map((e) => eventSchema.parse(e)) };
    }),

  create: orgProcedure
    .input(eventCreateInput)
    .output(eventSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.organisationId !== ctx.session.user.organisationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only create events in your own organisation.",
        });
      }
      const slug = await uniqueSlug(
        ctx.db,
        input.slug ?? slugify(input.title),
      );
      const event = await ctx.db.event.create({
        data: {
          organisationId: input.organisationId,
          title: input.title,
          slug,
          date: input.date,
          venue: input.venue,
          capacity: input.capacity,
          timezone: input.timezone,
          currency: input.currency,
          theme: { preset: "classic", palette: {}, typography: {} },
          agenda: { items: [] },
          registrationConfig: {},
        },
      });
      return eventSchema.parse(event);
    }),

  update: orgProcedure
    .input(eventUpdateInput)
    .output(eventSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, theme, agenda, registrationConfig, ...rest } = input;
      const existing = await ctx.db.event.findFirst({
        where: { id, organisationId: ctx.session.user.organisationId! },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      const merged = (current: unknown, patch: unknown) => ({
        ...(typeof current === "object" && current !== null ? current : {}),
        ...(typeof patch === "object" && patch !== null ? patch : {}),
      });

      const event = await ctx.db.event.update({
        where: { id },
        data: {
          ...rest,
          ...(theme ? { theme: merged(existing.theme, theme) } : {}),
          ...(agenda ? { agenda: agenda as unknown as object } : {}),
          ...(registrationConfig
            ? {
                registrationConfig: merged(
                  existing.registrationConfig,
                  registrationConfig,
                ),
              }
            : {}),
        },
      });
      return eventSchema.parse(event);
    }),

  stats: orgProcedure
    .input(z.object({ eventId: z.string() }))
    .output(eventStatsSchema)
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findFirst({
        where: {
          id: input.eventId,
          organisationId: ctx.session.user.organisationId!,
        },
        select: { id: true, capacity: true },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [
        registrations,
        confirmed,
        waitlisted,
        risk,
        revenue,
        agentActionsToday,
        pendingApprovals,
      ] = await Promise.all([
        ctx.db.guest.count({
          where: { eventId: event.id, registeredAt: { not: null } },
        }),
        ctx.db.guest.count({
          where: {
            eventId: event.id,
            rsvpStatus: { in: ["CONFIRMED", "CHECKED_IN"] },
          },
        }),
        ctx.db.guest.count({
          where: { eventId: event.id, rsvpStatus: "WAITLISTED" },
        }),
        ctx.db.guest.aggregate({
          where: {
            eventId: event.id,
            rsvpStatus: { in: ["CONFIRMED", "CHECKED_IN"] },
            noShowProbability: { not: null },
          },
          _avg: { noShowProbability: true },
        }),
        ctx.db.order.aggregate({
          where: { eventId: event.id, status: "PAID" },
          _sum: { amountCents: true },
        }),
        ctx.db.agentAction.count({
          where: { eventId: event.id, createdAt: { gte: startOfToday } },
        }),
        ctx.db.agentAction.count({
          where: { eventId: event.id, status: "PROPOSED" },
        }),
      ]);

      const avgNoShow = risk._avg.noShowProbability;
      // No scored guests yet means no honest prediction — 1.0 would be a lie of
      // a different kind, but it is at least the neutral prior.
      const predictedShowRate =
        avgNoShow === null || avgNoShow === undefined
          ? 1
          : Math.min(1, Math.max(0, 1 - avgNoShow));

      return {
        eventId: event.id,
        registrations,
        capacity: event.capacity,
        confirmed,
        waitlisted,
        predictedShowRate,
        // Ticket revenue from paid orders. The Overview's revenue tile reads
        // revenue.summary (packages/revenue) instead and shows a dash until
        // Agent 4 lands — a zero there would be a lie.
        revenueCents: revenue._sum.amountCents ?? 0,
        agentActionsToday,
        pendingApprovals,
      };
    }),

  registrationsOverTime: orgProcedure
    .input(z.object({ eventId: z.string(), days: z.number().int().default(30) }))
    .output(registrationsOverTimeSchema)
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findFirst({
        where: {
          id: input.eventId,
          organisationId: ctx.session.user.organisationId!,
        },
        select: { id: true },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      const days = Math.min(Math.max(input.days, 1), 365);
      const guests = await ctx.db.guest.findMany({
        where: { eventId: event.id, registeredAt: { not: null } },
        select: { registeredAt: true },
        orderBy: { registeredAt: "asc" },
      });

      const perDay = new Map<string, number>();
      for (const g of guests) {
        const key = dayKey(g.registeredAt!);
        perDay.set(key, (perDay.get(key) ?? 0) + 1);
      }

      // The window ends on the latest registration, not on today: an event
      // whose sign-ups closed weeks ago should still show its curve.
      const last = guests.at(-1)?.registeredAt ?? new Date();
      const end = new Date(Math.min(last.getTime(), Date.now()));
      const endDay = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
      );

      const startDay = new Date(endDay);
      startDay.setUTCDate(startDay.getUTCDate() - (days - 1));

      let cumulative = 0;
      for (const g of guests) {
        if (g.registeredAt! < startDay) cumulative += 1;
      }

      const points: {
        date: Date;
        registrations: number;
        cumulative: number;
      }[] = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(startDay);
        d.setUTCDate(d.getUTCDate() + i);
        const n = perDay.get(dayKey(d)) ?? 0;
        cumulative += n;
        points.push({ date: d, registrations: n, cumulative });
      }

      return { points };
    }),
});

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "event"
  );
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await db.event.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
