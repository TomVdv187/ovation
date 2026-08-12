/**
 * Agent 7 · CRITIC — adversarial pass, part 2: overselling.
 *
 * MAISON's claim: safe at 12 concurrent buyers. The brief asked for
 * considerably more, so this runs 120, then 200 with multi-seat orders, then a
 * mixed pattern designed to make the "close the tier" statement race the
 * "take the seats" statement.
 *
 * Runs against the critic rig's event A, never Meridian Summit 2026.
 */
import { db } from "@ovation/core/db";
import { bad, note, ok, setup, teardown } from "../../../scripts/critic/rig";
import { startCheckout } from "../src/server/ticketing";

type Attempt = { ok: false; errors: Record<string, string>; formError: string | null };

async function tierState(tierId: string) {
  const t = await db.ticketTier.findUniqueOrThrow({
    where: { id: tierId },
    select: { sold: true, quota: true, status: true },
  });
  const orders = await db.order.aggregate({
    where: { tierId, status: { in: ["PENDING", "PAID"] } },
    _sum: { quantity: true },
    _count: true,
  });
  return {
    sold: t.sold,
    quota: t.quota,
    status: t.status,
    orders: orders._count,
    seatsOrdered: orders._sum.quantity ?? 0,
  };
}

async function main() {
  const rig = await setup();

  // ── B1 · 120 concurrent single-seat buyers on a 10-seat tier ─────────
  console.log("\nB1 · 120 concurrent buyers, 10 seats, 1 seat each");
  {
    const results = await Promise.all(
      Array.from({ length: 120 }, (_, i) =>
        startCheckout({
          slug: rig.slugA,
          tierId: rig.scarceTier,
          quantity: 1,
          email: `b1-${i}@example.invalid`,
          name: `Buyer ${i}`,
        }).catch((e): Attempt => ({ ok: false, errors: {}, formError: String(e) })),
      ),
    );
    const won = results.filter((r) => r.ok).length;
    const state = await tierState(rig.scarceTier);
    console.log(`      won=${won} ${JSON.stringify(state)}`);
    if (won === 10 && state.sold === 10 && state.seatsOrdered === 10) {
      ok("B1 exactly the quota was sold", `status=${state.status}`);
    } else {
      bad(
        "B1 exactly the quota was sold",
        `won=${won} sold=${state.sold} seatsOrdered=${state.seatsOrdered}`,
      );
    }
    if (state.status === "SOLD_OUT") ok("B1 tier closed itself");
    else bad("B1 tier closed itself", state.status);
  }

  // ── B2 · multi-seat orders straddling the last seats ────────────────
  console.log("\nB2 · 200 concurrent buyers, 60 seats, 1-4 seats each");
  {
    const tier = await db.ticketTier.create({
      data: {
        eventId: rig.eventA,
        name: "Straddle",
        priceCents: 2500,
        quota: 60,
        sold: 0,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 3,
      },
    });
    const quantities = Array.from({ length: 200 }, (_, i) => (i % 4) + 1);
    const results = await Promise.all(
      quantities.map((q, i) =>
        startCheckout({
          slug: rig.slugA,
          tierId: tier.id,
          quantity: q,
          email: `b2-${i}@example.invalid`,
          name: `Buyer ${i}`,
        }).catch((e): Attempt => ({ ok: false, errors: {}, formError: String(e) })),
      ),
    );
    const won = results.filter((r) => r.ok).length;
    const state = await tierState(tier.id);
    console.log(`      won=${won} ${JSON.stringify(state)}`);
    if (state.sold <= 60 && state.seatsOrdered === state.sold) {
      ok(
        "B2 never sold past quota, and sold matches seats ordered",
        `sold=${state.sold}/60 across ${state.orders} orders`,
      );
    } else {
      bad(
        "B2 never sold past quota",
        `sold=${state.sold} seatsOrdered=${state.seatsOrdered}`,
      );
    }
  }

  // ── B3 · buy exactly the last seat, 300 ways, one seat left ──────────
  console.log("\nB3 · one seat left, 300 concurrent attempts");
  {
    const tier = await db.ticketTier.create({
      data: {
        eventId: rig.eventA,
        name: "LastSeat",
        priceCents: 1000,
        quota: 100,
        sold: 99,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 4,
      },
    });
    const results = await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        startCheckout({
          slug: rig.slugA,
          tierId: tier.id,
          quantity: 1,
          email: `b3-${i}@example.invalid`,
          name: `Buyer ${i}`,
        }).catch((e): Attempt => ({ ok: false, errors: {}, formError: String(e) })),
      ),
    );
    const won = results.filter((r) => r.ok).length;
    const state = await tierState(tier.id);
    console.log(`      won=${won} ${JSON.stringify(state)}`);
    if (won === 1 && state.sold === 100) {
      ok("B3 exactly one buyer got the last seat");
    } else {
      bad("B3 exactly one buyer got the last seat", `won=${won} sold=${state.sold}`);
    }
  }

  // ── B4 · does an abandoned order give the seat back? ─────────────────
  console.log("\nB4 · release returns the seat");
  {
    const { releaseOrder } = await import("../src/server/ticketing");
    const tier = await db.ticketTier.create({
      data: {
        eventId: rig.eventA,
        name: "Release",
        priceCents: 1000,
        quota: 2,
        sold: 0,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 5,
      },
    });
    const first = await startCheckout({
      slug: rig.slugA,
      tierId: tier.id,
      quantity: 2,
      email: "b4@example.invalid",
      name: "Buyer",
    });
    if (!first.ok) return bad("B4 setup", JSON.stringify(first));
    let state = await tierState(tier.id);
    if (state.sold !== 2 || state.status !== "SOLD_OUT") {
      bad("B4 reservation takes the seats", JSON.stringify(state));
    }
    await releaseOrder(first.orderId, "CANCELLED");
    state = await tierState(tier.id);
    if (state.sold === 0) ok("B4 cancelling gives the seats back", `status=${state.status}`);
    else bad("B4 cancelling gives the seats back", JSON.stringify(state));

    // Double release must not credit twice.
    await releaseOrder(first.orderId, "CANCELLED");
    state = await tierState(tier.id);
    if (state.sold === 0) ok("B4 double release does not go negative");
    else bad("B4 double release does not go negative", JSON.stringify(state));
  }

  // ── B5 · negative / fractional / oversized quantities ───────────────
  console.log("\nB5 · malformed quantities");
  {
    const tier = await db.ticketTier.create({
      data: {
        eventId: rig.eventA,
        name: "Malformed",
        priceCents: 1000,
        quota: 5,
        sold: 0,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 6,
      },
    });
    const cases: Array<[string, number]> = [
      ["negative", -5],
      ["zero", 0],
      ["fractional", 1.9],
      ["huge", 1_000_000],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
    ];
    for (const [label, quantity] of cases) {
      // Reset between cases: a leftover reservation from the previous case
      // would otherwise be misread as this one overselling.
      await db.ticketTier.update({
        where: { id: tier.id },
        data: { sold: 0, status: "ON_SALE" },
      });
      await db.order.deleteMany({ where: { tierId: tier.id } });
      const res = await startCheckout({
        slug: rig.slugA,
        tierId: tier.id,
        quantity,
        email: `b5-${label}@example.invalid`,
        name: "Buyer",
      }).catch((e): Attempt => ({ ok: false, errors: {}, formError: String(e) }));
      const state = await tierState(tier.id);
      if (label === "fractional") {
        // Math.floor(1.9) = 1, which is a legitimate order, and the amount
        // charged uses the floored quantity. Recorded, not failed.
        note(
          "B5 fractional",
          res.ok ? `floored to ${state.sold} seat(s)` : "refused",
        );
      } else if (res.ok) {
        bad(`B5 ${label} rejected`, `accepted; sold=${state.sold}`);
      } else if (state.sold !== 0) {
        bad(`B5 ${label} rejected`, `rejected but sold moved to ${state.sold}`);
      } else {
        ok(`B5 ${label} rejected`);
      }
    }
  }

  // ── B6 · buying a tier that belongs to a DIFFERENT event ────────────
  console.log("\nB6 · a tier id from another event");
  {
    const foreign = await db.ticketTier.create({
      data: {
        eventId: rig.eventB,
        name: "Foreign",
        priceCents: 1000,
        quota: 10,
        sold: 0,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 1,
      },
    });
    const res = await startCheckout({
      slug: rig.slugA,
      tierId: foreign.id,
      quantity: 1,
      email: "b6@example.invalid",
      name: "Buyer",
    }).catch((e): Attempt => ({ ok: false, errors: {}, formError: String(e) }));
    const state = await tierState(foreign.id);
    if (!res.ok && state.sold === 0) ok("B6 refused a foreign tier");
    else bad("B6 refused a foreign tier", `${JSON.stringify(res)} sold=${state.sold}`);
  }

  // ── B7 · a DRAFT / CLOSED tier ──────────────────────────────────────
  console.log("\nB7 · a tier that is not on sale");
  {
    for (const status of ["DRAFT", "CLOSED", "SOLD_OUT"] as const) {
      const tier = await db.ticketTier.create({
        data: {
          eventId: rig.eventA,
          name: `NotOnSale-${status}`,
          priceCents: 1000,
          quota: 10,
          sold: 0,
          currency: "EUR",
          status,
          sortOrder: 9,
        },
      });
      const res = await startCheckout({
        slug: rig.slugA,
        tierId: tier.id,
        quantity: 1,
        email: `b7-${status}@example.invalid`,
        name: "Buyer",
      }).catch((e): Attempt => ({ ok: false, errors: {}, formError: String(e) }));
      const state = await tierState(tier.id);
      if (!res.ok && state.sold === 0) ok(`B7 ${status} refused`);
      else bad(`B7 ${status} refused`, `${JSON.stringify(res)} sold=${state.sold}`);
    }
  }

  // ── B8 · CC-002: the buyer's name is on the order ────────────────────
  console.log("\nB8 · CC-002 buyerName persists to the Order row");
  {
    const tier = await db.ticketTier.create({
      data: {
        eventId: rig.eventA,
        name: "Named",
        priceCents: 0,
        quota: 5,
        sold: 0,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 10,
      },
    });
    const res = await startCheckout({
      slug: rig.slugA,
      tierId: tier.id,
      quantity: 1,
      email: "b8@example.invalid",
      name: "Sophie Delacroix",
    });
    if (!res.ok) return bad("B8 free checkout", JSON.stringify(res));
    const order = await db.order.findUniqueOrThrow({
      where: { id: res.orderId },
      select: { buyerName: true, status: true, guestId: true },
    });
    if (order.buyerName === "Sophie Delacroix") ok("B8 Order.buyerName persisted");
    else bad("B8 Order.buyerName persisted", String(order.buyerName));
    const guest = order.guestId
      ? await db.guest.findUnique({
          where: { id: order.guestId },
          select: { name: true },
        })
      : null;
    if (guest?.name === "Sophie Delacroix") ok("B8 fulfilment named the guest");
    else bad("B8 fulfilment named the guest", String(guest?.name));
  }

  await teardown();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (e) => {
    console.error(e);
    await teardown().catch(() => {});
    process.exit(1);
  });
