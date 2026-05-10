/**
 * connectors/slipstream.mjs — Slipstream upgrade bridge
 * When VEKTOR_API_KEY is present, Via delegates memory ops to Slipstream.
 * Requires Node >= 18 (native fetch).
 */

export const name    = 'slipstream';
export const version = '0.1.0';

const BASE = process.env.VEKTOR_API_BASE ?? 'https://api.vektormemory.com';

function apiKey() {
  const k = process.env.VEKTOR_API_KEY;
  if (!k) throw new Error('VEKTOR_API_KEY not set — run: npx via upgrade');
  return k;
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey()}` },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slipstream API error: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function store(content, opts = {}) {
  return post('/v1/memory/store', { content, ...opts });
}

export async function recall(query, opts = {}) {
  return post('/v1/memory/recall', { query, ...opts });
}

export async function context(query, opts = {}) {
  return post('/v1/memory/context', { query, ...opts });
}

export async function ping() {
  try {
    const res = await fetch(`${BASE}/v1/health`, {
      headers: { 'Authorization': `Bearer ${apiKey()}` },
    });
    return res.ok;
  } catch { return false; }
}

export function isConnected() {
  return !!(process.env.VEKTOR_API_KEY);
}
