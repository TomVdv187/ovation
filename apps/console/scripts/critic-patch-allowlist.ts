/**
 * Agent 8 · LOCKSMITH — the approval patch allowlist.
 *
 * Companion to critic-approval.ts, which asks the same questions against a
 * live database through the whole router. This file asks them of the merge
 * itself, and needs nothing: no database, no .env, no rig.
 *
 *     pnpm exec tsx apps/console/scripts/critic-patch-allowlist.ts
 *
 * That matters more than it sounds. The rule this proves — a patch may only
 * touch fields its tool has declared patchable — is the kind of thing that
 * gets weakened during a refactor by someone who cannot run the integration
 * suite because they have no credentials. This one they can run.
 *
 * INTEGRATION_REPORT.md §10 risk 3.
 */
import {
  agentActionPayloadSchema,
  applyApprovalPatch,
  PATCHABLE_FIELDS,
} from "@ovation/core/schemas";

// Same reporting shape as scripts/critic/rig.ts, reimplemented rather than
// imported: rig.ts opens a database connection at import time, and the point
// of this file is that it does not need one.
function ok(name: string, detail = ""): void {
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function bad(name: string, detail = ""): void {
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  process.exitCode = 1;
}

const EVENT_A = "evt_a_owned_by_the_proposal";
const EVENT_B = "evt_b_owned_by_someone_else";

/** Input as the model proposed it, before any human touched it. */
const proposed = {
  draft_emails: {
    type: "draft_emails",
    input: {
      eventId: EVENT_A,
      guestIds: ["gst_1", "gst_2"],
      intent: "INVITE",
      brief: "warm, short",
      draft: { subject: "Proposed subject", body: "Proposed body" },
    },
  },
  draft_sponsor_offer: {
    type: "draft_sponsor_offer",
    input: {
      eventId: EVENT_A,
      sponsorId: "spn_the_one_the_model_chose",
      targetPackage: "SILVER",
      incrementalAmountCents: 500_000,
      draft: { subject: "Proposed offer", body: "Proposed offer body" },
    },
  },
  update_event_theme: {
    type: "update_event_theme",
    input: { eventId: EVENT_A, theme: { preset: "classic" } },
  },
  get_budget_summary: {
    // A read-only tool never becomes an AgentAction. If one ever did, by a bug
    // or by hand, it must still accept no patch.
    type: "get_budget_summary",
    input: { eventId: EVENT_A },
  },
} as const;

function input(payload: unknown): Record<string, unknown> {
  return ((payload as { input?: Record<string, unknown> }).input ?? {});
}

console.log("\nP1 · a patch naming an identifier the tool does not allowlist");
{
  // The A3 attack, at the merge: keep the action, move the recipients.
  const { payload, ignored } = applyApprovalPatch(proposed.draft_emails, {
    input: {
      eventId: EVENT_B,
      guestIds: ["gst_belonging_to_org_b"],
      draft: { subject: "Edited subject", body: "Edited body" },
    },
  });
  const after = input(payload);

  if (after.eventId === EVENT_A) ok("P1 eventId still the proposed event");
  else bad("P1 eventId still the proposed event", String(after.eventId));

  if (JSON.stringify(after.guestIds) === JSON.stringify(["gst_1", "gst_2"])) {
    ok("P1 guestIds still the proposed guests");
  } else {
    bad("P1 guestIds still the proposed guests", JSON.stringify(after.guestIds));
  }

  // The legitimate half of the same patch still lands — a discarded field does
  // not invalidate the edit, it is refused on its own.
  if ((after.draft as { subject?: string }).subject === "Edited subject") {
    ok("P1 the allowlisted field in the same patch still applied");
  } else {
    bad("P1 the allowlisted field in the same patch still applied", JSON.stringify(after.draft));
  }

  if (JSON.stringify(ignored) === JSON.stringify(["eventId", "guestIds"])) {
    ok("P1 both refusals reported", ignored.join(", "));
  } else {
    bad("P1 both refusals reported", JSON.stringify(ignored));
  }
}

console.log("\nP2 · risk 3's own example: an id that eventId does not scope");
{
  // draft_sponsor_offer scopes its sponsor by eventId TODAY, which is why
  // pinning eventId was enough. This proves the allowlist does not rely on it.
  const { payload, ignored } = applyApprovalPatch(proposed.draft_sponsor_offer, {
    input: { sponsorId: "spn_a_different_sponsor", incrementalAmountCents: 1 },
  });
  const after = input(payload);

  if (after.sponsorId === "spn_the_one_the_model_chose") {
    ok("P2 sponsorId still the sponsor the model chose");
  } else {
    bad("P2 sponsorId still the sponsor the model chose", String(after.sponsorId));
  }
  if (after.incrementalAmountCents === 1) {
    ok("P2 the offer's amount is editable", "content, not target");
  } else {
    bad("P2 the offer's amount is editable", String(after.incrementalAmountCents));
  }
  if (JSON.stringify(ignored) === JSON.stringify(["sponsorId"])) {
    ok("P2 the refusal is reported");
  } else {
    bad("P2 the refusal is reported", JSON.stringify(ignored));
  }
}

console.log("\nP3 · a patch naming an allowlisted content field");
{
  const { payload, ignored } = applyApprovalPatch(proposed.update_event_theme, {
    input: { theme: { preset: "blacktie", dressCode: "Black tie" } },
  });
  const theme = input(payload).theme as { preset?: string; dressCode?: string };
  if (theme.preset === "blacktie" && theme.dressCode === "Black tie") {
    ok("P3 an allowlisted field is applied whole");
  } else {
    bad("P3 an allowlisted field is applied whole", JSON.stringify(theme));
  }
  if (ignored.length === 0) ok("P3 nothing reported as ignored");
  else bad("P3 nothing reported as ignored", JSON.stringify(ignored));
}

console.log("\nP4 · a tool with no allowlist entry accepts no patch");
{
  const { payload, ignored } = applyApprovalPatch(proposed.get_budget_summary, {
    input: { eventId: EVENT_B, minRisk: "LOW", anything: "at all" },
  });
  const after = input(payload);
  const unchanged =
    after.eventId === EVENT_A &&
    Object.keys(after).length === Object.keys(proposed.get_budget_summary.input).length;
  if (unchanged) ok("P4 payload untouched", JSON.stringify(after));
  else bad("P4 payload untouched", JSON.stringify(after));
  if (ignored.length === 3) ok("P4 all three fields reported", ignored.join(", "));
  else bad("P4 all three fields reported", JSON.stringify(ignored));

  // Belt and braces on the table itself: an empty entry is the only thing that
  // compiles for a read-only tool, but assert the value too, in case somebody
  // widens the type rather than the table.
  const readOnlyEmpty =
    PATCHABLE_FIELDS.get_budget_summary.length === 0 &&
    PATCHABLE_FIELDS.get_no_show_risks.length === 0;
  if (readOnlyEmpty) ok("P4 read-only tools declare no patchable fields");
  else bad("P4 read-only tools declare no patchable fields");
}

console.log("\nP5 · a payload whose type is not a tool at all");
{
  const { payload, ignored } = applyApprovalPatch(
    { type: "not_a_tool", input: { eventId: EVENT_A, theme: { preset: "x" } } },
    { input: { theme: { preset: "blacktie" } } },
  );
  // Default deny includes the case where there is nothing to look up.
  const theme = input(payload).theme as { preset?: string };
  if (theme.preset === "x" && JSON.stringify(ignored) === JSON.stringify(["theme"])) {
    ok("P5 unknown tool allowlists nothing");
  } else {
    bad("P5 unknown tool allowlists nothing", JSON.stringify({ theme, ignored }));
  }
}

console.log("\nP6 · the shapes a patch can arrive in");
{
  // The console sends { input: {...} }. A bare field map is accepted too, and
  // the same allowlist applies to it.
  const bare = applyApprovalPatch(proposed.update_event_theme, {
    theme: { preset: "blacktie" },
    eventId: EVENT_B,
  });
  const bareInput = input(bare.payload);
  if (
    (bareInput.theme as { preset?: string }).preset === "blacktie" &&
    bareInput.eventId === EVENT_A
  ) {
    ok("P6 a bare field map is allowlisted the same way", bare.ignored.join(", "));
  } else {
    bad("P6 a bare field map is allowlisted the same way", JSON.stringify(bareInput));
  }

  // `type` aims at the tool, not its input: refused, and named rather than
  // silently absorbed. Retyping a COSMETIC action as an OUTBOUND one at
  // approval time would run a different mutation than the one on the card.
  const retype = applyApprovalPatch(proposed.update_event_theme, {
    type: "change_event_date",
    input: { theme: { preset: "blacktie" } },
  });
  const stillTheme = (retype.payload as { type?: string }).type;
  if (stillTheme === "update_event_theme" && retype.ignored.includes("type")) {
    ok("P6 the tool itself cannot be patched", retype.ignored.join(", "));
  } else {
    bad("P6 the tool itself cannot be patched", `${stillTheme} / ${retype.ignored}`);
  }

  // Neither an array nor a scalar is a patch. Refuse, and say so.
  for (const [label, value] of [
    ["array", [{ theme: { preset: "blacktie" } }]],
    ["string", "theme=blacktie"],
  ] as const) {
    const res = applyApprovalPatch(proposed.update_event_theme, value);
    const untouched =
      JSON.stringify(res.payload) === JSON.stringify(proposed.update_event_theme);
    if (untouched && res.ignored.length === 1) ok(`P6 a ${label} patch applies nothing`);
    else bad(`P6 a ${label} patch applies nothing`, JSON.stringify(res));
  }

  // undefined and null are the no-patch path, and must not be reported as
  // refusals — the organiser edited nothing.
  for (const value of [undefined, null]) {
    const res = applyApprovalPatch(proposed.update_event_theme, value);
    if (res.payload === proposed.update_event_theme && res.ignored.length === 0) {
      ok(`P6 ${String(value)} is not a patch and not a refusal`);
    } else {
      bad(`P6 ${String(value)} is not a patch and not a refusal`, JSON.stringify(res));
    }
  }
}

console.log("\nP7 · a patch cannot reach the prototype");
{
  // JSON.parse, not a literal: `{ "__proto__": … }` written as a literal sets
  // the prototype, which is not what arrives over the wire. This is what does.
  const hostile = JSON.parse(
    '{"input":{"__proto__":{"polluted":true},"constructor":{"x":1},"theme":{"preset":"blacktie"}}}',
  ) as unknown;
  const { payload, ignored } = applyApprovalPatch(proposed.update_event_theme, hostile);
  const polluted = ({} as Record<string, unknown>).polluted;
  if (polluted === undefined) ok("P7 Object.prototype is clean");
  else bad("P7 Object.prototype is clean", String(polluted));
  if (ignored.includes("__proto__") && ignored.includes("constructor")) {
    ok("P7 both reported as refused", ignored.join(", "));
  } else {
    bad("P7 both reported as refused", JSON.stringify(ignored));
  }
  if ((input(payload).theme as { preset?: string }).preset === "blacktie") {
    ok("P7 the legitimate field still applied");
  } else {
    bad("P7 the legitimate field still applied");
  }
}

console.log("\nP8 · the allowlist does not replace the schema");
{
  // `quota` is patchable. A patchable field is not an unchecked one: the
  // result is re-parsed before it executes, and that is what refuses a tier
  // with no seats in it.
  const { payload } = applyApprovalPatch(
    {
      type: "create_ticket_tier",
      input: {
        eventId: EVENT_A,
        name: "Late Release",
        priceCents: 9000,
        quota: 20,
        opensAt: null,
      },
    },
    { input: { quota: 0 } },
  );
  const parsed = agentActionPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    ok("P8 an allowlisted field with an illegal value is still refused", "by zod");
  } else {
    bad("P8 an allowlisted field with an illegal value is still refused");
  }

  const good = applyApprovalPatch(
    {
      type: "create_ticket_tier",
      input: {
        eventId: EVENT_A,
        name: "Late Release",
        priceCents: 9000,
        quota: 20,
        opensAt: null,
      },
    },
    { input: { priceCents: 12_000, name: "Final Release" } },
  );
  const parsedGood = agentActionPayloadSchema.safeParse(good.payload);
  if (parsedGood.success && parsedGood.data.type === "create_ticket_tier") {
    const t = parsedGood.data.input;
    if (t.priceCents === 12_000 && t.name === "Final Release" && t.eventId === EVENT_A) {
      ok("P8 a legal edit parses and keeps its target");
    } else {
      bad("P8 a legal edit parses and keeps its target", JSON.stringify(t));
    }
  } else {
    bad("P8 a legal edit parses and keeps its target", "did not parse");
  }
}

/**
 * P9 · the compile-time half.
 *
 * These cannot be expressed as runtime checks: the proof is that the file does
 * not build. Each was applied to packages/core/src/schemas/agent.ts, run
 * through `tsc --noEmit`, and reverted. Verbatim output:
 *
 *   A) delete `update_agenda: ["agenda"],` from PATCHABLE_FIELDS
 *      error TS1360: Type '{ readonly update_event_theme: … }' does not
 *      satisfy the expected type 'PatchableFields'.
 *
 *   B) add "notify_sponsor_owner" to agentToolNameSchema and TOOL_RISK, but
 *      not to PATCHABLE_FIELDS — the exact scenario risk 3 describes
 *      error TS1360: Type '{ readonly update_event_theme: … }' does not
 *      satisfy the expected type 'PatchableFields'.
 *
 *   C) `draft_sponsor_offer: ["draft", "sponsorId"]`
 *      error TS2322: Type '"sponsorId"' is not assignable to type
 *      '"draft" | "targetPackage" | "incrementalAmountCents"'.
 *
 *   C2) `draft_emails: ["draft", "brief", "guestIds"]`
 *      error TS2322: Type '"guestIds"' is not assignable to type
 *      '"intent" | "brief" | "draft"'.
 *
 *   D) `update_event_theme: ["theme", "eventId"]`
 *      error TS2322: Type '"eventId"' is not assignable to type '"theme"'.
 *
 *   E) `get_budget_summary: ["eventId"]` — a read-only tool given a field
 *      error TS2322: Type '"eventId"' is not assignable to type 'never'.
 *
 *   F) `create_ticket_tier: [… "opensAtt"]` — a typo
 *      error TS2820: Type '"opensAtt"' is not assignable to type
 *      '"name" | "priceCents" | "quota" | "opensAt"'. Did you mean '"opensAt"'?
 *
 * A and B are the requirement: a tool cannot be added without stating what a
 * human may edit on it. C through F are what the table is worth beyond that —
 * the entry can only name real fields of that tool, and never an identifier.
 */

console.log(
  process.exitCode ? "\nFAILURES — see above.\n" : "\nAll patch-allowlist checks passed.\n",
);
