/**
 * Cloudflare Pages Function — developer passkey gate.
 * Route: POST /api/devkey   body: { "key": "1234" }
 *
 * Compares the submitted key against the PASS_KEY secret
 * (Cloudflare Pages → Settings → Variables and secrets → PASS_KEY,
 * e.g. a 4-digit code like 1234).
 *
 * Responses:
 *   { ok: true }                     — correct key
 *   { ok: false }                    — wrong key
 *   { ok: false, configured: false } — PASS_KEY not set on the server
 *                                      (the client falls back to the
 *                                      developer code so you're never
 *                                      locked out before setting it)
 */
export async function onRequest({ request, env }) {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);

  let body = {};
  try { body = await request.json(); } catch { /* fall through */ }
  if (!env.PASS_KEY) return json({ ok: false, configured: false });

  const ok = String(body.key || '').trim() === String(env.PASS_KEY).trim();
  if (!ok) await new Promise(r => setTimeout(r, 600));   // slow brute-force attempts
  return json({ ok });
}
