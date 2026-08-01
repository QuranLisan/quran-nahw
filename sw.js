/* نحوِ قرآن — service worker
   Bump CACHE when you change any shell file, otherwise the old copy
   keeps serving. */
const CACHE = 'quran-nahw-v8';

const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/import.js',
  'js/draw.js',
  'manifest.webmanifest',
  'fonts/quran-indopak.woff2',
  'fonts/quran-indopak.ttf',
  'data/quran-data.json',
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll fails the whole install if one file 404s; add individually.
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navigations: network first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch (_) { return (await caches.match('index.html')) || Response.error(); }
    })());
    return;
  }

  // Everything else: cache first, then fill the cache in the background.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (_) {
      return new Response('', { status: 504 });
    }
  })());
});
