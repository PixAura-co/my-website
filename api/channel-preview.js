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
// This Edge Function sits in front of that: when a channel link is shared,
// it points here instead of straight at the app. It looks at the request:
//   - If it's a crawler/bot fetching the link to build a preview card, it
//     returns a tiny HTML page with OG tags built from the real channel row
//     in Supabase (name, bio, avatar).
//   - If it's a real visitor (a browser), it 302-redirects straight to the
//     actual app URL (?channel=<ref>&post=<id>) so the existing deep-link
//     handling in index.html (_openChannelByRefFromLink) takes over exactly
//     as before. Nothing about the in-app flow changes.
//
// SETUP (done once by Dave, not per-link):
//   1. Drop this file at /api/channel-preview.js in the Vercel project.
//   2. In _channelPostShareUrl() (index.html), change the generated link
//      from `${origin}${pathname}?channel=...` to
//      `${origin}/api/channel-preview?channel=...` — see the one-line patch
//      note at the bottom of this file.
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
// match this list, so they fall through to the redirect branch below.
const CRAWLER_UA = /facebookexternalhit|Twitterbot|TelegramBot|WhatsApp|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|Googlebot|bingbot|Pinterest|redditbot|vkShare|Applebot/i;

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
  // Try real id first (cheap, indexed), then invite_code (the format actual
  // share links use — see _channelPostShareUrl's invite_code preference).
  let res = await fetch(`${SB_URL}/rest/v1/channels?id=eq.${encodeURIComponent(ref)}&select=id,name,bio,avatar,subscriber_count,status`, { headers });
  let rows = res.ok ? await res.json() : [];
  if (!rows.length) {
    res = await fetch(`${SB_URL}/rest/v1/channels?invite_code=eq.${encodeURIComponent(ref)}&select=id,name,bio,avatar,subscriber_count,status`, { headers });
    rows = res.ok ? await res.json() : [];
  }
  return rows[0] || null;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const channelRef = url.searchParams.get('channel');
  const postId = url.searchParams.get('post');
  const ua = req.headers.get('user-agent') || '';
  const isCrawler = CRAWLER_UA.test(ua);

  // Real destination inside the actual app — same query-param format
  // _captureDeepLinkFromUrl() already parses, so app behavior is unchanged.
  const appUrl = SITE_ORIGIN + '/?channel=' + encodeURIComponent(channelRef || '') + (postId ? '&post=' + encodeURIComponent(postId) : '');

  if (!channelRef) {
    return Response.redirect(appUrl, 302);
  }

  // Real visitors: skip the lookup entirely and send them straight into the
  // app. No point spending a Supabase round trip on someone who's not a
  // crawler — the app itself re-resolves the channel on load anyway.
  if (!isCrawler) {
    return Response.redirect(appUrl, 302);
  }

  let channel = null;
  try {
    channel = await fetchChannel(channelRef);
  } catch (e) {
    channel = null; // fall through to generic fallback tags below
  }

  const bannedOrMissing = !channel || channel.status === 'banned';
  const title = bannedOrMissing ? FALLBACK_TITLE : `${channel.name} · Social Plus Channel`;
  const desc = bannedOrMissing
    ? FALLBACK_DESC
    : (channel.bio && channel.bio.trim()
        ? channel.bio.trim().slice(0, 200)
        : `Join ${channel.name} on Social Plus${channel.subscriber_count ? ` — ${channel.subscriber_count} subscribers` : ''}. Predict, post & earn.`);
  const image = bannedOrMissing ? DEFAULT_OG_IMAGE : resolveOgImage(channel.avatar);

  const html = `<!DOCTYPE html>
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

// NOTE: _channelPostShareUrl() in index.html has already been updated to
// point here (base = origin + '/api/channel-preview') — no manual patch
// needed, this file just needs to be dropped into /api/ in the Vercel
// project alongside the app.
