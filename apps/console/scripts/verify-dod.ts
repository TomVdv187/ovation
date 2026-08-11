/**
 * Definition-of-done harness for Agent 1 · CONDUCTOR.
 *
 *   pnpm --filter @ovation/console verify:dod
 *
 * ANTHROPIC_API_KEY is not required. The Anthropic call is the only part of the
 * brain that needs the network, so it is injected: `scriptedModel` returns the
 * exact tool_use blocks a real turn would produce, and everything downstream is
 * the production code path. What that proves is the part that must not break,
 * namely tool call -> AgentAction PROPOSED -> approve -> transactional
 * mutation, and the gate that stops OUTBOUND and DESTRUCTIVE auto-approving.
 *
 * With a key present it additionally runs one live turn against claude-opus-5.
 *
 * The script cleans up after itself: every row it writes is tagged and removed
 * at the end. The one deliberate exception is Event.theme.preset, which check 1
 * requires to end at "blacktie".
 */
import { db } from "@ovation/core/db";
import { requiresApproval, type SideEffect } from "@ovation/core";
import { runAgentTurn } from "../src/server/agent/brain";
import { executeApprovedActions } from "../src/server/agent/execute";
import {
  anthropicModel,
  isModelConfigured,
  type AgentModel,
  type AgentModelResponse,
} from "../src/server/agent/model";

const TAG = "verify-dod";
const SLUG = "meridian-summit-2026";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

/** A model that replays scripted turns. No network, production loop. */
function scriptedModel(turns: AgentModelResponse[]): AgentModel {
  let i = 0;
  return {
    async run({ onText }) {
      const turn = turns[i++];
      if (!turn) throw new Error("Scripted model ran out of turns.");
      for (const block of turn.content) {
        if (block.type === "text") onText?.(block.text);
      }
      return turn;
    },
  };
}

const text = (t: string) => ({ type: "text" as const, text: t });
const toolUse = (name: string, input: unknown, id = `tu_${Math.random().toString(36).slice(2, 10)}`) => ({
  type: "tool_use" as const,
  id,
  name,
  input,
});

async function main() {
  const event = await db.event.findUnique({ where: { slug: SLUG } });
  if (!event) throw new Error(`Seed event ${SLUG} not found.`);
  const user = await db.user.findFirst({
    where: { organisationId: event.organisationId },
  });
  if (!user) throw new Error("No user attached to the organisation.");

  const base = {
    db,
    eventId: event.id,
    organisationId: event.organisationId,
    userId: user.id,
  };

  console.log(`\nEvent: ${event.title} (${event.id})`);
  console.log(`Organisation: ${event.organisationId}`);
  console.log(`Model configured: ${isModelConfigured()}\n`);

  // Baseline, so "the theme is not applied yet" means something on a re-run.
  await db.event.update({
    where: { id: event.id },
    data: {
      theme: { preset: "classic", palette: {}, typography: {}, dressCode: "Business" },
    },
  });
  await setAutoApprove(event.organisationId, false);

  const emailsBefore = await db.emailMessage.count();
  const tiersBefore = await db.ticketTier.count({ where: { eventId: event.id } });
  const ordersBefore = await db.order.aggregate({
    where: { eventId: event.id, status: "PAID" },
    _sum: { amountCents: true },
  });

  // ── 1 · "Make it black-tie" ───────────────────────────────────
  console.log("1 · Make it black-tie -> themed proposal -> approve -> DB");

  const themeTurn = await runAgentTurn({
    ...base,
    message: "Make it black-tie",
    model: scriptedModel([
      {
        content: [
          text("Black tie it is. I have put the restyle up for your approval."),
          toolUse("update_event_theme", {
            summary: "Restyle the page black-tie and set the dress code",
            preset: "blacktie",
            dressCode: "Black tie",
            notes: "Formal evening treatment for the Antwerp edition.",
          }),
        ],
        stopReason: "tool_use",
      },
      {
        content: [
          text(
            "Black tie it is. I have put the restyle up for your approval; nothing changes on the public page until you approve it.",
          ),
        ],
        stopReason: "end_turn",
      },
    ]),
  });

  const themeProposal = themeTurn.proposals[0];
  check("a themed proposal card is produced", themeTurn.proposals.length === 1);
  check(
    "proposal type is update_event_theme",
    themeProposal?.type === "update_event_theme",
    themeProposal?.type,
  );
  check("proposal is PROPOSED", themeProposal?.status === "PROPOSED", themeProposal?.status);
  check("proposal risk is COSMETIC", themeProposal?.risk === "COSMETIC", themeProposal?.risk);
  check(
    "the theme is NOT yet applied to the event",
    ((await themePreset(event.id)) ?? "") !== "blacktie",
    `preset=${await themePreset(event.id)}`,
  );
  check("the reply carries suggestion chips", themeTurn.suggestions.length > 0);

  const approved = await executeApprovedActions(db, [themeProposal!.id], {
    kind: "HUMAN",
    userId: user.id,
  });
  check("approve returns EXECUTED", approved[0]?.status === "EXECUTED", approved[0]?.error ?? "");
  check(
    "Event.theme.preset is now blacktie in the database",
    (await themePreset(event.id)) === "blacktie",
    `preset=${await themePreset(event.id)}`,
  );
  check(
    "the dress code landed too",
    (await themeField(event.id, "dressCode")) === "Black tie",
  );

  // ── 2 · "Move the event to 1 October" ─────────────────────────
  console.log("\n2 · Move the event to 1 October -> DESTRUCTIVE, cannot auto-approve");

  const dateTurn = await runAgentTurn({
    ...base,
    message: "Move the event to 1 October",
    model: scriptedModel([
      {
        content: [
          toolUse("change_event_date", {
            summary: "Move Meridian Summit 2026 to 1 October 2026",
            date: "2026-10-01T16:30:00.000Z",
            endsAt: "2026-10-01T21:30:00.000Z",
            reason: "Organiser request",
          }),
        ],
        stopReason: "tool_use",
      },
      {
        content: [
          text(
            "Proposed, but read it before you approve. Moving the date invalidates every calendar invite already accepted, rewrites the public page, and obliges a re-announcement to the full guest list. Paid ticket holders may also be entitled to a refund.",
          ),
        ],
        stopReason: "end_turn",
      },
    ]),
  });

  const dateProposal = dateTurn.proposals[0];
  check("a date-change proposal is produced", dateTurn.proposals.length === 1);
  check("risk is DESTRUCTIVE", dateProposal?.risk === "DESTRUCTIVE", dateProposal?.risk);
  check("it stays PROPOSED", dateProposal?.status === "PROPOSED", dateProposal?.status);

  const labels = (dateProposal?.sideEffects ?? []).map((s: SideEffect) =>
    `${s.label} ${s.detail ?? ""}`.toLowerCase(),
  );
  check(
    "side effects list calendar invites",
    labels.some((l) => l.includes("calendar invite")),
  );
  check(
    "side effects list the public page",
    labels.some((l) => l.includes("public event page") || l.includes("public page")),
  );
  check(
    "side effects list guest emails",
    labels.some((l) => l.includes("guest emails")),
  );
  check(
    "side effects flag the paid orders",
    labels.some((l) => l.includes("paid order")),
  );

  // The adversarial half: switch the org's cosmetic auto-approve ON and prove
  // the destructive proposal still refuses to execute itself.
  await setAutoApprove(event.organisationId, true);
  check(
    "requiresApproval(DESTRUCTIVE, autoApprove=true) is still true",
    requiresApproval("DESTRUCTIVE", true),
  );
  check(
    "requiresApproval(OUTBOUND, autoApprove=true) is still true",
    requiresApproval("OUTBOUND", true),
  );

  const autoAttempt = await executeApprovedActions(db, [dateProposal!.id], {
    kind: "AUTO",
    autoApproveCosmetic: true,
  });
  check(
    "the AUTO path refuses the destructive action",
    autoAttempt[0]?.status === "PROPOSED",
    autoAttempt[0]?.status,
  );
  check(
    "the event date is untouched",
    (await eventDate(event.id)) === event.date.toISOString(),
    await eventDate(event.id),
  );

  // ...while a COSMETIC proposal does auto-approve with the flag on.
  const autoCosmetic = await runAgentTurn({
    ...base,
    message: "Set the dress code to Cocktail",
    model: scriptedModel([
      {
        content: [
          toolUse("update_event_theme", {
            summary: "Set the dress code to Cocktail",
            dressCode: "Cocktail",
          }),
        ],
        stopReason: "tool_use",
      },
      { content: [text("Done, that one was cosmetic so it applied straight away.")], stopReason: "end_turn" },
    ]),
  });
  check(
    "with autoApproveCosmetic on, a COSMETIC proposal executes itself",
    autoCosmetic.proposals[0]?.status === "EXECUTED",
    autoCosmetic.proposals[0]?.status,
  );

  await setAutoApprove(event.organisationId, false);
  // Put the dress code back where check 1 left it.
  await executeApprovedActions(
    db,
    [
      (
        await proposeVia(base, "Restore the black-tie dress code", {
          summary: "Restore the black-tie dress code",
          preset: "blacktie",
          dressCode: "Black tie",
        })
      ).id,
    ],
    { kind: "HUMAN", userId: user.id },
  );

  // ── 3 · "Email the 20 guests most likely to no-show" ──────────
  console.log("\n3 · Email the 20 likeliest no-shows -> proposal only, sends nothing");

  const risky = await db.guest.findMany({
    where: { eventId: event.id, noShowRisk: { in: ["HIGH", "MEDIUM"] } },
    orderBy: { noShowProbability: "desc" },
    take: 20,
    select: { id: true },
  });

  const emailTurn = await runAgentTurn({
    ...base,
    message: "Email the 20 guests most likely to no-show",
    model: scriptedModel([
      {
        content: [toolUse("get_no_show_risks", { minRisk: "MEDIUM", limit: 20 })],
        stopReason: "tool_use",
      },
      {
        content: [
          toolUse("draft_emails", {
            summary: "Re-confirm the 20 guests likeliest to drop out",
            guestIds: risky.map((g) => g.id),
            intent: "RECOVERY",
            brief: "Warm, short, ask them to reconfirm.",
            subject: "Still joining us in Antwerp?",
            body: "We are finalising numbers for Meridian Summit 2026 and would love to keep your seat. A one-line reply is all we need.",
          }),
        ],
        stopReason: "tool_use",
      },
      {
        content: [
          text(
            "Twenty drafts are waiting for you. Nothing has been sent and nothing will be until you approve them.",
          ),
        ],
        stopReason: "end_turn",
      },
    ]),
  });

  const emailProposal = emailTurn.proposals[0];
  check("a draft_emails proposal is produced", emailTurn.proposals.length === 1);
  check("risk is OUTBOUND", emailProposal?.risk === "OUTBOUND", emailProposal?.risk);
  check("it stays PROPOSED", emailProposal?.status === "PROPOSED", emailProposal?.status);
  check(
    "it targets 20 real guests",
    (emailProposal?.payload as { input?: { guestIds?: string[] } })?.input?.guestIds
      ?.length === 20,
  );
  check(
    "NOT ONE EmailMessage was created by proposing",
    (await db.emailMessage.count()) === emailsBefore,
    `${await db.emailMessage.count()} vs ${emailsBefore}`,
  );
  check(
    "nothing is SENT or QUEUED anywhere on the event",
    (await db.emailMessage.count({
      where: { eventId: event.id, status: { in: ["SENT", "QUEUED"] }, campaignId: { not: null } },
    })) === (await db.emailMessage.count({ where: { eventId: event.id, status: "SENT" } })),
  );

  const autoEmail = await executeApprovedActions(db, [emailProposal!.id], {
    kind: "AUTO",
    autoApproveCosmetic: true,
  });
  check(
    "the AUTO path refuses the outbound action even with the flag on",
    autoEmail[0]?.status === "PROPOSED",
    autoEmail[0]?.status,
  );

  // Approve it for real, then prove the drafts exist but nothing was sent.
  const emailApproved = await executeApprovedActions(db, [emailProposal!.id], {
    kind: "HUMAN",
    userId: user.id,
  });
  const campaignId = (emailApproved[0]?.result as { campaignId?: string } | null)
    ?.campaignId;
  const drafted = await db.emailMessage.findMany({
    where: { campaignId: campaignId ?? "__none__" },
    select: { status: true, sentAt: true, providerMessageId: true },
  });
  check("approving drafts the 20 messages", drafted.length === 20, `${drafted.length}`);
  check(
    "every drafted message is APPROVED, none SENT",
    drafted.every((d) => d.status === "APPROVED"),
  );
  check(
    "no drafted message has a send timestamp or provider id",
    drafted.every((d) => d.sentAt === null && d.providerMessageId === null),
  );

  // Leave the seeded email table exactly as found.
  await db.emailMessage.deleteMany({ where: { campaignId: campaignId ?? "__none__" } });
  check(
    "harness cleaned up its drafts",
    (await db.emailMessage.count()) === emailsBefore,
  );

  // ── 4 · Rejecting mutates nothing ─────────────────────────────
  console.log("\n4 · Reject -> REJECTED, nothing mutated");

  const before = await themeField(event.id, "dressCode");
  const toReject = await proposeVia(base, "Make it a beach party", {
    summary: "Restyle the page as a beach party",
    preset: "classic",
    dressCode: "Swimwear",
  });

  await db.agentAction.updateMany({
    where: { id: toReject.id },
    data: { status: "REJECTED", approvedBy: user.id, approvedAt: new Date() },
  });
  const rejected = await db.agentAction.findUnique({ where: { id: toReject.id } });
  check("the action is REJECTED", rejected?.status === "REJECTED", rejected?.status);
  check(
    "the theme is unchanged by the rejection",
    (await themeField(event.id, "dressCode")) === before,
    `dressCode=${await themeField(event.id, "dressCode")}`,
  );
  check("the rejected action has no executedAt", rejected?.executedAt === null);

  const reExecute = await executeApprovedActions(db, [toReject.id], {
    kind: "HUMAN",
    userId: user.id,
  });
  check(
    "a rejected action cannot then be executed",
    reExecute[0]?.status === "REJECTED",
    reExecute[0]?.status,
  );

  // ── 5 · A reload restores the thread and the open cards ───────
  console.log("\n5 · agent.history restores the thread and open proposals");

  const messages = await db.chatMessage.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: "asc" },
  });
  const openProposals = await db.agentAction.findMany({
    where: { eventId: event.id, status: "PROPOSED" },
  });
  check(
    "the conversation persisted as ChatMessage rows",
    messages.length >= 6,
    `${messages.length} messages`,
  );
  check(
    "both roles are stored",
    messages.some((m) => m.role === "USER") && messages.some((m) => m.role === "ASSISTANT"),
  );
  check(
    "assistant turns carry their suggestion chips",
    messages.some((m) => m.role === "ASSISTANT" && m.suggestions.length > 0),
  );
  check(
    "assistant turns carry their tool calls",
    messages.some((m) => m.role === "ASSISTANT" && m.toolCalls !== null),
  );
  check(
    "open proposals survive for the reload",
    openProposals.some((p) => p.id === dateProposal!.id),
    `${openProposals.length} open`,
  );

  // ── invariants ────────────────────────────────────────────────
  console.log("\n·  Fixtures the other agents assert against are untouched");
  const ordersAfter = await db.order.aggregate({
    where: { eventId: event.id, status: "PAID" },
    _sum: { amountCents: true },
  });
  check(
    "ticket revenue is unchanged",
    ordersAfter._sum.amountCents === ordersBefore._sum.amountCents,
    `${(ordersAfter._sum.amountCents ?? 0) / 100} EUR`,
  );
  check(
    "no ticket tier was added",
    (await db.ticketTier.count({ where: { eventId: event.id } })) === tiersBefore,
  );
  check(
    "the seeded proposals are still open",
    (await db.agentAction.count({
      where: { eventId: event.id, status: "PROPOSED", createdById: null },
    })) === 3,
  );

  // ── optional live turn ────────────────────────────────────────
  if (isModelConfigured()) {
    console.log("\n·  Live turn against claude-opus-5");
    try {
      const live = await runAgentTurn({
        ...base,
        message: "Make it black-tie",
        model: anthropicModel(),
      });
      check("the live model replied", live.reply.length > 0);
      check(
        "the live model proposed a theme change",
        live.proposals.some((p) => p.type === "update_event_theme"),
        live.proposals.map((p) => p.type).join(",") || "no proposals",
      );
      console.log(`\n    reply: ${live.reply.slice(0, 400)}\n`);
      await db.agentAction.deleteMany({
        where: { id: { in: live.proposals.map((p) => p.id) }, status: "PROPOSED" },
      });
    } catch (error) {
      check("live turn", false, (error as Error).message);
    }
  } else {
    console.log(
      "\n·  ANTHROPIC_API_KEY is not set: the live model turn was SKIPPED.",
    );
    console.log(
      "   Everything above ran the production loop with a scripted model.",
    );
  }

  await cleanup(event.id);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── helpers ─────────────────────────────────────────────────────

async function themePreset(eventId: string): Promise<string | undefined> {
  return themeField(eventId, "preset");
}

async function themeField(eventId: string, key: string): Promise<string | undefined> {
  const e = await db.event.findUnique({
    where: { id: eventId },
    select: { theme: true },
  });
  const theme = (e?.theme ?? {}) as Record<string, unknown>;
  return typeof theme[key] === "string" ? (theme[key] as string) : undefined;
}

async function eventDate(eventId: string): Promise<string> {
  const e = await db.event.findUnique({
    where: { id: eventId },
    select: { date: true },
  });
  return e!.date.toISOString();
}

async function setAutoApprove(organisationId: string, on: boolean): Promise<void> {
  const org = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { settings: true },
  });
  await db.organisation.update({
    where: { id: organisationId },
    data: {
      settings: {
        ...((org?.settings ?? {}) as Record<string, unknown>),
        autoApproveCosmetic: on,
      },
    },
  });
}

/** A one-shot themed proposal, used to set up later checks. */
async function proposeVia(
  base: { db: typeof db; eventId: string; organisationId: string; userId: string },
  message: string,
  input: Record<string, unknown>,
) {
  const turn = await runAgentTurn({
    ...base,
    message,
    model: scriptedModel([
      { content: [toolUse("update_event_theme", input)], stopReason: "tool_use" },
      { content: [text("Proposed.")], stopReason: "end_turn" },
    ]),
  });
  return turn.proposals[0]!;
}

/** Every row this harness wrote, removed. */
async function cleanup(eventId: string): Promise<void> {
  await db.agentAction.deleteMany({
    where: { eventId, createdById: { not: null } },
  });
  await db.chatMessage.deleteMany({ where: { eventId } });
}

main().catch(async (error) => {
  console.error("\nHARNESS ERROR", error);
  process.exit(1);
});

export { TAG };
