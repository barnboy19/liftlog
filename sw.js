// Offline-first service worker. Bump VERSION whenever you deploy changed files.
const VERSION = 'v5';
const CACHE = `liftlog-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/data.js',
  './js/db.js',
  './js/muscles.js',
  './js/body3d.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Three.js (3D body map) lives in its own cache, keyed by its version, so app updates
// don't re-download it. Fetching it is best-effort: if it fails, the rest of the app
// still installs and works offline; the Body tab retries when it's opened online.
const LIB_CACHE = 'liftlog-lib-three-0.160.0';
const LIB_HOST = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const LIBS = [
  `${LIB_HOST}build/three.module.min.js`,
  `${LIB_HOST}examples/jsm/controls/OrbitControls.js`,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await (await caches.open(CACHE)).addAll(ASSETS);
    try { await (await caches.open(LIB_CACHE)).addAll(LIBS); } catch { /* offline or CDN down: fine */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('liftlog-') && k !== CACHE && k !== LIB_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // Pinned library files: cache first, store on first fetch.
  if (url.startsWith(LIB_HOST)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(LIB_CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (new URL(url).origin !== location.origin) return;

  // App navigations always get the cached shell (works offline, any hash route).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((hit) => hit || fetch(req)).catch(() => caches.match('./')),
    );
    return;
  }

  // Everything else: cache first, then network (and cache what we fetch).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
