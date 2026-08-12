/**
 * Definition-of-done harness for packages/revenue, run against a seeded
 * database. Exercises the real router through createCallerFactory — no HTTP,
 * no console, no mounting required.
 *
 *   pnpm --filter @ovation/revenue verify          # read-only checks
 *   pnpm --filter @ovation/revenue verify -- --rules   # + the 90% rule test
 *
 * The --rules pass temporarily moves Standard.sold to 108 to prove the rule
 * fires, then restores it and deletes the AgentAction it created. It is the
 * only thing in this package that writes outside a procedure, it always
 * restores in a finally block, and it refuses to run if the tier is not in
 * its expected seed state.
 */
import { createCallerFactory } from "@ovation/core";
import { db } from "@ovation/core/db";
import { revenueRouter } from "../src/router";

const EVENT_SLUG = "meridian-summit-2026";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "  ok  " : "  FAIL"}  ${label}${ok ? "" : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`,
  );
}

function assertTrue(label: string, condition: boolean, detail = ""): void {
  if (!condition) failures += 1;
  console.log(`${condition ? "  ok  " : "  FAIL"}  ${label}${condition ? "" : `  ${detail}`}`);
}

async function main() {
  const event = await db.event.findUnique({
    where: { slug: EVENT_SLUG },
    select: { id: true, organisationId: true, title: true },
  });
  if (!event) {
    console.error(
      `No event with slug "${EVENT_SLUG}". Run "pnpm db:seed" first, then re-run.`,
    );
    process.exit(2);
  }

  const owner = await db.user.findFirst({
    where: { organisationId: event.organisationId },
    select: { id: true, email: true, name: true, organisationId: true, role: true },
  });
  if (!owner) {
    console.error("No user attached to the seeded organisation.");
    process.exit(2);
  }

  const caller = createCallerFactory(revenueRouter)({
    db,
    session: { user: { ...owner, organisationId: event.organisationId } },
    headers: null,
  });

  // ── 1. summary ────────────────────────────────────────────────────────
  console.log("\n1. revenue.summary");
  const summary = await caller.summary({ eventId: event.id, compareToPreviousEdition: true });
  check("tickets €28,140", summary.tickets.totalCents, 2_814_000);
  check("tickets sold", summary.tickets.sold, 178);
  check("sponsors €24,500", summary.sponsors.totalCents, 2_450_000);
  check("committed costs €26,250", summary.costs.totalCents, 2_625_000);
  check("gross revenue", summary.grossRevenueCents, 5_264_000);
  check("margin", summary.marginCents, 2_639_000);
  check("margin %", summary.marginPercent, 50.13);
  check("cost per attendee", summary.costPerAttendeeCents, 14_747);
  assertTrue("previousEdition is not null", summary.previousEdition !== null);
  check("previous gross €30,225", summary.previousEdition?.grossRevenueCents, 3_022_500);
  check("delta %", summary.previousEdition?.deltaPercent, 74.16);

  // Reconcile against the PAID order rows, which the summary does not read.
  const orders = await db.order.aggregate({
    where: { eventId: event.id, status: "PAID" },
    _sum: { amountCents: true },
    _count: true,
  });
  check("PAID order rows", orders._count, 178);
  check(
    "PAID order total matches the summary",
    orders._sum.amountCents,
    summary.tickets.totalCents,
  );

  // ── 2. pricing rules on untouched seed data ───────────────────────────
  console.log("\n2. revenue.evaluateAutoOpenRules (untouched seed)");
  const dry = await caller.evaluateAutoOpenRules({ eventId: event.id, dryRun: true });
  check("nothing fires at 92/120", dry.fired, []);
  const wet = await caller.evaluateAutoOpenRules({ eventId: event.id, dryRun: false });
  check("nothing fires when not dry either", wet.fired, []);

  // ── 3. upsell radar ───────────────────────────────────────────────────
  console.log("\n3. revenue.sponsorUpsellCandidates");
  const upsell = await caller.sponsorUpsellCandidates({ eventId: event.id, threshold: 60 });
  check(
    "Nexa Systems and not Corda Capital",
    upsell.candidates.map((c) => c.name),
    ["Nexa Systems"],
  );
  const nexa = upsell.candidates[0];
  if (nexa) {
    check("increment €6,500", nexa.incrementalAmountCents, 650_000);
    check("SILVER → GOLD", [nexa.currentPackage, nexa.suggestedPackage], ["SILVER", "GOLD"]);
    assertTrue("an AgentAction was proposed", typeof nexa.agentActionId === "string");
    const action = nexa.agentActionId
      ? await db.agentAction.findUnique({ where: { id: nexa.agentActionId } })
      : null;
    check("action status", action?.status, "PROPOSED");
    check("action risk", action?.risk, "OUTBOUND");
    const payload = action?.payload as
      | { offer?: { subject?: string; body?: string; writtenBy?: string } }
      | null;
    console.log("\n   ── evidence handed to the model ──");
    for (const fact of nexa.evidence) console.log(`     · ${fact}`);
    console.log(`\n   ── drafted offer (${payload?.offer?.writtenBy ?? "?"}) ──`);
    console.log(`     Subject: ${payload?.offer?.subject ?? "(none)"}`);
    console.log(
      (payload?.offer?.body ?? "(none)")
        .split("\n")
        .map((line) => `     ${line}`)
        .join("\n"),
    );

    // Re-running must not draft a second offer.
    const again = await caller.sponsorUpsellCandidates({ eventId: event.id, threshold: 60 });
    check("idempotent", again.candidates[0]?.agentActionId, nexa.agentActionId);
  }

  // ── 4. sponsor ROI report ─────────────────────────────────────────────
  console.log("\n4. revenue.sponsorRoiReport");
  const roi = await caller.sponsorRoiReport({ eventId: event.id });
  check("one report per sponsor", roi.reports.length, 3);
  const helvion = roi.reports.find((r) => r.name === "Helvion Group");
  assertTrue("Helvion matched real guests", (helvion?.matchedLeads.length ?? 0) > 0);
  console.log(
    `   Helvion: ${helvion?.stats.leads} leads, ${helvion?.stats.logoImpressions} impressions, renewal ${helvion?.stats.renewalIntent}`,
  );
  const companies = [...new Set(helvion?.matchedLeads.map((l) => l.company))];
  console.log(`   matched companies: ${companies.join(", ")}`);
  assertTrue(
    "every matched company is a target account",
    (helvion?.matchedLeads ?? []).every((lead) =>
      ["Northgate Bank", "Vantage Pharma", "Lumen Energy"].some(
        (account) => account.toLowerCase() === (lead.company ?? "").toLowerCase(),
      ),
    ),
  );
  assertTrue("HTML has no external references", !/https?:\/\//.test(helvion?.html ?? "x"));
  assertTrue("HTML is table-based", (helvion?.html ?? "").includes("<table"));
  const emails = await db.emailMessage.findMany({
    where: { eventId: event.id, kind: "SPONSOR_REPORT" },
    select: { status: true, sentAt: true },
  });
  assertTrue(
    "every queued report is PROPOSED and unsent",
    emails.every((e) => e.status === "PROPOSED" && e.sentAt === null),
    JSON.stringify(emails),
  );
  const again = await caller.sponsorRoiReport({ eventId: event.id });
  check(
    "re-running refreshes rather than duplicating",
    again.reports.map((r) => r.emailMessageId).sort(),
    roi.reports.map((r) => r.emailMessageId).sort(),
  );

  // ── 5. pricing suggestions and sponsor list ───────────────────────────
  console.log("\n5. revenue.pricingSuggestions / revenue.sponsors");
  const pricing = await caller.pricingSuggestions({ eventId: event.id });
  for (const suggestion of pricing.suggestions) {
    console.log(`   ${suggestion.kind}: ${suggestion.rationale}`);
  }
  const sponsors = await caller.sponsors({ eventId: event.id });
  check("three sponsors", sponsors.items.length, 3);
  const signedOnly = await caller.sponsors({ eventId: event.id, status: "SIGNED" });
  check("status filter works", signedOnly.items.length, 3);

  // ── 6. the 90% rule, opt-in because it writes ─────────────────────────
  if (process.argv.includes("--rules")) {
    console.log("\n6. the 90% rule (temporarily moving Standard to 108/120)");
    await runRuleTest(event.id, caller);
  } else {
    console.log("\n6. the 90% rule — skipped (pass --rules to run it)");
  }

  console.log(
    `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`,
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

async function runRuleTest(
  eventId: string,
  caller: { evaluateAutoOpenRules: (input: { eventId: string; dryRun: boolean }) => Promise<{ fired: { tierId: string; agentActionId: string | null }[] }> },
) {
  const standard = await db.ticketTier.findFirst({
    where: { eventId, name: "Standard" },
    select: { id: true, sold: true, quota: true },
  });
  if (!standard || standard.sold !== 92 || standard.quota !== 120) {
    console.log("  SKIP  Standard is not in its seed state (92/120); refusing to touch it.");
    return;
  }

  const tiersBefore = await db.ticketTier.count({ where: { eventId } });
  const createdActionIds: string[] = [];

  try {
    await db.ticketTier.update({ where: { id: standard.id }, data: { sold: 108 } });

    const dry = await caller.evaluateAutoOpenRules({ eventId, dryRun: true });
    check("dry run reports one hit", dry.fired.length, 1);
    check("dry run writes no action", dry.fired[0]?.agentActionId ?? null, null);
    const dryActions = await db.agentAction.count({
      where: { eventId, type: "create_ticket_tier", status: "PROPOSED" },
    });

    const fired = await caller.evaluateAutoOpenRules({ eventId, dryRun: false });
    check("exactly one AgentAction emitted", fired.fired.length, 1);
    const actionId = fired.fired[0]?.agentActionId ?? null;
    assertTrue("action id returned", typeof actionId === "string");
    if (actionId) createdActionIds.push(actionId);

    const action = actionId ? await db.agentAction.findUnique({ where: { id: actionId } }) : null;
    check("status PROPOSED", action?.status, "PROPOSED");
    check("risk OPERATIONAL", action?.risk, "OPERATIONAL");
    check("type", action?.type, "create_ticket_tier");
    const input = (action?.payload as { input?: Record<string, unknown> } | null)?.input;
    check("Late tier at €175 x 30", [input?.name, input?.priceCents, input?.quota], [
      "Late",
      17_500,
      30,
    ]);
    console.log(`   summary: ${action?.summary}`);

    check(
      "no ticket tier was created",
      await db.ticketTier.count({ where: { eventId } }),
      tiersBefore,
    );
    assertTrue(
      "no Late tier exists",
      (await db.ticketTier.count({ where: { eventId, name: "Late" } })) === 0,
    );

    const second = await caller.evaluateAutoOpenRules({ eventId, dryRun: false });
    check("a second sweep re-uses the same action", second.fired[0]?.agentActionId, actionId);
    check(
      "and creates no second action",
      await db.agentAction.count({
        where: { eventId, type: "create_ticket_tier", status: "PROPOSED" },
      }),
      dryActions + 1,
    );
  } finally {
    await db.ticketTier.update({ where: { id: standard.id }, data: { sold: standard.sold } });
    if (createdActionIds.length > 0) {
      await db.agentAction.deleteMany({ where: { id: { in: createdActionIds } } });
    }
    console.log("   (restored Standard to 92/120 and removed the test proposal)");
  }
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
