// Minimal service worker for standalone mini-app pages (/app/:slug).
// Its only job is to exist with a fetch handler — Chrome/Android requires
// an active, controlling service worker (in addition to a valid manifest)
// before it will fire beforeinstallprompt for a page. This deliberately
// does no caching of its own (each mini app's html/data can change at any
// time via the owner's update flow), so it never risks serving a stale
// version of someone's app.
self.addEventListener('install', function(e) {
  self.skipWaiting();
});
self.addEventListener('activate', function(e) {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function(e) {
  // Pass-through only — always hit the network, never cache.
  e.respondWith(fetch(e.request));
});
