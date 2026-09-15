export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('', { status: 405 });
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id || !SUPABASE_URL || !SUPABASE_KEY) return new Response('', { status: 204 });

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_mini_app_launch`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: id }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (e) { /* best-effort, never block the app on this */ }

  return new Response('', { status: 204 });
}
