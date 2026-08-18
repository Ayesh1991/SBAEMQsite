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
  const qsOf = st => st.questions || [];
  const marksOf = st => st.total_marks || qsOf(st).reduce((n, q) => n + (q.marks || 0), 0) || 50;
  const passOf = st => st.pass_mark != null ? st.pass_mark
    : Math.round(marksOf(st) * ((st.pass_mark_percent || 70) / 100));
  const minsOf = st => st.station_time_min || 15;

  /** 45 → "45 min", 120 → "2 h", 135 → "2 h 15". */
  const hours = mins => mins < 60 ? mins + ' min'
    : (mins % 60 ? `${Math.floor(mins / 60)} h ${mins % 60}` : `${mins / 60} h`);
  const fmt = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  /* ================= the bank (#/osce) ================= */

  async function renderBank(view, user) {
    view.innerHTML = shell('bank', `<div id="os-body"><p class="muted">Loading OSCE stations…</p></div>`);
    FX.viewIn(view);
    const [list, past] = await Promise.all([
      stations().catch(() => []),
      Backend.listOsceAttempts().catch(() => [])
    ]);
    const bestOf = {};
    past.forEach(a => { const p = a.result?.percent; if (p != null && (bestOf[a.station_id] == null || p > bestOf[a.station_id])) bestOf[a.station_id] = p; });
    const body = view.querySelector('#os-body');

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

      <div class="os-grid" id="os-grid" data-animate>${list.map(st => card(st, bestOf[st.id])).join('')}</div>
      <p class="muted" id="os-none" hidden>No station mentions that.</p>`;

    const input = body.querySelector('#os-search');
    const clear = body.querySelector('#os-search-x');
    const grid = body.querySelector('#os-grid');
    const none = body.querySelector('#os-none');
    const hay = {};
    list.forEach(st => hay[st.id] = `${st.topic || ''} ${st.scenario || ''} ${qsOf(st).map(q => q.prompt + ' ' + (q.marking_points || []).join(' ')).join(' ')}`.toLowerCase());
    const run = () => {
      const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      clear.hidden = !terms.length;
      let shown = 0;
      grid.querySelectorAll('.os-card').forEach(c => {
        const ok = terms.every(t => hay[c.dataset.st].includes(t));
        c.hidden = !ok; if (ok) shown++;
      });
      none.hidden = shown > 0;
    };
    input.addEventListener('input', run);
    clear.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
  }

  function card(st, best) {
    const n = qsOf(st).length;
    return `
      <a class="os-card" data-st="${esc(st.id)}" href="#/osce/station/${encodeURIComponent(st.id)}">
        <div class="os-card-top">
          <span class="os-card-time">${minsOf(st)} min</span>
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
    const list = await stations().catch(() => []);
    const st = list.find(x => x.id === id);
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
          <div><strong>${qsOf(st).length}</strong><span>questions</span></div>
          <div><strong>${marksOf(st)}</strong><span>marks</span></div>
          <div><strong>${passOf(st)}</strong><span>to pass (${st.pass_mark_percent || 70}%)</span></div>
          <div><strong>${minsOf(st)}</strong><span>minutes</span></div>
        </div>
        <p class="muted tiny os-warn">You will answer <strong>out loud</strong>. The browser asks for the microphone
          when the station starts; the whole ${minsOf(st)} minutes is recorded and offered as a download at the end.
          Nothing is uploaded unless you ask for AI marking.</p>
        <div class="os-brief-acts">
          <button class="btn btn-gold btn-lg" id="os-start">▶ Start the station</button>
          <a class="btn btn-ghost" href="#/osce/sim">Add it to a simulator session instead</a>
        </div>
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
  }

  /* ================= the simulator (#/osce/sim) ================= */

  async function renderSim(view, user) {
    const list = await stations().catch(() => []);
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
          ${[3, 4, 6, 8, 9, 12].map(n => `<button class="os-count-b ${n === 9 ? 'active' : ''}" data-n="${n}">
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
            <span><strong>${esc(s.topic || s.id)}</strong><em>${qsOf(s).length} questions · ${marksOf(s)} marks${done.has(s.id) ? ' · attempted' : ''}</em></span>
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
    const list = await stations().catch(() => []);
    if (!s || !list.length) { location.hash = '#/osce'; return; }
    const st = list.find(x => x.id === s.stations[s.at]);
    if (!st) { location.hash = '#/osce'; return; }

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
      const left = Math.max(0, total - elapsed);
      timeEl.textContent = fmt(left);
      const pct = Math.min(100, (elapsed / total) * 100);
      ringEl.style.width = pct + '%';
      view.querySelector('#os-clock').classList.toggle('is-low', left <= 120 && left > 0);
      view.querySelector('#os-clock').classList.toggle('is-out', left <= 0);
      progEl.style.width = (qs.length ? ((qi) / qs.length) * 100 : 0) + '%';
    }
    function tick() {
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

    /* ---- the three phases ---- */
    if (s.phase === 'done' || qi >= qs.length) { debrief(); }
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
          <button class="btn btn-gold btn-lg" id="os-go">${resuming ? '▶ Resume the station' : "▶ I've read it — start"}</button>
        </div>`;
      stage.querySelector('#os-go').addEventListener('click', async () => {
        await startCapture();
        startClock();
        show(qi);
      });
    }

    async function startCapture() {
      live = makeCapture(stage.querySelector('#os-mic'));
      await live.start();
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
          <p class="os-prompt">${esc(q.prompt)}</p>
          <div class="os-answer">
            <div class="os-answer-head">
              <span class="os-rec ${live?.ok?.() ? '' : 'is-off'}" id="os-rec"><i></i> ${live?.ok?.() ? 'recording' : 'not recording'}</span>
              <span class="muted tiny">Speak your answer. What the browser hears appears below — you can correct it later.</span>
            </div>
            <div class="os-transcript" id="os-tx" contenteditable="true" spellcheck="false"
              data-ph="Your spoken answer appears here…">${esc(prev)}</div>
          </div>
          <div class="os-qfoot">
            <button class="btn btn-ghost" id="os-back" ${i === 0 ? 'disabled' : ''}>← Previous</button>
            <span class="muted tiny" id="os-hint">Take the marks in order — say the headline first, then the detail.</span>
            <button class="btn btn-gold" id="os-next">${i === qs.length - 1 ? 'Finish the station →' : 'Next question →'}</button>
          </div>
        </div>`;
      const tx = stage.querySelector('#os-tx');
      live?.attach(text => { if (text) { tx.textContent = (tx.textContent + ' ' + text).trim(); } });
      const store = () => { ans[q.id] = { id: q.id, transcript: tx.innerText.trim() }; persist(); };
      tx.addEventListener('input', store);
      stage.querySelector('#os-next').addEventListener('click', () => { store(); i + 1 >= qs.length ? finish(false) : show(i + 1); });
      stage.querySelector('#os-back').addEventListener('click', () => { store(); show(Math.max(0, i - 1)); });
    }

    async function finish(timedOut) {
      if (tid) clearInterval(tid); tid = null; running = false;
      pauseBtn.hidden = true;
      qi = qs.length; s.phase = 'done'; persist();
      const rec = live ? await live.stop() : null;
      s._audio = rec ? rec.url : null;
      debrief(timedOut, rec);
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
            <span class="muted tiny">${rec.mins} — keep it; hearing yourself back is the fastest way to fix pace and waffle.</span>
          </div>` : `<p class="muted tiny">No audio was captured for this run.</p>`}
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">What you said</h3>
          ${said.map(({ q, t }, i) => `
            <div class="os-said ${t ? '' : 'is-empty'}">
              <p class="os-said-q"><strong>Q${i + 1}</strong> ${esc(q.prompt)} <span class="muted tiny">(${q.marks})</span></p>
              <div class="os-said-t" contenteditable="true" spellcheck="false" data-eq="${esc(q.id)}"
                data-ph="Nothing was captured for this question">${esc(t)}</div>
            </div>`).join('')}
        </div>

        <div class="card os-markbox" data-animate>
          <h3 class="card-title">✨ Mark it against the scheme</h3>
          <p class="muted">Your answers are marked point by point against the station's own marking scheme, and you get
            an examiner's verdict, the marks you missed and what to do about them. This is the only step that uses AI —
            about <strong>${estTokens(st, said)}</strong> tokens, roughly <strong>${estCost(st, said)}</strong>.</p>
          <div class="os-mark-acts">
            <div class="os-prov" id="os-prov"></div>
            <button class="btn btn-gold btn-lg" id="os-mark" ${spoken ? '' : 'disabled'}>Mark this station</button>
          </div>
          ${spoken ? '' : '<p class="muted tiny">Nothing was captured, so there is nothing to mark. Type your answers above if you want it marked anyway.</p>'}
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
      renderProviderPicker(stage.querySelector('#os-prov'));
      stage.querySelector('#os-mark')?.addEventListener('click', e => mark(e.target, st, ans, s));
      stage.querySelector('#os-nextst')?.addEventListener('click', async () => {
        s.at += 1; s.qi = 0; s.elapsed = 0; s.phase = 'brief';
        await saveSession(s); stopLive(); renderRun(view, sid, user);
      });
    }
  }

  /* ---------------- microphone + recogniser ---------------- */

  function makeCapture(host) {
    let media = null, rec = null, chunks = [], sr = null, onText = null, mime = '', started = 0;
    const say = (msg, cls) => { if (host) host.innerHTML = `<p class="os-mic-msg ${cls || ''}">${msg}</p>`; };

    async function start() {
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        say('⚠ The microphone was refused, so nothing will be recorded. You can still type your answers.', 'is-warn');
        return;
      }
      mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
        .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      try {
        rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
        rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.start(1000);
        started = Date.now();
      } catch { rec = null; }
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
    function pause() { try { rec?.state === 'recording' && rec.pause(); } catch {} try { if (sr) { sr._stopped = true; sr.stop(); } } catch {} }
    function resume() { try { rec?.state === 'paused' && rec.resume(); } catch {} try { if (sr) { sr._stopped = false; sr.start(); } } catch {} }
    async function stop() {
      try { if (sr) { sr._stopped = true; sr.stop(); } } catch {}
      const done = new Promise(res => { if (!rec) return res(null); rec.onstop = () => res(true); try { rec.stop(); } catch { res(null); } });
      await done;
      try { media?.getTracks().forEach(t => t.stop()); } catch {}
      if (!chunks.length) return null;
      const type = mime || 'audio/webm';
      const blob = new Blob(chunks, { type });
      const secs = Math.round((Date.now() - started) / 1000);
      return { url: URL.createObjectURL(blob), ext: /mp4|aac/.test(type) ? 'm4a' : 'webm',
        mins: `${fmt(secs)} of audio · ${(blob.size / 1024 / 1024).toFixed(1)} MB` };
    }
    return { ok: () => !!rec, start, attach, pause, resume, stop, kill: () => { try { sr && (sr._stopped = true, sr.stop()); } catch {} try { rec?.state !== 'inactive' && rec.stop(); } catch {} try { media?.getTracks().forEach(t => t.stop()); } catch {} } };
  }
  function stopLive() { try { live?.kill(); } catch {} live = null; }

  /* ---------------- AI marking ---------------- */

  // ~1.3 tokens a word both ways, plus the scheme and the instructions.
  function estTokens(st, said) {
    const words = said.reduce((n, x) => n + x.t.split(/\s+/).filter(Boolean).length, 0);
    const scheme = qsOf(st).reduce((n, q) => n + (q.prompt + ' ' + (q.marking_points || []).join(' ')).split(/\s+/).length, 0);
    const input = Math.round((words + scheme) * 1.3) + 500;
    const output = 900 + qsOf(st).length * 120;
    return `${(input + output).toLocaleString('en-US')}`;
  }
  function estCost(st, said) {
    try {
      const words = said.reduce((n, x) => n + x.t.split(/\s+/).filter(Boolean).length, 0);
      const scheme = qsOf(st).reduce((n, q) => n + (q.prompt + ' ' + (q.marking_points || []).join(' ')).split(/\s+/).length, 0);
      const inTok = Math.round((words + scheme) * 1.3) + 500;
      const outTok = 900 + qsOf(st).length * 120;
      const model = provider() === 'claude' ? cfg().ai.claudeModel : provider() === 'gpt' ? cfg().ai.gptModel : cfg().ai.geminiModel;
      const r = (typeof Billing !== 'undefined') ? Billing.rateFor(model) : { in: 0, out: 0 };
      const usd = (inTok / 1e6) * (r.in || 0) + (outTok / 1e6) * (r.out || 0);
      const lkr = usd * (typeof Wallet !== 'undefined' ? Wallet.rate() : 340);
      return usd < 0.005 ? `LKR ${lkr.toFixed(2)}` : `$${usd.toFixed(3)} · LKR ${lkr.toFixed(2)}`;
    } catch { return 'a fraction of a cent'; }
  }

  let _prov = null;
  const provider = () => _prov || (typeof AI !== 'undefined' && AI.provider?.()) || 'gemini';
  function renderProviderPicker(host) {
    if (!host) return;
    const opts = [['gemini', 'Gemini'], ['claude', 'Claude'], ['gpt', 'GPT']];
    host.innerHTML = `<label class="os-prov-l">Marked by
      <select class="sel" id="os-prov-sel">${opts.map(([v, l]) =>
        `<option value="${v}" ${provider() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    host.querySelector('#os-prov-sel').addEventListener('change', e => { _prov = e.target.value; });
  }

  async function mark(btn, st, ans, session) {
    const out = document.querySelector('#os-mark-out');
    btn.disabled = true;
    out.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>
      <p class="muted tiny">Marking ${qsOf(st).length} answers against ${qsOf(st).reduce((n, q) => n + (q.marking_points || []).length, 0)} marking points…</p>`;
    try {
      if (typeof Wallet !== 'undefined' && !(await Wallet.canSpend())) throw new Error(Wallet.blockedMessage());
      const token = await Backend.getAccessToken();
      if (!token) throw new Error('Sign in to have a station marked.');
      const p = provider();
      const model = p === 'claude' ? cfg().ai.claudeModel : p === 'gpt' ? cfg().ai.gptModel : cfg().ai.geminiModel;
      const res = await fetch(cfg().ai.apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          action: 'osce', provider: p, model, dailyLimit: cfg().ai.dailyLimit,
          station: { topic: st.topic, scenario: st.scenario, total_marks: marksOf(st), pass_mark: passOf(st),
            questions: qsOf(st).map(q => ({ id: q.id, prompt: q.prompt, marks: q.marks, marking_points: q.marking_points || [] })) },
          answers: qsOf(st).map(q => ({ id: q.id, transcript: (ans[q.id]?.transcript || '') }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Marking failed (HTTP ${res.status}).`);
      const result = parseResult(data.text, st);
      const attempt = {
        id: 'oa-' + Date.now().toString(36),
        station_id: st.id, station: { topic: st.topic, scenario: st.scenario, total_marks: marksOf(st), pass_mark: passOf(st) },
        questions: qsOf(st), answers: qsOf(st).map(q => ({ id: q.id, transcript: ans[q.id]?.transcript || '' })),
        result, created: Date.now(), model: data.model || model, provider: p
      };
      try { await Backend.saveOsceAttempt(attempt); } catch {}
      try { if (typeof Wallet !== 'undefined') await Wallet.charge(data.usage, model, 'osce'); } catch {}
      out.innerHTML = '';
      location.hash = '#/osce/result/' + attempt.id;
    } catch (e) {
      out.innerHTML = `<p class="ai-error">${esc(e.message || e)}</p>`;
      btn.disabled = false;
    }
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
            <p class="kicker">OSCE STATION RESULT · ${esc(new Date(a.created || Date.now()).toLocaleDateString('en-GB', { dateStyle: 'medium' }))}</p>
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
    view.querySelector('#os-print').addEventListener('click', () => printResult(a));
    view.querySelector('#os-del').addEventListener('click', async () => {
      if (!confirm('Delete this OSCE result?')) return;
      try { await Backend.deleteOsceAttempt(a.id); } catch {}
      location.hash = '#/osce';
    });
  }

  /* ---------------- the printable report ---------------- */

  function printResult(a) {
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
</style></head><body><div class="sheet">
<header class="cover">
  <p class="brand">AUREUM · Pathway to MD</p>
  <p class="eyebrow">OSCE station report</p>
  <h1>${esc(a.station?.topic || '')}</h1>
  <p style="font-size:9pt;color:#555">${esc(a.station?.scenario || '')}</p>
  <div class="scorebox">
    <div class="pct"><b>${r.percent != null ? r.percent + '%' : '—'}</b><span>${r.pass ? 'Pass' : 'Below pass'}</span></div>
    <table class="kv">
      <tr><th>Marks</th><td>${r.total} / ${r.max}</td><th>Pass mark</th><td>${a.station?.pass_mark ?? '—'}</td></tr>
      <tr><th>Sat</th><td>${esc(new Date(a.created || Date.now()).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td>
          <th>Marked by</th><td>${esc(a.model || a.provider || '')}</td></tr>
    </table>
  </div>
</header>
${r.examinerComment ? `<section class="blk"><h2>Examiner's verdict</h2><div class="callout"><p>${esc(r.examinerComment)}</p></div></section>` : ''}
${r.structure ? `<section class="blk"><h2>How you performed</h2>
  ${['coverage', 'fluency', 'safety'].filter(k => r.structure[k]).map(k =>
    `<p><strong>${k === 'coverage' ? 'Coverage' : k === 'fluency' ? 'Delivery' : 'Safety'}.</strong> ${esc(r.structure[k])}</p>`).join('')}</section>` : ''}
<section class="blk"><h2>Marked against the scheme</h2>
  ${(r.questions || []).map((qr, i) => {
    const q = qById[String(qr.id)] || {};
    return `<div class="q">
      <div class="qh"><b>Q${i + 1}. ${esc(q.prompt || '')}</b><i>${qr.awarded}/${qr.max}</i></div>
      <ul class="pts">${(qr.points || []).map(p => `<li><span class="pip ${/cover/i.test(p.status) ? 'cov' : /partial/i.test(p.status) ? 'par' : 'mis'}">${mark(p.status)}</span>
        <span>${esc(p.point)}${p.note ? `<span class="note">${esc(p.note)}</span>` : ''}</span></li>`).join('')}</ul>
      ${qr.comment ? `<p style="margin-top:6px">${esc(qr.comment)}</p>` : ''}
      <div class="said"><strong>You said:</strong> ${esc(ansById[String(qr.id)] || '(nothing captured)')}</div>
    </div>`;
  }).join('')}</section>
${(r.improvements || []).length ? `<section class="blk"><h2>What to do first</h2><ol>${r.improvements.map(x =>
  `<li>${esc(typeof x === 'string' ? x : x.action)}${x.marks ? ` <strong>(+${x.marks} marks)</strong>` : ''}</li>`).join('')}</ol></section>` : ''}
${(r.strengths || []).length ? `<section class="blk"><h2>What was good</h2><ul>${r.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
${(r.keyLearning || []).length ? `<section class="blk"><h2>Key learning points</h2><ol>${r.keyLearning.map(x => `<li>${esc(x)}</li>`).join('')}</ol></section>` : ''}
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
    return `<section class="page">
      <div class="lib-subnav" data-animate>
        <a class="lib-tab ${active === 'bank' ? 'active' : ''}" href="#/osce">Station bank</a>
        <a class="lib-tab ${active === 'sim' ? 'active' : ''}" href="#/osce/sim">Exam simulator</a>
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

  return { renderBank, renderStation, renderSim, renderRun, renderResult,
    stations, bustStations, openSessions, dropSession, marksOf, passOf, qsOf };
})();
