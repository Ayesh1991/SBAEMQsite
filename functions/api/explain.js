/**
 * Cloudflare Pages Function — "Explore with AI".
 * Route: POST /api/explain
 *
 * Auth: the caller sends their Supabase access token as
 *   Authorization: Bearer <token>
 * We verify it against Supabase to get the real email — so a
 * candidate cannot pretend to be the developer to unlock Claude.
 *
 * Everyone → Gemini Flash (rate-limited per user per day, cached).
 * Developer email only → Claude + downloadable study aids.
 *
 * Environment variables to set in Cloudflare Pages → Settings →
 * Variables and secrets:
 *   GEMINI_API_KEY        (required — everyone uses this)
 *   ANTHROPIC_API_KEY     (optional — only the developer path uses it)
 *   SUPABASE_URL          (your project URL)
 *   SUPABASE_ANON_KEY     (the public anon key)
 *   DEV_EMAIL             (ayeshmantha@gmail.com)
 */

const DEV_EMAIL_FALLBACK = 'ayeshmantha@gmail.com';

export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);

  const devEmail = (env.DEV_EMAIL || DEV_EMAIL_FALLBACK).toLowerCase();

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }
  const { action = 'explain', question = {}, messages = [], artifact, model } = body;
  let provider = body.provider === 'claude' ? 'claude' : 'gemini';

  // --- verify the caller ---
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyUser(token, env);
  if (!user) return json({ error: 'Please sign in to use the AI tutor.' }, 401);
  const isDev = user.email && user.email.toLowerCase() === devEmail;

  // --- developer-only gates ---
  if (provider === 'claude' && !isDev) provider = 'gemini';           // silently downgrade others
  if (action === 'artifact' && !isDev) return json({ error: 'Study aids are available to the developer only.' }, 403);

  // --- rate limit (per user per day) via Supabase RPC ---
  const dailyLimit = Number(body.dailyLimit) || 40;
  if (!isDev) {
    const used = await bumpUsage(token, env);
    if (used != null && used > dailyLimit) {
      return json({ error: `Daily AI limit reached (${dailyLimit}). It resets tomorrow.` }, 429);
    }
  }

  // --- explanation cache (shared, only for the default one-shot) ---
  const cacheable = action === 'explain';
  if (cacheable) {
    const cached = await cacheGet(question.questionKey, env);
    if (cached) return json({ text: cached, cached: true });
  }

  try {
    if (action === 'artifact') {
      const art = await generateArtifact({ artifact, question, provider, model, env });
      return json({ artifact: art });
    }
    if (action === 'coach') {
      const p = buildCoachPrompt(body);
      const text = provider === 'claude' ? await callClaude(p.system, p.user, model, env) : await callGemini(p.system, p.user, model, env);
      return json({ text });
    }
    const prompt = action === 'chat' ? buildChatPrompt(question, messages) : buildExplainPrompt(question);
    const text = provider === 'claude'
      ? await callClaude(prompt.system, prompt.user, model, env)
      : await callGemini(prompt.system, prompt.user, model, env);
    if (cacheable) await cacheSet(question.questionKey, provider, text, env);
    return json({ text });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

/* ---------------- Supabase auth + usage + cache ---------------- */

async function sb(path, env, opts = {}) {
  const url = (env.SUPABASE_URL || '').replace(/\/$/, '') + path;
  const headers = Object.assign({ apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(url, { ...opts, headers });
}
async function verifyUser(token, env) {
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const res = await sb('/auth/v1/user', env, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  return res.json();
}
async function bumpUsage(token, env) {
  try {
    const res = await sb('/rest/v1/rpc/bump_ai_usage', env, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ p_limit: 0 })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function cacheGet(key, env) {
  if (!key) return null;
  try {
    const res = await sb(`/rest/v1/ai_explanations?question_key=eq.${encodeURIComponent(key)}&select=body`, env,
      { headers: { Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY } });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.body || null;
  } catch { return null; }
}
async function cacheSet(key, provider, body, env) {
  if (!key) return;
  try {
    await sb('/rest/v1/ai_explanations', env, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ question_key: key, provider, body })
    });
  } catch {}
}

/* ---------------- prompts ---------------- */

const PERSONA = 'You are an expert Obstetrics & Gynaecology examiner and tutor for the Sri Lankan PGIM MD Part 2 (and MRCOG Part 2/3). Be precise, exam-focused and concise. Base answers on NICE, RCOG Green-top and SLCOG guidance. Never invent references.';

function qBlock(q) {
  const L = 'ABCDEFGHIJKLMNOPQRST';
  const opts = (q.options || []).map((o, i) => `${q.preLettered ? '' : L[i] + '. '}${o}`).join('\n');
  const correct = q.preLettered ? q.options[q.answer] : L[q.answer] + '. ' + q.options[q.answer];
  const chosen = q.chosen == null ? 'not answered' : (q.preLettered ? q.options[q.chosen] : L[q.chosen] + '. ' + q.options[q.chosen]);
  return `${q.theme ? 'Theme: ' + q.theme + '\n' : ''}Question: ${q.stem}\n${q.lead || ''}\nOptions:\n${opts}\nCorrect answer: ${correct}\nCandidate chose: ${chosen}\nWritten rationale: ${q.rationale || '(none)'}`;
}
function buildExplainPrompt(q) {
  return { system: PERSONA, user: `${qBlock(q)}\n\nExplain, in under 180 words: why the correct answer is right, why the most tempting wrong option is wrong, and one high-yield take-home point. Use short paragraphs or bullets.` };
}
function buildChatPrompt(q, messages) {
  const convo = (messages || []).map(m => `${m.role === 'user' ? 'Candidate' : 'Tutor'}: ${m.content}`).join('\n');
  return { system: PERSONA, user: `Context question:\n${qBlock(q)}\n\nConversation so far:\n${convo}\n\nAnswer the candidate's latest message concisely and accurately.` };
}
function buildCoachPrompt(body) {
  const a = body.analytics || {};
  const rows = (a.buckets || []).map(b => `- ${b.label}: ${b.correct}/${b.seen} (${b.pct}%)`).join('\n') || '(no per-topic data)';
  return {
    system: PERSONA + ' You are writing a focused, motivating study plan for one candidate.',
    user: `A candidate just finished an adaptive PGIM MD Part 2 mock (30 SBA + 30 EMQ, blueprint-shaped).\n` +
      `Overall: ${a.correct}/${a.scored} (${a.percent}%). SBA ${a.sba || 'n/a'}, EMQ ${a.emq || 'n/a'}.\n` +
      `Per-topic performance (weakest first):\n${rows}\n\n` +
      `Blueprint context (examiner tendencies, high-yield stems from 2022–2025 recall):\n${String(body.blueprintNotes || '').slice(0, 2500)}\n\n` +
      `Write, in under 220 words with **bold** headers and bullets: (1) a 2-sentence overall verdict; ` +
      `(2) the 3 highest-priority topics to revise next, each with WHY — tie it to the weak scores AND the blueprint's high-yield stems; ` +
      `(3) 3 concrete actions for tomorrow's study session.`
  };
}
function buildArtifactPrompt(kind, q) {
  const base = qBlock(q);
  switch (kind) {
    case 'summary':
      return { mime: 'text/markdown', ext: 'md', system: PERSONA,
        user: `${base}\n\nWrite a concise, well-structured Markdown revision summary of this topic for exam prep: key facts, management steps, common traps. Return Markdown only.` };
    case 'chart':
      return { mime: 'image/svg+xml', ext: 'svg', system: PERSONA + ' You output only valid standalone SVG.',
        user: `${base}\n\nProduce a clean, self-contained SVG (max 720x480, dark background #12152b, light text) that visualises the key decision thresholds or comparison for this topic (e.g. a labelled bar or flow of values). Return ONLY the <svg>...</svg> markup, no code fences.` };
    case 'infographic':
      return { mime: 'text/html', ext: 'html', system: PERSONA + ' You output only a single self-contained HTML document with inline CSS.',
        user: `${base}\n\nProduce a single self-contained, print-friendly HTML infographic (inline CSS, dark theme) summarising this topic: title, 3-5 key boxes, a management pathway. Return ONLY the HTML document, no code fences.` };
    case 'tree':
      return { mime: 'image/svg+xml', ext: 'svg', system: PERSONA + ' You output only valid standalone SVG.',
        user: `${base}\n\nProduce a self-contained SVG decision/management tree diagram for this topic (dark background #12152b, light text, boxes and connector lines, max 800x600). Return ONLY the <svg>...</svg> markup, no code fences.` };
    case 'mindmap':
      return { mime: 'image/svg+xml', ext: 'svg', system: PERSONA + ' You output only valid standalone SVG.',
        user: `${base}\n\nProduce a self-contained SVG MIND MAP that helps revise this topic. Put the central concept in a rounded central node; radiate 4-7 primary branches outward with smooth curved connector lines in distinct colours, and 1-3 short sub-nodes per branch. Keep every label to a few words. Dark background #12152b, light text, max 900x680, no overlapping text. Return ONLY the <svg>...</svg> markup, no code fences.` };
    default:
      throw new Error('Unknown study aid.');
  }
}
async function generateArtifact({ artifact, question, provider, model, env }) {
  const p = buildArtifactPrompt(artifact, question);
  let content = provider === 'claude'
    ? await callClaude(p.system, p.user, model, env)
    : await callGemini(p.system, p.user, model, env);
  content = stripFences(content).trim();
  const slug = (question.paperTitle || 'aureum').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return { type: artifact, mime: p.mime, filename: `${slug}-${artifact}.${p.ext}`, content };
}
function stripFences(s) { return s.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, ''); }

/* ---------------- model calls ---------------- */

async function callGemini(system, user, model, env) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured on the server.');
  // Guard against a mis-pasted secret: a real key is a single token
  // (AIza… , no spaces / newlines / punctuation). If the stored value
  // contains whitespace or SQL-ish characters, the request would corrupt
  // the URL and Google returns a cryptic "cannot bind query parameter"
  // error — so fail fast with a message the developer can act on.
  const key = String(env.GEMINI_API_KEY).trim();
  // A real key is a single token — either the classic "AIza…" or the newer
  // "AQ.…" format. Only reject values that would corrupt the URL (spaces,
  // separators) — e.g. text pasted from schema.sql by mistake.
  if (/\s/.test(key) || /[&?#'"();]/.test(key) || key.length < 20) {
    throw new Error('The GEMINI_API_KEY set in Cloudflare is not a valid key — it should be a single "AIza…" or "AQ.…" string with no spaces. Re-paste your key from https://aistudio.google.com/apikey (Settings → Variables and secrets → GEMINI_API_KEY) and redeploy.');
  }
  // Try the configured model first, then well-known fallbacks. This handles a
  // model that isn't available on this key/region AND the case where one model
  // has no free-tier quota but another still does.
  const models = [model || 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash-001'];
  const tried = new Set();
  let lastErr = 'unknown error';
  for (const m of models) {
    if (tried.has(m)) continue; tried.add(m);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`;
    let res, data;
    try {
      res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1400 }
        })
      });
      data = await res.json().catch(() => ({}));
    } catch (e) { lastErr = String(e.message || e); continue; }

    if (res.ok) {
      const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text).join('') || '';
      if (text) return text;
      const fr = data.candidates?.[0]?.finishReason;
      lastErr = fr ? `no text (finishReason: ${fr})` : 'empty response';
      continue;
    }
    // surface Google's real message (e.g. "API key not valid", "API not enabled")
    lastErr = data.error?.message || `HTTP ${res.status}`;
    const modelIssue = res.status === 404 || /not found|not supported|unknown name|unsupported|is not found/i.test(lastErr);
    const quota = res.status === 429 || /quota|exceeded|resource_exhausted/i.test(lastErr);
    if (quota) { lastErr = quotaHint(lastErr); continue; }  // another model may still have free quota
    if (!modelIssue) break;   // auth/other key problem → other models won't help
  }
  throw new Error('Gemini: ' + lastErr);
}
// Turn Google's verbose quota error into one actionable line. "limit: 0" means
// the project was granted NO free-tier quota (usually the free tier isn't
// offered in this account's region) — waiting never helps; billing is the fix.
function quotaHint(msg) {
  if (/limit:\s*0\b/.test(msg)) {
    return 'Gemini free-tier quota is 0 for this Google project (the free tier isn\'t available in your region). Enable billing on the project behind this API key at https://aistudio.google.com/apikey — Gemini Flash is charged per use but costs a tiny amount. (Original: ' + msg.slice(0, 140) + '…)';
  }
  return 'Gemini rate/quota limit reached. ' + msg.slice(0, 200);
}
async function callClaude(system, user, model, env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model || 'claude-haiku-4-5-20251001', max_tokens: 1200, system, messages: [{ role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`Claude error (HTTP ${res.status}). Check ANTHROPIC_API_KEY.`);
  const data = await res.json();
  const text = (data.content || []).map(b => b.text).join('') || '';
  if (!text) throw new Error('Claude returned an empty response.');
  return text;
}
