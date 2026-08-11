import { loadRootEnv } from "./env";

/**
 * Proves the room cannot be oversold.
 *
 *   pnpm --filter @ovation/events verify:oversell
 *
 * Opens a throwaway tier with a single seat on the seeded event, fires a dozen
 * concurrent checkouts at it, and asserts that exactly one came back with an
 * order and that sold never passed quota. Then does it again with a wider tier
 * and a quantity that straddles the last seats, because "two people want one
 * chair" is only the easy half of the problem. Finally it abandons a checkout
 * and checks the seat comes back.
 *
 * The tiers and every order they produce are removed afterwards.
 */

const CONCURRENCY = 12;

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  loadRootEnv();

  const { db } = await import("@ovation/core/db");
  const { startCheckout, releaseOrder } = await import(
    "../src/server/ticketing"
  );

  const arg = process.argv[2];
  const slug = arg && !arg.startsWith("--") ? arg : "meridian-summit-2026";

  const event = await db.event.findUnique({
    where: { slug },
    select: { id: true, title: true },
  });
  if (!event) {
    console.error(`No event with slug "${slug}". Run pnpm db:seed first.`);
    process.exit(1);
  }

  console.log(`\n${event.title} — hammering the last seat\n`);

  async function withTier<T>(
    name: string,
    quota: number,
    run: (tierId: string) => Promise<T>,
  ): Promise<T> {
    await db.order.deleteMany({
      where: { tier: { name, eventId: event!.id } },
    });
    await db.ticketTier.deleteMany({ where: { eventId: event!.id, name } });

    const tier = await db.ticketTier.create({
      data: {
        eventId: event!.id,
        name,
        priceCents: 1000,
        quota,
        sold: 0,
        status: "ON_SALE",
        sortOrder: 99,
      },
      select: { id: true },
    });

    try {
      return await run(tier.id);
    } finally {
      await db.order.deleteMany({ where: { tierId: tier.id } });
      await db.ticketTier.delete({ where: { id: tier.id } });
    }
  }

  // ── one seat, twelve buyers ─────────────────────────────────
  await withTier("__verify_single", 1, async (tierId) => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        startCheckout({
          slug,
          tierId,
          quantity: 1,
          email: `race-${i}@ovation.test`,
          name: `Racer ${i}`,
        }),
      ),
    );

    const won = results.filter((r) => r.ok);
    const tier = await db.ticketTier.findUnique({
      where: { id: tierId },
      select: { sold: true, quota: true, status: true },
    });

    console.log(`  ${CONCURRENCY} concurrent buyers, quota 1`);
    check("exactly one checkout succeeded", won.length === 1, `${won.length} did`);
    check("sold equals quota", tier?.sold === 1, `sold=${tier?.sold}`);
    check("sold never exceeded quota", (tier?.sold ?? 0) <= (tier?.quota ?? 0));
    check(
      "the tier closed itself",
      tier?.status === "SOLD_OUT",
      String(tier?.status),
    );

    const orders = await db.order.count({ where: { tierId } });
    check("exactly one order exists", orders === 1, `${orders} orders`);
  });

  // ── four seats, twelve buyers asking for two each ───────────
  await withTier("__verify_multi", 4, async (tierId) => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        startCheckout({
          slug,
          tierId,
          quantity: 2,
          email: `pair-${i}@ovation.test`,
          name: `Pair ${i}`,
        }),
      ),
    );

    const won = results.filter((r) => r.ok);
    const tier = await db.ticketTier.findUnique({
      where: { id: tierId },
      select: { sold: true, quota: true },
    });

    console.log(`\n  ${CONCURRENCY} concurrent buyers, 2 seats each, quota 4`);
    check(
      "exactly two checkouts succeeded",
      won.length === 2,
      `${won.length} did`,
    );
    check("sold equals quota", tier?.sold === 4, `sold=${tier?.sold}`);
    check("sold never exceeded quota", (tier?.sold ?? 0) <= (tier?.quota ?? 0));
  });

  // ── an abandoned checkout gives the seat back ───────────────
  await withTier("__verify_release", 1, async (tierId) => {
    const first = await startCheckout({
      slug,
      tierId,
      quantity: 1,
      email: "abandoner@ovation.test",
      name: "Abandoner",
    });
    if (!first.ok) throw new Error("could not take the seat");

    await releaseOrder(first.orderId, "CANCELLED");

    const tier = await db.ticketTier.findUnique({
      where: { id: tierId },
      select: { sold: true, status: true },
    });

    console.log("\n  abandoned checkout");
    check("the seat came back", tier?.sold === 0, `sold=${tier?.sold}`);
    check("the tier reopened", tier?.status === "ON_SALE", String(tier?.status));

    const second = await startCheckout({
      slug,
      tierId,
      quantity: 1,
      email: "second-chance@ovation.test",
      name: "Second Chance",
    });
    check("someone else can now buy it", second.ok);

    const releasedTwice = await releaseOrder(first.orderId, "CANCELLED");
    check("releasing the same order twice is a no-op", releasedTwice === false);
  });

  await db.$disconnect();
}

main()
  .then(() => {
    console.log(
      failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
