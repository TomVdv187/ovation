import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { buildSystemPrompt, buildUserMessage, WRITE_TOOL_NAME, WRITE_TOOL_SCHEMA } from "./prompt";
import type { InviteWriter, WriteRequest, WrittenEmail } from "./types";

/** The model that writes the copy. */
export const INVITE_MODEL = "claude-opus-5";

/** Room for thinking plus a short email; a truncated draft fails the checks anyway. */
const MAX_TOKENS = 4000;

/**
 * The model's answer is forced through a tool call rather than parsed out of
 * prose. That gives us a typed object every time and, usefully here, means the
 * email never has to survive a round trip through free text where an injected
 * instruction could still be sitting.
 */
const writeToolOutput = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  grounded_on: z.array(z.string()).default([]),
});

export interface AnthropicWriterOptions {
  apiKey?: string;
  model?: string;
  client?: Anthropic;
  maxRetries?: number;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set, so personalised invitations cannot be written. " +
        "Set it in .env — there is deliberately no template fallback, because a merge-field email is the thing this feature exists to replace.",
    );
    this.name = "MissingApiKeyError";
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]?.trim());
}

export function anthropicWriter(options: AnthropicWriterOptions = {}): InviteWriter {
  const model = options.model ?? INVITE_MODEL;
  const apiKey = options.apiKey ?? process.env["ANTHROPIC_API_KEY"];

  if (!options.client && !apiKey) throw new MissingApiKeyError();

  // The SDK retries 429s and 5xx with exponential backoff; the limiter in
  // limiter.ts is what keeps us from generating them in the first place.
  const client =
    options.client ?? new Anthropic({ apiKey, maxRetries: options.maxRetries ?? 4 });

  return {
    model,
    async write(request: WriteRequest): Promise<WrittenEmail> {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserMessage(request) }],
        tools: [
          {
            name: WRITE_TOOL_NAME,
            description:
              "Return the finished email for this one guest. Call this exactly once.",
            input_schema: WRITE_TOOL_SCHEMA,
          },
        ],
        tool_choice: { type: "tool", name: WRITE_TOOL_NAME },
      });

      if ((response.stop_reason as string) === "refusal") {
        throw new Error(
          `The model declined to write an email for guest ${request.guest.id}. This usually means something in that guest's record needs a human eye.`,
        );
      }

      const call = response.content.find(
        (block): block is Extract<typeof block, { type: "tool_use" }> =>
          block.type === "tool_use" && block.name === WRITE_TOOL_NAME,
      );

      if (!call) {
        throw new Error(
          `The model returned no ${WRITE_TOOL_NAME} call for guest ${request.guest.id} (stop_reason: ${response.stop_reason}).`,
        );
      }

      const parsed = writeToolOutput.safeParse(call.input);
      if (!parsed.success) {
        throw new Error(
          `The model's ${WRITE_TOOL_NAME} arguments did not match the schema for guest ${request.guest.id}: ${parsed.error.issues
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; ")}`,
        );
      }

      return {
        subject: parsed.data.subject.trim(),
        body: parsed.data.body.trim(),
        groundedOn: parsed.data.grounded_on,
      };
    },
  };
}
