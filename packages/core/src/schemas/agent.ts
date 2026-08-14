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

// The companion table — what a human may edit at approval time, per tool — is
// PATCHABLE_FIELDS. It sits below the tool inputs because it is typed against
// them. Adding a tool without an entry there does not compile, like TOOL_RISK.

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

// ── what a human may edit at approval time ────────────────────

/**
 * THE APPROVAL DOOR.
 *
 * A human reviewing a proposal may edit it before clicking Approve, and those
 * edits arrive as `agent.approve`'s `patch`. This table is the whole of what a
 * patch is allowed to reach.
 *
 * It is an ALLOWLIST, and it replaced a merge-with-exclusions that pinned
 * `type` and `eventId` and let everything else through. That was safe only
 * because every tool happens to scope its other identifiers by event: the first
 * tool to take a `sponsorId`, `userId` or `organisationId` that is NOT scoped
 * by `eventId` would have reopened the door silently, with no test failing.
 * INTEGRATION_REPORT.md §10 risk 3.
 *
 * Two rules, and the type below enforces both as far as a type can:
 *
 * 1. CONTENT, NEVER TARGETS. Copy a human might reasonably rewrite — a subject,
 *    a body, a price, a date being corrected. Never an identifier that selects
 *    who or what is acted upon. An identifier cannot even be NAMED here: any
 *    field ending `Id` or `Ids` is excluded from the field type, so
 *    `draft_sponsor_offer: ["sponsorId"]` does not compile, and neither would
 *    the `userId` or `organisationId` of a tool nobody has written yet.
 * 2. DEFAULT DENY. A field not named for its tool is discarded, not merged, and
 *    the discard is reported rather than swallowed. A tool with no fields
 *    accepts no patch at all — which is what the read-only tools get, typed as
 *    `readonly never[]` so `[]` is the only value that compiles.
 *
 * ADDING A TOOL FORCES THE DECISION: `satisfies PatchableFields` fails to
 * compile until the new member of `AgentToolName` has an entry here, and each
 * entry may only name fields that exist on that tool's own input schema.
 *
 * The `Id`/`Ids` rule is a naming convention doing load-bearing work, which is
 * worth saying out loud: it catches the identifier that is spelled like one.
 * A target field named `recipient` or `audience` would still compile, and the
 * human writing the entry is what stops it. That is a smaller gap than the one
 * this replaces — it needs somebody to add BOTH an unconventionally-named
 * target AND an entry naming it, rather than merely to add a tool.
 */
type PatchableFieldName<T> = Exclude<
  keyof T & string,
  /**
   * `eventId` is pinned from the stored payload; the rest is the convention.
   * A patchable field may not be an identifier, and an identifier is spelled
   * like one everywhere in this contract.
   */
  `${string}Id` | `${string}Ids`
>;

type MutatingToolFields = {
  [P in AgentActionPayload as P["type"]]: PatchableFieldName<P["input"]>;
};

export type PatchableFields = {
  [K in AgentToolName]: readonly (K extends keyof MutatingToolFields
    ? MutatingToolFields[K]
    : never)[];
};

export const PATCHABLE_FIELDS = {
  update_event_theme: ["theme"],
  update_agenda: ["agenda"],
  // A date being corrected is the canonical legitimate edit.
  change_event_date: ["date", "endsAt", "reason"],
  // The words, and the steer behind them. NOT `guestIds` — that is who.
  draft_emails: ["draft", "brief"],
  // Everything here describes a tier being created, not one being selected.
  create_ticket_tier: ["name", "priceCents", "quota", "opensAt"],
  // The offer. NOT `sponsorId` — that is who, and it is risk 3's own example.
  draft_sponsor_offer: ["draft", "targetPackage", "incrementalAmountCents"],
  // Read-only tools never become an AgentAction, so nothing can patch them.
  get_no_show_risks: [],
  get_budget_summary: [],
} as const satisfies PatchableFields;

/** What `applyApprovalPatch` did, so the caller can log and surface it. */
export interface PatchOutcome {
  /** The payload to execute: stored, with allowlisted fields overwritten. */
  payload: unknown;
  /** Fields the human sent that were NOT applied. Sorted, may be empty. */
  ignored: string[];
}

/**
 * Merge an organiser's patch over a stored payload, allowlist first.
 *
 * Pure, and deliberately outside the executor: this is contract behaviour, and
 * a change to it is a change to what approval means.
 *
 * Anything unrecognised — a patch that is not an object, a payload whose type
 * is not a known tool — applies nothing and says so. It never throws; the
 * result is re-parsed against `agentActionPayloadSchema` downstream, which is
 * what rejects a well-named field with a malformed value.
 */
export function applyApprovalPatch(
  payload: unknown,
  patch: unknown,
): PatchOutcome {
  if (patch === undefined || patch === null) return { payload, ignored: [] };
  if (typeof patch !== "object" || Array.isArray(patch)) {
    return { payload, ignored: ["<patch was not an object>"] };
  }

  const base = (payload ?? {}) as Record<string, unknown>;
  const baseInput = (base.input as Record<string, unknown>) ?? {};
  const p = patch as Record<string, unknown>;
  // The console sends `{ input: { … } }`; a bare field map is accepted too.
  const patchInput =
    p.input && typeof p.input === "object" && !Array.isArray(p.input)
      ? (p.input as Record<string, unknown>)
      : p;

  const tool = agentToolNameSchema.safeParse(base.type);
  const allowed: readonly string[] = tool.success
    ? PATCHABLE_FIELDS[tool.data]
    : [];

  const applied: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const field of Object.keys(patchInput)) {
    if (allowed.includes(field)) applied[field] = patchInput[field];
    else ignored.push(field);
  }
  // A patch of `{ type: … }` is aimed at the tool, not its input. Same verdict,
  // but say so by name rather than letting it vanish into the input map.
  if (patchInput !== p && "type" in p) ignored.push("type");

  return {
    payload: {
      ...base,
      type: base.type,
      input: { ...baseInput, ...applied, eventId: baseInput.eventId },
    },
    ignored: ignored.sort(),
  };
}

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
