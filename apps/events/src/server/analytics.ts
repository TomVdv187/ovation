import { createHash } from "node:crypto";

/**
 * Page-visit counting.
 *
 * Agent 4 · TREASURY bills sponsor logo impressions off Event.pageVisits, so a
 * visit has to mean a visit. Two guards stand between a render and the counter:
 *
 *   1. the browser only fires the beacon once per tab session, and
 *   2. this module refuses the same visitor twice inside a half-hour window.
 *
 * The second guard is per-process, which on serverless means per instance — it
 * cannot be a correctness claim, only a cheap way to stop the obvious
 * double-counts (a refresh, a back-button, a prefetch). The honest guarantee is
 * the pair, and the counter itself is an atomic increment, never a read
 * followed by a write.
 */

const WINDOW_MS = 30 * 60 * 1000;
const MAX_KEYS = 5000;

const seen = new Map<string, number>();

export function visitorKey(
  slug: string,
  headers: Headers | null | undefined,
): string {
  const ip =
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers?.get("x-real-ip") ??
    "unknown";
  const agent = headers?.get("user-agent") ?? "unknown";
  return createHash("sha256").update(`${slug}|${ip}|${agent}`).digest("hex");
}

/** True the first time a visitor is seen in the window; false while it holds. */
export function shouldCountVisit(key: string, now = Date.now()): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;

  if (seen.size >= MAX_KEYS) {
    for (const [candidate, at] of seen) {
      if (now - at >= WINDOW_MS) seen.delete(candidate);
    }
    // Still full of live entries? Drop the oldest rather than grow unbounded.
    if (seen.size >= MAX_KEYS) {
      const oldest = seen.keys().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
  }

  seen.set(key, now);
  return true;
}

/** Test seam — the window is process-lifetime state. */
export function resetVisitWindow(): void {
  seen.clear();
}
