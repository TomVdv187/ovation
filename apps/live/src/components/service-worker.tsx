"use client";

import { useEffect } from "react";

/**
 * Registers the app-shell service worker.
 *
 * The worker only makes the door *load* offline. It is not what makes the door
 * *work* offline — that is the IndexedDB queue and the cached door list. Kept
 * separate on purpose: a caching bug should never be able to swallow a scan.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !window.location.search.includes("sw=1")) {
      // A stale worker in front of the dev server is a debugging tax nobody
      // needs; opt in with ?sw=1 when testing the offline shell.
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[live] service worker registration failed:", err);
    });
  }, []);

  return null;
}
