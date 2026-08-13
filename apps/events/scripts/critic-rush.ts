/**
 * The flash sale.
 *
 * INTEGRATION_REPORT.md risk #4: above roughly 30 simultaneous buyers on one
 * tier, reservations died with
 *
 *     Transaction already closed: the timeout for this transaction was 5000 ms
 *
 * Nothing oversold and no seat leaked — but those buyers got an unhandled throw
 * instead of a page. `critic-oversell.ts` could not see it: every call there is
 * wrapped in `.catch()` that folds a crash into the same shape as "sold out",
 * so a thrown transaction timeout and a polite refusal are indistinguishable in
 * its output. This script separates them, which is the whole point of it.
 *
 * The question it asks is NOT "can the tier be oversold" (B1–B3 answer that).
 * It is: when there is room for everybody, does everybody get served?
 *
 *   pnpm --filter @ovation/events exec dotenv -e ../../.env -- \
 *     tsx scripts/critic-rush.ts [concurrency]
 *
 * Runs against the critic rig's throwaway event A, never Meridian Summit 2026.
 */
import { db } from "@ovation/core/db";
import { bad, note, ok, setup, teardown } from "../../../scripts/critic/rig";
import { startCheckout } from "../src/server/ticketing";

const DEFAULT_CONCURRENCY = 200;

interface Outcome {
  kind: "won" | "refused" | "threw";
  detail: string;
  ms: number;
}

async function attempt(
  slug: string,
  tierId: string,
  quantity: number,
  i: number,
): Promise<Outcome> {
  const started = Date.now();
  try {
    const res = await startCheckout({
      slug,
      tierId,
      quantity,
      email: `rush-${i}@example.invalid`,
      name: `Buyer ${i}`,
    });
    return {
      kind: res.ok ? "won" : "refused",
      detail: res.ok ? res.orderId : (res.formError ?? JSON.stringify(res.errors)),
      ms: Date.now() - started,
    };
  } catch (cause) {
    // The failure mode under test: startCheckout is supposed to return an
    // outcome, never throw. Anything landing here reaches the guest as a 500.
    return {
      kind: "threw",
      detail: cause instanceof Error ? cause.message : String(cause),
      ms: Date.now() - started,
    };
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function report(label: string, outcomes: Outcome[]): Record<Outcome["kind"], number> {
  const counts = { won: 0, refused: 0, threw: 0 };
  for (const o of outcomes) counts[o.kind]++;
  const ms = outcomes.map((o) => o.ms);
  console.log(
    `      ${label}: won=${counts.won} refused=${counts.refused} threw=${counts.threw} ` +
      `p50=${percentile(ms, 50)}ms p95=${percentile(ms, 95)}ms max=${Math.max(...ms)}ms`,
  );

  // Every distinct message, so a new failure mode cannot hide inside a count.
  const messages = new Map<string, number>();
  for (const o of outcomes) {
    if (o.kind === "won") continue;
    const key = `${o.kind}: ${o.detail.slice(0, 110)}`;
    messages.set(key, (messages.get(key) ?? 0) + 1);
  }
  for (const [message, n] of messages) console.log(`        ${n}× ${message}`);
  return counts;
}

async function main() {
  const rig = await setup();
  const concurrency = Number(process.argv[2]) || DEFAULT_CONCURRENCY;

  // ── R1 · room for everyone ───────────────────────────────────────────
  // The decisive case. Quota exceeds demand, so there is no legitimate
  // reason for a single buyer to be turned away.
  console.log(`\nR1 · ${concurrency} concurrent buyers, ${concurrency * 2} seats`);
  {
    const tier = await db.ticketTier.create({
      data: {
        eventId: rig.eventA,
        name: "Rush",
        priceCents: 4500,
        quota: concurrency * 2,
        sold: 0,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 20,
      },
    });

    const outcomes = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        attempt(rig.slugA, tier.id, 1, i),
      ),
    );
    const counts = report("R1", outcomes);

    const state = await db.ticketTier.findUniqueOrThrow({
      where: { id: tier.id },
      select: { sold: true },
    });

    if (counts.threw === 0) {
      ok(`R1 no buyer got an exception (${concurrency} concurrent)`);
    } else {
      bad(
        `R1 no buyer got an exception (${concurrency} concurrent)`,
        `${counts.threw} of ${concurrency} threw`,
      );
    }
    if (counts.won === concurrency) {
      ok("R1 everybody who wanted a seat got one");
    } else {
      bad(
        "R1 everybody who wanted a seat got one",
        `won=${counts.won}/${concurrency}`,
      );
    }
    // Seats taken must equal orders opened, whatever else happened.
    if (state.sold === counts.won) {
      ok("R1 seats taken match orders opened", `sold=${state.sold}`);
    } else {
      bad(
        "R1 seats taken match orders opened",
        `sold=${state.sold} won=${counts.won}`,
      );
    }
  }

  // ── R2 · a real on-sale: more buyers than seats ──────────────────────
  // Losers here are legitimate, but every one of them must be told "sold
  // out" in words, not by an exception.
  console.log(`\nR2 · ${concurrency} concurrent buyers, ${Math.floor(concurrency / 4)} seats`);
  {
    const quota = Math.floor(concurrency / 4);
    const tier = await db.ticketTier.create({
      data: {
        eventId: rig.eventA,
        name: "RushScarce",
        priceCents: 4500,
        quota,
        sold: 0,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 21,
      },
    });

    const outcomes = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        attempt(rig.slugA, tier.id, 1, i),
      ),
    );
    const counts = report("R2", outcomes);

    const state = await db.ticketTier.findUniqueOrThrow({
      where: { id: tier.id },
      select: { sold: true, status: true },
    });

    if (counts.threw === 0) {
      ok("R2 losing a race is a sentence, not an exception");
    } else {
      bad(
        "R2 losing a race is a sentence, not an exception",
        `${counts.threw} of ${concurrency} threw`,
      );
    }
    if (state.sold <= quota && counts.won === state.sold) {
      ok("R2 sold exactly the quota, no more", `sold=${state.sold}/${quota}`);
    } else {
      bad("R2 sold exactly the quota, no more", `sold=${state.sold} won=${counts.won}`);
    }
    if (state.status === "SOLD_OUT") ok("R2 tier closed itself");
    else bad("R2 tier closed itself", state.status);

    // The refusal a losing buyer actually reads.
    const refusal = outcomes.find((o) => o.kind === "refused");
    note("R2 what a losing buyer is told", refusal?.detail ?? "(nobody lost)");
  }

  // ── R3 · the rush, then everyone abandons ────────────────────────────
  // Release runs on the same contended row as reservation, so it gets the
  // same treatment and needs the same proof.
  console.log(`\nR3 · ${Math.min(concurrency, 60)} reservations released at once`);
  {
    const n = Math.min(concurrency, 60);
    const tier = await db.ticketTier.create({
      data: {
        eventId: rig.eventA,
        name: "RushRelease",
        priceCents: 4500,
        quota: n,
        sold: 0,
        currency: "EUR",
        status: "ON_SALE",
        sortOrder: 22,
      },
    });

    const bought = await Promise.all(
      Array.from({ length: n }, (_, i) => attempt(rig.slugA, tier.id, 1, i)),
    );
    const orderIds = bought.filter((o) => o.kind === "won").map((o) => o.detail);

    const { releaseOrder } = await import("../src/server/ticketing");
    let threw = 0;
    await Promise.all(
      orderIds.map((id) =>
        releaseOrder(id, "CANCELLED").catch(() => {
          threw++;
        }),
      ),
    );

    const state = await db.ticketTier.findUniqueOrThrow({
      where: { id: tier.id },
      select: { sold: true, status: true },
    });
    console.log(
      `      R3: reserved=${orderIds.length} released=${orderIds.length - threw} threw=${threw} sold=${state.sold}`,
    );

    if (threw === 0) ok("R3 concurrent release does not throw");
    else bad("R3 concurrent release does not throw", `${threw} threw`);

    if (state.sold === 0) ok("R3 every seat came back", `status=${state.status}`);
    else bad("R3 every seat came back", `sold=${state.sold}`);

    if (state.status === "ON_SALE") ok("R3 tier reopened");
    else bad("R3 tier reopened", state.status);
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
