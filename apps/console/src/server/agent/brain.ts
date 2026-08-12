import "server-only";
import {
  READ_ONLY_TOOLS,
  type AgentAction,
  type AgentCommandResult,
} from "@ovation/core";
import type { Db } from "@ovation/core/db";
import {
  isMutatingTool,
  proposeAction,
  toAgentAction,
  type ProposalMeta,
} from "./actions";
import { buildAgentContext, runReadOnlyTool, systemPrompt } from "./context";
import { executeApprovedActions } from "./execute";
import { AGENT_TOOLS } from "./tools";
import {
  anthropicModel,
  assertModelConfigured,
  type AgentContentBlock,
  type AgentMessage,
  type AgentModel,
  type AgentToolResult,
} from "./model";

/**
 * The tool-use loop.
 *
 * The model reasons, calls tools, reads their results and replies. A mutating
 * tool call writes exactly one thing: an AgentAction at PROPOSED. Nothing in
 * this file changes the event, the guests, the tiers or the sponsors — that can
 * only happen in ./execute.ts, and only for a proposal that cleared the gate.
 */

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 20;

export interface RunAgentTurnArgs {
  db: Db;
  eventId: string;
  organisationId: string;
  userId: string;
  message: string;
  threadFrom?: Date;
  /** Streams assistant text as it arrives. */
  onText?: (delta: string) => void;
  /** Injected in tests. Defaults to the real Anthropic client. */
  model?: AgentModel;
}

export async function runAgentTurn(
  args: RunAgentTurnArgs,
): Promise<AgentCommandResult> {
  const { db, eventId, organisationId, userId, message } = args;

  // Fail before writing anything, so an unconfigured brain leaves no debris.
  const model = args.model ?? (assertModelConfigured(), anthropicModel());

  const ctx = await buildAgentContext(db, eventId);
  if (ctx.organisationId !== organisationId) {
    throw new Error("Event does not belong to this organisation.");
  }

  const history = await loadHistory(db, eventId, args.threadFrom);

  await db.chatMessage.create({
    data: { eventId, role: "USER", content: message, suggestions: [] },
  });

  // Created up front so proposals can point at the turn that produced them.
  const assistantMessage = await db.chatMessage.create({
    data: { eventId, role: "ASSISTANT", content: "", suggestions: [] },
  });

  const conversation: AgentMessage[] = [
    ...history,
    { role: "user", content: message },
  ];
  const proposals: AgentAction[] = [];
  const transcript: AgentContentBlock[] = [];
  let reply = "";

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await model.run({
        system: systemPrompt(ctx),
        messages: conversation,
        tools: AGENT_TOOLS,
        onText: args.onText,
      });

      transcript.push(...response.content);
      reply = response.content
        .filter((b): b is Extract<AgentContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const toolUses = response.content.filter(
        (b): b is Extract<AgentContentBlock, { type: "tool_use" }> =>
          b.type === "tool_use",
      );
      if (toolUses.length === 0) break;

      conversation.push({ role: "assistant", content: response.content });

      const results: AgentToolResult[] = [];
      for (const use of toolUses) {
        results.push(
          await dispatchTool(db, use, {
            eventId,
            organisationId,
            userId,
            chatMessageId: assistantMessage.id,
            onProposal: (a) => proposals.push(a),
          }),
        );
      }
      conversation.push({ role: "user", content: results });
    }

    // The COSMETIC auto-approve gate. `executeApprovedActions` calls
    // `requiresApproval` from packages/core; OUTBOUND and DESTRUCTIVE proposals
    // stay PROPOSED here no matter what the organisation has switched on.
    if (proposals.length > 0) {
      await executeApprovedActions(
        db,
        proposals.map((p) => p.id),
        { kind: "AUTO", autoApproveCosmetic: ctx.autoApproveCosmetic },
      );
    }

    const finalProposals = await db.agentAction
      .findMany({
        where: { id: { in: proposals.map((p) => p.id) } },
        orderBy: { createdAt: "asc" },
      })
      .then((rows) => rows.map(toAgentAction));

    const suggestions = buildSuggestions(finalProposals);
    const content =
      reply ||
      "I have nothing to add to that. Ask me about the guest list, the budget or the programme.";

    await db.chatMessage.update({
      where: { id: assistantMessage.id },
      data: {
        content,
        suggestions,
        toolCalls:
          transcript.length > 0 ? (transcript as unknown as object) : undefined,
      },
    });

    return {
      chatMessageId: assistantMessage.id,
      reply: content,
      proposals: finalProposals,
      suggestions,
    };
  } catch (error) {
    // Leave no half-written assistant turn behind.
    await db.chatMessage
      .delete({ where: { id: assistantMessage.id } })
      .catch(() => undefined);
    throw error;
  }
}

async function dispatchTool(
  db: Db,
  use: { id: string; name: string; input: unknown },
  ctx: {
    eventId: string;
    organisationId: string;
    userId: string;
    chatMessageId: string;
    onProposal: (action: AgentAction) => void;
  },
): Promise<AgentToolResult> {
  const ok = (payload: unknown): AgentToolResult => ({
    type: "tool_result",
    tool_use_id: use.id,
    content: JSON.stringify(payload),
  });
  const fail = (message: string): AgentToolResult => ({
    type: "tool_result",
    tool_use_id: use.id,
    content: message,
    is_error: true,
  });

  try {
    if ((READ_ONLY_TOOLS as readonly string[]).includes(use.name)) {
      const out = await runReadOnlyTool(
        db,
        use.name as (typeof READ_ONLY_TOOLS)[number],
        use.input,
        ctx.eventId,
      );
      return ok(out);
    }

    if (!isMutatingTool(use.name)) {
      return fail(`Unknown tool "${use.name}". Use only the tools provided.`);
    }

    const raw = (use.input ?? {}) as Record<string, unknown>;
    const meta: ProposalMeta = {
      summary: typeof raw.summary === "string" ? raw.summary : undefined,
      subject: typeof raw.subject === "string" ? raw.subject : undefined,
      body: typeof raw.body === "string" ? raw.body : undefined,
    };

    const action = await proposeAction(db, {
      tool: use.name,
      rawInput: raw,
      eventId: ctx.eventId,
      organisationId: ctx.organisationId,
      chatMessageId: ctx.chatMessageId,
      createdById: ctx.userId,
      meta,
    });
    ctx.onProposal(action);

    return ok({
      status: "PROPOSED",
      actionId: action.id,
      risk: action.risk,
      summary: action.summary,
      note: "Nothing has changed. The organiser sees a card and decides. Tell them what you proposed and what approving it would do.",
    });
  } catch (error) {
    // The model gets the rejection as a tool_result and can correct itself, but
    // a malformed tool schema is our bug, not its mistake, so make it loud.
    console.warn(`[agent] tool "${use.name}" rejected:`, error);
    return fail(
      error instanceof Error
        ? `Tool call rejected: ${error.message}`
        : "Tool call rejected.",
    );
  }
}

async function loadHistory(
  db: Db,
  eventId: string,
  threadFrom?: Date,
): Promise<AgentMessage[]> {
  const rows = await db.chatMessage.findMany({
    where: {
      eventId,
      role: { in: ["USER", "ASSISTANT"] },
      ...(threadFrom ? { createdAt: { gte: threadFrom } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  });

  const messages: AgentMessage[] = [];
  for (const row of rows.reverse()) {
    const text = row.content.trim();
    if (!text) continue;
    messages.push(
      row.role === "USER"
        ? { role: "user", content: text }
        : { role: "assistant", content: [{ type: "text", text }] },
    );
  }
  // The API rejects a leading assistant turn.
  while (messages.length > 0 && messages[0]!.role === "assistant") messages.shift();
  return messages;
}

function buildSuggestions(proposals: AgentAction[]): string[] {
  const open = proposals.filter((p) => p.status === "PROPOSED");
  if (open.length > 0) {
    const chips = ["What exactly changes if I approve?"];
    if (open.some((p) => p.risk === "DESTRUCTIVE"))
      chips.push("Who needs telling, and when?");
    if (open.some((p) => p.type === "draft_emails"))
      chips.push("Show me the copy again");
    else chips.push("Draft the follow-up emails");
    return chips.slice(0, 3);
  }
  return [
    "Who is most likely to no-show?",
    "How is the budget looking?",
    "Tighten the running order",
  ];
}

