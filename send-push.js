// api/send-push.js
//
// WHY THIS EXISTS:
// index.html already has a full client-side Web Push flow — VAPID_PUBLIC_KEY,
// subscribeToPushNotifications(), and a push_subscriptions table with each
// device's endpoint + subscription JSON. sw.js already has a working
// `push` event listener that shows the notification the moment one arrives.
// The one missing piece was a server that actually SENDS a push using the
// VAPID private key — without it, notifications only ever fired while the
// app tab itself was open (_showPushNotif), never when the app/phone was
// closed. This file is that missing piece.
//
// WHO CALLS THIS:
// index.html's addNotifForUser() — right after it writes a row to the
// `notifications` table — POSTs here with the target username + the same
// title/body. This function looks up every push_subscriptions row for that
// user (a user can have multiple devices) and sends a real Web Push to each.
//
// SETUP (done once by Dave):
//   1. Drop this file at /api/send-push.js in the Vercel project.
//   2. Generate a VAPID key pair ONCE (if this project doesn't already have
//      the matching private key for VAPID_PUBLIC_KEY in index.html):
//        npx web-push generate-vapid-keys
//      The PUBLIC key it prints must exactly match VAPID_PUBLIC_KEY in
//      index.html (line ~3504) — if you generate a fresh pair, update BOTH
//      places, or every existing push_subscriptions row becomes invalid and
//      users must re-subscribe.
//   3. In Vercel → Project Settings → Environment Variables, add:
//        VAPID_PUBLIC_KEY   = the same value as index.html's VAPID_PUBLIC_KEY
//        VAPID_PRIVATE_KEY  = the matching private key (NEVER put this in
//                              index.html or anywhere client-side)
//        VAPID_SUBJECT      = mailto:you@yourdomain.com (or https://plusng.com.ng)
//        SUPABASE_URL       = https://izkqysamtrokvemfzkzn.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY = the service_role key (Project Settings →
//                              API in Supabase) — NOT the anon key, because
//                              this function needs to read push_subscriptions
//                              for ANY user, not just whoever is logged in.
//   4. package.json (project root) already lists "web-push" as a dependency
//      — Vercel installs it automatically on deploy.

import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function vapidReady() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  if (!vapidReady()) {
    return res.status(500).json({ error: { message: 'Server missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY' } });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: { message: 'Server missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY' } });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@plusng.com.ng',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const { username, title, body, tag, url } = req.body || {};
  if (!username || !body) {
    return res.status(400).json({ error: { message: 'username and body are required' } });
  }
  const targetKey = String(username).toLowerCase();

  try {
    const subsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?username=eq.${encodeURIComponent(targetKey)}&select=id,endpoint,subscription`,
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    if (!subsRes.ok) {
      return res.status(502).json({ error: { message: 'Failed to read push_subscriptions', status: subsRes.status } });
    }
    const rows = await subsRes.json();
    if (!rows.length) {
      // Not an error — this user simply has no subscribed device yet
      // (never granted notification permission, or hasn't opened the app
      // since subscribeToPushNotifications() shipped). The in-app
      // _showPushNotif / notification bell still cover them while online.
      return res.status(200).json({ sent: 0, reason: 'no subscriptions for user' });
    }

    const payload = JSON.stringify({
      title: title || 'Social Plus',
      body,
      tag: tag || ('social-plus-' + Date.now()),
      url: url || '/'
    });

    let sent = 0;
    const staleIds = [];
    await Promise.all(rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent++;
      } catch (err) {
        // 404/410 = subscription is gone (user revoked permission, browser
        // data cleared, etc.) — safe to delete so we stop retrying it forever.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          staleIds.push(row.id);
        }
        // Any other error (network blip, etc.) — leave the subscription in
        // place, just skip it for this send.
      }
    }));

    if (staleIds.length) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${staleIds.join(',')})`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
        });
      } catch (e) { /* best-effort cleanup, not worth failing the request over */ }
    }

    return res.status(200).json({ sent, staleRemoved: staleIds.length, totalDevices: rows.length });
  } catch (err) {
    return res.status(502).json({ error: { message: 'send-push failed', detail: String(err) } });
  }
}
