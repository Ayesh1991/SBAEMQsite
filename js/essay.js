/* ============================================================
   essay.js — the Essay section (SAQ / SEQ structured essays).

   Flow:
     1. Papers — numbered mock papers (ogr-essay-paper-v1), dev-published.
     2. Paper → questions (SAQ 100 marks; SEQ with 4 sub-parts).
     3. Writing mode — per-question pausable countdown (30 min/question,
        3 h/paper). You handwrite on paper; the timer just paces you.
     4. Feedback — the handwritten answer is photographed and marked by a
        separate Claude project that returns a JSON report
        (ogr-essay-feedback-v1). Users upload that JSON here; the developer's
        are auto-imported from Drive. The report is rendered richer than the
        source DOCX, with an AI tutor + AI weakness analysis on top.
   ============================================================ */

const Essay = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cfg = () => window.AUREUM_CONFIG || {};

  /* ---------- data ---------- */

  async function papers() {
    const loader = () => Backend.getEssayPapers().then(r => r || []);
    const list = (typeof Cache !== 'undefined')
      ? await Cache.wrap('essay-papers', 15 * 60 * 1000, loader, { keepIfEmptied: true })
      : await loader();
    return list.slice().sort(byPaperOrder);
  }
  function bustPapers() { if (typeof Cache !== 'undefined') Cache.bust('essay-papers'); }

  /* ---------- mock papers vs real PGIM past papers ----------
     A past paper is not practice material with the same status as a mock —
     it is what the examiners actually set — so it is kept in its own list,
     carries its own colour everywhere it appears, and never gets counted or
     sorted alongside the mocks. */
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
  const isPgim = p => /official_past_paper|past_paper|pgim/i.test(String(p.paperType || ''))
    || (p.paperNumber == null && !!p.year);
  const paperKind = p => isPgim(p) ? 'pgim' : 'mock';
  const paperTitle = p => p.paperLabel
    || (isPgim(p) ? `${p.sittingMonth || ''} ${p.year || ''}`.trim() : `Mock Paper ${p.paperNumber || ''}`.trim());
  // past papers newest first (that is how anyone revises them); mocks in order
  function byPaperOrder(a, b) {
    const ka = isPgim(a), kb = isPgim(b);
    if (ka !== kb) return ka ? 1 : -1;
    if (ka) return sitting(b) - sitting(a);
    return (a.paperNumber || 0) - (b.paperNumber || 0);
  }
  const sitting = p => (Number(p.year) || 0) * 100 +
    (MONTHS.indexOf(String(p.sittingMonth || '').toLowerCase()) + 1);

  // flatten a paper's sections into an ordered question list
  function questionsOf(p) {
    const out = [];
    (p.sections || []).forEach(sec => (sec.questions || []).forEach(q =>
      out.push({ ...q, sectionTitle: sec.sectionTitle })));
    return out;
  }
  /* A part may itself be split into sub-parts (PGIM 6.2.1, 6.2.2 …). Flatten
     one level so the whole question is visible wherever parts are listed. */
  function partsOf(q) {
    const out = [];
    (q.parts || []).forEach(pt => {
      out.push({ label: pt.label, text: pt.text, marks: pt.marks });
      (pt.subparts || pt.subParts || []).forEach(sp =>
        out.push({ label: sp.label, text: sp.text, marks: sp.marks, sub: true }));
    });
    return out;
  }
  const qMarks = q => q.totalMarks || q.marks
    || partsOf(q).reduce((s, x) => s + (x.marks || 0), 0) || 100;

  /* ================= list of papers (#/library/essay) ================= */

  async function renderList(view, user, kind) {
    kind = kind === 'pgim' ? 'pgim' : 'mock';
    view.innerHTML = libraryShell('essay', `
      <div id="es-body"><p class="muted">Loading essay papers…</p></div>`);
    FX.viewIn(view);
    let list = [], fb = [];
    try { list = await papers(); } catch (e) { list = []; }
    try { fb = (await Backend.listEssayFeedback()) || []; } catch { fb = []; }
    const fbByCode = {}; fb.forEach(f => fbByCode[f.code] = f);
    const body = view.querySelector('#es-body');
    const mine = list.filter(p => paperKind(p) === kind);
    const nMock = list.filter(p => paperKind(p) === 'mock').length;
    const nPgim = list.length - nMock;

    const tabs = `
      <div class="es-kindnav" data-animate>
        <a class="es-kind ${kind === 'mock' ? 'active' : ''}" href="#/library/essay">
          <span class="es-kind-label">Mock papers</span>
          <span class="es-kind-n">${nMock}</span>
        </a>
        <a class="es-kind is-pgim ${kind === 'pgim' ? 'active' : ''}" href="#/library/essay/pgim">
          <span class="es-kind-label">PGIM past papers</span>
          <span class="es-kind-n">${nPgim}</span>
        </a>
      </div>`;

    const intro = kind === 'pgim'
      ? `<div class="es-intro card is-pgim" data-animate>
          <span class="es-real-tag">★ REAL EXAMINATION PAPER</span>
          <p class="muted">These are the papers the PGIM actually set — not practice written for the site. Everything about
            them is marked in this colour wherever it appears, so a past-paper question is never mistaken for a mock. Write
            them exactly as you would sit them.</p>
        </div>`
      : `<div class="es-intro card" data-animate>
          <p class="muted">Structured-essay practice for PGIM MD Part II. Write a paper against the clock, photograph your
            answers, and upload the marking report to see a full examiner breakdown — richer than a printed report, with an
            AI tutor and weakness analysis built in.</p>
        </div>`;

    if (!list.length) {
      body.innerHTML = tabs + `
        <div class="card" data-animate>
          <h3 class="card-title">No essay papers yet</h3>
          <p class="muted">The site owner publishes structured-essay mock papers and real PGIM past papers here. Once a paper
            is live you'll write it against a timer, photograph your answers, and upload the AI marking report for a
            detailed breakdown.</p>
        </div>`;
      renderFeedbackInbox(view, user, fb);
      return;
    }

    body.innerHTML = tabs + intro + `
      <div class="es-search-wrap" data-animate>
        <div class="es-search-row">
          <span class="es-search-ico">🔎</span>
          <input type="search" id="es-search" class="es-search" autocomplete="off" spellcheck="false"
            placeholder="Search every essay question — e.g. hypertension, shoulder dystocia, PPH">
          <button class="es-search-x" id="es-search-x" hidden aria-label="Clear search">✕</button>
        </div>
        <p class="muted tiny es-search-hint">Searches the stem and every sub-part across <strong>all ${list.length} paper${list.length > 1 ? 's' : ''}</strong> —
          both lists at once. Real PGIM questions come back marked <span class="es-real-dot">★ PGIM</span>. Several words = all of them must appear.</p>
      </div>
      <div id="es-results" hidden></div>
      <div class="es-papers" id="es-paper-list" data-animate>
        ${mine.length ? mine.map(p => {
          const qs = questionsOf(p);
          const pg = isPgim(p);
          const done = qs.filter(q => fbByCode[q.code]).length;
          const avg = done ? Math.round(qs.filter(q => fbByCode[q.code]).reduce((s, q) => s + (fbByCode[q.code].score?.percent || 0), 0) / done) : null;
          return `
          <a class="es-paper-card ${pg ? 'is-pgim' : ''}" href="#/library/essay/${encodeURIComponent(p.id)}">
            <div class="es-paper-num">${pg ? (p.year || '★') : (p.paperNumber || '•')}</div>
            <div class="es-paper-main">
              <h3>${esc(paperTitle(p))}${pg ? '<span class="es-real-tag sm">★ REAL PAPER</span>' : ''}</h3>
              <p class="muted tiny">${esc(p.examTitle || 'MD (O&G) Examination')} · ${qs.length} questions · ${p.durationHours || 3} h${
                pg && p.date ? ' · sat ' + esc(p.date) : ''}</p>
              <div class="es-paper-prog"><span style="width:${qs.length ? (done / qs.length) * 100 : 0}%"></span></div>
            </div>
            <div class="es-paper-side">
              <span class="es-paper-done">${done}/${qs.length}</span>
              <span class="muted tiny">${avg != null ? 'avg ' + avg + '%' : 'marked'}</span>
            </div>
          </a>`;
        }).join('') : `<div class="card"><p class="muted">${kind === 'pgim'
          ? 'No PGIM past papers published yet. The site owner imports them in Developer → Essay importer; any paper marked <code>"paperType": "official_past_paper"</code> lands here.'
          : 'No mock papers published yet.'}</p></div>`}
      </div>`;
    wireEssaySearch(body, list, fbByCode);
    renderFeedbackInbox(view, user, fb);
  }

  /* ---------- search every question in every paper ----------
     People remember essays by their topic, never by "Paper 4, question 2",
     so the index is built over the stem AND every sub-part, and a hit links
     straight to writing that question. Multi-word queries are AND-ed, which
     is what "hypertension pregnancy" is meant to do. */
  function searchIndex(list) {
    const rows = [];
    list.forEach(p => questionsOf(p).forEach((q, i) => {
      const parts = partsOf(q).map(pt => `${pt.label || ''} ${pt.text || ''}`).join(' ');
      rows.push({
        p, q, i,
        hay: `${q.code || ''} ${q.sectionTitle || ''} ${q.stem || ''} ${parts}`.toLowerCase()
      });
    }));
    return rows;
  }

  function wireEssaySearch(body, list, fbByCode) {
    const input = body.querySelector('#es-search');
    const clear = body.querySelector('#es-search-x');
    const results = body.querySelector('#es-results');
    const papersEl = body.querySelector('#es-paper-list');
    if (!input) return;
    const index = searchIndex(list);

    function draw(raw) {
      const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = index.filter(r => terms.every(t => r.hay.includes(t)));
      if (!hits.length) {
        results.innerHTML = `<div class="card"><p class="muted">No essay question mentions “${esc(raw)}”. Try a single word — <em>hypertension</em> rather than <em>hypertensive disorders</em>.</p></div>`;
        return;
      }
      results.innerHTML = `
        <p class="muted lib-results-count">${hits.length} question${hits.length > 1 ? 's' : ''} matching “${esc(raw)}”</p>
        <div class="es-hits">${hits.map(r => {
          const marked = fbByCode[r.q.code];
          const pg = isPgim(r.p);
          return `
          <div class="es-hit ${pg ? 'is-pgim' : ''}">
            <div class="es-hit-top">
              ${pg ? '<span class="es-real-dot">★ PGIM</span>' : '<span class="es-mock-dot">MOCK</span>'}
              <span class="chip chip-${r.q.type === 'SAQ' ? 'sba' : 'emq'}">${esc(r.q.type || 'SEQ')}</span>
              <span class="es-hit-code">${esc(r.q.code || '')}</span>
              <span class="es-hit-paper">${esc(paperTitle(r.p))}</span>
              ${marked ? `<span class="es-fb-band es-band-${bandClass(marked.score?.band)}">${esc(marked.score?.band || '')} · ${marked.score?.percent}%</span>` : ''}
            </div>
            <p class="es-hit-stem">${mark(r.q.stem, terms)}</p>
            ${partsOf(r.q).length ? `<ul class="es-hit-parts">${partsOf(r.q).map(pt =>
              `<li class="${pt.sub ? 'is-sub' : ''}"><strong>${esc(pt.label || '')}</strong> ${mark(pt.text, terms)}</li>`).join('')}</ul>` : ''}
            <div class="es-hit-acts">
              <a class="btn btn-gold btn-sm" href="#/library/essay/${encodeURIComponent(r.p.id)}/write/${r.i}">✍ Write this</a>
              <a class="btn btn-ghost btn-sm" href="#/library/essay/${encodeURIComponent(r.p.id)}">Open the paper</a>
              ${marked ? `<a class="btn btn-ghost btn-sm" href="#/library/essay/feedback/${encodeURIComponent(r.q.code)}">📊 Feedback</a>` : ''}
            </div>
          </div>`;
        }).join('')}</div>`;
    }

    function run() {
      const raw = input.value.trim();
      clear.hidden = !raw;
      if (!raw) { results.hidden = true; results.innerHTML = ''; papersEl.hidden = false; return; }
      results.hidden = false; papersEl.hidden = true;
      draw(raw);
    }
    input.addEventListener('input', run);
    clear.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
  }

  /** Escape, then highlight each search term inside the escaped text. */
  function mark(text, terms) {
    let h = esc(String(text || '')).replace(/\n/g, '<br>');
    terms.forEach(t => {
      const safe = esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (safe) h = h.replace(new RegExp('(' + safe + ')', 'gi'), '<mark>$1</mark>');
    });
    return h;
  }

  // a shared "feedback inbox" card under the paper list: upload + recent reports
  function renderFeedbackInbox(view, user, fb) {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="card es-inbox" data-animate>
        <div class="es-inbox-head">
          <h3 class="card-title">📥 Marking reports</h3>
          <div class="es-inbox-actions">
            <label class="btn btn-gold btn-sm" style="cursor:pointer">⬆ Upload report (JSON)
              <input type="file" id="es-upload" accept="application/json,.json" hidden multiple></label>
            ${user?.isDeveloper ? `<button class="btn btn-ghost btn-sm" id="es-scan">↻ Auto-import from Drive</button>` : ''}
            ${fb.length ? `<a class="btn btn-ghost btn-sm" href="#/library/essay/writing">✍ Writing lab</a>` : ''}
            <a class="btn btn-ghost btn-sm" href="#/library/essay/how">ℹ How marking works</a>
          </div>
        </div>
        <p class="es-inbox-note muted tiny">Write on paper → photograph → mark it in the OG Revise Essay Marker (Claude project) →
          it returns a JSON report → upload it here${user?.isDeveloper ? ' (or auto-import your own from the Drive folder)' : ''}.</p>
        <div id="es-fb-list"></div>
        <p class="dev-row-msg" id="es-fb-msg"></p>
      </div>`;
    (view.querySelector('#es-body') || view.querySelector('.page')).appendChild(host.firstElementChild);
    paintFeedbackList(view, fb);

    view.querySelector('#es-upload').addEventListener('change', e => uploadReports(view, [...e.target.files]));
    view.querySelector('#es-scan')?.addEventListener('click', e => scanDriveFeedback(view, e.target));
  }

  function paintFeedbackList(view, fb) {
    const host = view.querySelector('#es-fb-list');
    if (!host) return;
    if (!fb.length) { host.innerHTML = `<p class="muted">No reports yet — upload your first marked paper above.</p>`; return; }
    host.innerHTML = `<div class="es-fb-grid">${fb.map(f => `
      <a class="es-fb-card" href="#/library/essay/feedback/${encodeURIComponent(f.code)}">
        <span class="es-fb-band es-band-${bandClass(f.score?.band)}">${esc(f.score?.band || '—')}</span>
        <span class="es-fb-code">${esc(f.code)}</span>
        <span class="es-fb-topic">${esc(f.topic || '')}</span>
        <span class="es-fb-pct ${(f.score?.percent || 0) >= 65 ? 'good' : (f.score?.percent || 0) < 50 ? 'bad' : ''}">${f.score?.percent != null ? f.score.percent + '%' : ''}</span>
      </a>`).join('')}</div>`;
  }
  const bandClass = b => /distinction/i.test(b) ? 'dist' : /clear pass/i.test(b) ? 'pass' : /borderline/i.test(b) ? 'border' : /fail/i.test(b) ? 'fail' : 'none';

  async function uploadReports(view, files) {
    const msg = view.querySelector('#es-fb-msg');
    let ok = 0, bad = 0, lastErr = '';
    for (const file of files) {
      try {
        const data = JSON.parse(await file.text());
        const errs = validateFeedback(data);
        if (errs.length) { bad++; lastErr = errs[0]; continue; }
        await Backend.saveEssayFeedback(normaliseFeedback(data));
        ok++;
      } catch (e) { bad++; lastErr = e.message || String(e); }
    }
    msg.innerHTML = `${ok ? `<span class="good">✓ ${ok} report${ok > 1 ? 's' : ''} imported.</span> ` : ''}${bad ? `<span class="bad">${bad} failed${lastErr ? ' — ' + esc(lastErr) : ''}.</span>` : ''}`;
    msg.className = 'dev-row-msg';
    try { paintFeedbackList(view, (await Backend.listEssayFeedback()) || []); } catch {}
  }

  async function scanDriveFeedback(view, btn) {
    const msg = view.querySelector('#es-fb-msg');
    btn.disabled = true; msg.textContent = 'Scanning Drive for reports…'; msg.className = 'dev-row-msg muted';
    try {
      const base = cfg().drive.apiBase, fid = cfg().drive.essayFolderId;
      const res = await fetch(`${base}?action=list&folderId=${encodeURIComponent(fid)}`, { cache: 'no-cache' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      let ok = 0;
      for (const f of (data.files || [])) {
        const content = f.paper || f.deck || null;      // function may inline; else fetch
        let doc = content;
        if (!doc && f.id) { try { const r = await fetch(`${base}?action=file&id=${encodeURIComponent(f.id)}`); doc = await r.json(); } catch { doc = null; } }
        if (doc && validateFeedback(doc).length === 0) { await Backend.saveEssayFeedback(normaliseFeedback(doc)); ok++; }
      }
      msg.innerHTML = `<span class="good">✓ ${ok} report${ok !== 1 ? 's' : ''} auto-imported from Drive.</span>`;
      paintFeedbackList(view, (await Backend.listEssayFeedback()) || []);
    } catch (e) { msg.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; }
    btn.disabled = false;
  }

  /* ---------- feedback validation / normalisation ---------- */

  function validateFeedback(d) {
    const e = [];
    if (!d || typeof d !== 'object') return ['Not a JSON object.'];
    if (d.schema && !/essay-feedback/.test(d.schema)) e.push('Not an essay-feedback report.');
    if (!d.code) e.push('Missing "code" (e.g. M03-Q5).');
    if (!d.score || d.score.percent == null) e.push('Missing "score.percent".');
    return e;
  }
  function normaliseFeedback(d) {
    return Object.assign({}, d, {
      code: String(d.code).trim(),
      paper: d.paper || String(d.code).split('-')[0],
      topic: d.topic || ''
    });
  }

  /* ================= one paper (#/library/essay/:id) ================= */

  async function renderPaper(view, paperId, user) {
    const list = await papers().catch(() => []);
    const p = list.find(x => x.id === paperId);
    if (!p) { view.innerHTML = `<section class="page narrow"><p class="muted">That paper is no longer available. <a class="link" href="#/library/essay">Back</a></p></section>`; return; }
    const qs = questionsOf(p);
    let fb = {}; try { ((await Backend.listEssayFeedback()) || []).forEach(f => fb[f.code] = f); } catch {}

    const pg = isPgim(p);
    view.innerHTML = `
      <section class="page ${pg ? 'es-pgim-page' : ''}">
        <a class="link muted dev-back" href="#/library/essay${pg ? '/pgim' : ''}">← ${pg ? 'PGIM past papers' : 'Essay papers'}</a>
        <header data-animate>
          ${pg ? '<span class="es-real-tag">★ REAL EXAMINATION PAPER — PGIM</span>' : ''}
          <p class="kicker">${esc(p.examTitle || 'MD (O&G)')} · ${qs.length} questions · ${p.durationHours || 3} hours${
            pg && p.date ? ' · sat ' + esc(p.date) : ''}${p.time ? ' · ' + esc(p.time) : ''}</p>
          <h1 class="page-title">${esc(paperTitle(p))}</h1>
          <p class="muted">${(p.instructions || []).map(esc).join(' · ')}</p>
        </header>
        <div class="es-qlist" data-animate>
          ${qs.map((q, i) => {
            const marked = fb[q.code];
            return `
            <div class="es-q-card ${pg ? 'is-pgim' : ''}">
              <div class="es-q-top">
                ${pg ? '<span class="es-real-dot">★ PGIM</span>' : ''}
                <span class="chip chip-${q.type === 'SAQ' ? 'sba' : 'emq'}">${esc(q.type || 'SEQ')}</span>
                <span class="es-q-code">${esc(q.code)}</span>
                <span class="es-q-marks">${qMarks(q)} marks</span>
                ${marked ? `<span class="es-fb-band es-band-${bandClass(marked.score?.band)}">${esc(marked.score?.band || '')} · ${marked.score?.percent}%</span>` : ''}
              </div>
              <p class="es-q-stem">${esc(q.stem).replace(/\n/g, '<br>')}</p>
              ${partsOf(q).length ? `<ul class="es-q-parts">${partsOf(q).map(pt => `<li class="${pt.sub ? 'is-sub' : ''}"><strong>${esc(pt.label)}</strong> ${esc(pt.text)}${
                pt.marks != null ? ` <span class="muted tiny">(${pt.marks})</span>` : ''}</li>`).join('')}</ul>` : ''}
              <div class="es-q-actions">
                <a class="btn btn-gold btn-sm" href="#/library/essay/${encodeURIComponent(p.id)}/write/${i}">✍ Write (${q.type === 'SAQ' ? 30 : 30} min)</a>
                ${marked ? `<a class="btn btn-ghost btn-sm" href="#/library/essay/feedback/${encodeURIComponent(q.code)}">📊 View feedback</a>` : `<span class="muted tiny">write it, then upload your marking report</span>`}
              </div>
            </div>`;
          }).join('')}
        </div>
      </section>`;
    FX.viewIn(view);
  }

  /* ================= writing mode with timer (#/library/essay/:id/write/:qi) ================= */

  async function renderWrite(view, paperId, qi, user) {
    const list = await papers().catch(() => []);
    const p = list.find(x => x.id === paperId);
    if (!p) { location.hash = '#/library/essay'; return; }
    const qs = questionsOf(p);
    const idx = Math.max(0, Math.min(qs.length - 1, Number(qi) || 0));
    const q = qs[idx];
    const PER_Q = 30 * 60;                                // 30 minutes a question
    const stKey = `essay-timer:${p.id}:${q.code}`;
    let remaining = PER_Q, running = false, tid = null;
    try { const saved = JSON.parse(localStorage.getItem(stKey) || 'null'); if (saved && saved.remaining != null) remaining = saved.remaining; } catch {}

    function fmt(s) { s = Math.max(0, s); const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
    function persist() { try { localStorage.setItem(stKey, JSON.stringify({ remaining })); } catch {} }

    view.innerHTML = `
      <section class="page es-write">
        <a class="link muted dev-back" href="#/library/essay/${encodeURIComponent(p.id)}">← ${esc(paperTitle(p))}</a>
        <div class="es-write-top" data-animate>
          <div>
            <p class="kicker">${isPgim(p) ? '<span class="es-real-dot">★ PGIM</span> ' : ''}${esc(paperTitle(p))} · Question ${idx + 1} of ${qs.length}</p>
            <h1 class="page-title">${esc(q.code)} <span class="muted">· ${qMarks(q)} marks</span></h1>
          </div>
          <div class="es-timer-wrap">
            <div class="es-timer ${remaining <= 60 ? 'low' : ''}" id="es-timer">${fmt(remaining)}</div>
            <div class="es-timer-btns">
              <button class="btn btn-gold btn-sm" id="es-toggle">▶ Start</button>
              <button class="btn btn-ghost btn-sm" id="es-reset">↺ Reset</button>
            </div>
          </div>
        </div>

        <div class="card es-write-q" data-animate>
          <span class="chip chip-${q.type === 'SAQ' ? 'sba' : 'emq'}">${esc(q.type || 'SEQ')}</span>
          ${q.sectionTitle ? `<span class="muted tiny"> · ${esc(q.sectionTitle)}</span>` : ''}
          <p class="es-q-stem big">${esc(q.stem).replace(/\n/g, '<br>')}</p>
          ${partsOf(q).length ? `<ul class="es-q-parts">${partsOf(q).map(pt => `<li class="${pt.sub ? 'is-sub' : ''}"><strong>${esc(pt.label)}</strong> ${esc(pt.text)}${
            pt.marks != null ? ` <span class="muted tiny">(${pt.marks} marks)</span>` : ''}</li>`).join('')}</ul>` : ''}
          <p class="es-write-hint muted tiny">✍ Write your answer on paper. This timer paces you at 30 minutes — pause it whenever
            real life interrupts; your remaining time is saved. When done, photograph your answer and upload the marking report
            from the Essay home.</p>
        </div>

        <div class="es-write-nav" data-animate>
          <a class="btn btn-ghost" href="#/library/essay/${encodeURIComponent(p.id)}/write/${idx - 1}" ${idx === 0 ? 'style="visibility:hidden"' : ''}>← Previous</a>
          <span class="muted tiny">Whole paper: ${qs.length} × 30 min ≈ ${(qs.length * 0.5).toFixed(1)} h</span>
          ${idx < qs.length - 1
            ? `<a class="btn btn-primary" href="#/library/essay/${encodeURIComponent(p.id)}/write/${idx + 1}">Next question →</a>`
            : `<a class="btn btn-gold" href="#/library/essay/${encodeURIComponent(p.id)}">Finish paper</a>`}
        </div>
      </section>`;
    FX.viewIn(view);

    const timerEl = view.querySelector('#es-timer');
    const toggle = view.querySelector('#es-toggle');
    function tick() { remaining -= 1; timerEl.textContent = fmt(remaining); timerEl.classList.toggle('low', remaining <= 60); persist(); if (remaining <= 0) stop(); }
    function start() { running = true; toggle.innerHTML = '⏸ Pause'; tid = setInterval(tick, 1000); }
    function stop() { running = false; toggle.innerHTML = remaining <= 0 ? '⏱ Time up' : '▶ Resume'; if (tid) clearInterval(tid); tid = null; }
    toggle.addEventListener('click', () => running ? stop() : start());
    view.querySelector('#es-reset').addEventListener('click', () => { stop(); remaining = PER_Q; timerEl.textContent = fmt(remaining); timerEl.classList.remove('low'); toggle.innerHTML = '▶ Start'; persist(); });
    const cleanup = () => { if (tid) clearInterval(tid); window.removeEventListener('hashchange', cleanup); };
    window.addEventListener('hashchange', cleanup);
  }

  /* ================= feedback report (#/library/essay/feedback/:code) ================= */

  async function renderFeedback(view, code, user) {
    let f = null;
    try { f = await Backend.getEssayFeedback(code); } catch {}
    if (!f) { view.innerHTML = `<section class="page narrow"><p class="muted">No report found for ${esc(code)}. <a class="link" href="#/library/essay">Back</a></p></section>`; return; }
    const sc = f.score || {};
    const band = bandClass(sc.band);

    view.innerHTML = `
      <section class="page es-report">
        <a class="link muted dev-back" href="#/library/essay">← Essay papers</a>
        <header class="es-report-head es-band-head-${band}" data-animate>
          <div class="es-report-id">
            <p class="kicker">${esc(f.subject || 'O&G')} · ${esc(f.questionType || 'SEQ')} · scheme v${esc(f.schemeVersion || '1.0')}${
              f.schemeSource ? ' (' + esc(f.schemeSource) + ')' : ''}${f.markedOn ? ' · marked ' + esc(f.markedOn) : ''}</p>
            <h1 class="page-title">${esc(f.code)} — ${esc(f.topic || '')}</h1>
            ${(f.topicTags || []).length
              ? `<div class="es-tags">${f.topicTags.map(t => `<span class="es-tag">${esc(t)}</span>`).join('')}</div>` : ''}
          </div>
          <div class="es-scoredial">
            <div class="es-dial" id="es-dial" data-pct="${sc.percent || 0}"><span>${sc.percent != null ? sc.percent + '%' : '—'}</span></div>
            <span class="es-fb-band es-band-${band} big">${esc(sc.band || '')}</span>
            <span class="muted tiny">${sc.raw != null ? `${sc.raw}/${sc.rawMax || 100} raw · ${sc.scaled != null ? sc.scaled + '/' + (sc.scaledMax || 20) : ''}` : ''}</span>
          </div>
        </header>

        ${(sc.deductions || []).length ? `
        <div class="card es-deduct" data-animate>
          <h3 class="card-title">➖ Deductions applied</h3>
          <ul class="es-flag-list">${sc.deductions.map(d => `<li>${typeof d === 'string' ? esc(d)
            : `${esc(d.reason || d.cause || '')}${d.marks != null ? ` <strong>−${d.marks}</strong>` : ''}`}</li>`).join('')}</ul>
        </div>` : ''}

        ${f.questionStem ? `<div class="card es-r-q" data-animate><p class="es-q-stem">${esc(f.questionStem).replace(/\n/g, '<br>')}</p>
          ${(f.subQuestions || []).length ? `<ul class="es-q-parts">${f.subQuestions.map(sqp => `<li><strong>${esc(sqp.label)}</strong> ${esc(sqp.text)} <span class="muted tiny">(${sqp.maxMarks || sqp.marks || ''})</span></li>`).join('')}</ul>` : ''}</div>` : ''}

        ${(f.breakdown || []).length ? `
        <div class="card" data-animate>
          <h3 class="card-title">Sub-question breakdown</h3>
          <div class="es-break">${f.breakdown.map(b => {
            const pct = b.percent != null ? b.percent : (b.max ? Math.round((b.raw / b.max) * 100) : 0);
            return `<div class="es-break-row">
              <span class="es-break-lbl">${esc(b.section)}</span>
              <div class="es-break-bar"><span class="${pct < 50 ? 'bad' : pct < 65 ? '' : 'good'}" style="width:${pct}%"></span></div>
              <span class="es-break-mk">${b.raw}/${b.max}</span></div>`;
          }).join('')}</div>
        </div>` : ''}

        ${f.examinerComment ? `<div class="card es-examiner" data-animate>
          <h3 class="card-title">👨‍⚖️ Examiner comment</h3><p>${esc(f.examinerComment).replace(/\n/g, '<br>')}</p></div>` : ''}

        ${(f.markScheme || []).length ? `
        <div class="card" data-animate>
          <h3 class="card-title">Mark-scheme assessment</h3>
          <p class="muted tiny">Every scheme point, marked against your answer. <span class="es-dot cov"></span> covered ·
            <span class="es-dot par"></span> partial · <span class="es-dot mis"></span> missed ·
            <span class="es-safety-key">⚠</span> safety-critical.</p>
          ${f.markScheme.map(sec => `
            <details class="es-scheme-sec" open>
              <summary><strong>${esc(sec.section)}</strong>
                <span class="muted">${sec.raw != null ? sec.raw + '/' + sec.max : ''}</span></summary>
              ${schemeBody(sec)}
            </details>`).join('')}
        </div>` : ''}

        ${generatedSchemeCard(f)}

        ${f.lossAnalysis ? `
        <div class="card es-loss" data-animate>
          <h3 class="card-title">📉 Where the marks went</h3>
          ${f.lossAnalysis.totalLost != null
            ? `<p class="es-loss-total"><strong>${f.lossAnalysis.totalLost}</strong> marks lost in total.</p>` : ''}
          ${(f.lossAnalysis.byCause || []).length ? `
            <div class="es-cause-list">${f.lossAnalysis.byCause
              .slice().sort((a, b) => (b.marks || 0) - (a.marks || 0)).map(c => {
                const share = f.lossAnalysis.totalLost ? Math.round(((c.marks || 0) / f.lossAnalysis.totalLost) * 100) : 0;
                return `<div class="es-cause">
                  <div class="es-cause-head">
                    <span class="es-cause-name">${esc(c.cause)}</span>
                    <span class="es-cause-mk">−${c.marks}</span>
                  </div>
                  <div class="es-cause-bar"><i style="width:${share}%"></i></div>
                  ${c.detail ? `<p class="es-cause-detail">${esc(c.detail)}</p>` : ''}
                </div>`;
              }).join('')}</div>` : ''}
          ${f.lossAnalysis.biggestSingleLoss
            ? `<p class="es-loss-big"><strong>Biggest single loss.</strong> ${esc(f.lossAnalysis.biggestSingleLoss)}</p>` : ''}
        </div>` : ''}

        ${(f.priorityActions || []).length ? `
        <div class="card es-prio" data-animate>
          <h3 class="card-title">🚀 Do these first</h3>
          <p class="muted tiny">Ranked by the marks each would have won back.</p>
          <ol class="es-prio-list">${f.priorityActions
            .slice().sort((a, b) => (a.rank || 99) - (b.rank || 99)).map(a => `
            <li class="es-prio-item">
              <span class="es-prio-rank">${a.rank != null ? a.rank : '•'}</span>
              <div class="es-prio-body">
                <p>${esc(a.action)}</p>
                <span class="es-prio-meta">
                  ${a.estimatedMarkGain != null ? `<span class="es-prio-gain">+${a.estimatedMarkGain} marks</span>` : ''}
                  ${a.type ? `<span class="es-prio-type">${esc(a.type)}</span>` : ''}
                </span>
              </div>
            </li>`).join('')}</ol>
        </div>` : ''}

        ${(f.improvementAdvice || []).length ? `
        <div class="card" data-animate>
          <h3 class="card-title">🎯 How to gain the marks</h3>
          ${f.improvementAdvice.map(a => `<div class="es-adv"><h4>${esc(a.label)}</h4><ul>${(a.points || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}
        </div>` : ''}

        ${(f.writingImprovement || []).length ? `
        <div class="card" data-animate>
          <h3 class="card-title">✍ Writing &amp; English</h3>
          ${f.writingImprovement.map(w => `
            <div class="es-writing">
              <h4>${esc(w.label)}</h4>
              ${(w.quotes || []).map(qq => `<div class="es-rewrite">
                <p class="es-rw-orig">“${esc(qq.original)}”</p>
                <p class="es-rw-new">→ ${esc(qq.rewrite)}</p></div>`).join('')}
              ${(w.proTips || []).length ? `<ul class="es-protips">${w.proTips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
            </div>`).join('')}
        </div>` : ''}

        ${f.writingAnalysis ? (() => {
          const w = f.writingAnalysis, st = w.structure || {};
          const metrics = [
            ['Sub-parts labelled', st.subPartsLabelled == null ? null : (st.subPartsLabelled ? 'Yes' : 'No')],
            ['Answered in order', st.answeredInOrder == null ? null : (st.answeredInOrder ? 'Yes' : 'No')],
            ['Mean sentence length', st.meanSentenceWords != null ? st.meanSentenceWords + ' words' : null],
            ['Over-long sentences', st.longSentenceCount != null ? String(st.longSentenceCount) : null],
            ['Run-on sentences', st.runOnCount != null ? String(st.runOnCount) : null],
            ['Signposting', st.signpostingScore || null]
          ].filter(m => m[1] != null);
          return `
        <div class="card es-wa" data-animate>
          <h3 class="card-title">🖊 Writing analysis</h3>
          ${w.overallVerdict ? `<p class="es-wa-verdict">${esc(w.overallVerdict)}</p>` : ''}
          ${metrics.length ? `<div class="es-wa-metrics">${metrics.map(([k, v]) =>
            `<div class="es-wa-metric"><span class="es-wa-mv">${esc(v)}</span><span class="es-wa-mk">${esc(k)}</span></div>`).join('')}</div>` : ''}
          ${st.proseVsList ? `<p class="es-wa-note"><strong>Prose vs list.</strong> ${esc(st.proseVsList)}</p>` : ''}

          ${(w.buriedItems || []).length ? `
            <h4 class="es-wa-h">Points the examiner could not credit</h4>
            ${w.buriedItems.map(b => `<div class="es-buried">
              <p class="es-buried-item">${esc(b.item)}${b.where ? ` <span class="muted tiny">— ${esc(b.where)}</span>` : ''}</p>
              ${b.issue ? `<p class="es-buried-issue">${esc(b.issue)}</p>` : ''}
              ${b.fix ? `<p class="es-buried-fix">→ ${esc(b.fix)}</p>` : ''}
            </div>`).join('')}` : ''}

          ${(w.recurringErrors || []).length ? `
            <h4 class="es-wa-h">Patterns that repeated</h4>
            ${w.recurringErrors.map(r => `<div class="es-recur">
              <p class="es-recur-head">${esc(r.pattern)}${r.count != null ? ` <span class="es-recur-n">×${r.count}</span>` : ''}</p>
              ${(r.examples || []).length ? `<ul class="es-recur-eg">${r.examples.map(x => `<li>“${esc(x)}”</li>`).join('')}</ul>` : ''}
              ${r.fix ? `<p class="es-recur-fix">→ ${esc(r.fix)}</p>` : ''}
            </div>`).join('')}` : ''}

          ${w.paragraphRewrite ? `
            <h4 class="es-wa-h">Rewritten in full${w.paragraphRewrite.label ? ` — ${esc(w.paragraphRewrite.label)}` : ''}</h4>
            <div class="es-rewrite big">
              ${w.paragraphRewrite.original ? `<p class="es-rw-orig">“${esc(w.paragraphRewrite.original)}”</p>` : ''}
              ${w.paragraphRewrite.rewritten ? `<p class="es-rw-new">→ ${esc(w.paragraphRewrite.rewritten)}</p>` : ''}
            </div>
            ${(w.paragraphRewrite.whatChanged || []).length
              ? `<ul class="es-changed">${w.paragraphRewrite.whatChanged.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}` : ''}

          ${(w.phraseBank || []).length ? `
            <h4 class="es-wa-h">Phrase bank</h4>
            <div class="es-phrases">${w.phraseBank.map(p => `<span class="es-phrase">${esc(p)}</span>`).join('')}</div>` : ''}
        </div>`; })() : ''}

        ${f.timeManagement ? (() => { const t = f.timeManagement; return `
        <div class="card es-time" data-animate>
          <h3 class="card-title">⏱ Time &amp; volume</h3>
          <div class="es-wa-metrics">
            ${t.budgetMinutes != null ? `<div class="es-wa-metric"><span class="es-wa-mv">${t.budgetMinutes} min</span><span class="es-wa-mk">Budget</span></div>` : ''}
            ${t.estimatedWordCount != null ? `<div class="es-wa-metric"><span class="es-wa-mv">${t.estimatedWordCount}</span><span class="es-wa-mk">Words written</span></div>` : ''}
            ${t.fitsBudget != null ? `<div class="es-wa-metric"><span class="es-wa-mv ${t.fitsBudget ? 'good' : 'bad'}">${t.fitsBudget ? 'Yes' : 'No'}</span><span class="es-wa-mk">Fits the budget</span></div>` : ''}
            ${t.subPartConsumingBudget ? `<div class="es-wa-metric"><span class="es-wa-mv">${esc(t.subPartConsumingBudget)}</span><span class="es-wa-mk">Took the most time</span></div>` : ''}
          </div>
          ${t.comment ? `<p class="es-wa-note">${esc(t.comment)}</p>` : ''}
        </div>`; })() : ''}

        ${f.transcription ? `
        <div class="card es-trans" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">📄 What the marker read from your script</span><span class="dc-caret">▸</span></summary>
            <p class="muted tiny">${f.transcription.pageCount != null ? f.transcription.pageCount + ' page' + (f.transcription.pageCount === 1 ? '' : 's') : ''}${
              f.transcription.illegiblePercent != null ? ` · about ${f.transcription.illegiblePercent}% could not be read` : ''}.
              Check this against what you meant to write — anything mis-read here was marked as it appears.</p>
            ${(f.transcription.subPartMapping || []).length ? `
              <div class="es-sp-map">${f.transcription.subPartMapping.map(m => `<span class="es-sp">
                <b>${esc(m.label)}</b> ${(m.pages || []).length ? 'p' + m.pages.join(', ') : ''}</span>`).join('')}</div>` : ''}
            ${(f.transcription.pages || []).map(pg => `<div class="es-page">
              <span class="es-page-n">Page ${pg.page}</span>
              ${pg.subPart ? `<span class="es-page-sub">${esc(pg.subPart)}</span>` : ''}
              <p class="es-page-text">${esc(pg.text).replace(/\n/g, '<br>')}</p>
            </div>`).join('')}
          </details>
        </div>` : ''}

        ${(f.flags || []).length ? `
        <div class="card es-flags" data-animate>
          <h3 class="card-title">⚑ Marker's caveats</h3>
          <p class="muted tiny">The marker flagged these for checking — treat them as provisional.</p>
          <ul class="es-flag-list">${f.flags.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>` : ''}

        ${(f.keyLearningPoints || []).length ? `
        <div class="card es-klp" data-animate>
          <h3 class="card-title">🔑 Key learning points</h3>
          <ol class="es-klp-list">${f.keyLearningPoints.map((k, i) => `<li class="${i === 0 ? 'top' : ''}">${esc(k)}</li>`).join('')}</ol>
        </div>` : ''}

        ${(f.guidelines || []).length ? `
        <div class="card" data-animate>
          <h3 class="card-title">📚 Guidelines referenced</h3>
          <div class="table-scroll"><table class="table"><thead><tr><th>Guideline</th><th>Year</th><th>Relevance</th></tr></thead>
            <tbody>${f.guidelines.map(g => `<tr><td>${esc(g.guideline)}</td><td class="muted">${esc(g.year || '')}</td><td class="muted">${esc(g.relevance || '')}</td></tr>`).join('')}</tbody></table></div>
        </div>` : ''}

        ${f.modelAnswer ? `
        <div class="card es-model" data-animate>
          <details class="dev-collapse"><summary><span class="card-title">🏅 Model answer <span class="muted tiny">(writable by hand in 20–25 min)</span></span><span class="dc-caret">▸</span></summary>
            <div class="es-model-body">${renderMd(f.modelAnswer)}</div>
          </details>
        </div>` : ''}

        <div class="card es-ai" data-animate>
          <h3 class="card-title">✨ AI tutor &amp; analysis</h3>
          <p class="muted">Go deeper than the report: extract your weakness pattern, get corrections, or ask anything about this answer.</p>
          <div class="es-ai-tools">
            <button class="btn btn-ai" id="es-ai-analyse">🔬 Analyse my weaknesses</button>
          </div>
          <div id="es-ai-out"></div>
          <div class="ai-slot" id="es-ai-slot"></div>
        </div>

        ${(() => { const u = unknownFields(f); return u.length ? `
        <div class="card es-unknown" data-animate>
          <h3 class="card-title">⚠ Not shown above</h3>
          <p class="muted tiny">This report carries ${u.length} field${u.length === 1 ? '' : 's'} the page does not yet know
            how to draw — checked at every level of the file, not just the top. They are listed raw rather than dropped,
            so nothing in your marking is lost. Tell the developer and each will be given a proper section.</p>
          ${u.map(x => `<details class="es-raw"><summary><code>${esc(x.path)}</code></summary>
            <pre class="es-raw-body">${esc(JSON.stringify(x.value, null, 2))}</pre></details>`).join('')}
        </div>` : ''; })()}

        <div class="es-report-foot">
          <button class="btn btn-gold" id="es-print">🖨 Print / Save as PDF</button>
          <button class="btn btn-ghost btn-sm qr-danger" id="es-del">🗑 Delete this report</button>
        </div>
      </section>`;
    FX.viewIn(view);
    if (typeof FX !== 'undefined' && FX.scoreReveal) { const d = view.querySelector('#es-dial'); if (d) animateDial(d, sc.percent || 0); }

    // AI tutor grounded on this exact essay + its feedback
    const ctx = {
      questionKey: 'essay:' + f.code,
      kind: 'ESSAY', theme: f.topic || '', stem: (f.questionStem || '') + '\n\n' + (f.subQuestions || []).map(s => s.label + ' ' + s.text).join('\n'),
      options: [], answer: 0,
      // Ground the tutor on the blank scheme too, so "what should I have written
      // for section 3?" is answerable from the real scheme rather than invented.
      rationale: 'Examiner comment: ' + (f.examinerComment || '') +
        '\nKey points: ' + (f.keyLearningPoints || []).join('; ') +
        ((f.generatedScheme?.sections || []).length
          ? '\n\nThe full mark scheme for this question:\n' + f.generatedScheme.sections.map(s =>
              `${s.label} ${s.title} (${s.rawMarks} marks) — ideal answer: ${s.model || ''}\n` +
              (s.blocks || []).map(b => `  • ${b.block} (${b.marks}): ${(b.items || []).join('; ')}`).join('\n') +
              (s.calibration ? `\n  Calibration: ${s.calibration}` : '')).join('\n\n')
          : ''),
      paperTitle: f.code + ' — ' + (f.topic || ''), preLettered: true
    };
    if (typeof AI !== 'undefined' && cfg().ai?.enabled) AI.attach(view.querySelector('#es-ai-slot'), ctx);

    view.querySelector('#es-ai-analyse').addEventListener('click', e => runAnalysis(e.target, view.querySelector('#es-ai-out'), f));
    view.querySelector('#es-print').addEventListener('click', () => {
      if (typeof EssayPrint === 'undefined') return alert('The print module did not load. Reload the page and try again.');
      EssayPrint.open(f);
    });
    view.querySelector('#es-del').addEventListener('click', async () => {
      if (!confirm('Delete this marking report? You can re-upload it later.')) return;
      try { await Backend.deleteEssayFeedback(f.code); location.hash = '#/library/essay'; } catch (e) { alert('Could not delete: ' + (e.message || e)); }
    });
  }

  // AI weakness analysis — a focused chat call grounded on the report
  async function runAnalysis(btn, out, f) {
    btn.disabled = true;
    out.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>`;
    try {
      const token = await Backend.getAccessToken();
      if (!token) throw new Error('Sign in to use AI analysis.');
      const prov = await pickProvider();
      const missed = missedPoints(f).slice(0, 40);
      const cal = (f.generatedScheme?.sections || [])
        .filter(s => s.calibration).map(s => `${s.label} ${s.title}: ${s.calibration}`).join('\n');
      const q = `You are an O&G examiner-coach. A PGIM MD Part II candidate scored ${f.score?.percent}% (${f.score?.band}) on "${f.code} — ${f.topic}". ` +
        `The marks they lost, from the official scheme:\n${missed.join('\n')}\n\n` +
        (cal ? `The scheme's own calibration notes for this question:\n${cal}\n\n` : '') +
        `In under 220 words with **bold** headers: (1) the single recurring WEAKNESS pattern behind these losses; (2) the 3 highest-yield facts/figures to memorise to fix it; (3) one concrete drill for their next attempt. Be specific and practical.`;
      const messages = [{ role: 'user', content: q }];
      const res = await fetch(cfg().ai.apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ action: 'chat', provider: prov, model: modelFor(prov), dailyLimit: cfg().ai.dailyLimit,
          question: { kind: 'ESSAY', theme: f.topic, stem: f.questionStem || f.code, options: [], answer: 0, preLettered: true }, messages })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Analysis failed (HTTP ${res.status}).`);
      out.innerHTML = `<div class="ai-body">${renderMd(data.text)}</div>`;
    } catch (e) { out.innerHTML = `<p class="ai-error">${esc(e.message || e)}</p>`; }
    btn.disabled = false;
  }

  /* ---------- helpers ---------- */

  // Honour the model the user selected next to "Explore with AI", so every
  // AI surface on the site answers with the same chosen provider.
  async function pickProvider() {
    try { return (typeof AI !== 'undefined' && AI.preferredProvider) ? await AI.preferredProvider() : 'gemini'; }
    catch { return 'gemini'; }
  }
  const modelFor = p => p === 'claude' ? cfg().ai.claudeModel : p === 'gpt' ? cfg().ai.gptModel : cfg().ai.geminiModel;

  const stClass = s => /cover/i.test(s) ? 'cov' : /partial/i.test(s) ? 'par' : 'mis';
  const stIcon = s => /cover/i.test(s) ? '✓' : /partial/i.test(s) ? '~' : '✗';

  /* The mark scheme changed shape at ogr-essay-feedback-v3: a section now holds
     BLOCKS, each with its own mark, guideline, status and cap, and each block
     holds the individual items. The old shape was a flat `points` array. The
     renderer only knew the old one, so every v3 section drew an empty box —
     the section headers were there and nothing was inside them. Both shapes
     render here, so old reports keep working. */
  function schemeItem(it) {
    const text = it.item || it.point || '';
    return `
      <div class="es-point es-st-${stClass(it.status)}${it.safety ? ' is-safety' : ''}">
        <span class="es-point-icon">${stIcon(it.status)}</span>
        <div class="es-point-body">
          <p class="es-point-text">${it.safety ? '<span class="es-safety" title="Safety-critical point">⚠</span>' : ''}${esc(text)}</p>
          ${it.note ? `<p class="es-point-note">${esc(it.note)}</p>` : ''}
          ${it.guideline ? `<span class="es-point-guide">${esc(it.guideline)}</span>` : ''}
        </div>
      </div>`;
  }
  function schemeBody(sec) {
    if ((sec.blocks || []).length) {
      return `<div class="es-blocks">${sec.blocks.map(b => `
        <div class="es-block es-st-${stClass(b.status)}">
          <div class="es-block-head">
            <span class="es-block-name">${esc(b.block || '')}</span>
            <span class="es-block-mk">${b.awarded != null ? b.awarded + '/' + b.max : ''}</span>
          </div>
          <div class="es-block-tags">
            ${b.status ? `<span class="es-chip es-st-${stClass(b.status)}">${esc(b.status)}</span>` : ''}
            ${b.capped ? `<span class="es-chip es-capped">capped</span>` : ''}
            ${b.guideline ? `<span class="es-chip es-guide">${esc(b.guideline)}</span>` : ''}
          </div>
          ${b.capReason ? `<p class="es-cap-why"><strong>${b.capped ? 'Why it was capped.' : "Marker's note."}</strong> ${esc(b.capReason)}</p>` : ''}
          <div class="es-points">${(b.items || []).map(schemeItem).join('')}</div>
        </div>`).join('')}</div>`;
    }
    // pre-v3 flat shape
    return `<div class="es-points">${(sec.points || []).map(schemeItem).join('')}</div>`;
  }

  /* ---------- the blank scheme (generatedScheme) ---------- */

  /* `markScheme` says what YOU scored; `generatedScheme` is the whole scheme the
     question was built from — every available point, the ideal answer per
     section, and the examiner's calibration note. The two use identical block
     names, so the award carries across per block. Item text does NOT match
     (the marked copy abbreviates and sometimes merges bullets), so nothing is
     claimed at item level — the blank list stays blank. */
  const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const TAG_CLASS = { SAFETY: 'safety', VERIFY: 'verify', 'SLCOG-CHECK': 'local' };

  // Scheme bullets carry inline "[SAFETY]" / "[VERIFY …]" / "[SLCOG-CHECK]"
  // markers and an optional " | guideline" tail. Lift both out of the prose.
  function schemeLine(raw) {
    let text = String(raw == null ? '' : raw), guide = '';
    const bar = text.split(' | ');
    if (bar.length > 1) { text = bar[0]; guide = bar.slice(1).join(' | '); }
    const chips = [];
    text = text.replace(/\[(SAFETY|VERIFY|SLCOG-CHECK)([^\]]*)\]/gi, (_, key, rest) => {
      const k = key.toUpperCase();
      chips.push(`<span class="es-gs-tag is-${TAG_CLASS[k]}">${esc((k + rest).trim())}</span>`);
      return '';
    }).replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
    return `<li class="es-gs-item${chips.length && /SAFETY/i.test(chips.join('')) ? ' is-safety' : ''}">
      <span class="es-gs-txt">${esc(text)}</span>${chips.join('')}
      ${guide ? `<span class="es-chip es-guide">${esc(guide)}</span>` : ''}</li>`;
  }

  function generatedSchemeCard(f) {
    const gs = f.generatedScheme;
    if (!gs || !(gs.sections || []).length) return '';
    const secs = gs.sections;
    const msSecs = f.markScheme || [];
    // block name → the marked block, so each blank block can show your award
    const awardOf = {};
    msSecs.forEach(s => (s.blocks || []).forEach(b => { awardOf[b.block] = b; }));
    const secMark = (g, i) => msSecs.find(s => new RegExp('^\\s*' + reEsc(g.label) + '\\s*[-–—]').test(s.section || ''))
      || (msSecs.length === secs.length ? msSecs[i] : null);
    const totalRaw = secs.reduce((s, x) => s + (x.rawMarks || 0), 0);
    const totalScaled = secs.reduce((s, x) => s + (x.scaledMarks || 0), 0);

    return `
      <div class="card es-gs" data-animate>
        <h3 class="card-title">📘 The mark scheme in full</h3>
        <p class="muted tiny">Every point that was <em>available</em> on this question — not only the ones you were marked on.
          ${gs.builtOn ? 'Built ' + esc(gs.builtOn) + ' · ' : ''}${gs.schemeVersion ? 'scheme v' + esc(gs.schemeVersion) + ' · ' : ''}${
          secs.length} sections · ${totalRaw} raw marks${totalScaled ? ' → ' + (Math.round(totalScaled * 10) / 10) + ' scaled' : ''}.</p>
        <div class="es-gs-secs">
          ${secs.map((g, i) => {
            const ms = secMark(g, i);
            const pct = ms && ms.max ? Math.round((ms.raw / ms.max) * 100) : null;
            return `
            <details class="es-gs-sec" ${i === 0 ? 'open' : ''}>
              <summary>
                <span class="es-gs-lbl">${esc(g.label || (i + 1))}</span>
                <span class="es-gs-title">${esc(g.title || '')}</span>
                <span class="es-gs-marks">${g.rawMarks != null ? g.rawMarks + ' raw' : ''}${
                  g.scaledMarks != null ? ' · ' + g.scaledMarks + ' scaled' : ''}</span>
                ${ms && ms.raw != null
                  ? `<span class="es-gs-got ${pct < 50 ? 'bad' : pct < 65 ? '' : 'good'}">you scored ${ms.raw}/${ms.max}</span>` : ''}
                <span class="dc-caret">▸</span>
              </summary>
              <div class="es-gs-body">
                ${g.model ? `<div class="es-gs-model">
                  <span class="es-gs-h">What a full-mark answer says</span>
                  <p>${esc(g.model)}</p></div>` : ''}
                <div class="es-gs-blocks">${(g.blocks || []).map(b => {
                  const a = awardOf[b.block];
                  return `
                  <div class="es-gs-block${a && a.status ? ' es-st-' + stClass(a.status) : ''}">
                    <div class="es-gs-bhead">
                      <span class="es-gs-bname">${esc(b.block || '')}</span>
                      <span class="es-gs-bmk">${b.marks != null ? b.marks + ' mark' + (b.marks === 1 ? '' : 's') : ''}</span>
                      ${a && a.awarded != null
                        ? `<span class="es-gs-award es-st-${stClass(a.status)}">${a.awarded}/${a.max != null ? a.max : b.marks}</span>` : ''}
                    </div>
                    ${b.guideline ? `<span class="es-chip es-guide">${esc(b.guideline)}</span>` : ''}
                    <ul class="es-gs-items">${(b.items || []).map(schemeLine).join('')}</ul>
                  </div>`;
                }).join('')}</div>
                ${g.calibration ? `<div class="es-gs-cal">
                  <span class="es-gs-h">Examiner's calibration</span>
                  <p>${esc(g.calibration)}</p></div>` : ''}
              </div>
            </details>`;
          }).join('')}
        </div>

        ${(gs.guidelinesUsed || []).length ? `
          <h4 class="es-gs-sub">Built from these guidelines</h4>
          <div class="table-scroll"><table class="table"><thead><tr><th>Guideline</th><th>Edition / year</th><th>Note</th></tr></thead>
            <tbody>${gs.guidelinesUsed.map(g => `<tr><td>${esc(g.guideline || '')}</td><td class="muted">${
              esc(g.year || '')}</td><td class="muted">${esc(g.note || '—')}</td></tr>`).join('')}</tbody></table></div>` : ''}

        ${(gs.flags || []).length ? `
          <h4 class="es-gs-sub">Points in the scheme still to be verified</h4>
          <p class="muted tiny">The scheme itself flagged these — they are marked, but confirm the figure or the local
            pathway before you learn them as fact.</p>
          <ul class="es-flag-list">${gs.flags.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>`;
  }

  /* Every scheme point you did not fully earn, in both scheme shapes, for the
     AI weakness analysis. The old code read only the pre-v3 `points` array, so
     for every v3 report the analysis was handed an empty list. */
  function missedPoints(f) {
    const out = [];
    const take = (it, blk) => {
      if (!/missed|partial/i.test(it.status || '')) return;
      out.push(`[${it.status}] ${blk ? blk + ' — ' : ''}${it.item || it.point || ''}${it.note ? ' — ' + it.note : ''}`);
    };
    (f.markScheme || []).forEach(sec => {
      (sec.points || []).forEach(p => take(p, ''));
      (sec.blocks || []).forEach(b => {
        if (b.capped && b.capReason) out.push(`[capped] ${b.block} — ${b.capReason}`);
        (b.items || []).forEach(it => take(it, b.block));
      });
    });
    return out;
  }

  /* Every key the report knows how to draw, AT EVERY DEPTH. Anything in the
     JSON that is not here is shown raw rather than silently dropped.
     This used to be a flat list of top-level keys, which was the wrong shape
     to catch the drift it exists to catch: when the mark scheme moved from
     `section.points` to `section.blocks[].items` the top-level key was still
     `markScheme`, so the guard stayed quiet while every scheme box on the page
     rendered empty. Nesting the spec means a new key three levels down
     announces itself. `true` = a leaf, don't descend; `[spec]` = array of. */
  const L = true;
  const FIELD_SPEC = {
    schema: L, code: L, paper: L, topic: L, subject: L, questionType: L, topicTags: L,
    schemeVersion: L, schemeSource: L, markedOn: L, questionStem: L,
    subQuestions: [{ label: L, text: L, maxMarks: L, marks: L }],
    generatedScheme: {
      builtOn: L, schemeVersion: L, flags: L,
      sections: [{ label: L, title: L, rawMarks: L, scaledMarks: L, model: L, calibration: L,
        blocks: [{ block: L, marks: L, guideline: L, items: L }] }],
      guidelinesUsed: [{ guideline: L, year: L, note: L }]
    },
    score: { raw: L, rawMax: L, scaled: L, scaledMax: L, percent: L, band: L,
      deductions: [{ reason: L, cause: L, marks: L }] },
    breakdown: [{ section: L, raw: L, max: L, percent: L }],
    lossAnalysis: { totalLost: L, biggestSingleLoss: L, byCause: [{ cause: L, marks: L, detail: L }] },
    examinerComment: L,
    transcription: { pageCount: L, illegiblePercent: L,
      subPartMapping: [{ label: L, pages: L }],
      pages: [{ page: L, subPart: L, text: L }] },
    markScheme: [{ section: L, raw: L, max: L,
      points: [{ point: L, item: L, status: L, note: L, safety: L, guideline: L }],
      blocks: [{ block: L, max: L, awarded: L, guideline: L, status: L, capped: L, capReason: L,
        items: [{ item: L, point: L, status: L, note: L, safety: L, guideline: L }] }] }],
    improvementAdvice: [{ label: L, points: L }],
    writingAnalysis: {
      overallVerdict: L, phraseBank: L,
      structure: { subPartsLabelled: L, answeredInOrder: L, meanSentenceWords: L,
        longSentenceCount: L, runOnCount: L, signpostingScore: L, proseVsList: L },
      buriedItems: [{ item: L, where: L, issue: L, fix: L }],
      recurringErrors: [{ pattern: L, count: L, examples: L, fix: L }],
      paragraphRewrite: { label: L, original: L, rewritten: L, whatChanged: L }
    },
    writingImprovement: [{ label: L, proTips: L, quotes: [{ original: L, rewrite: L }] }],
    timeManagement: { budgetMinutes: L, estimatedWordCount: L, fitsBudget: L,
      subPartConsumingBudget: L, comment: L },
    priorityActions: [{ rank: L, action: L, estimatedMarkGain: L, type: L }],
    guidelines: [{ guideline: L, year: L, relevance: L }],
    keyLearningPoints: L, flags: L, modelAnswer: L,
    // storage/bookkeeping keys the app itself adds
    id: L, user_id: L, created: L, created_at: L, updated_at: L, percent: L, band: L
  };
  function auditFields(val, spec, path, out) {
    if (spec === true || val == null) return;
    if (Array.isArray(spec)) {
      if (Array.isArray(val)) val.forEach(v => auditFields(v, spec[0], path + '[]', out));
      return;
    }
    if (typeof val !== 'object' || Array.isArray(val)) return;
    Object.keys(val).forEach(k => {
      const p = path ? path + '.' + k : k;
      if (!Object.prototype.hasOwnProperty.call(spec, k)) {
        if (!out.some(u => u.path === p)) out.push({ path: p, value: val[k] });
      } else auditFields(val[k], spec[k], p, out);
    });
  }
  const unknownFields = f => { const out = []; auditFields(f, FIELD_SPEC, '', out); return out; };
  function animateDial(el, pct) {
    el.style.setProperty('--pct', pct);
    const col = pct >= 75 ? '#34d399' : pct >= 65 ? '#5eead4' : pct >= 50 ? '#e8a33d' : '#e05263';
    el.style.background = `conic-gradient(${col} ${pct * 3.6}deg, rgba(255,255,255,.08) 0)`;
  }
  function renderMd(md) {
    let h = esc(md);
    h = h.replace(/^###?\s+(.+)$/gm, '<h4>$1</h4>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(?:^|\n)\s*[-•]\s+(.+)/g, '\n<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>');
    return '<p>' + h.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  }

  /* ---------- Writing lab: aggregate writing-skills weakness analysis ---------- */

  // Distil every marked report into a picture of the candidate's WRITING (as
  // opposed to knowledge) — the recurring English/structure/technique failings
  // the examiner flagged, their score trend, and the concrete rewrites to learn
  // from. Reused by the dashboard summary and the full Writing lab page.
  function writingSummary(fb) {
    const reports = (fb || []).filter(f => f && f.score);
    const byWeakness = {};       // label → { count, tips:Set, quotes:[] }
    reports.forEach(f => (f.writingImprovement || []).forEach(w => {
      const key = (w.label || 'General').trim();
      const rec = byWeakness[key] || (byWeakness[key] = { label: key, count: 0, tips: new Set(), quotes: [] });
      rec.count++;
      (w.proTips || []).forEach(t => rec.tips.add(t));
      (w.quotes || []).forEach(q => { if (rec.quotes.length < 4 && q.original) rec.quotes.push(q); });
    }));
    const weaknesses = Object.values(byWeakness).sort((a, b) => b.count - a.count)
      .map(w => ({ label: w.label, count: w.count, tips: [...w.tips], quotes: w.quotes }));
    const scored = reports.filter(f => f.score.percent != null);
    const avg = scored.length ? Math.round(scored.reduce((s, f) => s + f.score.percent, 0) / scored.length) : null;
    // trend: compare the most recent third with the earliest third (by created)
    const ordered = scored.slice().sort((a, b) => (a.created || 0) - (b.created || 0)).map(f => f.score.percent);
    let trend = 0;
    if (ordered.length >= 4) { const k = Math.max(1, Math.floor(ordered.length / 3)); const first = ordered.slice(0, k), last = ordered.slice(-k); trend = Math.round(last.reduce((s, x) => s + x, 0) / last.length - first.reduce((s, x) => s + x, 0) / first.length); }
    return { count: reports.length, avg, trend, weaknesses, top: weaknesses[0] || null };
  }

  async function renderWritingLab(view, user) {
    view.innerHTML = libraryShell('essay', `<a class="link muted dev-back" href="#/library/essay">← Essay papers</a>
      <div id="wl-body"><p class="muted">Analysing your writing…</p></div>`);
    FX.viewIn(view);
    let fb = []; try { fb = (await Backend.listEssayFeedback()) || []; } catch { fb = []; }
    const sum = writingSummary(fb);
    const body = view.querySelector('#wl-body');
    if (!sum.count) {
      body.innerHTML = `<div class="card" data-animate><h3 class="card-title">✍ Writing lab</h3>
        <p class="muted">Once you've uploaded a marked essay or two, this page distils the <strong>writing</strong> patterns behind your marks — grammar, structure, concision and exam technique — and builds targeted practice drills. Mark an essay to get started.</p>
        <a class="btn btn-gold" href="#/library/essay">Go to essay papers</a></div>`;
      return;
    }
    const trendTxt = sum.trend > 1 ? `<span class="good">▲ improving (+${sum.trend}%)</span>` : sum.trend < -1 ? `<span class="bad">▼ slipping (${sum.trend}%)</span>` : `<span class="muted">steady</span>`;
    body.innerHTML = `
      <header data-animate><p class="kicker">WRITING LAB</p><h1 class="page-title">How you write, not just what you know</h1>
        <p class="muted">Aggregated from ${sum.count} marked answer${sum.count === 1 ? '' : 's'}. Knowledge wins marks — but so does how clearly and completely you put it on the page under time pressure.</p></header>
      <div class="wl-stats" data-animate>
        <div class="wl-stat"><strong>${sum.avg != null ? sum.avg + '%' : '—'}</strong><span>Average score</span></div>
        <div class="wl-stat"><strong>${sum.count}</strong><span>Answers marked</span></div>
        <div class="wl-stat"><strong>${trendTxt}</strong><span>Recent trend</span></div>
        <div class="wl-stat"><strong>${sum.top ? esc(sum.top.label) : '—'}</strong><span>Top weakness</span></div>
      </div>
      <div class="card" data-animate>
        <h3 class="card-title">📉 Your recurring writing weaknesses</h3>
        <p class="muted tiny">Ranked by how often the examiner flagged each across your papers.</p>
        <div class="wl-weak-list">
          ${sum.weaknesses.map(w => `
            <details class="wl-weak">
              <summary><span class="wl-weak-name">${esc(w.label)}</span><span class="wl-weak-count">${w.count}×</span></summary>
              ${w.quotes.length ? `<div class="wl-quotes">${w.quotes.map(q => `<div class="es-rewrite"><p class="es-rw-orig">“${esc(q.original)}”</p>${q.rewrite ? `<p class="es-rw-new">→ ${esc(q.rewrite)}</p>` : ''}</div>`).join('')}</div>` : ''}
              ${w.tips.length ? `<ul class="es-protips">${w.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
            </details>`).join('')}
        </div>
      </div>
      <div class="card es-ai" data-animate>
        <h3 class="card-title">🏋 Targeted practice drills</h3>
        <p class="muted">Generate grammar, structure and exam-technique exercises aimed squarely at your top weaknesses — with model rewrites to check yourself against.</p>
        <button class="btn btn-ai" id="wl-drills">✨ Build my practice drills</button>
        <div id="wl-out"></div>
      </div>`;
    view.querySelector('#wl-drills')?.addEventListener('click', e => buildDrills(e.target, view.querySelector('#wl-out'), sum));
  }

  async function buildDrills(btn, out, sum) {
    btn.disabled = true;
    out.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>`;
    try {
      const token = await Backend.getAccessToken();
      if (!token) throw new Error('Sign in to use AI analysis.');
      const prov = await pickProvider();
      const weak = sum.weaknesses.slice(0, 4).map(w => `${w.label} (flagged ${w.count}×)${w.tips.length ? ' — advice given: ' + w.tips.slice(0, 2).join('; ') : ''}`).join('\n');
      const q = `You are an O&G examiner-coach helping a PGIM MD Part II candidate improve their essay WRITING (not their medical knowledge). Their average is ${sum.avg}% and their recurring writing weaknesses, most frequent first, are:\n${weak}\n\n` +
        `Design a short set of practice drills targeting these. Use **bold** headers and this structure:\n` +
        `**Grammar & clarity** — 2 short "fix this sentence" drills (give a clumsy clinical sentence, then the model rewrite).\n` +
        `**Structure & concision** — 1 drill on planning/structuring an answer in 2 minutes for their weakest area.\n` +
        `**Exam technique** — 2 concrete habits to drill before their next mock.\n` +
        `Keep it under 260 words, practical and specific to O&G essays.`;
      const res = await fetch(cfg().ai.apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ action: 'chat', provider: prov, model: modelFor(prov), dailyLimit: cfg().ai.dailyLimit,
          question: { kind: 'ESSAY', theme: 'Writing skills', stem: 'Writing-skills drills', options: [], answer: 0, preLettered: true }, messages: [{ role: 'user', content: q }] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (HTTP ${res.status}).`);
      out.innerHTML = `<div class="ai-body">${renderMd(data.text)}</div>`;
    } catch (e) { out.innerHTML = `<p class="ai-error">${esc(e.message || e)}</p>`; }
    btn.disabled = false;
  }

  // "How marking works" help page (route #/library/essay/how)
  function renderHow(view, user) {
    view.innerHTML = libraryShell('essay', `
      <a class="link muted dev-back" href="#/library/essay">← Essay papers</a>
      <div class="card" data-animate>
        <h3 class="card-title">ℹ How essay marking works</h3>
        <ol class="es-how">
          <li><strong>Write.</strong> Open a paper, pick a question, start the 30-minute timer, and write your answer on paper (pause the timer whenever you need — your time is saved).</li>
          <li><strong>Photograph.</strong> Take clear photos of every page, in order, with the page number top-right.</li>
          <li><strong>Mark it.</strong> Open the <em>OG Revise Essay Marker</em> Claude project, paste the question code (e.g. <code>M03-Q5</code>) and attach your photos. It marks against the frozen scheme and returns a report — a DOCX and a <strong>JSON</strong> file.</li>
          <li><strong>Upload.</strong> Come back here and use <em>Upload report (JSON)</em> — your full examiner breakdown appears, with an AI tutor and weakness analysis on top.</li>
        </ol>
        <p class="muted tiny">${user?.isDeveloper ? 'As the owner, your reports auto-import from the Drive folder — just click “Auto-import from Drive”.' : 'Ask the site owner for the marking project link if you don\'t have it.'}</p>
      </div>`);
    FX.viewIn(view);
  }

  /* ---------- library shell (shared sub-nav) ---------- */

  function libraryShell(active, inner) {
    return window.__aureumLibraryShell ? window.__aureumLibraryShell(active, inner) : `<section class="page">${inner}</section>`;
  }

  return { renderList, renderPaper, renderWrite, renderFeedback, renderWritingLab, writingSummary, renderHow, bustPapers, papers, questionsOf, partsOf, isPgim, paperTitle, validateFeedback, normaliseFeedback };
})();
