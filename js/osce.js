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
  let groqOff = false;                       // set once a 429 comes back
  const groqCfg = () => cfg().ai?.groq || {};
  const groqOn = k => !groqOff && groqCfg().enabled !== false && groqCfg()[k] !== false;

  async function groqCall(body) {
    const token = await Backend.getAccessToken();
    if (!token) return null;
    const res = await fetch(cfg().ai.apiBase, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    // a quota exhausted, or no grant, stands down for the whole visit rather
    // than being retried question after question
    if (res.status === 429 || res.status === 403 || res.status === 503) groqOff = true;
    return null;
  }

  /** The examiner's line as playable audio, or null to fall back to the browser. */
  async function groqVoice(text) {
    if (!groqOn('voice') || !text) return null;
    const d = await groqCall({ action: 'tts', text, voice: groqCfg().voiceName || '' });
    return d?.audio ? { data: d.audio, mime: d.mime || 'audio/wav' } : null;
  }

  /** The whole station, transcribed. `hint` biases the spelling of drug names. */
  async function groqTranscribe(blob, hint) {
    if (!groqOn('whisper') || !blob) return null;
    const d = await groqCall({ action: 'transcribe', prompt: hint,
      audio: { mime: blob.type || 'audio/webm', data: await toBase64(blob) } });
    return d?.text ? { text: d.text, model: d.model } : null;
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
    view.innerHTML = shell('sim', `
      <header data-animate>
        <p class="kicker">OSCE EXAM SIMULATOR</p>
        <h1 class="page-title">Build a circuit</h1>
        <p class="muted">The PGIM runs nine stations of fifteen minutes. Sit all nine, or as many as the time you have
          today allows — four stations is an hour. You can pause between stations, or in the middle of one, and pick
          the circuit up later exactly where you left it.</p>
      </header>

      <div class="card os-simset" data-animate>
        <h3 class="card-title">How many stations?</h3>
        <div class="os-count" id="os-count">
          ${[1, 2, 3, 4, 6, 8, 9, 12].map(n => `<button class="os-count-b ${n === 9 ? 'active' : ''}" data-n="${n}">
            <strong>${n}</strong><span>${hours(n * 15)}</span></button>`).join('')}
        </div>
        <p class="muted tiny" id="os-count-note"></p>

        <h3 class="card-title" style="margin-top:22px">Which stations?</h3>
        <div class="os-pickmode" id="os-pickmode">
          <button class="os-pick-b active" data-mode="random">🎲 Surprise me</button>
          <button class="os-pick-b" data-mode="unseen">✦ Ones I haven't done</button>
          <button class="os-pick-b" data-mode="pick">☑ Let me choose</button>
        </div>
        <div id="os-picklist" hidden></div>

        <div class="os-simset-foot">
          <span class="muted tiny" id="os-sim-sum"></span>
          <button class="btn btn-gold btn-lg" id="os-sim-go">▶ Start the circuit</button>
        </div>
      </div>

      ${list.length ? '' : `<div class="card"><p class="muted">No stations are published yet, so a circuit cannot be built.</p></div>`}`);
    FX.viewIn(view);
    if (!list.length) return;

    let want = 9, mode = 'random', chosen = new Set();
    let done = new Set();
    try { (await Backend.listOsceAttempts()).forEach(a => done.add(a.station_id)); } catch {}

    const pickHost = view.querySelector('#os-picklist');
    const sum = view.querySelector('#os-sim-sum');
    const note = view.querySelector('#os-count-note');

    function pool() {
      if (mode === 'pick') return list.filter(s => chosen.has(s.id));
      const src = mode === 'unseen' ? list.filter(s => !done.has(s.id)) : list.slice();
      const bag = (src.length ? src : list).slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      return bag.slice(0, want);
    }
    function paint() {
      const p = pool();
      const mins = p.length * 15;
      sum.innerHTML = p.length
        ? `<strong>${p.length}</strong> station${p.length === 1 ? '' : 's'} · ${hours(mins)}`
        : 'Choose at least one station.';
      view.querySelector('#os-sim-go').disabled = !p.length;
      note.textContent = mode === 'unseen'
        ? `${list.filter(s => !done.has(s.id)).length} of ${list.length} stations are still untried.`
        : `${list.length} stations are published.`;
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
      paint();
    });
    pickHost.addEventListener('change', e => {
      const c = e.target.closest('[data-pickst]'); if (!c) return;
      c.checked ? chosen.add(c.dataset.pickst) : chosen.delete(c.dataset.pickst);
      c.closest('.os-pick').classList.toggle('is-on', c.checked);
      paint();
    });
    view.querySelector('#os-sim-go').addEventListener('click', async () => {
      const p = pool(); if (!p.length) return;
      const sid = 'os-' + Date.now().toString(36);
      await saveSession({ id: sid, stations: p.map(s => s.id), at: 0, phase: 'brief', answers: {}, elapsed: 0, started: Date.now(), circuit: true });
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
    try { await Backend.clearSession(sKey(id)); } catch {}
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

    view.innerHTML = `
      <section class="page os-run">
        <div class="os-run-bar">
          <div class="os-run-id">
            <span class="os-run-n">${s.circuit ? `Station ${s.at + 1} of ${s.stations.length}` : 'Single station'}</span>
            <span class="os-run-topic">${esc(st.topic || '')}</span>
          </div>
          <div class="os-clock" id="os-clock"><span id="os-time">${fmt(total - elapsed)}</span><i id="os-ring"></i></div>
          <div class="os-run-acts">
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
          <h2>${esc(st.topic || '')}</h2>
          <p class="os-scenario big">${esc(st.scenario || '')}</p>
          <p class="muted os-readnote">${resuming
            ? `You were ${fmt(elapsed)} into this station and had answered ${qi} of ${qs.length} questions. The clock picks up where it stopped.`
            : `The examiner allows about ${st.reading_time_min || 1} minute to read. The ${minsOf(st)}-minute clock and the
               recording both start when you press the button — question 1 appears at the same moment.`}</p>
          <div class="os-mic" id="os-mic"></div>
          <div class="os-preflight" id="os-pre">
            <button class="btn btn-ghost btn-sm" id="os-pre-go">🎙 Test the microphone first</button>
            <span class="muted tiny">Worth ten seconds — a blocked microphone is much easier to fix now than four
              questions into a fifteen-minute station.</span>
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
      // fetched in the background while the scenario is being read
      prefetchVoices().catch(() => {});
      stage.querySelector('#os-go').addEventListener('click', async () => {
        await startCapture();
        startClock();
        show(qi);
      });
    }

    async function prefetchVoices() {
      if (voicesReady || !groqOn('voice')) return;
      voicesReady = true;
      for (const q of qs) {
        const line = (q.reveal_before ? q.reveal_before + '. ' : '') + q.prompt;
        const clip = await groqVoice(line);
        if (!clip) break;                       // quota gone; the browser voice takes over
        voices.set(q.id, clip);
      }
    }

    async function startCapture() {
      live = makeCapture(stage.querySelector('#os-mic'), voices.size > 0);
      live.watchState(() => paintRecState(stage));
      await live.start();
    }

    /** Say the examiner's line: the real voice onto the tape, or the browser's. */
    async function examinerSays(q, text) {
      const clip = voices.get(q?.id);
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
      examinerSays(q, (q.reveal_before ? q.reveal_before + '. ' : '') + q.prompt);
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
        store();
        i + 1 >= qs.length ? finish(false) : show(i + 1);
      });
      stage.querySelector('#os-back').addEventListener('click', () => { store(); show(Math.max(0, i - 1)); });
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

        <div class="card os-markbox" data-animate>
          <h3 class="card-title">✨ Mark it against the scheme</h3>
          <p class="muted">Every scheme point is marked covered, partial or missed, and you get an examiner's verdict,
            the marks you missed and what to do about them. This is the only step that uses AI, and what it costs is
            shown before you press the button.</p>
          <div class="os-src" id="os-src"></div>
          <div class="os-mark-acts">
            <div class="os-prov" id="os-prov"></div>
            <button class="btn btn-gold btn-lg" id="os-mark" ${spoken || rec?.blob ? '' : 'disabled'}>Mark this station</button>
          </div>
          <p class="os-est" id="os-est"></p>
          ${spoken || rec?.blob ? '' : '<p class="muted tiny">Nothing was captured, so there is nothing to mark. Type your answers above if you want it marked anyway.</p>'}
          <div id="os-mark-out"></div>
        </div>

        <div class="os-run-foot">
          ${s.circuit && s.at + 1 < s.stations.length
            ? `<button class="btn btn-primary btn-lg" id="os-nextst">Next station (${s.at + 2} of ${s.stations.length}) →</button>`
            : `<a class="btn btn-ghost" href="#/osce">Back to the stations</a>`}
        </div>`;

      stage.querySelectorAll('[data-eq]').forEach(el => el.addEventListener('input', () => {
        ans[el.dataset.eq] = { id: el.dataset.eq, transcript: el.innerText.trim() }; persist();
      }));
      transcribeIfWorthIt(stage, rec);
      wireMarkControls(stage, st, ans, said, rec, s);
      stage.querySelector('#os-nextst')?.addEventListener('click', async () => {
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
      speakClip, mixed: () => !!mixDest,
      kill: () => { clearInterval(watch); watch = null;
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
      if (typeof Wallet !== 'undefined' && !(await Wallet.canSpend())) throw new Error(Wallet.blockedMessage());
      const token = await Backend.getAccessToken();
      if (!token) throw new Error('Sign in to have a station marked.');
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
        answers: qsOf(st).map(q => ({ id: q.id, transcript: (ans[q.id]?.transcript || '') }))
      };
      if (useAudio) {
        // a model that needs WAV gets the tape re-encoded; everything else
        // gets it exactly as it was recorded
        let send = rec.blob, mime = rec.mime || 'audio/webm';
        if (choice.audioFormat === 'wav') {
          out.innerHTML += `<p class="muted tiny" id="os-wav">Re-encoding the recording for ${esc(choice.label)}…</p>`;
          const w = await toWav(rec.blob, rec.secs);
          send = w.blob; mime = 'audio/wav';
          const note = document.querySelector('#os-wav');
          if (note) note.textContent = `Re-encoded to ${(w.rate / 1000)} kHz mono — ${(w.bytes / 1048576).toFixed(1)} MB to upload.`;
        }
        body.audio = { mime, data: await toBase64(send) };
      }
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
        id: 'oa-' + Date.now().toString(36),
        station_id: st.id, station: { topic: st.topic, scenario: st.scenario, total_marks: marksOf(st), pass_mark: passOf(st) },
        questions: qsOf(st), answers, result, created: Date.now(),
        model: data.model || choice.model, modelLabel: choice.label, provider: choice.provider,
        heard: !!data.heard, elapsed: session?.elapsed || null,
        cost: { inTok: data.usage?.in || 0, outTok: data.usage?.out || 0, usd, lkr: usd * rate, rate }
      };
      /* Keep the tape for a day. It is what makes the marking checkable —
         you can hear what you actually said against what you were marked on —
         and it costs almost nothing at 24 kbps. After 24 hours it is swept. */
      if (rec?.blob) {
        try {
          const up = await Backend.uploadOsceAudio(attempt.id, rec.blob);
          if (up) { attempt.audioPath = up.path; attempt.audioExpires = up.expires; attempt.audioSecs = rec.secs; }
        } catch { /* the marking is the point; the tape is a bonus */ }
      }
      try { await Backend.saveOsceAttempt(attempt); } catch {}
      try { if (typeof Wallet !== 'undefined') Wallet.bust(); } catch {}
      out.innerHTML = '';
      location.hash = '#/osce/result/' + attempt.id;
    } catch (e) {
      out.innerHTML = `<p class="ai-error">${esc(e.message || e)}</p>`;
      btn.disabled = false;
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
          <h3 class="card-title">👨‍⚖️ Examiner's verdict</h3><p>${esc(r.examinerComment)}</p></div>` : ''}

        ${r.structure ? `<div class="card" data-animate>
          <h3 class="card-title">How you performed</h3>
          <div class="os-perf">
            ${['coverage', 'fluency', 'safety'].filter(k => r.structure[k]).map(k => `
              <div class="os-perf-c"><span class="os-perf-k">${k === 'coverage' ? '🎯 Coverage' : k === 'fluency' ? '🗣 Delivery' : '⚠ Safety'}</span>
                <p>${esc(r.structure[k])}</p></div>`).join('')}
          </div></div>` : ''}

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

        <div class="es-report-foot">
          <button class="btn btn-gold" id="os-print">🖨 Print / Save as PDF</button>
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

    wireExplore(view, a);
    view.querySelector('#os-print').addEventListener('click', () => printPicker(a));
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
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.station?.topic || 'OSCE')} — OSCE result</title>
<style>
@page { size: A4 portrait; margin: 16mm 15mm 14mm; }
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{background:#f1f2f6;color:#111;font-family:"Helvetica Neue",Arial,sans-serif;font-size:10pt;line-height:1.5;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{background:#fff}
@media screen{.sheet{width:210mm;min-height:297mm;margin:0 auto;padding:16mm 15mm;box-shadow:0 2px 18px rgba(0,0,0,.16)}}
h1{font-family:Georgia,serif;font-size:21pt;margin:0 0 4px}
h2{font-size:13pt;margin:0 0 8px;border-left:4px solid #0d8f7d;padding-left:9px}
h3{font-size:10.5pt;margin:12px 0 4px}
p{margin:0 0 .6em} ul,ol{margin:0 0 .6em;padding-left:1.3em}
.brand{font-size:7.5pt;letter-spacing:.22em;text-transform:uppercase;color:#7a5a10;margin:0 0 2px}
.eyebrow{font-size:8pt;letter-spacing:.12em;text-transform:uppercase;color:#666;margin:0 0 4px}
.cover{border-bottom:3px solid #0d8f7d;padding-bottom:12px;margin-bottom:16px}
.scorebox{display:flex;gap:16px;margin-top:10px}
.pct{flex:0 0 120px;border:2px solid ${r.pass ? '#047857' : '#c62828'};color:${r.pass ? '#047857' : '#c62828'};
  border-radius:8px;padding:10px 8px;text-align:center}
.pct b{display:block;font-size:26pt;line-height:1}.pct span{display:block;font-size:8pt;text-transform:uppercase;margin-top:5px}
.kv{flex:1;border-collapse:collapse;font-size:9pt}.kv th{text-align:left;padding:3px 8px 3px 0;color:#444;white-space:nowrap;width:1%}
.kv td{padding:3px 12px 3px 0}
.blk{margin:0 0 16px;break-inside:auto}
.callout{border:1px solid #d5d5d5;border-left:3px solid #0d8f7d;padding:8px 11px;margin:0 0 .8em;background:#fafafa;break-inside:avoid}
.q{border:1px solid #e0e0e0;border-radius:5px;padding:9px 11px;margin-bottom:9px;break-inside:avoid}
.qh{display:flex;gap:9px;align-items:baseline;margin-bottom:5px}
.qh b{flex:1}.qh i{font-style:normal;font-weight:700;white-space:nowrap}
.pts{list-style:none;padding:0;margin:0}
.pts li{display:flex;gap:6px;margin-bottom:.18em}
.pip{width:13px;text-align:center;font-weight:800;flex:0 0 13px}
.cov{color:#0d8f7d}.par{color:#a5750f}.mis{color:#c62828}
.note{display:block;font-style:italic;color:#666;font-size:.9em}
.said{border-left:2px solid #ddd;padding-left:9px;margin-top:6px;font-size:.9em;color:#555}
.foot{margin-top:18px;padding-top:6px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:7.5pt;color:#888}
.blank li{color:#333}
.qimgs{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 8px}
.qimgs figure{margin:0;flex:1 1 240px;max-width:100%;break-inside:avoid}
.qimgs img{width:100%;height:auto;border:1px solid #ddd;border-radius:3px}
.qimgs figcaption{font-size:8pt;color:#666;margin-top:2px}
</style></head><body><div class="sheet">
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
        <span>${esc(p.point)}${has('marks') && p.note ? `<span class="note">${esc(p.note)}</span>` : ''}</span></li>`).join('')}</ul>`
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
</div></body></html>`;

    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0';
    document.body.appendChild(f);
    f.srcdoc = doc;
    f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch {}
      setTimeout(() => f.remove(), 60000); };
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
        ${tab('edit', '#/osce/edit', 'Station editor')}
      </div>${inner}</section>`;
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

  return { renderBank, renderStation, renderSim, renderRun, renderResult, renderMine, renderEdit, progress,
    stations, bustStations, collections, bustCollections, openSessions, dropSession,
    marksOf, passOf, qsOf, toWav, wavRateFor, modelChoices, noAudioReason };
})();
