import { db } from "@ovation/core/db";
import { createContext } from "~/server/context";
import { getCues, onTick, resetFired, setCues } from "~/server/live/cues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cue configuration and the manual tick.
 *
 * Configuration lives in memory (there is no Cue table — see
 * CONTRACT_CHANGES CC-003), so this reads and writes the running set for one
 * event. POST accepts an array matching `cueSchema`.
 *
 * `?tick=1` on POST runs the time-based evaluation once, which is how a
 * serverless deployment or a cron would drive cues without a long-lived
 * process, and how the tests fire VIP_LATE without waiting 30 minutes.
 */
async function authorised(req: Request): Promise<boolean> {
  const ctx = await createContext(req.headers);
  return Boolean(ctx.session?.user.organisationId);
}

export async function GET(req: Request) {
  if (!(await authorised(req))) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const eventId = new URL(req.url).searchParams.get("eventId");
  if (!eventId) return Response.json({ error: "eventId is required" }, { status: 400 });
  return Response.json({ cues: getCues(eventId) });
}

export async function POST(req: Request) {
  if (!(await authorised(req))) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");
  if (!eventId) return Response.json({ error: "eventId is required" }, { status: 400 });

  if (url.searchParams.get("reset") === "1") resetFired(eventId);

  const body = await req.json().catch(() => null);
  const cues =
    body && Array.isArray((body as { cues?: unknown }).cues)
      ? setCues(eventId, (body as { cues: unknown[] }).cues)
      : getCues(eventId);

  if (url.searchParams.get("tick") === "1") {
    await onTick(db, eventId);
  }

  return Response.json({ cues });
}
