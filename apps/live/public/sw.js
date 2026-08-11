/*
 * App-shell service worker.
 *
 * Scope is deliberately narrow: it makes the door *load* with no network. What
 * makes the door *work* with no network is the IndexedDB queue and the cached
 * door list, and neither of those goes anywhere near this file. Keeping them
 * separate means a caching mistake can cost you a stale stylesheet, never a
 * scan.
 *
 * Rules:
 *   - Never touch anything under /api. A cached check-in response, or a cached
 *     door list served as fresh, would be actively dangerous.
 *   - Navigations: network first, cache as a fallback, so an online reload
 *     always gets the current build.
 *   - Static build output (/_next/static/*): cache first, it is content-hashed.
 */

const CACHE = "ovation-live-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/"))),
    );
  }
});
