/* Social Plus service worker. Must be served from the site root as /sw.js. */
const VERSION = 'v2026-10-09';
const SHELL_CACHE = 'sp-shell-' + VERSION;
const ASSET_CACHE = 'sp-assets-' + VERSION;
const SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
const NAV_TIMEOUT_MS = 4000;

/* ---------- install / update ---------- */
self.addEventListener('install', (event) => {
  // Do not skipWaiting here. The page asks for it, so the user chooses when to update.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).catch(() => {})
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, ASSET_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('sp-') && !keep.includes(n)).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

/* ---------- fetch: app shell offline, never touch API or cross-origin traffic ---------- */
const BYPASS = /^\/(rest|auth|functions|storage|api)\//;
const STATIC = /\.(png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|css|js)$|^\/manifest\.json$/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // Supabase, Google Fonts, etc. go straight to network
  if (BYPASS.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(event));
    return;
  }
  if (STATIC.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirstPage(event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const preload = await event.preloadResponse;
    if (preload) { cache.put('/index.html', preload.clone()).catch(() => {}); return preload; }
    const net = await withTimeout(fetch(event.request), NAV_TIMEOUT_MS);
    if (net && net.ok) cache.put('/index.html', net.clone()).catch(() => {});
    return net;
  } catch (e) {
    return (await cache.match('/index.html')) || (await cache.match('/')) ||
      new Response('<!doctype html><meta charset="utf-8"><title>Social Plus</title><body style="font-family:sans-serif;background:#111;color:#fff;padding:24px">You are offline. Reconnect to continue.</body>', { headers: { 'Content-Type': 'text/html' } });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
  return cached || (await fresh) || Response.error();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/* ---------- push: notifications while the app is closed ---------- */
function actionsFor(type) {
  if (type === 'call') return [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }];
  if (type === 'message') return [{ action: 'open', title: 'Open chat' }];
  return [];
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const type = String(data.type || 'alert').slice(0, 32);
  const title = String(data.title || 'Social Plus').slice(0, 80);

  event.waitUntil((async () => {
    // If the app is open and visible, let the page show it in-app instead of a system banner.
    // Calls always show a system notification so they are never missed.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.some((w) => w.visibilityState === 'visible');
    if (visible && type !== 'call') {
      wins.forEach((w) => w.postMessage({ type: 'push-received', payload: { type, title, body: String(data.body || '').slice(0, 180), id: data.id || null, tag: data.tag || null, url: data.url || '/' } }));
      return;
    }
    await self.registration.showNotification(title, {
      body: String(data.body || '').slice(0, 180),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: String(data.tag || (type + '-' + Date.now())),
      renotify: !!data.tag,
      requireInteraction: type === 'call',
      vibrate: type === 'call' ? [400, 200, 400, 200, 400] : [120, 60, 120],
      actions: actionsFor(type),
      data: { type, id: data.id || null, url: data.url || '/' },
      timestamp: Date.now(),
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const d = n.data || {};
  n.close();
  if (event.action === 'decline') return;          // nothing to do server side yet
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins.find((x) => x.visibilityState === 'visible') || wins[0];
      await w.focus();
      w.postMessage({ type: 'notif-click', action: event.action || null, payload: d });
      return;
    }
    if (self.clients.openWindow) return self.clients.openWindow(new URL(d.url || '/', self.location.origin).href);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The browser rotated the subscription. Ask an open page to save the new one.
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'push-resubscribe' }));
  })());
});
