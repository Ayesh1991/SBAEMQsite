/* ============================================================
   aiosce.js — OSCE in AI.

   WHAT THIS IS

   A station, sat out loud, against a chat model acting as the examiner —
   on the other half of a split-screen iPad. AUREUM does not talk to the
   model here. It hands you the prompt, holds the clock, records the room,
   and takes the verdict back afterwards.

   WHY IT IS BUILT THAT WAY, AND NOT AS AN API CALL

   The site already has a live examiner that speaks through the server, so
   the obvious move is another server action. It would be worse. What is
   wanted is a fifteen-minute spoken conversation with a model that pushes
   back, follows an answer where it goes, and teaches at the end — and the
   thing that does that best is the chat application itself, with its own
   voice mode, its own memory of the conversation, and no round trip
   through us on every turn. Trying to reimplement that through a text
   endpoint would produce a worse examiner at a higher cost.

   So the split is honest about who does what:

     · the model runs the examination      (in its own app, from our prompt)
     · AUREUM runs the clock and the tape  (the two things the model cannot do)
     · the model marks it                  (it has the scheme; it was there)
     · AUREUM keeps the result             (beside every other attempt)

   THE PROMPT IS THE PRODUCT

   Everything that makes this a PGIM Part II station rather than a chat
   about obstetrics lives in the prompt: ask the written questions and no
   others, one at a time; reveal what is meant to be revealed when it is
   meant to be revealed; prompt only as much as the level says; and say
   NOTHING evaluative until the candidate calls time. That last rule is
   the one a model breaks by instinct — it wants to be helpful after every
   answer — so it is stated three times, in three places, deliberately.

   THE RECORDING IS OURS

   Whatever happens in the other app, the tape belongs here: the same
   recorder as every other station, the same 24-hour server copy, the same
   Drive copy, and the same route into AI marking. So even a session whose
   JSON never comes back is not a session that vanished.

   MARKED BY CLAUDE IS AN ORDINARY ATTEMPT

   The imported verdict becomes an attempt with source:'claude' and the
   same shape the manual sheet and the AI marker produce. Which means the
   report page, the printout, the progress tab and the blueprint coverage
   all work on it without knowing it exists — the same rule the Created
   OSCE bank follows, for the same reason.
   ============================================================ */

const AiOsce = (() => {
  'use strict';

  const cfg = () => window.AUREUM_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* Developer-only today, with a flag so it can be handed to others from
     user management later without touching this file. */
  function allowed(user) {
    if (!user) return false;
    if (user.email && cfg().developer && user.email === cfg().developer.email) return true;
    if (sessionStorage.getItem('aureum-dev') === '1') return true;
    return !!user.featureFlags?.aiosce;
  }

  /* ---------------- the three marks ----------------
     Drawn rather than fetched: an <img> to a logo on somebody else's CDN is
     a request that can fail, a layout that can jump, and a file to keep. */
  const LOGOS = {
    claude: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.4c.36 0 .66.28.7.64l.42 4.2 2.5-3.05a.71.71 0 0 1 1.22.7l-1.72 3.86 3.66-2.1a.71.71 0 0 1 .86 1.1l-3.05 2.5 4.2.42a.71.71 0 0 1 0 1.4l-4.2.42 3.05 2.5a.71.71 0 0 1-.86 1.1l-3.66-2.1 1.72 3.86a.71.71 0 0 1-1.22.7l-2.5-3.05-.42 4.2a.71.71 0 0 1-1.4 0l-.42-4.2-2.5 3.05a.71.71 0 0 1-1.22-.7l1.72-3.86-3.66 2.1a.71.71 0 0 1-.86-1.1l3.05-2.5-4.2-.42a.71.71 0 0 1 0-1.4l4.2-.42-3.05-2.5a.71.71 0 0 1 .86-1.1l3.66 2.1-1.72-3.86a.71.71 0 0 1 1.22-.7l2.5 3.05.42-4.2c.04-.36.34-.64.7-.64Z"/></svg>`,
    gpt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M12 3.6 17.2 6.6v6l-5.2 3-5.2-3v-6z"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M6.8 12.6 12 9.6l5.2 3M12 9.6V3.6M12 15.6v4.8"/></svg>`,
    gemini: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c.3 4.9 5.1 9.7 10 10-4.9.3-9.7 5.1-10 10-.3-4.9-5.1-9.7-10-10 4.9-.3 9.7-5.1 10-10Z"/></svg>`
  };
  const MODELS = [
    { id: 'claude', name: 'Claude', where: 'claude.ai', voice: true,
      note: 'Voice mode, and a project whose instructions hold the examiner rules for every station.' },
    { id: 'gpt', name: 'ChatGPT', where: 'chatgpt.com', voice: true,
      note: 'Voice mode works; paste the prompt into a new chat each time.' },
    { id: 'gemini', name: 'Gemini', where: 'gemini.google.com', voice: true,
      note: 'Live voice works; paste the prompt into a new chat each time.' }
  ];

  /* ---------------- prompting level ----------------
     The same 0–100 dial the built-in examiner uses, so "35" means the same
     thing wherever you are sitting. Expressed to the model as behaviour,
     not as a number — a number it would interpret freely. */
  const LEVEL_KEY = 'aureum.osce.aiprompt';
  const levelOf = () => {
    const raw = localStorage.getItem(LEVEL_KEY);
    if (raw == null || raw === '') return 35;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 35;
  };
  const setLevel = n => { try { localStorage.setItem(LEVEL_KEY, String(n)); } catch {} };

  function levelText(n) {
    if (n <= 5) return 'NEVER prompt. Ask the question, then wait in silence however long the candidate takes. If they stop, say only "Anything else?" once, and accept whatever follows. This is the real exam.';
    if (n <= 25) return 'Prompt very rarely. Only after a full 8–10 seconds of silence, and only with a neutral opener such as "Anything else?" or "Go on." Never name a topic the candidate has not raised.';
    if (n <= 50) return 'Prompt sparingly. After about 5 seconds of silence you may give ONE neutral nudge, and if a whole area of the scheme is untouched you may point at the AREA — "What about the investigations?" — but never at the answer itself.';
    if (n <= 75) return 'Prompt helpfully. Nudge after a few seconds of silence, name the area that is missing, and if the candidate is clearly stuck rephrase the question once. Still never state a marking point for them.';
    return 'Prompt generously — this is a teaching run, not an exam. Nudge freely, name the missing areas, rephrase, and offer the first half of a point to see whether they can finish it. Say clearly at the start that this is a coached run.';
  }

  /* ================= the prompt =================

     Written to be pasted whole into a new chat, or kept once in a project's
     instructions with only the station changing. Both are supported because
     both are how it will really be used: a project for the rules, a paste
     for the case. */

  function rulesBlock(level) {
    return `You are an examiner in the PGIM (Sri Lanka) MD Part II OSCE in Obstetrics and
Gynaecology. You are not a tutor, a chatbot or an assistant during the examination.
You are a senior examiner sitting opposite a candidate for fifteen minutes.

HOW THE STATION RUNS

1. Open by reading the SCENARIO below out loud, word for word, then say
   "Take a moment, then tell me when you are ready."
2. Ask the questions in QUESTIONS below, in order, ONE AT A TIME.
   Ask each one substantially as written. You may shorten a long question
   for speech, but you must not change what it asks.
3. NEVER invent a question that is not in the list. If the candidate finishes
   every question with time left, go deeper on answers they gave — "you
   mentioned X, take me through that" — using the marking points as the map.
   Deeper is allowed. New is not.
4. Where a question carries REVEAL, say that information out loud immediately
   before asking that question, and not one moment earlier.
5. Keep to the clock. Divide the fifteen minutes roughly in proportion to the
   marks. If a question is running long, say "Let us move on" and move on.

PROMPTING — the level for this run is ${level}/100

${levelText(level)}

SILENCE IS NOT AN EMERGENCY. A candidate who is thinking is working. Do not
fill the gap because it feels awkward.

WHAT YOU MUST NOT DO DURING THE FIFTEEN MINUTES

· Do not say whether an answer is right, wrong, good, partial or complete.
· Do not say "correct", "exactly", "not quite", "hmm", "good", or any other
  evaluative word. Acknowledge with "Thank you" or "Right" and move on.
· Do not teach, correct, add or supply information.
· Do not reveal or read out the marking scheme.
· Do not give marks, running totals, or hints about how it is going.

You will want to be encouraging. Do not. An examiner who signals approval
tells the candidate which answers were the good ones, and the whole point of
this is that they find out afterwards instead.

HOW IT ENDS

The candidate will say "fifteen minutes over" (or you will see the time is up).
At that moment the examination stops and you change role completely: from
examiner to teacher. Only then do you give:

  1. The marks, question by question, against the marking scheme.
  2. What they said well — specifically, quoting them.
  3. What they missed — every marking point they did not reach, in full.
  4. The corrections: anything they said that was wrong or out of date.
  5. The teaching: the underlying knowledge, properly explained, so the gaps
     close rather than merely being listed.
  6. Their examination technique — structure, signposting, pace, whether they
     answered the question that was asked.

Be exacting here. A comfortable mark helps nobody sitting a real exam.`;
  }

  function jsonBlock(st) {
    return `AFTER the teaching, produce ONE JSON file so the result can be imported
back into AUREUM and kept beside their other attempts. Output it in a single
fenced code block, valid JSON, nothing after it.

{
  "schema": "aureum-osce-claude-v1",
  "station_id": ${JSON.stringify(st.id || '')},
  "topic": ${JSON.stringify(st.topic || '')},
  "sat_on": "YYYY-MM-DD",
  "examiner": "Claude",
  "result": {
    "total": 0, "max": ${OSCE.marksOf(st)}, "percent": 0, "pass": false,
    "examinerComment": "Two or three sentences, as an examiner would write them.",
    "questions": [
      { "id": "Q1", "awarded": 0, "max": 0,
        "transcript": "What the candidate actually said, in brief.",
        "comment": "Your comment on this answer.",
        "points": [
          { "point": "the marking point, copied exactly from the scheme",
            "status": "covered | partial | missed",
            "note": "what they said about it, or what was missing" }
        ] }
    ],
    "strengths": ["specific, quoting them"],
    "improvements": [{ "action": "what to do differently", "marks": 0 }],
    "keyLearning": ["the facts to take away"],
    "teaching": [{ "heading": "topic", "body": "the explanation you gave" }],
    "language": [{ "said": "what they said", "correct": "what to say", "why": "why" }],
    "coaching": { "structure": "", "articulation": "", "pronunciation": "", "technique": "" }
  }
}

RULES FOR THE JSON

· One object per marking point, for EVERY point in the scheme, in scheme order.
· "point" must be the scheme's own wording, not a paraphrase.
· "awarded" per question must sum to "total", and "max" per question to the
  station's ${OSCE.marksOf(st)}.
· "percent" is round(total / max × 100). "pass" is total ≥ ${OSCE.passOf(st)}.
· Never leave a marks field null or 0-by-omission — if a point was missed,
  status is "missed" and the marks reflect it.`;
  }

  function stationBlock(st) {
    const qs = OSCE.qsOf(st);
    return `THE STATION

TOPIC: ${st.topic || ''}
TIME: ${OSCE.minsOf(st)} minutes · ${OSCE.marksOf(st)} marks · pass mark ${OSCE.passOf(st)}

SCENARIO (read this out loud, word for word)
${st.scenario || ''}

QUESTIONS — ask these, in this order, and no others.

${qs.map((q, i) => {
      const pts = OSCE.scorable(q.marking_points);
      const heads = (q.marking_points || []).filter(p => OSCE.isHeading(p));
      return [
        `Q${i + 1} (${q.marks} marks): ${q.prompt}`,
        q.reveal_before ? `  REVEAL FIRST — say this out loud before asking: ${q.reveal_before}` : '',
        (q.images || []).length ? `  ON SCREEN: the candidate is looking at ${(q.images || []).map(im => im.caption || 'an image').join(', ')}. Ask them to describe it.` : '',
        heads.length ? `  Sections in this scheme: ${heads.map(h => OSCE.headText(h)).join(' · ')}` : '',
        '  MARKING POINTS (yours alone — never read these out):',
        ...pts.map((p, j) => `    ${j + 1}. ${p}`)
      ].filter(Boolean).join('\n');
    }).join('\n\n')}`;
  }

  /** The whole thing, for pasting into a fresh chat. */
  function buildPrompt(st, level) {
    return [
      rulesBlock(level),
      '',
      stationBlock(st),
      '',
      jsonBlock(st),
      '',
      `BEGIN NOW. Say only: "This is a ${OSCE.minsOf(st)}-minute station. I will read you the scenario."`,
      `Then read the scenario and wait. Nothing else before that.`
    ].join('\n');
  }

  /** The rules alone, as a project instruction file — the station is pasted per run. */
  function buildInstructions(level) {
    return `# AUREUM — PGIM Part II OSCE examiner

Paste this into the **instructions** of a Claude project (or a custom GPT /
Gem). Then, for each station, paste only the station block that AUREUM gives
you and the examination begins.

---

${rulesBlock(level)}

---

## The station

Each run begins with the candidate pasting a block headed **THE STATION**,
containing the topic, the time, the scenario, the questions in order, any
information to be revealed part-way, and the marking points for your eyes
only. Everything above applies to it unchanged.

## The JSON at the end

After the teaching, produce one JSON file in a single fenced code block,
following the schema \`aureum-osce-claude-v1\` exactly as given in the
station block. It is imported back into AUREUM and kept beside the
candidate's other attempts, so the marking-point wording must be the
scheme's own and the marks must add up.
`;
  }

  /* ================= the button and the dialog ================= */

  function buttonHtml() {
    return `<button class="btn btn-ai" id="os-aiosce" type="button">
      <span class="ai-marks">${LOGOS.claude}${LOGOS.gpt}${LOGOS.gemini}</span>
      <span>OSCE in AI</span>
    </button>`;
  }

  function openDialog(st, opts) {
    document.querySelector('.ai-modal')?.remove();
    const level = levelOf();
    const wrap = document.createElement('div');
    wrap.className = 'ai-modal';
    wrap.innerHTML = `
      <div class="ai-modal-back" data-close></div>
      <div class="ai-modal-box" role="dialog" aria-modal="true" aria-label="OSCE in AI">
        <div class="ai-modal-head">
          <div>
            <p class="kicker">OSCE IN AI</p>
            <h3>${esc(st.topic || '')}</h3>
          </div>
          <button class="os-modal-x" data-close aria-label="Close">✕</button>
        </div>

        <div class="ai-modal-body">
          <p class="muted">The model examines you in its own app on the other half of the screen. AUREUM holds the
            clock and records the room, then takes the marking back. Nothing is sent from here — you carry the prompt
            across yourself.</p>

          <div class="ai-pick" id="ai-pick">
            ${MODELS.map((m, i) => `
              <button class="ai-pick-b ${i === 0 ? 'active' : ''}" data-model="${m.id}">
                <span class="ai-mark">${LOGOS[m.id]}</span>
                <b>${m.name}</b>
                <span class="muted tiny">${esc(m.where)}</span>
              </button>`).join('')}
          </div>
          <p class="muted tiny" id="ai-note">${esc(MODELS[0].note)}</p>

          <label class="ai-lvl">
            <span>How much should it prompt you? <b id="ai-lvl-n">${level}</b></span>
            <input type="range" id="ai-lvl" min="0" max="100" step="5" value="${level}">
            <span class="muted tiny" id="ai-lvl-t">${esc(levelText(level))}</span>
          </label>

          <div class="ai-acts">
            <button class="btn btn-gold" id="ai-copy">📋 Copy the prompt</button>
            <button class="btn btn-ghost" id="ai-md">⬇ Project instructions (.md)</button>
            <button class="btn btn-ghost" id="ai-station">📄 Station block only</button>
          </div>
          <p class="muted tiny">Use <strong>Copy the prompt</strong> for a one-off chat. Use the
            <strong>.md</strong> once, in a Claude project's instructions, and then only the
            <strong>station block</strong> each time — it is far shorter, so the conversation has more room.</p>
          <div id="ai-msg" class="ai-msg"></div>
        </div>

        <div class="ai-modal-foot">
          <span class="muted tiny">Paste it, start voice mode, then come back and start the clock.</span>
          <button class="btn btn-primary" id="ai-go">Start the clock and record →</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    let picked = MODELS[0].id;
    let lvl = level;
    const msg = wrap.querySelector('#ai-msg');
    const say = (t, cls) => { msg.innerHTML = `<span class="${cls || 'good'}">${esc(t)}</span>`; };

    const shut = () => { wrap.remove(); window.removeEventListener('hashchange', shut); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') shut(); };
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', shut));
    window.addEventListener('hashchange', shut);
    document.addEventListener('keydown', onKey);

    wrap.querySelector('#ai-pick').addEventListener('click', e => {
      const b = e.target.closest('[data-model]'); if (!b) return;
      picked = b.dataset.model;
      wrap.querySelectorAll('.ai-pick-b').forEach(x => x.classList.toggle('active', x === b));
      wrap.querySelector('#ai-note').textContent = MODELS.find(m => m.id === picked).note;
    });

    const slider = wrap.querySelector('#ai-lvl');
    slider.addEventListener('input', () => {
      lvl = Number(slider.value); setLevel(lvl);
      wrap.querySelector('#ai-lvl-n').textContent = lvl;
      wrap.querySelector('#ai-lvl-t').textContent = levelText(lvl);
    });

    const copy = async (text, what) => {
      try { await navigator.clipboard.writeText(text); say('✓ ' + what + ' copied — paste it into ' + MODELS.find(m => m.id === picked).where); }
      catch { say('This browser would not let the page copy. Long-press the prompt in the box that just opened.', 'bad'); showFallback(wrap, text); }
    };
    wrap.querySelector('#ai-copy').addEventListener('click', () => copy(buildPrompt(st, lvl), 'The whole prompt'));
    wrap.querySelector('#ai-station').addEventListener('click', () => copy(stationBlock(st) + '\n\n' + jsonBlock(st), 'The station block'));
    wrap.querySelector('#ai-md').addEventListener('click', () => {
      const md = buildInstructions(lvl);
      const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'AUREUM_OSCE_examiner_instructions.md';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say('✓ Downloaded — paste it into the project’s instructions once, and use “Station block only” from then on.');
    });

    wrap.querySelector('#ai-go').addEventListener('click', () => {
      shut();
      location.hash = '#/osce/ai/' + encodeURIComponent(st.id) + (opts?.sid ? '?s=' + encodeURIComponent(opts.sid) : '');
    });
  }

  /* Clipboard access is refused in more situations than people expect —
     an iPad in a saved-to-home-screen window being one. A textarea the
     reader can select from is not elegant, but it always works. */
  function showFallback(wrap, text) {
    const host = wrap.querySelector('#ai-msg');
    const ta = document.createElement('textarea');
    ta.className = 'ai-fallback'; ta.rows = 8; ta.value = text;
    host.appendChild(ta); ta.focus(); ta.select();
  }

  /* ================= the live session (#/osce/ai/:id) =================

     AUREUM's half of the split screen. Deliberately almost empty: a clock,
     a recording light, and one button. Anything else here is something to
     look at instead of the examiner.

     The clock counts DOWN, unlike the station runner's, because the thing
     you need to know while talking to another app is how long is left, and
     because the candidate is the one who has to call time — the model
     cannot see a timer. */

  async function session(view, id, user, sid) {
    if (!allowed(user)) {
      view.innerHTML = `<section class="page"><div class="card"><h3 class="card-title">Not turned on for this account</h3>
        <p class="muted">OSCE in AI is being tried out before it is offered to everyone.</p>
        <a class="link" href="#/osce">← Back to the stations</a></div></section>`;
      return;
    }
    view.innerHTML = `<section class="page"><p class="muted">Loading the station…</p></section>`;
    let st = null;
    try { st = await Backend.getOsceStation(id); } catch {}
    if (!st) { view.innerHTML = `<section class="page"><p class="muted">That station is not here. <a class="link" href="#/osce">Back</a></p></section>`; return; }

    const total = OSCE.minsOf(st) * 60;
    let left = total, running = false, timer = null, live = null, tape = null;

    view.innerHTML = `
      <section class="page ai-run">
        <a class="link muted dev-back" href="#/osce/station/${encodeURIComponent(st.id)}">← Leave without recording</a>
        <header data-animate>
          <p class="kicker">OSCE IN AI · ${OSCE.minsOf(st)} MINUTES · ${OSCE.marksOf(st)} MARKS</p>
          <h1 class="page-title">${esc(st.topic || '')}</h1>
        </header>

        <div class="card ai-clock-card" data-animate>
          <div class="ai-clock" id="ai-clock">${fmt(total)}</div>
          <div class="ai-bar"><i id="ai-bar" style="width:0%"></i></div>
          <div id="ai-mic" class="ai-mic"></div>
          <div class="ai-run-acts">
            <button class="btn btn-gold btn-lg" id="ai-start">● Start the clock and record</button>
            <button class="btn btn-ghost" id="ai-pause" hidden>⏸ Pause</button>
            <button class="btn btn-primary" id="ai-stop" hidden>■ Stop — fifteen minutes over</button>
          </div>
          <p class="muted tiny" id="ai-tip">Paste the prompt into the model first and start its voice mode. Then press
            start here — the recording and the clock begin together. When the clock reaches zero, say
            <strong>“fifteen minutes over”</strong> out loud so the examiner switches to teaching.</p>
        </div>

        <div id="ai-after"></div>
      </section>`;
    FX.viewIn(view);

    const clockEl = view.querySelector('#ai-clock');
    const barEl = view.querySelector('#ai-bar');
    const startB = view.querySelector('#ai-start');
    const pauseB = view.querySelector('#ai-pause');
    const stopB = view.querySelector('#ai-stop');
    const after = view.querySelector('#ai-after');

    function paint() {
      clockEl.textContent = fmt(left);
      clockEl.classList.toggle('is-out', left <= 0);
      clockEl.classList.toggle('is-low', left > 0 && left <= 60);
      barEl.style.width = Math.min(100, ((total - left) / total) * 100) + '%';
    }

    startB.addEventListener('click', async () => {
      startB.disabled = true; startB.textContent = 'Opening the microphone…';
      /* wantMix: the model is talking through the iPad speaker, so the tape
         only carries the examiner if echo cancellation can be relaxed. It
         is a preference — a tape of one voice still marks. */
      live = OSCE.makeCapture(view.querySelector('#ai-mic'), true);
      const ok = await live.start();
      if (!ok) {
        startB.disabled = false; startB.textContent = '● Start the clock and record';
        return;
      }
      running = true;
      startB.hidden = true; pauseB.hidden = false; stopB.hidden = false;
      view.querySelector('#ai-tip').innerHTML =
        'Recording. Switch to the other app and answer out loud — this half only has to stay open.';
      timer = setInterval(() => {
        if (!running) return;
        left--;
        paint();
        /* At zero the recording keeps running, because the teaching that
           follows is the part worth keeping most. */
        if (left === 0) {
          clockEl.classList.add('is-out');
          view.querySelector('#ai-tip').innerHTML =
            '<strong>Time. Say “fifteen minutes over” out loud now.</strong> Keep recording through the feedback — that is the part you will want to hear again.';
          try { navigator.vibrate?.([200, 100, 200]); } catch {}
        }
        if (left <= -20 * 60) finish();      // a session nobody stopped
      }, 1000);
      paint();
    });

    pauseB.addEventListener('click', () => {
      running = !running;
      pauseB.textContent = running ? '⏸ Pause' : '▶ Resume';
      try { running ? live?.resume() : live?.pause(); } catch {}
    });

    stopB.addEventListener('click', finish);

    async function finish() {
      if (!live) return;
      running = false; clearInterval(timer); timer = null;
      stopB.disabled = true; pauseB.hidden = true;
      stopB.textContent = 'Saving the recording…';
      try { tape = await live.stop(); } catch { tape = null; }
      live = null;
      await keep(st, tape, user, after, sid);
      stopB.hidden = true;
    }

    window.addEventListener('hashchange', function off() {
      window.removeEventListener('hashchange', off);
      clearInterval(timer);
      try { live?.stop(); } catch {}
    });
  }

  const fmt = n => {
    const neg = n < 0, a = Math.abs(n);
    return (neg ? '+' : '') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  };

  /* ---------------- what happens to the tape ----------------

     The same two destinations as every other recording — 24 hours on the
     server, and Drive if it is connected — reached through the same code,
     so nothing here can drift from the station runner. Then the three
     things worth offering: send it to be marked by our own marker, keep
     the audio, or paste back what the model said. */

  async function keep(st, tape, user, host, sid) {
    host.innerHTML = `<div class="card" data-animate><p class="muted">Storing the recording…</p></div>`;
    let stored = null;
    /* The id is minted BEFORE the upload, because the storage path is built
       from it — the tape and the attempt it belongs to have to agree on a
       name before either exists. */
    const attemptId = rid('oc');
    if (tape?.blob) {
      try { stored = await Backend.uploadOsceAudio(attemptId, tape.blob); } catch {}
      if (typeof Drive !== 'undefined' && Drive.on()) {
        try { await Drive.upload(tape.blob, Drive.nameFor('AI OSCE — ' + (st.topic || ''), Date.now(), tape.ext || 'webm'), {}); } catch {}
      }
    }
    host.innerHTML = `
      <div class="card" data-animate>
        <h3 class="card-title">${tape?.blob ? '✓ The session is recorded' : 'Nothing was recorded'}</h3>
        ${tape?.blob ? `<audio controls src="${esc(tape.url)}" class="ai-audio"></audio>
          <p class="muted tiny">${stored ? 'Kept on the server for 24 hours' : 'Kept in this browser only — the upload did not go through'}${
            typeof Drive !== 'undefined' && Drive.on() ? ', and copied to your Drive folder' : ''}.
            ${tape.bothVoices === false ? 'Only your voice is on it — this device would not let go of echo cancellation.' : ''}</p>
          <p><a class="btn btn-ghost btn-sm" href="${esc(tape.url)}" download="${esc((st.topic || 'osce').replace(/[^\w -]/g, '')) }.${esc(tape.ext || 'webm')}">⬇ Download the audio</a></p>`
          : `<p class="muted">The microphone never started, so there is no tape. The model's own marking can still be
             imported below — it does not need the audio.</p>`}
      </div>

      <div class="card" data-animate>
        <h3 class="card-title">Bring the marking back</h3>
        <p class="muted">The examiner ends by printing a JSON block. Paste it here — or drop the file in your Drive
          folder and scan — and it becomes an attempt like any other, in <strong>Marked by Claude</strong>.</p>
        <div id="ai-import"></div>
      </div>`;
    importPanel(host.querySelector('#ai-import'), st, user, sid, { id: attemptId, audio: stored });
  }

  /* ================= marked by Claude =================

     The model has the scheme, it was present for the answers, and it has
     just spent five minutes teaching from them — so its verdict is worth
     keeping. It arrives as JSON and becomes an attempt with
     source:'claude'. Everything downstream — the report, the printout,
     progress, the blueprint — then works on it unchanged, because it is
     the same shape as every other attempt. */

  const SCHEMA = 'aureum-osce-claude-v1';

  function validate(d, st) {
    const e = [];
    if (!d || typeof d !== 'object') return ['That is not a JSON object.'];
    if (d.schema && d.schema !== SCHEMA) e.push(`This says schema "${d.schema}" — expected "${SCHEMA}".`);
    const r = d.result;
    if (!r || typeof r !== 'object') { e.push('There is no "result" block.'); return e; }
    if (!Array.isArray(r.questions) || !r.questions.length) e.push('"result.questions" is missing or empty.');
    const n = v => (v == null || v === '' ? NaN : Number(v));
    if (!Number.isFinite(n(r.total))) e.push('"result.total" is missing or is not a number.');
    if (!Number.isFinite(n(r.max)) || n(r.max) <= 0) e.push('"result.max" is missing, zero or not a number.');
    (r.questions || []).forEach((q, i) => {
      if (!Number.isFinite(n(q.awarded))) e.push(`Question ${i + 1}: "awarded" is missing or is not a number.`);
      if (!Array.isArray(q.points)) e.push(`Question ${i + 1}: "points" is missing.`);
    });
    /* A verdict for a different station is the failure most worth catching:
       it would import cleanly and quietly attach itself to the wrong topic. */
    if (st && d.station_id && String(d.station_id) !== String(st.id))
      e.push(`This marking is for station "${d.station_id}", not "${st.id}".`);
    return e;
  }

  function toAttempt(d, st, user, audio, id) {
    const r = d.result || {};
    const num = v => Number(v) || 0;
    const max = num(r.max) || OSCE.marksOf(st);
    const total = num(r.total);
    return {
      id: id || rid('oc'),
      station_id: st.id,
      station: { topic: st.topic, scenario: st.scenario,
        total_marks: OSCE.marksOf(st), pass_mark: OSCE.passOf(st) },
      bp: (typeof OsceBlueprint !== 'undefined') ? (OsceBlueprint.tagOf(st) || null) : null,
      questions: OSCE.qsOf(st),
      answers: (r.questions || []).map(q => ({ id: q.id, transcript: q.transcript || '' })),
      created: Date.now(),
      /* Not 'ai': that word already means our own marker, and the billing
         and the averages both split on it. This one costs us nothing and
         was marked somewhere else. */
      source: 'claude',
      examiner: { name: d.examiner || 'Claude', email: '' },
      candidate: { name: user?.name || '', userNo: user?.userNo || '' },
      audioPath: audio?.path || null,
      audioExpires: audio?.expires || null,
      satOn: d.sat_on || null,
      result: Object.assign({}, r, {
        max, total,
        percent: r.percent != null ? num(r.percent) : Math.round((total / Math.max(1, max)) * 100),
        pass: r.pass != null ? !!r.pass : total >= OSCE.passOf(st)
      })
    };
  }

  function importPanel(host, st, user, sid, ctx) {
    if (!host) return;
    host.innerHTML = `
      <div class="ai-imp-acts">
        <button class="btn btn-gold btn-sm" id="ai-imp-paste">📋 Paste the JSON</button>
        <button class="btn btn-ghost btn-sm" id="ai-imp-file">📄 From a file</button>
        ${cfg().drive?.claudeMarkFolderId && cfg().drive?.apiBase
          ? `<button class="btn btn-ghost btn-sm" id="ai-imp-scan">🔍 Scan the Drive folder</button>` : ''}
        <input type="file" id="ai-imp-input" accept=".json,application/json" hidden>
      </div>
      <div class="ai-imp-box" id="ai-imp-box" hidden>
        <textarea id="ai-imp-text" rows="8" spellcheck="false"
          placeholder='Paste the whole JSON block the examiner printed'></textarea>
        <button class="btn btn-gold btn-sm" id="ai-imp-add">Check and keep it</button>
      </div>
      <div id="ai-imp-out"></div>`;

    const out = host.querySelector('#ai-imp-out');
    const box = host.querySelector('#ai-imp-box');
    const say = h => { out.innerHTML = h; };

    async function take(raw, where) {
      let d;
      try { d = typeof raw === 'string' ? JSON.parse(stripFence(raw)) : raw; }
      catch (err) { say(`<p class="bad">${esc(where)}: that is not valid JSON — ${esc(err.message || err)}</p>`); return; }
      const errs = validate(d, st);
      if (errs.length) { say(`<div class="os-made-bad"><p class="bad"><b>Not imported.</b></p>
        <ul>${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`); return; }
      say('<p class="muted">Keeping it…</p>');
      try {
        const a = toAttempt(d, st, user, ctx?.audio, ctx?.id);
        await Backend.saveOsceAttempt(a);
        OSCE.bustAttempts?.();
        say(`<p class="good">✓ Kept — ${a.result.total}/${a.result.max} (${a.result.percent}%).
          <a class="link" href="#/osce/result/${encodeURIComponent(a.id)}">Open the report →</a></p>`);
      } catch (err) { say(`<p class="bad">${esc(err.message || err)}</p>`); }
    }

    host.querySelector('#ai-imp-paste').addEventListener('click', () => {
      box.hidden = !box.hidden; if (!box.hidden) host.querySelector('#ai-imp-text').focus();
    });
    host.querySelector('#ai-imp-add').addEventListener('click', () =>
      take(host.querySelector('#ai-imp-text').value, 'Pasted JSON'));
    const input = host.querySelector('#ai-imp-input');
    host.querySelector('#ai-imp-file').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const f = (input.files || [])[0]; input.value = '';
      if (f) await take(await f.text(), f.name);
    });

    host.querySelector('#ai-imp-scan')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true; say('<p class="muted">Reading the folder…</p>');
      try {
        const fid = cfg().drive.claudeMarkFolderId;
        const res = await fetch(`${cfg().drive.apiBase}?action=list&folderId=${encodeURIComponent(fid)}`, { cache: 'no-cache' });
        const list = await res.json();
        const files = (list.files || []).filter(f => /\.json$/i.test(f.name || ''));
        if (!files.length) { say('<p class="muted">No JSON files in that folder yet.</p>'); return; }
        say(`<div class="ai-imp-files">${files.map((f, i) =>
          `<button class="btn btn-ghost btn-sm" data-fid="${esc(f.id)}">${esc(f.name)}</button>`).join('')}</div>`);
        out.addEventListener('click', async ev => {
          const fb = ev.target.closest('[data-fid]'); if (!fb) return;
          const r = await fetch(`${cfg().drive.apiBase}?action=file&id=${encodeURIComponent(fb.dataset.fid)}`);
          await take(await r.text(), fb.textContent);
        });
      } catch (err) { say(`<p class="bad">${esc(err.message || err)}</p>`); }
      finally { b.disabled = false; }
    });
  }

  /* Models fence their JSON. Taking the first fenced block, or failing that
     the first {...}, saves the reader from trimming it by hand on an iPad. */
  function stripFence(raw) {
    const t = String(raw || '');
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return fence[1];
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    return (a >= 0 && b > a) ? t.slice(a, b + 1) : t;
  }

  return {
    allowed, buttonHtml, openDialog, buildPrompt, buildInstructions,
    stationBlock, rulesBlock, jsonBlock, levelOf, setLevel, levelText, LOGOS, MODELS,
    session, validate, toAttempt, importPanel, stripFence, SCHEMA
  };
})();
