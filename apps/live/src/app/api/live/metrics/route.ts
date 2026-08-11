import { createContext } from "~/server/context";
import { stats } from "~/server/realtime";
import * as metrics from "~/server/live/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Measured check-in latency and realtime health.
 *
 * The brief's target is P95 < 2.5s per scan, and the only honest way to report
 * that is to publish the histogram the server actually recorded. `dropped`
 * is the count of realtime events that could not be queued to a subscriber —
 * the simulation asserts it is zero.
 */
export async function GET(req: Request) {
  const ctx = await createContext(req.headers);
  if (!ctx.session?.user.organisationId) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw ? Number(sinceRaw) : undefined;
  const eventId = url.searchParams.get("eventId") ?? undefined;

  return Response.json(
    {
      checkin: metrics.summary(Number.isFinite(since) ? since : undefined),
      realtime: stats(eventId),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Clears the histogram so a simulation run measures only itself. */
export async function DELETE(req: Request) {
  const ctx = await createContext(req.headers);
  if (!ctx.session?.user.organisationId) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  metrics.reset();
  return Response.json({ ok: true });
}
