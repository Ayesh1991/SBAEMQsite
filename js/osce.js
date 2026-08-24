/* ============================================================
   osce.js — spoken OSCE stations.

   A station is one 15-minute viva: a scenario, then six or so
   questions worth 50 marks in total, with a marking scheme behind
   each. Source JSON is `ogr-osce-v1` (the shape the station files
   already use), published by the developer like papers and CPD.

   How a station runs
     1. BRIEF   — the scenario, on screen, untimed. The examiner's
        reading allowance is shown as guidance, not enforced: you
        press "Start the station" when you have read it.
     2. STATION — the 15-minute clock starts, the microphone starts,
        and question 1 appears. You SPEAK your answer; "Next" moves
        on. The clock never stops for the questions — that is the
        point of the exercise.
     3. DEBRIEF — the recording is offered as a download, every
        answer is transcribed on screen, and the whole thing can be
        marked against the scheme.

   Speech
     The live transcript uses the browser's own recogniser, which
     costs nothing. The audio is captured separately by MediaRecorder
     so you always get the tape even where recognition is unavailable
     (older Safari) — and where it is, the transcript is editable
     before marking, because no recogniser is perfect on drug names.

   Pausing
     Real life interrupts. Pause stops the clock and the recorder;
     resume continues both. The station's state (elapsed, answers,
     transcripts) is saved after every step, so closing the tab and
     coming back resumes where you were — the audio, which cannot
     survive a reload, starts a fresh track and is offered separately.
   ============================================================ */

const OSCE = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cfg = () => window.AUREUM_CONFIG || {};
  const KEY = 'osce-stations';
  const TTL = 15 * 60 * 1000;

  /* ---------------- data ---------------- */

  async function stations() {
    const loader = () => Backend.getOsceStations().then(r => r || []);
    const list = (typeof Cache !== 'undefined')
      ? await Cache.wrap(KEY, TTL, loader, { keepIfEmptied: true })
      : await loader();
    return list.slice().sort((a, b) => String(a.topic || '').localeCompare(String(b.topic || '')));
  }
  function bustStations() { if (typeof Cache !== 'undefined') Cache.bust(KEY); }
  /* The bank list holds CARDS — no questions, no marking points — so opening
     the tab costs a few KB however big the bank grows. A station's questions
     are fetched only when that station is actually opened. */
  const fullCache = new Map();
  async function station(id) {
    if (fullCache.has(id)) return fullCache.get(id);
    let st = null;
    try { st = await Backend.getOsceStation(id); } catch {}
    if (!st) st = (await stations().catch(() => [])).find(x => x.id === id) || null;
    if (st) fullCache.set(id, st);
    return st;
  }
  /* ---------------- collections (the bins a station lives in) ----------------
     A station's bin is one string in its record, so filing costs nothing and
     needs no migration. The list of bins is developer-editable and stored
     alongside the other app config; config.js holds the ones every
     deployment starts with. Anything published before bins existed has no
     `collection` and shows as Unfiled until it is moved. */
  const COLL_KEY = 'osce-collections';
  const UNFILED = { id: '', label: 'Unfiled' };
  let _colls = null;
  async function collections() {
    if (_colls) return _colls;
    const fallback = (cfg().osce?.collections || []).slice();
    try {
      const saved = (typeof Cache !== 'undefined')
        ? await Cache.wrap(COLL_KEY, TTL, () => Backend.getOsceCollections(), { keepIfEmptied: true })
        : await Backend.getOsceCollections();
      _colls = (saved && saved.length) ? saved : fallback;
    } catch { _colls = fallback; }
    return _colls;
  }
  function bustCollections() { _colls = null; if (typeof Cache !== 'undefined') Cache.bust(COLL_KEY); }
  const collLabel = (list, id) => (list.find(c => c.id === id) || (id ? { label: id } : UNFILED)).label;

  /* ---------------- images on a question ----------------
     A CTG, a partogram, a scan. The FILES live in storage — the question
     carries a path and a URL, never the bytes, so a station full of pictures
     costs the bank list exactly nothing. Older stations imported from JSON
     may carry a bare URL instead, which works the same way.

     They are shown at a readable size and open full-screen on a click,
     because half of what a CTG station tests is whether you can actually
     read the trace. */
  const imagesOf = q => (q.images || []).map(im => ({
    url: im.url || (typeof Backend !== 'undefined' && Backend.osceImageUrl ? Backend.osceImageUrl(im.path) : im.path) || '',
    caption: im.caption || ''
  })).filter(im => im.url);

  function imageStrip(q, cls) {
    const ims = imagesOf(q);
    if (!ims.length) return '';
    return `<div class="os-imgs ${cls || ''} ${ims.length > 1 ? 'is-many' : ''}">
      ${ims.map(im => `
        <figure class="os-img">
          <button class="os-img-b" data-zoom="${esc(im.url)}" data-cap="${esc(im.caption)}"
            aria-label="${esc(im.caption || 'Enlarge the image')}">
            <img src="${esc(im.url)}" alt="${esc(im.caption || 'Image shown with this question')}" loading="lazy">
            <span class="os-img-zoom">⤢</span>
          </button>
          ${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}
        </figure>`).join('')}
    </div>`;
  }

  /** Full-screen, pannable when zoomed. One delegated listener per host. */
  function wireLightbox(host) {
    if (!host || host.dataset.lb === '1') return;
    host.dataset.lb = '1';
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-zoom]'); if (!b) return;
      e.preventDefault();
      document.querySelector('.os-lightbox')?.remove();
      const box = document.createElement('div');
      box.className = 'os-lightbox';
      box.innerHTML = `
        <button class="os-lb-x" aria-label="Close">✕</button>
        <div class="os-lb-stage"><img src="${esc(b.dataset.zoom)}" alt="${esc(b.dataset.cap || '')}"></div>
        ${b.dataset.cap ? `<p class="os-lb-cap">${esc(b.dataset.cap)}</p>` : ''}
        <p class="os-lb-hint">Click the image to zoom · Esc to close</p>`;
      document.body.appendChild(box);
      const img = box.querySelector('img');
      img.addEventListener('click', ev => { ev.stopPropagation(); img.classList.toggle('is-big'); });
      const shut = () => { box.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = ev => { if (ev.key === 'Escape') shut(); };
      document.addEventListener('keydown', onKey);
      box.addEventListener('click', ev => { if (ev.target === box || ev.target.closest('.os-lb-x')) shut(); });
    });
  }

  const qsOf = st => st.questions || [];
  const qCount = st => st.q_count != null ? st.q_count : qsOf(st).length;
  const ptCount = st => st.points_count != null ? st.points_count : qsOf(st).reduce((n, q) => n + (q.marking_points || []).length, 0);
  const marksOf = st => st.total_marks || qsOf(st).reduce((n, q) => n + (q.marks || 0), 0) || 50;
  const passOf = st => st.pass_mark != null ? st.pass_mark
    : Math.round(marksOf(st) * ((st.pass_mark_percent || 70) / 100));
  const minsOf = st => st.station_time_min || 15;

  /** 45 → "45 min", 120 → "2 h", 135 → "2 h 15". */
  const hours = mins => mins < 60 ? mins + ' min'
    : (mins % 60 ? `${Math.floor(mins / 60)} h ${mins % 60}` : `${mins / 60} h`);
  const fmt = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  /* ---------------- the examiner's voice ----------------
     The browser's own speech synthesiser: free, offline, on every platform
     that matters. Hearing the question read out is most of what makes this
     feel like the real thing rather than a form. */
  const VOICE_KEY = 'aureum.osce.voice';
  const voiceOn = () => { try { return localStorage.getItem(VOICE_KEY) !== '0'; } catch { return true; } };
  const setVoiceOn = v => { try { localStorage.setItem(VOICE_KEY, v ? '1' : '0'); } catch {} };

  /* Should the tape carry the examiner as well as the candidate?

     The browser's speech synthesiser gives no audio stream that could be
     mixed into the recording — there is no API for it — so the only way to
     get both voices onto one tape is to let the microphone hear the device
     speaker, which means turning echo cancellation OFF. It works on a phone
     or an iPad speaker; with headphones on there is nothing for the mic to
     hear and only the candidate is recorded.

     The marking prompt is told the examiner may be audible, so nothing said
     in the examiner's voice can be credited to the candidate. */
  /* ---------------- which browser is refusing, and how to fix it ----------------

     iPad Chrome gets the microphone and iPad Safari does not, on the same
     device. Both are WebKit underneath, so this is not an engine limit — it
     is that Chrome asks once at the app level while Safari stores a decision
     PER SITE, and a single "Don't Allow" is remembered forever with no
     further prompt: every call rejects instantly with NotAllowedError.

     Clearing it is not one route. The aA menu shows a Microphone row only
     once the site has asked and only on some versions, so the global setting
     and the nuclear option (delete the site's stored data) both have to be
     offered or somebody is left stuck on a screen telling them to tap
     something that is not there. */
  const iOS = () => /iP(hone|ad|od)/.test(navigator.platform || '')
    || (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
  const iosSafari = () => iOS() && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
  const homeScreenApp = () => !!navigator.standalone
    || (window.matchMedia?.('(display-mode: standalone)').matches && iOS());

  function micHelp() {
    if (homeScreenApp()) {
      return ['This is the Home Screen version of AUREUM, and iOS gives web apps launched from the Home Screen ' +
        'no microphone at all on some versions.',
        'Open aureum in Safari itself (or Chrome) and sit the station there.'];
    }
    if (iosSafari()) {
      return ['Safari remembers a “Don’t Allow” for a site and never asks again, so this has to be cleared by hand. ' +
        'Try these in order — the first that offers a Microphone row is the one your iOS version uses:',
        '1. Tap <strong>aA</strong> at the left of the address bar → <strong>Website Settings</strong> → ' +
          '<strong>Microphone</strong> → <strong>Allow</strong>.',
        '2. If there is no Microphone row there: <strong>Settings</strong> app → <strong>Apps</strong> → ' +
          '<strong>Safari</strong> (on iOS 17 and earlier, just <strong>Settings → Safari</strong>) → ' +
          '<strong>Microphone</strong> → set it to <strong>Ask</strong> or <strong>Allow</strong>.',
        '3. Still stuck: <strong>Settings → Safari → Advanced → Website Data</strong>, find this site and swipe to ' +
          'delete it. That clears the stored refusal — you will have to sign in again.',
        'Then reload the page and tap the button below.'];
    }
    return ['Your browser is blocking the microphone for this site. Open the padlock or the site-settings menu ' +
      'beside the address bar and set Microphone to Allow, then reload and tap the button below.'];
  }

  /* ---------------- Groq: a real voice, and real transcription ----------------

     Two mechanical jobs on a free tier — reading the question aloud, and
     turning the recording into words. Neither marks anything.

     Everything here is written so that losing it costs QUALITY and nothing
     else. One flag turns the whole layer off for the rest of the session the
     moment the quota is hit, and the browser's own synthesiser and recogniser
     carry on exactly as they did before. A station must never depend on a
     free tier being awake. */
  let groqOff = false;                       // a fault that will not fix itself
  /* A quota is not a fault — it ends. Groq says when, so a rate limit now
     stands the layer down until that moment instead of for the whole visit:
     a one-minute ceiling used to cost every remaining question in the
     station. Only a wait long enough to outlast the station is treated as
     the end of it. */
  let groqUntil = 0;
  const groqWaiting = () => groqUntil > Date.now();
  const groqBackIn = () => Math.max(0, Math.ceil((groqUntil - Date.now()) / 1000));
  /* WHY it is not being used, kept and shown. A decommissioned model failed
     silently for a day — the 400 was in Groq's own log and nowhere on screen —
     so the reason now travels with the fallback instead of disappearing. */
  const groqSay = { source: 'browser', why: '', model: '' };
  function groqReport() { return Object.assign({}, groqSay, { off: groqOff || groqWaiting(), backIn: groqBackIn() }); }
  /* Once the developer has pinned a working model, the layer should come back
     without anyone having to reload the page. */
  function resetGroq() { groqOff = false; groqUntil = 0; groqSay.source = 'browser'; groqSay.why = ''; groqSay.model = ''; }

  const groqCfg = () => cfg().ai?.groq || {};
  const groqOn = k => !groqOff && !groqWaiting() && groqCfg().enabled !== false && groqCfg()[k] !== false;

  async function groqCall(body) {
    const token = await Backend.getAccessToken();
    if (!token) { groqSay.why = 'not signed in'; return null; }
    let res, data = {};
    try {
      res = await fetch(cfg().ai.apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      data = await res.json().catch(() => ({}));
    } catch (e) { groqSay.why = 'the network refused'; return null; }
    if (res.ok) { groqSay.why = ''; return data; }
    groqSay.why = data.error || `HTTP ${res.status}`;
    groqSay.model = data.model || '';
    /* A missing grant, a missing key or a retired model will not come back on
       their own, so the layer stands down for the visit. A quota WILL come
       back: it waits out the reset Groq named and then tries again, unless
       the wait is longer than a station, in which case it is over for now. */
    if (res.status === 429) {
      const wait = Number(data.retryAfter) || 0;
      if (wait > 0 && wait <= 20 * 60) groqUntil = Date.now() + wait * 1000;
      else groqOff = true;
    } else if ([403, 503].includes(res.status) || /decommission|not_found|no .* model/i.test(groqSay.why)) {
      groqOff = true;
    }
    return null;
  }

  /** The examiner's line as playable audio, or null to fall back to the browser. */
  async function groqVoice(text) {
    if (!groqOn('voice') || !text) return null;
    const d = await groqCall({ action: 'tts', text, voice: groqCfg().voiceName || '' });
    if (d?.audio) { groqSay.source = 'groq'; groqSay.model = d.model || ''; }
    return d?.audio ? { data: d.audio, mime: d.mime || 'audio/wav' } : null;
  }

  /** The whole station, transcribed. `hint` biases the spelling of drug names. */
  async function groqTranscribe(blob, hint) {
    if (!groqOn('whisper') || !blob) return null;
    const d = await groqCall({ action: 'transcribe', prompt: hint,
      audio: { mime: blob.type || 'audio/webm', data: await toBase64(blob) } });
    return d?.text ? { text: d.text, model: d.model } : null;
  }

  /* ================= the coaching extras =================

     Marks are one thing; how you SOUNDED is another, and the second is
     what a mock examiner tells you afterwards. These are opt-in for two
     honest reasons: each one lengthens the prompt and so costs money, and
     several of them are only answerable when the model has heard the
     recording. Asking for pronunciation feedback on a typed transcript
     would produce something confident and worthless, so those options
     switch themselves off when there is no audio and say why. */

  const COACH_KEY = 'aureum.osce.coach';
  const COACH = [
    { id: 'delivery', label: 'Delivery and structure',
      note: 'Whether you led with the headline, signposted, and finished each answer instead of trailing off.',
      audio: false },
    { id: 'articulation', label: 'Articulation and clarity',
      note: 'Filler words, half-sentences, thinking aloud, and whether an examiner could follow you first time.',
      audio: true },
    { id: 'pronunciation', label: 'Pronunciation of drug and eponym names',
      note: 'Only the ones that cost you credibility in a viva — and how to say them.',
      audio: true },
    { id: 'pace', label: 'Pace, pauses and timing',
      note: 'Rushing, dead air, and how the fifteen minutes were spent across the questions.',
      audio: true },
    { id: 'technique', label: 'Exam technique for the real day',
      note: 'What to do differently in the room: how to open, how to buy thinking time, how to recover a bad start.',
      audio: false }
  ];
  function coachWanted() {
    try {
      const v = JSON.parse(localStorage.getItem(COACH_KEY) || 'null');
      if (Array.isArray(v)) return v;
    } catch {}
    return ['delivery', 'technique'];              // the two that work without audio
  }
  function setCoachWanted(list) { try { localStorage.setItem(COACH_KEY, JSON.stringify(list)); } catch {} }
  /** Which of the chosen ones are actually answerable for this attempt. */
  const coachFor = (wanted, hasAudio) =>
    COACH.filter(c => wanted.includes(c.id) && (hasAudio || !c.audio)).map(c => c.id);

  function coachPicker(hasAudio) {
    const want = coachWanted();
    return `<div class="os-coach">
      <p class="os-coach-h"><strong>Ask for coaching as well as marks</strong>
        <span class="muted tiny">Each one adds a little to the cost. ${hasAudio
          ? 'The recording is going, so all of them can be answered.'
          : 'Without a recording, only the two that read the transcript can be answered.'}</span></p>
      ${COACH.map(c => {
        const off = c.audio && !hasAudio;
        return `<label class="os-coach-o ${off ? 'is-off' : ''}">
          <input type="checkbox" data-coach="${c.id}" ${want.includes(c.id) && !off ? 'checked' : ''} ${off ? 'disabled' : ''}>
          <span><strong>${esc(c.label)}</strong><br><span class="muted tiny">${esc(c.note)}${
            off ? ' — needs the recording, so it is unavailable for this one.' : ''}</span></span>
        </label>`;
      }).join('')}
    </div>`;
  }
  function wireCoachPicker(host) {
    host.querySelectorAll('[data-coach]').forEach(el => el.addEventListener('change', () => {
      const on = [...host.querySelectorAll('[data-coach]')].filter(x => x.checked).map(x => x.dataset.coach);
      setCoachWanted(on);
    }));
  }

  /* ================= copying a station out =================

     The same idea as "Copy question" on an SBA, with one difference that
     matters: what must be LEFT OUT is bigger here. A station's marking
     scheme IS the answer, in full, point by point — pasting it into
     NotebookLM and asking "what should I have said?" would be asking a
     tool to read back the answer sheet.

     So the scheme never goes, and neither does the candidate's own
     transcript: what they said is not the station, and it would steer
     whatever they ask next. What goes is what an examiner would hand a
     candidate — the scenario, the questions, the marks each carries, and
     what an image showed. Enough for another tool to work the station out
     from first principles, which is the point of asking it. */

  function stationAsText(st, opts = {}) {
    const qs = qsOf(st);
    const L = [];
    L.push(`OSCE STATION — ${st.topic || 'untitled'}`);
    L.push(`${minsOf(st)} minutes · ${qs.length} question${qs.length === 1 ? '' : 's'} · ${marksOf(st)} marks in total`);
    L.push('');
    L.push('SCENARIO');
    L.push(String(st.scenario || '').trim());
    L.push('');
    L.push('QUESTIONS');
    qs.forEach((q, i) => {
      L.push('');
      if (q.reveal_before) L.push(`[New information given at this point: ${q.reveal_before}]`);
      L.push(`${i + 1}. ${String(q.prompt || '').trim()}   (${q.marks} marks)`);
      const ims = imagesOf(q);
      if (ims.length) {
        L.push(`   [The candidate is shown ${ims.length === 1 ? 'an image' : ims.length + ' images'}: ${
          ims.map(im => im.caption || 'no caption').join('; ')}]`);
      }
    });
    if (opts.ask !== false) {
      L.push('');
      L.push('---');
      L.push('This is a station from the Sri Lankan PGIM MD Part II (Obstetrics & Gynaecology) OSCE.');
      L.push('The marking scheme has deliberately not been included.');
      L.push('For each question, work out what a full-mark answer would contain at Part II depth,');
      L.push('with the doses, thresholds and time windows that carry the marks, and cite the');
      L.push('RCOG / NICE / SLCOG guidance behind each. Then say which points a candidate is most');
      L.push('likely to miss under time pressure.');
    }
    return L.filter(x => x != null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function copyOut(text, btn, label) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
        ok = document.execCommand('copy'); ta.remove();
      } catch {}
    }
    if (!btn) return ok;
    const was = btn.textContent;
    btn.textContent = ok ? '✓ copied' : '✗ could not copy';
    btn.classList.toggle('is-done', ok);
    setTimeout(() => { if (btn.isConnected) { btn.textContent = label || was; btn.classList.remove('is-done'); } }, 2200);
    return ok;
  }

  /* ================= the prompting examiner =================

     A real examiner does not read a question and go silent for four
     minutes. They wait, and when you stop they push: "anything else?",
     "you have covered the diagnosis — what about the monitoring?". That
     pressure is most of what makes the room feel like the room, and it is
     what the earlier version deliberately removed because a fixed "anything
     further?" after every answer told you, for free, that your answer was
     thin. A probe is only honest if it is EARNED — if there really is a
     marking point you have not said.

     So the engine is built on three ideas:

     1. WHAT IS STILL MISSING IS WORKED OUT LOCALLY. Every marking point is
        matched against the running transcript by token overlap. No model,
        no network, no quota — and it runs on every keystroke without
        costing anything. This is the same rules-first principle as the
        blueprint tagger, and here it also means the probing keeps working
        when Groq is rate-limited.

     2. THE MOMENT IS CHOSEN BY SILENCE, not by a timer. The microphone
        level says when the candidate has stopped talking, which is exactly
        when a real examiner interjects. Probing over someone mid-sentence
        would be worse than not probing at all.

     3. THE LEVEL BUYS FREQUENCY AND SHARPNESS. At the bottom it never
        speaks. In the middle it nudges generically, from a pool of lines
        fetched once per station so a nudge costs nothing. At the top it
        asks about the specific point you have missed, which is the only
        part that needs a model — one small call, and only then.

     A probe never names the answer. "What about monitoring?" is a
     legitimate examiner's push; "you forgot magnesium sulphate" hands over
     the mark. The prompt on the server is explicit about that, and the
     generic pool cannot leak anything by construction. */

  const PROMPT_KEY = 'aureum.osce.promptlevel';
  function promptLevel() {
    try { const n = Number(localStorage.getItem(PROMPT_KEY)); return Number.isFinite(n) && n >= 0 ? Math.min(100, n) : 35; }
    catch { return 35; }
  }
  function setPromptLevel(n) { try { localStorage.setItem(PROMPT_KEY, String(Math.max(0, Math.min(100, n | 0)))); } catch {} }

  /** How the dial translates into behaviour. */
  function promptPlan(level) {
    if (level <= 0) return { off: true };
    return {
      off: false,
      // 1 → ~14s of silence before a nudge; 100 → 5s
      silenceMs: Math.round(14000 - (level / 100) * 9000),
      // at most one nudge per question at the bottom, three at the top
      maxPerQuestion: level < 34 ? 1 : level < 67 ? 2 : 3,
      // how often the nudge is about a SPECIFIC missing point
      pointedChance: level < 34 ? 0 : (level - 33) / 67,
      // never two probes on top of each other
      cooldownMs: Math.max(6000, 16000 - (level / 100) * 9000)
    };
  }

  const PROMPT_WORDS = [
    'Anything else?',
    'What else would you add?',
    'Go on.',
    'Can you expand on that?',
    'Is there anything further?',
    'And?'
  ];

  /* Which marking points the candidate has plausibly said. Token overlap,
     deliberately generous on the point's side and strict on length: a point
     counts as said when most of its significant words have appeared. It is
     not marking — the marker does that properly at the end — it is only
     good enough to decide whether a push is warranted. */
  const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was', 'are', 'not',
    'you', 'your', 'her', 'his', 'their', 'any', 'all', 'can', 'may', 'should', 'would', 'must', 'give', 'consider',
    'patient', 'woman', 'mother', 'baby', 'about', 'into', 'onto', 'per', 'via', 'each', 'also', 'other', 'more']);
  const sig = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));

  function saidAlready(point, transcript) {
    const want = sig(point);
    if (!want.length) return true;                 // nothing to look for
    const have = new Set(sig(transcript));
    const hit = want.filter(w => have.has(w)).length;
    return hit / want.length >= 0.6;
  }
  /** The points of one question that have not been covered yet. */
  function missingPoints(q, transcript) {
    return (q.marking_points || []).filter(p => !saidAlready(p, transcript));
  }

  const BOTH_KEY = 'aureum.osce.bothvoices';
  const examinerOnTape = () => { try { return localStorage.getItem(BOTH_KEY) !== '0'; } catch { return true; } };
  const setExaminerOnTape = v => { try { localStorage.setItem(BOTH_KEY, v ? '1' : '0'); } catch {} };
  const canSpeak = () => typeof speechSynthesis !== 'undefined';

  function speak(text, opts = {}) {
    if (!canSpeak() || !voiceOn() || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.rate = opts.rate || 0.96; u.pitch = opts.pitch || 1; u.lang = 'en-GB';
      // prefer a British voice so it sounds like the examiner, not a satnav
      const v = (speechSynthesis.getVoices() || []).find(x => /en-GB/i.test(x.lang) && !/google/i.test(x.name))
        || (speechSynthesis.getVoices() || []).find(x => /en-GB/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch {}
  }
  const hush = () => { try { speechSynthesis?.cancel(); } catch {} };

  /* There is deliberately no "Anything further?" here any more.
     A real PGIM examiner asks the question and then waits — the prompting,
     the nudge and the second chance are what a teaching session does, not
     what an examination does. Being asked "is there anything else?" also
     tells you, for free, that the answer was thin, which is a hint the real
     room does not give. The station now reads the question and leaves the
     silence alone; the shortfall shows up where it belongs, in the marks. */

  /* ---------------- which model marks it ---------------- */

  /* Which models can be sent the RECORDING rather than a typed transcript is
     declared per model in config.js, not decided here — see the note beside
     `geminiModels` there. In short: Gemini takes the compressed tape as it
     is; GPT takes audio but only as WAV or MP3, so the browser re-encodes it
     first; Claude's API takes text, images and PDFs and no audio at all, so
     there is nothing to switch on for it. */
  const MODEL_KEY = 'aureum.osce.model';
  function modelChoices() {
    const ai = cfg().ai || {};
    const price = m => { try { const r = Billing.rateFor(m); return { in: r.in || 0, out: r.out || 0 }; } catch { return { in: 0, out: 0 }; } };
    const add = (out, provider, m, fallbackAudio) => out.push({
      key: provider + '|' + m.id, provider, model: m.id, label: m.label, rate: price(m.id),
      audio: m.audio != null ? !!m.audio : fallbackAudio,
      audioFormat: m.audioFormat || '',            // '' = send the recording as recorded
      why: m.why || ''
    });
    const out = [];
    (ai.geminiModels || [{ id: ai.geminiModel, label: 'Gemini Flash-Lite', audio: true }])
      .forEach(m => add(out, 'gemini', m, true));
    (ai.gptModels || (ai.gptModel ? [{ id: ai.gptModel, label: 'GPT' }] : []))
      .forEach(m => add(out, 'gpt', m, false));
    (ai.claudeModels || [{ id: ai.claudeModel || 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }])
      .forEach(m => add(out, 'claude', m, false));
    // cheapest first, so the price actually informs the choice
    return out.sort((a, b) => (a.rate.in + a.rate.out) - (b.rate.in + b.rate.out));
  }
  /** Why a model cannot be sent the tape — shown instead of a bare "text only". */
  function noAudioReason(choice) {
    if (choice.why) return choice.why;
    if (choice.provider === 'claude') return 'Claude reads text, images and PDFs — its API does not take audio at all.';
    return `${choice.label} is set as text-only in the site configuration.`;
  }
  function chosenModel() {
    const all = modelChoices();
    let k = null; try { k = localStorage.getItem(MODEL_KEY); } catch {}
    /* The list is ordered cheapest-first so the price informs the choice, but
       the DEFAULT is the cheapest model that can actually listen to the
       recording. Defaulting to the cheapest of all would quietly disable the
       accurate route to save a rupee, which is the wrong trade on a station
       that took fifteen minutes to sit. */
    return all.find(m => m.key === k)
      || all.find(m => m.audio)
      || all[0]
      || { provider: 'gemini', model: cfg().ai?.geminiModel, label: 'Gemini', rate: { in: 0, out: 0 }, audio: true };
  }
  const setModel = k => { try { localStorage.setItem(MODEL_KEY, k); } catch {} };

  /* ================= the bank (#/osce) ================= */

  async function renderBank(view, user) {
    view.innerHTML = shell('bank', `<div id="os-body"><p class="muted">Loading OSCE stations…</p></div>`);
    FX.viewIn(view);
    const [list, past, colls] = await Promise.all([
      stations().catch(() => []),
      Backend.listOsceAttempts().catch(() => []),
      collections().catch(() => [])
    ]);
    // recordings older than a day are not worth storing; take them out while we are here
    Backend.sweepOsceAudio?.().catch(() => {});
    const bestOf = {};
    past.forEach(a => { const p = a.result?.percent; if (p != null && (bestOf[a.station_id] == null || p > bestOf[a.station_id])) bestOf[a.station_id] = p; });
    const body = view.querySelector('#os-body');

    /* One chip per bin that actually holds something, plus "All". A bin
       nobody has filed anything into is noise, so it is not drawn. */
    const counts = {};
    list.forEach(st => { const c = st.collection || ''; counts[c] = (counts[c] || 0) + 1; });
    const bins = [{ id: '*', label: 'All stations', n: list.length }].concat(
      colls.filter(c => counts[c.id]).map(c => ({ id: c.id, label: c.label, n: counts[c.id] })),
      counts[''] ? [{ id: '', label: UNFILED.label, n: counts[''] }] : []
    );

    if (!list.length) {
      body.innerHTML = `<div class="card" data-animate">
        <h3 class="card-title">No OSCE stations yet</h3>
        <p class="muted">The site owner publishes stations here. Each one is a 15-minute spoken viva with its own
          marking scheme — you answer out loud, the whole station is recorded, and your answers are marked against
          the scheme point by point.</p></div>`;
      return;
    }

    body.innerHTML = `
      <div class="os-hero" data-animate>
        <div class="os-hero-glow" aria-hidden="true"></div>
        <p class="kicker">SPOKEN CLINICAL EXAMINATION</p>
        <h1 class="page-title">OSCE stations</h1>
        <p class="muted">Fifteen minutes, spoken out loud, marked against the real scheme. Read the scenario, start the
          clock, and answer each question as you would to an examiner. Everything is recorded so you can hear yourself
          back — the fastest way to find out that you ramble.</p>
        <div class="os-hero-acts">
          <a class="btn btn-gold" href="#/osce/sim">🎓 Exam simulator — several stations back to back</a>
        </div>
      </div>

      <div class="os-stats" data-animate>
        <div class="os-stat"><strong>${list.length}</strong><span>Stations</span></div>
        <div class="os-stat"><strong>${past.length}</strong><span>Attempts</span></div>
        <div class="os-stat"><strong>${Object.keys(bestOf).length}</strong><span>Stations tried</span></div>
        <div class="os-stat"><strong>${past.length ? Math.round(past.reduce((s, a) => s + (a.result?.percent || 0), 0) / past.length) + '%' : '—'}</strong><span>Average</span></div>
      </div>

      <div class="es-search-wrap" data-animate>
        <div class="es-search-row">
          <span class="es-search-ico">🔎</span>
          <input type="search" id="os-search" class="es-search" autocomplete="off" spellcheck="false"
            placeholder="Search stations — e.g. HELLP, sepsis, shoulder dystocia, consent">
          <button class="es-search-x" id="os-search-x" hidden aria-label="Clear search">✕</button>
        </div>
        <p class="muted tiny es-search-hint">Searches the topic, the scenario and every question across all
          ${list.length} station${list.length > 1 ? 's' : ''}. Several words = all of them must appear.</p>
      </div>

      ${bins.length > 1 ? `<div class="os-bins" id="os-bins" data-animate>
        ${bins.map((b, i) => `<button class="os-bin ${i === 0 ? 'active' : ''}" data-bin="${esc(b.id)}">
          ${esc(b.label)}<i>${b.n}</i></button>`).join('')}
      </div>` : ''}

      <div class="os-grid" id="os-grid" data-animate>${list.map(st => card(st, bestOf[st.id], colls)).join('')}</div>
      <p class="muted" id="os-none" hidden>No station mentions that.</p>`;

    const input = body.querySelector('#os-search');
    const clear = body.querySelector('#os-search-x');
    const grid = body.querySelector('#os-grid');
    const none = body.querySelector('#os-none');
    // opening a station and coming back should land you where you were, not
    // back at the top of two hundred stations
    input.value = bankView.q || '';
    /* The cards carry the topic and the scenario, which is enough for most
       searches. The deep index — every prompt and every marking point — is
       fetched on the FIRST keystroke and never on a visit that does not
       search, which is most of them. */
    const hay = {};
    list.forEach(st => hay[st.id] = `${st.topic || ''} ${st.scenario || ''}`.toLowerCase());
    let deep = false;
    async function loadDeep() {
      if (deep) return; deep = true;
      try {
        const idx = (typeof Cache !== 'undefined')
          ? await Cache.wrap('osce-search', TTL, () => Backend.getOsceSearchIndex(), { keepIfEmptied: true })
          : await Backend.getOsceSearchIndex();
        (idx || []).forEach(r => { if (r.search) hay[r.id] = (hay[r.id] + ' ' + r.search).toLowerCase(); });
      } catch { /* topic + scenario search still works */ }
    }
    // a remembered bin that no longer holds anything falls back to All
    let bin = bins.some(b => b.id === bankView.bin) ? bankView.bin : '*';
    body.querySelectorAll('.os-bin').forEach(x => x.classList.toggle('active', x.dataset.bin === bin));
    const run = () => {
      const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      clear.hidden = !terms.length;
      bankView.q = input.value; bankView.bin = bin;
      let shown = 0;
      grid.querySelectorAll('.os-card').forEach(c => {
        const ok = (bin === '*' || (c.dataset.coll || '') === bin) && terms.every(t => hay[c.dataset.st].includes(t));
        c.hidden = !ok; if (ok) shown++;
      });
      none.hidden = shown > 0;
      none.textContent = terms.length ? 'No station mentions that.' : 'Nothing filed here yet.';
      restoreScroll();
    };
    input.addEventListener('input', async () => { bankView.top = 0; await loadDeep(); run(); });
    clear.addEventListener('click', () => { input.value = ''; bankView.top = 0; run(); input.focus(); });
    body.querySelector('#os-bins')?.addEventListener('click', e => {
      const b = e.target.closest('[data-bin]'); if (!b) return;
      bin = b.dataset.bin; bankView.top = 0;
      body.querySelectorAll('.os-bin').forEach(x => x.classList.toggle('active', x === b));
      run();
    });
    // the deep index is only needed when a search is actually in force, so a
    // restored one pays for it and a fresh visit still does not
    if (bankView.q.trim()) { await loadDeep(); }
    run();
    grid.addEventListener('click', () => { bankView.top = window.scrollY; }, true);
  }

  /* Where the candidate was in the bank, kept for the length of the visit.
     Deliberately in memory rather than storage: coming back from a station
     should feel like going back, but a new session should start clean. */
  const bankView = { q: '', bin: '*', top: 0 };
  let scrollTimer = null;
  function restoreScroll() {
    if (!bankView.top) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { window.scrollTo({ top: bankView.top, behavior: 'instant' }); bankView.top = 0; }, 40);
  }

  function card(st, best, colls) {
    const n = qCount(st);
    const cl = (colls || []).length ? collLabel(colls, st.collection || '') : '';
    return `
      <a class="os-card" data-st="${esc(st.id)}" data-coll="${esc(st.collection || '')}"
         href="#/osce/station/${encodeURIComponent(st.id)}">
        <div class="os-card-top">
          <span class="os-card-time">${minsOf(st)} min</span>
          ${st.image_count ? `<span class="os-card-img" title="${st.image_count} image${st.image_count === 1 ? '' : 's'} — a CTG, a partogram or a scan">🖼 ${st.image_count}</span>` : ''}
          ${cl ? `<span class="os-card-coll">${esc(cl)}</span>` : ''}
          ${best != null ? `<span class="os-card-best ${best >= (st.pass_mark_percent || 70) ? 'good' : 'bad'}">best ${best}%</span>` : ''}
        </div>
        <h3>${esc(st.topic || st.id)}</h3>
        <p class="os-card-sc">${esc(st.scenario || '')}</p>
        <div class="os-card-foot">
          <span>${n} question${n === 1 ? '' : 's'} · ${marksOf(st)} marks</span>
          <span class="os-card-go">Start →</span>
        </div>
      </a>`;
  }

  /* ================= one station's brief (#/osce/station/:id) ================= */

  async function renderStation(view, id, user) {
    const st = await station(id);
    if (!st) { view.innerHTML = shell('bank', `<p class="muted">That station is no longer published. <a class="link" href="#/osce">Back</a></p>`); FX.viewIn(view); return; }
    let past = [];
    try { past = (await Backend.listOsceAttempts()).filter(a => a.station_id === id); } catch {}

    view.innerHTML = shell('bank', `
      <a class="link muted dev-back" href="#/osce">← OSCE stations</a>
      <header data-animate>
        <p class="kicker">STATION · ${minsOf(st)} MINUTES · ${marksOf(st)} MARKS</p>
        <h1 class="page-title">${esc(st.topic || '')}</h1>
      </header>
      <div class="card os-brief" data-animate>
        <h3 class="card-title">The scenario</h3>
        <p class="os-scenario">${esc(st.scenario || '')}</p>
        <div class="os-brief-grid">
          <div><strong>${qCount(st)}</strong><span>questions</span></div>
          <div><strong>${marksOf(st)}</strong><span>marks</span></div>
          <div><strong>${passOf(st)}</strong><span>to pass (${st.pass_mark_percent || 70}%)</span></div>
          <div><strong>${minsOf(st)}</strong><span>minutes</span></div>
        </div>
        <p class="muted tiny os-warn">You will answer <strong>out loud</strong>. The browser asks for the microphone
          when the station starts; the whole ${minsOf(st)} minutes is recorded and offered as a download at the end.
          Nothing is uploaded unless you ask for AI marking.</p>
        <div class="os-brief-acts">
          <button class="btn btn-gold btn-lg" id="os-start">▶ Start the station</button>
          <button class="btn btn-ghost" id="os-scheme">📋 Show scheme</button>
          <button class="btn btn-ghost" id="os-copy"
            title="Copy the scenario and the questions as plain text — WITHOUT the marking scheme — to paste into NotebookLM, Gemini or ChatGPT">📄 Copy the station</button>
          <a class="btn btn-ghost" href="#/osce/sim">Add it to a simulator session instead</a>
        </div>
        <p class="muted tiny">Most of these stations exist on paper too — open the scheme if you want to check this is
          the one you meant before you start the clock.</p>
      </div>
      ${past.length ? `
      <div class="card" data-animate>
        <h3 class="card-title">Your attempts</h3>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>When</th><th>Score</th><th>Result</th><th></th></tr></thead>
          <tbody>${past.slice().sort((a, b) => (b.created || 0) - (a.created || 0)).map(a => `
            <tr><td class="muted">${esc(new Date(a.created || Date.now()).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td>
              <td><strong>${a.result?.total ?? '—'}/${a.result?.max ?? marksOf(st)}</strong> · ${a.result?.percent ?? '—'}%</td>
              <td>${a.result?.pass ? '<span class="good">Pass</span>' : '<span class="bad">Below the pass mark</span>'}</td>
              <td><a class="link" href="#/osce/result/${encodeURIComponent(a.id)}">Open →</a></td></tr>`).join('')}</tbody>
        </table></div>
      </div>` : ''}`);
    FX.viewIn(view);
    view.querySelector('#os-start').addEventListener('click', async () => {
      const sid = 'os-' + Date.now().toString(36);
      await saveSession({ id: sid, stations: [st.id], at: 0, phase: 'brief', answers: {}, elapsed: 0, started: Date.now() });
      location.hash = '#/osce/run/' + sid;
    });
    view.querySelector('#os-scheme').addEventListener('click', () => showScheme(st));
    view.querySelector('#os-copy').addEventListener('click', e =>
      copyOut(stationAsText(st), e.currentTarget, '📄 Copy the station'));
  }

  /* ---------------- the scheme, in a dialog ----------------
     Every question and every marking point, exactly as a station will be
     marked. Opened BEFORE the clock starts on purpose: these stations mostly
     exist on paper as well, and the scheme is how you recognise which one
     this is. It is also the fastest route into the editor when a point is
     wrong. */
  function showScheme(st) {
    document.querySelector('.os-modal')?.remove();
    const qs = qsOf(st);
    const wrap = document.createElement('div');
    wrap.className = 'os-modal';
    wrap.innerHTML = `
      <div class="os-modal-back" data-close></div>
      <div class="os-modal-box" role="dialog" aria-modal="true" aria-label="Marking scheme">
        <div class="os-modal-head">
          <div>
            <p class="kicker">MARKING SCHEME</p>
            <h3>${esc(st.topic || st.id)}</h3>
            <p class="muted tiny">${qs.length} question${qs.length === 1 ? '' : 's'} ·
              ${marksOf(st)} marks · ${ptCount(st)} marking points · ${passOf(st)} to pass</p>
          </div>
          <button class="os-modal-x" data-close aria-label="Close">✕</button>
        </div>
        <div class="os-modal-body">
          <p class="os-scenario">${esc(st.scenario || '')}</p>
          ${qs.map((q, i) => `
            <div class="os-sch-q">
              <div class="os-sch-h"><span class="os-sch-n">Q${i + 1}</span>
                <p>${esc(q.prompt || '')}</p><span class="os-sch-m">${q.marks} marks</span></div>
              ${q.reveal_before ? `<p class="os-sch-rev"><b>Revealed first:</b> ${esc(q.reveal_before)}</p>` : ''}
              ${imageStrip(q, 'is-small')}
              <ul class="os-sch-pts">${(q.marking_points || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
            </div>`).join('')}
        </div>
        <div class="os-modal-foot">
          ${st.edited_by ? `<span class="muted tiny">Last edited by ${esc(st.edited_by)}${
            st.edited_at ? ' on ' + esc(new Date(st.edited_at).toLocaleDateString('en-GB', { dateStyle: 'medium' })) : ''}</span>` : ''}
          <a class="btn btn-ghost btn-sm" href="#/osce/edit/${encodeURIComponent(st.id)}">✎ Edit this scheme</a>
          <button class="btn btn-ghost btn-sm" data-close>Close</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wireLightbox(wrap);
    const shut = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.os-lightbox')) shut(); };
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', shut));
    wrap.querySelector('.os-modal-foot a').addEventListener('click', shut);
    document.addEventListener('keydown', onKey);
  }

  /* ================= my attempts (#/osce/mine) =================
     Every station already sat, with its score, so a past OSCE can be
     reopened from the OSCE tab instead of going round by the dashboard.
     The rows are the light attempt cards — no answers, no schemes — so this
     page costs a few KB however many stations have been sat. */

  async function renderMine(view, user) {
    view.innerHTML = shell('mine', `<div id="os-body"><p class="muted">Loading your attempts…</p></div>`);
    FX.viewIn(view);
    let past = [];
    try { past = (await Backend.listOsceAttempts()) || []; }
    catch (e) {
      view.querySelector('#os-body').innerHTML = `<p class="bad">${esc(e.message || e)}</p>`; return;
    }
    const body = view.querySelector('#os-body');
    if (!past.length) {
      body.innerHTML = `<div class="card" data-animate>
        <h3 class="card-title">Nothing sat yet</h3>
        <p class="muted">Once you have sat a station and had it marked, it appears here — the marks, the scheme point by
          point, what you said, and the recording for its first 24 hours.</p>
        <a class="btn btn-gold" href="#/osce">Go to the station bank</a></div>`;
      return;
    }
    const rows = past.slice().sort((a, b) => (b.created || 0) - (a.created || 0));
    const passed = rows.filter(a => a.result?.pass).length;
    const avg = Math.round(rows.reduce((s, a) => s + (a.result?.percent || 0), 0) / rows.length);
    const best = {};
    rows.forEach(a => { const p = a.result?.percent; if (p != null && (best[a.station_id] == null || p > best[a.station_id])) best[a.station_id] = p; });

    body.innerHTML = `
      <header data-animate>
        <p class="kicker">EVERY STATION YOU HAVE SAT</p>
        <h1 class="page-title">My attempts</h1>
        <p class="muted">Open one to see the marking point by point, what you said, and — for the first day — the
          recording. Sitting the same station again is the fastest way to find out whether the feedback stuck.</p>
      </header>

      <div class="os-stats" data-animate>
        <div class="os-stat"><strong>${rows.length}</strong><span>Attempts</span></div>
        <div class="os-stat"><strong>${Object.keys(best).length}</strong><span>Stations tried</span></div>
        <div class="os-stat"><strong>${passed}</strong><span>Passed</span></div>
        <div class="os-stat"><strong>${avg}%</strong><span>Average</span></div>
      </div>

      <div class="card" data-animate>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>When</th><th>Station</th><th>Score</th><th>Result</th><th></th></tr></thead>
          <tbody>${rows.map(a => {
            const r = a.result || {};
            return `<tr>
              <td class="muted">${esc(new Date(a.created || Date.now()).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td>
              <td>${esc(a.topic || a.station_id || '')}</td>
              <td><strong>${r.total ?? '—'}/${r.max ?? '—'}</strong> · ${r.percent ?? '—'}%</td>
              <td>${r.pass ? '<span class="good">Pass</span>' : '<span class="bad">Below the pass mark</span>'}</td>
              <td><a class="link" href="#/osce/result/${encodeURIComponent(a.id)}">Open →</a>
                  <a class="link" href="#/osce/station/${encodeURIComponent(a.station_id)}">Sit again</a></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
  }

  /* ================= the station editor (#/osce/edit[/:id]) =================
     The same editor the developer console has, in the OSCE tab, so anyone
     preparing can fix a scheme. Saving is open to signed-in users; deleting
     a station is not — see the policy note in supabase/schema.sql. Every
     save records who made it. */

  async function renderEdit(view, id, user) {
    if (!user) {
      view.innerHTML = shell('edit', `<div class="card" data-animate><h3 class="card-title">Sign in to edit</h3>
        <p class="muted">Stations are shared by everyone using AUREUM, so an edit has to have a name against it.</p></div>`);
      FX.viewIn(view); return;
    }
    view.innerHTML = shell('edit', `<div id="os-body"><p class="muted">Loading the stations…</p></div>`);
    FX.viewIn(view);
    const [list, colls] = await Promise.all([stations().catch(() => []), collections().catch(() => [])]);
    const body = view.querySelector('#os-body');
    body.innerHTML = `
      <header data-animate>
        <p class="kicker">STATION EDITOR</p>
        <h1 class="page-title">Edit a station</h1>
        <p class="muted">Change the scenario, the marks, the pass mark, and every question with its marking points.
          Everyone sitting these stations sees the change, so edits are signed with your name.</p>
      </header>
      <div class="es-search-wrap" data-animate>
        <div class="es-search-row">
          <span class="es-search-ico">🔎</span>
          <input type="search" id="oe-find" class="es-search" autocomplete="off"
            placeholder="Find the station to edit — e.g. HELLP, cord prolapse">
        </div>
      </div>
      <div class="os-edit-list" id="oe-list" data-animate></div>
      <div id="os-editor"></div>`;

    const host = body.querySelector('#oe-list');
    const paintList = filter => {
      const f = String(filter || '').trim().toLowerCase();
      const rows = list.filter(s => !f || `${s.topic || ''} ${s.scenario || ''}`.toLowerCase().includes(f));
      host.innerHTML = rows.length ? rows.slice(0, 60).map(s => `
        <button class="os-edit-row" data-edit="${esc(s.id)}">
          <span class="os-edit-t">${esc(s.topic || s.id)}</span>
          <span class="os-edit-m">${qCount(s)} q · ${ptCount(s)} points · ${marksOf(s)} marks</span>
          <span class="os-edit-c">${esc(collLabel(colls, s.collection || ''))}</span>
          <span class="os-edit-go">Edit →</span>
        </button>`).join('') + (rows.length > 60 ? `<p class="muted tiny">${rows.length - 60} more — narrow the search.</p>` : '')
        : `<p class="muted">No station matches that.</p>`;
    };
    paintList('');
    body.querySelector('#oe-find').addEventListener('input', e => paintList(e.target.value));
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-edit]'); if (!b) return;
      location.hash = '#/osce/edit/' + encodeURIComponent(b.dataset.edit);
    });

    if (id) await openEditor(view, id, colls);
  }

  async function openEditor(view, id, colls) {
    const eh = view.querySelector('#os-editor');
    if (!eh) return;
    eh.innerHTML = '<p class="muted">Loading the station…</p>';
    eh.scrollIntoView({ behavior: 'smooth', block: 'start' });
    let st = null;
    try { st = await station(id); } catch {}
    if (!st || !qsOf(st).length) { eh.innerHTML = '<p class="bad">Could not load that station.</p>'; return; }
    if (typeof DevConsole === 'undefined' || !DevConsole.osceEditor) {
      eh.innerHTML = '<p class="bad">The editor could not be loaded.</p>'; return;
    }
    DevConsole.osceEditor(eh, st, colls, () => {
      fullCache.delete(id); bustStations();
      location.hash = '#/osce/edit';
    });
  }

  /* ================= the simulator (#/osce/sim) ================= */

  async function renderSim(view, user) {
    const list = await stations().catch(() => []);   // cards only — the circuit needs names, not schemes
    const modules = await OsceBlueprint.get().catch(() => []);
    let attempts = [];
    try { attempts = (await Backend.listOsceAttempts()) || []; } catch {}
    const byId = {}; list.forEach(s => byId[s.id] = s);
    const history = OsceBlueprint.historyOf(attempts, byId);
    const tagged = list.filter(s => OsceBlueprint.tagOf(s));
    const modsWithStations = new Set(tagged.map(s => OsceBlueprint.tagOf(s).module));

    view.innerHTML = shell('sim', `
      <header data-animate>
        <p class="kicker">OSCE EXAM SIMULATOR</p>
        <h1 class="page-title">Build a circuit</h1>
        <p class="muted">The PGIM runs nine stations of fifteen minutes. Sit all nine, or as many as the time you have
          today allows — four stations is an hour. You can pause between stations, or in the middle of one, and pick
          the circuit up later exactly where you left it.</p>
      </header>

      <div class="card os-blind" data-animate>
        <h3 class="card-title">🙈 You will not be told the topic</h3>
        <p class="muted">In the real room the examiner reads you a scenario and starts asking. Nobody says
          “this is a pulmonary embolism station” first — and being told narrows the discussion before it begins.
          So a circuit shows you the scenario and nothing else. The topic, the module and the marking scheme appear
          when the station is over.</p>
      </div>

      <div class="card os-simset" data-animate>
        <h3 class="card-title">How many stations?</h3>
        <div class="os-count" id="os-count">
          ${[1, 2, 3, 4, 6, 8, 9, 12].map(n => `<button class="os-count-b ${n === 9 ? 'active' : ''}" data-n="${n}">
            <strong>${n}</strong><span>${hours(n * 15)}</span></button>`).join('')}
        </div>
        <p class="muted tiny" id="os-count-note"></p>

        <h3 class="card-title" style="margin-top:22px">Which stations?</h3>
        <div class="os-pickmode" id="os-pickmode">
          <button class="os-pick-b active" data-mode="blueprint">🗺 Across the blueprint</button>
          <button class="os-pick-b" data-mode="random">🎲 Surprise me</button>
          <button class="os-pick-b" data-mode="unseen">✦ Ones I haven't done</button>
          <button class="os-pick-b" data-mode="pick">☑ Let me choose</button>
        </div>
        <label class="os-fresh" id="os-freshwrap">
          <input type="checkbox" id="os-fresh">
          <span><strong>All stations must be new to me</strong><br>
            <span class="muted tiny" id="os-freshnote"></span></span>
        </label>

        <details class="dev-collapse os-simcoach" style="margin-top:14px">
          <summary><span class="card-title">Coaching on every station in this circuit</span><span class="dc-caret">▸</span></summary>
          <p class="muted tiny">Asked once here rather than nine times. Whatever is ticked is applied to every station
            in the round — the ones that need the recording are simply skipped on any station where nothing was
            captured.</p>
          <div id="os-sim-coach"></div>
        </details>
        <div id="os-picklist" hidden></div>
        <div id="os-bpnote"></div>

        <div class="os-simset-foot">
          <span class="muted tiny" id="os-sim-sum"></span>
          <button class="btn btn-gold btn-lg" id="os-sim-go">▶ Start the circuit</button>
        </div>
      </div>

      ${list.length ? '' : `<div class="card"><p class="muted">No stations are published yet, so a circuit cannot be built.</p></div>`}`);
    FX.viewIn(view);
    if (!list.length) return;

    let want = 9, mode = 'blueprint', chosen = new Set(), freshOnly = false;
    let done = new Set();
    attempts.forEach(a => done.add(a.station_id));

    /* The bank priorities and the module weights, worked out once. Weight is
       a property of the bank as it stands today — how many topics a module
       actually has stations for, and how many stations those are — so it is
       recomputed on every visit rather than stored and left to rot. */
    const colls = await collections().catch(() => []);
    const priorities = {};
    colls.forEach(c => priorities[c.id] = Number(c.priority ?? (c.id === 'common' ? 1 : 3)));
    const weights = OsceBlueprint.moduleWeights(modules, tagged);

    const pickHost = view.querySelector('#os-picklist');
    const bpNote = view.querySelector('#os-bpnote');
    const sum = view.querySelector('#os-sim-sum');
    const note = view.querySelector('#os-count-note');
    const freshBox = view.querySelector('#os-fresh');
    const freshNote = view.querySelector('#os-freshnote');

    /* The circuit is settled ONCE, when the button is pressed — not on every
       repaint. A pool that reshuffled itself as you looked at it made the
       summary a lie about what you were going to sit. */
    function pool() {
      if (mode === 'pick') return list.filter(s => chosen.has(s.id));
      if (mode === 'blueprint' && tagged.length) {
        const c = OsceBlueprint.buildCircuit(tagged, history, want,
          { avoid: done, freshOnly, priorities, weights });
        if (c.length) return c;
      }
      /* The plain modes honour the tick too: "all new to me" is a promise
         about the circuit, not about one way of building it. */
      let src = (mode === 'unseen' || freshOnly) ? list.filter(s => !done.has(s.id)) : list.slice();
      if (!src.length && !freshOnly) src = list.slice();
      const bag = src.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      return bag.slice(0, want);
    }
    function paint() {
      const p = pool();
      const mins = p.length * 15;
      const freshLeft = OsceBlueprint.freshCount(tagged, done);
      /* Say plainly when the tick cannot be honoured in full rather than
         quietly handing back a shorter circuit. */
      const short = freshOnly && p.length < want;
      sum.innerHTML = p.length
        ? `<strong>${p.length}</strong> station${p.length === 1 ? '' : 's'} · ${hours(p.length * 15)}${
            short ? ` <span class="bad">— only ${p.length} new station${p.length === 1 ? '' : 's'} are left</span>` : ''}`
        : freshOnly ? '<span class="bad">You have sat every station already. Untick “all new to me” to revisit some.</span>'
        : 'Choose at least one station.';
      freshNote.textContent = `${freshLeft} of ${tagged.length} blueprint stations are still untried.`;
      view.querySelector('#os-freshwrap').classList.toggle('is-on', freshOnly);
      view.querySelector('#os-sim-go').disabled = !p.length;
      note.textContent = mode === 'unseen'
        ? `${list.filter(s => !done.has(s.id)).length} of ${list.length} stations are still untried.`
        : mode === 'blueprint'
          ? `${tagged.length} of ${list.length} stations are placed on the blueprint, across ${modsWithStations.size} modules.`
          : `${list.length} stations are published.`;

      /* What the balancing is about to do, said before it does it. The
         modules it will reach for are the ones sat least — so four stations
         today and four tomorrow cover eight modules, not the same four. */
      if (mode === 'blueprint') {
        if (!tagged.length) {
          bpNote.innerHTML = `<p class="muted tiny os-bp-warn">No station has been placed on the blueprint yet, so this
            falls back to a random draw. Tag them in <strong>Developer → OSCE stations</strong>.</p>`;
        } else {
          const covered = [...new Set(p.map(s => OsceBlueprint.tagOf(s)?.module).filter(Boolean))];
          const bands = {};
          p.forEach(s => { const b = OsceBlueprint.priorityOf(s, priorities); bands[b] = (bands[b] || 0) + 1; });
          const bandTxt = Object.keys(bands).sort((a, b) => b - a)
            .map(b => `${bands[b]} from priority ${b}`).join(', ');
          const heaviest = [...modsWithStations].sort((a, b) => (weights[b] || 0) - (weights[a] || 0))[0];
          bpNote.innerHTML = `<p class="muted tiny os-bp-warn">This draw spans
            <strong>${covered.length}</strong> module${covered.length === 1 ? '' : 's'}, taken from the ones you have sat
            least. Where you are equally behind, the bigger module goes first — ${
            esc(OsceBlueprint.moduleName(modules, heaviest))} is currently the largest slice of the blueprint.
            Banks: ${esc(bandTxt)}.
            <em>Which modules they are is not shown, for the same reason the topics are not.</em></p>`;
        }
      } else { bpNote.innerHTML = ''; }

      if (mode === 'pick') {
        pickHost.hidden = false;
        pickHost.innerHTML = `<div class="os-picks">${list.map(s => `
          <label class="os-pick ${chosen.has(s.id) ? 'is-on' : ''}">
            <input type="checkbox" data-pickst="${esc(s.id)}" ${chosen.has(s.id) ? 'checked' : ''}>
            <span><strong>${esc(s.topic || s.id)}</strong><em>${qCount(s)} questions · ${marksOf(s)} marks${done.has(s.id) ? ' · attempted' : ''}</em></span>
          </label>`).join('')}</div>`;
      } else { pickHost.hidden = true; pickHost.innerHTML = ''; }
    }
    view.querySelector('#os-count').addEventListener('click', e => {
      const b = e.target.closest('[data-n]'); if (!b) return;
      want = Number(b.dataset.n);
      view.querySelectorAll('.os-count-b').forEach(x => x.classList.toggle('active', x === b));
      paint();
    });
    view.querySelector('#os-pickmode').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      mode = b.dataset.mode;
      view.querySelectorAll('.os-pick-b').forEach(x => x.classList.toggle('active', x === b));
      view.querySelector('#os-freshwrap').hidden = mode === 'pick';
      paint();
    });
    freshBox.addEventListener('change', () => { freshOnly = freshBox.checked; paint(); });
    {
      // a circuit is recorded, so every option is answerable
      const ch = view.querySelector('#os-sim-coach');
      if (ch) { ch.innerHTML = coachPicker(true); wireCoachPicker(ch); }
    }
    pickHost.addEventListener('change', e => {
      const c = e.target.closest('[data-pickst]'); if (!c) return;
      c.checked ? chosen.add(c.dataset.pickst) : chosen.delete(c.dataset.pickst);
      c.closest('.os-pick').classList.toggle('is-on', c.checked);
      paint();
    });
    view.querySelector('#os-sim-go').addEventListener('click', async () => {
      const p = pool(); if (!p.length) return;
      const sid = 'os-' + Date.now().toString(36);
      /* `blind` travels with the session, so a circuit resumed tomorrow is
         still blind — the flag belongs to the sitting, not to the tab it
         was started in. Choosing the stations yourself cannot be blind:
         you have already read the list. */
      await saveSession({ id: sid, stations: p.map(s => s.id), at: 0, phase: 'brief', answers: {}, elapsed: 0,
        started: Date.now(), circuit: true, blind: mode !== 'pick' });
      location.hash = '#/osce/run/' + sid;
    });
    paint();
  }

  /* ================= session state ================= */

  const sKey = id => 'osce:' + id;
  async function saveSession(s) {
    try { localStorage.setItem('aureum.' + sKey(s.id), JSON.stringify(s)); } catch {}
    try { await Backend.saveSession(sKey(s.id), s); } catch {}
    return s;
  }
  async function loadSession(id) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem('aureum.' + sKey(id)) || 'null'); } catch {}
    if (local) return local;
    try { return await Backend.loadSession(sKey(id)); } catch { return null; }
  }
  async function dropSession(id) {
    try { localStorage.removeItem('aureum.' + sKey(id)); } catch {}
    try { localStorage.removeItem('aureum.' + mKey(id)); } catch {}
    try { await Backend.clearSession(sKey(id)); } catch {}
  }

  /* ---------------- where a circuit's marks live ----------------
     NOT inside the session. The runner holds its own copy of the session
     and writes it every five seconds; a result that the background marker
     had just recorded was being overwritten by that stale copy, and the
     station silently went back to "marking…" for ever. Two writers, one
     object, last-write-wins — the oldest bug in the book.

     The marks therefore get their own key, written only by the marker and
     read by the results page. Merging carefully would have worked; not
     sharing the object cannot go wrong in the first place. */
  const mKey = id => 'osce-marks:' + id;
  function loadMarks(sid) {
    try { return JSON.parse(localStorage.getItem('aureum.' + mKey(sid)) || '{}') || {}; } catch { return {}; }
  }
  function saveMark(sid, stationId, entry) {
    const all = loadMarks(sid);
    all[stationId] = Object.assign({}, all[stationId], entry);
    try { localStorage.setItem('aureum.' + mKey(sid), JSON.stringify(all)); } catch {}
    return all;
  }

  /* ================= the runner (#/osce/run/:sid) ================= */

  let live = null;         // the one running station's machinery

  async function renderRun(view, sid, user) {
    stopLive();
    const s = await loadSession(sid);
    if (!s) { location.hash = '#/osce'; return; }
    const st = await station(s.stations[s.at]);
    if (!st || !qsOf(st).length) { location.hash = '#/osce'; return; }

    const qs = qsOf(st);
    const total = minsOf(st) * 60;
    const ans = s.answers[st.id] || (s.answers[st.id] = {});
    let qi = s.qi || 0;
    let elapsed = s.elapsed || 0;
    let running = false, tid = null;

    /* A blind sitting never names the station while it is being sat. The
       title is the single biggest giveaway — reading "Pulmonary embolism"
       decides the differential before the candidate has heard the history,
       which is precisely the help the real room does not give. */
    const blind = !!s.blind;

    view.innerHTML = `
      <section class="page os-run${blind ? ' is-blind' : ''}">
        <div class="os-run-bar">
          <div class="os-run-id">
            <span class="os-run-n">${s.circuit ? `Station ${s.at + 1} of ${s.stations.length}` : 'Single station'}</span>
            <span class="os-run-topic">${blind ? '<em class="os-sealed">Topic sealed until the end</em>' : esc(st.topic || '')}</span>
          </div>
          <div class="os-clock" id="os-clock"><span id="os-time">${fmt(total - elapsed)}</span><i id="os-ring"></i></div>
          <div class="os-run-acts">
            <label class="os-pdial" title="How hard the examiner pushes you for the marks you have not said yet">
              <span class="os-pdial-l">Examiner<i id="os-pdial-v">${promptLevel()}</i></span>
              <input type="range" id="os-pdial" min="0" max="100" step="5" value="${promptLevel()}">
            </label>
            <button class="btn btn-ghost btn-sm" id="os-pause" hidden>⏸ Pause</button>
            <button class="btn btn-ghost btn-sm qr-danger" id="os-quit">Leave</button>
          </div>
        </div>
        <div class="os-progress"><i id="os-prog"></i></div>
        <div id="os-stage"></div>
      </section>`;
    FX.viewIn(view);

    const stage = view.querySelector('#os-stage');
    const timeEl = view.querySelector('#os-time');
    const ringEl = view.querySelector('#os-ring');
    const progEl = view.querySelector('#os-prog');
    const pauseBtn = view.querySelector('#os-pause');

    /* The dial is live: an examiner who is pushing too hard three questions
       in can be turned down without leaving the station. */
    const dial = view.querySelector('#os-pdial');
    const dialV = view.querySelector('#os-pdial-v');
    dial.addEventListener('input', () => {
      setPromptLevel(Number(dial.value));
      dialV.textContent = dial.value;
      dial.closest('.os-pdial').classList.toggle('is-off', Number(dial.value) === 0);
    });
    dial.closest('.os-pdial').classList.toggle('is-off', promptLevel() === 0);

    view.querySelector('#os-quit').addEventListener('click', () => {
      if (!confirm('Leave this station? Your answers so far are saved — you can resume from the OSCE tab.')) return;
      stopLive(); location.hash = '#/osce';
    });
    pauseBtn.addEventListener('click', () => running ? pause() : resume());

    /* ---- clock ---- */
    function paintClock() {
      const clock = view.querySelector('#os-clock');
      if (!clock) return;                       // the page has moved on
      const left = Math.max(0, total - elapsed);
      timeEl.textContent = fmt(left);
      const pct = Math.min(100, (elapsed / total) * 100);
      ringEl.style.width = pct + '%';
      clock.classList.toggle('is-low', left <= 120 && left > 0);
      clock.classList.toggle('is-out', left <= 0);
      progEl.style.width = (qs.length ? ((qi) / qs.length) * 100 : 0) + '%';
    }
    function tick() {
      /* Navigating away mid-station replaces the page under us, but the
         interval survives — it then ticks forever against a DOM that is gone,
         throwing on every second and holding the microphone open. Notice the
         page has moved on and stop properly. */
      if (!view.querySelector('#os-clock')) {
        clearInterval(tid); tid = null; running = false;
        persist(); stopLive();
        return;
      }
      elapsed += 1; paintClock();
      if (elapsed % 5 === 0) persist();
      if (elapsed >= total) { finish(true); }
    }
    function startClock() { if (tid) return; running = true; pauseBtn.hidden = false; pauseBtn.innerHTML = '⏸ Pause'; tid = setInterval(tick, 1000); }
    function pause() {
      running = false; if (tid) clearInterval(tid); tid = null;
      pauseBtn.innerHTML = '▶ Resume';
      live?.pause(); persist();
      stage.classList.add('is-paused');
      if (!stage.querySelector('.os-paused')) {
        const p = document.createElement('div');
        p.className = 'os-paused';
        p.innerHTML = `<div class="os-paused-in"><span>⏸</span><h3>Paused</h3>
          <p class="muted">The clock and the recording are stopped. Nothing is lost — press resume when you are back.</p>
          <button class="btn btn-gold" id="os-resume">▶ Resume the station</button></div>`;
        stage.appendChild(p);
        p.querySelector('#os-resume').addEventListener('click', resume);
      }
    }
    function resume() { stage.classList.remove('is-paused'); stage.querySelector('.os-paused')?.remove(); live?.resume(); startClock(); }
    function persist() { s.qi = qi; s.elapsed = elapsed; s.phase = qi >= qs.length ? 'done' : 'station'; saveSession(s); }

    /* The examiner's lines, fetched while the candidate reads the scenario.
       Prefetching is what makes a real voice usable: asking for the audio at
       the moment the question appears would put a network round trip in the
       middle of a timed station.

       Declared HERE, above the phase dispatch, because brief() starts the
       prefetch — and a `const` declared further down would still be in its
       temporal dead zone at that point. The rejection was being swallowed by
       the .catch() on the call, so it looked like the feature simply never
       ran. */
    const voices = new Map();
    let voicesReady = false;
    /* The generic nudges live up here for the SAME reason, and learning it
       twice was one time too many: brief() → prefetchVoices() →
       prefetchNudges() runs before the phase dispatch has finished, and a
       `const` further down is still in its dead zone. The ReferenceError
       went into the .catch() on the prefetch and the examiner simply never
       had a word to say. */
    const nudges = new Map();

    /* ---- the three phases ----
       A debrief re-entered (a circuit stepping back, a re-render) used to be
       called with no recording and would announce that none had been made.
       The tape from the station just finished is still in hand. */
    if (s.phase === 'done' || qi >= qs.length) { debrief(false, lastRec?.station === st.id ? lastRec.rec : null); }
    else if (s.phase === 'station' && elapsed > 0) { brief(true); }
    else { brief(false); }

    function brief(resuming) {
      paintClock();
      stage.innerHTML = `
        <div class="os-sheet" data-animate>
          <p class="kicker">${resuming ? 'RESUMING' : 'READ THE SCENARIO'}</p>
          ${blind
            ? `<h2 class="os-blind-h">Station ${s.at + 1}</h2>
               <p class="muted tiny os-sealed-note">The examiner does not tell you what this station is about.
                 The topic and the marking scheme are revealed once the clock stops.</p>`
            : `<h2>${esc(st.topic || '')}</h2>`}
          <p class="os-scenario big">${esc(st.scenario || '')}</p>
          <p class="muted os-readnote">${resuming
            ? `You were ${fmt(elapsed)} into this station and had answered ${qi} of ${qs.length} questions. The clock picks up where it stopped.`
            : `The examiner allows about ${st.reading_time_min || 1} minute to read. The ${minsOf(st)}-minute clock and the
               recording both start when you press the button — question 1 appears at the same moment.`}</p>
          <div class="os-mic" id="os-mic"></div>
          <p class="os-voiceline" id="os-voiceline"></p>
          <div class="os-preflight" id="os-pre">
            <button class="btn btn-ghost btn-sm" id="os-pre-go">🎙 Test the microphone first</button>
            <span class="muted tiny">Worth ten seconds — a blocked microphone is much easier to fix now than four
              questions into a fifteen-minute station.</span>
          </div>
          <div class="os-pdial-box">
            <label class="os-pdial-head">
              <span><strong>How hard should the examiner push?</strong></span>
              <span class="os-pdial-num" id="os-pdial-b-v">${promptLevel()}</span>
            </label>
            <input type="range" id="os-pdial-b" min="0" max="100" step="5" value="${promptLevel()}">
            <div class="os-pdial-scale"><span>Silent</span><span>Nudges</span><span>Pushes hard</span></div>
            <p class="muted tiny" id="os-pdial-say"></p>
          </div>
          ${canSpeak() ? `<label class="os-both">
            <input type="checkbox" id="os-both" ${examinerOnTape() ? 'checked' : ''}>
            <span><strong>Record the examiner's voice too</strong><br>
              <span class="muted tiny">The questions are read aloud through the speaker and the microphone picks them
                up, so the tape sounds like the real room. Turn it off, or wear headphones, and only your own voice is
                recorded. Nothing said in the examiner's voice can earn you marks either way.</span></span>
          </label>` : ''}
          <button class="btn btn-gold btn-lg" id="os-go">${resuming ? '▶ Resume the station' : "▶ I've read it — start"}</button>
        </div>`;
      stage.querySelector('#os-both')?.addEventListener('change', e => setExaminerOnTape(e.target.checked));
      stage.querySelector('#os-pre-go').addEventListener('click', e => preflight(stage, e.target));

      /* Say what the dial will actually do, in plain words, before the
         clock starts — a slider labelled 0 to 100 tells nobody anything. */
      const bDial = stage.querySelector('#os-pdial-b');
      const bNum = stage.querySelector('#os-pdial-b-v');
      const bSay = stage.querySelector('#os-pdial-say');
      const describe = n => {
        if (n <= 0) return 'The examiner reads each question and then says nothing at all. Closest to a written paper.';
        const p = promptPlan(n);
        const secs = Math.round(p.silenceMs / 1000);
        const pointed = p.pointedChance <= 0
          ? 'The pushes are general — “anything else?”, “go on”.'
          : p.pointedChance < 0.5
            ? 'Most pushes are general; some point at the area you have left out.'
            : 'Most pushes point at the specific area you have left out — never at the answer itself.';
        return `After about ${secs} seconds of silence, and only while a marking point is still unsaid, the examiner
          pushes — at most ${p.maxPerQuestion} time${p.maxPerQuestion === 1 ? '' : 's'} per question. ${pointed}`;
      };
      const paintDial = n => {
        bNum.textContent = n; bSay.innerHTML = describe(n);
        const top = view.querySelector('#os-pdial'), topV = view.querySelector('#os-pdial-v');
        if (top) { top.value = n; topV.textContent = n; top.closest('.os-pdial').classList.toggle('is-off', n === 0); }
      };
      bDial.addEventListener('input', () => { setPromptLevel(Number(bDial.value)); paintDial(Number(bDial.value)); });
      paintDial(promptLevel());
      // fetched in the background while the scenario is being read, then the
      // brief says plainly which voice the candidate is going to hear
      prefetchVoices().then(() => paintVoiceLine(stage)).catch(() => paintVoiceLine(stage));
      stage.querySelector('#os-go').addEventListener('click', async () => {
        await startCapture();
        startClock();
        show(qi);
      });
    }

    /** Which voice the candidate is about to hear, and why. */
    function paintVoiceLine(stage) {
      const el = stage.querySelector('#os-voiceline');
      if (!el) return;
      const r = groqReport();
      if (voices.size) {
        el.className = 'os-voiceline is-groq';
        el.innerHTML = `🎙 <strong>A real examiner voice</strong> is ready${r.model ? ` (${esc(r.model)})` : ''} —
          and it is mixed straight into the recording, so the tape carries both sides even through headphones.`;
        return;
      }
      if (!groqCfg().voice || groqCfg().enabled === false) { el.hidden = true; return; }
      el.className = 'os-voiceline';
      /* A quota that resets in ninety seconds is a different fact from one
         that is gone for the day, and the candidate can act on the first:
         the station picks the real voice back up the moment it returns. */
      const back = r.backIn > 0
        ? ` The quota resets in ${r.backIn < 90 ? `${r.backIn} seconds` : `${Math.round(r.backIn / 60)} minutes`} —
            questions after that get the real voice again.` : '';
      /* The server's sentence already carries the wait it was told; saying it
         twice, once frozen and once counting down, reads as two answers. The
         live one wins and the frozen tail is trimmed. */
      const why = String(r.why || '').replace(/\s*[—-]\s*back in [^.]*/i, back ? '' : '$&').replace(/\.\s*$/, '');
      el.innerHTML = `🔈 The <strong>browser's own voice</strong> will read the questions${
        why ? ` — the real voice is unavailable: <em>${esc(why)}</em>` : ''}.${back}`;
    }

    /* A declaration, not a `const`: brief() calls prefetchVoices() from above
       this point, and a const would still be in its temporal dead zone —
       the same trap the note beside `voices` describes, and the rejection
       lands in the same silent .catch(). */
    function lineOf(q) { return (q.reveal_before ? q.reveal_before + '. ' : '') + q.prompt; }

    async function prefetchVoices() {
      if (voicesReady || !groqOn('voice')) return;
      voicesReady = true;
      for (const q of qs) {
        const clip = await groqVoice(lineOf(q));
        if (!clip) break;                       // quota gone; the browser voice takes over
        voices.set(q.id, clip);
      }
      prefetchNudges();
    }

    /* Fetched once for the whole station: six short lines, spoken over and
       over, cost six requests for a whole fifteen minutes — which is what
       makes the middle of the dial free. */
    async function prefetchNudges() {
      if (promptLevel() <= 0 || !groqOn('voice')) return;
      for (const line of PROMPT_WORDS) {
        if (nudges.has(line)) continue;
        const clip = await groqVoice(line);
        if (!clip) break;
        nudges.set(line, clip);
      }
    }

    /* ---------------- the probe engine ----------------
       Armed when a question is read, disarmed the moment the candidate
       moves on. Watches the microphone rather than the clock, and only
       fires when there is a marking point genuinely still unsaid. */
    const probes = (() => {
      let timer = null, q = null, getText = null;
      let spokenHere = 0, lastAt = 0, quietSince = 0, busy = false, everHeard = false;

      /* THE NOISE FLOOR.

         The first version compared the microphone against a fixed 0.06 and
         called anything below it silence. In a quiet test that works; in a
         real room it never fires at all, because a fan, a corridor, or an
         iPad's own gain control keeps the floor above that line for ever.
         Twenty minutes of waiting and not one push.

         So nothing is assumed about the room. The quietest readings seen so
         far ARE the floor, and speech is what rises clearly above it. The
         floor tracks downward quickly and upward slowly, so a door slamming
         does not permanently deafen the examiner. */
      let floor = null, peakSeen = 0;
      const SPEAK_OVER = 0.045;         // how far above the floor counts as talking
      function listen(lvl) {
        if (lvl < 0) return null;
        floor = floor == null ? lvl : (lvl < floor ? lvl * 0.35 + floor * 0.65 : floor * 0.995 + lvl * 0.005);
        peakSeen = Math.max(peakSeen, lvl);
        return lvl > floor + SPEAK_OVER;
      }
      /** What the strip on screen shows, so this can never fail invisibly. */
      function status() {
        const plan = promptPlan(promptLevel());
        if (plan.off) return { mode: 'off' };
        if (!q) return { mode: 'idle' };
        if (!live?.level || live.level() < 0) return { mode: 'nometer' };
        if (!everHeard) return { mode: 'waiting' };
        if (spokenHere >= plan.maxPerQuestion) return { mode: 'spent' };
        if (!quietSince) return { mode: 'listening' };
        return { mode: 'quiet', left: Math.max(0, plan.silenceMs - (Date.now() - quietSince)) };
      }

      function disarm() { if (timer) clearInterval(timer); timer = null; q = null; paintProbeState(); }

      function armFor(question, textFn) {
        disarm();
        q = question; getText = textFn;
        spokenHere = 0; lastAt = Date.now(); quietSince = 0; everHeard = false;
        timer = setInterval(tick, 500);       // runs even at level 0, to paint the strip
        paintProbeState();
      }

      async function tick() {
        paintProbeState();
        if (busy || !q || !running) return;
        const plan = promptPlan(promptLevel());
        if (plan.off || spokenHere >= plan.maxPerQuestion) return;
        // never in the last minute — the clock is punishment enough
        if (total - elapsed < 60) return;
        if (Date.now() - lastAt < plan.cooldownMs) return;

        const lvl = live?.level ? live.level() : -1;
        /* A device that cannot report a level gets no probing at all rather
           than probing blind. Interrupting someone mid-sentence is worse
           than staying quiet, and there is no way to tell without a meter.
           The strip says so rather than leaving it a mystery. */
        if (lvl < 0) return;
        const talking = listen(lvl);
        if (talking) { everHeard = true; quietSince = 0; return; }
        /* Nothing has been heard above the floor yet. After forty seconds
           that is itself worth a push — someone who has not started may be
           stuck, and a real examiner would not sit through it in silence. */
        if (!everHeard && Date.now() - lastAt < 40000) return;
        if (!quietSince) { quietSince = Date.now(); return; }
        if (Date.now() - quietSince < plan.silenceMs) return;

        const said = (getText && getText()) || '';
        const missing = missingPoints(q, said);
        /* With no live transcript there is nothing to check against, so
           "still missing" cannot be judged — and a station is not a reason
           to go quiet. Everything unsaid is treated as missing, which is
           true at the start and harmless later: the push is generic. */
        const pool = said.trim() ? missing : (q.marking_points || []);
        if (!pool.length) { quietSince = 0; return; }

        busy = true;
        try {
          const pointed = said.trim() && Math.random() < plan.pointedChance;
          let line = null;
          if (pointed) line = await pointedLine(q, pool, said);
          if (!line) line = PROMPT_WORDS[Math.floor(Math.random() * PROMPT_WORDS.length)];
          await sayProbe(line);
          spokenHere++; lastAt = Date.now(); quietSince = 0;
        } catch { /* a probe that fails is a probe that did not happen */ }
        busy = false;
        paintProbeState();
      }

      /* The examiner's state, on screen, always. The whole reason this went
         unnoticed for a version is that a feature that does nothing looks
         exactly like a feature that is switched off. */
      function paintProbeState() {
        const el = document.querySelector('#os-listen');
        if (!el) return;
        const st = status();
        const plan = promptPlan(promptLevel());
        const txt = {
          off: 'Examiner silent — move the dial above zero for pushes',
          idle: '',
          nometer: 'This device gives no microphone level, so the examiner cannot tell when you have stopped — it will not interrupt',
          waiting: 'Examiner listening…',
          spent: `Examiner has pushed ${plan.maxPerQuestion} time${plan.maxPerQuestion === 1 ? '' : 's'} on this question`,
          listening: 'Examiner listening…',
          quiet: `Examiner waiting… ${Math.ceil((st.left || 0) / 1000)}s`
        }[st.mode] || '';
        el.hidden = !txt;
        el.className = 'os-listen is-' + st.mode;
        el.textContent = txt;
      }

      /** One short push about a specific missing point. */
      async function pointedLine(question, missing, said) {
        try {
          if (typeof Wallet !== 'undefined' && !(await Wallet.canSpend())) return null;
          const token = await Backend.getAccessToken();
          if (!token) return null;
          const choice = chosenModel();
          const res = await fetch(cfg().ai.apiBase, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ action: 'osceprobe', provider: choice.provider, model: choice.model,
              dailyLimit: cfg().ai.dailyLimit,
              question: String(question.prompt || '').slice(0, 400),
              said: String(said).slice(-1200),
              missing: missing.slice(0, 6).map(p => String(p).slice(0, 200)) })
          });
          if (!res.ok) return null;
          const d = await res.json().catch(() => ({}));
          const t = String(d.text || '').trim().replace(/^["']|["']$/g, '');
          return t && t.length < 160 ? t : null;
        } catch { return null; }
      }

      /** Say it, onto the tape, and show it so the deaf case still works. */
      async function sayProbe(line) {
        showProbe(line);
        const clip = nudges.get(line) || (groqOn('voice') ? await groqVoice(line) : null);
        if (clip && live?.speakClip) { hush(); if (await live.speakClip(clip)) return; }
        speak(line, { rate: 1.0 });
      }

      function showProbe(line) {
        const host = document.querySelector('#os-probe');
        if (!host) return;
        host.hidden = false;
        host.innerHTML = `<span class="os-probe-who">Examiner</span> ${esc(line)}`;
        host.classList.remove('is-in'); void host.offsetWidth; host.classList.add('is-in');
      }

      return { armFor, disarm, tick, status, paint: paintProbeState };
    })();

    async function startCapture() {
      /* The mix is also wanted when the quota is merely resting: the real
         voice may return part-way through the station, and the recorder
         cannot be re-pointed once it is running. */
      live = makeCapture(stage.querySelector('#os-mic'), voices.size > 0 || groqReport().backIn > 0);
      live.watchState(() => paintRecState(stage));
      await live.start();
    }

    /** Say the examiner's line: the real voice onto the tape, or the browser's. */
    async function examinerSays(q, text) {
      let clip = voices.get(q?.id);
      /* Prefetch stops at the first refusal, so a station that began during a
         one-minute ceiling had the browser voice for all fifteen. If the
         quota has come back by now, this question gets the real voice. */
      if (!clip && q && groqOn('voice')) {
        clip = await groqVoice(text || lineOf(q));
        // only the full line is worth keeping — "repeat" says less than that
        if (clip && text === lineOf(q)) voices.set(q.id, clip);
      }
      if (clip && live?.speakClip) {
        hush();
        const ok = await live.speakClip(clip);
        if (ok) return;
      }
      speak(text);
    }

    /* Whatever the recorder is ACTUALLY doing, on screen, all the time.
       The old code decided this once when the question was drawn and wrote
       the answer into a panel that the first question then destroyed — so a
       refused microphone looked exactly like a working one for fifteen
       minutes. */
    function paintRecState(host) {
      const chip = host.querySelector('#os-rec');
      const warn = host.querySelector('#os-rec-warn');
      const note = host.querySelector('#os-rec-note');
      if (!chip) return;
      const s = live?.state?.() || { recording: false, failed: 'No recording was started.' };
      chip.classList.toggle('is-off', !s.recording);
      chip.classList.toggle('is-paused', !!s.paused);
      chip.innerHTML = `<i></i> ${s.paused ? 'paused' : s.recording ? (s.bothVoices ? 'recording both' : 'recording') : 'not recording'}`;
      chip.title = s.recording && s.bothVoices
        ? 'Your voice and the examiner\'s are both going onto the tape'
        : s.recording ? 'Your voice is being recorded' : '';
      if (note) {
        note.textContent = s.transcribing
          ? 'Speak your answer. What the browser hears appears below — you can correct it later.'
          : 'Speak your answer. This browser does not transcribe as you go, so the recording is the record — type anything you want the marker to be sure of.';
      }
      if (!warn) return;
      const msg = s.failed || (!s.recording && !s.paused ? 'The recording has stopped. Putting it back…' : '');
      warn.hidden = !msg;
      warn.innerHTML = !msg ? ''
        : msg === 'BLOCKED'
          ? `<p class="os-mic-h">⚠ This browser is blocking the microphone for AUREUM</p>
             ${micHelp().map(p => `<p>${p}</p>`).join('')}
             <button class="btn btn-ghost btn-sm" id="os-mic-retry">🎙 Turn the microphone back on</button>`
          : `⚠ ${esc(msg)}${s.failed ? ` <button class="btn btn-ghost btn-sm" id="os-mic-retry">🎙 Turn the microphone back on</button>` : ''}`;
      warn.querySelector('#os-mic-retry')?.addEventListener('click', async e => {
        // this tap is the user gesture iOS requires; nothing else will do
        e.target.disabled = true; e.target.textContent = 'Asking…';
        await live?.retry();
        paintRecState(host);
      });
    }

    function show(i) {
      qi = i; persist(); paintClock();
      const q = qs[i];
      const prev = ans[q.id]?.transcript || '';
      stage.innerHTML = `
        <div class="os-qwrap" data-animate>
          <div class="os-qhead">
            <span class="os-qn">Question ${i + 1} <i>of ${qs.length}</i></span>
            <span class="os-qmarks">${q.marks} marks</span>
          </div>
          ${q.reveal_before ? `<div class="os-reveal"><span>NEW INFORMATION</span><p>${esc(q.reveal_before)}</p></div>` : ''}
          ${imageStrip(q)}
          <p class="os-prompt">${esc(q.prompt)}</p>
          <div class="os-probe" id="os-probe" hidden></div>
          <p class="os-listen" id="os-listen" hidden></p>
          <div class="os-answer">
            <div class="os-answer-head">
              <span class="os-rec" id="os-rec"><i></i> …</span>
              ${canSpeak() ? `<button class="os-voice ${voiceOn() ? '' : 'is-off'}" id="os-voice"
                title="${voiceOn() ? 'The examiner reads each question aloud' : 'The examiner is silent'}">🔊</button>
                <button class="os-voice" id="os-repeat" title="Read the question again">↻</button>` : ''}
              <span class="muted tiny" id="os-rec-note">Speak your answer.</span>
            </div>
            <div class="os-transcript" id="os-tx" contenteditable="true" spellcheck="false"
              data-ph="Your spoken answer appears here…">${esc(prev)}</div>
          </div>
          <div class="os-rec-warn" id="os-rec-warn" hidden></div>
          <div class="os-qfoot">
            <button class="btn btn-ghost" id="os-back" ${i === 0 ? 'disabled' : ''}>← Previous</button>
            <span class="muted tiny" id="os-hint">Take the marks in order — say the headline first, then the detail.</span>
            <button class="btn btn-gold" id="os-next">${i === qs.length - 1 ? 'Finish the station →' : 'Next question →'}</button>
          </div>
        </div>`;
      wireLightbox(stage);
      paintRecState(stage);
      const tx = stage.querySelector('#os-tx');
      live?.attach(text => { if (text) { tx.textContent = (tx.textContent + ' ' + text).trim(); } });
      const store = () => { ans[q.id] = { id: q.id, transcript: tx.innerText.trim() }; persist(); };
      tx.addEventListener('input', store);

      // the examiner reads the question, exactly as one would in the room
      examinerSays(q, (q.reveal_before ? q.reveal_before + '. ' : '') + q.prompt)
        .then(() => probes.armFor(q, () => tx.innerText));
      stage.querySelector('#os-voice')?.addEventListener('click', e => {
        setVoiceOn(!voiceOn());
        e.currentTarget.classList.toggle('is-off', !voiceOn());
        e.currentTarget.title = voiceOn() ? 'The examiner reads each question aloud' : 'The examiner is silent';
        voiceOn() ? speak(q.prompt) : hush();
      });
      stage.querySelector('#os-repeat')?.addEventListener('click', () => examinerSays(q, q.prompt));

      /* Next means next. The examiner does not press you, does not ask
         whether there is anything further, and does not tell you the answer
         was thin — see the note where the probes used to be. */
      stage.querySelector('#os-next').addEventListener('click', () => {
        store(); probes.disarm();
        i + 1 >= qs.length ? finish(false) : show(i + 1);
      });
      stage.querySelector('#os-back').addEventListener('click', () => { store(); probes.disarm(); show(Math.max(0, i - 1)); });
    }

    async function finish(timedOut) {
      if (tid) clearInterval(tid); tid = null; running = false;
      pauseBtn.hidden = true;
      qi = qs.length; s.phase = 'done'; persist();
      hush();
      const rec = live ? await live.stop() : null;
      // tagged with the station so a circuit cannot hand station 2 the tape
      // from station 1
      lastRec = { station: st.id, rec };
      debrief(timedOut, rec);
    }

    /* Whisper, on the way into the debrief.

       Run when the browser captured little or nothing — which on an iPad is
       ALWAYS, since Safari has no recogniser — and the transcript is the only
       thing standing between the candidate and a marked station.

       The scheme's own words go up as a spelling hint, because the terms that
       decide marks are exactly the ones a generic recogniser mangles:
       "mifepristone" came back as "metro trick" on a real attempt.

       It splits the returned text back across the questions by looking for
       where each answer began. When that is not possible the whole transcript
       is put on the first unanswered question rather than thrown away —
       marked text in the wrong place is still worth more than none. */
    async function transcribeIfWorthIt(stage, rec) {
      if (!rec?.blob) return;
      const already = qs.reduce((n, q) => n + ((ans[q.id]?.transcript || '').trim().length), 0);
      if (already > 400) return;                       // the browser did its job
      const host = stage.querySelector('#os-asr');
      if (!host) return;
      /* Nothing was captured AND transcription is unavailable — say so.
         Silence here would leave a blank debrief with no explanation of why
         it is blank, which is the state this whole feature exists to end. */
      if (!groqOn('whisper')) {
        host.hidden = false;
        host.innerHTML = `<p class="muted tiny">${groqOff
          ? 'The free transcription quota is used up for now, and this browser captured little or nothing.'
          : 'This browser captured little or nothing, and transcription is not enabled for your account.'}
          Type your answers below, or choose <strong>Mark from the recording</strong> — that route transcribes as it marks.</p>`;
        return;
      }
      host.hidden = false;
      host.innerHTML = `<div class="ai-loading sm"><span></span><span></span><span></span></div>
        <p class="muted tiny">Transcribing the recording — this browser did not, so it is being done properly.</p>`;
      const hint = qs.flatMap(q => (q.marking_points || [])).join(' ').slice(0, 700);
      let out = null;
      try { out = await groqTranscribe(rec.blob, hint); } catch {}
      if (!out?.text) {
        host.innerHTML = `<p class="muted tiny">${groqOff
          ? 'The free transcription quota is used up for now — type your answers below, or mark from the recording, which transcribes as it marks.'
          : 'The recording could not be transcribed. Type your answers below, or mark from the recording.'}</p>`;
        return;
      }
      /* One transcript, several questions. Anything better than a single
         blob needs to know where the candidate moved on, and nothing on the
         tape says that — so it goes in whole, on the first question, and the
         marker (which has every question in front of it) sorts out which part
         answers what. */
      const first = qs.find(q => !(ans[q.id]?.transcript || '').trim()) || qs[0];
      ans[first.id] = { id: first.id, transcript: out.text };
      persist();
      const box = stage.querySelector(`[data-eq="${CSS.escape(String(first.id))}"]`);
      if (box) { box.innerText = out.text; box.closest('.os-said')?.classList.remove('is-empty'); }
      host.innerHTML = `<p class="os-asr-ok">✓ Transcribed from your recording (${esc(out.model || 'Whisper')}), free of charge.
        It is all on Q${qs.indexOf(first) + 1} — split it across the questions if you like, or leave it: the marker has
        every question in front of it.</p>`;
      // the estimate and the mark button were drawn against an empty transcript
      wireMarkControls(stage, st, ans, qs.map(q => ({ q, t: (ans[q.id]?.transcript || '').trim() })), rec, s);
      const btn = stage.querySelector('#os-mark'); if (btn) btn.disabled = false;
    }

    function debrief(timedOut, rec) {
      paintClock();
      const said = qs.map(q => ({ q, t: (ans[q.id]?.transcript || '').trim() }));
      const spoken = said.filter(x => x.t).length;
      stage.innerHTML = `
        <div class="os-sheet" data-animate>
          <p class="kicker">STATION COMPLETE</p>
          <h2>${esc(st.topic || '')}</h2>
          ${timedOut ? `<p class="os-timeout">⏱ The fifteen minutes ran out — that is the station, exactly as it would be.</p>` : ''}
          <p class="muted">You answered <strong>${spoken}</strong> of ${qs.length} questions in ${fmt(elapsed)}.
            Check the transcript below — the recogniser mishears drug names, and you are marked on what it captured, so
            correct anything it got wrong before marking.</p>
          ${rec?.url ? `<div class="os-rec-box">
            <audio controls src="${rec.url}"></audio>
            <a class="btn btn-ghost btn-sm" href="${rec.url}" download="OSCE-${esc((st.topic || 'station').replace(/[^a-z0-9]+/gi, '-'))}-${new Date().toISOString().slice(0, 10)}.${rec.ext}">⬇ Download the recording</a>
            <span class="muted tiny">${rec.mins} — kept with the result for 24 hours once you mark it, then deleted.</span>
          </div>` : `<p class="muted tiny">No audio was captured for this run.</p>`}
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">What you said</h3>
          <div id="os-asr" class="os-asr" hidden></div>
          ${said.map(({ q, t }, i) => `
            <div class="os-said ${t ? '' : 'is-empty'}">
              <p class="os-said-q"><strong>Q${i + 1}</strong> ${esc(q.prompt)} <span class="muted tiny">(${q.marks})</span></p>
              <div class="os-said-t" contenteditable="true" spellcheck="false" data-eq="${esc(q.id)}"
                data-ph="Nothing was captured for this question">${esc(t)}</div>
            </div>`).join('')}
        </div>

        ${s.circuit ? `<div class="card os-markbox os-markbox-auto" data-animate>
          <h3 class="card-title">✨ This station will be marked while you sit the next one</h3>
          <p class="muted">Correct the transcript above if the recogniser mangled a drug name — then move on. The
            recording and your answers are sent for marking as you leave, one station at a time, and every result is
            waiting together at the end of the circuit. Nothing is lost if a marking fails: the recording is kept for
            24 hours and you can send it again from the results page.</p>
        </div>` : `<div class="card os-markbox" data-animate>
          <h3 class="card-title">✨ Mark it against the scheme</h3>
          <p class="muted">Every scheme point is marked covered, partial or missed, and you get an examiner's verdict,
            the marks you missed and what to do about them. This is the only step that uses AI, and what it costs is
            shown before you press the button.</p>
          <div class="os-src" id="os-src"></div>
          <div id="os-coach-box"></div>
          <div class="os-mark-acts">
            <div class="os-prov" id="os-prov"></div>
            <button class="btn btn-gold btn-lg" id="os-mark" ${spoken || rec?.blob ? '' : 'disabled'}>Mark this station</button>
          </div>
          <p class="os-est" id="os-est"></p>
          ${spoken || rec?.blob ? '' : '<p class="muted tiny">Nothing was captured, so there is nothing to mark. Type your answers above if you want it marked anyway.</p>'}
          <div id="os-mark-out"></div>
        </div>`}

        <div class="os-run-foot">
          ${s.circuit
            ? (s.at + 1 < s.stations.length
                ? `<button class="btn btn-primary btn-lg" id="os-nextst">Next station (${s.at + 2} of ${s.stations.length}) →</button>`
                : `<button class="btn btn-gold btn-lg" id="os-nextst">Finish the circuit and see the results →</button>`)
            : `<a class="btn btn-ghost" href="#/osce">Back to the stations</a>`}
        </div>`;

      stage.querySelectorAll('[data-eq]').forEach(el => {
        el.addEventListener('input', () => {
          ans[el.dataset.eq] = { id: el.dataset.eq, transcript: el.innerText.trim() }; persist();
        });
        // dictate a correction rather than typing it on a tablet keyboard
        const q = qs.find(x => String(x.id) === el.dataset.eq);
        const mic = micButton(el, { hint: (q?.marking_points || []).join(' ').slice(0, 400), maxSecs: 120 });
        if (mic) el.parentNode.insertBefore(mic, el.nextSibling);
      });
      transcribeIfWorthIt(stage, rec);
      // a circuit has no marking controls to wire: it marks itself as you leave
      if (!s.circuit) wireMarkControls(stage, st, ans, said, rec, s);
      /* In a circuit, leaving a station HANDS IT OVER rather than waiting on
         it: the tape and the transcript join the queue, and the clock for the
         next station starts while the last one is being marked. The results
         are collected at the end, where the candidate has time to read them. */
      stage.querySelector('#os-nextst')?.addEventListener('click', async ev => {
        ev.target.disabled = true;
        const last = s.at + 1 >= s.stations.length;
        const already = loadMarks(sid)[st.id];
        const worthMarking = spoken || rec?.blob;
        if (!already && worthMarking) {
          saveMark(sid, st.id, { status: 'queued', at: Date.now() });
          queueMark({ sid, st, ans: Object.assign({}, ans), rec, session: { elapsed },
            choice: chosenModel(), attemptId: 'oa-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) });
        } else if (!already) {
          saveMark(sid, st.id, { status: 'skipped', message: 'Nothing was captured for this station.', at: Date.now() });
        }
        if (last) {
          s.phase = 'circuit'; await saveSession(s); stopLive();
          location.hash = '#/osce/circuit/' + sid;
          return;
        }
        s.at += 1; s.qi = 0; s.elapsed = 0; s.phase = 'brief';
        await saveSession(s); stopLive(); renderRun(view, sid, user);
      });
    }
  }

  /* ---------------- the pre-flight ----------------
     Opens the microphone, watches the level for a moment and lets go. Run
     before the clock starts, so a blocked microphone costs ten seconds rather
     than a station — and so the fix, which on Safari means leaving the page
     for the Settings app, can be done without losing an attempt. */

  async function preflight(stage, btn) {
    const host = stage.querySelector('#os-pre');
    btn.disabled = true; btn.textContent = 'Testing…';
    let media = null;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = String(e && e.name || e);
      host.innerHTML = /NotAllowed|SecurityError/i.test(name)
        ? `<div class="os-rec-warn"><p class="os-mic-h">⚠ This browser is blocking the microphone for AUREUM</p>
             ${micHelp().map(p => `<p>${p}</p>`).join('')}
             <button class="btn btn-ghost btn-sm" id="os-pre-again">🎙 Test again</button>
             <p class="muted tiny">You can still sit the station — type your answers instead of speaking, and mark
               from the transcript.</p></div>`
        : `<div class="os-rec-warn">⚠ The microphone could not be opened (${esc(name)}).
             <button class="btn btn-ghost btn-sm" id="os-pre-again">🎙 Test again</button></div>`;
      host.querySelector('#os-pre-again').addEventListener('click', ev => preflight(stage, ev.target));
      return;
    }

    /* Show that sound is actually arriving. A microphone that opens but hears
       nothing — muted hardware, the wrong input — looks identical to a
       working one until the debrief. */
    let peak = 0;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ac = new Ctx();
      const src = ac.createMediaStreamSource(media);
      const an = ac.createAnalyser(); an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      host.innerHTML = `<div class="os-pre-live">
        <span class="os-pre-k">Say something…</span>
        <span class="os-pre-bar"><i id="os-pre-i"></i></span>
      </div>`;
      const bar = host.querySelector('#os-pre-i');
      const t0 = Date.now();
      await new Promise(res => {
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let m = 0;
          for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] - 128));
          peak = Math.max(peak, m);
          if (bar) bar.style.width = Math.min(100, (m / 60) * 100) + '%';
          if (Date.now() - t0 > 4000) return res();
          requestAnimationFrame(tick);
        };
        tick();
      });
      try { await ac.close(); } catch {}
    } catch { peak = -1; }
    try { media.getTracks().forEach(t => t.stop()); } catch {}

    host.innerHTML = peak > 6
      ? `<p class="os-pre-ok">✓ The microphone is working — it heard you. Start when you are ready.</p>`
      : peak < 0
        ? `<p class="os-pre-ok">✓ The microphone opened. Start when you are ready.</p>`
        : `<div class="os-rec-warn">⚠ The microphone opened but heard almost nothing. Check it is not muted, and that
             the right input is selected, then test again.
             <button class="btn btn-ghost btn-sm" id="os-pre-again">🎙 Test again</button></div>`;
    host.querySelector('#os-pre-again')?.addEventListener('click', ev => preflight(stage, ev.target));
  }

  /* ---------------- microphone + recogniser ---------------- */

  function makeCapture(host, wantMix) {
    let media = null, rec = null, chunks = [], sr = null, onText = null, mime = '', started = 0;
    let onState = null, watch = null, failed = '';
    const say = (msg, cls) => { if (host) host.innerHTML = `<p class="os-mic-msg ${cls || ''}">${msg}</p>`; };

    /* The truth about whether anything is being recorded, asked of the
       recorder and the microphone track rather than remembered from when the
       station started. A candidate who thinks they are being recorded for
       fifteen minutes and is not has wasted the fifteen minutes. */
    function state() {
      const track = media?.getAudioTracks?.()[0];
      return {
        recording: rec?.state === 'recording' && track?.readyState === 'live' && !track.muted,
        paused: rec?.state === 'paused',
        everStarted: !!started,
        bothVoices: bothVoices(),
        failed,
        secs: started ? Math.round((Date.now() - started) / 1000) : 0,
        transcribing: !!sr
      };
    }
    let last = '';
    function ping() {
      const s = state();
      const key = `${s.recording}|${s.paused}|${s.failed}`;
      if (key !== last) { last = key; onState?.(s); }
    }

    /* ASK FOR THE PLAIN MICROPHONE, ALWAYS.

       v63 asked for { echoCancellation: false, … } up front so the tape would
       also carry the examiner's voice off the speaker. On iPadOS that request
       is rejected outright rather than merely ignored, and — worse — the
       rejection consumes the user gesture, so the fallback to a plain request
       fails too and the whole thing reports "the microphone was refused" on a
       device where the microphone was never actually asked for.

       So: open the microphone the way that has always worked, THEN try to
       relax echo cancellation on the track that is already running. If the
       platform will not do it, the recording is unaffected — only the
       examiner's voice is missing from the tape, which is a preference, not
       the feature. Never let a nicety cost the recording. */
    async function openMic() {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (examinerOnTape()) {
        const track = media.getAudioTracks()[0];
        try { await track?.applyConstraints({ echoCancellation: false, noiseSuppression: false }); }
        catch { /* the tape will carry the candidate only; the station still runs */ }
      }
      return media;
    }
    /** Did the relaxed constraint actually take? Reported honestly on screen. */
    function bothVoices() {
      if (!examinerOnTape()) return false;
      try { return media?.getAudioTracks()[0]?.getSettings?.().echoCancellation === false; }
      catch { return false; }
    }

    /* ---- the mixing desk ----
       When the examiner has a real voice, the tape is built rather than
       overheard: the microphone and the examiner's audio are summed in Web
       Audio and the recorder is pointed at the SUM. That puts both voices on
       the recording by construction — through headphones, on any device, with
       echo cancellation left on where it belongs. Without Groq the recorder
       goes straight at the microphone as it always did. */
    let acx = null, mixDest = null, micNode = null;
    function mixer() {
      if (mixDest) return mixDest;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx || !media) return null;
      try {
        acx = acx || new Ctx();
        mixDest = acx.createMediaStreamDestination();
        micNode = acx.createMediaStreamSource(media);
        micNode.connect(mixDest);
        return mixDest;
      } catch { mixDest = null; return null; }
    }
    /** Play a clip out loud AND onto the tape. Resolves when it has finished. */
    async function speakClip(clip) {
      const dest = mixer();
      if (!dest || !acx) return false;
      try {
        if (acx.state === 'suspended') await acx.resume();
        const buf = await acx.decodeAudioData(b64ToBuf(clip.data));
        const src = acx.createBufferSource();
        src.buffer = buf;
        src.connect(dest);              // onto the recording
        src.connect(acx.destination);   // and out of the speaker
        await new Promise(res => { src.onended = res; src.start(); });
        return true;
      } catch { return false; }
    }
    /** What the recorder should listen to: the mix if there is one, else the mic. */
    const recordFrom = () => (mixDest ? mixDest.stream : media);

    /* A loudness reading, so the examiner can tell talking from a pause.
       Built on its own tiny graph rather than the mixer's, because the
       mixer only exists when the examiner has a real voice, and the pause
       matters either way. Returns 0..1, or -1 when it cannot tell — and a
       caller that cannot tell must never guess that the room is silent. */
    let lvlCtx = null, lvlNode = null, lvlBuf = null;
    function level() {
      if (!media) return -1;
      try {
        if (!lvlNode) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return -1;
          lvlCtx = lvlCtx || new Ctx();
          const src = lvlCtx.createMediaStreamSource(media);
          lvlNode = lvlCtx.createAnalyser();
          lvlNode.fftSize = 512;
          src.connect(lvlNode);
          lvlBuf = new Uint8Array(lvlNode.frequencyBinCount);
        }
        lvlNode.getByteTimeDomainData(lvlBuf);
        let peak = 0;
        for (let i = 0; i < lvlBuf.length; i++) peak = Math.max(peak, Math.abs(lvlBuf[i] - 128));
        return peak / 128;
      } catch { return -1; }
    }

    async function start() {
      try {
        media = await openMic();
      } catch (e) {
        /* Say WHICH refusal it was. "The microphone was refused" sent someone
           hunting a permission that was never the problem, so the name of the
           error now decides the wording — and on an iPad the answer is nearly
           always the per-site setting behind the aA menu. */
        const name = String(e && e.name || e);
        failed = /NotAllowed|SecurityError/i.test(name)
          ? 'BLOCKED'                                   // the panel spells out the fix for this browser
          : /NotFound|Devices/i.test(name)
            ? 'No microphone was found on this device. You can still type your answers.'
            : /NotReadable|Aborted/i.test(name)
              ? 'Another app is using the microphone. Close it, then tap “Turn the microphone back on”.'
              : `The microphone could not be started (${name}). Tap “Turn the microphone back on” to try again.`;
        say('⚠ ' + failed, 'is-warn');
        ping();
        return;
      }
      mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
        .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      try {
        // 24 kbps opus is plainly intelligible speech and keeps a 15-minute
        // station near 2.5 MB — small enough to send for marking
        // with a real examiner voice the mix is built first, so the tape
        // carries both sides; without it this is the bare microphone
        if (wantMix) mixer();
        rec = new MediaRecorder(recordFrom(), Object.assign(mime ? { mimeType: mime } : {}, { audioBitsPerSecond: 24000 }));
        rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onerror = () => { failed = 'The recording stopped unexpectedly.'; ping(); revive(); };
        rec.start(1000);
        started = started || Date.now();
      } catch { rec = null; failed = 'This browser would not start a recording.'; }

      /* iOS hands the audio session to the speech synthesiser when the
         examiner reads a question, which silently ends the capture. Watch for
         it and put the recording back rather than discovering at the debrief
         that fourteen of the fifteen minutes are missing. */
      media.getAudioTracks().forEach(t => t.addEventListener('ended', () => {
        failed = 'The microphone was switched off — another app may have taken it. Tap “Turn the microphone back on”.';
        ping();
      }));
      clearInterval(watch);
      // only ever restarts the RECORDER, never re-asks for the microphone
      watch = setInterval(() => { const s = state(); ping(); if (!s.recording && !s.paused && trackLive()) revive(); }, 2000);
      // the browser's own recogniser: free, and good enough once you correct it
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        try {
          sr = new SR();
          sr.continuous = true; sr.interimResults = false; sr.lang = 'en-GB';
          sr.onresult = e => {
            let out = '';
            for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) out += e.results[i][0].transcript;
            if (out && onText) onText(out.trim());
          };
          // recognisers stop themselves on silence; keep it alive for the station
          sr.onend = () => { if (sr && !sr._stopped) { try { sr.start(); } catch {} } };
          sr.start();
        } catch { sr = null; }
      }
      say(sr ? '🎙 Listening — speak normally.' : '🎙 Recording. This browser has no live transcription, so type your answers as you go (the audio is still saved).', sr ? 'is-on' : 'is-warn');
    }
    function attach(fn) { onText = fn; }
    function watchState(fn) { onState = fn; last = ''; ping(); }

    /* Putting a stalled recording back WITHOUT asking for the microphone
       again. iOS grants getUserMedia only inside a user gesture, so a
       watchdog that called it every two seconds could never succeed — it
       would just fail repeatedly and, on some versions, sour the permission
       for the rest of the visit. A recorder that stopped while its track is
       still live needs no permission at all: start a new one on the track
       already in hand and keep the chunks, so the tape runs on unbroken.

       If the TRACK itself has died, only the candidate can revive it, so the
       warning offers a button instead of retrying behind their back. */
    let reviving = false;
    function trackLive() {
      const t = media?.getAudioTracks?.()[0];
      return !!t && t.readyState === 'live';
    }
    async function revive() {
      if (reviving || paused_ || !trackLive()) return;
      reviving = true;
      try {
        try { rec?.state !== 'inactive' && rec.stop(); } catch {}
        rec = new MediaRecorder(recordFrom(), Object.assign(mime ? { mimeType: mime } : {}, { audioBitsPerSecond: 24000 }));
        rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onerror = () => { ping(); };
        rec.start(1000);
        failed = '';
      } catch { failed = 'The recording stopped and could not be restarted. Tap “Turn the microphone back on”.'; }
      reviving = false;
      ping();
    }

    /** The candidate's own tap — the only thing iOS accepts as permission. */
    async function retry() {
      failed = '';
      ping();
      try { media?.getTracks().forEach(t => t.stop()); } catch {}
      media = null; rec = null;
      await start();
      return state();
    }

    let paused_ = false;
    function pause() { paused_ = true; try { rec?.state === 'recording' && rec.pause(); } catch {} try { if (sr) { sr._stopped = true; sr.stop(); } } catch {} ping(); }
    function resume() { paused_ = false; try { rec?.state === 'paused' && rec.resume(); } catch {} try { if (sr) { sr._stopped = false; sr.start(); } } catch {} ping(); }
    async function stop() {
      clearInterval(watch); watch = null;
      try { if (sr) { sr._stopped = true; sr.stop(); } } catch {}
      const done = new Promise(res => { if (!rec) return res(null); rec.onstop = () => res(true); try { rec.stop(); } catch { res(null); } });
      await done;
      try { media?.getTracks().forEach(t => t.stop()); } catch {}
      if (!chunks.length) return null;
      const type = mime || 'audio/webm';
      const blob = new Blob(chunks, { type });
      const secs = Math.round((Date.now() - started) / 1000);
      return { url: URL.createObjectURL(blob), blob, mime: type, ext: /mp4|aac/.test(type) ? 'm4a' : 'webm',
        bytes: blob.size, secs,
        mins: `${fmt(secs)} of audio · ${(blob.size / 1024 / 1024).toFixed(1)} MB` };
    }
    return { ok: () => !!rec, start, attach, pause, resume, stop, state, watchState, retry, bothVoices,
      speakClip, level, mixed: () => !!mixDest,
      kill: () => { clearInterval(watch); watch = null;
        try { lvlCtx?.close(); } catch {} lvlCtx = lvlNode = null;
        try { sr && (sr._stopped = true, sr.stop()); } catch {}
        try { rec?.state !== 'inactive' && rec.stop(); } catch {}
        try { media?.getTracks().forEach(t => t.stop()); } catch {}
        try { acx?.close(); } catch {} } };
  }
  function stopLive() { try { live?.kill(); } catch {} live = null; }

  /* ---------------- AI marking ---------------- */

  let lastRec = null;              // the recording from the station just finished
  /* What the CANDIDATE asked for, which is not always what is possible: a
     text-only model forces the transcript route, but choosing a listening
     model again must put the recording back — the preference was never
     theirs to lose. */
  let srcWanted = 'audio';

  /* ---------------- what a marking will cost, before you press ----------------
     Audio is tokenised at ~32 tokens a second, so the size of the bill is
     knowable in advance and is shown in dollars AND rupees. Nobody should
     spend money on a button whose price they cannot see. */
  /** The route actually available, given what was recorded and what the model can do. */
  const effectiveSource = (rec, choice) =>
    (srcWanted === 'audio' && rec?.blob && choice.audio) ? 'audio' : 'text';

  function estimate(st, said, rec, choice) {
    const schemeWords = qsOf(st).reduce((n, q) =>
      n + (q.prompt + ' ' + (q.marking_points || []).join(' ')).split(/\s+/).length, 0);
    const spokenWords = said.reduce((n, x) => n + x.t.split(/\s+/).filter(Boolean).length, 0);
    const useAudio = effectiveSource(rec, choice) === 'audio';
    const inTok = useAudio
      ? Math.round((rec.secs || 900) * 32) + Math.round(schemeWords * 1.3) + 400
      : Math.round((spokenWords + schemeWords) * 1.3) + 500;
    const outTok = 900 + qsOf(st).length * (useAudio ? 220 : 120);   // transcripts cost output too
    const usd = (inTok / 1e6) * (choice.rate.in || 0) + (outTok / 1e6) * (choice.rate.out || 0);
    const rate = (typeof Wallet !== 'undefined') ? Wallet.rate() : 340;
    return { inTok, outTok, total: inTok + outTok, usd, lkr: usd * rate, rate, useAudio };
  }
  const money = e => `$${e.usd < 0.01 ? e.usd.toFixed(4) : e.usd.toFixed(3)} · LKR ${e.lkr.toFixed(2)}`;

  function wireMarkControls(stage, st, ans, said, rec, session) {
    const coachHost = stage.querySelector('#os-coach-box');
    if (coachHost) { coachHost.innerHTML = coachPicker(!!rec?.blob); wireCoachPicker(coachHost); }
    const srcHost = stage.querySelector('#os-src');
    const provHost = stage.querySelector('#os-prov');
    const estHost = stage.querySelector('#os-est');
    const hasAudio = !!rec?.blob;
    if (!hasAudio) srcWanted = 'text';

    const paint = () => {
      const choice = chosenModel();
      const src = effectiveSource(rec, choice);
      srcHost.innerHTML = `
        <div class="os-src-opts">
          <button class="os-src-b ${src === 'audio' ? 'active' : ''} ${hasAudio && choice.audio ? '' : 'is-off'}"
            data-src="audio" ${hasAudio && choice.audio ? '' : 'disabled'}>
            <span class="os-src-t">🎧 Mark from the recording</span>
            <span class="os-src-d">${hasAudio
              ? (choice.audio
                  ? 'The model listens to you and transcribes it itself — the accurate way. It hears hesitancy and self-correction, which a typed transcript throws away.'
                    + (choice.audioFormat === 'wav'
                        ? ` <em>${esc(choice.label)} only accepts WAV, so the recording is re-encoded here first — a bigger upload, and consonants soften at the lower sample rates a long station needs.</em>` : '')
                  : esc(noAudioReason(choice)))
              : 'No recording was captured for this station.'}</span>
          </button>
          <button class="os-src-b ${src === 'text' ? 'active' : ''}" data-src="text">
            <span class="os-src-t">📝 Mark from the transcript</span>
            <span class="os-src-d">Marks the text above as it stands. Cheaper, but only as good as what the browser heard.</span>
          </button>
        </div>`;
      // the price is on every option, so "which is cheaper" is a fact on
      // screen rather than something to look up
      provHost.innerHTML = `<label class="os-prov-l">Marked by
        <select class="sel" id="os-model-sel">${modelChoices().map(m =>
          `<option value="${esc(m.key)}" ${m.key === choice.key ? 'selected' : ''}>${esc(m.label)} — $${m.rate.in}/$${m.rate.out} per 1M${m.audio ? '' : ' · no audio'}</option>`).join('')}</select></label>`;
      const e = estimate(st, said, rec, choice);
      estHost.innerHTML = `<span class="os-est-k">Before you press:</span>
        about <strong>${e.total.toLocaleString('en-US')}</strong> tokens
        (${e.inTok.toLocaleString('en-US')} in + ${e.outTok.toLocaleString('en-US')} out) on
        <strong>${esc(choice.label)}</strong> — <strong>${money(e)}</strong>
        <span class="muted tiny">at LKR ${e.rate}/USD${e.useAudio ? ` · ${fmt(rec.secs || 0)} of audio` : ''}</span>`;
      srcHost.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', () => {
        if (b.disabled) return; srcWanted = b.dataset.src; paint();
      }));
      provHost.querySelector('#os-model-sel').addEventListener('change', ev => { setModel(ev.target.value); paint(); });
    };
    paint();
    stage.querySelector('#os-mark')?.addEventListener('click', e => mark(e.target, st, ans, rec, session));
  }

  async function mark(btn, st, ans, rec, session) {
    const out = document.querySelector('#os-mark-out');
    const choice = chosenModel();
    const useAudio = effectiveSource(rec, choice) === 'audio';
    btn.disabled = true;
    out.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>
      <p class="muted tiny">${useAudio ? 'Listening to the recording and marking' : 'Marking'} ${qsOf(st).length} answers against
        ${qsOf(st).reduce((n, q) => n + (q.marking_points || []).length, 0)} marking points…</p>`;
    try {
      const attempt = await markCore({ st, ans, rec, session, choice,
        say: t => { const n = out.querySelector('.os-mark-step'); if (n) n.textContent = t;
          else out.insertAdjacentHTML('beforeend', `<p class="muted tiny os-mark-step">${esc(t)}</p>`); } });
      out.innerHTML = '';
      location.hash = '#/osce/result/' + attempt.id;
    } catch (e) {
      out.innerHTML = `<p class="ai-error">${esc(e.message || e)}</p>`;
      btn.disabled = false;
    }
  }

  /* ================= marking a circuit in the background =================

     WHY THIS SHAPE, and not "keep every tape and send them all at the end":

     • Nine fifteen-minute tapes is roughly 25 MB of Blob held in one tab for
       two hours. On an iPad that is exactly the sort of tab iOS reclaims —
       and it would take the whole circuit with it. Sending each station as
       it finishes means the recording stops being the browser's problem
       within a minute of the clock stopping.
     • The wait lands where there is time to spare. Marking takes as long as
       it takes; doing it while the candidate reads the next scenario spends
       time that was going to be spent anyway. Batching nine at the end puts
       every second of it at the one moment they are waiting to see results.
     • A failure surfaces at station three, not after station nine, and the
       tape is still to hand.
     • Nine audio uploads fired together is the shape most likely to trip a
       per-minute limit. One at a time never does.

     So: one worker, one job at a time, started the moment a station is left.
     The queue survives navigation within the app because it lives here, in
     the module — not in the view. It does not survive a reload, which is why
     each job's outcome is written into the session as it lands. */

  const markQ = [];
  let markBusy = false;
  const markWatchers = new Set();
  function onMarkChange(fn) { markWatchers.add(fn); return () => markWatchers.delete(fn); }
  function markPing() { markWatchers.forEach(fn => { try { fn(); } catch {} }); }
  /** What the circuit results page needs to draw itself, without the tapes. */
  function markState(sid) {
    const jobs = markQ.filter(j => j.sid === sid);
    return { queued: jobs.length, busy: markBusy && jobs.some(j => j.running) };
  }

  async function queueMark(job) {
    markQ.push(job);
    markPing();
    if (!markBusy) drainMarks();
  }

  async function drainMarks() {
    if (markBusy) return;
    markBusy = true;
    while (markQ.length) {
      const job = markQ[0];
      job.running = true; markPing();
      const meta = {};
      try {
        const attempt = await markCore({ st: job.st, ans: job.ans, rec: job.rec, session: job.session,
          choice: job.choice, attemptId: job.attemptId, meta });
        saveMark(job.sid, job.st.id, { status: 'done', attemptId: attempt.id,
          percent: attempt.result?.percent ?? null, pass: !!attempt.result?.pass, at: Date.now() });
      } catch (e) {
        /* A failure is recorded, never swallowed. The tape went up before
           the model was called, so `retryMark` has something to send. */
        saveMark(job.sid, job.st.id, { status: 'error', message: String(e.message || e),
          attemptId: meta.attemptId || job.attemptId, audioPath: meta.audioPath || null,
          secs: job.rec?.secs || 0, at: Date.now() });
      }
      markQ.shift();
      try { if (job.rec?.url) URL.revokeObjectURL(job.rec.url); } catch {}
      markPing();
    }
    markBusy = false;
    markPing();
  }

  /* Re-send a station whose marking failed. The recording is on the server
     for 24 hours precisely so this is possible after the tab that recorded
     it has gone. */
  async function retryMark(sid, stationId, onStep = () => {}) {
    const s = await loadSession(sid);
    if (!s) throw new Error('That circuit is no longer stored.');
    const st = await station(stationId);
    if (!st) throw new Error('That station is no longer published.');
    const entry = loadMarks(sid)[stationId] || {};
    const ans = (s.answers || {})[stationId] || {};
    let rec = null;
    /* The local backend keys the tape by attempt id, the cloud one by the
       storage path it handed back. Whichever this build is, the value the
       upload returned is the one that works. */
    const handle = entry.audioPath || entry.attemptId;
    if (handle) {
      onStep('Fetching the recording that was kept…');
      try {
        const url = await Backend.getOsceAudioUrl(handle);
        if (url) {
          const blob = await (await fetch(url)).blob();
          if (blob && blob.size > 1000) rec = { blob, mime: blob.type || 'audio/webm', secs: entry.secs || 0 };
        }
      } catch { /* fall through: the transcript alone can still be marked */ }
    }
    if (!rec) onStep('The recording is no longer on the server — marking from the transcript instead.');
    const attempt = await markCore({ st, ans, rec, session: s, choice: chosenModel(), say: onStep,
      attemptId: entry.attemptId,
      // already stored: do not upload the same tape a second time
      kept: rec && entry.audioPath ? { path: entry.audioPath, expires: entry.audioExpires } : null });
    saveMark(sid, stationId, { status: 'done', attemptId: attempt.id,
      percent: attempt.result?.percent ?? null, pass: !!attempt.result?.pass, at: Date.now() });
    markPing();
    return attempt;
  }

  /* ---------------- the marking core ----------------
     One path, used by the button on a single station and by the background
     queue in a circuit. Two things are deliberate here:

     • The TAPE GOES UP FIRST, before the model is called. It used to be
       uploaded only after a successful marking, which meant a failed
       marking took the recording with it — the one case where you most
       want it back. Now the audio survives the failure and the same
       station can be re-sent from the server for the 24 hours it is kept.

     • The attempt id is minted BEFORE either step, because it is the name
       the tape is stored under and the two must agree. */
  async function markCore({ st, ans, rec, session, choice, say = () => {}, kept = null, attemptId = null, meta = {} }) {
    if (typeof Wallet !== 'undefined' && !(await Wallet.canSpend())) throw new Error(Wallet.blockedMessage());
    const token = await Backend.getAccessToken();
    if (!token) throw new Error('Sign in to have a station marked.');
    const id = attemptId || ('oa-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    const useAudio = effectiveSource(rec, choice) === 'audio';

    /* `meta` is filled in as the upload succeeds, so the CALLER holds the
       storage path even when the marking that follows throws. Without it a
       failed station had nowhere to retry from. */
    let audioPath = kept?.path || null, audioExpires = kept?.expires || null;
    if (rec?.blob && !audioPath) {
      try {
        say('Keeping the recording…');
        const up = await Backend.uploadOsceAudio(id, rec.blob);
        if (up) { audioPath = up.path; audioExpires = up.expires; }
      } catch { /* the marking is the point; the tape is a bonus */ }
    }
    meta.attemptId = id; meta.audioPath = audioPath; meta.audioExpires = audioExpires;
    return markSend({ id, st, ans, rec, session, choice, useAudio, say, audioPath, audioExpires, token });
  }

  async function markSend({ id, st, ans, rec, session, choice, useAudio, say, audioPath, audioExpires, token }) {
    {
      const body = {
        action: 'osce', provider: choice.provider, model: choice.model, dailyLimit: cfg().ai.dailyLimit,
        station: { topic: st.topic, scenario: st.scenario, total_marks: marksOf(st), pass_mark: passOf(st),
          // the CAPTION goes, never the image: the marking points are text and
          // the model does not need to read the trace to know whether the
          // candidate described it — but it does need to know one was on screen
          questions: qsOf(st).map(q => ({ id: q.id, prompt: q.prompt, marks: q.marks,
            marking_points: q.marking_points || [],
            shown: (q.images || []).length
              ? (q.images.map(im => im.caption).filter(Boolean).join('; ') || 'an image')
              : '' })) },
        answers: qsOf(st).map(q => ({ id: q.id, transcript: (ans[q.id]?.transcript || '') })),
        // only what can honestly be answered for THIS attempt
        coach: coachFor(coachWanted(), !!rec?.blob)
      };
      if (useAudio) {
        // a model that needs WAV gets the tape re-encoded; everything else
        // gets it exactly as it was recorded
        let send = rec.blob, mime = rec.mime || 'audio/webm';
        if (choice.audioFormat === 'wav') {
          say(`Re-encoding the recording for ${choice.label}…`);
          const w = await toWav(rec.blob, rec.secs);
          send = w.blob; mime = 'audio/wav';
          say(`Re-encoded to ${(w.rate / 1000)} kHz mono — ${(w.bytes / 1048576).toFixed(1)} MB to upload.`);
        }
        body.audio = { mime, data: await toBase64(send) };
      }
      say('Marking against the scheme…');
      const res = await fetch(cfg().ai.apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Marking failed (HTTP ${res.status}).`);
      const result = parseResult(data.text, st);
      // when the model listened, IT produced the transcripts — keep them
      const answers = qsOf(st).map(q => {
        const fromModel = (result.questions || []).find(x => String(x.id) === String(q.id))?.transcript;
        return { id: q.id, transcript: (data.heard && fromModel != null) ? fromModel : (ans[q.id]?.transcript || '') };
      });
      const rate = (typeof Wallet !== 'undefined') ? Wallet.rate() : 340;
      const usd = ((data.usage?.in || 0) / 1e6) * (choice.rate.in || 0) + ((data.usage?.out || 0) / 1e6) * (choice.rate.out || 0);
      const attempt = {
        id,
        station_id: st.id, station: { topic: st.topic, scenario: st.scenario, total_marks: marksOf(st), pass_mark: passOf(st) },
        // the blueprint tag is copied onto the attempt: a station may be
        // re-tagged later, and a past result must keep the module it was
        // actually sat under or the coverage map rewrites its own history
        bp: OsceBlueprint.tagOf(st) || null,
        questions: qsOf(st), answers, result, created: Date.now(),
        model: data.model || choice.model, modelLabel: choice.label, provider: choice.provider,
        heard: !!data.heard, elapsed: session?.elapsed || null,
        cost: { inTok: data.usage?.in || 0, outTok: data.usage?.out || 0, usd, lkr: usd * rate, rate }
      };
      /* The tape is already up — it went before the model was called, so a
         failed marking leaves something to retry with. Record where. */
      if (audioPath) { attempt.audioPath = audioPath; attempt.audioExpires = audioExpires; attempt.audioSecs = rec?.secs || null; }
      try { await Backend.saveOsceAttempt(attempt); } catch {}
      try { if (typeof Wallet !== 'undefined') Wallet.bust(); } catch {}

      /* The candidate's own Drive, if they connected one. Deliberately the
         LAST thing, deliberately not awaited, and deliberately unable to
         affect the return: the marking is the deliverable, and an upload
         that fails must cost the recording, never the result. */
      if (rec?.blob && typeof Drive !== 'undefined' && Drive.on()) {
        Drive.upload(rec.blob, Drive.nameFor(st.topic, attempt.created, rec.ext || 'webm'), {
          description: `AUREUM OSCE — ${st.topic || ''} — ${attempt.result?.percent ?? '?'}%`,
          properties: { attempt: attempt.id, station: st.id }
        }).then(up => {
          if (!up) return;
          attempt.drive = { id: up.id, link: up.link, name: up.name };
          Backend.saveOsceAttempt(attempt).catch(() => {});
        }).catch(() => {});
      }
      return attempt;
    }
  }

  function b64ToBuf(b64) {
    const bin = atob(String(b64));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  const toBase64 = blob => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(new Error('Could not read the recording.'));
    fr.readAsDataURL(blob);
  });

  /* ---------------- re-encoding the tape for models that need WAV ----------------

     The recorder produces webm/opus, which is the right thing to store: a
     15-minute station is about 2.5 MB. Gemini reads it as it is.

     OpenAI does not — its input_audio part accepts wav or mp3 only. So for a
     GPT model the tape is decoded with WebAudio and written out as mono
     16-bit PCM. WAV is uncompressed, which is the whole problem: 15 minutes
     at 16 kHz is 28 MB before base64, and base64 adds a third again. The
     sample rate is therefore chosen to fit the ceiling rather than fixed —
     16 kHz where the station is short enough, down to 8 kHz for a full
     15-minute one. Speech stays intelligible throughout; consonants get less
     crisp as it drops, which is worth saying out loud in the UI rather than
     hiding, because drug names are exactly what suffers.

     If even the lowest rate will not fit, this refuses rather than uploading
     something that is going to be rejected at the far end. */
  const WAV_RATES = [16000, 12000, 8000];
  const WAV_CEILING = 24 * 1024 * 1024;        // bytes of base64, under the server's 34 MB cap

  function wavRateFor(secs) {
    const fits = r => Math.ceil((44 + secs * r * 2) * 4 / 3) <= WAV_CEILING;
    return WAV_RATES.find(fits) || 0;
  }

  async function toWav(blob, secs) {
    const rate = wavRateFor(secs || 900);
    if (!rate) throw new Error('That recording is too long to send to a model that needs WAV. Mark it on Gemini, which takes the recording as it is, or mark from the transcript.');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('This browser cannot re-encode audio. Mark it on Gemini or from the transcript.');
    const ac = new Ctx();
    let buf;
    try { buf = await ac.decodeAudioData(await blob.arrayBuffer()); }
    finally { try { ac.close(); } catch {} }

    // average the channels down to mono, then resample by linear interpolation
    const src = buf.getChannelData(0);
    const chans = buf.numberOfChannels;
    const mono = chans > 1
      ? (() => { const m = new Float32Array(src.length);
          for (let c = 0; c < chans; c++) { const d = buf.getChannelData(c); for (let i = 0; i < m.length; i++) m[i] += d[i] / chans; }
          return m; })()
      : src;
    const ratio = buf.sampleRate / rate;
    const n = Math.floor(mono.length / ratio);
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * ratio, i0 = x | 0, f = x - i0;
      const s = (mono[i0] || 0) * (1 - f) + (mono[i0 + 1] || 0) * f;
      out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }

    const bytes = new DataView(new ArrayBuffer(44 + out.length * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); bytes.setUint32(4, 36 + out.length * 2, true); str(8, 'WAVEfmt ');
    bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
    bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true);
    bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true);
    str(36, 'data'); bytes.setUint32(40, out.length * 2, true);
    for (let i = 0; i < out.length; i++) bytes.setInt16(44 + i * 2, out[i], true);
    return { blob: new Blob([bytes.buffer], { type: 'audio/wav' }), rate, bytes: bytes.byteLength };
  }

  function parseResult(text, st) {
    let raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let d = null;
    try { d = JSON.parse(raw); } catch {
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
      if (a >= 0 && b > a) { try { d = JSON.parse(raw.slice(a, b + 1)); } catch {} }
    }
    if (!d) throw new Error('The marker did not return readable marks. Try again, or a different model.');

    /* THE POINT TEXT COMES FROM THE STATION, NOT FROM THE MODEL.

       Asked to echo each marking point back, a model abbreviates: a point
       reading "Measured between 11+0 and 13+6 weeks, CRL 45–84 mm, in the
       mid-sagittal plane with the neck neutral" came back as "Method of
       measurement". That is fine for saying WHICH point was missed and
       useless for revising from — and this report is what the candidate
       revises from.

       So the model is trusted for the STATUS and the NOTE, and the wording
       is taken from the station's own scheme, matched by position within
       the question. Where the counts disagree the model's text is kept, so
       nothing is ever silently mismatched. */
    const bySrcId = {};
    qsOf(st).forEach(q => bySrcId[String(q.id)] = q.marking_points || []);
    (d.questions || []).forEach(qr => {
      const src = bySrcId[String(qr.id)];
      if (!src || !Array.isArray(qr.points)) return;
      if (src.length !== qr.points.length) return;         // a mismatch is not a mapping
      qr.points = qr.points.map((p, i) => Object.assign({}, p, {
        point: src[i],                                     // the scheme's own words
        heading: p.point && String(p.point) !== String(src[i]) ? p.point : ''
      }));
    });

    const max = d.max || marksOf(st);
    const total = d.total != null ? d.total : (d.questions || []).reduce((n, q) => n + (q.awarded || 0), 0);
    const percent = d.percent != null ? d.percent : Math.round((total / Math.max(1, max)) * 100);
    return Object.assign(d, { max, total, percent, pass: d.pass != null ? d.pass : total >= passOf(st) });
  }

  /* ================= the result (#/osce/result/:id) ================= */

  async function renderResult(view, id, user) {
    let a = null;
    try { a = await Backend.getOsceAttempt(id); } catch {}
    if (!a) { view.innerHTML = shell('bank', `<p class="muted">That result is no longer stored. <a class="link" href="#/osce">Back to OSCE</a></p>`); FX.viewIn(view); return; }
    const r = a.result || {};
    const tone = r.percent >= 70 ? 'dist' : r.percent >= 60 ? 'pass' : r.percent >= 50 ? 'border' : 'fail';
    const stCls = s => /cover/i.test(s) ? 'cov' : /partial/i.test(s) ? 'par' : 'mis';
    const stIco = s => /cover/i.test(s) ? '✓' : /partial/i.test(s) ? '~' : '✗';
    const qById = {}; (a.questions || []).forEach(q => qById[String(q.id)] = q);
    const ansById = {}; (a.answers || []).forEach(x => ansById[String(x.id)] = x.transcript);

    view.innerHTML = `
      <section class="page os-result">
        <a class="link muted dev-back" href="#/osce">← OSCE stations</a>
        <header class="os-res-head es-band-head-${tone}" data-animate>
          <div>
            <p class="kicker">OSCE STATION RESULT · ${esc(new Date(a.created || Date.now()).toLocaleDateString('en-GB', { dateStyle: 'medium' }))}${
              a.heard ? ' · MARKED FROM THE RECORDING' : ''}</p>
            <h1 class="page-title">${esc(a.station?.topic || '')}</h1>
            <p class="muted">${esc(a.station?.scenario || '')}</p>
          </div>
          <div class="os-res-score">
            <div class="es-dial" id="os-dial" data-pct="${r.percent || 0}"><span>${r.percent != null ? r.percent + '%' : '—'}</span></div>
            <span class="es-fb-band es-band-${tone} big">${r.pass ? 'Pass' : 'Below the pass mark'}</span>
            <span class="muted tiny">${r.total}/${r.max} · pass mark ${a.station?.pass_mark ?? '—'}</span>
          </div>
        </header>

        ${r.examinerComment ? `<div class="card es-examiner" data-animate>
          <div class="es-inbox-head">
            <h3 class="card-title">👨‍⚖️ Examiner's verdict</h3>
            <button class="btn btn-ghost btn-sm" id="os-hear">▶ Hear it</button>
          </div>
          <p>${esc(r.examinerComment)}</p>
          <p class="dev-row-msg" id="os-hear-msg"></p></div>` : ''}

        ${r.structure ? `<div class="card" data-animate>
          <h3 class="card-title">How you performed</h3>
          <div class="os-perf">
            ${['coverage', 'fluency', 'safety'].filter(k => r.structure[k]).map(k => `
              <div class="os-perf-c"><span class="os-perf-k">${k === 'coverage' ? '🎯 Coverage' : k === 'fluency' ? '🗣 Delivery' : '⚠ Safety'}</span>
                <p>${esc(r.structure[k])}</p></div>`).join('')}
          </div></div>` : ''}

        ${r.coaching && Object.keys(r.coaching).length ? `<div class="card os-coach-out" data-animate>
          <h3 class="card-title">🎧 The mock examiner's coaching</h3>
          <p class="muted">Not about the marks — about how you came across, and what to do differently in the room.
            You asked for these before the station was marked.</p>
          ${COACH.filter(c => r.coaching[c.id]).map(c => `
            <div class="os-coach-sec">
              <h4>${esc(c.label)}</h4>
              <p>${esc(r.coaching[c.id])}</p>
            </div>`).join('')}
        </div>` : ''}

        <div class="card" data-animate>
          <h3 class="card-title">Marked against the scheme</h3>
          <p class="muted tiny"><span class="es-dot cov"></span> covered · <span class="es-dot par"></span> partial ·
            <span class="es-dot mis"></span> missed. Every point the scheme carries, and whether you said it.</p>
          ${(r.questions || []).map((qr, i) => {
            const q = qById[String(qr.id)] || {};
            const pct = qr.max ? Math.round((qr.awarded / qr.max) * 100) : 0;
            return `
            <details class="os-qres" ${i === 0 ? 'open' : ''}>
              <summary>
                <span class="os-qres-n">Q${i + 1}</span>
                <span class="os-qres-p">${esc(q.prompt || '')}</span>
                <span class="os-qres-m ${pct < 50 ? 'bad' : pct < 70 ? '' : 'good'}">${qr.awarded}/${qr.max}</span>
                <span class="dc-caret">▸</span>
              </summary>
              <div class="os-qres-body">
                <div class="es-points">${(qr.points || []).map(p => `
                  <div class="es-point es-st-${stCls(p.status)}">
                    <span class="es-point-icon">${stIco(p.status)}</span>
                    <div class="es-point-body">
                      ${p.heading ? `<p class="es-point-head">${esc(p.heading)}</p>` : ''}
                      <p class="es-point-text">${esc(p.point)}</p>
                      ${p.note ? `<p class="es-point-note">${esc(p.note)}</p>` : ''}
                    </div>
                  </div>`).join('')}</div>
                ${qr.comment ? `<p class="os-qres-c">${esc(qr.comment)}</p>` : ''}
                <details class="os-said-fold"><summary>What you said</summary>
                  <p class="os-said-t">${esc(ansById[String(qr.id)] || '(nothing was captured)')}</p></details>
              </div>
            </details>`;
          }).join('')}
        </div>

        ${(r.improvements || []).length ? `<div class="card es-prio" data-animate>
          <h3 class="card-title">🚀 Do these first</h3>
          <ol class="es-prio-list">${r.improvements.map((x, i) => `
            <li class="es-prio-item"><span class="es-prio-rank">${i + 1}</span>
              <div class="es-prio-body"><p>${esc(typeof x === 'string' ? x : x.action)}</p>
                ${x.marks ? `<span class="es-prio-meta"><span class="es-prio-gain">+${x.marks} marks</span></span>` : ''}</div>
            </li>`).join('')}</ol></div>` : ''}

        ${(r.strengths || []).length ? `<div class="card" data-animate>
          <h3 class="card-title">✅ What was good</h3>
          <ul class="es-flag-list">${r.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}

        ${(r.keyLearning || []).length ? `<div class="card es-klp" data-animate>
          <h3 class="card-title">🔑 Key learning points</h3>
          <ol class="es-klp-list">${r.keyLearning.map((k, i) => `<li class="${i === 0 ? 'top' : ''}">${esc(k)}</li>`).join('')}</ol></div>` : ''}

        ${a.audioPath ? `<div class="card os-audio" data-animate>
          <h3 class="card-title">🎧 Your recording</h3>
          <p class="muted" id="os-au-note">Loading the recording…</p>
          <div id="os-au"></div>
        </div>` : ''}

        ${a.cost ? `<div class="card os-cost" data-animate>
          <h3 class="card-title">🧾 What this marking cost</h3>
          <div class="os-cost-grid">
            <div><strong>${(a.cost.inTok || 0).toLocaleString('en-US')}</strong><span>tokens in</span></div>
            <div><strong>${(a.cost.outTok || 0).toLocaleString('en-US')}</strong><span>tokens out</span></div>
            <div><strong>$${(a.cost.usd || 0).toFixed(4)}</strong><span>US dollars</span></div>
            <div class="is-lkr"><strong>LKR ${(a.cost.lkr || 0).toFixed(2)}</strong><span>rupees</span></div>
          </div>
          <p class="muted tiny">${esc(a.modelLabel || a.model || '')}${a.heard ? ' · marked from your recording' : ' · marked from the transcript'}
            · converted at LKR ${a.cost.rate || 340}/USD. This is on your Billing &amp; balance page under
            <strong>OSCE marking</strong>.</p>
        </div>` : ''}

        <div class="card os-explore" data-animate>
          <h3 class="card-title">✨ Explore this station with AI</h3>
          <p class="muted">Ask about anything in the marking above — why a point was scored the way it was, the
            guideline behind it, how you should have structured the answer. The model has the scheme and your marks in
            front of it, so the answers are about <em>this</em> station, not the topic in general.</p>
          <div class="os-ex-head">
            <label class="os-prov-l">Ask
              <select class="sel" id="os-ex-model">${modelChoices().map(m =>
                `<option value="${esc(m.key)}">${esc(m.label)} — $${m.rate.in}/$${m.rate.out} per 1M</option>`).join('')}</select></label>
            <button class="btn btn-ghost btn-sm" id="os-ex-web" title="Find the guidelines and trials behind this station">🌐 Search the web</button>
          </div>
          <div id="os-ex-web-out"></div>
          <div class="ai-messages" id="os-ex-msgs"></div>
          <form class="ai-ask" id="os-ex-ask">
            <input type="text" id="os-ex-input" autocomplete="off"
              placeholder="Ask a follow-up… e.g. why is McRoberts first? / what did a full-mark answer to Q3 look like?">
            <button class="btn btn-primary btn-sm" type="submit">Ask</button>
          </form>
          <p class="ai-disclaimer">AI-generated — verify against NICE / RCOG / SLCOG guidance.</p>
        </div>

        <div class="card os-deckmake" data-animate>
          <h3 class="card-title">📘 Write the study document for this case</h3>
          <p class="muted">Not a pile of cards — one page about this station: how to recognise it, the management in
            the order it happens with the doses and thresholds that carry the marks, what an examiner asks next, and
            every point of the scheme marked <strong>✓ you said</strong>, <strong>~ half-said</strong> or
            <strong>✗ you did not</strong>. It lands under <strong>Study documents</strong> in this tab, and
            downloads as a PDF.</p>
          <div class="os-mark-acts">
            <button class="btn btn-gold" id="os-makedeck">Write the study document</button>
            <span class="dev-status" id="os-deck-msg"></span>
          </div>
        </div>

        <div class="es-report-foot">
          <button class="btn btn-gold" id="os-print">🖨 Print / Save as PDF</button>
          <button class="btn btn-ghost" id="os-copy"
            title="Copy the scenario and questions as plain text — without the marking scheme and without your transcript — to paste into NotebookLM, Gemini or ChatGPT">📄 Copy the station</button>
          <a class="btn btn-ghost" href="#/osce/station/${encodeURIComponent(a.station_id)}">↺ Sit it again</a>
          <button class="btn btn-ghost btn-sm qr-danger" id="os-del">🗑 Delete this result</button>
        </div>
      </section>`;
    FX.viewIn(view);
    if (typeof FX !== 'undefined' && FX.scoreReveal) {
      const d = view.querySelector('#os-dial');
      if (d) { const pct = r.percent || 0;
        const col = pct >= 70 ? '#34d399' : pct >= 60 ? '#5eead4' : pct >= 50 ? '#e8a33d' : '#e05263';
        d.style.background = `conic-gradient(${col} ${pct * 3.6}deg, rgba(255,255,255,.08) 0)`; }
    }
    /* The tape is fetched as a signed link only when the report is opened —
       never as part of a list — and the page says plainly how long it has. */
    if (a.audioPath) (async () => {
      const note = view.querySelector('#os-au-note'), host = view.querySelector('#os-au');
      const left = (a.audioExpires || 0) - Date.now();
      try {
        const url = await Backend.getOsceAudioUrl(a.audioPath);
        if (!url) throw new Error('gone');
        note.innerHTML = left > 0
          ? `Kept for <strong>${Math.max(1, Math.round(left / 3600e3))} more hour${Math.round(left / 3600e3) === 1 ? '' : 's'}</strong>, then deleted automatically.
             Download it if you want to keep it — listening back is the fastest way to hear your own waffle.`
          : 'This recording is past its 24 hours and will be removed on the next visit.';
        host.innerHTML = `<div class="os-rec-box">
          <audio controls src="${esc(url)}"></audio>
          <a class="btn btn-ghost btn-sm" href="${esc(url)}" download="OSCE-${esc((a.station?.topic || 'station').replace(/[^a-z0-9]+/gi, '-'))}.webm">⬇ Download</a>
          ${a.audioSecs ? `<span class="muted tiny">${fmt(a.audioSecs)} of audio</span>` : ''}
        </div>`;
      } catch {
        note.textContent = 'The recording has passed its 24 hours and been deleted.';
        host.innerHTML = '';
      }
    })();

    wireHearVerdict(view, a);
    wireExplore(view, a);
    wireDeckMaker(view, a);
    view.querySelector('#os-print').addEventListener('click', () => printPicker(a));
    /* Rebuilt from the attempt, not from the live station — the station may
       have been edited since. What is copied is what was actually sat, and
       the `answers` on the attempt are deliberately not consulted. */
    view.querySelector('#os-copy').addEventListener('click', e => copyOut(stationAsText({
      topic: a.station?.topic, scenario: a.station?.scenario,
      station_time_min: a.station?.station_time_min, total_marks: a.station?.total_marks,
      questions: (a.questions || []).map(q => ({ id: q.id, prompt: q.prompt, marks: q.marks,
        reveal_before: q.reveal_before, images: q.images || [] }))
    }), e.currentTarget, '📄 Copy the station'));
    view.querySelector('#os-del').addEventListener('click', async () => {
      if (!confirm('Delete this OSCE result?')) return;
      try { await Backend.deleteOsceAttempt(a.id); } catch {}
      location.hash = '#/osce';
    });
  }

  /* ---------------- talking to a model about the report ----------------
     The station's own scheme and marks go with every message, so the answers
     are about this attempt rather than the topic. Only the questions that
     lost marks are sent, which keeps a whole conversation cheaper than the
     marking that produced it. */

  /* ---------------- the debrief, read aloud ----------------
     A real debrief is spoken, not handed over on paper. This reads the
     verdict and the first things to fix in the examiner's own voice, so it
     can be listened to on the way somewhere rather than read on a screen.
     Groq where it is available, the browser where it is not. */
  function wireHearVerdict(view, a) {
    const btn = view.querySelector('#os-hear');
    if (!btn) return;
    const msg = view.querySelector('#os-hear-msg');
    let playing = null;
    btn.addEventListener('click', async () => {
      if (playing) { try { playing.pause(); } catch {} playing = null; hush(); btn.textContent = '▶ Hear it'; return; }
      const r = a.result || {};
      const lines = [r.examinerComment];
      (r.improvements || []).slice(0, 3).forEach((x, i) =>
        lines.push(`${i === 0 ? 'To improve. ' : ''}${typeof x === 'string' ? x : x.action}`));
      const text = lines.filter(Boolean).join(' ');
      btn.disabled = true; btn.textContent = 'Fetching…';
      const clip = await groqVoice(text);
      btn.disabled = false;
      if (clip) {
        const au = new Audio(`data:${clip.mime};base64,${clip.data}`);
        playing = au;
        btn.textContent = '⏹ Stop';
        au.onended = () => { playing = null; btn.textContent = '▶ Hear it'; };
        au.play().catch(() => { playing = null; btn.textContent = '▶ Hear it'; });
        if (msg) msg.textContent = '';
        return;
      }
      // no Groq: the browser reads it, and says so rather than pretending
      const rep = groqReport();
      if (msg) msg.innerHTML = `<span class="muted tiny">Read by the browser's voice${
        rep.why ? ` — the real voice is unavailable: ${esc(rep.why)}` : ''}.</span>`;
      speak(text, { rate: 1 });
      btn.textContent = '⏹ Stop';
      playing = { pause() {} };
      setTimeout(() => { if (playing) { playing = null; btn.textContent = '▶ Hear it'; } }, Math.min(90000, text.length * 70));
    });
  }

  function wireExplore(view, a) {
    const msgs = view.querySelector('#os-ex-msgs');
    const form = view.querySelector('#os-ex-ask');
    const input = view.querySelector('#os-ex-input');
    const sel = view.querySelector('#os-ex-model');
    if (!form) return;
    // reuse whatever model marked the station, when it is still on the list
    const prior = modelChoices().find(m => m.model === a.model) || chosenModel();
    if (prior) sel.value = prior.key;

    const history = [];
    const md = t => (typeof AI !== 'undefined' && AI.renderMarkdown) ? AI.renderMarkdown(t) : `<p>${esc(t)}</p>`;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const q = input.value.trim(); if (!q) return;
      input.value = '';
      const choice = modelChoices().find(m => m.key === sel.value) || chosenModel();
      history.push({ role: 'user', content: q });
      msgs.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-user">${esc(q)}</div>`);
      const holder = document.createElement('div');
      holder.className = 'ai-msg ai-msg-ai';
      holder.innerHTML = `<div class="ai-loading sm"><span></span><span></span><span></span></div>`;
      msgs.appendChild(holder);
      msgs.scrollTop = msgs.scrollHeight;
      try {
        if (typeof Wallet !== 'undefined' && !(await Wallet.canSpend())) throw new Error(Wallet.blockedMessage());
        const token = await Backend.getAccessToken();
        if (!token) throw new Error('Sign in to ask about this station.');
        const res = await fetch(cfg().ai.apiBase, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({
            action: 'oscechat', provider: choice.provider, model: choice.model, dailyLimit: cfg().ai.dailyLimit,
            station: a.station, messages: history,
            result: {
              total: a.result?.total, max: a.result?.max, percent: a.result?.percent, pass: a.result?.pass,
              examinerComment: a.result?.examinerComment,
              // only what lost marks — a full-mark question has nothing to discuss
              questions: (a.result?.questions || []).filter(q => (q.awarded || 0) < (q.max || 0)).map(q => ({
                awarded: q.awarded, max: q.max,
                prompt: (a.questions || []).find(x => String(x.id) === String(q.id))?.prompt || '',
                points: q.points || []
              }))
            }
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Could not ask (HTTP ${res.status}).`);
        history.push({ role: 'assistant', content: data.text });
        holder.innerHTML = md(data.text);
        try { if (typeof Wallet !== 'undefined') Wallet.bust(); } catch {}
      } catch (err) {
        holder.innerHTML = `<p class="ai-error">${esc(err.message || err)}</p>`;
        history.pop();
      }
      msgs.scrollTop = msgs.scrollHeight;
    });

    /* The same web search the SBA/EMQ review has: the model names the exact
       guidelines and trials worth reading, and clicking one opens it wherever
       the user has said searches should open. */
    view.querySelector('#os-ex-web').addEventListener('click', async () => {
      const box = view.querySelector('#os-ex-web-out');
      if (box.dataset.open === '1') { box.dataset.open = '0'; box.innerHTML = ''; return; }
      box.dataset.open = '1';
      box.innerHTML = `<div class="ai-loading sm"><span></span><span></span><span></span></div>`;
      const choice = modelChoices().find(m => m.key === sel.value) || chosenModel();
      const missed = (a.result?.questions || []).flatMap(q => (q.points || [])
        .filter(p => !/cover/i.test(p.status || '')).map(p => p.point)).slice(0, 12);
      try {
        const token = await Backend.getAccessToken();
        if (!token) throw new Error('Sign in first.');
        const res = await fetch(cfg().ai.apiBase, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ action: 'searchterms', provider: choice.provider, model: choice.model,
            dailyLimit: cfg().ai.dailyLimit,
            question: { theme: a.station?.topic || '', stem: a.station?.scenario || '', options: [], answer: 0 },
            rationale: missed.join('; ') })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const m = String(data.text || '').match(/\{[\s\S]*\}/);
        const terms = (JSON.parse(m ? m[0] : data.text) || {}).terms || [];
        if (!terms.length) { box.innerHTML = `<p class="muted">No specific sources suggested for this one.</p>`; return; }
        const ico = k => ({ guideline: '📘', trial: '🧪', drug: '💊' }[k] || '🔎');
        box.innerHTML = `<div class="ai-web-out" data-open="1">
          <div class="ai-web-head"><span>🌐 Worth reading — pick one to search</span></div>
          <div class="ai-web-terms">${terms.map(t => `
            <button class="ai-web-term" data-q="${esc(t.q)}">
              <span class="ai-web-ico">${ico(t.kind)}</span>
              <span class="ai-web-q">${esc(t.q)}</span>
              <span class="ai-web-why">${esc(t.why || '')}</span>
            </button>`).join('')}</div></div>`;
      } catch (e) {
        const fallback = `${a.station?.topic || ''} RCOG guideline`;
        box.innerHTML = `<p class="ai-error">${esc(e.message || e)}</p>
          <button class="btn btn-ghost btn-sm ai-web-term" data-q="${esc(fallback)}">Search Google for this topic anyway</button>`;
      }
    });
    // one delegated listener: the box is redrawn, the handler is not
    view.querySelector('#os-ex-web-out').addEventListener('click', e => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      if (typeof AI !== 'undefined' && AI.openSearch) AI.openSearch(view.querySelector('#os-ex-web-out'), b.dataset.q);
      else window.open('https://www.google.com/search?q=' + encodeURIComponent(b.dataset.q), '_blank', 'noopener');
    });
  }

  /* ---------------- the printable report ---------------- */

  /* ---------------- what goes into the PDF ----------------
     The same report is wanted for different things: a blank scheme to
     practise against, the marking alone to file, or the whole debrief with
     the transcript. So the sections are chosen rather than fixed, and the
     three usual answers are one click each. */

  const PRINT_SECTIONS = [
    { id: 'cover',    label: 'Cover — the score, the pass mark, when you sat it' },
    { id: 'verdict',  label: "The examiner's verdict" },
    { id: 'perf',     label: 'Coverage, delivery and safety' },
    { id: 'scheme',   label: 'The marking scheme — every question and every point' },
    { id: 'marks',    label: 'How each point was marked (✓ ~ ✗) and the marks awarded' },
    { id: 'said',     label: 'What you said — the transcript, under each question' },
    { id: 'improve',  label: 'What to do first' },
    { id: 'good',     label: 'What was good' },
    { id: 'learning', label: 'Key learning points' }
  ];
  const PRINT_PRESETS = {
    full:   { label: '📋 The whole report', pick: PRINT_SECTIONS.map(s => s.id) },
    marked: { label: '✍️ Marking only', pick: ['cover', 'verdict', 'scheme', 'marks', 'improve'] },
    blank:  { label: '📄 Blank scheme to practise against', pick: ['scheme'] },
    spoken: { label: '🎙 Scheme with what I said', pick: ['cover', 'scheme', 'marks', 'said'] }
  };
  const PRINT_KEY = 'aureum.osce.print';

  function printPicker(a) {
    document.querySelector('.os-modal')?.remove();
    let pick = null;
    try { pick = JSON.parse(localStorage.getItem(PRINT_KEY) || 'null'); } catch {}
    if (!Array.isArray(pick)) pick = PRINT_PRESETS.full.pick.slice();
    const on = id => pick.includes(id);

    const wrap = document.createElement('div');
    wrap.className = 'os-modal os-print-modal';
    wrap.innerHTML = `
      <div class="os-modal-back" data-close></div>
      <div class="os-modal-box" role="dialog" aria-modal="true" aria-label="What to print">
        <div class="os-modal-head">
          <div><p class="kicker">PRINT / SAVE AS PDF</p><h3>What should be in it?</h3></div>
          <button class="os-modal-x" data-close aria-label="Close">✕</button>
        </div>
        <div class="os-modal-body">
          <div class="os-print-presets">
            ${Object.entries(PRINT_PRESETS).map(([k, p]) =>
              `<button class="btn btn-ghost btn-sm" data-preset="${k}">${p.label}</button>`).join('')}
          </div>
          <div class="os-print-list">
            ${PRINT_SECTIONS.map(s => `
              <label class="os-print-row">
                <input type="checkbox" data-sec="${s.id}" ${on(s.id) ? 'checked' : ''}>
                <span>${esc(s.label)}</span>
              </label>`).join('')}
          </div>
          <p class="muted tiny">A blank scheme leaves out the marks and the ticks, so the same station can be sat again
            on paper. Whatever you choose is remembered for next time.</p>
        </div>
        <div class="os-modal-foot">
          <button class="btn btn-ghost btn-sm" data-close>Cancel</button>
          <button class="btn btn-gold" id="os-print-go">🖨 Print it</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const shut = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', onKey);
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', shut));

    const boxes = () => [...wrap.querySelectorAll('[data-sec]')];
    wrap.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      const p = PRINT_PRESETS[b.dataset.preset].pick;
      boxes().forEach(x => x.checked = p.includes(x.dataset.sec));
    }));
    wrap.querySelector('#os-print-go').addEventListener('click', () => {
      const chosen = boxes().filter(x => x.checked).map(x => x.dataset.sec);
      if (!chosen.length) return;
      try { localStorage.setItem(PRINT_KEY, JSON.stringify(chosen)); } catch {}
      shut();
      printResult(a, chosen);
    });
  }

  function printResult(a, sections) {
    const want = new Set(sections && sections.length ? sections : PRINT_SECTIONS.map(s => s.id));
    const has = id => want.has(id);
    const r = a.result || {};
    const qById = {}; (a.questions || []).forEach(q => qById[String(q.id)] = q);
    const ansById = {}; (a.answers || []).forEach(x => ansById[String(x.id)] = x.transcript);
    const mark = s => /cover/i.test(s) ? '✓' : /partial/i.test(s) ? '~' : '✗';
    /* Printed from the PAGE, not from a hidden iframe. iPadOS Safari ignores
       print() called on an off-screen frame — the button appeared to do
       nothing at all, which is exactly what was reported. Every rule is
       scoped under #os-printdoc so the app's own styling is untouched, and
       @media print hides everything except the sheet. */
    const P = '#os-printdoc';
    const styles = `
@page { size: A4 portrait; margin: 16mm 15mm 14mm; }
${P}, ${P} *{box-sizing:border-box}
${P}{position:fixed;inset:0;z-index:9000;overflow:auto;background:#f1f2f6;color:#111;
  font-family:"Helvetica Neue",Arial,sans-serif;font-size:10pt;line-height:1.5;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
${P} .sheet{background:#fff;width:210mm;min-height:297mm;margin:0 auto 28px;padding:16mm 15mm;box-shadow:0 2px 18px rgba(0,0,0,.16)}
${P} h1{font-family:Georgia,serif;font-size:21pt;margin:0 0 4px;color:#111}
${P} h2{font-size:13pt;margin:0 0 8px;border-left:4px solid #0d8f7d;padding-left:9px;color:#111}
${P} h3{font-size:10.5pt;margin:12px 0 4px;color:#111}
${P} p{margin:0 0 .6em} ${P} ul,${P} ol{margin:0 0 .6em;padding-left:1.3em}
${P} .brand{font-size:7.5pt;letter-spacing:.22em;text-transform:uppercase;color:#7a5a10;margin:0 0 2px}
${P} .eyebrow{font-size:8pt;letter-spacing:.12em;text-transform:uppercase;color:#666;margin:0 0 4px}
${P} .cover{border-bottom:3px solid #0d8f7d;padding-bottom:12px;margin-bottom:16px}
${P} .scorebox{display:flex;gap:16px;margin-top:10px}
${P} .pct{flex:0 0 120px;border:2px solid ${r.pass ? '#047857' : '#c62828'};color:${r.pass ? '#047857' : '#c62828'};
  border-radius:8px;padding:10px 8px;text-align:center}
${P} .pct b{display:block;font-size:26pt;line-height:1}
${P} .pct span{display:block;font-size:8pt;text-transform:uppercase;margin-top:5px}
${P} .kv{flex:1;border-collapse:collapse;font-size:9pt}
${P} .kv th{text-align:left;padding:3px 8px 3px 0;color:#444;white-space:nowrap;width:1%}
${P} .kv td{padding:3px 12px 3px 0}
${P} .blk{margin:0 0 16px;break-inside:auto}
${P} .callout{border:1px solid #d5d5d5;border-left:3px solid #0d8f7d;padding:8px 11px;margin:0 0 .8em;background:#fafafa;break-inside:avoid}
${P} .q{border:1px solid #e0e0e0;border-radius:5px;padding:9px 11px;margin-bottom:9px;break-inside:avoid}
${P} .qh{display:flex;gap:9px;align-items:baseline;margin-bottom:5px}
${P} .qh b{flex:1}${P} .qh i{font-style:normal;font-weight:700;white-space:nowrap}
${P} .pts{list-style:none;padding:0;margin:0}
${P} .pts li{display:flex;gap:6px;margin-bottom:.18em}
${P} .pip{width:13px;text-align:center;font-weight:800;flex:0 0 13px}
${P} .cov{color:#0d8f7d}${P} .par{color:#a5750f}${P} .mis{color:#c62828}
${P} .note{display:block;font-style:italic;color:#666;font-size:.9em}
${P} .said{border-left:2px solid #ddd;padding-left:9px;margin-top:6px;font-size:.9em;color:#555}
${P} .foot{margin-top:18px;padding-top:6px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:7.5pt;color:#888}
${P} .blank li{color:#333}
${P} .qimgs{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 8px}
${P} .qimgs figure{margin:0;flex:1 1 240px;max-width:100%;break-inside:avoid}
${P} .qimgs img{width:100%;height:auto;border:1px solid #ddd;border-radius:3px}
${P} .qimgs figcaption{font-size:8pt;color:#666;margin-top:2px}
${P} .os-pd-bar{position:sticky;top:0;z-index:2;display:flex;gap:10px;justify-content:center;align-items:center;
  padding:10px;background:#1b1b22;color:#fff;font-size:11pt}
${P} .os-pd-bar button{font:inherit;font-size:10pt;padding:7px 16px;border-radius:8px;border:0;cursor:pointer}
${P} .os-pd-print{background:#e8b53f;color:#241d05;font-weight:700}
${P} .os-pd-close{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}
${P} .os-pd-hint{color:#b9b9c4;font-size:9pt}
@media print {
  html,body{background:#fff !important;margin:0 !important;padding:0 !important;height:auto !important;overflow:visible !important}
  body > *:not(${P}){display:none !important}
  ${P}{position:static !important;overflow:visible !important;background:#fff !important}
  ${P} .os-pd-bar{display:none !important}
  ${P} .sheet{width:auto !important;min-height:0 !important;margin:0 !important;padding:0 !important;box-shadow:none !important}
}`;
    const doc = `<div class="os-pd-bar">
  <button class="os-pd-print" type="button" data-pd-print>🖨 Print / Save as PDF</button>
  <button class="os-pd-close" type="button" data-pd-close>Close</button>
  <span class="os-pd-hint">Choose “Save as PDF” as the printer to keep a copy.</span>
</div><div class="sheet">
<header class="cover">
  <p class="brand">AUREUM · Pathway to MD</p>
  <p class="eyebrow">${has('cover') ? 'OSCE station report' : 'OSCE marking scheme'}</p>
  <h1>${esc(a.station?.topic || '')}</h1>
  <p style="font-size:9pt;color:#555">${esc(a.station?.scenario || '')}</p>
  ${has('cover') ? `<div class="scorebox">
    <div class="pct"><b>${r.percent != null ? r.percent + '%' : '—'}</b><span>${r.pass ? 'Pass' : 'Below pass'}</span></div>
    <table class="kv">
      <tr><th>Marks</th><td>${r.total} / ${r.max}</td><th>Pass mark</th><td>${a.station?.pass_mark ?? '—'}</td></tr>
      <tr><th>Sat</th><td>${esc(new Date(a.created || Date.now()).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td>
          <th>Marked by</th><td>${esc(a.model || a.provider || '')}</td></tr>
    </table>
  </div>` : `<table class="kv" style="margin-top:8px">
    <tr><th>Total marks</th><td>${r.max ?? a.station?.total_marks ?? '—'}</td>
        <th>Pass mark</th><td>${a.station?.pass_mark ?? '—'}</td></tr></table>`}
</header>
${has('verdict') && r.examinerComment ? `<section class="blk"><h2>Examiner's verdict</h2><div class="callout"><p>${esc(r.examinerComment)}</p></div></section>` : ''}
${has('perf') && r.structure ? `<section class="blk"><h2>How you performed</h2>
  ${['coverage', 'fluency', 'safety'].filter(k => r.structure[k]).map(k =>
    `<p><strong>${k === 'coverage' ? 'Coverage' : k === 'fluency' ? 'Delivery' : 'Safety'}.</strong> ${esc(r.structure[k])}</p>`).join('')}</section>` : ''}
${has('scheme') || has('marks') || has('said') ? `<section class="blk">
  <h2>${has('marks') ? 'Marked against the scheme' : 'The marking scheme'}</h2>
  ${(r.questions || []).map((qr, i) => {
    const q = qById[String(qr.id)] || {};
    /* Without the marking chosen this is a blank scheme: the points are
       listed with an empty box instead of a tick, so the same station can be
       sat again on paper and marked by hand. */
    const pts = has('scheme')
      ? `<ul class="pts${has('marks') ? '' : ' blank'}">${(qr.points || []).map(p => `<li><span class="pip ${
          has('marks') ? (/cover/i.test(p.status) ? 'cov' : /partial/i.test(p.status) ? 'par' : 'mis') : ''}">${
          has('marks') ? mark(p.status) : '☐'}</span>
        <span>${p.heading ? `<b>${esc(p.heading)}.</b> ` : ''}${esc(p.point)}${
          has('marks') && p.note ? `<span class="note">${esc(p.note)}</span>` : ''}</span></li>`).join('')}</ul>`
      : '';
    // the picture is part of the question — a CTG station without its trace
    // is not the station
    const ims = has('scheme') ? imagesOf(q) : [];
    return `<div class="q">
      <div class="qh"><b>Q${i + 1}. ${esc(q.prompt || '')}</b><i>${has('marks') ? `${qr.awarded}/${qr.max}` : `${qr.max ?? q.marks ?? ''}`}</i></div>
      ${ims.length ? `<div class="qimgs">${ims.map(im =>
        `<figure><img src="${esc(im.url)}" alt="">${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
      ${pts}
      ${has('marks') && qr.comment ? `<p style="margin-top:6px">${esc(qr.comment)}</p>` : ''}
      ${has('said') ? `<div class="said"><strong>You said:</strong> ${esc(ansById[String(qr.id)] || '(nothing captured)')}</div>` : ''}
    </div>`;
  }).join('')}</section>` : ''}
${has('improve') && (r.improvements || []).length ? `<section class="blk"><h2>What to do first</h2><ol>${r.improvements.map(x =>
  `<li>${esc(typeof x === 'string' ? x : x.action)}${x.marks ? ` <strong>(+${x.marks} marks)</strong>` : ''}</li>`).join('')}</ol></section>` : ''}
${has('good') && (r.strengths || []).length ? `<section class="blk"><h2>What was good</h2><ul>${r.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
${has('learning') && (r.keyLearning || []).length ? `<section class="blk"><h2>Key learning points</h2><ol>${r.keyLearning.map(x => `<li>${esc(x)}</li>`).join('')}</ol></section>` : ''}
<footer class="foot"><span>${esc(a.station?.topic || '')} — OSCE</span><span>AUREUM · printed ${esc(new Date().toLocaleDateString('en-GB', { dateStyle: 'medium' }))}</span></footer>
</div>`;

    openPrintSheet(styles, doc);
  }



  /* ---------------- mounting a printable sheet ----------------
     Shared by the station report and the study document, because both hit
     the same wall: iPadOS Safari ignores print() on a hidden iframe, so
     the sheet has to be part of the page and the page itself printed. */
  function openPrintSheet(styles, bodyHtml) {
    document.getElementById('os-printdoc')?.remove();
    document.getElementById('os-printdoc-css')?.remove();
    const css = document.createElement('style');
    css.id = 'os-printdoc-css';
    css.textContent = styles;
    document.head.appendChild(css);

    const host = document.createElement('div');
    host.id = 'os-printdoc';
    host.innerHTML = bodyHtml;
    document.body.appendChild(host);

    const prevOverflow = document.documentElement.style.overflow;
    const shut = () => {
      host.remove(); css.remove();
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = prevOverflow;
    };
    const onKey = e => { if (e.key === 'Escape') shut(); };
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    host.querySelector('[data-pd-close]')?.addEventListener('click', shut);
    host.querySelector('[data-pd-print]')?.addEventListener('click', () => { try { window.print(); } catch {} });

    /* On a desktop browser print() blocks until the dialog is dismissed, so
       the sheet clears the moment it returns and the app is back as it was.
       On iOS it does NOT: "Save as PDF" happens in a share sheet raised
       after print() has returned, and a page that tore itself down
       underneath would take the document with it. There it stays, with a
       Close button, until the reader is finished. */
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const go = () => { try { window.print(); } catch {} if (!iOS) setTimeout(shut, 250); };
    const imgs = [...host.querySelectorAll('img')];
    if (!imgs.length) { setTimeout(go, 60); return; }
    // a CTG station without its trace is not the station — wait for the pictures
    let left = imgs.length;
    const tick = () => { if (--left <= 0) setTimeout(go, 60); };
    imgs.forEach(im => im.complete ? tick() : (im.onload = im.onerror = tick));
    setTimeout(() => { if (left > 0) { left = 0; go(); } }, 4000);
  }

  /* ---------------- shell ---------------- */

  function shell(active, inner) {
    const tab = (id, href, label) =>
      `<a class="lib-tab ${active === id ? 'active' : ''}" href="${href}">${label}</a>`;
    return `<section class="page">
      <div class="lib-subnav" data-animate>
        ${tab('bank', '#/osce', 'Station bank')}
        ${tab('sim', '#/osce/sim', 'Exam simulator')}
        ${tab('mine', '#/osce/mine', 'My attempts')}
        ${tab('progress', '#/osce/progress', 'Progress')}
        ${tab('cards', '#/osce/cards', 'Study documents')}
        ${tab('edit', '#/osce/edit', 'Station editor')}
      </div>${inner}</section>`;
  }

  /* ================= the circuit results (#/osce/circuit/:sid) =================
     Nine stations' worth of marking lands here as it finishes. The page
     redraws itself whenever the queue moves, so the candidate watches the
     results arrive instead of staring at a spinner — and a station that
     failed offers to go again rather than simply being absent. */

  async function renderCircuit(view, sid, user) {
    const s = await loadSession(sid);
    if (!s) {
      view.innerHTML = shell('sim', `<p class="muted">That circuit is no longer stored. <a class="link" href="#/osce/mine">Your attempts</a></p>`);
      FX.viewIn(view); return;
    }
    const cards = await stations().catch(() => []);
    const byId = {}; cards.forEach(c => byId[c.id] = c);
    const modules = await OsceBlueprint.get().catch(() => []);

    let off = null;
    const draw = async () => {
      const cur = await loadSession(sid) || s;
      const marks = loadMarks(sid);
      const rows = cur.stations.map((id, i) => ({ i, id, st: byId[id] || { id }, m: marks[id] || { status: 'none' } }));
      const done = rows.filter(r => r.m.status === 'done');
      const failed = rows.filter(r => r.m.status === 'error');
      const waiting = rows.filter(r => r.m.status === 'queued');
      const scored = done.filter(r => r.m.percent != null);
      const mean = scored.length ? Math.round(scored.reduce((n, r) => n + r.m.percent, 0) / scored.length) : null;
      const passed = done.filter(r => r.m.pass).length;

      view.innerHTML = shell('sim', `
        <header data-animate>
          <p class="kicker">CIRCUIT COMPLETE</p>
          <h1 class="page-title">${cur.stations.length} stations</h1>
          <p class="muted">${waiting.length
            ? `Marking is still running — <strong>${waiting.length}</strong> to go. You can leave this page; it carries on.`
            : 'Every station has been through the marker.'}</p>
        </header>

        ${scored.length ? `<div class="card os-circ-sum" data-animate>
          <div class="os-circ-figs">
            <div class="os-circ-fig"><b>${mean}%</b><span>mean across ${scored.length} station${scored.length === 1 ? '' : 's'}</span></div>
            <div class="os-circ-fig"><b>${passed}/${scored.length}</b><span>at or above the pass mark</span></div>
          </div>
          ${Charts && scored.length > 1 ? `<div class="os-circ-bars">${scored.map(r => `
            <div class="os-circ-bar" title="${esc(r.st.topic || '')}">
              <i style="height:${Math.max(4, r.m.percent)}%;background:${r.m.pass ? 'var(--good,#34d399)' : 'var(--bad,#f87171)'}"></i>
              <span>${r.i + 1}</span>
            </div>`).join('')}</div>` : ''}
        </div>` : ''}

        <div class="card" data-animate>
          <h3 class="card-title">Station by station</h3>
          <p class="muted tiny">The topic and the module are shown now the circuit is over — that is the point at which
            knowing them helps rather than hinders.</p>
          <div class="os-circ-list">
            ${rows.map(r => {
              const tag = OsceBlueprint.tagOf(r.st);
              const where = tag ? `${OsceBlueprint.moduleName(modules, tag.module)} · ${OsceBlueprint.topicName(modules, tag.module, tag.topic)}` : 'not on the blueprint';
              const badge = r.m.status === 'done'
                ? `<span class="os-circ-pct ${r.m.pass ? 'is-pass' : 'is-fail'}">${r.m.percent != null ? r.m.percent + '%' : 'marked'}</span>`
                : r.m.status === 'queued' ? `<span class="os-circ-wait"><i></i> marking…</span>`
                : r.m.status === 'error' ? `<span class="os-circ-err">could not be marked</span>`
                : `<span class="muted tiny">not marked</span>`;
              return `<div class="os-circ-row" data-st="${esc(r.id)}">
                <span class="os-circ-n">${r.i + 1}</span>
                <div class="os-circ-mid">
                  <strong>${esc(r.st.topic || r.id)}</strong>
                  <span class="tiny muted">${esc(where)}</span>
                  ${r.m.status === 'error' ? `<span class="tiny bad">${esc(r.m.message || '')}</span>` : ''}
                  ${r.m.status === 'skipped' ? `<span class="tiny muted">${esc(r.m.message || '')}</span>` : ''}
                  <span class="tiny muted os-circ-step" hidden></span>
                </div>
                ${badge}
                <div class="os-circ-acts">
                  ${r.m.status === 'done' ? `<a class="btn btn-ghost btn-sm" href="#/osce/result/${esc(r.m.attemptId)}">Open the report</a>` : ''}
                  ${r.m.status === 'error' ? `<button class="btn btn-gold btn-sm" data-retry="${esc(r.id)}">↻ Send it again</button>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
          ${failed.length ? `<p class="muted tiny" style="margin-top:12px">A recording is kept on the server for 24 hours,
            so a station that failed can be sent again from here for the rest of the day. After that it is marked from
            the transcript instead.</p>` : ''}
        </div>

        <div class="os-run-foot" data-animate>
          <a class="btn btn-ghost" href="#/osce/progress">See it on the blueprint →</a>
          <a class="btn btn-ghost" href="#/osce/sim">Sit another circuit</a>
        </div>`);
      FX.viewIn(view);

      view.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.retry;
        b.disabled = true; b.textContent = 'Sending…';
        const step = b.closest('.os-circ-row').querySelector('.os-circ-step');
        step.hidden = false;
        try {
          await retryMark(sid, id, t => { step.textContent = t; });
        } catch (e) {
          step.textContent = String(e.message || e);
          b.disabled = false; b.textContent = '↻ Send it again';
        }
      }));
    };
    off = onMarkChange(() => { if (location.hash.includes('/osce/circuit/')) draw(); });
    await draw();
  }

  /** The button on a report that turns its misses into a deck. */
  function wireDeckMaker(view, a) {
    const btn = view.querySelector('#os-makedeck');
    const msg = view.querySelector('#os-deck-msg');
    if (!btn) return;
    const qs = allPoints(a);
    const n = qs.reduce((t, q) => t + q.points.length, 0);
    const missed = qs.reduce((t, q) => t + q.points.filter(p => p.status !== 'covered').length, 0);
    if (!n) {
      btn.disabled = true;
      msg.innerHTML = '<span class="muted">This attempt has no marked scheme to build from.</span>';
      return;
    }
    msg.innerHTML = `<span class="muted">${n} marking points, ${missed} of them new to you.</span>`;
    // a document already written for this attempt is offered rather than remade
    (async () => {
      try {
        const have = (await Backend.listOsceDecks() || []).find(d => d.attemptId === a.id && d.doc);
        if (have) msg.innerHTML = `<a class="link" href="#/osce/cards/${esc(have.id)}">A study document already exists for this attempt →</a> Writing another replaces it.`;
      } catch {}
    })();
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.innerHTML = '<span class="muted">Working…</span>';
      try {
        const d = await makeDoc(a, t => { msg.innerHTML = `<span class="muted">${esc(t)}</span>`; });
        msg.innerHTML = `<span class="good">✓ ${(d.doc.sections || []).length} sections written.</span>
          <a class="link" href="#/osce/cards/${esc(d.id)}">Open the document →</a>`;
      } catch (e) {
        msg.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`;
      }
      btn.disabled = false;
    });
  }

  /* Every marking point of the attempt, with what the marking said about
     it. This is the spine of the document: the model is told the verdict
     and writes around it, and the page marks each point in place. */
  function allPoints(a) {
    return (a.result?.questions || []).map(qr => {
      const q = (a.questions || []).find(x => String(x.id) === String(qr.id)) || {};
      return { id: qr.id, prompt: q.prompt || '', marks: q.marks || qr.max || 0,
        points: (qr.points || []).map(p => ({ point: p.point, status: /cover/i.test(p.status) ? 'covered'
          : /partial/i.test(p.status) ? 'partly said' : 'missed' })) };
    }).filter(x => x.points.length);
  }

  async function makeDoc(a, onStep = () => {}) {
    const qs = allPoints(a);
    if (!qs.length) throw new Error('This attempt has no marked scheme, so there is nothing to build from.');
    if (typeof Wallet !== 'undefined' && !(await Wallet.canSpend())) throw new Error(Wallet.blockedMessage());
    const token = await Backend.getAccessToken();
    if (!token) throw new Error('Sign in to make a study document.');
    const choice = chosenModel();
    const n = qs.reduce((t, q) => t + q.points.length, 0);
    onStep(`Writing the page from ${n} marking points across ${qs.length} questions…`);
    const res = await fetch(cfg().ai.apiBase, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'oscedoc', provider: choice.provider, model: choice.model,
        dailyLimit: cfg().ai.dailyLimit,
        station: { topic: a.station?.topic, scenario: a.station?.scenario }, questions: qs })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The document could not be written (HTTP ${res.status}).`);

    /* The said/not-said marking is decided HERE, from the attempt, never by
       the model — it is a fact about what happened and must not be open to
       a paraphrase. The model only says which section a point belongs to. */
    const verdict = new Map();
    qs.forEach(q => q.points.forEach(p => verdict.set(norm(p.point), p.status)));
    const seen = new Set();
    const doc = data.doc;
    doc.sections = (doc.sections || []).map(sec => ({
      ...sec,
      points: (sec.points || []).map(txt => {
        const k = norm(txt);
        seen.add(k);
        return { point: txt, status: verdict.get(k) || matchStatus(txt, verdict) };
      })
    }));
    // anything the model failed to place still belongs in the document
    const orphans = [];
    qs.forEach(q => q.points.forEach(p => { if (!seen.has(norm(p.point))) orphans.push(p); }));
    if (orphans.length) doc.sections.push({ heading: 'Also on the scheme', body: '', sayThis: '', points: orphans });

    const stats = { total: 0, covered: 0, partial: 0, missed: 0 };
    doc.sections.forEach(sec => sec.points.forEach(p => {
      stats.total++;
      if (p.status === 'covered') stats.covered++;
      else if (p.status === 'partly said') stats.partial++;
      else stats.missed++;
    }));

    const rec = {
      id: 'od-' + a.id,                       // one document per attempt, by construction
      attemptId: a.id, stationId: a.station_id,
      title: doc.title || a.station?.topic || 'OSCE station',
      station: a.station?.topic || '', scenario: a.station?.scenario || '',
      bp: a.bp || null, percent: a.result?.percent ?? null,
      doc, stats, created: Date.now(), model: data.model || choice.model
    };
    await Backend.saveOsceDeck(rec);
    try { if (typeof Wallet !== 'undefined') Wallet.bust(); } catch {}
    return rec;
  }

  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  /* A model that reworded a point slightly should not lose its verdict.
     Best token overlap, and only when it is convincing. */
  function matchStatus(txt, verdict) {
    const want = new Set(norm(txt).split(' ').filter(w => w.length > 3));
    if (!want.size) return 'missed';
    let best = null, bestScore = 0;
    for (const [k, v] of verdict) {
      const have = k.split(' ').filter(w => w.length > 3);
      if (!have.length) continue;
      const hit = have.filter(w => want.has(w)).length / have.length;
      if (hit > bestScore) { bestScore = hit; best = v; }
    }
    return bestScore >= 0.6 ? best : 'missed';
  }

  /* ================= the study documents (#/osce/cards) =================

     One page per attempt. It reads as a case — recognise it, work through
     it in the order it happens, know the traps — with the candidate's own
     performance marked inside it rather than listed separately. That is
     the difference from a deck of cards: the gaps are shown IN PLACE, so
     you see what you missed in the context you will need it.  */

  const DOC_MARK = {
    'covered':    { ico: '✓', cls: 'cov', label: 'you said this' },
    'partly said':{ ico: '~', cls: 'par', label: 'you half-said this' },
    'missed':     { ico: '✗', cls: 'mis', label: 'you did not say this' }
  };

  async function renderDecks(view, deckId, user) {
    view.innerHTML = shell('cards', `<div id="os-body"><p class="muted">Reading your documents…</p></div>`);
    FX.viewIn(view);
    const host = view.querySelector('#os-body');
    let docs = [];
    try { docs = (await Backend.listOsceDecks()) || []; } catch {}
    docs = docs.filter(d => d.doc);              // decks from the old card format are ignored

    if (deckId) {
      const d = docs.find(x => x.id === deckId);
      if (!d) { location.hash = '#/osce/cards'; return; }
      return paintDoc(view, host, d);
    }

    if (!docs.length) {
      host.innerHTML = `<div class="card"><h3 class="card-title">No study documents yet</h3>
        <p class="muted">At the bottom of any marked station there is a button that writes one: the whole case on a
          single page, in the order it happens, with the marking scheme woven through it and your own answer marked
          against every point. It is the page to read the night before.</p>
        <a class="btn btn-ghost" href="#/osce/mine">Your marked stations</a></div>`;
      return;
    }
    const modules = await OsceBlueprint.get().catch(() => []);
    host.innerHTML = `
      <header data-animate>
        <p class="kicker">OSCE STUDY DOCUMENTS</p>
        <h1 class="page-title">${docs.length} document${docs.length === 1 ? '' : 's'}</h1>
        <p class="muted">One per station you have sat. Each is the whole case, with what you said and what you did
          not marked in place.</p>
      </header>
      <div class="os-doc-grid" data-animate>
        ${docs.map(d => {
          const st = d.stats || {};
          const pct = st.total ? Math.round((st.covered + st.partial * 0.5) / st.total * 100) : null;
          return `<a class="os-doccard" href="#/osce/cards/${esc(d.id)}">
            <strong>${esc(d.title)}</strong>
            <em>${d.bp ? esc(OsceBlueprint.moduleName(modules, d.bp.module)) : 'unplaced'}</em>
            ${st.total ? `<div class="os-doc-bar" title="${st.covered} said, ${st.partial} half-said, ${st.missed} missed">
              <i class="cov" style="flex:${st.covered}"></i><i class="par" style="flex:${st.partial}"></i><i class="mis" style="flex:${st.missed}"></i>
            </div>
            <span class="tiny muted">${st.missed} of ${st.total} points were new to you${pct != null ? ` · ${pct}% covered` : ''}</span>` : ''}
            <span class="tiny muted">${esc(new Date(d.created).toLocaleDateString('en-GB', { dateStyle: 'medium' }))}</span>
          </a>`;
        }).join('')}
      </div>`;
    FX.viewIn(view);
  }

  /** The document itself. */
  function paintDoc(view, host, d) {
    const doc = d.doc || {};
    const st = d.stats || {};
    let filter = 'all';

    const pointRow = p => {
      const m = DOC_MARK[p.status] || DOC_MARK.missed;
      return `<li class="os-dp is-${m.cls}" data-st="${m.cls}">
        <span class="os-dp-i" title="${m.label}">${m.ico}</span>
        <span>${esc(p.point)}</span>
      </li>`;
    };

    const draw = () => {
      host.innerHTML = `
        <header data-animate>
          <p class="kicker"><a class="link" href="#/osce/cards">← All documents</a></p>
          <h1 class="page-title">${esc(doc.title || d.title)}</h1>
          ${doc.oneLine ? `<p class="os-doc-one">${esc(doc.oneLine)}</p>` : ''}
        </header>

        <div class="card os-doc-key" data-animate>
          <div class="os-doc-figs">
            <span class="os-dp-i cov">✓</span><span><strong>${st.covered || 0}</strong> you said</span>
            <span class="os-dp-i par">~</span><span><strong>${st.partial || 0}</strong> half-said</span>
            <span class="os-dp-i mis">✗</span><span><strong>${st.missed || 0}</strong> you did not</span>
          </div>
          <div class="os-doc-filters">
            ${[['all', 'Everything'], ['mis', 'Only what I missed'], ['cov', 'Only what I said']].map(([k, l]) =>
              `<button class="os-pick-b ${filter === k ? 'active' : ''}" data-filt="${k}">${l}</button>`).join('')}
          </div>
        </div>

        ${doc.recognise ? `<div class="card" data-animate>
          <h3 class="card-title">How you know you are in this case</h3>
          <p>${esc(doc.recognise)}</p></div>` : ''}

        <div class="os-doc-body" data-animate>
          ${(doc.sections || []).map((sec, i) => {
            const pts = sec.points || [];
            const missed = pts.filter(p => p.status === 'missed').length;
            return `<section class="card os-doc-sec" data-sec="${i}">
              <h3 class="card-title">
                <span class="os-doc-n">${i + 1}</span> ${esc(sec.heading || '')}
                ${missed ? `<span class="os-doc-flag">${missed} missed</span>` : ''}
              </h3>
              ${sec.body ? `<p class="os-doc-teach">${esc(sec.body)}</p>` : ''}
              ${sec.sayThis ? `<p class="os-doc-say"><span>Say it like this</span>“${esc(sec.sayThis)}”</p>` : ''}
              ${pts.length ? `<ul class="os-dp-list">${pts.map(pointRow).join('')}</ul>` : ''}
            </section>`;
          }).join('')}
        </div>

        ${(doc.traps || []).length ? `<div class="card" data-animate>
          <h3 class="card-title">⚠ What loses marks here</h3>
          <ul class="os-doc-list">${doc.traps.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}

        ${(doc.vivaQuestions || []).length ? `<div class="card" data-animate>
          <h3 class="card-title">Where the examiner goes next</h3>
          <p class="muted tiny">Answer this station well and these are what follow.</p>
          <ul class="os-doc-list">${doc.vivaQuestions.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}

        ${(doc.guidelines || []).length ? `<div class="card" data-animate>
          <h3 class="card-title">The guidance behind it</h3>
          <ul class="os-doc-list">${doc.guidelines.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}

        <div class="os-run-foot" data-animate>
          <button class="btn btn-gold" id="os-doc-print">🖨 Download as PDF</button>
          <button class="btn btn-ghost" id="os-doc-copy">📄 Copy as text</button>
          <a class="btn btn-ghost btn-sm" href="#/osce/result/${esc(d.attemptId)}">The station this came from</a>
          <button class="btn btn-ghost btn-sm qr-danger" id="os-doc-del">Delete</button>
        </div>`;
      FX.viewIn(view);
      applyFilter();

      host.querySelectorAll('[data-filt]').forEach(b => b.addEventListener('click', () => {
        filter = b.dataset.filt;
        host.querySelectorAll('[data-filt]').forEach(x => x.classList.toggle('active', x === b));
        applyFilter();
      }));
      host.querySelector('#os-doc-print').addEventListener('click', () => printDoc(d));
      host.querySelector('#os-doc-copy').addEventListener('click', e => copyOut(docAsText(d), e.currentTarget, '📄 Copy as text'));
      host.querySelector('#os-doc-del').addEventListener('click', async () => {
        if (!confirm('Delete this study document? The station and its report are not affected.')) return;
        try { await Backend.deleteOsceDeck(d.id); } catch {}
        location.hash = '#/osce/cards';
      });
    };

    /* Filtering hides POINTS, never the teaching: "only what I missed" is
       for revising the gaps, and a gap with its explanation removed is not
       revision. A section whose points all disappear goes with them. */
    function applyFilter() {
      host.querySelectorAll('.os-doc-sec').forEach(sec => {
        let shown = 0;
        sec.querySelectorAll('.os-dp').forEach(li => {
          const keep = filter === 'all' || li.dataset.st === filter
            || (filter === 'mis' && li.dataset.st === 'par');
          li.hidden = !keep;
          if (keep) shown++;
        });
        const had = sec.querySelectorAll('.os-dp').length;
        sec.hidden = filter !== 'all' && had > 0 && shown === 0;
      });
    }
    draw();
  }

  /** The document as plain text, for pasting anywhere. */
  function docAsText(d) {
    const doc = d.doc || {};
    const L = [];
    L.push(String(doc.title || d.title || '').toUpperCase());
    if (doc.oneLine) L.push(doc.oneLine);
    L.push('');
    if (doc.recognise) { L.push('HOW YOU KNOW YOU ARE IN THIS CASE'); L.push(doc.recognise); L.push(''); }
    (doc.sections || []).forEach((sec, i) => {
      L.push(`${i + 1}. ${sec.heading || ''}`);
      if (sec.body) L.push(sec.body);
      if (sec.sayThis) L.push(`   Say it like this: "${sec.sayThis}"`);
      (sec.points || []).forEach(p => {
        const m = DOC_MARK[p.status] || DOC_MARK.missed;
        L.push(`   [${m.ico}] ${p.point}`);
      });
      L.push('');
    });
    const list = (h, arr) => { if ((arr || []).length) { L.push(h); arr.forEach(x => L.push(' - ' + x)); L.push(''); } };
    list('WHAT LOSES MARKS HERE', doc.traps);
    list('WHERE THE EXAMINER GOES NEXT', doc.vivaQuestions);
    list('THE GUIDANCE BEHIND IT', doc.guidelines);
    L.push('✓ said · ~ half-said · ✗ not said — from your attempt on '
      + new Date(d.created).toLocaleDateString('en-GB', { dateStyle: 'medium' }));
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* Printed the same way the station report is: into the page, then the
     page itself. A hidden iframe is ignored by iPadOS Safari. */
  function printDoc(d) {
    const doc = d.doc || {};
    const st = d.stats || {};
    const P = '#os-printdoc';
    const styles = `
@page { size: A4 portrait; margin: 15mm 14mm; }
${P}, ${P} *{box-sizing:border-box}
${P}{position:fixed;inset:0;z-index:9000;overflow:auto;background:#f1f2f6;color:#111;
  font-family:"Helvetica Neue",Arial,sans-serif;font-size:10.5pt;line-height:1.55;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
${P} .sheet{background:#fff;width:210mm;min-height:297mm;margin:0 auto 28px;padding:15mm 14mm;box-shadow:0 2px 18px rgba(0,0,0,.16)}
${P} h1{font-family:Georgia,serif;font-size:20pt;margin:0 0 4px;color:#111}
${P} h2{font-size:12.5pt;margin:16px 0 6px;color:#111;border-left:4px solid #0d8f7d;padding-left:9px}
${P} .one{font-size:11pt;font-style:italic;color:#444;margin:0 0 10px}
${P} .brand{font-size:7.5pt;letter-spacing:.22em;text-transform:uppercase;color:#7a5a10;margin:0 0 2px}
${P} .key{display:flex;gap:16px;font-size:9pt;color:#444;border-top:1px solid #ddd;border-bottom:1px solid #ddd;
  padding:7px 0;margin:10px 0 14px}
${P} .sec{margin:0 0 14px;break-inside:avoid}
${P} .teach{margin:0 0 6px}
${P} .say{background:#f5f7f6;border-left:3px solid #0d8f7d;padding:7px 10px;margin:0 0 7px;font-style:italic}
${P} ul.pts{list-style:none;padding:0;margin:0}
${P} ul.pts li{display:flex;gap:7px;margin-bottom:.2em;break-inside:avoid}
${P} .pip{width:13px;flex:0 0 13px;text-align:center;font-weight:800}
${P} .cov{color:#0d8f7d}${P} .par{color:#a5750f}${P} .mis{color:#c62828}
${P} .mis-row{background:#fdf4f4}
${P} ul.plain{margin:0 0 8px;padding-left:1.2em}
${P} .foot{margin-top:16px;padding-top:6px;border-top:1px solid #ddd;font-size:7.5pt;color:#888;display:flex;justify-content:space-between}
${P} .os-pd-bar{position:sticky;top:0;z-index:2;display:flex;gap:10px;justify-content:center;align-items:center;
  padding:10px;background:#1b1b22;color:#fff;font-size:11pt}
${P} .os-pd-bar button{font:inherit;font-size:10pt;padding:7px 16px;border-radius:8px;border:0;cursor:pointer}
${P} .os-pd-print{background:#e8b53f;color:#241d05;font-weight:700}
${P} .os-pd-close{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}
@media print {
  html,body{background:#fff !important;margin:0 !important;padding:0 !important;height:auto !important;overflow:visible !important}
  body > *:not(${P}){display:none !important}
  ${P}{position:static !important;overflow:visible !important;background:#fff !important}
  ${P} .os-pd-bar{display:none !important}
  ${P} .sheet{width:auto !important;min-height:0 !important;margin:0 !important;padding:0 !important;box-shadow:none !important}
}`;
    const pip = p => {
      const m = DOC_MARK[p.status] || DOC_MARK.missed;
      return `<li class="${m.cls === 'mis' ? 'mis-row' : ''}"><span class="pip ${m.cls}">${m.ico}</span><span>${esc(p.point)}</span></li>`;
    };
    const list = (h, arr) => (arr || []).length
      ? `<h2>${h}</h2><ul class="plain">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const body = `<div class="os-pd-bar">
        <button class="os-pd-print" type="button" data-pd-print>🖨 Print / Save as PDF</button>
        <button class="os-pd-close" type="button" data-pd-close>Close</button>
      </div><div class="sheet">
      <p class="brand">AUREUM · Pathway to MD</p>
      <h1>${esc(doc.title || d.title || '')}</h1>
      ${doc.oneLine ? `<p class="one">${esc(doc.oneLine)}</p>` : ''}
      <div class="key"><span><b class="cov">✓</b> ${st.covered || 0} said</span>
        <span><b class="par">~</b> ${st.partial || 0} half-said</span>
        <span><b class="mis">✗</b> ${st.missed || 0} not said</span>
        <span>sat ${esc(new Date(d.created).toLocaleDateString('en-GB', { dateStyle: 'medium' }))}</span></div>
      ${doc.recognise ? `<h2>How you know you are in this case</h2><p>${esc(doc.recognise)}</p>` : ''}
      ${(doc.sections || []).map((sec, i) => `<div class="sec">
        <h2>${i + 1}. ${esc(sec.heading || '')}</h2>
        ${sec.body ? `<p class="teach">${esc(sec.body)}</p>` : ''}
        ${sec.sayThis ? `<p class="say">“${esc(sec.sayThis)}”</p>` : ''}
        ${(sec.points || []).length ? `<ul class="pts">${sec.points.map(pip).join('')}</ul>` : ''}
      </div>`).join('')}
      ${list('What loses marks here', doc.traps)}
      ${list('Where the examiner goes next', doc.vivaQuestions)}
      ${list('The guidance behind it', doc.guidelines)}
      <div class="foot"><span>${esc(d.station || '')}</span><span>AUREUM · ${esc(new Date().toLocaleDateString('en-GB', { dateStyle: 'medium' }))}</span></div>
    </div>`;
    openPrintSheet(styles, body);
  }

  /* ================= progress (#/osce/progress) =================

     The blueprint coverage map, the mistakes that keep repeating, and the
     shape of the scores. Deliberately the same arithmetic as the SBA and
     EMQ maps: a MODULE's percentage is the mean of its topics, never the
     pooled station count, so one heavily-stationed topic cannot paint a
     module green while its neighbours have never been touched.

     A topic with no station is not a gap in anybody's revision — it is a
     topic that cannot be examined this way — and it is labelled as such
     rather than sitting there as a permanent reproach. */

  async function renderProgress(view, user) {
    view.innerHTML = shell('progress', `<div id="os-body"><p class="muted">Reading your attempts…</p></div>`);
    FX.viewIn(view);
    const host = view.querySelector('#os-body');

    const [modules, cards] = await Promise.all([
      OsceBlueprint.get().catch(() => []),
      stations().catch(() => [])
    ]);
    let list = [];
    try { list = (await Backend.listOsceAttempts()) || []; } catch {}
    const scored = list.filter(a => a.result && a.result.percent != null);

    if (!scored.length) {
      host.innerHTML = `<div class="card"><h3 class="card-title">Nothing to map yet</h3>
        <p class="muted">Sit a station and this fills in: which modules of the blueprint you have covered, which
          mistakes keep coming back, and how the scores are moving.</p>
        <a class="btn btn-gold" href="#/osce/sim">Build a circuit</a></div>`;
      return;
    }

    const cov = OsceBlueprint.coverage(modules, cards, scored);
    const mean = Math.round(scored.reduce((n, a) => n + a.result.percent, 0) / scored.length);
    const passed = scored.filter(a => a.result.pass).length;
    const recent = scored.slice(0, 8).reverse();

    /* The mistakes need the FULL attempts — the list projection carries the
       score and nothing else. Only the last dozen are opened: that is where
       a pattern that still matters will be, and it keeps the page cheap. */
    host.innerHTML = coverageHtml(cov, modules, mean, passed, scored, recent)
      + `<div class="card" data-animate id="os-mistakes"><h3 class="card-title">🔁 What keeps costing you marks</h3>
           <p class="muted">Reading your last stations…</p></div>`;
    FX.viewIn(view);
    paintTrend(view, recent);

    const deep = [];
    for (const a of scored.slice(0, 12)) {
      try { const full = await Backend.getOsceAttempt(a.id); if (full) deep.push(full); } catch {}
    }
    paintMistakes(view.querySelector('#os-mistakes'), deep, modules, cards);
  }

  function coverageHtml(cov, modules, mean, passed, scored, recent) {
    const barFor = m => {
      const pct = m.percent == null ? 0 : m.percent;
      const cls = m.examinable === 0 ? 'is-none' : pct >= 80 ? 'is-good' : pct >= 40 ? 'is-mid' : 'is-low';
      return `<div class="os-cov-mod ${cls}">
        <div class="os-cov-head">
          <strong>${esc(m.name)}</strong>
          ${m.examinable === 0
            ? '<span class="tiny muted">no station examines this yet</span>'
            : `<span class="tiny muted">${m.touched} of ${m.examinable} topics${m.mean != null ? ` · ${m.mean}% mean` : ''}</span>`}
        </div>
        <div class="os-cov-bar"><i style="width:${pct}%"></i></div>
        <div class="os-cov-topics">
          ${(m.topics || []).map(t => `<span class="os-cov-chip ${
            !t.examinable ? 'is-na' : t.attempts ? (t.best >= 70 ? 'is-good' : t.best >= 50 ? 'is-mid' : 'is-low') : 'is-untouched'
          }" title="${esc(t.name)}${t.examinable ? ` — ${t.stations} station${t.stations === 1 ? '' : 's'}${
            t.attempts ? `, best ${t.best}%` : ', never sat'}` : ' — no station'}">${esc(t.name)}</span>`).join('')}
        </div>
      </div>`;
    };
    const noStation = cov.modules.filter(m => m.examinable === 0).length;
    return `
      <header data-animate>
        <p class="kicker">OSCE PROGRESS</p>
        <h1 class="page-title">Where you stand</h1>
      </header>

      <div class="card os-prog-figs" data-animate>
        <div class="os-circ-fig"><b>${scored.length}</b><span>stations marked</span></div>
        <div class="os-circ-fig"><b>${mean}%</b><span>mean score</span></div>
        <div class="os-circ-fig"><b>${passed}/${scored.length}</b><span>at or above the pass mark</span></div>
        <div class="os-circ-fig"><b>${cov.overall}%</b><span>of the blueprint touched</span></div>
      </div>

      <div class="card" data-animate>
        <h3 class="card-title">📈 How the scores are moving</h3>
        <p class="muted tiny">Your last ${recent.length} marked stations, oldest first. The line is the pass mark of
          each station, which is not the same on every one.</p>
        <div id="os-trend" class="os-trend"></div>
      </div>

      <div class="card" data-animate>
        <h3 class="card-title">🗺 The blueprint, and how much of it you have walked</h3>
        <p class="muted">The exam draws nine stations from these modules. A module only turns green when the whole of
          it has been covered — one topic sat nine times does not colour it in. ${
          noStation ? `<strong>${noStation}</strong> module${noStation === 1 ? ' has' : 's have'} no station written yet;
          they are greyed out rather than counted against you.` : ''}</p>
        <div class="os-cov">${cov.modules.map(barFor).join('')}</div>
        ${cov.untagged ? `<p class="muted tiny" style="margin-top:10px">${cov.untagged} published station${
          cov.untagged === 1 ? ' is' : 's are'} not yet placed on the blueprint, so they do not appear above.</p>` : ''}
      </div>`;
  }

  /** A small column chart of the recent scores against each station's pass mark. */
  function paintTrend(view, recent) {
    const host = view.querySelector('#os-trend');
    if (!host || !recent.length) return;
    const w = 100 / recent.length;
    host.innerHTML = recent.map((a, i) => {
      const pct = a.result.percent;
      const pass = a.passMark != null && a.result.max ? Math.round(a.passMark / a.result.max * 100) : 70;
      return `<div class="os-trend-col" style="width:${w}%" title="${esc(a.topic || '')} — ${pct}% (pass ${pass}%)">
        <i class="${a.result.pass ? 'is-pass' : 'is-fail'}" style="height:${Math.max(3, pct)}%"></i>
        <u style="bottom:${pass}%"></u>
        <span>${pct}</span>
      </div>`;
    }).join('');
  }

  /* The repeated mistakes. A point missed once is bad luck; the same point
     missed in three different stations is the thing to revise tonight —
     so they are grouped by the WORDS of the marking point, not by station,
     and only what came back more than once is promoted to the top. */
  function paintMistakes(host, attempts, modules, cards) {
    if (!host) return;
    const byId = {}; cards.forEach(c => byId[c.id] = c);
    const missed = [];
    for (const a of attempts) {
      for (const qr of (a.result?.questions || [])) {
        for (const p of (qr.points || [])) {
          if (/cover/i.test(p.status)) continue;
          missed.push({ point: String(p.point || ''), status: p.status, note: p.note || '',
            attempt: a.id, topic: a.station?.topic || '', when: a.created || 0,
            bp: a.bp || OsceBlueprint.tagOf(byId[a.station_id]) || null });
        }
      }
    }
    if (!missed.length) {
      host.innerHTML = `<h3 class="card-title">🔁 What keeps costing you marks</h3>
        <p class="muted">Nothing was missed in the stations that have been marked. That is a good problem.</p>`;
      return;
    }
    // group by the idea, not the wording: the first six significant words
    const keyOf = s => OsceBlueprint.norm(s).split(' ').filter(w => w.length > 3).slice(0, 6).join(' ');
    const groups = new Map();
    for (const m of missed) {
      const k = keyOf(m.point) || m.point.slice(0, 40);
      if (!groups.has(k)) groups.set(k, { point: m.point, n: 0, part: 0, topics: new Set(), mods: new Set(), last: 0 });
      const g = groups.get(k);
      g.n++; if (/partial/i.test(m.status)) g.part++;
      if (m.topic) g.topics.add(m.topic);
      if (m.bp?.module) g.mods.add(m.bp.module);
      g.last = Math.max(g.last, m.when);
      if (m.point.length > g.point.length) g.point = m.point;   // keep the fullest wording
    }
    const all = [...groups.values()].sort((a, b) => b.n - a.n || b.last - a.last);
    const repeats = all.filter(g => g.n > 1);
    const once = all.filter(g => g.n === 1);

    const row = g => `<li class="os-miss ${g.n > 2 ? 'is-hot' : ''}">
      <span class="os-miss-n">${g.n}×</span>
      <div>
        <strong>${esc(g.point)}</strong>
        <span class="tiny muted">${[...g.mods].map(m => esc(OsceBlueprint.moduleName(modules, m))).join(', ') || 'unplaced'}${
          g.part ? ` · ${g.part} of those were partly said` : ''} · seen in ${g.topics.size} station${g.topics.size === 1 ? '' : 's'}</span>
      </div>
    </li>`;

    host.innerHTML = `
      <h3 class="card-title">🔁 What keeps costing you marks</h3>
      <p class="muted">From your last ${attempts.length} marked station${attempts.length === 1 ? '' : 's'}.
        ${repeats.length
          ? `<strong>${repeats.length}</strong> point${repeats.length === 1 ? ' has' : 's have'} been missed more than once —
             those are the ones worth an evening, because they are costing you marks in stations that look nothing alike.`
          : 'Nothing has been missed twice yet.'}</p>
      ${repeats.length ? `<ul class="os-miss-list">${repeats.slice(0, 12).map(row).join('')}</ul>` : ''}
      ${once.length ? `<details class="dev-collapse" style="margin-top:12px">
        <summary><span class="card-title">Missed once (${once.length})</span><span class="dc-caret">▸</span></summary>
        <ul class="os-miss-list">${once.slice(0, 40).map(row).join('')}</ul>
      </details>` : ''}
      <div class="os-tips" id="os-tips"></div>`;

    /* The advice is derived, not generated: a model is not needed to notice
       that six of your last ten misses are in one module. */
    const tips = [];
    /* Counted from the misses themselves, one point one vote. Summing each
       GROUP's total into every module it appeared in multiplied the same
       miss by the number of modules it turned up in, and reported figures
       larger than the number of points that were ever dropped. */
    const modCount = new Map();
    missed.forEach(m => { if (m.bp?.module) modCount.set(m.bp.module, (modCount.get(m.bp.module) || 0) + 1); });
    const worst = [...modCount.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst && worst[1] >= 3 && modCount.size > 1) {
      tips.push(`Most of what you are dropping sits in <strong>${esc(OsceBlueprint.moduleName(modules, worst[0]))}</strong>
        — ${worst[1]} of your ${missed.length} missed points. A circuit weighted there will find the rest of them.`);
    }
    const partly = all.filter(g => g.part >= g.n / 2 && g.n > 1).length;
    if (partly) {
      tips.push(`<strong>${partly}</strong> of your repeated misses were marked <em>partial</em>, not missed — you are
        reaching the right idea and stopping short of the detail that carries the mark. Say the number, the dose or the
        time window out loud; that is usually the half you are leaving out.`);
    }
    if (repeats.length >= 3) {
      tips.push(`Make a deck from one of these attempts — a card per repeated point, with the figure on the back —
        and it will take a fortnight rather than a term to clear them.`);
    }
    const tipHost = host.querySelector('#os-tips');
    if (tips.length && tipHost) {
      tipHost.innerHTML = `<h4 class="card-title" style="margin-top:18px">What to do about it</h4>
        <ul class="os-tip-list">${tips.map(t => `<li>${t}</li>`).join('')}</ul>`;
    }
  }

  /** Any station left mid-flight, for the "resume" card on the OSCE home. */
  async function openSessions() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('aureum.osce:')) continue;
        const s = JSON.parse(localStorage.getItem(k) || 'null');
        if (s && s.phase !== 'done') out.push(s);
      }
    } catch {}
    return out.sort((a, b) => (b.started || 0) - (a.started || 0));
  }

  /** Attempts shaped for the dashboard: newest last, with the bits charts need. */
  async function progress() {
    let list = [];
    try { list = (await Backend.listOsceAttempts()) || []; } catch { return []; }
    return list
      .filter(a => a.result && a.result.percent != null)
      .map(a => ({ id: a.id, station: a.station?.topic || a.station_id, percent: a.result.percent,
        total: a.result.total, max: a.result.max, pass: !!a.result.pass, created: a.created || 0,
        passMark: a.station?.pass_mark ?? null }))
      .sort((x, y) => x.created - y.created);
  }

  /* ---------------- speak instead of type, anywhere ----------------
     Whisper is not OSCE-specific. On an iPad, where there is no dictation in
     the browser at all, a microphone button is the difference between a note
     somebody makes and one they do not.

     Attach it beside any textarea, input or contenteditable: press to record,
     press again to stop, and the transcript is appended. Silent about itself
     when Groq is unavailable — the button simply does not appear, because a
     dead button is worse than no button. */
  function micButton(target, opts = {}) {
    if (!target || !groqOn('whisper')) return null;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'voice-mic ' + (opts.className || '');
    btn.title = 'Dictate instead of typing';
    btn.innerHTML = '🎙';
    let media = null, rec = null, chunks = [], busy = false;

    const setText = t => {
      const cur = ('value' in target && target.tagName !== 'DIV') ? target.value : target.innerText;
      const joined = (cur.trim() ? cur.trim() + ' ' : '') + t;
      if ('value' in target && target.tagName !== 'DIV') { target.value = joined; }
      else { target.innerText = joined; }
      target.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const stop = async () => {
      btn.classList.remove('is-rec');
      btn.innerHTML = '⏳';
      busy = true;
      await new Promise(res => { if (!rec) return res(); rec.onstop = res; try { rec.stop(); } catch { res(); } });
      try { media?.getTracks().forEach(t => t.stop()); } catch {}
      const blob = chunks.length ? new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }) : null;
      chunks = []; rec = null; media = null;
      let out = null;
      if (blob) { try { out = await groqTranscribe(blob, opts.hint || ''); } catch {} }
      busy = false;
      btn.innerHTML = '🎙';
      if (out?.text) setText(out.text);
      else {
        btn.title = groqReport().why || 'That could not be transcribed';
        btn.classList.add('is-bad');
        setTimeout(() => btn.classList.remove('is-bad'), 2500);
      }
    };

    btn.addEventListener('click', async () => {
      if (busy) return;
      if (rec) return stop();
      try { media = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { btn.classList.add('is-bad'); btn.title = 'The microphone is blocked for this site';
        setTimeout(() => btn.classList.remove('is-bad'), 2500); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find(t => MediaRecorder.isTypeSupported(t)) || '';
      rec = new MediaRecorder(media, Object.assign(mime ? { mimeType: mime } : {}, { audioBitsPerSecond: 24000 }));
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      rec.start(1000);
      btn.classList.add('is-rec');
      btn.innerHTML = '⏹';
      // a note is a note, not a station — stop it before it becomes a file
      setTimeout(() => { if (rec) stop(); }, (opts.maxSecs || 120) * 1000);
    });
    return btn;
  }

  return { renderBank, renderStation, renderSim, renderRun, renderResult, renderMine, renderEdit, progress,
    renderCircuit, renderProgress, renderDecks,
    micButton, groqReport, resetGroq, voiceAvailable: () => groqOn('whisper'),
    stations, bustStations, collections, bustCollections, openSessions, dropSession,
    marksOf, passOf, qsOf, toWav, wavRateFor, modelChoices, noAudioReason,
    stationAsText, promptLevel, setPromptLevel, promptPlan, missingPoints, saidAlready,
    makeDoc, docAsText, allPoints, coachFor, coachWanted, COACH,
    // exposed for tests and for the circuit page's live redraw
    markState, onMarkChange, retryMark };
})();
