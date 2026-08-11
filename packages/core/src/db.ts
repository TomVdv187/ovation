import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

/**
 * Prisma client.
 *
 * Against a Neon database we go through the serverless driver adapter, which
 * speaks Postgres over WebSocket on :443 rather than raw TCP on :5432. Two
 * reasons, and both matter:
 *
 *   1. It is the right shape for serverless — no connection-pool exhaustion
 *      when Vercel spins up a function per request.
 *   2. Plenty of corporate networks block outbound 5432 entirely. Over 443 the
 *      repo works from anywhere.
 *
 * Anything that is not a Neon URL (a local Postgres, CI, a container) gets the
 * plain TCP client, so nothing here forces a hosted database on you.
 */

const globalForPrisma = globalThis as unknown as {
  ovationPrisma: PrismaClient | undefined;
};

// The driver picks up the runtime's native WebSocket. Do NOT wire in the `ws`
// package as a shim: webpack mangles its optional native addon and you get
// "bufferUtil.mask is not a function" at request time. Node 22+ required.

function isNeon(url: string | undefined): boolean {
  return Boolean(url && /neon\.(tech|build)/.test(url));
}

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  const log =
    process.env.NODE_ENV === "development"
      ? (["warn", "error"] as const)
      : (["error"] as const);

  if (isNeon(url)) {
    return new PrismaClient({
      adapter: new PrismaNeon({ connectionString: url }),
      log: [...log],
    });
  }

  return new PrismaClient({ log: [...log] });
}

export const db = globalForPrisma.ovationPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.ovationPrisma = db;
}

export type Db = typeof db;

export * from "@prisma/client";
