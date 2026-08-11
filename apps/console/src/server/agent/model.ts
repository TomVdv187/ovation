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
const MAX_TOKENS = 4096;

export type AgentContentBlock =
  | { type: "text"; text: string }
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
