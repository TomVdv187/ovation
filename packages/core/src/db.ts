import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  ovationPrisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.ovationPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.ovationPrisma = db;
}

export type Db = typeof db;

export * from "@prisma/client";
