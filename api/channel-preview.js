// /api/channel-preview.js
//
// WHY THIS EXISTS:
// plusng.com.ng is a single static HTML file with static <head> meta tags.
// Link-preview crawlers (Telegram, WhatsApp, Discord, X, etc.) don't run
// JavaScript — they fetch the URL once and read whatever's in <head> at that
// moment. Because every URL on the domain returns the same static file, every
// shared link — no matter which channel — showed the same generic
// "Social Plus — Predict, Post & Earn" preview card instead of the channel's
// actual name/description.
//
// UPDATED FOR USERNAME LINKS: shared channel/group links are no longer
// ?channel=<ref> query strings routed through /api/channel-preview — they're
// now plain path-based short links like plusng.com.ng/plusupdates or
// plusng.com.ng/plusupdates/broadcast/42 (see _channelPostShareUrl() and
// _groupInviteUrl() in index.html). So instead of this function being linked
// to directly, vercel.json now rewrites EVERY request through here first
// (see the vercel.json alongside this file). This function then:
//   - If it's a crawler/bot fetching the link to build a preview card, looks
//     up the channel by username (falling back to invite_code/id for the
//     small number of pre-username links still in circulation) and returns a
//     tiny HTML page with OG tags built from the real channel row.
//   - If it's a real visitor (a browser) — or the path doesn't match a
//     channel/group/broadcast pattern at all (a normal in-app route like
//     /settings, or the root /) — it passes straight through to index.html,
//     completely untouched. The existing client-side deep-link handling in
//     index.html (_resolveUsernamePathOnLoad, _openChannelByRefFromLink)
//     takes over from there exactly as before. Nothing about the in-app flow
//     changes; this function ONLY affects what crawlers see.
//
// SETUP (done once by Dave, not per-link):
//   1. Drop this file at /api/channel-preview.js in the Vercel project.
//   2. Add/update vercel.json at the project root with the rewrite rule
//      shown at the bottom of this file — this is what makes EVERY path
//      (not just /api/channel-preview) reach this function first.
//   3. No new env vars needed — the anon key below is the SAME anon key
//      already shipped in index.html's client-side SB_KEY constant, so
//      exposing it here adds no new surface area.

export const config = { runtime: 'edge' };

const SB_URL = 'https://ikdcskzxsivrtysbgixi.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrZGNza3p4c2l2cnR5c2JnaXhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NDY1MTMsImV4cCI6MjEwMjEyMjUxM30.K42zd1MgWrtR0GoXrxDqBEhwP1cv_e0qg88b-izynL0';

// Same default site copy that already lives in index.html's static tags —
// used as a fallback if the channel lookup fails for any reason, so a bad
// or expired link degrades to today's behavior instead of showing an error.
const FALLBACK_TITLE = 'Social Plus — Predict, Post & Earn';
const FALLBACK_DESC = 'Share your sports predictions, follow top predictors, chat with the community, and earn Plus Coins you can withdraw.';
const SITE_ORIGIN = 'https://plusng.com.ng';
const DEFAULT_OG_IMAGE = SITE_ORIGIN + '/og-default.png'; // swap to Dave's actual default OG image path if different

// Bot/crawler user-agents that request link previews. Real browsers never
// match this list, so they fall through to the pass-through branch below.
const CRAWLER_UA = /facebookexternalhit|Twitterbot|TelegramBot|WhatsApp|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|Googlebot|bingbot|Pinterest|redditbot|vkShare|Applebot/i;

// First path segments that are real in-app routes / static assets, never a
// channel or group username — must be kept in sync with _RESERVED_USERNAMES
// in index.html (both lists exist to prevent the same collision, from two
// different layers: this one stops a crawler from getting a bogus "channel"
// preview for /settings; the client-side one stops a real visitor's browser
// from trying to resolve /settings as a channel username).
const RESERVED_FIRST_SEGMENTS = new Set(['api','admin','www','app','settings','profile','login','signup','explore','wallet','premium','support','help','about','terms','privacy','broadcast','post','channel','group','user','users','static','assets','index.html','og-default.png','favicon.ico','manifest.json','robots.txt','sitemap.xml']);

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// A channel's avatar is stored either as '__emoji__📢' (render as text/emoji,
// no real image) or a real image URL — see createChannel() in index.html.
function resolveOgImage(avatar) {
  if (!avatar) return DEFAULT_OG_IMAGE;
  if (avatar.startsWith('__emoji__')) return DEFAULT_OG_IMAGE; // no photographic image to show a crawler
  return avatar;
}

async function fetchChannel(ref) {
  const headers = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
  const cols = 'id,name,bio,avatar,subscriber_count,status,username';
  // Username first — the current default for every link generated today.
  let res = await fetch(`${SB_URL}/rest/v1/channels?username=eq.${encodeURIComponent(ref)}&select=${cols}`, { headers });
  let rows = res.ok ? await res.json() : [];
  if (!rows.length) {
    // Legacy fallbacks for links shared before usernames existed.
    res = await fetch(`${SB_URL}/rest/v1/channels?id=eq.${encodeURIComponent(ref)}&select=${cols}`, { headers });
    rows = res.ok ? await res.json() : [];
  }
  if (!rows.length) {
    res = await fetch(`${SB_URL}/rest/v1/channels?invite_code=eq.${encodeURIComponent(ref)}&select=${cols}`, { headers });
    rows = res.ok ? await res.json() : [];
  }
  return rows[0] || null;
}

async function fetchGroup(ref) {
  const headers = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
  const cols = 'id,name,avatar,username,is_private';
  const res = await fetch(`${SB_URL}/rest/v1/group_chats?username=eq.${encodeURIComponent(ref)}&select=${cols}`, { headers });
  const rows = res.ok ? await res.json() : [];
  return rows[0] || null;
}

function buildPreviewHtml(title, desc, image, appUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Social Plus"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
<meta property="og:image" content="${escapeHtml(image)}"/>
<meta property="og:url" content="${escapeHtml(appUrl)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:description" content="${escapeHtml(desc)}"/>
<meta name="twitter:image" content="${escapeHtml(image)}"/>
<meta http-equiv="refresh" content="0; url=${escapeHtml(appUrl)}"/>
</head>
<body>
<p>Redirecting to <a href="${escapeHtml(appUrl)}">${escapeHtml(title)}</a>…</p>
</body>
</html>`;
}

function previewResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Crawlers cache previews aggressively on their end anyway; keep our
      // own cache short so a channel rename/avatar change shows up reasonably
      // fast without needing a manual cache purge.
      'cache-control': 'public, max-age=300, s-maxage=300'
    }
  });
}

// Fetches the actual index.html from this same deployment and returns it
// as-is — used for the pass-through path (real visitors, and any path that
// isn't a channel/group username) so this function acts as pure middleware
// with zero behavior change for anyone except crawlers hitting a real
// channel/group link.
async function passThroughToApp(req) {
  const origin = new URL(req.url).origin;
  const res = await fetch(origin + '/index.html', { headers: { 'user-agent': req.headers.get('user-agent') || '' } });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const ua = req.headers.get('user-agent') || '';
  const isCrawler = CRAWLER_UA.test(ua);

  // ── Legacy query-string form: /api/channel-preview?channel=<ref>&post=<id> ──
  // Kept working forever for links shared before the username system existed.
  const legacyChannelRef = url.searchParams.get('channel');
  if (legacyChannelRef !== null) {
    const postId = url.searchParams.get('post');
    const appUrl = SITE_ORIGIN + '/?channel=' + encodeURIComponent(legacyChannelRef) + (postId ? '&post=' + encodeURIComponent(postId) : '');
    if (!isCrawler) return Response.redirect(appUrl, 302);
    let channel = null;
    try { channel = await fetchChannel(legacyChannelRef); } catch (e) { channel = null; }
    return previewResponse(buildLegacyPreview(channel, appUrl));
  }

  // ── New path-based form: /<username> or /<username>/broadcast/<postId> ──
  const segs = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  // Not a candidate username path at all (root, a real in-app route, a
  // static asset) — get out of the way immediately, no Supabase calls.
  if (segs.length === 0 || RESERVED_FIRST_SEGMENTS.has(segs[0].toLowerCase())) {
    return passThroughToApp(req);
  }

  const username = segs[0].toLowerCase();
  const isBroadcast = segs[1] === 'broadcast' && segs[2];
  const broadcastId = isBroadcast ? segs[2] : null;

  // Real visitors: let the client-side resolver handle it (same page, same
  // path stays in the address bar so the SPA's own path parsing works) — no
  // point spending a Supabase round trip here on someone who isn't a crawler.
  if (!isCrawler) {
    return passThroughToApp(req);
  }

  // Crawler: try channel first (matches the ambiguous-namespace resolution
  // order used client-side in _resolveUsernamePathOnLoad), then group.
  let channel = null, group = null;
  try { channel = await fetchChannel(username); } catch (e) { channel = null; }
  if (!channel) {
    try { group = await fetchGroup(username); } catch (e) { group = null; }
  }

  const appUrl = SITE_ORIGIN + '/' + encodeURIComponent(username) + (broadcastId ? '/broadcast/' + encodeURIComponent(broadcastId) : '');

  if (channel) {
    const bannedOrMissing = channel.status === 'banned';
    const title = bannedOrMissing ? FALLBACK_TITLE : `${channel.name} · Social Plus Channel`;
    const desc = bannedOrMissing
      ? FALLBACK_DESC
      : (channel.bio && channel.bio.trim()
          ? channel.bio.trim().slice(0, 200)
          : `Join ${channel.name} on Social Plus${channel.subscriber_count ? ` — ${channel.subscriber_count} subscribers` : ''}. Predict, post & earn.`);
    const image = bannedOrMissing ? DEFAULT_OG_IMAGE : resolveOgImage(channel.avatar);
    return previewResponse(buildPreviewHtml(title, desc, image, appUrl));
  }

  if (group) {
    // Private groups: still show a preview (someone with the direct invite
    // link is meant to be able to preview it before joining) — is_private
    // only hides it from search/discovery, not from someone holding the link.
    const title = `${group.name} · Social Plus Group`;
    const desc = `Join ${group.name} on Social Plus.`;
    const image = resolveOgImage(group.avatar);
    return previewResponse(buildPreviewHtml(title, desc, image, appUrl));
  }

  // Neither a channel nor a group matched this username — could be a stale
  // link, or genuinely not a channel/group path at all. Fall back to the
  // generic site card rather than guessing further.
  return previewResponse(buildPreviewHtml(FALLBACK_TITLE, FALLBACK_DESC, DEFAULT_OG_IMAGE, SITE_ORIGIN));
}

function buildLegacyPreview(channel, appUrl) {
  const bannedOrMissing = !channel || channel.status === 'banned';
  const title = bannedOrMissing ? FALLBACK_TITLE : `${channel.name} · Social Plus Channel`;
  const desc = bannedOrMissing
    ? FALLBACK_DESC
    : (channel.bio && channel.bio.trim()
        ? channel.bio.trim().slice(0, 200)
        : `Join ${channel.name} on Social Plus${channel.subscriber_count ? ` — ${channel.subscriber_count} subscribers` : ''}. Predict, post & earn.`);
  const image = bannedOrMissing ? DEFAULT_OG_IMAGE : resolveOgImage(channel.avatar);
  return buildPreviewHtml(title, desc, image, appUrl);
}

// NOTE: index.html's _channelPostShareUrl() and _groupInviteUrl() now
// generate plain path links (plusng.com.ng/<username>) with NO /api/ prefix
// — see the vercel.json rewrite rule below, which is what routes those
// paths through this function instead. The old ?channel= query-string form
// is still handled above (see "Legacy query-string form") so links shared
// before this update keep working indefinitely.
