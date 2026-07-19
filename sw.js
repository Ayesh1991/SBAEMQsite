/* ============================================================
   sw.js — service worker for the optional PWA install.

   Caching rules are deliberately conservative so a new release can
   NEVER be masked by a stale cache (the exact failure mode this site
   suffered before):

     • Navigations / index.html  → NETWORK FIRST, cache only as an
       offline fallback.
     • Versioned assets (?v=N)   → cache-first: a release bumps ?v=,
       which is a brand-new URL, so old entries simply stop matching.
     • data/*.json               → stale-while-revalidate (fast open,
       refreshed in the background).
     • /api/*                    → NEVER touched (always live).

   Bump VERSION together with the ?v= in index.html on each release —
   activation then drops every older cache.
   ============================================================ */

const VERSION = 'aureum-v18';
const CORE = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept the API — auth, AI, Drive must always be live.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first, cached shell only when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => { caches.open(VERSION).then(c => c.put('/index.html', res.clone())); return res; })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const versioned = sameOrigin && url.searchParams.has('v');
  const isData = sameOrigin && url.pathname.startsWith('/data/');
  const isStaticLib = /fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(url.host);

  if (versioned || isStaticLib || (sameOrigin && url.pathname.startsWith('/assets/'))) {
    // cache-first: safe because releases change the URL (?v=) and libraries are pinned
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') caches.open(VERSION).then(c => c.put(req, res.clone()));
        return res;
      }))
    );
    return;
  }

  if (isData) {
    // stale-while-revalidate: instant open, silently refreshed
    e.respondWith(
      caches.match(req).then(hit => {
        const refresh = fetch(req).then(res => {
          if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
