/*
 * This worker intentionally caches only public, versioned app-shell files.
 * It never caches navigations, Server Action requests, auth routes, API
 * responses, or anything marked private/no-store, so user data cannot remain
 * in Cache Storage after a shared-device session ends.
 */
const CACHE_PREFIX = "yanko-pwa-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const OFFLINE_DOCUMENT = "/offline.html";
const STATIC_PATHS = new Set([
  OFFLINE_DOCUMENT,
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
]);

function isPublicStaticAsset(request, url) {
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("authorization") ||
    request.headers.has("next-action") ||
    request.headers.has("rsc")
  )
    return false;

  return (
    (!url.search && STATIC_PATHS.has(url.pathname)) ||
    url.pathname.startsWith("/_next/static/")
  );
}

function canStoreResponse(response) {
  if (!response.ok || response.type !== "basic" || response.redirected) return false;

  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  return (
    !response.headers.has("set-cookie") &&
    !cacheControl.includes("private") &&
    !cacheControl.includes("no-store") &&
    !cacheControl.includes("no-cache")
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
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
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
  if (url.origin !== self.location.origin) return;

  // Dynamic HTML and RSC payloads are never cached. Offline reloads receive a
  // generic, static document with no account or conversation information.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match(OFFLINE_DOCUMENT);
        return new Response(
          offline
            ? await offline.text()
            : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>暂时离线 · 言行</title><h1>暂时无法连接网络</h1><p>当前无法加载页面或提交修改。未发送的操作不会自动补交。</p></html>',
          {
            status: 503,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          },
        );
      }),
    );
    return;
  }

  if (!isPublicStaticAsset(request, url)) return;

  event.respondWith(networkFirst(request));
});
