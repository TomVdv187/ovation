/**
 * Agent 7 · CRITIC — the single Phase 3 migration.
 *
 * Four accepted contract changes needed a schema change (CC-002 Order.buyerName,
 * CC-006 CheckIn.idempotencyKey, CC-007 Introduction, CC-008 Cue). This applies
 * all four in ONE pass, per the brief's "migrated once, not four times".
 *
 * Why this and not `pnpm db:push`:
 *   - db:push was explicitly off-limits for this run, and `push.ts --force`
 *     is what db:reset uses to drop the fixture set;
 *   - the seeded database is the fixture set, shared, and irreplaceable here.
 *
 * Every statement below is additive and idempotent (IF NOT EXISTS), taken
 * verbatim from `prisma migrate diff --from-schema-datamodel <pre-Phase-3>
 * --to-schema-datamodel <current> --script`, which contains no DROP, no column
 * type change and no NOT NULL on an existing table. Re-running it is a no-op.
 *
 * The unique index on (eventId, idempotencyKey) is safe against the existing
 * rows because Postgres treats NULLs as distinct in a unique index.
 *
 * Run:  npx tsx --env-file=.env scripts/critic/migrate-cc.ts
 */
import { db } from "@ovation/core/db";

const STATEMENTS: string[] = [
  // CC-002
  `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "buyerName" TEXT`,
  // CC-006
  `ALTER TABLE "CheckIn" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CheckIn_eventId_idempotencyKey_key" ON "CheckIn"("eventId", "idempotencyKey")`,
  // CC-007
  `CREATE TABLE IF NOT EXISTS "Introduction" (
     "id" TEXT NOT NULL,
     "eventId" TEXT NOT NULL,
     "guestId" TEXT NOT NULL,
     "withGuestId" TEXT NOT NULL,
     "introducedBy" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "Introduction_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "Introduction_eventId_idx" ON "Introduction"("eventId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Introduction_eventId_guestId_withGuestId_key" ON "Introduction"("eventId", "guestId", "withGuestId")`,
  // CC-008
  `CREATE TABLE IF NOT EXISTS "Cue" (
     "id" TEXT NOT NULL,
     "eventId" TEXT NOT NULL,
     "label" TEXT NOT NULL,
     "trigger" JSONB NOT NULL,
     "auto" BOOLEAN NOT NULL DEFAULT false,
     "enabled" BOOLEAN NOT NULL DEFAULT true,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "Cue_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "Cue_eventId_idx" ON "Cue"("eventId")`,
  // Foreign keys. Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guard on
  // pg_constraint.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Introduction_eventId_fkey') THEN
       ALTER TABLE "Introduction" ADD CONSTRAINT "Introduction_eventId_fkey"
         FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Cue_eventId_fkey') THEN
       ALTER TABLE "Cue" ADD CONSTRAINT "Cue_eventId_fkey"
         FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
     END IF;
   END $$`,
];

async function main() {
  const before = {
    guests: await db.guest.count(),
    orders: await db.order.count(),
    sponsors: await db.sponsor.count(),
    events: await db.event.count(),
  };
  console.log("row counts before:", before);

  for (const sql of STATEMENTS) {
    const head = sql.trim().split("\n")[0]!.slice(0, 84);
    await db.$executeRawUnsafe(sql);
    console.log("  ok  ", head);
  }

  const after = {
    guests: await db.guest.count(),
    orders: await db.order.count(),
    sponsors: await db.sponsor.count(),
    events: await db.event.count(),
  };
  console.log("row counts after: ", after);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  console.log(unchanged ? "UNCHANGED — no data touched" : "DATA CHANGED — investigate");
  if (!unchanged) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
