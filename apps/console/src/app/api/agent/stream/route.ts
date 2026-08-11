import "server-only";
import { agentCommandInput } from "@ovation/core";
import { db } from "@ovation/core/db";
import { auth } from "~/server/auth";
import { runAgentTurn } from "~/server/agent/brain";
import { AgentUnavailableError } from "~/server/agent/model";

/**
 * Streaming transport for the chat.
 *
 * agent.command over tRPC is the contract and returns the whole turn at once.
 * This route runs the SAME runAgentTurn with an onText callback so the reply
 * fills in as the model writes it. It streams text only: proposals come back
 * through agent.history, which is typed and is also what a page reload reads,
 * so there is exactly one authority on what a card says.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const organisationId = session.user.organisationId;
  if (!organisationId) {
    return Response.json(
      { error: "Your account is not attached to an organisation." },
      { status: 403 },
    );
  }

  const parsed = agentCommandInput.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "That message could not be read." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const result = await runAgentTurn({
          db,
          eventId: parsed.data.eventId,
          organisationId,
          userId: session.user.id,
          message: parsed.data.message,
          threadFrom: parsed.data.threadFrom,
          onText: (delta) => send({ type: "text", delta }),
        });

        send({
          type: "done",
          chatMessageId: result.chatMessageId,
          reply: result.reply,
          suggestions: result.suggestions,
          proposalCount: result.proposals.length,
        });
      } catch (error) {
        // Never a crash in the chat: an unconfigured or refusing brain is a
        // state the UI renders, calmly, with the rest of the console intact.
        send({
          type: "error",
          code:
            error instanceof AgentUnavailableError ? "AGENT_UNAVAILABLE" : "ERROR",
          message:
            error instanceof AgentUnavailableError
              ? error.message
              : "The agent could not finish that turn. Nothing was changed.",
        });
        if (!(error instanceof AgentUnavailableError)) console.error(error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
