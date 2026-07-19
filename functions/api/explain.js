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
 *   GEMINI_DEFAULT_MODEL  (optional — baseline model for non-upgraded users;
 *                          defaults to gemini-2.5-flash)
 *
 * Billing: every successful call logs the provider's OWN token counts
 * (Gemini usageMetadata / Anthropic usage) per user × day × model into
 * ai_token_usage via the log_ai_tokens RPC — the invoice source of truth.
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

  // --- per-user Gemini model gate ---
  // Higher Gemini models are opt-in per user (feature flag `gemini_advanced`
  // granted in Users & access). Anyone else is forced onto the default model,
  // no matter what the client sends — so billing tiers can't be bypassed.
  const defaultGemini = env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash';
  let effectiveModel = model;
  let geminiRestricted = false;
  if (provider === 'gemini' && !isDev) {
    const flags = await getUserFlags(token, user.id, env);
    geminiRestricted = !flags.gemini_advanced;
    if (geminiRestricted) effectiveModel = defaultGemini;
  }

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

  // one model round-trip + token metering, shared by every action below
  const run = async (p) => {
    const r = provider === 'claude'
      ? await callClaude(p.system, p.user, model, env)
      : await callGemini(p.system, p.user, effectiveModel, env, geminiRestricted);
    await logTokens(token, env, provider, r);   // true billing meter (dev included)
    return r;
  };

  try {
    // ---- platform AI jobs (developer-run, billed to a shared pool) ----
    if (action === 'tag' || action === 'insights' || action === 'audit') {
      if (!isDev) return json({ error: 'Developer only.' }, 403);
      const feature = { tag: 'question_tagger', insights: 'behaviour_insights', audit: 'question_auditor' }[action];
      const fc = await getFeatureConfig(env, feature);
      const p = action === 'tag' ? buildTagPrompt(body) : action === 'insights' ? buildInsightsPrompt(body) : buildAuditPrompt(body);
      const useProvider = fc.provider === 'claude' ? 'claude' : 'gemini';
      const r = useProvider === 'claude'
        ? await callClaude(p.system, p.user, fc.model || model, env)
        : await callGemini(p.system, p.user, fc.model || model || defaultGemini, env, false);
      await logShared(token, env, feature, useProvider, r);
      return json({ text: r.text, model: r.model });
    }
    // ---- auto-flashcards from wrong answers (per-user feature, dev-grantable) ----
    if (action === 'flashcard') {
      if (!isDev) {
        const flags = await getUserFlags(token, user.id, env);
        if (!flags.ai_flashcards) return json({ error: 'AI flashcards are not enabled for your account — ask the developer to switch them on in Users & access.' }, 403);
      }
      const fc = await getFeatureConfig(env, 'auto_flashcards');
      if (fc.enabled === false) return json({ error: 'AI flashcards are currently switched off.' }, 403);
      const p = buildFlashcardPrompt(body);
      const useProvider = fc.provider === 'claude' ? 'claude' : 'gemini';
      const r = useProvider === 'claude'
        ? await callClaude(p.system, p.user, fc.model, env)
        : await callGemini(p.system, p.user, fc.model || defaultGemini, env, false);
      await logTokens(token, env, useProvider, r);
      return json({ text: r.text, model: r.model });
    }
    if (action === 'artifact') {
      const art = await generateArtifact({ artifact, question, run });
      return json({ artifact: art.artifact, model: art.model });
    }
    if (action === 'coach') {
      const r = await run(buildCoachPrompt(body));
      return json({ text: r.text, model: r.model });
    }
    const prompt = action === 'chat' ? buildChatPrompt(question, messages) : buildExplainPrompt(question);
    const r = await run(prompt);
    if (cacheable) await cacheSet(question.questionKey, provider, r.text, env);
    return json({ text: r.text, model: r.model });
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
// feature flags for the caller (used by the Gemini model gate)
async function getUserFlags(token, userId, env) {
  try {
    const res = await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=feature_flags`, env,
      { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return {};
    const rows = await res.json();
    return rows[0]?.feature_flags || {};
  } catch { return {}; }
}
// per-feature config from the AI systems panel (app_config id='ai_features').
// { enabled, provider, model, split } — the panel's choice is authoritative
// over whatever the client sends, so feature model/billing can't be forged.
async function getFeatureConfig(env, feature) {
  try {
    const res = await sb(`/rest/v1/app_config?id=eq.ai_features&select=data`, env,
      { headers: { Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY } });
    if (!res.ok) return {};
    const rows = await res.json();
    return (rows[0]?.data || {})[feature] || {};
  } catch { return {}; }
}
// shared-pool meter for platform jobs (tagging, insights, audits) — cost is
// split across eligible users by the invoice engine, not billed to the dev.
async function logShared(token, env, feature, provider, r) {
  if (!r || (!r.in && !r.out)) return;
  try {
    await sb('/rest/v1/rpc/log_ai_shared', env, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify({ p_feature: feature, p_provider: provider, p_model: r.model || 'unknown', p_input: r.in | 0, p_output: r.out | 0 })
    });
  } catch {}
}
// billing meter: record the EXACT token counts the provider reported,
// attributed to the verified caller (auth.uid() inside the RPC). Never
// blocks the response — a metering hiccup must not break the tutor.
async function logTokens(token, env, provider, r) {
  if (!r || (!r.in && !r.out)) return;
  try {
    await sb('/rest/v1/rpc/log_ai_tokens', env, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify({ p_provider: provider, p_model: r.model || 'unknown', p_input: r.in | 0, p_output: r.out | 0 })
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
// ---- platform-job prompts ----

// Batch tagger: questions in, strict JSON out. The canonical topic list
// comes from the blueprint so tags land exactly on the buckets the
// simulator selects with.
function buildTagPrompt(body) {
  const topics = (body.topics || []).slice(0, 80);
  const qs = (body.questions || []).slice(0, 12).map(q =>
    `KEY: ${q.key}\nKIND: ${q.kind}\n${q.theme ? 'THEME: ' + q.theme + '\n' : ''}STEM: ${String(q.stem || '').slice(0, 500)}\n${q.lead ? 'LEAD: ' + q.lead + '\n' : ''}OPTIONS: ${(q.options || []).join(' | ').slice(0, 400)}\nRATIONALE: ${String(q.rationale || '').slice(0, 300)}`
  ).join('\n---\n');
  return {
    system: PERSONA + ' You are indexing an exam question bank. You output ONLY a valid JSON array, no code fences, no commentary.',
    user: `Canonical topic list (choose the single best match for each question; if truly none fits, invent a short sensible topic):\n${topics.join('; ')}\n\n` +
      `Questions:\n${qs}\n\n` +
      `For EACH question return an object: {"key": "<KEY exactly as given>", "topic": "<best canonical topic>", "category": "<Obstetrics|Gynaecology|Reproductive Medicine|Oncology|Urogynaecology|Other>", "guideline": "<the single most relevant guideline, e.g. 'GTG 72' or 'NICE NG201', or ''>", "tags": ["3-6 short keywords"], "difficulty": <0.2 easy … 0.8 very hard, your estimate>}.\n` +
      `Return a JSON array with exactly one object per question, same order.`
  };
}
// One wrong answer → 1-3 spaced-repetition cards, strict JSON.
function buildFlashcardPrompt(body) {
  const q = body.question || {};
  return {
    system: PERSONA + ' You write razor-sharp spaced-repetition flashcards. You output ONLY a valid JSON array, no code fences.',
    user: `${qBlock(q)}\n\nThe candidate answered this WRONG. Write 1-3 flashcards that would stop them ever missing it again: ` +
      `test the discriminating fact they missed, not trivia. Each card: {"question": "…", "answer": "…", "keyPoint": "one-line hook"}. ` +
      `Front under 30 words, back under 45. Return a JSON array only.`
  };
}
// Behaviour analysis: aggregated tracking data in, markdown insight out.
function buildInsightsPrompt(body) {
  return {
    system: PERSONA + ' You are an assessment psychometrician analysing candidate behaviour data for the exam-prep platform owner.',
    user: `Aggregated interaction data from the question bank (per-question stats, answer changes, time spent, and the literal questions candidates typed to the AI tutor):\n\n` +
      `${String(body.data || '').slice(0, 9000)}\n\n` +
      `Write, in under 350 words with **bold** headers: (1) which questions/topics the cohort finds hardest and WHY (use the behavioural signals — long dwell, answer changes, tutor questions); ` +
      `(2) what the tutor questions reveal about misconceptions; (3) 3 concrete recommendations for the question bank or teaching. Be specific — name question keys and topics.`
  };
}
// Flagged-question audit: the question + every user complaint + stats in,
// a verdict and suggested fix out.
function buildAuditPrompt(body) {
  const q = body.question || {};
  return {
    system: PERSONA + ' You are the chief examiner auditing a disputed question. Be decisive and cite the specific guideline.',
    user: `${qBlock(q)}\n\nCandidate complaints:\n${(body.complaints || []).map((c, i) => `${i + 1}. ${c}`).join('\n') || '(none given)'}\n\n` +
      `Cohort stats: ${body.stats || 'n/a'}\n\n` +
      `Give, in under 250 words with **bold** headers: (1) VERDICT — is the keyed answer correct per current NICE/RCOG/SLCOG guidance? ` +
      `(2) If wrong or ambiguous: the correct answer and a corrected rationale ready to paste. (3) If the stem/options are flawed, a rewritten version. (4) Cite the guideline.`
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
async function generateArtifact({ artifact, question, run }) {
  const p = buildArtifactPrompt(artifact, question);
  const r = await run(p);
  const content = stripFences(r.text).trim();
  const slug = (question.paperTitle || 'aureum').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return { artifact: { type: artifact, mime: p.mime, filename: `${slug}-${artifact}.${p.ext}`, content }, model: r.model };
}
function stripFences(s) { return s.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, ''); }

/* ---------------- model calls ---------------- */

async function callGemini(system, user, model, env, restricted) {
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
  // model that isn't available on this key/region AND quota exhaustion on one
  // model while another still works. (Gemini 2.0 Flash was retired 2026-06-01,
  // so 2.5 Flash is the baseline now.) For non-upgraded users the fallback
  // list stays on baseline-priced models only — the gate can't be escaped
  // through an outage.
  const models = restricted
    ? [model || 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest']
    : [model || 'gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-3-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];
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
      if (text) {
        // True token counts from Google's own meter. Thinking tokens
        // (thoughtsTokenCount, 2.5+) are billed as OUTPUT, so they count.
        const um = data.usageMetadata || {};
        return {
          text, model: (data.modelVersion || m),
          in: um.promptTokenCount || 0,
          out: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)
        };
      }
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
  // True token counts from Anthropic's own meter.
  return { text, model: data.model || model || 'claude-haiku-4-5',
    in: data.usage?.input_tokens || 0, out: data.usage?.output_tokens || 0 };
}
