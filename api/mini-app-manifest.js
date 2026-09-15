export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') || '';

  const fallback = {
    name: 'Social Plus App', short_name: 'App', start_url: '/', display: 'standalone',
    background_color: '#0b0b0d', theme_color: '#0b0b0d', icons: []
  };

  if (!slug || !SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify(fallback), { headers: { 'content-type': 'application/manifest+json' } });
  }

  try {
    const q = `${SUPABASE_URL}/rest/v1/mini_apps?or=(slug.eq.${encodeURIComponent(slug)},id.eq.${encodeURIComponent(slug)})&select=id,name,logo,slug&limit=1`;
    const res = await fetch(q, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(4000)
    });
    const rows = await res.json();
    const app = Array.isArray(rows) ? rows[0] : null;
    if (!app) return new Response(JSON.stringify(fallback), { headers: { 'content-type': 'application/manifest+json' } });

    const icon = app.logo || `${url.origin}/icon-192.png`;
    const manifest = {
      name: app.name,
      short_name: String(app.name || '').slice(0, 12),
      start_url: `/app/${encodeURIComponent(app.slug || app.id)}`,
      scope: `/app/${encodeURIComponent(app.slug || app.id)}`,
      display: 'standalone',
      background_color: '#0b0b0d',
      theme_color: '#0b0b0d',
      icons: [
        { src: icon, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icon, sizes: '512x512', type: 'image/png', purpose: 'any' }
      ]
    };
    return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=60' } });
  } catch (e) {
    return new Response(JSON.stringify(fallback), { headers: { 'content-type': 'application/manifest+json' } });
  }
}
