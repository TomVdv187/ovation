import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicTool } from "./tools";

/**
 * The seam between the brain and Anthropic.
 *
 * The loop in ./brain.ts talks to this interface, never to the SDK, so the
 * whole tool-call -> proposal -> approve -> mutation path can be exercised with
 * a scripted model and no network. See scripts/verify-dod.ts.
 */

export const AGENT_MODEL = "claude-opus-5";

/**
 * Thinking, stated rather than inherited.
 *
 * On this model thinking is ON when the parameter is omitted — the opposite of
 * the previous generation, where omitting it meant no thinking. Leaving it out
 * therefore does not mean "no thinking", it means "whatever the default is",
 * and the default changed under us.
 *
 * `display` matters just as much. Left alone it is "omitted", which still
 * returns thinking blocks but with an EMPTY thinking field — and the tool loop
 * echoes every assistant block back on the next round, which is how the whole
 * turn died with
 *
 *     messages.17.content.0.thinking: each thinking block must contain thinking
 *
 * A blank block the API will not accept back is worse than no block at all.
 * "summarized" fills them in, so the round trip is legal and we get the
 * reasoning in the bargain.
 *
 * Disabling thinking would also have silenced it, and is the wrong fix here:
 * with thinking off this model occasionally writes a tool call into its visible
 * text instead of emitting a tool_use block — the turn then succeeds, the call
 * never runs, and nothing raises. An agent whose tools silently don't fire is a
 * worse failure than a slow one.
 */
const THINKING = { type: "adaptive", display: "summarized" } as const;

/**
 * Room for thinking AND the reply: max_tokens caps their sum, so the 4096 that
 * comfortably held a chat answer before thinking was on now truncates one.
 */
const MAX_TOKENS = 16_000;

export type AgentContentBlock =
  | { type: "text"; text: string }
  // Carried, never read. The loop echoes assistant content back verbatim on the
  // next round and the API requires these blocks to return unchanged, so they
  // have to survive the trip through our own types.
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface AgentToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AgentMessage =
  | { role: "user"; content: string | AgentToolResult[] }
  | { role: "assistant"; content: AgentContentBlock[] };

export interface AgentModelRequest {
  system: string;
  messages: AgentMessage[];
  tools: AnthropicTool[];
  onText?: (delta: string) => void;
}

export interface AgentModelResponse {
  content: AgentContentBlock[];
  stopReason: string | null;
}

export interface AgentModel {
  run(request: AgentModelRequest): Promise<AgentModelResponse>;
}

/**
 * Raised when the console can run but the brain cannot — no API key, or the
 * provider refused. Surfaced as a calm notice in the chat, never a crash: the
 * rest of the console keeps working.
 */
export class AgentUnavailableError extends Error {
  readonly code = "AGENT_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

export function isModelConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function assertModelConfigured(): void {
  if (!isModelConfigured()) {
    throw new AgentUnavailableError(
      "The agent brain is not configured: ANTHROPIC_API_KEY is missing. Set it in the repo-root .env and restart the dev server. Everything else in the console — approvals, proposals, the overview — keeps working without it.",
    );
  }
}

/** The real model. Streams text deltas so the chat fills in as it thinks. */
export function anthropicModel(): AgentModel {
  assertModelConfigured();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return {
    async run({ system, messages, tools, onText }) {
      try {
        const stream = client.messages.stream({
          model: AGENT_MODEL,
          max_tokens: MAX_TOKENS,
          thinking: THINKING,
          system,
          messages: messages as unknown as Anthropic.MessageParam[],
          tools: tools as unknown as Anthropic.Tool[],
        });

        if (onText) stream.on("text", (delta: string) => onText(delta));

        const final = await stream.finalMessage();
        return {
          content: final.content as unknown as AgentContentBlock[],
          stopReason: final.stop_reason ?? null,
        };
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          throw new AgentUnavailableError(
            `The model refused the request (${error.status ?? "network"}): ${error.message}`,
          );
        }
        throw error;
      }
    },
  };
}
