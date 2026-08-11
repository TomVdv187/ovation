import "server-only";
import { headers } from "next/headers";
import { createCallerFactory } from "@ovation/core";
import { appRouter, createContext } from "~/server/router";

/**
 * Server-side caller — for React Server Components and route handlers that
 * want contract data without an HTTP round trip.
 */
const createCaller = createCallerFactory(appRouter);

export async function api() {
  const h = await headers();
  return createCaller(await createContext(h));
}
