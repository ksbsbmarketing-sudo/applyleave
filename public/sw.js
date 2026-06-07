const CACHE = 'ksb-leave-v2-2';

// On install: cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll([
      '/',
      '/index.html',
      '/manifest.json',
      '/icon-192.png',
      '/icon-512.png',
      '/apple-touch-icon.png',
      '/icon-maskable-512.png'
    ]))
  );
  // TIDAK skipWaiting di sini — SW baru menunggu sehingga staf tekan "Muat Semula"
  // (app hantar mesej 'SKIP_WAITING' bila butang ditekan)
});

// Terima arahan dari app untuk aktifkan SW baru serta-merta
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// On activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET, Firebase APIs, Fonnte, Google Fonts — always network
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('googleapis.com')) return;
  if (url.hostname.includes('firebaseio.com')) return;
  if (url.hostname.includes('firebase.com')) return;
  if (url.hostname.includes('fonnte.com')) return;
  if (url.hostname.includes('gstatic.com')) return;
  if (url.hostname.includes('firebaseapp.com') && !url.hostname.startsWith('apply-leave')) return;

  // Hashed Vite assets (JS/CSS): cache-first (they never change for same hash)
  if (url.pathname.match(/\/assets\/.+\.(js|css|woff2?)(\?.*)?$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(event.request, res.clone()));
          return res;
        });
      })
    );
    return;
  }

  // Everything else (HTML, SVG, images): network-first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/')))
  );
});
