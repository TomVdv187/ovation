import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Db } from "../db";
import type { UserRoleT } from "../schemas/common";

/**
 * tRPC foundation. Every app and feature package builds its procedures from
 * these exports so a router written in packages/revenue drops into the console
 * unchanged.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  organisationId: string | null;
  role: UserRoleT;
}

export interface Context {
  db: Db;
  session: { user: SessionUser } | null;
  headers: Headers | null;
}

export interface AuthedContext extends Context {
  session: { user: SessionUser };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;

/** Anyone, including the public event pages. */
export const publicProcedure = t.procedure;

/** A signed-in console user. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/** A signed-in user who belongs to an organisation — the default for features. */
export const orgProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.user.organisationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User is not attached to an organisation.",
    });
  }
  return next({ ctx });
});

/**
 * Marks a contract procedure that no agent has implemented yet. The signature
 * above it IS the contract — replace only the body.
 */
export function notImplemented(procedure: string, owner: string): TRPCError {
  return new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${procedure} is not implemented yet — owned by ${owner}.`,
  });
}
