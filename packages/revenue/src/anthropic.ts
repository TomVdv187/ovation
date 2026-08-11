/**
 * Anthropic client for revenue copywriting.
 *
 * Two rules this wrapper enforces for everything in packages/revenue:
 *
 *  1. It is optional. With no ANTHROPIC_API_KEY — CI, a fresh clone, an
 *     offline dev box — every caller gets `null` and falls back to
 *     deterministic copy. A missing key must never fail a query.
 *  2. It is short-lived. This runs inside a tRPC request, so a hung API call
 *     would hang the console. 30s, one retry, then give up.
 */
import Anthropic from "@anthropic-ai/sdk";

/** The model the Treasury drafts sponsor copy with. */
export const REVENUE_MODEL = "claude-opus-5";

const REQUEST_TIMEOUT_MS = 30_000;

let cached: Anthropic | null | undefined;

function client(): Anthropic | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  cached = apiKey
    ? new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 })
    : null;
  return cached;
}

export function copywritingAvailable(): boolean {
  return client() !== null;
}

export interface CompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/**
 * One-shot text completion. Returns null when the key is absent, the model
 * declines, or the call fails — never throws, so a caller can always fall
 * through to its deterministic template.
 *
 * Note: no `temperature`. It is rejected on this model, and grounded
 * commercial copy wants the model's default behaviour anyway.
 */
export async function completeText(
  request: CompletionRequest,
): Promise<string | null> {
  const anthropic = client();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: REVENUE_MODEL,
      max_tokens: request.maxTokens ?? 1200,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
    });

    // The installed SDK version predates the `refusal` stop reason, but the
    // API returns it — a declined request is a 200 with empty content, so
    // check it before reading blocks. Widened to string until the SDK catches up.
    if ((response.stop_reason as string | null) === "refusal") return null;

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    return text.length > 0 ? text : null;
  } catch (error) {
    // Copy is a nice-to-have; the candidate list is not. Log and degrade.
    console.warn(
      `[revenue] sponsor copy generation failed, using template: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
