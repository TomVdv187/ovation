/**
 * Agent 7 · CRITIC — fixture verification.
 *
 * Reads the seeded invariants the brief pins. Read-only: nothing here writes.
 * Run:  npx tsx --env-file=.env scripts/critic/fixtures.ts
 */
import { db } from "@ovation/core/db";

async function main() {
  const ev = await db.event.findFirst({
    where: { title: { contains: "2026" } },
    select: {
      id: true,
      title: true,
      slug: true,
      theme: true,
      organisationId: true,
    },
  });
  console.log(
    "event:",
    ev?.id,
    ev?.title,
    ev?.slug,
    "theme.preset=",
    (ev?.theme as { preset?: string } | null)?.preset,
  );
  if (!ev) return;

  const byStatus = await db.order.groupBy({
    by: ["status"],
    where: { eventId: ev.id },
    _sum: { amountCents: true },
    _count: true,
  });
  console.log("orders by status:", JSON.stringify(byStatus));

  const sponsors = await db.sponsor.groupBy({
    by: ["status"],
    where: { eventId: ev.id },
    _sum: { amountCents: true },
    _count: true,
  });
  console.log("sponsors by status:", JSON.stringify(sponsors));

  const guests = await db.guest.count({ where: { eventId: ev.id } });
  const testEmails = await db.guest.count({
    where: { eventId: ev.id, email: { contains: ".test" } },
  });
  console.log("guests:", guests, "with .test email:", testEmails);
  console.log(
    "checkins:",
    await db.checkIn.count({ where: { eventId: ev.id } }),
  );
  console.log(
    "PROPOSED actions:",
    await db.agentAction.count({
      where: { eventId: ev.id, status: "PROPOSED" },
    }),
  );
  console.log(
    "tiers:",
    JSON.stringify(
      await db.ticketTier.findMany({
        where: { eventId: ev.id },
        select: { id: true, name: true, priceCents: true, quota: true, sold: true, status: true },
      }),
    ),
  );
  console.log(
    "totals — events:",
    await db.event.count(),
    "orgs:",
    await db.organisation.count(),
    "guests(all):",
    await db.guest.count(),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
