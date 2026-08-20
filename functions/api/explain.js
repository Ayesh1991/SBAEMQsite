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
 *   OPENAI_API_KEY        (optional — needed for the GPT provider)
 *   OPENAI_DEFAULT_MODEL  (optional — exact GPT model id; defaults to gpt-5.6-luna)
 *   SUPABASE_URL          (your project URL)
 *   SUPABASE_ANON_KEY     (the public anon key)
 *   DEV_EMAIL             (ayeshmantha@gmail.com)
 *   GEMINI_DEFAULT_MODEL  (optional — baseline model for non-upgraded users;
 *                          defaults to gemini-2.5-flash)
 *
 * Billing: every successful call logs the provider's OWN token counts
 * (Gemini usageMetadata / Anthropic usage / OpenAI usage) per user × day × model into
 * ai_token_usage via the log_ai_tokens RPC — the invoice source of truth.
 */

const DEV_EMAIL_FALLBACK = 'ayeshmantha@gmail.com';
/* The account users pay into. This has to be known SERVER-SIDE, because the
   server is what decides whether a slip names the right account — and it
   cannot read config.js, which lives in the browser.

   Without this fallback the two sides disagreed: the top-up page happily told
   people to pay into the account it found in config.js, while the server,
   finding nothing stored in app_config, reported "the site owner has not set
   the account number yet" and sent every slip to the approval queue. Keeping
   the same default here means instant activation works out of the box; the
   developer's Rates & settings entry and BENEFICIARY_ACCOUNT both still
   override it. Not a secret — it is the number printed on every slip. */
const BENEFICIARY_FALLBACK = '0087612781';

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
  let provider = ['claude', 'gpt'].includes(body.provider) ? body.provider : 'gemini';

  // --- verify the caller ---
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyUser(token, env);
  if (!user) return json({ error: 'Please sign in to use the AI tutor.' }, 401);
  const isDev = user.email && user.email.toLowerCase() === devEmail;

  // --- developer-only gates ---
  if (provider === 'claude' && !isDev) provider = 'gemini';           // silently downgrade others
  if (action === 'artifact' && !isDev) return json({ error: 'Study aids are available to the developer only.' }, 403);

  // --- per-user AI access gates ---
  // Gemini access itself is developer-granted per user (flag `gemini` in
  // Users & access): without it, a non-dev caller gets NO AI at all. On top
  // of that, higher Gemini models need `gemini_advanced`; everyone else is
  // pinned to the default model no matter what the client sends — so
  // access and billing tiers can't be bypassed. (feature_flags is
  // trigger-protected in Postgres: only the developer can change it.)
  const defaultGemini = env.GEMINI_DEFAULT_MODEL || 'gemini-3.1-flash-lite';
  // GPT model id is env-overridable so the exact OpenAI string can be
  // corrected server-side without redeploying the client.
  const defaultGpt = env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
  /* The OSCE tab lets a candidate pick a named GPT model, so honour a
     requested id when it plainly IS one — anything else falls back to the
     server's own default rather than being passed to OpenAI unchecked. */
  const askedGpt = (typeof model === 'string' && /^gpt-[\w.\-]{1,40}$/i.test(model)) ? model : defaultGpt;
  // Google retired the 1.x/2.x lines and gemini-3-flash for new keys — any
  // stored/requested retired id silently becomes the current default so a
  // stale saved config can never resurrect a dead (or mis-priced) model.
  let effectiveModel = modernGemini(model) || model;
  let geminiRestricted = false;
  if (!isDev) {
    const flags = await getUserFlags(token, user.id, env);
    // payment first: unpaid accounts get NO AI at all, whatever else is granted
    if (!flags.paid) {
      return json({ error: 'AI features are part of the paid plan — ask the site owner to activate your payment in Users & access.' }, 403);
    }
    // GPT is granted separately (flag `gpt`). Asking for it without the grant
    // falls back to Gemini rather than erroring, so the tutor still answers.
    if (provider === 'gpt' && !flags.gpt) provider = 'gemini';
    if (provider !== 'gpt' && !flags.gemini) {
      return json({ error: 'AI access is not enabled for your account yet — ask the developer to switch on Gemini for you in Users & access.' }, 403);
    }
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

  // one model round-trip + token metering, shared by every action below.
  // `feature` records WHICH mechanism spent the tokens (per-user breakdown).
  const run = async (p, feature = 'tutor', maxTok) => {
    const r = provider === 'claude'
      ? await callClaude(p.system, p.user, model, env, maxTok)
      : provider === 'gpt'
        ? await callOpenAI(p.system, p.user, askedGpt, env, maxTok)
        : await callGemini(p.system, p.user, effectiveModel, env, geminiRestricted, maxTok);
    await logTokens(token, env, provider, r, feature);   // true billing meter (dev included)
    return r;
  };

  try {
    // ---- platform AI jobs (developer-run, billed to a shared pool) ----
    if (action === 'tag' || action === 'insights' || action === 'audit' || action === 'areamatch') {
      if (!isDev) return json({ error: 'Developer only.' }, 403);
      // area-matching is a blueprint-authoring aid, billed to the same shared
      // pool as the question auditor (it reasons over the same tag vocabulary)
      const feature = { tag: 'question_tagger', insights: 'behaviour_insights', audit: 'question_auditor', areamatch: 'question_auditor' }[action];
      const fc = await getFeatureConfig(env, feature);
      const p = action === 'tag' ? buildTagPrompt(body)
              : action === 'insights' ? buildInsightsPrompt(body)
              : action === 'areamatch' ? buildAreaMatchPrompt(body)
              : buildAuditPrompt(body);
      const useProvider = ['claude','gpt'].includes(fc.provider) ? fc.provider : 'gemini';
      // tagging returns ~100 tokens of JSON per question ×10, and Gemini
      // 2.5+ thinking also bills against the cap — give batch jobs headroom
      const maxTok = action === 'tag' ? 8000 : 2000;
      // strict: the model picked in the AI systems panel, or fail loudly
      // (a retired Gemini id stored in the panel migrates to the default)
      const r = useProvider === 'claude'
        ? await callClaude(p.system, p.user, fc.model || model, env, maxTok)
        : useProvider === 'gpt'
          ? await callOpenAI(p.system, p.user, fc.model || defaultGpt, env, maxTok)
          : await callGemini(p.system, p.user, modernGemini(fc.model) || modernGemini(model) || defaultGemini, env, false, maxTok, true);
      await logShared(token, env, feature, useProvider, r);
      // usage goes back to the panel so the runner can show live cost
      return json({ text: r.text, model: r.model, usage: { in: r.in || 0, out: r.out || 0 } });
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
      const useProvider = ['claude','gpt'].includes(fc.provider) ? fc.provider : 'gemini';
      const r = useProvider === 'claude'
        ? await callClaude(p.system, p.user, fc.model, env)
        : useProvider === 'gpt'
          ? await callOpenAI(p.system, p.user, fc.model || defaultGpt, env)
          : await callGemini(p.system, p.user, fc.model || defaultGemini, env, false);
      await logTokens(token, env, useProvider, r, 'flashcards');
      return json({ text: r.text, model: r.model });
    }
    // ---- Paper architect: map a user's search words onto the bank's AI
    // tags (Design a paper). Per-user billed; usage returned for instant
    // on-screen token/cost display.
    if (action === 'termmap') {
      const p = buildTermMapPrompt(body);
      const r = await run(p, 'paper_architect');
      return json({ text: r.text, model: r.model, usage: { in: r.in || 0, out: r.out || 0 } });
    }
    if (action === 'searchterms') {
      const r = await run(buildSearchTermsPrompt(body), 'tutor', 900);
      return json({ text: r.text, model: r.model, usage: { in: r.in || 0, out: r.out || 0 } });
    }
    if (action === 'artifact') {
      // charts, mind maps and infographics emit whole SVG/HTML documents
      const art = await generateArtifact({ artifact, question, run: p => run(p, 'study_aids', 9000) });
      return json({ artifact: art.artifact, model: art.model });
    }
    if (action === 'coach') {
      const r = await run(buildCoachPrompt(body), 'coach');
      return json({ text: r.text, model: r.model });
    }

    // ---- OSCE: mark a spoken station against its marking scheme ----
    // The transcript is the expensive part, so only the prompt, the marking
    // points and what the candidate actually said are sent — never the whole
    // station file twice.
    if (action === 'osce') {
      /* With the recording attached, the model LISTENS: it transcribes and
         marks in one pass. That is both more accurate than a browser
         recogniser (it has the marking scheme in front of it while it
         listens, so it knows "mifepristone" is a word that might be said)
         and cheaper than paying a transcription API first — audio is
         tokenised at ~32 tokens a second, so a 15-minute station is about
         29,000 input tokens. Without audio it marks the typed transcript,
         exactly as before. */
      if (body.audio && body.audio.data) {
        if (String(body.audio.data).length > 34_000_000) {
          return json({ error: 'That recording is too long to send. Mark from the transcript instead.' }, 413);
        }
        /* Which provider listens is the CLIENT's choice, checked here against
           what each one actually accepts:
             gemini — compressed audio inline, the cheap and accurate route.
             gpt    — an input_audio part, but only wav or mp3, so the browser
                      has already re-encoded it; body.audio.mime says which.
             claude — the Messages API takes text, images and PDFs, not audio.
                      There is nothing to enable, so it never reaches here. */
        if (provider === 'gpt') {
          const fmt = /mp3|mpeg/i.test(body.audio.mime || '') ? 'mp3' : 'wav';
          const rr = await callOpenAIAudio(buildOsceAudioPrompt(body), body.audio, fmt,
            askedGpt, env, 9000);
          await logTokens(token, env, 'gpt', rr, 'osce');
          return json({ text: rr.text, model: rr.model, heard: true, usage: { in: rr.in, out: rr.out } });
        }
        if (provider === 'claude') {
          return json({ error: 'Claude cannot be sent audio — it reads text, images and PDFs only. Mark from the transcript, or choose Gemini or GPT to have the recording listened to.' }, 400);
        }
        const rr = await callGeminiAudio(buildOsceAudioPrompt(body), body.audio,
          modernGemini(model) || 'gemini-3.1-flash-lite', env, 9000);
        await logTokens(token, env, 'gemini', rr, 'osce');
        return json({ text: rr.text, model: rr.model, heard: true, usage: { in: rr.in, out: rr.out } });
      }
      const r = await run(buildOsceMarkPrompt(body), 'osce', 6000);
      return json({ text: r.text, model: r.model, usage: { in: r.in, out: r.out } });
    }

    // ---- OSCE: talk to a model about the report it just produced ----
    if (action === 'oscechat') {
      const r = await run(buildOsceChatPrompt(body), 'osce_chat', 2200);
      return json({ text: r.text, model: r.model, usage: { in: r.in, out: r.out } });
    }

    // ---- a payment slip, read as structured data ----
    // Deliberately the cheapest call in the app: one small image, a JSON-only
    // instruction, a 400-token ceiling. Always Gemini Flash Lite regardless of
    // the caller's chosen provider — reading six fields off a bank receipt is
    // not a job worth paying a frontier model for.
    if (action === 'slip') {
      const img = body.image || {};
      if (!img.data) return json({ error: 'No image was sent.' }, 400);
      if (String(img.data).length > 8_000_000) return json({ error: 'That image is too large — please send a screenshot under 5 MB.' }, 413);
      const rr = await callGeminiVision(SLIP_SYSTEM, SLIP_USER, img, 'gemini-3.1-flash-lite', env, 700);
      await logTokens(token, env, 'gemini', rr, 'topup_ocr');
      /* Instant activation is decided HERE, never in the browser.
         The balance is derived from approved top-ups, so a client that could
         mark its own row approved could mint money — which is why the RLS
         policy lets a user insert nothing but `pending`. The credit therefore
         has to be written by something the user does not control: this
         function, with the service key, against fields it read itself off the
         image. If the service key is not configured the slip simply goes to
         the approval queue as before, so this can fail closed but never
         open. */
      const credit = await maybeCreditSlip(rr.text, user, env, img);
      return json({ text: rr.text, model: rr.model, usage: { in: rr.in, out: rr.out },
        match: credit.match, credited: credit.credited, topUpId: credit.id,
        reason: credit.reason, confirmBy: credit.confirmBy, beneficiary: credit.beneficiary,
        flags: credit.flags, risk: credit.risk });
    }
    const prompt = action === 'chat' ? buildChatPrompt(question, messages) : buildExplainPrompt(question);
    const r = await run(prompt, 'tutor');
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
async function logTokens(token, env, provider, r, feature) {
  if (!r || (!r.in && !r.out)) return;
  try {
    await sb('/rest/v1/rpc/log_ai_tokens', env, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify({ p_provider: provider, p_model: r.model || 'unknown', p_input: r.in | 0, p_output: r.out | 0, p_feature: feature || 'tutor' })
    });
  } catch {}
}

/* ---------------- OSCE marking ---------------- */

/* The calibration every OSCE marking shares. Without it a model marks like a
   generous colleague: it recognises the topic, sees a related sentence, and
   awards the point. A PGIM Part II examiner does not — the marks live in the
   specifics, and a category named without its content is worth half at best.
   The arithmetic is forced rather than left to judgement: each marking point
   is worth an equal share of its question, covered takes the whole share,
   partial takes half, missed takes none. That makes the score reproducible
   and stops "sounded good" becoming full marks. */
const OSCE_CALIBRATION = [
  'YOU ARE A PGIM MD PART II EXAMINER. Mark to that standard, not to encourage.',
  '',
  'HOW TO DECIDE EACH POINT:',
  '  covered — the specific content of the point was actually said: the drug NAMED, the figure GIVEN,',
  '            the test NAMED, the reason STATED. Different words for the same thing are fine.',
  '  partial — the right territory without the substance: the category named but not its content',
  '            ("investigations" without saying which), the drug named without dose/route/timing where the',
  '            point carries it, half a multi-part point, or a correct statement given with no justification',
  '            when the point asks for one.',
  '  missed  — not said, or said wrongly. Saying something adjacent is NOT saying the point.',
  '',
  'HOW THE MARKS FOLLOW:',
  '  Each marking point is worth an EQUAL share of that question\'s marks (marks ÷ number of points).',
  '  covered earns the whole share, partial earns HALF the share, missed earns nothing.',
  '  Add the shares, then round to the nearest 0.5. Never award a question full marks unless every',
  '  point is covered. Never award a point full credit for a partial answer.',
  '',
  'FURTHER EXAMINER RULES:',
  '  A safety-critical omission (a missed drug contraindication, a missed escalation, a missed consent step)',
  '  caps that question at half its marks however much else was said — say so in the comment when you apply it.',
  '  Anything factually wrong or unsafe scores zero for that point and is named in the comment.',
  '  Padding, repetition and confident vagueness earn nothing. Length is not an answer.',
  '  Do not invent credit for points the candidate did not make, and do not withhold credit for correct',
  '  content merely because it was said in unexpected order or plain language.'
].join('\n');


function buildOsceMarkPrompt(body) {
  const st = body.station || {};
  const answers = body.answers || [];
  const qs = (st.questions || []).map(q => {
    const said = (answers.find(a => String(a.id) === String(q.id)) || {}).transcript || '';
    return [
      `Q${q.id} (${q.marks} marks): ${q.prompt}`,
      // the candidate had this in front of them; a question about a trace they
      // could see is not marked as though they were describing it from memory
      ...(q.shown ? [`SHOWN ON SCREEN: ${q.shown}`] : []),
      'Marking points:',
      ...(q.marking_points || []).map((p, i) => `  ${i + 1}. ${p}`),
      'CANDIDATE SAID: ' + (said.trim() ? said.trim() : '(nothing was said)')
    ].join('\n');
  }).join('\n\n');

  const system = PERSONA + ' You are marking a spoken OSCE station from a transcript. The candidate SPOKE, so ' +
    'the text is informal and may contain false starts, filler and speech-to-text errors. Mark the CLINICAL ' +
    'CONTENT, never the phrasing; a near-miss word that is obviously the intended term ("magnesium" for MgSO4) ' +
    'counts as said.\n\n' + OSCE_CALIBRATION;

  const user = [
    `STATION: ${st.topic || ''} — total ${st.total_marks || 50} marks, pass mark ${st.pass_mark || ''}.`,
    `SCENARIO: ${st.scenario || ''}`,
    '',
    qs,
    '',
    'Return ONLY valid JSON, no prose and no code fence, exactly this shape:',
    '{"questions":[{"id":1,"awarded":0,"max":5,"share":0,"points":[{"point":"<the marking point verbatim>",' +
      '"status":"covered|partial|missed","credit":0,"note":"<one short clause: what they said, or what was missing>"}],' +
      '"comment":"<one sentence: the verdict, and name any cap you applied>"}],' +
      '"total":0,"max":50,"percent":0,"pass":false,' +
      '"examinerComment":"<3-4 sentences: the overall verdict on this performance>",' +
      '"strengths":["<what was genuinely good>"],' +
      '"improvements":[{"action":"<what to do differently>","marks":0}],' +
      '"keyLearning":["<the facts to carry away>"],' +
      '"structure":{"coverage":"<did they answer what was asked>","fluency":"<pace, hesitancy, clarity>",' +
      '"safety":"<were the safety-critical points made>"}}',
    'Every marking point of every question must appear exactly once in its question\'s points array.',
    '"share" is marks divided by the number of marking points for that question.',
    '"credit" is the marks that point earned: the full share if covered, half the share if partial, 0 if missed.',
    'awarded must equal the sum of that question\'s credits, rounded to the nearest 0.5, and total the sum of awarded.'
  ].join('\n');
  return { system, user };
}

/* Marking straight from the tape: transcribe AND mark in one call. */
function buildOsceAudioPrompt(body) {
  const st = body.station || {};
  const qs = (st.questions || []).map(q => [
    `Q${q.id} (${q.marks} marks): ${q.prompt}`,
    ...(q.shown ? [`SHOWN ON SCREEN: ${q.shown}`] : []),
    'Marking points:',
    ...(q.marking_points || []).map((p, i) => `  ${i + 1}. ${p}`)
  ].join('\n')).join('\n\n');

  const system = PERSONA + ' You are marking a SPOKEN OSCE station from the candidate\'s own recording. ' +
    'The audio is one continuous take covering every question in order; the candidate moved on when they had ' +
    'finished the previous one. First work out what they said for each question, then mark the CLINICAL CONTENT ' +
    'against the scheme. Ignore filler, false starts and self-correction — mark the position they settled on.\n\n' +
    /* The recording may carry BOTH voices: the questions are read aloud by a
       synthetic examiner voice through the device speaker and the microphone
       hears them. Those words are the question, not the answer, and crediting
       them would hand the candidate marks for being read the scheme. */
    'TWO VOICES MAY BE AUDIBLE. The examiner\'s questions are read aloud by a synthetic voice and the microphone ' +
    'may have picked them up. Anything spoken in that voice is the QUESTION being asked — its wording appears ' +
    'below, so you can recognise it. Credit ONLY what the candidate says in their own voice. If a marking point is ' +
    'audible solely in the examiner\'s voice, it was not said by the candidate and earns nothing.\n\n' +
    OSCE_CALIBRATION;

  const user = [
    `STATION: ${st.topic || ''} — total ${st.total_marks || 50} marks, pass mark ${st.pass_mark || ''}.`,
    `SCENARIO: ${st.scenario || ''}`,
    '',
    qs,
    '',
    'Listen to the recording, then return ONLY valid JSON, no prose and no code fence, exactly this shape:',
    '{"questions":[{"id":1,"awarded":0,"max":5,"share":0,"transcript":"<what they actually said for this question>",' +
      '"points":[{"point":"<the marking point verbatim>","status":"covered|partial|missed","credit":0,' +
      '"note":"<one short clause: what they said, or what was missing>"}],' +
      '"comment":"<one sentence: the verdict, and name any cap you applied>"}],' +
      '"total":0,"max":50,"percent":0,"pass":false,' +
      '"examinerComment":"<3-4 sentences: the overall verdict on this performance>",' +
      '"strengths":["<what was genuinely good>"],' +
      '"improvements":[{"action":"<what to do differently>","marks":0}],' +
      '"keyLearning":["<the facts to carry away>"],' +
      '"structure":{"coverage":"<did they answer what was asked>",' +
      '"fluency":"<pace, hesitancy, filler, clarity — you can HEAR this, so be specific>",' +
      '"safety":"<were the safety-critical points made>"}}',
    'Every marking point of every question must appear exactly once in that question\'s points array.',
    'If nothing was said for a question, set its transcript to "" and mark every point missed.',
    '"share" is marks divided by the number of marking points for that question.',
    '"credit" is the marks that point earned: the full share if covered, half the share if partial, 0 if missed.',
    'awarded must equal the sum of that question\'s credits, rounded to the nearest 0.5, and total the sum of awarded.'
  ].join('\n');
  return { system, user };
}

/* A candidate talking to the model about the report it just wrote. The whole
   station is NOT resent — only the marking the conversation is about, which
   keeps a five-message exchange cheaper than the marking itself was. */
function buildOsceChatPrompt(body) {
  const st = body.station || {};
  const r = body.result || {};
  const weak = (r.questions || []).map((q, i) =>
    `Q${i + 1} (${q.awarded}/${q.max}): ${String(q.prompt || '').slice(0, 200)}\n` +
    `  missed/partial: ${(q.points || []).filter(p => !/cover/i.test(p.status || ''))
      .map(p => p.point).slice(0, 8).join('; ') || '(none)'}`).join('\n');
  const convo = (body.messages || []).slice(-10)
    .map(m => `${m.role === 'user' ? 'Candidate' : 'Examiner'}: ${String(m.content).slice(0, 1500)}`).join('\n');
  return {
    system: PERSONA + ' You are debriefing a candidate on an OSCE station you have just marked. ' +
      'Answer what they ask, at Part II depth, and stay honest about what they missed — do not soften a mark to be kind.',
    user: `Station: ${st.topic || ''}\nScenario: ${String(st.scenario || '').slice(0, 600)}\n` +
      `Result: ${r.total}/${r.max} (${r.percent}%), pass mark ${st.pass_mark ?? '—'} — ${r.pass ? 'passed' : 'below the pass mark'}.\n` +
      `Examiner's verdict: ${String(r.examinerComment || '').slice(0, 700)}\n\n` +
      `Where the marks went:\n${weak.slice(0, 6000)}\n\n` +
      `Conversation so far:\n${convo}\n\n` +
      `Answer the candidate's latest message. Be concrete and cite the guideline by name where one applies. Under 250 words unless they ask for more.`
  };
}

/** One audio track + the scheme. Gemini only — it takes audio inline and is by far the cheapest at it. */
async function callGeminiAudio(prompt, audio, model, env, maxTokens) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured on the server.');
  const key = String(env.GEMINI_API_KEY).trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: audio.mime || 'audio/webm', data: audio.data } },
        { text: prompt.user }
      ] }],
      generationConfig: { maxOutputTokens: maxTokens || 9000, temperature: 0.2, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Could not mark the recording (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const u = data?.usageMetadata || {};
  return { text, model, in: u.promptTokenCount | 0, out: u.candidatesTokenCount | 0 };
}

/** One audio track + the scheme, on OpenAI.
    OpenAI takes audio as an `input_audio` content part, but only as wav or
    mp3 — it will not read the webm/opus a browser records. The client has
    therefore already decoded and re-encoded the tape (see OSCE.toWav); all
    this has to do is name the format it was given. */
async function callOpenAIAudio(prompt, audio, format, model, env, maxTokens) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server.');
  const cap = Math.max(2048, maxTokens || 9000);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.OPENAI_API_KEY },
    body: JSON.stringify({
      model, max_completion_tokens: cap,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: [
          { type: 'input_audio', input_audio: { data: audio.data, format: format === 'mp3' ? 'mp3' : 'wav' } },
          { type: 'text', text: prompt.user }
        ] }
      ]
    })
  });
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json())?.error?.message || ''; } catch {}
    // the commonest cause by far is a text-only model id, so say so
    throw new Error(`Could not mark the recording on GPT (HTTP ${res.status})${detail ? ': ' + detail : ''}. `
      + 'If this model does not accept audio, clear its "audio" flag in config.js and mark from the transcript.');
  }
  const data = await res.json();
  const partsOf = c => {
    const v = c?.message?.content;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : (x?.text || ''))).join('');
    return '';
  };
  const text = (data.choices || []).map(partsOf).join('') || '';
  if (!text) throw new Error('GPT listened to the recording but returned no marks. Try again, or mark from the transcript.');
  return { text, model: data.model || model, in: data.usage?.prompt_tokens || 0, out: data.usage?.completion_tokens || 0 };
}

/* ---------------- payment slip ---------------- */

const SLIP_SYSTEM = 'You read bank payment receipts and return data. Return only JSON.';
/* The slip is never told which account it OUGHT to name — it is asked to
   report every account number printed on it, and the app does the matching.
   Handing the model the expected number invites it to agree that it saw one,
   which is precisely the thing that must not be guessable when a matching
   slip credits a balance on the spot. */
const SLIP_USER = [
  'Read this bank payment slip / receipt / screenshot and return ONLY this JSON, no prose, no code fence:',
  '{"amount":<number>,"currency":"<LKR|USD|...>","reference":"<the reference or remark the payer typed, often a short number like 00001>",',
  '"payee":"<who was paid / the biller or account>","date":"<YYYY-MM-DD or empty>","bank":"<bank name or empty>",',
  '"txnId":"<the bank\'s own transaction/reference number>","status":"<e.g. Successfully Completed, or empty>",',
  '"accountTo":"<the destination / beneficiary / credited account number, digits exactly as printed>",',
  '"accountFrom":"<the paying / debited account number if shown, digits exactly as printed>",',
  '"accounts":["<every account number printed anywhere on the slip, digits exactly as printed>"],',
  '"time":"<the time of the transaction as printed, or empty>",',
  '"docType":"<bank_pdf|bank_app_screenshot|photo_of_screen|photo_of_paper|other>",',
  '"tamper":["<each visible sign that this document has been edited: a figure in a different font, weight or size ',
  'from its neighbours; digits not sitting on the same baseline; a patch of different background or sharpness ',
  'around a number; misaligned columns; a smudged or doubled character; a logo that looks pasted; spacing that ',
  'breaks the pattern of the rest of the page. List only what you can actually SEE — an empty list is the right ',
  'answer for a clean document>"],',
  '"confidence":<0-1, how sure you are this is a genuine completed payment slip>}',
  'Copy account numbers digit for digit, including any leading zeros, and never invent or complete one that is masked.',
  'If a field is not visible use "" (or 0 for amount, [] for accounts and tamper). Do not guess an amount that is not printed.'
].join('\n');

/* ---------------- instant activation of a matching slip ----------------

   Four things have to be true before a payment credits itself: it names the
   beneficiary account, it has an amount, it has a date, and its reference is
   the payer's own user number. All four are read off the image by this
   function, so none of them can be supplied by the caller.

   The account is compared as digits with leading zeros stripped, because the
   same account is printed as 0087612781 by one bank and 87612781 by another.
   Nothing else is normalised — a different number is a different account.

   The credit is real but PROVISIONAL: it spends immediately and carries the
   deadline by which the developer confirms it against the bank statement.  */

const onlyDigits = s => String(s == null ? '' : s).replace(/\D/g, '');
const acctKey = s => onlyDigits(s).replace(/^0+/, '');
/** The same user number the client shows the payer, derived the same way. */
function userNumberOf(user) {
  return (onlyDigits(user?.id).slice(-5) || '00001').padStart(5, '0');
}

/* ---------------- is this slip genuine? ----------------

   Be clear about what this can and cannot do. NOTHING in an image proves a
   payment happened. A determined forger with an hour and a PDF editor will
   produce something that passes every check below, and the only real
   verification is the bank statement — which is exactly why an auto-credit
   is provisional and lands in the developer's queue to be confirmed.

   What these checks do is raise the cost of forgery from "change a number in
   a PDF" to something that takes real effort, and cap the damage when one
   gets through. They are ordered by how much they are worth:

     1. AMOUNT CEILING. The single most valuable control. A forgery that
        succeeds is worth at most one small top-up, and anything larger
        waits for a human. No cleverness required.
     2. PDF STRUCTURE. A bank's PDF is written once by a server library and
        never touched again. Editing one almost always leaves a second
        %%EOF (an incremental save), a ModDate later than the CreationDate,
        or the name of the editing tool in /Producer. This catches the
        casual forger reliably and costs nothing.
     3. THE SLIP'S OWN CLAIMS. It must say the transfer succeeded, be in
        rupees, be recent, and carry a transaction id — that last one is
        also what makes it reconcilable and de-duplicable.
     4. VISIBLE TAMPERING. The reader is asked what looks edited. A useful
        signal, not evidence; a clean answer means nothing on its own.
     5. RATE LIMITS. Even if all of the above is beaten, only so much can be
        auto-credited in a day.                                            */

const PDF_EDITORS = /acrobat|illustrator|photoshop|indesign|gimp|inkscape|canva|ilovepdf|smallpdf|pdfescape|sejda|foxit|nitro|pdf-?xchange|libreoffice|microsoft word|quartz|preview|skia|wkhtmltopdf|chromium|puppeteer/i;

/** What a PDF says about how it was made. Metadata is ASCII, so latin1 is enough. */
function analysePdf(b64) {
  let raw = '';
  try { raw = atob(String(b64 || '').slice(0, 6_000_000)); } catch { return { isPdf: false }; }
  if (!raw.startsWith('%PDF')) return { isPdf: false };
  /* A PDF string may contain escaped parentheses — the real BOC slip's
     producer is "iText® Core 8.0.5 \(AGPL version\) ©2000-2024 Apryse Group
     NV" — so stopping at the first ")" truncates it mid-name and would make
     a producer allowlist match the wrong thing. */
  const grab = key => {
    const m = raw.match(new RegExp('\\/' + key + '\\s*\\(((?:\\\\.|[^)\\\\]){0,300})\\)'));
    return m ? m[1].replace(/\\([()\\])/g, '$1') : '';
  };
  const created = grab('CreationDate'), modified = grab('ModDate');
  const producer = grab('Producer'), creator = grab('Creator');
  // an incremental save appends a second body and trailer to the original
  const eofCount = (raw.match(/%%EOF/g) || []).length;
  return {
    isPdf: true, producer, creator, created, modified, eofCount,
    // same format ("D:YYYYMMDDHHmmss…"), so a string compare is a date compare
    resaved: !!(created && modified && modified > created),
    editorHit: PDF_EDITORS.test(producer + ' ' + creator)
  };
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A date the slip printed, as a timestamp, or null. Accepts D-M-Y and Y-M-D. */
function slipDate(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
}

/** Everything that argues against crediting this on sight. */
function screenSlip(f, pdf, cfg) {
  const flags = [];
  const add = (level, text) => flags.push({ level, text });

  const status = String(f.status || '');
  if (!status) add('block', 'The slip does not say the transfer completed.');
  else if (!/success|complete|paid|approved|accepted|done/i.test(status))
    add('block', `The slip's status reads "${status}", not a completed transfer.`);

  const cur = String(f.currency || '').toUpperCase();
  if (cur && cur !== 'LKR') add('block', `The slip is in ${cur}, not rupees.`);

  const txn = String(f.txnId || '').trim();
  if (txn.length < 6) add('block', 'The slip carries no transaction number, so it cannot be reconciled or checked for duplicates.');

  const when = slipDate(f.date);
  const maxAge = Number(cfg.maxAgeDays) > 0 ? Number(cfg.maxAgeDays) : 7;
  if (when == null) add('block', 'No transfer date could be read.');
  else if (when > Date.now() + 36e5 * 30) add('block', 'The transfer date is in the future.');
  else if (Date.now() - when > maxAge * 864e5) add('block', `The transfer is more than ${maxAge} days old.`);

  const amount = Number(f.amount) || 0;
  const ceiling = Number(cfg.autoMax) > 0 ? Number(cfg.autoMax) : 5000;
  if (amount > ceiling) add('block', `Amounts over LKR ${ceiling.toLocaleString('en-LK')} are always checked by the site owner.`);

  if (Number(f.confidence ?? 1) < 0.5) add('block', 'This does not read like a completed payment slip.');

  (Array.isArray(f.tamper) ? f.tamper : []).slice(0, 6)
    .forEach(t => add('block', 'Looks edited: ' + String(t).slice(0, 160)));

  if (pdf.isPdf) {
    if (pdf.editorHit) add('block', `The PDF was written by ${pdf.producer || pdf.creator} — a bank's own slip is not produced by an editing tool.`);
    if (pdf.eofCount > 1) add('block', 'The PDF has been saved more than once — banks generate a slip and never touch it again.');
    if (pdf.resaved) add('block', 'The PDF was modified after it was created.');
    const want = String(cfg.pdfProducer || '').trim();
    if (want && !pdf.producer.toLowerCase().includes(want.toLowerCase()))
      add('block', `The PDF was not produced by ${want}, which is what this bank's slips are made with.`);
  } else if (String(f.docType || '') === 'photo_of_paper') {
    add('warn', 'A photograph of a printout — harder to check than the bank\'s own PDF.');
  }

  return { flags, blocked: flags.some(x => x.level === 'block'),
    risk: flags.some(x => x.level === 'block') ? 'high' : flags.length ? 'medium' : 'low' };
}

async function walletSettings(env) {
  try {
    const res = await sb(`/rest/v1/app_config?id=eq.wallet&select=data`, env,
      { headers: { Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } });
    const rows = await res.json();
    return rows?.[0]?.data || {};
  } catch { return {}; }
}

async function maybeCreditSlip(text, user, env, image) {
  const off = { credited: false, match: null };
  let f = null;
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { f = JSON.parse(raw); } catch {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) { try { f = JSON.parse(raw.slice(a, b + 1)); } catch {} }
  }
  if (!f) return off;

  const w = await walletSettings(env);
  const account = String(env.BENEFICIARY_ACCOUNT || w.beneficiary?.account || BENEFICIARY_FALLBACK).trim();
  const hours = Number(w.instantHours) > 0 ? Number(w.instantHours) : 24;
  const myNo = userNumberOf(user);
  /* Look for the account on the RECEIVING side. `accounts` is the safety net
     for a slip the reader labelled loosely, but a slip whose SENDER is this
     account is money going the other way, so that disqualifies it however it
     was labelled. */
  const onSlip = [f.accountTo, f.payee, ...(Array.isArray(f.accounts) ? f.accounts : [])];
  const want = acctKey(account);
  const fromKey = acctKey(f.accountFrom);
  const match = {
    account: !!want && fromKey !== want && onSlip.some(v => acctKey(v) && acctKey(v) === want),
    amount: Number(f.amount) > 0,
    date: !!String(f.date || '').trim(),
    reference: onlyDigits(f.reference) === onlyDigits(myNo) && !!onlyDigits(myNo)
  };
  /* What the slip is made of, and what it claims — worked out here so that
     the answer is the same whether or not the credit goes through, and so
     that the developer sees it on every row in the queue. */
  const pdf = analysePdf(image?.data);
  const screen = screenSlip(f, pdf, w);
  const slipHash = image?.data ? await sha256Hex(image.data) : '';
  const forensics = {
    hash: slipHash, risk: screen.risk, flags: screen.flags,
    docType: f.docType || '', tamper: f.tamper || [],
    pdf: pdf.isPdf ? { producer: pdf.producer, creator: pdf.creator, eofCount: pdf.eofCount,
      created: pdf.created, modified: pdf.modified, resaved: pdf.resaved, editorHit: pdf.editorHit } : null
  };
  const out = { credited: false, match, beneficiary: account || null,
    risk: screen.risk, flags: screen.flags };

  if (!account) return Object.assign(out, { reason: 'no-account' });
  if (w.instantActivation === false) return Object.assign(out, { reason: 'off' });
  if (!Object.values(match).every(Boolean)) return Object.assign(out, { reason: 'incomplete' });
  if (!env.SUPABASE_SERVICE_KEY) return Object.assign(out, { reason: 'not-configured' });

  const svc = { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, apikey: env.SUPABASE_SERVICE_KEY };
  const already = async q => {
    const r = await sb(`/rest/v1/credit_topups?${q}&select=id&limit=1`, env, { headers: svc });
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  };

  /* The same payment must not be credited twice — and the checks are ACROSS
     ALL USERS, not just this one. Scoped to a single account, a slip that had
     already been used could simply be re-uploaded from a second account.
     Three independent keys, because a forger only has to defeat one:
       • the bank's transaction number,
       • the file itself, byte for byte,
       • the reference, amount and date together. */
  try {
    const txn = String(f.txnId || '').trim();
    const keys = [];
    if (txn) keys.push(`extracted->>txnId=eq.${encodeURIComponent(txn)}`);
    if (slipHash) keys.push(`extracted->>hash=eq.${slipHash}`);
    keys.push(`user_id=eq.${user.id}&amount_lkr=eq.${Number(f.amount)}` +
      `&extracted->>date=eq.${encodeURIComponent(String(f.date || ''))}` +
      `&reference=eq.${encodeURIComponent(String(f.reference || ''))}`);
    for (const k of keys) if (await already(k)) return Object.assign(out, { reason: 'duplicate', duplicate: true });
  } catch { /* a failed duplicate check must not block a genuine payment */ }

  // reported after the duplicate check, because "you have already used this
  // slip" is the more useful answer when both are true
  if (screen.blocked) return Object.assign(out, { reason: 'screened' });

  /* A ceiling on how much can be credited without a human in one day, so a
     forgery that beats everything above is still worth very little. */
  try {
    const since = new Date(Date.now() - 864e5).toISOString();
    const r = await sb(`/rest/v1/credit_topups?user_id=eq.${user.id}&created_at=gte.${since}` +
      `&extracted->>provisional=eq.true&select=amount_lkr`, env, { headers: svc });
    const rows = await r.json();
    if (Array.isArray(rows)) {
      const maxADay = Number(w.autoPerDay) > 0 ? Number(w.autoPerDay) : 3;
      const capADay = Number(w.autoDayMax) > 0 ? Number(w.autoDayMax) : 10000;
      const sum = rows.reduce((n, x) => n + (Number(x.amount_lkr) || 0), 0);
      if (rows.length >= maxADay || sum + Number(f.amount) > capADay) {
        return Object.assign(out, { reason: 'day-limit' });
      }
    }
  } catch { /* likewise */ }

  const confirmBy = Date.now() + hours * 3600e3;
  /* Keep the slip on the row. The developer has to be able to LOOK at what
     was auto-credited — an unverifiable auto-credit is worse than no
     auto-credit — so the image travels with it, under the same size limit
     the manual path uses. */
  let slip = null;
  if (image?.data) {
    const url = `data:${image.mime || 'image/jpeg'};base64,${image.data}`;
    if (url.length < 900_000) slip = url;
    else forensics.slipTooLarge = true;
  }
  try {
    const res = await sb('/rest/v1/credit_topups', env, {
      method: 'POST',
      headers: Object.assign({ Prefer: 'return=representation' }, svc),
      body: JSON.stringify({
        user_id: user.id, amount_lkr: Number(f.amount), reference: String(f.reference || myNo),
        status: 'approved', slip,
        note: `Auto-credited: slip named the account, ${Number(f.amount)} on ${f.date}, reference ${f.reference}. Awaiting confirmation against the bank.`,
        extracted: Object.assign({}, f, forensics, { matched: match, beneficiary: account, provisional: true, confirmBy })
      })
    });
    if (!res.ok) return Object.assign(out, { reason: 'insert-failed' });
    const rows = await res.json();
    return Object.assign(out, { credited: true, id: rows?.[0]?.id, confirmBy });
  } catch { return Object.assign(out, { reason: 'insert-failed' }); }
}

/** One image + a short instruction. Used only for payment slips. */
async function callGeminiVision(system, user, image, model, env, maxTokens) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured on the server.');
  const key = String(env.GEMINI_API_KEY).trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: image.mime || 'image/jpeg', data: image.data } },
        { text: user }
      ] }],
      generationConfig: { maxOutputTokens: maxTokens || 400, temperature: 0, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Could not read the slip (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const u = data?.usageMetadata || {};
  return { text, model, in: u.promptTokenCount | 0, out: u.candidatesTokenCount | 0 };
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
// Paper architect: translate the candidate's search words into the exact
// vocabulary of the bank's AI tags, strict JSON out.
function buildTermMapPrompt(body) {
  const terms = (body.terms || []).slice(0, 12);
  const vocab = (body.vocabulary || []).slice(0, 250);
  return {
    system: PERSONA + ' You map exam-revision search terms onto an index vocabulary. You output ONLY a valid JSON object, no code fences.',
    user: `Index vocabulary (topics and keywords that actually exist in the question bank):\n${vocab.join('; ')}\n\n` +
      `Candidate's search terms:\n${terms.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n` +
      `For EACH term, list the 1-5 vocabulary entries (verbatim from the list above) that mean the same thing — expand abbreviations ` +
      `(e.g. "magsulphate" → magnesium sulphate entries, "PIH" → pregnancy-induced hypertension entries). Only use entries from the vocabulary. ` +
      `Return: {"<term exactly as given>": ["entry", …], …} — an empty array if nothing fits.`
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

// null when the id is retired for new API keys (Google's July 2026 line-up:
// 3.1 Flash-Lite / 3.5 Flash / 3.1 Pro) — callers substitute the default.
function modernGemini(m) {
  if (!m) return null;
  if (/^gemini-(1|2)[.\-]/.test(m) || m === 'gemini-3-flash') return null;
  return m;
}

async function callGemini(system, user, model, env, restricted, maxTokens, strict) {
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
  // STRICT mode (platform batch jobs): exactly the configured model or a
  // clear error — never a silent substitute. The fallback chain once
  // escalated a failing 2.5-flash request to gemini-flash-latest, which
  // Google resolved to 3.5 Flash at ~5x the price; billing was honest but
  // the model choice wasn't. Interactive calls keep fallbacks for
  // resilience (restricted users only onto baseline-priced models).
  const models = strict
    ? [modernGemini(model) || 'gemini-3.1-flash-lite']
    : restricted
      ? [modernGemini(model) || 'gemini-3.1-flash-lite', 'gemini-3.5-flash']
      : [modernGemini(model) || 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
  const tried = new Set();
  let lastErr = 'unknown error';
  let noThink = false;    // set when a model rejects thinkingConfig → retry bare
  const queue = [...models];
  while (queue.length) {
    const m = queue.shift();
    if (tried.has(m)) continue; tried.add(m);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`;
    let res, data;
    // Batch jobs (tagging) return long JSON — too small a cap silently
    // truncates the JSON mid-array, which is unparseable downstream.
    const gc = { temperature: 0.4, maxOutputTokens: maxTokens || 1400 };
    // COST CONTROL: modern Gemini models "think" by DEFAULT and every hidden
    // thinking token is billed as OUTPUT (this once multiplied real costs
    // ~30×). Nothing on this site needs hidden reasoning: 2.x gets thinking
    // OFF (thinkingBudget) and 3.x gets the minimum level (thinkingLevel —
    // the two fields must not be mixed). If a model rejects the field
    // (e.g. a lite variant that never thinks), we retry it once without.
    if (!noThink) {
      if (/^gemini-2\.5/.test(m)) gc.thinkingConfig = { thinkingBudget: 0 };
      else if (/^gemini-3/.test(m)) gc.thinkingConfig = { thinkingLevel: 'low' };
    }
    try {
      res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: gc
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
    // model rejected the thinking field → retry the SAME model once without
    if (!noThink && gc.thinkingConfig && /thinking/i.test(lastErr)) {
      noThink = true; tried.delete(m); queue.unshift(m);
      continue;
    }
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
async function callClaude(system, user, model, env, maxTokens) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model || 'claude-haiku-4-5-20251001', max_tokens: maxTokens || 1200, system, messages: [{ role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`Claude error (HTTP ${res.status}). Check ANTHROPIC_API_KEY.`);
  const data = await res.json();
  const text = (data.content || []).map(b => b.text).join('') || '';
  if (!text) throw new Error('Claude returned an empty response.');
  // True token counts from Anthropic's own meter.
  return { text, model: data.model || model || 'claude-haiku-4-5',
    in: data.usage?.input_tokens || 0, out: data.usage?.output_tokens || 0 };
}

/**
 * OpenAI (GPT). Uses the Chat Completions shape, which every current GPT
 * model accepts. Like the other providers we return the API's OWN token
 * counts — OpenAI reports usage.prompt_tokens / completion_tokens but NOT a
 * dollar figure, so cost is computed from the site's price table.
 */
/**
 * Reconcile a hand-typed blueprint specific_area against the AI tag
 * vocabulary already attached to the bank. Typos, British/US spellings and
 * loose phrasing all mean a hand-written area can silently match nothing —
 * this maps it onto wording the bank actually uses.
 */
/**
 * Search terms a candidate could usefully take to Google: the guideline, the
 * named trial, the condition. Kept deliberately short so it is a cheap call.
 */
function buildSearchTermsPrompt(body) {
  const q = body.question || {};
  return {
    system: 'You suggest precise web-search terms for postgraduate O&G revision. Reply with STRICT JSON only.',
    user: `Question topic: ${q.theme || ''}\n${String(q.stem || '').slice(0, 700)}\n` +
      `Correct answer: ${(q.options || [])[q.answer] || ''}\nRationale: ${String(body.rationale || q.rationale || '').slice(0, 500)}\n\n` +
      `Return JSON: {"terms":[{"q":"<search phrase>","why":"<max 8 words>","kind":"guideline|trial|topic|drug"}]}\n` +
      `6 to 8 entries. Prefer NAMED guidelines (RCOG Green-top number, NICE NG number), named trials, and the exact clinical entity. No generic phrases.`
  };
}

function buildAreaMatchPrompt(body) {
  const typed = String(body.text || '').slice(0, 300);
  const bucket = String(body.bucket || '').slice(0, 200);
  const vocab = (body.tags || []).slice(0, 400).map(t => String(t).slice(0, 90));
  return {
    system: 'You align exam-blueprint topic labels to an existing tag vocabulary for an O&G question bank. Reply with STRICT JSON only, no prose, no code fences.',
    user: `A developer typed this specific_area for the blueprint bucket "${bucket}":\n"${typed}"\n\n` +
      `The question bank is tagged with this vocabulary:\n${vocab.join('\n')}\n\n` +
      `Return JSON exactly:\n` +
      `{"corrected":"<the typed text with spelling/grammar fixed, same meaning, O&G house style>",` +
      `"matches":[{"tag":"<vocabulary entry>","confidence":<0-1>,"why":"<max 12 words>"}],` +
      `"suggested":"<the single best wording to store, either the corrected text or a vocabulary entry>",` +
      `"note":"<max 20 words: whether the bank actually covers this, or a warning if nothing matches>"}\n` +
      `List at most 6 matches, best first, only genuine ones. If nothing matches, return an empty matches array and say so in note.`
  };
}

async function callOpenAI(system, user, model, env, maxTokens) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server.');
  // max_completion_tokens covers REASONING as well as visible output on the
  // current GPT line. A small cap therefore gets spent thinking and returns an
  // empty message — which is exactly what "GPT returned an empty response"
  // was. Give it real headroom; we still pay only for what it uses.
  const cap = Math.max(2048, maxTokens || 4096);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: model || 'gpt-5.6-luna',
      max_completion_tokens: cap,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`GPT error (HTTP ${res.status})${detail ? ': ' + detail : '. Check OPENAI_API_KEY and the model id.'}`);
  }
  const data = await res.json();
  // content may be a plain string or an array of parts depending on the model
  const partsOf = c => {
    const v = c?.message?.content;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : (x?.text || ''))).join('');
    return '';
  };
  const text = (data.choices || []).map(partsOf).join('') || '';
  if (!text) {
    const why = data.choices?.[0]?.finish_reason;
    const reasoned = data.usage?.completion_tokens_details?.reasoning_tokens;
    throw new Error(why === 'length'
      ? `GPT hit its ${cap}-token ceiling before writing an answer${reasoned ? ` (${reasoned} spent reasoning)` : ''}. Try a shorter study aid, or raise the cap.`
      : `GPT returned no content${why ? ` (finish_reason: ${why})` : ''}.`);
  }
  return { text, model: data.model || model || 'gpt',
    in: data.usage?.prompt_tokens || 0, out: data.usage?.completion_tokens || 0 };
}
