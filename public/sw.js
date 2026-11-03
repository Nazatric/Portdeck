// PortDeck offline cache. Same-origin only; nothing here talks to third-party servers.
const CACHE = 'portdeck-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

const put = (request, response) => {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: network first so updates arrive, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => put('/', response)).catch(() => caches.match('/')));
    return;
  }
  // Hashed build output never changes: cache first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => put(request, response))));
    return;
  }
  // Everything else: serve the cached copy immediately and refresh it in the background.
  event.respondWith(caches.match(request).then((hit) => {
    const network = fetch(request).then((response) => put(request, response)).catch(() => hit);
    return hit || network;
  }));
});
