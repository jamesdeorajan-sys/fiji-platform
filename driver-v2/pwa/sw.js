// Minimal app-shell service worker: static assets only, network-first. API calls are NEVER cached or intercepted.
const SHELL = 'driver-v2-gate1-shell';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', 'style.css', 'app.js', 'manifest.webmanifest']).catch(() => {}))); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/__test/')) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(SHELL).then((x) => x.put(e.request, c)).catch(() => {}); return r; }).catch(() => caches.match(e.request)));
});
