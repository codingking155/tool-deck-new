/* ToolDeck BLR service worker — app-shell + runtime caching.
   Bump CACHE when you deploy new assets. */
const CACHE = "tooldeck-v8";
const MAX_ENTRIES = 80;
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* never cache third-party APIs (IP, speed, proxies) */
  if (url.pathname.startsWith("/sheaf/")) return; /* Sheaf's files are unhashed: always fetch them fresh */
  if (url.pathname.startsWith("/_vercel/")) return; /* Vercel's own scripts (Speed Insights): never cache or proxy them */

  /* SPA navigations: network-first, fall back to cached shell so deep links work offline */
  if (req.mode === "navigate") {
    e.respondWith(fetch(req, { cache: "no-store" }).catch(() => caches.match("/index.html")));
    return;
  }
  /* static assets: cache-first, then populate */
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        /* a cached 404/500 would stay broken until the next version bump */
        /* never cache an HTML fallback served for a missing script/style */
        const html = (res.headers.get("content-type") || "").includes("text/html");
        if (res.ok && res.type === "basic" && !html) {
          const copy = res.clone();
          caches.open(CACHE).then(async (c) => {
            await c.put(req, copy);
            /* hashed chunks pile up across deploys; drop the oldest beyond the cap */
            const keys = await c.keys();
            await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).filter((k) => !SHELL.includes(new URL(k.url).pathname)).map((k) => c.delete(k)));
          }).catch(() => {});
        }
        return res;
      }).catch(() => hit)
    )
  );
});
