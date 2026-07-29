/* Tiny distribution SW — cache static AgentOS/OCCT assets only. No compute. */
const CACHE = "occ-cad-static-v1";
const PRECACHE = [
  "./kernel.wasm",
  "./loom.tar",
  "./mc-core.mjs",
  "./catalog-compiler.wasm",
  "./libocc_c.js",
  "./libocc_c.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => undefined)),
  );
  // Do not skipWaiting — keep coherent generation (search-experience pattern).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  // Only same-origin agent-os assets
  if (!url.pathname.includes("/agent-os/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    }),
  );
});
