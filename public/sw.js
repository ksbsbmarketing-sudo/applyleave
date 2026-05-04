const CACHE_NAME = 'ksb-cuti-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/logo.jpg',
    '/logo-ksb.jpg',
    '/logo-kr.jpg',
    '/logo-bentong.jpg',
    '/header-banner.jpg',
    '/manifest.json'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  self.registration.unregister();
  e.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          return caches.delete(cacheName);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Pass through all requests
});
