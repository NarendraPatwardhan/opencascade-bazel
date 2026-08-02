/* Tiny distribution SW — cache heavy AgentOS/OCCT binaries only.
 * Never cache app JS/CSS/HTML (would pin stale main.js across deploys).
 */
const CACHE = "occ-cad-static-v3";
const PRECACHE = [
  "./kernel.wasm",
  "./loom.tar",
  "./mc-core.mjs",
  "./catalog-compiler.wasm",
  "./git-engine.tar",
  "./libocc_c.js",
  "./libocc_c.wasm",
];

/** Paths that may be long-cached (binaries). Everything else is network-first. */
function isBinaryAsset(pathname) {
  return (
    pathname.endsWith(".wasm") ||
    pathname.endsWith(".tar") ||
    /\/(kernel\.wasm|loom\.tar|mc-core\.mjs|mc-core\.browser\.mjs|catalog-compiler\.wasm|libocc_c\.js|libocc_c\.wasm|git-engine\.tar)$/.test(
      pathname,
    )
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("occ-cad-static-") && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  // Only same-origin agent-os assets
  if (!url.pathname.includes("/agent-os/")) return;

  // App code: always network (no stale main.js after deploy).
  if (!isBinaryAsset(url.pathname)) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE);
        return cache.match(event.request);
      }),
    );
    return;
  }

  // Binaries: cache-first
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
