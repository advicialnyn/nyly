// Minimal service worker — just enough to satisfy PWA installability
// requirements. No offline caching, since the dashboard needs live data.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass everything straight through to the network.
  event.respondWith(fetch(event.request));
});
