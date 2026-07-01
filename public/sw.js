/* Service worker minimal : cache runtime "network-first, fallback cache".
   Après une première visite en ligne, l'app fonctionne hors-ligne. */
const CACHE = "ardoise-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || !request.url.startsWith("http")) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(request).then((r) => r || (request.mode === "navigate" ? caches.match(self.registration.scope) : undefined))
      )
  );
});
