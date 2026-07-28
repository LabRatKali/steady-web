/* Disabled — was caching failed/opaque ad responses and breaking fills in some browsers. */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const regs = await self.registration.unregister();
      await self.clients.claim();
      return regs;
    })()
  );
});
