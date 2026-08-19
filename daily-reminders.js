// api/daily-reminders.js
//
// WHY THIS EXISTS:
// addNotifForUser() (and the new api/send-push.js it calls) only fires when
// something HAPPENS while the app is open — a wallet credit, a comment, etc.
// Two of Dave's requested reminders are different: they need to fire on a
// SCHEDULE, checking state nobody actively triggered today —
//   1. Premium expired (fire once, right when it flips to expired)
//   2. Streak about to break (fire once, in the evening, for anyone who
//      hasn't checked in yet today)
// There's no user action to hang either of those off, so this runs on a
// Vercel Cron schedule instead (see vercel.json's "crons" entry) and
// proactively pushes to everyone who needs it — including users whose app
// is fully closed, which client-side-only logic in index.html could never do.
//
// SETUP:
//   1. Drop this file at /api/daily-reminders.js.
//   2. vercel.json already has a "crons" entry pointing at this path.
//   3. Uses the same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
//      VAPID_* env vars as api/send-push.js — no new env vars needed.
//   4. REQUIRED ONE-TIME SQL — run this in Supabase's SQL Editor before
//      first use, so the "already reminded about this expiry" check works:
//        alter table premium_users add column if not exists expiry_notified_at timestamptz;
//      Without this column the expiry-sweep block below will error out
//      (harmlessly — it's wrapped in try/catch, so streak reminders below
//      it still run) until you add it.

import webpush from 'web-push';

// Hobby plan caps every function (including cron-triggered ones) at 10s —
// this is just declaring that explicitly so it's obvious in the file, not
// something that changes the actual limit (Vercel enforces the real ceiling
// based on your plan regardless of what's set here).
export const config = { maxDuration: 10 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
  });
  if (!r.ok) throw new Error(`SB GET ${path} failed (${r.status})`);
  return r.json();
}

async function sbPatch(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
}

async function sbInsert(table, row) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row)
  });
}

async function pushToUser(username, title, body, tag) {
  const rows = await sbGet(`push_subscriptions?username=eq.${encodeURIComponent(username)}&select=id,subscription`).catch(() => []);
  if (!rows.length) return;
  const payload = JSON.stringify({ title, body, tag, url: '/' });
  const staleIds = [];
  await Promise.all(rows.map(async (row) => {
    try { await webpush.sendNotification(row.subscription, payload); }
    catch (err) { if (err && (err.statusCode === 404 || err.statusCode === 410)) staleIds.push(row.id); }
  }));
  if (staleIds.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${staleIds.join(',')})`, {
      method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    }).catch(() => {});
  }
}

// Writes the in-app notification row too, so it also shows up in the bell/
// Alert tab next time they open the app — not just as a push.
async function notifyUser(username, text, kind) {
  const notifId = Date.now().toString() + Math.random().toString(36).slice(2, 6);
  await sbInsert('notifications', {
    id: notifId, target_user: username, body: text, time: new Date().toISOString(), read: false, kind
  }).catch(() => {});
  await pushToUser(username, 'Social Plus', text, 'predict-notif-' + notifId).catch(() => {});
}

// Runs an array of async jobs with at most `limit` running concurrently —
// keeps this fast enough to fit Vercel Hobby's 10s function timeout even
// with hundreds of users, without firing hundreds of simultaneous requests
// at Supabase/web-push at once.
async function runWithConcurrency(items, limit, worker) {
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(runners);
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: { message: 'Missing required env vars' } });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@plusng.com.ng',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const results = { premiumExpired: 0, streakReminders: 0, errors: [] };

  // ── 1. Premium expiry: anyone whose expires_at has passed and who hasn't
  //      been notified about THIS expiry yet (expiry_notified_at is null or
  //      predates expires_at, covering someone who re-subscribes then lets
  //      it lapse again later). ──
  try {
    const nowIso = new Date().toISOString();
    const expired = await sbGet(
      `premium_users?expires_at=not.is.null&expires_at=lte.${encodeURIComponent(nowIso)}&select=username,tier,expires_at,expiry_notified_at`
    );
    await runWithConcurrency(expired, 8, async (row) => {
      if (row.expiry_notified_at && row.expiry_notified_at >= row.expires_at) return; // already reminded for this lapse
      const tierLabel = row.tier ? (row.tier.charAt(0).toUpperCase() + row.tier.slice(1)) : 'Premium';
      await notifyUser(
        row.username,
        `⏰ Your Plus ${tierLabel} plan has expired. Renew now to keep your perks.`,
        'premium'
      );
      await sbPatch(`premium_users?username=eq.${encodeURIComponent(row.username)}`, { expiry_notified_at: nowIso }).catch(() => {});
      results.premiumExpired++;
    });
  } catch (e) { results.errors.push('premiumExpired: ' + String(e)); }

  // ── 2. Streak reminders: anyone with an active streak whose last check-in
  //      wasn't today. Client-side _scheduleStreakReminder() already covers
  //      this for users with the app open at 8pm; this is the closed-app
  //      backstop, run once daily by the cron schedule.
  //      NOTE: streak data lives in accounts.streak_data (a JSON string —
  //      see _persistStreakToSupabase() in index.html), NOT a separate
  //      "streaks" table, so this reads/parses that column directly. ──
  try {
    const todayStr = new Date().toDateString(); // matches the format index.html stores in streak_data.last
    const accts = await sbGet(`accounts?streak_data=not.is.null&select=username,streak_data`);
    await runWithConcurrency(accts, 8, async (row) => {
      let sd = null;
      try { sd = typeof row.streak_data === 'string' ? JSON.parse(row.streak_data) : row.streak_data; } catch (e) { return; }
      if (!sd || !sd.streak || sd.streak < 1) return; // no active streak
      if (sd.last === todayStr) return; // already checked in today
      await notifyUser(
        row.username,
        `🔥 Don't lose your ${sd.streak}-day streak! Check in before the day ends.`,
        'reminder' // matches _inferNotifKind()'s "streak alive"/"keep streak" pattern in index.html, so it routes/colors correctly
      );
      results.streakReminders++;
    });
  } catch (e) { results.errors.push('streakReminders: ' + String(e)); }

  return res.status(200).json(results);
}
