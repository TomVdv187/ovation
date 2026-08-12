"use client";

import { useEffect } from "react";

/**
 * Counts the visit — the one thing on this page that is not server-rendered.
 *
 * The page body is fetched and rendered on the server; this fires afterwards,
 * once per tab, and tells page.trackVisit. Doing it from the client rather than
 * during render is what keeps the counter honest: a render can happen twice (a
 * refresh, a prefetch, a streamed retry) and Agent 4 bills sponsor impressions
 * off this number. The server applies a second, per-visitor guard on top.
 */
export function VisitBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    const key = `ovation.visit.${slug}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Private mode with storage blocked. Counting once per load is still
      // better than not counting, and the server guard catches the repeats.
    }

    void fetch("/api/trpc/page.trackVisit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // superjson envelope — the router is created with that transformer.
      body: JSON.stringify({
        json: { slug, referrer: document.referrer || null },
      }),
      keepalive: true,
    }).catch(() => {
      // Analytics must never surface to a guest.
    });
  }, [slug]);

  return null;
}
