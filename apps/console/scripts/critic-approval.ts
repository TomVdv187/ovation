/**
 * Agent 7 · CRITIC — adversarial pass, part 1: the approval gate.
 *
 * CONDUCTOR's claim: "no side effect can occur outside agent.approve"
 * (apps/console/src/server/agent/execute.ts).
 *
 * Everything here runs against the critic rig's two organisations. Nothing
 * touches Meridian Summit 2026.
 */
import {
  contractRouters,
  createAppRouter,
  createCallerFactory,
  TOOL_RISK,
} from "@ovation/core";
import { db } from "@ovation/core/db";
import { pageRouter } from "@ovation/events/page-router";
import { guestsRouter } from "@ovation/guests";
import { liveRouter } from "@ovation/live/live-router";
import { revenueRouter } from "@ovation/revenue";
import { agentRouter } from "../src/server/routers/agent";
import { eventRouter } from "../src/server/routers/event";

/**
 * The console's app router, composed here rather than imported from
 * src/server/router.ts. That module pulls in next-auth, which drags in
 * next/navigation and cannot load outside a Next runtime. Same parts, same
 * order, no auth adapter.
 */
const appRouter = createAppRouter({
  event: eventRouter,
  agent: agentRouter,
  page: pageRouter,
  guests: guestsRouter,
  revenue: revenueRouter,
  live: liveRouter,
});
void contractRouters;
import { bad, ctxFor, note, ok, setup, teardown, type Rig } from "../../../scripts/critic/rig";

const caller = createCallerFactory(appRouter);

async function proposeRaw(
  rig: Rig,
  type: "draft_emails" | "update_event_theme",
  input: unknown,
) {
  return db.agentAction.create({
    data: {
      organisationId: rig.orgA,
      eventId: rig.eventA,
      type,
      summary: `critic probe: ${type}`,
      payload: { type, input } as unknown as object,
      sideEffects: [],
      status: "PROPOSED",
      risk: TOOL_RISK[type],
      createdBy: "AGENT",
    },
    select: { id: true },
  });
}

async function main() {
  const rig = await setup();
  const A = caller(ctxFor(rig.userA, rig.orgA));
  const B = caller(ctxFor(rig.userB, rig.orgB));

  console.log("\nA1 · approve someone else's action");
  {
    const action = await proposeRaw(rig, "update_event_theme", {
      eventId: rig.eventA,
      theme: { preset: "blacktie" },
    });
    try {
      await B.agent.approve({ actionIds: [action.id] });
      bad("A1 cross-tenant approve", "org B executed org A's action");
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "FORBIDDEN") ok("A1 cross-tenant approve", "FORBIDDEN");
      else bad("A1 cross-tenant approve", `unexpected ${code}`);
    }
    const after = await db.event.findUnique({
      where: { id: rig.eventA },
      select: { theme: true },
    });
    if ((after?.theme as { preset?: string }).preset === "classic") {
      ok("A1 world untouched");
    } else {
      bad("A1 world untouched", JSON.stringify(after?.theme));
    }
  }

  console.log("\nA2 · retarget the payload with `patch` at approval time");
  {
    // The action belongs to org A and passes assertActionsBelongToOrg. The
    // PATCH names an event that belongs to org B.
    const action = await proposeRaw(rig, "update_event_theme", {
      eventId: rig.eventA,
      theme: { preset: "blacktie" },
    });
    const before = await db.event.findUnique({
      where: { id: rig.eventB },
      select: { theme: true },
    });
    const res = await A.agent.approve({
      actionIds: [action.id],
      patch: { input: { eventId: rig.eventB, theme: { preset: "blacktie" } } },
    });
    const after = await db.event.findUnique({
      where: { id: rig.eventB },
      select: { theme: true },
    });
    const changed =
      JSON.stringify(before?.theme) !== JSON.stringify(after?.theme);
    if (changed) {
      bad(
        "A2 patch cannot retarget across tenants",
        `org A rewrote org B's event theme; status=${res.results[0]?.status}`,
      );
    } else {
      ok("A2 patch cannot retarget across tenants");
    }
    // Put org B back however this landed.
    await db.event.update({
      where: { id: rig.eventB },
      data: { theme: { preset: "classic" } },
    });
  }

  console.log("\nA3 · patch a draft_emails action onto another org's guests");
  {
    const action = await proposeRaw(rig, "draft_emails", {
      eventId: rig.eventA,
      guestIds: [rig.guestsA[0]],
      intent: "INVITE",
      draft: { subject: "Rig", body: "Rig body" },
    });
    const before = await db.emailMessage.count({ where: { eventId: rig.eventB } });
    let res: { results: Array<{ status: string }> } = { results: [] };
    try {
      res = await A.agent.approve({
        actionIds: [action.id],
        patch: { input: { eventId: rig.eventB, guestIds: [rig.guestB] } },
      });
    } catch (e) {
      note("A3 patch rejected before execution", (e as { code?: string }).code ?? "");
    }
    const after = await db.emailMessage.count({ where: { eventId: rig.eventB } });
    if (after > before) {
      bad(
        "A3 patch cannot draft into another org",
        `${after - before} EmailMessage rows created on org B; status=${res.results[0]?.status}`,
      );
    } else {
      ok("A3 patch cannot draft into another org", `status=${res.results[0]?.status}`);
    }
  }

  console.log("\nA4 · does approving draft_emails SEND anything?");
  {
    const action = await proposeRaw(rig, "draft_emails", {
      eventId: rig.eventA,
      guestIds: rig.guestsA.slice(0, 3),
      intent: "INVITE",
      draft: { subject: "Critic subject", body: "Critic body {{name}}" },
    });
    await A.agent.approve({ actionIds: [action.id] });
    const rows = await db.emailMessage.findMany({
      where: { eventId: rig.eventA },
      select: { status: true, sentAt: true, subject: true, body: true },
    });
    const sent = rows.filter((r) => r.status === "SENT" || r.sentAt !== null);
    if (sent.length > 0) bad("A4 nothing is SENT", `${sent.length} sent rows`);
    else ok("A4 nothing is SENT", `${rows.length} rows, all ${rows[0]?.status}`);

    // CC-001: the approved words are the words that were written.
    const verbatim = rows.every(
      (r) => r.subject === "Critic subject" && r.body.includes("Critic body"),
    );
    if (verbatim) ok("A4 approved copy is used verbatim");
    else bad("A4 approved copy is used verbatim", JSON.stringify(rows[0]));
  }

  console.log("\nA5 · CC-001 regression: a >400-character body");
  {
    const long = "L".repeat(1200);
    const action = await proposeRaw(rig, "draft_emails", {
      eventId: rig.eventA,
      guestIds: [rig.guestsA[1]],
      intent: "REMINDER",
      draft: { subject: "Long", body: long },
    });
    await A.agent.approve({ actionIds: [action.id] });
    const row = await db.emailMessage.findFirst({
      where: { eventId: rig.eventA, subject: "Long" },
      select: { body: true },
    });
    if (row && row.body.includes(long)) {
      ok("A5 long body survives approval intact", `${long.length} chars`);
    } else {
      bad(
        "A5 long body survives approval intact",
        `stored ${row?.body.length ?? 0} chars`,
      );
    }
  }

  console.log("\nA6 · auto-approve cannot clear an OUTBOUND action");
  {
    await A.agent.setAutoApprove({ autoApproveCosmetic: true });
    const org = await db.organisation.findUnique({
      where: { id: rig.orgA },
      select: { settings: true },
    });
    const flag = (org?.settings as { autoApproveCosmetic?: boolean })
      ?.autoApproveCosmetic;
    if (flag !== true) bad("A6 setAutoApprove persisted", String(flag));

    // Drive executeApprovedActions the way the agent turn does — AUTO source.
    const { executeApprovedActions } = await import(
      "../src/server/agent/execute"
    );
    const outbound = await proposeRaw(rig, "draft_emails", {
      eventId: rig.eventA,
      guestIds: [rig.guestsA[2]],
      intent: "INVITE",
      draft: { subject: "Auto", body: "Auto body" },
    });
    const [res] = await executeApprovedActions(db, [outbound.id], {
      kind: "AUTO",
      autoApproveCosmetic: true,
    });
    const row = await db.agentAction.findUnique({
      where: { id: outbound.id },
      select: { status: true },
    });
    if (res?.status === "PROPOSED" && row?.status === "PROPOSED") {
      ok("A6 OUTBOUND refuses AUTO", "stayed PROPOSED");
    } else {
      bad("A6 OUTBOUND refuses AUTO", `${res?.status} / ${row?.status}`);
    }

    const cosmetic = await proposeRaw(rig, "update_event_theme", {
      eventId: rig.eventA,
      theme: { dressCode: "auto-approved" },
    });
    const [cres] = await executeApprovedActions(db, [cosmetic.id], {
      kind: "AUTO",
      autoApproveCosmetic: true,
    });
    note(
      "A6 COSMETIC under auto-approve",
      `status=${cres?.status} (expected EXECUTED — this is the documented opt-in)`,
    );
    await A.agent.setAutoApprove({ autoApproveCosmetic: false });
  }

  console.log("\nA7 · double approval of the same action");
  {
    const action = await proposeRaw(rig, "draft_emails", {
      eventId: rig.eventA,
      guestIds: [rig.guestsA[3]],
      intent: "INVITE",
      draft: { subject: "Dbl", body: "Dbl body" },
    });
    const [r1, r2] = await Promise.all([
      A.agent.approve({ actionIds: [action.id] }),
      A.agent.approve({ actionIds: [action.id] }),
    ]);
    const drafted = await db.emailMessage.count({
      where: { eventId: rig.eventA, subject: "Dbl" },
    });
    if (drafted === 1) {
      ok("A7 concurrent double approve writes once", `1 EmailMessage`);
    } else {
      bad(
        "A7 concurrent double approve writes once",
        `${drafted} rows; statuses ${r1.results[0]?.status}/${r2.results[0]?.status}`,
      );
    }
  }

  console.log("\nA8 · reject then approve");
  {
    const action = await proposeRaw(rig, "draft_emails", {
      eventId: rig.eventA,
      guestIds: [rig.guestsA[4]],
      intent: "INVITE",
      draft: { subject: "Rejected", body: "Should never be written" },
    });
    await A.agent.reject({ actionIds: [action.id], reason: "no" });
    const res = await A.agent.approve({ actionIds: [action.id] });
    const drafted = await db.emailMessage.count({
      where: { eventId: rig.eventA, subject: "Rejected" },
    });
    if (drafted === 0) {
      ok("A8 a rejected action cannot be approved", res.results[0]?.status ?? "");
    } else {
      bad("A8 a rejected action cannot be approved", `${drafted} rows written`);
    }
  }

  console.log("\nA9 · cross-tenant reads");
  {
    // agent.history filters agentAction by organisationId but chatMessage only
    // by eventId. Plant a chat message on org A's event and read it as org B.
    await db.chatMessage.create({
      data: {
        eventId: rig.eventA,
        role: "USER",
        content: "critic-secret-org-a",
      },
    });
    try {
      const hist = await B.agent.history({ eventId: rig.eventA, limit: 20 });
      const leaked = hist.messages.some((m) =>
        m.content.includes("critic-secret-org-a"),
      );
      if (leaked) {
        bad(
          "A9 agent.history is tenant-scoped",
          "org B read org A's chat transcript",
        );
      } else {
        ok("A9 agent.history is tenant-scoped");
      }
    } catch (e) {
      ok("A9 agent.history is tenant-scoped", `threw ${(e as { code?: string }).code}`);
    }

    try {
      const acts = await B.agent.actions({ eventId: rig.eventA, limit: 20 });
      if (acts.items.length > 0) {
        bad("A9 agent.actions is tenant-scoped", `${acts.items.length} leaked`);
      } else {
        ok("A9 agent.actions is tenant-scoped");
      }
    } catch (e) {
      ok("A9 agent.actions is tenant-scoped", `threw ${(e as { code?: string }).code}`);
    }
  }

  console.log("\nA10 · can any OTHER mounted router cause a side effect?");
  {
    // revenue: a pricing rule that fires must PROPOSE, never create a tier.
    await db.ticketTier.update({
      where: { id: rig.scarceTier },
      data: { sold: 10, status: "SOLD_OUT" },
    });
    // autoFire: true is the strongest form of the question — the rule asks to
    // be applied without asking.
    await db.ticketTier.update({
      where: { id: rig.roomyTier },
      data: {
        autoOpenRule: {
          when: { type: "TIER_SOLD_OUT", tierName: "Scarce" },
          then: { openTier: { name: "Late Release", priceCents: 9000, quota: 20 } },
          autoFire: true,
        } as unknown as object,
      },
    });
    const tiersBefore = await db.ticketTier.count({ where: { eventId: rig.eventA } });
    const res = await A.revenue.evaluateAutoOpenRules({ eventId: rig.eventA });
    const tiersAfter = await db.ticketTier.count({ where: { eventId: rig.eventA } });
    if (tiersAfter === tiersBefore) {
      ok(
        "A10 a firing pricing rule creates no tier",
        `${res.fired.length} rule(s) fired, ${tiersAfter} tiers before and after`,
      );
    } else {
      bad(
        "A10 a firing pricing rule creates no tier",
        `${tiersBefore} -> ${tiersAfter}`,
      );
    }
    const proposed = await db.agentAction.findMany({
      where: { eventId: rig.eventA, type: "create_ticket_tier" },
      select: { status: true },
    });
    if (proposed.every((p) => p.status === "PROPOSED")) {
      ok("A10 proposals are PROPOSED", `${proposed.length}`);
    } else {
      bad("A10 proposals are PROPOSED", JSON.stringify(proposed));
    }

    // guests.personaliseInvite must never send.
    const before = await db.emailMessage.count({
      where: { eventId: rig.eventA, status: "SENT" },
    });
    try {
      await A.guests.personaliseInvite({
        eventId: rig.eventA,
        guestIds: [rig.guestsA[5]!],
        intent: "INVITE",
      });
    } catch (e) {
      note(
        "A10 personaliseInvite",
        `threw ${(e as { code?: string }).code ?? ""} ${(e as Error).message?.slice(0, 90)}`,
      );
    }
    const after = await db.emailMessage.count({
      where: { eventId: rig.eventA, status: "SENT" },
    });
    if (after === before) ok("A10 personaliseInvite sends nothing");
    else bad("A10 personaliseInvite sends nothing", `${before} -> ${after}`);
  }

  console.log("\nA12 · a patched action executes against what was PROPOSED");
  {
    /**
     * Agent 8 · LOCKSMITH. A3 asks whether a patch can reach org B and answers
     * by counting rows over there. That is the question that matters, but it
     * cannot tell a refused patch apart from a crash — before the allowlist,
     * A3 passed because the pinned `eventId` left `guestIds` pointing at guests
     * of another event, and the mutation threw.
     *
     * This is the other half: with the identifiers refused and the copy
     * applied, the action must go through, against the guests the MODEL chose,
     * carrying the words the HUMAN wrote. The unit-level proof, with no
     * database in the way, is apps/console/scripts/critic-patch-allowlist.ts.
     *
     * It runs before A11 rather than after it so that A11's sweep — nothing,
     * anywhere in the rig, ever reaches SENT — covers the rows drafted here.
     */
    const proposedGuest = rig.guestsA[6]!;
    const action = await proposeRaw(rig, "draft_emails", {
      eventId: rig.eventA,
      guestIds: [proposedGuest],
      intent: "INVITE",
      draft: { subject: "Proposed", body: "Proposed body" },
    });
    const beforeB = await db.emailMessage.count({ where: { eventId: rig.eventB } });

    const res = await A.agent.approve({
      actionIds: [action.id],
      patch: {
        input: {
          // Refused: identifiers, not content.
          eventId: rig.eventB,
          guestIds: [rig.guestB, rig.guestsA[7]!],
          // Applied: the words on the card.
          draft: { subject: "Edited by a human", body: "Edited body" },
        },
      },
    });

    if (res.results[0]?.status === "EXECUTED") {
      ok("A12 a partly-refused patch still executes");
    } else {
      bad(
        "A12 a partly-refused patch still executes",
        `${res.results[0]?.status} ${res.results[0]?.error ?? ""}`,
      );
    }

    const rows = await db.emailMessage.findMany({
      where: { eventId: rig.eventA, subject: "Edited by a human" },
      select: { guestId: true, body: true },
    });
    if (rows.length === 1 && rows[0]?.guestId === proposedGuest) {
      ok("A12 drafted for the proposed guest only", `${rows.length} row`);
    } else {
      bad(
        "A12 drafted for the proposed guest only",
        `${rows.length} rows: ${rows.map((r) => r.guestId).join(", ")}`,
      );
    }
    if (rows[0]?.body.includes("Edited body")) {
      ok("A12 the human's words were used");
    } else {
      bad("A12 the human's words were used", rows[0]?.body.slice(0, 80) ?? "no row");
    }

    const afterB = await db.emailMessage.count({ where: { eventId: rig.eventB } });
    if (afterB === beforeB) ok("A12 nothing reached org B");
    else bad("A12 nothing reached org B", `${beforeB} -> ${afterB}`);

    // The refusal is not silent: it is on the result the organiser gets back,
    // and on the stored action row, as well as in the server log.
    const ignored = (res.results[0]?.result as { ignoredPatchFields?: string[] } | null)
      ?.ignoredPatchFields;
    if (ignored?.includes("eventId") && ignored?.includes("guestIds")) {
      ok("A12 the discarded fields are reported back", ignored.join(", "));
    } else {
      bad("A12 the discarded fields are reported back", JSON.stringify(ignored));
    }
  }

  console.log("\nA11 · does anything reach status SENT anywhere in the rig?");
  {
    const sent = await db.emailMessage.count({
      where: { event: { organisationId: { in: [rig.orgA, rig.orgB] } }, status: "SENT" },
    });
    if (sent === 0) ok("A11 zero SENT emails across the whole rig");
    else bad("A11 zero SENT emails across the whole rig", String(sent));
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
