export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function notFoundPage(slug) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>App not found — Social Plus</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#fff;font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:24px}
a{color:#F5C518;text-decoration:none;font-weight:700}</style></head>
<body><div><h1 style="font-size:20px">App not found</h1>
<p style="color:#8e8e93;font-size:14px">"${slug}" isn't published, or the link may be wrong.</p>
<a href="/">Open Social Plus →</a></div></body></html>`;
}

function lockedPage(app) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${app.name} — expired</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#fff;font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:24px}
a{color:#F5C518;text-decoration:none;font-weight:700}</style></head>
<body><div><h1 style="font-size:20px">This app's trial has ended</h1>
<p style="color:#8e8e93;font-size:14px">The developer needs to upgrade their plan to keep this app live.</p>
<a href="/">Open Social Plus →</a></div></body></html>`;
}

function renderApp(app, origin) {
  const manifestUrl = `/api/mini-app-manifest?slug=${encodeURIComponent(app.slug || app.id)}`;
  const icon = app.logo || `${origin}/icon-192.png`;
  const safeName = String(app.name || 'App').replace(/</g, '&lt;');
  const safeDesc = String(app.description || 'A mini app on Social Plus').replace(/</g, '&lt;');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>${safeName}</title>
<meta name="description" content="${safeDesc}"/>
<link rel="manifest" href="${manifestUrl}"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<meta name="apple-mobile-web-app-title" content="${safeName}"/>
<link rel="apple-touch-icon" href="${icon}"/>
<meta name="theme-color" content="#0b0b0d"/>
<meta property="og:title" content="${safeName}"/>
<meta property="og:description" content="${safeDesc}"/>
<meta property="og:image" content="${icon}"/>
<style>
  html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}
  #mkFrame{border:0;width:100%;height:100%;background:#fff}
  #mkBoot{position:fixed;inset:0;background:#0b0b0d;display:flex;align-items:center;justify-content:center;z-index:2}
  #mkBoot img{width:64px;height:64px;border-radius:18px;animation:mkPulse 1.1s ease-in-out infinite}
  @keyframes mkPulse{0%,100%{opacity:.5;transform:scale(.96)}50%{opacity:1;transform:scale(1)}}
  /* Real install affordance for this specific app — only shown once the
     browser confirms (via beforeinstallprompt) that installing THIS page
     is actually possible. Hidden by default so it never flashes on
     browsers/situations where it can't work (already installed, iOS
     Safari, no SW support, etc). */
  #mkInstallBar{position:fixed;left:0;right:0;bottom:0;z-index:3;display:none;align-items:center;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(20,20,23,.96);backdrop-filter:blur(10px);border-top:1px solid rgba(255,255,255,.09);font-family:-apple-system,system-ui,sans-serif}
  #mkInstallBar img{width:36px;height:36px;border-radius:10px;flex-shrink:0}
  #mkInstallBar .mkib-text{flex:1;min-width:0;color:#fff}
  #mkInstallBar .mkib-text b{display:block;font-size:13px;line-height:1.3}
  #mkInstallBar .mkib-text span{display:block;font-size:11px;color:#8e8e93;line-height:1.3}
  #mkInstallBtn{flex-shrink:0;background:#F5C518;color:#000;border:0;border-radius:10px;padding:10px 16px;font-weight:800;font-size:12.5px;cursor:pointer}
  #mkInstallBtn:disabled{opacity:.6}
</style>
</head>
<body>
<div id="mkBoot"><img src="${icon}" alt=""/></div>
<iframe id="mkFrame" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin" referrerpolicy="no-referrer" title="${safeName}"></iframe>
<div id="mkInstallBar">
  <img src="${icon}" alt=""/>
  <div class="mkib-text"><b>${safeName}</b><span>Install this app on your device</span></div>
  <button id="mkInstallBtn">Install</button>
</div>
<script>
  document.getElementById('mkFrame').srcdoc = ${JSON.stringify(app.html || '')};
  document.getElementById('mkFrame').addEventListener('load', function(){
    document.getElementById('mkBoot').style.display='none';
  });
  fetch('${origin}/api/mini-app-ping?id=${encodeURIComponent(app.id)}', {method:'POST'}).catch(function(){});

  // ── Real per-app install ────────────────────────────────────────────
  // Requires: this page's own manifest (linked above, served per-slug by
  // /api/mini-app-manifest) + an active service worker scoped to /app/
  // (registered below). Both are prerequisites Chrome checks before it
  // will ever fire beforeinstallprompt — without either, the bar below
  // simply never appears, which is correct: there's nothing fake shown.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/api/mini-app-sw.js', { scope: '/app/' }).catch(function(e){
      console.warn('[mini-app install] sw registration failed', e);
    });
  }
  var mkDeferredPrompt = null;
  var mkInstallBar = document.getElementById('mkInstallBar');
  var mkInstallBtn = document.getElementById('mkInstallBtn');
  var mkInstallRequested = (new URLSearchParams(location.search)).get('install') === '1';
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    mkDeferredPrompt = e;
    clearTimeout(mkInstallFallbackTimer);
    // Don't show the bar if this app is already running installed
    // (standalone display mode) — nothing to install at that point.
    var alreadyInstalled = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (alreadyInstalled) return;
    // Arrived here via the "Install" tap on the app's detail page inside
    // Social Plus (?install=1) — skip showing the bar and go straight to
    // the native prompt, so that one tap is the only tap needed instead
    // of tap Install -> land here -> tap Install again.
    mkInstallBar.style.display = 'flex';
    if (mkInstallRequested) mkInstallBtn.click();
  });
  // beforeinstallprompt may simply never fire — iOS Safari doesn't support
  // it at all, and Chrome won't fire it if the app's already installed or
  // doesn't yet qualify. Someone who tapped Install on the detail page and
  // lands here to silence, with no bar and no explanation, looks broken.
  // Give it a couple seconds to arrive, then explain what's actually true.
  var mkInstallFallbackTimer = mkInstallRequested ? setTimeout(function(){
    if (mkDeferredPrompt) return; // it fired — nothing to do
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var alreadyInstalled = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (alreadyInstalled) return; // nothing to install, correctly silent
    var msg = isIOS
      ? 'On iPhone/iPad: tap the Share button, then "Add to Home Screen".'
      : "This browser can't install apps directly, or this app doesn't support it yet — you can still use it right here.";
    var note = document.createElement('div');
    note.style.cssText = 'position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:4;background:rgba(20,20,23,.96);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:12px 14px;color:#fff;font-size:12.5px;line-height:1.4;font-family:-apple-system,system-ui,sans-serif';
    note.textContent = msg;
    document.body.appendChild(note);
    setTimeout(function(){ note.remove(); }, 6000);
  }, 2500) : null;
  window.addEventListener('appinstalled', function(){
    mkInstallBar.style.display = 'none';
    mkDeferredPrompt = null;
  });
  mkInstallBtn.addEventListener('click', function(){
    if (!mkDeferredPrompt) return;
    mkInstallBtn.disabled = true;
    mkInstallBtn.textContent = 'Installing…';
    mkDeferredPrompt.prompt();
    mkDeferredPrompt.userChoice.then(function(choice){
      mkInstallBtn.disabled = false;
      mkInstallBtn.textContent = 'Install';
      if (choice.outcome === 'accepted') {
        mkInstallBar.style.display = 'none';
      }
      mkDeferredPrompt = null;
    }).catch(function(){
      mkInstallBtn.disabled = false;
      mkInstallBtn.textContent = 'Install';
    });
  });

  // ── Continue-with-Plus SSO broker ──────────────────────────────────────
  // This standalone page (plusng.com.ng/app/<slug>) has no access to the
  // main SPA's session/localStorage of its own — it's a separate
  // server-rendered shell, not index.html. A hidden same-origin iframe
  // pointed at the SPA's own broker route gives it that access: index.html
  // already holds the logged-in Plus session (if any) and the
  // 'plus-sso-request' / 'plus-sso-result' postMessage handler that ships
  // with the mini app's "Continue with Plus" snippet. The mini app iframe
  // (#mkFrame) posts its request up to this shell (window.parent from its
  // point of view); this shell relays it into the hidden SPA broker, then
  // relays the SPA's reply straight back down to #mkFrame — so from the
  // mini app's perspective the handshake looks identical whether it's
  // running embedded inside Social Plus or standalone here.
  var mkFrame = document.getElementById('mkFrame');
  var ssoBroker = document.createElement('iframe');
  ssoBroker.src = '${origin}/market?ssoBroker=1' + (location.search || '');
  ssoBroker.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
  ssoBroker.setAttribute('aria-hidden','true');
  document.body.appendChild(ssoBroker);
  window.addEventListener('message', function(ev){
    if (!ev.data) return;
    if (ev.data.type === 'plus-sso-request' && ev.source === mkFrame.contentWindow) {
      // Mini app asking to sign in -> forward into the SPA broker frame.
      if (ssoBroker.contentWindow) ssoBroker.contentWindow.postMessage(ev.data, '${origin}');
      return;
    }
    if (ev.data.type === 'plus-sso-signup' && ev.source === mkFrame.contentWindow) {
      // Broker reported either no Plus session on this device, or a
      // session that hasn't yet granted this app consent. This top-level
      // page is the only one visible to the user, so it's the one that
      // navigates — to sign-up if there's no session at all, or straight
      // to the consent gate if there is one — via /market?miniapp=<slug>,
      // which brings the visitor right back into this mini app afterward.
      var back = new URLSearchParams(location.search);
      var dest = '${origin}/market?miniapp=' + encodeURIComponent('${app.slug || app.id}');
      dest += (ev.data.reason === 'consent-needed') ? '' : '&signup=1';
      if (back.get('ref')) dest += '&ref=' + encodeURIComponent(back.get('ref'));
      location.href = dest;
      return;
    }
    if (ev.data.type === 'plus-sso-result' && ev.source === ssoBroker.contentWindow) {
      // SPA broker replied -> forward the result down to the mini app.
      if (mkFrame.contentWindow) mkFrame.contentWindow.postMessage(ev.data, '*');
    }
  });
</script>
</body>
</html>`;
}

export default async function handler(req) {
  const url = new URL(req.url);
  // path is /app/<slug>
  const slug = decodeURIComponent(url.pathname.replace(/^\/app\/?/, ''));

  if (!slug || !SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(notFoundPage(slug || ''), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  try {
    const q = `${SUPABASE_URL}/rest/v1/mini_apps?slug=eq.${encodeURIComponent(slug)}&visibility=eq.public&status=eq.published&select=*&limit=1`;
    const res = await fetch(q, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      // Edge functions: keep this fast, don't hang the request forever
      signal: AbortSignal.timeout(5000)
    });
    const rows = await res.json();
    const app = Array.isArray(rows) ? rows[0] : null;

    if (!app) {
      return new Response(notFoundPage(slug), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (app.trial_expires_at && new Date(app.trial_expires_at).getTime() <= Date.now()) {
      // trial-only apps stay locked until the owner upgrades
      const owner = await fetch(`${SUPABASE_URL}/rest/v1/premium_subscriptions?username=eq.${encodeURIComponent(app.owner)}&select=tier&limit=1`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      }).then(r => r.json()).catch(() => []);
      const stillLocked = !owner || !owner[0];
      if (stillLocked) {
        return new Response(lockedPage(app), { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    }

    return new Response(renderApp(app, url.origin), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=30, stale-while-revalidate=120' }
    });
  } catch (e) {
    return new Response(notFoundPage(slug), { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}
