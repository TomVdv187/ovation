import {
  eventCreateInput,
  eventGetInput,
  eventListInput,
  eventSchema,
  eventStatsSchema,
  eventUpdateInput,
  registrationsOverTimeSchema,
} from "../../schemas/event";
import { z } from "zod";
import { notImplemented, orgProcedure, router } from "../init";

const OWNER = "Agent 1 · CONDUCTOR (apps/console)";

/**
 * Event lifecycle. Implemented by the Conductor because the console owns the
 * write path; every other surface reads through it.
 */
export const eventRouter = router({
  get: orgProcedure
    .input(eventGetInput)
    .output(eventSchema)
    .query(() => {
      throw notImplemented("event.get", OWNER);
    }),

  list: orgProcedure
    .input(eventListInput)
    .output(z.object({ items: z.array(eventSchema) }))
    .query(() => {
      throw notImplemented("event.list", OWNER);
    }),

  create: orgProcedure
    .input(eventCreateInput)
    .output(eventSchema)
    .mutation(() => {
      throw notImplemented("event.create", OWNER);
    }),

  /**
   * Direct writes are for the organiser's own edits. Anything the AGENT wants
   * to change goes through agent.command -> AgentAction -> agent.approve.
   */
  update: orgProcedure
    .input(eventUpdateInput)
    .output(eventSchema)
    .mutation(() => {
      throw notImplemented("event.update", OWNER);
    }),

  stats: orgProcedure
    .input(z.object({ eventId: z.string() }))
    .output(eventStatsSchema)
    .query(() => {
      throw notImplemented("event.stats", OWNER);
    }),

  registrationsOverTime: orgProcedure
    .input(z.object({ eventId: z.string(), days: z.number().int().default(30) }))
    .output(registrationsOverTimeSchema)
    .query(() => {
      throw notImplemented("event.registrationsOverTime", OWNER);
    }),
});
