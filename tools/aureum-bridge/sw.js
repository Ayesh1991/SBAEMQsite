/* AUREUM Bridge — minimal service worker for PWA install.
   Network-first for everything (this is a live tool talking to Google APIs);
   cached shell is only an offline fallback. Never touches googleapis.com. */
const VERSION = 'bridge-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(['./', './index.html'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || /googleapis\.com|accounts\.google\.com/.test(url.host)) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
  }
});
