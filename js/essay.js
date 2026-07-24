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
    const list = (typeof Cache !== 'undefined') ? await Cache.wrap('essay-papers', 15 * 60 * 1000, loader) : await loader();
    return list.slice().sort((a, b) => (a.paperNumber || 0) - (b.paperNumber || 0));
  }
  function bustPapers() { if (typeof Cache !== 'undefined') Cache.bust('essay-papers'); }
  // flatten a paper's sections into an ordered question list
  function questionsOf(p) {
    const out = [];
    (p.sections || []).forEach(sec => (sec.questions || []).forEach(q =>
      out.push({ ...q, sectionTitle: sec.sectionTitle })));
    return out;
  }
  const qMarks = q => q.totalMarks || q.marks || (q.parts || []).reduce((s, x) => s + (x.marks || 0), 0) || 100;

  /* ================= list of papers (#/library/essay) ================= */

  async function renderList(view, user) {
    view.innerHTML = libraryShell('essay', `
      <div id="es-body"><p class="muted">Loading essay papers…</p></div>`);
    FX.viewIn(view);
    let list = [], fb = [];
    try { list = await papers(); } catch (e) { list = []; }
    try { fb = (await Backend.listEssayFeedback()) || []; } catch { fb = []; }
    const fbByCode = {}; fb.forEach(f => fbByCode[f.code] = f);
    const body = view.querySelector('#es-body');

    if (!list.length) {
      body.innerHTML = `
        <div class="card" data-animate>
          <h3 class="card-title">No essay papers yet</h3>
          <p class="muted">The site owner publishes structured-essay mock papers here. Once a paper is live you'll write it
            against a timer, photograph your answers, and upload the AI marking report for a detailed breakdown.</p>
        </div>`;
      renderFeedbackInbox(view, user, fb);
      return;
    }

    body.innerHTML = `
      <div class="es-intro card" data-animate>
        <p class="muted">Structured-essay practice for PGIM MD Part II. Write a paper against the clock, photograph your
          answers, and upload the marking report to see a full examiner breakdown — richer than a printed report, with an
          AI tutor and weakness analysis built in.</p>
      </div>
      <div class="es-papers" data-animate>
        ${list.map(p => {
          const qs = questionsOf(p);
          const done = qs.filter(q => fbByCode[q.code]).length;
          const avg = done ? Math.round(qs.filter(q => fbByCode[q.code]).reduce((s, q) => s + (fbByCode[q.code].score?.percent || 0), 0) / done) : null;
          return `
          <a class="es-paper-card" href="#/library/essay/${encodeURIComponent(p.id)}">
            <div class="es-paper-num">${p.paperNumber || '•'}</div>
            <div class="es-paper-main">
              <h3>${esc(p.paperLabel || ('Mock Paper ' + (p.paperNumber || '')))}</h3>
              <p class="muted tiny">${esc(p.examTitle || 'MD (O&G) Examination')} · ${qs.length} questions · ${p.durationHours || 3} h</p>
              <div class="es-paper-prog"><span style="width:${qs.length ? (done / qs.length) * 100 : 0}%"></span></div>
            </div>
            <div class="es-paper-side">
              <span class="es-paper-done">${done}/${qs.length}</span>
              <span class="muted tiny">${avg != null ? 'avg ' + avg + '%' : 'marked'}</span>
            </div>
          </a>`;
        }).join('')}
      </div>`;
    renderFeedbackInbox(view, user, fb);
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

    view.innerHTML = `
      <section class="page">
        <a class="link muted dev-back" href="#/library/essay">← Essay papers</a>
        <header data-animate>
          <p class="kicker">${esc(p.examTitle || 'MD (O&G)')} · ${qs.length} questions · ${p.durationHours || 3} hours</p>
          <h1 class="page-title">${esc(p.paperLabel || ('Mock Paper ' + p.paperNumber))}</h1>
          <p class="muted">${(p.instructions || []).map(esc).join(' · ')}</p>
        </header>
        <div class="es-qlist" data-animate>
          ${qs.map((q, i) => {
            const marked = fb[q.code];
            return `
            <div class="es-q-card">
              <div class="es-q-top">
                <span class="chip chip-${q.type === 'SAQ' ? 'sba' : 'emq'}">${esc(q.type || 'SEQ')}</span>
                <span class="es-q-code">${esc(q.code)}</span>
                <span class="es-q-marks">${qMarks(q)} marks</span>
                ${marked ? `<span class="es-fb-band es-band-${bandClass(marked.score?.band)}">${esc(marked.score?.band || '')} · ${marked.score?.percent}%</span>` : ''}
              </div>
              <p class="es-q-stem">${esc(q.stem).replace(/\n/g, '<br>')}</p>
              ${(q.parts || []).length ? `<ul class="es-q-parts">${q.parts.map(pt => `<li><strong>${esc(pt.label)}</strong> ${esc(pt.text)} <span class="muted tiny">(${pt.marks})</span></li>`).join('')}</ul>` : ''}
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
        <a class="link muted dev-back" href="#/library/essay/${encodeURIComponent(p.id)}">← ${esc(p.paperLabel || 'Paper')}</a>
        <div class="es-write-top" data-animate>
          <div>
            <p class="kicker">${esc(p.paperLabel || '')} · Question ${idx + 1} of ${qs.length}</p>
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
          ${(q.parts || []).length ? `<ul class="es-q-parts">${q.parts.map(pt => `<li><strong>${esc(pt.label)}</strong> ${esc(pt.text)} <span class="muted tiny">(${pt.marks} marks)</span></li>`).join('')}</ul>` : ''}
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
            <p class="kicker">${esc(f.subject || 'O&G')} · ${esc(f.questionType || 'SEQ')} · scheme v${esc(f.schemeVersion || '1.0')}${f.markedOn ? ' · marked ' + esc(f.markedOn) : ''}</p>
            <h1 class="page-title">${esc(f.code)} — ${esc(f.topic || '')}</h1>
          </div>
          <div class="es-scoredial">
            <div class="es-dial" id="es-dial" data-pct="${sc.percent || 0}"><span>${sc.percent != null ? sc.percent + '%' : '—'}</span></div>
            <span class="es-fb-band es-band-${band} big">${esc(sc.band || '')}</span>
            <span class="muted tiny">${sc.raw != null ? `${sc.raw}/${sc.rawMax || 100} raw · ${sc.scaled != null ? sc.scaled + '/' + (sc.scaledMax || 20) : ''}` : ''}</span>
          </div>
        </header>

        ${f.questionStem ? `<div class="card es-r-q" data-animate><p class="es-q-stem">${esc(f.questionStem).replace(/\n/g, '<br>')}</p>
          ${(f.subQuestions || []).length ? `<ul class="es-q-parts">${f.subQuestions.map(sqp => `<li><strong>${esc(sqp.label)}</strong> ${esc(sqp.text)} <span class="muted tiny">(${sqp.maxMarks || sqp.marks || ''})</span></li>`).join('')}</ul>` : ''}</div>` : ''}

        ${(f.breakdown || []).length ? `
        <div class="card" data-animate>
          <h3 class="card-title">Sub-question breakdown</h3>
          <div class="es-break">${f.breakdown.map(b => {
            const pct = b.max ? Math.round((b.raw / b.max) * 100) : 0;
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
            <span class="es-dot par"></span> partial · <span class="es-dot mis"></span> missed.</p>
          ${f.markScheme.map(sec => `
            <details class="es-scheme-sec" open>
              <summary><strong>${esc(sec.section)}</strong> <span class="muted">${sec.raw != null ? sec.raw + '/' + sec.max : ''}</span></summary>
              <div class="es-points">${(sec.points || []).map(pt => `
                <div class="es-point es-st-${stClass(pt.status)}">
                  <span class="es-point-icon">${stIcon(pt.status)}</span>
                  <div class="es-point-body">
                    <p class="es-point-text">${esc(pt.point)}</p>
                    ${pt.note ? `<p class="es-point-note">${esc(pt.note)}</p>` : ''}
                    ${pt.guideline ? `<span class="es-point-guide">${esc(pt.guideline)}</span>` : ''}
                  </div>
                </div>`).join('')}</div>
            </details>`).join('')}
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

        <div class="es-report-foot">
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
      rationale: 'Examiner comment: ' + (f.examinerComment || '') + '\nKey points: ' + (f.keyLearningPoints || []).join('; '),
      paperTitle: f.code + ' — ' + (f.topic || ''), preLettered: true
    };
    if (typeof AI !== 'undefined' && cfg().ai?.enabled) AI.attach(view.querySelector('#es-ai-slot'), ctx);

    view.querySelector('#es-ai-analyse').addEventListener('click', e => runAnalysis(e.target, view.querySelector('#es-ai-out'), f));
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
      const missed = (f.markScheme || []).flatMap(s => (s.points || []).filter(p => /missed|partial/i.test(p.status)).map(p => `[${p.status}] ${p.point}${p.note ? ' — ' + p.note : ''}`)).slice(0, 30);
      const q = `You are an O&G examiner-coach. A PGIM MD Part II candidate scored ${f.score?.percent}% (${f.score?.band}) on "${f.code} — ${f.topic}". ` +
        `The marks they lost, from the official scheme:\n${missed.join('\n')}\n\n` +
        `In under 220 words with **bold** headers: (1) the single recurring WEAKNESS pattern behind these losses; (2) the 3 highest-yield facts/figures to memorise to fix it; (3) one concrete drill for their next attempt. Be specific and practical.`;
      const messages = [{ role: 'user', content: q }];
      const res = await fetch(cfg().ai.apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ action: 'chat', provider: 'gemini', dailyLimit: cfg().ai.dailyLimit,
          question: { kind: 'ESSAY', theme: f.topic, stem: f.questionStem || f.code, options: [], answer: 0, preLettered: true }, messages })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Analysis failed (HTTP ${res.status}).`);
      out.innerHTML = `<div class="ai-body">${renderMd(data.text)}</div>`;
    } catch (e) { out.innerHTML = `<p class="ai-error">${esc(e.message || e)}</p>`; }
    btn.disabled = false;
  }

  /* ---------- helpers ---------- */

  const stClass = s => /cover/i.test(s) ? 'cov' : /partial/i.test(s) ? 'par' : 'mis';
  const stIcon = s => /cover/i.test(s) ? '✓' : /partial/i.test(s) ? '~' : '✗';
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

  return { renderList, renderPaper, renderWrite, renderFeedback, renderHow, bustPapers, papers, questionsOf, validateFeedback, normaliseFeedback };
})();
