// api/groq.js — Groq proxy for Social Plus.
// GROQ_API_KEY stays in Vercel env vars. Optional overrides:
//   GROQ_TEXT_MODEL   (default openai/gpt-oss-120b)
//   GROQ_VISION_MODEL (default qwen/qwen3.6-27b — multimodal)
const URL_ = 'https://api.groq.com/openai/v1/chat/completions';
const TEXT = process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';
const VISION = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
const TEXT_CHAIN = [TEXT, 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b'];
const VISION_CHAIN = [VISION, 'qwen/qwen3.8-27b'];

const isGptOss = (m) => /gpt-oss/.test(m);
const isQwen = (m) => /^qwen\//.test(m);

// Turn Claude-style {system, messages:[{content:[{type:'image',source:{...}}]}]} into OpenAI format.
function normalize(body) {
  const b = { ...body };
  const msgs = [];
  if (typeof b.system === 'string' && b.system) msgs.push({ role: 'system', content: b.system });
  delete b.system;
  let hasImage = false;
  for (const m of b.messages || []) {
    if (Array.isArray(m.content)) {
      const parts = m.content.map((p) => {
        if (p && p.type === 'image' && p.source) {
          hasImage = true;
          const url = p.source.type === 'base64'
            ? `data:${p.source.media_type || 'image/jpeg'};base64,${p.source.data}`
            : p.source.url;
          return { type: 'image_url', image_url: { url } };
        }
        if (p && p.type === 'image_url') hasImage = true;
        return p;
      });
      msgs.push({ ...m, content: parts });
    } else msgs.push(m);
  }
  b.messages = msgs;
  return { b, hasImage };
}

function shapeFor(model, b, hasImage) {
  const out = { ...b, model };
  out.max_tokens = Math.min(Math.max(Number(b.max_tokens) || 800, 400) + (isGptOss(model) ? 1500 : 0), 8000);
  if (isGptOss(model)) out.reasoning_effort = ['low', 'medium', 'high'].includes(b.reasoning_effort) ? b.reasoning_effort : 'low';
  else if (isQwen(model)) out.reasoning_effort = 'none'; // fast replies, no thinking tokens
  else delete out.reasoning_effort;
  if (hasImage) delete out.reasoning_effort;
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Server missing GROQ_API_KEY' } });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: { message: 'Bad JSON' } }); } }
  if (!body || !Array.isArray(body.messages)) return res.status(400).json({ error: { message: 'messages required' } });

  const { b, hasImage } = normalize(body);
  const chain = hasImage ? VISION_CHAIN : TEXT_CHAIN; // client-sent model names are ignored on purpose
  let last = { status: 502, data: { error: { message: 'No model available' } } };

  for (const model of chain) {
    try {
      const r = await fetch(URL_, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(shapeFor(model, b, hasImage)),
      });
      const data = await r.json().catch(() => ({}));
      const text = data?.choices?.[0]?.message?.content;
      if (r.ok && text) return res.status(200).json(data);
      last = { status: r.ok ? 502 : r.status, data: r.ok ? { error: { message: 'Empty reply from model' } } : data };
      // retry on model gone / bad params / empty / overload; stop on auth
      if (r.status === 401 || r.status === 403) break;
    } catch (err) {
      last = { status: 502, data: { error: { message: 'Failed to reach Groq', detail: String(err) } } };
    }
  }
  return res.status(last.status).json(last.data);
}
