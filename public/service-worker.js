/*
 * This worker intentionally caches only public, versioned app-shell files.
 * It never caches navigations, Server Action requests, auth routes, API
 * responses, or anything marked private/no-store, so user data cannot remain
 * in Cache Storage after a shared-device session ends.
 */
const CACHE_PREFIX = "yanko-pwa-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const OFFLINE_DOCUMENT = "/offline.html";
const STATIC_PATHS = new Set([
  OFFLINE_DOCUMENT,
  "/manifest.webmanifest",
  "/pwa/icon-192.svg",
  "/pwa/icon-512.svg",
]);

function isPublicStaticAsset(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;

  return STATIC_PATHS.has(url.pathname) || url.pathname.startsWith("/_next/static/");
}

function canStoreResponse(response) {
  if (!response.ok || response.type !== "basic") return false;

  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  return (
    !response.headers.has("set-cookie") &&
    !cacheControl.includes("private") &&
    !cacheControl.includes("no-store")
  );
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (canStoreResponse(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([...STATIC_PATHS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Dynamic HTML and RSC payloads are never cached. Offline reloads receive a
  // generic, static document with no account or conversation information.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_DOCUMENT)));
    return;
  }

  if (!isPublicStaticAsset(request, url)) return;

  event.respondWith(networkFirst(request));
});
