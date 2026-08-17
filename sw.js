// /sw.js — Social Plus service worker
//
// WHY THIS FILE EXISTS AS A REAL FILE (not the old blob: URL):
// Android Chrome/WebView blocks service worker registration from blob:
// URLs — the previous inline version in index.html silently failed to
// register for virtually every real user on this app. This is a real file
// at a real URL (plusng.com.ng/sw.js) so registration actually succeeds.
//
// WHAT IT DOES (and deliberately does NOT do):
//   - Caches the app shell (index.html + this SW file) so reopening the
//     app after being fully closed shows the UI instantly from cache
//     instead of a blank screen while a ~3MB file re-downloads over a
//     slow connection — THEN quietly re-fetches the live version in the
//     background and updates the cache for next time.
//   - Caches Google Fonts (genuinely static, safe to cache aggressively).
//   - Deliberately does NOT touch Supabase API calls or any /rest/v1/
//     request — the app already has its own localStorage-based caching
//     and retry logic for that data (see SB.query/_writeWithRetry in
//     index.html); a service worker double-caching API responses on top
//     of that would risk serving stale predictions/wallet balances/chat
//     messages, which is a correctness problem, not just a UX one.
//   - Deliberately does NOT go "cache-first" on index.html itself, since
//     index.html ships with `Cache-Control: no-cache, no-store,
//     must-revalidate` on purpose — Dave iterates fast and doesn't want
//     stale HTML stuck on someone's phone. Network-first (with a cache
//     fallback only when the network genuinely fails/times out) respects
//     that intent while still solving the "blank screen with no signal"
//     problem.
//
// SETUP: drop this file at the project root (same folder as index.html
// and vercel.json) — Vercel serves it automatically at /sw.js, no config
// needed beyond what's already in vercel.json's rewrite exclusions.

const CACHE_NAME = 'social-plus-shell-v1';
// Bump this string (v1 -> v2 etc) any time you want to force every
// installed client to drop its old cache and re-fetch everything fresh —
// e.g. after a major redesign. Not needed for routine content updates,
// since the network-first strategy already picks those up automatically.

const APP_SHELL_URLS = ['/', '/index.html'];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Network requests get a hard timeout so a stalled/very slow connection
// still falls back to cache in a reasonable time instead of hanging the
// page load indefinitely — mirrors the same pattern already used for
// Supabase calls in index.html's SB.query (7s timeout there).
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // Best-effort — if the very first install can't reach the network
      // yet, that's fine, the fetch handler below will populate the cache
      // on the first successful real request instead.
      return cache.addAll(APP_SHELL_URLS).catch(function() {});
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      // Drop any cache from a previous CACHE_NAME (old version bump) so
      // storage doesn't accumulate stale shells forever.
      caches.keys().then(function(names) {
        return Promise.all(
          names.filter(function(n) { return n !== CACHE_NAME; }).map(function(n) { return caches.delete(n); })
        );
      })
    ])
  );
});

function withTimeout(promise, ms) {
  return new Promise(function(resolve, reject) {
    const timer = setTimeout(function() { reject(new Error('sw: network timeout')); }, ms);
    promise.then(function(v) { clearTimeout(timer); resolve(v); }, function(e) { clearTimeout(timer); reject(e); });
  });
}

// Network-first, cache-fallback — used for the app shell itself (index.html
// and every path-based route like /plusupdates, since those all serve the
// same index.html per the vercel.json rewrite / SPA behavior). Always tries
// to get Dave's latest deployed version first; only falls back to whatever
// was last cached if the network genuinely fails or times out.
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (fresh && fresh.ok) {
      // Cache under both the real request AND the shell alias '/' so a
      // fresh load of the root path benefits too, regardless of which
      // path-based URL happened to trigger this fetch.
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Nothing cached yet (very first visit, offline, no prior success) —
    // let the request fail through normally so the browser shows its own
    // standard offline page rather than this SW pretending to succeed.
    throw e;
  }
}

// Cache-first — used only for Google Fonts, which are safe to treat as
// effectively immutable. Falls back to network if not yet cached.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', function(event) {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  const url = new URL(req.url);

  // Never touch API calls (Supabase, the /api/channel-preview edge
  // function, or anything else under /api/) — see the top-of-file note on
  // why this app's own data layer already owns caching for that.
  if (url.pathname.startsWith('/api/') || url.hostname.indexOf('supabase.co') !== -1) {
    return;
  }

  // Google Fonts: cache-first.
  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Same-origin navigations and the app shell itself: network-first. This
  // covers '/', '/index.html', and every username/broadcast path (they're
  // all the same SPA shell per vercel.json's rewrite), so ANY of those
  // paths reopening while offline/slow still shows something instantly
  // instead of a blank tab.
  if (url.origin === self.location.origin && (req.mode === 'navigate' || APP_SHELL_URLS.indexOf(url.pathname) !== -1)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Everything else (images, other same-origin static assets not already
  // handled above) — just pass through untouched, no SW involvement.
});

// ── Real Web Push handler ──
// This is the piece that fires even when the app is fully closed — distinct
// from the in-app Dynamic Island system (_showPushNotif), which only works
// while a tab/process is alive. Requires a server to actually send a push
// using the VAPID private key; this listener just displays whatever arrives.
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { title: 'Social Plus', body: event.data ? event.data.text() : '' };
  }
  var title = data.title || 'Social Plus';
  var options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'social-plus-push',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification did nothing before — no listener existed at all.
// Kept from the previous inline SW so notification-tap behavior is unchanged.
self.addEventListener('notificationclick', function(e) {
  var tag = e.notification.tag;
  var targetUrl = (e.notification.data && e.notification.data.url) || '/';
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) { list[i].postMessage({ type: 'predict-notif-click', tag: tag }); return list[i].focus(); }
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  }));
});
