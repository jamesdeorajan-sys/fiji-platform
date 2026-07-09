// Lagi PWA service worker — app-shell + previously-viewed content caching.
// Deliberately never touches the chat Worker API: POST requests and any
// cross-origin request (Worker, WhatsApp, partner booking sites) pass
// straight through to the network, untouched, every time.

const CACHE_VERSION = 'lagi-shell-v1';
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept anything but same-origin GET — protects the chat
  // Worker POST contract, WhatsApp links, and external booking sites.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first for the page itself, so content updates show up as soon
  // as they're live; falls back to the cached shell only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest) — they're versioned by
  // cache name, not by content hash, so cache-first is safe here.
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
      return res;
    }))
  );
});
