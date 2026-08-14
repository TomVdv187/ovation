import { z } from "zod";
import {
  actionRiskSchema,
  actorKindSchema,
  agentActionStatusSchema,
  centsSchema,
  chatRoleSchema,
  idSchema,
  jsonValueSchema,
} from "./common";
import { campaignIntentSchema } from "./guest";
import { eventThemeSchema, eventAgendaSchema } from "./event";

/**
 * THE SAFETY CONTRACT.
 *
 * The agent brain never mutates anything. A tool call produces an AgentAction
 * with status PROPOSED; `agent.approve` is the only path to EXECUTED, and it
 * performs the mutation transactionally. Read-only tools (`get_*`) answer
 * inline and never create an action.
 *
 * COSMETIC actions may auto-approve when the organisation opts in.
 * OUTBOUND (anything that leaves the building) and DESTRUCTIVE actions must
 * never auto-approve, regardless of settings — enforced in `requiresApproval`.
 */

// ── tool registry ─────────────────────────────────────────────

export const agentToolNameSchema = z.enum([
  // mutating — always produce a PROPOSED AgentAction
  "update_event_theme",
  "update_agenda",
  "change_event_date",
  "draft_emails",
  "create_ticket_tier",
  "draft_sponsor_offer",
  // read-only — answer inline
  "get_no_show_risks",
  "get_budget_summary",
]);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;

export const READ_ONLY_TOOLS = [
  "get_no_show_risks",
  "get_budget_summary",
] as const satisfies readonly AgentToolName[];

/** Risk floor per tool. Implementations may raise it, never lower it. */
export const TOOL_RISK: Record<AgentToolName, z.infer<typeof actionRiskSchema>> =
  {
    update_event_theme: "COSMETIC",
    update_agenda: "OPERATIONAL",
    change_event_date: "DESTRUCTIVE",
    draft_emails: "OUTBOUND",
    create_ticket_tier: "OPERATIONAL",
    draft_sponsor_offer: "OUTBOUND",
    get_no_show_risks: "COSMETIC",
    get_budget_summary: "COSMETIC",
  };

/**
 * What a human may edit in the review UI before approving — per tool, allowlist.
 *
 * Approving a proposal can carry a `patch`: the organiser rewords a drafted
 * email, corrects a price, moves a date. That patch is merged over the payload
 * the model proposed, so it decides what actually executes.
 *
 * It used to be a blocklist — merge everything, then pin `type` and `eventId`
 * back from the stored payload. That was safe only by coincidence: every tool
 * happens to scope its other identifiers by event, so an unpatchable `eventId`
 * made them unreachable. The coincidence ends the moment somebody adds a tool
 * taking an id that is not scoped by event, and nothing would fail — no test,
 * no type error, no review comment. A blocklist has to be updated by whoever
 * adds the tool, and they will not know it exists.
 *
 * So: default deny. A field not named here is discarded, not merged.
 *
 * The rule for what belongs in a list: **content, never targets.** Words, money,
 * dates, quantities — things a human can sensibly correct. Never an identifier
 * that selects who or what is acted upon. `draft_emails` therefore allows
 * `draft` and not `guestIds`; `draft_sponsor_offer` allows the copy and the
 * amount and not `sponsorId`. Editing the copy is review. Editing the
 * recipients is a different action wearing the approved one's clothes.
 *
 * `Record<AgentToolName, …>` is load-bearing: add a tool and this stops
 * compiling until you say what a human may edit in it.
 */
export const TOOL_PATCHABLE_FIELDS: Record<AgentToolName, readonly string[]> = {
  update_event_theme: ["theme"],
  update_agenda: ["agenda"],
  change_event_date: ["date", "endsAt", "reason"],
  // Not `guestIds`, not `intent`. The words are reviewable; the recipients are
  // the action itself.
  draft_emails: ["draft"],
  create_ticket_tier: ["name", "priceCents", "quota", "opensAt"],
  // Not `sponsorId` — the exact field the blocklist would have let through,
  // since it is an id this tool does not scope by event.
  draft_sponsor_offer: ["draft", "targetPackage", "incrementalAmountCents"],
  // Read-only tools never produce an action, so nothing can be patched.
  get_no_show_risks: [],
  get_budget_summary: [],
};

export interface ToolPatchResult {
  input: Record<string, unknown>;
  /** Field names the patch tried to set that this tool does not allow. */
  discarded: string[];
}

/**
 * Merge an approval patch onto a stored tool input, honouring the allowlist.
 *
 * Accepts the patch either as the input object itself or wrapped in `{ input }`,
 * because both shapes reach `agent.approve` from the console today.
 *
 * Discards are returned rather than swallowed. A human who edited a field the
 * system ignored should not be left believing it applied.
 */
export function applyToolPatch(
  tool: AgentToolName,
  input: Record<string, unknown>,
  patch: unknown,
): ToolPatchResult {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return { input, discarded: [] };
  }

  const raw = patch as Record<string, unknown>;
  const wrapped = raw.input;
  const fields =
    wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
      ? (wrapped as Record<string, unknown>)
      : raw;

  const allowed = new Set(TOOL_PATCHABLE_FIELDS[tool]);
  const next: Record<string, unknown> = { ...input };
  const discarded: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (allowed.has(key)) next[key] = value;
    else discarded.push(key);
  }

  return { input: next, discarded };
}

/**
 * The single gate. `autoApproveCosmetic` is an organisation setting; nothing
 * outbound or destructive is ever exempt.
 */
export function requiresApproval(
  risk: z.infer<typeof actionRiskSchema>,
  autoApproveCosmetic: boolean,
): boolean {
  if (risk === "OUTBOUND" || risk === "DESTRUCTIVE") return true;
  if (risk === "COSMETIC") return !autoApproveCosmetic;
  return true;
}

// ── tool inputs, 1:1 with the payloads stored on AgentAction ──

export const updateEventThemeInput = z.object({
  eventId: idSchema,
  theme: eventThemeSchema.partial(),
});

export const updateAgendaInput = z.object({
  eventId: idSchema,
  agenda: eventAgendaSchema,
});

export const changeEventDateInput = z.object({
  eventId: idSchema,
  date: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  reason: z.string().optional(),
});

/**
 * CC-001. `draft` carries the words being approved.
 *
 * `brief` is the steer BEHIND the copy; `draft` is the copy. Approval is only
 * meaningful if the organiser approves specific words, so the proposal card
 * renders `payload.input.draft` and `agent.approve` sends exactly that.
 */
export const draftCopySchema = z.object({
  subject: z.string().max(200),
  body: z.string(),
});
export type DraftCopy = z.infer<typeof draftCopySchema>;

export const draftEmailsInput = z.object({
  eventId: idSchema,
  guestIds: z.array(idSchema).min(1),
  intent: campaignIntentSchema,
  brief: z.string().max(2000).optional(),
  draft: draftCopySchema.optional(),
});

export const createTicketTierInput = z.object({
  eventId: idSchema,
  name: z.string().min(1),
  priceCents: centsSchema,
  quota: z.number().int().positive(),
  opensAt: z.coerce.date().nullish(),
});

export const draftSponsorOfferInput = z.object({
  eventId: idSchema,
  sponsorId: idSchema,
  targetPackage: z.enum(["GOLD", "SILVER", "CUSTOM"]),
  incrementalAmountCents: centsSchema,
  /** CC-001 — see draftCopySchema. */
  draft: draftCopySchema.optional(),
});

export const getNoShowRisksInput = z.object({
  eventId: idSchema,
  minRisk: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
});

export const getBudgetSummaryInput = z.object({ eventId: idSchema });

/**
 * Payload union stored in AgentAction.payload. Discriminated on the tool name
 * so the executor can switch exhaustively.
 */
export const agentActionPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("update_event_theme"), input: updateEventThemeInput }),
  z.object({ type: z.literal("update_agenda"), input: updateAgendaInput }),
  z.object({ type: z.literal("change_event_date"), input: changeEventDateInput }),
  z.object({ type: z.literal("draft_emails"), input: draftEmailsInput }),
  z.object({ type: z.literal("create_ticket_tier"), input: createTicketTierInput }),
  z.object({
    type: z.literal("draft_sponsor_offer"),
    input: draftSponsorOfferInput,
  }),
]);
export type AgentActionPayload = z.infer<typeof agentActionPayloadSchema>;

// ── the action itself ─────────────────────────────────────────

export const sideEffectSchema = z.object({
  label: z.string(),
  detail: z.string().nullish(),
  /** e.g. 42 invitations, 1 public page. Rendered on the proposal card. */
  count: z.number().int().nullish(),
});
export type SideEffect = z.infer<typeof sideEffectSchema>;

export const agentActionSchema = z.object({
  id: idSchema,
  organisationId: idSchema,
  eventId: idSchema.nullable(),
  type: agentToolNameSchema,
  summary: z.string(),
  payload: jsonValueSchema,
  sideEffects: z.array(sideEffectSchema),
  status: agentActionStatusSchema,
  risk: actionRiskSchema,
  createdBy: actorKindSchema,
  createdById: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.coerce.date().nullable(),
  executedAt: z.coerce.date().nullable(),
  result: jsonValueSchema.nullable(),
  error: z.string().nullable(),
  chatMessageId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentAction = z.infer<typeof agentActionSchema>;

// ── agent.command ─────────────────────────────────────────────

export const agentCommandInput = z.object({
  eventId: idSchema,
  message: z.string().min(1).max(4000),
  /** Continues an existing console conversation. */
  threadFrom: z.coerce.date().optional(),
});

export const agentCommandOutput = z.object({
  chatMessageId: idSchema,
  reply: z.string(),
  /** Proposal cards to render. Always PROPOSED at this point. */
  proposals: z.array(agentActionSchema),
  /** Follow-up chips under the reply. */
  suggestions: z.array(z.string()).default([]),
});
export type AgentCommandResult = z.infer<typeof agentCommandOutput>;

// ── agent.approve / reject ────────────────────────────────────

export const agentApproveInput = z.object({
  actionIds: z.array(idSchema).min(1),
  /** Organiser tweaks to the payload before executing. */
  patch: jsonValueSchema.optional(),
});

export const agentApproveOutput = z.object({
  results: z.array(
    z.object({
      actionId: idSchema,
      status: agentActionStatusSchema,
      result: jsonValueSchema.nullable(),
      error: z.string().nullable(),
    }),
  ),
});

export const agentRejectInput = z.object({
  actionIds: z.array(idSchema).min(1),
  reason: z.string().max(500).optional(),
});

// ── agent.actions / history ───────────────────────────────────

export const agentActionsInput = z.object({
  eventId: idSchema,
  status: agentActionStatusSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const agentActionsOutput = z.object({
  items: z.array(agentActionSchema),
  pendingApprovals: z.number().int().nonnegative(),
});

export const chatMessageSchema = z.object({
  id: idSchema,
  eventId: idSchema,
  role: chatRoleSchema,
  content: z.string(),
  toolCalls: jsonValueSchema.nullable(),
  suggestions: z.array(z.string()),
  createdAt: z.coerce.date(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const agentHistoryInput = z.object({
  eventId: idSchema,
  limit: z.number().int().min(1).max(200).default(50),
});

export const agentHistoryOutput = z.object({
  messages: z.array(chatMessageSchema),
  /** Proposals still awaiting a decision, so a reload restores the cards. */
  openProposals: z.array(agentActionSchema),
});
