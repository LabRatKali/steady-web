/* Steady ad lab — cache ad network responses so remounts don't burn new CDN URLs. */
const CACHE = "steady-ad-assets-v1";
const AD_HOST =
  /highperformanceformat|storageimagedisplay|effectivecpmnetwork|ahacdn\.me|adsterra/i;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (!AD_HOST.test(url.hostname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        // Cache successful + opaque (cross-origin) responses.
        if (res && (res.ok || res.type === "opaque" || res.status === 0)) {
          try {
            cache.put(req, res.clone());
          } catch (_) {}
        }
        return res;
      } catch (_) {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw new Error("ad fetch failed");
      }
    })()
  );
});
