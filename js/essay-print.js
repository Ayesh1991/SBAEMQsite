/* ============================================================
   essay-print.js — the printable essay marking report.

   The on-screen report is the good one: it holds everything the
   marking JSON carries. This turns that same data into an A4
   document you can hand in, file, or read away from a screen —
   without losing anything on the way.

   How it works: the wizard builds a complete, self-contained HTML
   document and puts it in an iframe as a live A4 preview. Printing
   prints THAT iframe, so what you saw is exactly what comes out,
   and "Save as PDF" in the browser's own print dialog gives the PDF.
   No popup window (blockers eat those), no server, no library.

   Four designs, because a report you file and a sheet you pin above
   the desk are not the same document:
     classic   — exam-board formal: serif, ruled, black on white
     clinical  — modern report: sans, accent bar, table-led
     compact   — dense: small type, tight leading, fewest pages
     annotated — wide margin column left blank for handwriting
   ============================================================ */

const EssayPrint = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl = s => esc(s).replace(/\n/g, '<br>');

  /* ---------- what can go in the document ---------- */
  const SECTIONS = [
    ['cover', 'Cover & score', 'Title, paper details, the score dial and the band key'],
    ['question', 'The question', 'Full stem and every sub-part with its marks'],
    ['breakdown', 'Sub-part marks', 'The table of raw and scaled marks per sub-part'],
    ['examiner', 'Examiner comment', 'The marker\'s overall verdict'],
    ['transcription', 'Your answer, transcribed', 'What the marker actually read from your script'],
    ['markScheme', 'Marked against the scheme', 'Every scheme point with covered / partial / missed'],
    ['fullScheme', 'The mark scheme in full', 'The blank scheme: every available point, ideal answers, calibration'],
    ['loss', 'Where the marks went', 'Loss analysis by cause'],
    ['actions', 'What to do first', 'Priority actions and improvement advice'],
    ['writing', 'Writing analysis', 'Structure metrics, buried points, rewrites, phrase bank'],
    ['time', 'Time & volume', 'The pacing check'],
    ['guidelines', 'Guidelines', 'Every guideline referenced'],
    ['learning', 'Key learning points', 'The take-away list'],
    ['modelAnswer', 'Model answer', 'The full-mark answer, writable by hand']
  ];

  const TEMPLATES = {
    classic: {
      name: 'Examiner report',
      blurb: 'Formal and complete, the way an exam board writes it. Serif, ruled headings, black on white — prints cleanly on any printer.',
      on: ['cover', 'question', 'breakdown', 'examiner', 'transcription', 'markScheme', 'loss', 'actions', 'writing', 'time', 'guidelines', 'learning', 'modelAnswer']
    },
    clinical: {
      name: 'Full dossier',
      blurb: 'Everything the file holds, including the blank mark scheme. A modern report layout with a colour accent — the one to keep on file.',
      on: SECTIONS.map(s => s[0])
    },
    compact: {
      name: 'Revision brief',
      blurb: 'Only what changes your next attempt: score, where the marks went, what to do first, the learning points and the model answer. Dense, few pages.',
      on: ['cover', 'question', 'loss', 'actions', 'learning', 'modelAnswer']
    },
    annotated: {
      name: 'Annotation copy',
      blurb: 'Wide blank margin down the left of every page for your own notes, and generous line spacing. For working through with a pen.',
      on: ['cover', 'question', 'markScheme', 'fullScheme', 'actions', 'learning', 'modelAnswer']
    }
  };

  const has = {
    cover: f => true,
    question: f => !!f.questionStem,
    breakdown: f => (f.breakdown || []).length,
    examiner: f => !!f.examinerComment,
    transcription: f => (f.transcription?.pages || []).length,
    markScheme: f => (f.markScheme || []).length,
    fullScheme: f => (f.generatedScheme?.sections || []).length,
    loss: f => !!f.lossAnalysis,
    actions: f => (f.priorityActions || []).length || (f.improvementAdvice || []).length,
    writing: f => !!f.writingAnalysis || (f.writingImprovement || []).length,
    time: f => !!f.timeManagement,
    guidelines: f => (f.guidelines || []).length || (f.generatedScheme?.guidelinesUsed || []).length,
    learning: f => (f.keyLearningPoints || []).length || (f.flags || []).length,
    modelAnswer: f => !!f.modelAnswer
  };

  /* ---------- the wizard ---------- */

  let host = null;
  function open(f) {
    close();
    const avail = SECTIONS.filter(([id]) => has[id](f));
    let tpl = 'classic';
    let picked = new Set(TEMPLATES.classic.on.filter(id => avail.some(a => a[0] === id)));

    host = document.createElement('div');
    host.className = 'pw-overlay';
    host.innerHTML = `
      <div class="pw-modal" role="dialog" aria-modal="true" aria-label="Printable report">
        <header class="pw-head">
          <div>
            <p class="kicker">PRINTABLE REPORT · A4</p>
            <h2>${esc(f.code)} — ${esc(f.topic || '')}</h2>
          </div>
          <button class="pw-x" id="pw-x" aria-label="Close">✕</button>
        </header>
        <div class="pw-body">
          <aside class="pw-rail">
            <h3 class="pw-rail-h">Design</h3>
            <div class="pw-tpls">
              ${Object.entries(TEMPLATES).map(([id, t]) => `
                <button class="pw-tpl ${id === tpl ? 'active' : ''}" data-tpl="${id}">
                  <span class="pw-tpl-thumb pw-th-${id}" aria-hidden="true">
                    <i></i><i></i><i></i><i></i>
                  </span>
                  <span class="pw-tpl-name">${esc(t.name)}</span>
                  <span class="pw-tpl-blurb">${esc(t.blurb)}</span>
                </button>`).join('')}
            </div>
            <h3 class="pw-rail-h">What goes in</h3>
            <p class="pw-rail-note">Only sections your report actually has are listed. Nothing else is dropped —
              everything ticked is printed in full.</p>
            <div class="pw-secs" id="pw-secs">
              ${avail.map(([id, label, desc]) => `
                <label class="pw-sec">
                  <input type="checkbox" data-sec="${id}" ${picked.has(id) ? 'checked' : ''}>
                  <span><strong>${esc(label)}</strong><em>${esc(desc)}</em></span>
                </label>`).join('')}
            </div>
            <div class="pw-opts">
              <label class="pw-sec"><input type="checkbox" id="pw-colour" checked>
                <span><strong>Colour</strong><em>Untick for a pure black-and-white print</em></span></label>
            </div>
          </aside>
          <main class="pw-preview">
            <div class="pw-paper-wrap"><iframe class="pw-paper" id="pw-frame" title="Print preview"></iframe></div>
            <p class="pw-hint">A4 · <span id="pw-count">…</span> — in the print dialog choose <strong>Save as PDF</strong>,
              paper <strong>A4</strong>, and turn <strong>Headers and footers</strong> off for a clean document.</p>
          </main>
        </div>
        <footer class="pw-foot">
          <span class="muted tiny" id="pw-state"></span>
          <div class="pw-foot-acts">
            <button class="btn btn-ghost" id="pw-cancel">Cancel</button>
            <button class="btn btn-gold" id="pw-print">🖨 Print / Save as PDF</button>
          </div>
        </footer>
      </div>`;
    document.body.appendChild(host);
    document.body.classList.add('pw-open');

    const frame = host.querySelector('#pw-frame');
    const draw = () => {
      const colour = host.querySelector('#pw-colour').checked;
      frame.srcdoc = buildDoc(f, tpl, picked, colour);
      host.querySelector('#pw-count').textContent =
        `${picked.size} section${picked.size === 1 ? '' : 's'}`;
      host.querySelector('#pw-state').textContent =
        picked.size ? `${TEMPLATES[tpl].name} · ${picked.size} of ${avail.length} sections` : 'Nothing selected';
      host.querySelector('#pw-print').disabled = !picked.size;
    };

    host.querySelector('.pw-tpls').addEventListener('click', e => {
      const b = e.target.closest('[data-tpl]'); if (!b) return;
      tpl = b.dataset.tpl;
      host.querySelectorAll('.pw-tpl').forEach(x => x.classList.toggle('active', x === b));
      // a design carries its own idea of what belongs in it
      picked = new Set(TEMPLATES[tpl].on.filter(id => avail.some(a => a[0] === id)));
      host.querySelectorAll('[data-sec]').forEach(c => c.checked = picked.has(c.dataset.sec));
      draw();
    });
    host.querySelector('#pw-secs').addEventListener('change', e => {
      const c = e.target.closest('[data-sec]'); if (!c) return;
      c.checked ? picked.add(c.dataset.sec) : picked.delete(c.dataset.sec);
      draw();
    });
    host.querySelector('#pw-colour').addEventListener('change', draw);
    host.querySelector('#pw-print').addEventListener('click', () => {
      const w = frame.contentWindow;
      try { w.focus(); w.print(); } catch { alert('Your browser blocked printing. Try again, or use ⌘/Ctrl-P.'); }
    });
    host.querySelector('#pw-x').addEventListener('click', close);
    host.querySelector('#pw-cancel').addEventListener('click', close);
    host.addEventListener('click', e => { if (e.target === host) close(); });
    document.addEventListener('keydown', onKey);
    draw();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('pw-open');
    if (host) { host.remove(); host = null; }
  }

  /* ---------- the document ---------- */

  const stWord = s => /cover/i.test(s) ? 'Covered' : /partial/i.test(s) ? 'Partial' : 'Missed';
  const stCls = s => /cover/i.test(s) ? 'cov' : /partial/i.test(s) ? 'par' : 'mis';
  const stMark = s => /cover/i.test(s) ? '✓' : /partial/i.test(s) ? '~' : '✗';
  const TAGS = /\[(SAFETY|VERIFY|SLCOG-CHECK)([^\]]*)\]/gi;

  function schemeLine(raw) {
    let t = String(raw == null ? '' : raw), guide = '';
    const bar = t.split(' | ');
    if (bar.length > 1) { t = bar[0]; guide = bar.slice(1).join(' | '); }
    const tags = [];
    t = t.replace(TAGS, (_, k, rest) => { tags.push((k + rest).trim().toUpperCase()); return ''; })
      .replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
    return `<li>${esc(t)}${tags.map(x => ` <span class="tag t-${x.split(/[\s\-]/)[0].toLowerCase()}">${esc(x)}</span>`).join('')}${
      guide ? ` <span class="cite">${esc(guide)}</span>` : ''}</li>`;
  }

  // The model answer is markdown; the report page renders it, so must this.
  function md(src) {
    const lines = String(src || '').split('\n');
    let out = '', list = null;
    const inline = t => esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
    lines.forEach(raw => {
      const t = raw.trim();
      if (!t) { closeList(); return; }
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); out += `<h4 class="md-h md-h${h[1].length}">${inline(h[2])}</h4>`; return; }
      const ul = t.match(/^[-*•]\s+(.*)$/);
      if (ul) { if (list !== 'ul') { closeList(); out += '<ul class="md-l">'; list = 'ul'; } out += `<li>${inline(ul[1])}</li>`; return; }
      const ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ol) { if (list !== 'ol') { closeList(); out += '<ol class="md-l">'; list = 'ol'; } out += `<li>${inline(ol[1])}</li>`; return; }
      closeList(); out += `<p>${inline(t)}</p>`;
    });
    closeList();
    return out;
  }

  function buildDoc(f, tpl, on, colour) {
    const sc = f.score || {};
    const gs = f.generatedScheme;
    const put = id => on.has(id) ? true : false;
    const bandTone = /distinction/i.test(sc.band || '') ? 'dist'
      : /clear pass/i.test(sc.band || '') ? 'pass'
      : /borderline/i.test(sc.band || '') ? 'border' : 'fail';

    const sec = (title, inner, opts = {}) => !inner ? '' : `
      <section class="blk ${opts.break ? 'newpage' : ''}">
        <h2>${esc(title)}</h2>
        ${inner}
      </section>`;

    /* --- cover --- */
    const cover = !put('cover') ? '' : `
      <header class="cover">
        <p class="brand">AUREUM · Pathway to MD</p>
        <p class="eyebrow">Essay marking report${f.paper ? ' · ' + esc(f.paper) : ''}</p>
        <h1>${esc(f.code)} — ${esc(f.topic || '')}</h1>
        <p class="sub">${esc(f.subject || 'O&G')} · ${esc(f.questionType || 'SEQ')}${
          f.schemeVersion ? ' · scheme v' + esc(f.schemeVersion) : ''}${
          f.markedOn ? ' · marked ' + esc(f.markedOn) : ''}</p>
        ${(f.topicTags || []).length ? `<p class="tags">${f.topicTags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</p>` : ''}
        <div class="scorebox">
          <div class="pct b-${bandTone}">
            <span class="pct-n">${sc.percent != null ? sc.percent + '%' : '—'}</span>
            <span class="pct-b">${esc(sc.band || '')}</span>
          </div>
          <table class="kv">
            <tr><th>Raw total</th><td>${sc.raw != null ? sc.raw + ' / ' + (sc.rawMax || 100) : '—'}</td>
                <th>Band key</th><td class="key">≥75 Distinction</td></tr>
            <tr><th>Scaled total</th><td>${sc.scaled != null ? sc.scaled + ' / ' + (sc.scaledMax || 20) : '—'}</td>
                <th></th><td class="key">65–74 Clear Pass</td></tr>
            <tr><th>Percentage</th><td>${sc.percent != null ? sc.percent + '%' : '—'}</td>
                <th></th><td class="key">50–64 Borderline</td></tr>
            <tr><th>Scheme source</th><td>${esc(f.schemeSource || '—')}</td>
                <th></th><td class="key">&lt;50 Fail</td></tr>
          </table>
        </div>
        ${(sc.deductions || []).length ? `<div class="callout warn"><strong>Deductions applied.</strong>
          <ul>${sc.deductions.map(d => `<li>${typeof d === 'string' ? esc(d)
            : esc(d.reason || d.cause || '') + (d.marks != null ? ` (−${d.marks})` : '')}</li>`).join('')}</ul></div>` : ''}
      </header>`;

    /* --- question --- */
    const question = !put('question') ? '' : sec('The question', `
      <p class="stem">${nl(f.questionStem)}</p>
      ${(f.subQuestions || []).length ? `<ol class="parts">${f.subQuestions.map(s =>
        `<li><strong>${esc(s.label)}</strong> ${esc(s.text)}${s.maxMarks != null ? ` <span class="mk">(${s.maxMarks} marks)</span>` : ''}</li>`).join('')}</ol>` : ''}`);

    /* --- breakdown --- */
    const breakdown = !put('breakdown') ? '' : sec('Sub-part marks', `
      <table class="grid">
        <thead><tr><th>Sub-part</th><th class="n">Raw</th><th class="n">Max</th><th class="n">%</th><th>Result</th></tr></thead>
        <tbody>${(f.breakdown || []).map(b => {
          const pct = b.percent != null ? b.percent : (b.max ? Math.round((b.raw / b.max) * 100) : 0);
          return `<tr><td>${esc(b.section)}</td><td class="n">${b.raw}</td><td class="n">${b.max}</td>
            <td class="n">${pct}%</td><td><span class="bar"><i style="width:${pct}%"></i></span></td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><th>Total</th><th class="n">${sc.raw != null ? sc.raw : ''}</th><th class="n">${sc.rawMax || ''}</th>
          <th class="n">${sc.percent != null ? sc.percent + '%' : ''}</th><th>${esc(sc.band || '')}</th></tr></tfoot>
      </table>`);

    /* --- examiner --- */
    const examiner = !put('examiner') ? '' : sec('Examiner comment',
      f.examinerComment ? `<div class="callout"><p>${nl(f.examinerComment)}</p></div>` : '');

    /* --- transcription --- */
    const transcription = !put('transcription') ? '' : sec('Your answer, as the marker read it', `
      <p class="note">${f.transcription?.pageCount != null ? f.transcription.pageCount + ' page(s)' : ''}${
        f.transcription?.illegiblePercent != null ? ` · about ${f.transcription.illegiblePercent}% could not be read` : ''}.
        Anything mis-read here was marked as it appears.</p>
      ${(f.transcription?.subPartMapping || []).length ? `<p class="note">Sub-parts by page:
        ${f.transcription.subPartMapping.map(m => `<strong>${esc(m.label)}</strong> p${(m.pages || []).join(', ')}`).join(' · ')}</p>` : ''}
      ${(f.transcription?.pages || []).map(pg => `
        <div class="page-blk">
          <p class="page-n">Page ${pg.page}${pg.subPart ? ` — ${esc(pg.subPart)}` : ''}</p>
          <div class="script">${nl(pg.text)}</div>
        </div>`).join('')}`, { break: true });

    /* --- mark scheme assessment --- */
    const markScheme = !put('markScheme') ? '' : sec('Marked against the scheme', `
      <p class="note"><span class="pip cov">✓</span> covered &nbsp; <span class="pip par">~</span> partial
        &nbsp; <span class="pip mis">✗</span> missed &nbsp; <span class="pip safe">⚠</span> safety-critical</p>
      ${(f.markScheme || []).map(s => `
        <div class="ms-sec">
          <h3>${esc(s.section)} <span class="mk">${s.raw != null ? s.raw + ' / ' + s.max : ''}</span></h3>
          ${(s.blocks || []).map(b => `
            <div class="ms-blk ${stCls(b.status)}">
              <p class="ms-blk-h"><strong>${esc(b.block || '')}</strong>
                <span class="mk">${b.awarded != null ? b.awarded + ' / ' + b.max : ''}</span>
                <span class="st ${stCls(b.status)}">${esc(stWord(b.status))}</span>
                ${b.capped ? '<span class="st cap">capped</span>' : ''}
                ${b.guideline ? `<span class="cite">${esc(b.guideline)}</span>` : ''}</p>
              ${b.capReason ? `<p class="cap-why"><strong>${b.capped ? 'Why it was capped.' : 'Marker\'s note.'}</strong> ${esc(b.capReason)}</p>` : ''}
              <ul class="pts">${(b.items || []).map(it => `
                <li class="${stCls(it.status)}"><span class="pip ${stCls(it.status)}">${stMark(it.status)}</span>
                  <span>${it.safety ? '<span class="pip safe">⚠</span> ' : ''}${esc(it.item || it.point || '')}${
                    it.note ? `<em class="pt-note">${esc(it.note)}</em>` : ''}</span></li>`).join('')}</ul>
            </div>`).join('')}
          ${(s.points || []).length ? `<ul class="pts">${s.points.map(it => `
            <li class="${stCls(it.status)}"><span class="pip ${stCls(it.status)}">${stMark(it.status)}</span>
              <span>${esc(it.point || it.item || '')}${it.note ? `<em class="pt-note">${esc(it.note)}</em>` : ''}</span></li>`).join('')}</ul>` : ''}
        </div>`).join('')}`, { break: true });

    /* --- the blank scheme --- */
    const fullScheme = !put('fullScheme') || !gs ? '' : sec('The mark scheme in full', `
      <p class="note">Every point that was <em>available</em> on this question — not only the ones you were marked on.
        ${gs.builtOn ? 'Built ' + esc(gs.builtOn) + '. ' : ''}${
        gs.sections.length} sections, ${gs.sections.reduce((n, s) => n + (s.rawMarks || 0), 0)} raw marks.</p>
      ${gs.sections.map(g => `
        <div class="gs-sec">
          <h3><span class="gs-lbl">${esc(g.label || '')}</span> ${esc(g.title || '')}
            <span class="mk">${g.rawMarks != null ? g.rawMarks + ' raw' : ''}${g.scaledMarks != null ? ' · ' + g.scaledMarks + ' scaled' : ''}</span></h3>
          ${g.model ? `<div class="callout ideal"><strong>A full-mark answer says.</strong> ${esc(g.model)}</div>` : ''}
          ${(g.blocks || []).map(b => `
            <div class="gs-blk">
              <p class="gs-blk-h"><strong>${esc(b.block || '')}</strong>
                <span class="mk">${b.marks != null ? b.marks + ' mark' + (b.marks === 1 ? '' : 's') : ''}</span>
                ${b.guideline ? `<span class="cite">${esc(b.guideline)}</span>` : ''}</p>
              <ul class="gs-items">${(b.items || []).map(schemeLine).join('')}</ul>
            </div>`).join('')}
          ${g.calibration ? `<div class="callout cal"><strong>Examiner's calibration.</strong> ${esc(g.calibration)}</div>` : ''}
        </div>`).join('')}
      ${(gs.flags || []).length ? `<div class="callout warn"><strong>Points still to be verified.</strong>
        <ul>${gs.flags.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`, { break: true });

    /* --- loss --- */
    const la = f.lossAnalysis;
    const loss = !put('loss') || !la ? '' : sec('Where the marks went', `
      ${la.totalLost != null ? `<p class="big-stat"><strong>${la.totalLost}</strong> marks lost in total.</p>` : ''}
      ${(la.byCause || []).length ? `<table class="grid">
        <thead><tr><th>Cause</th><th class="n">Marks</th><th class="n">Share</th><th>Detail</th></tr></thead>
        <tbody>${la.byCause.slice().sort((a, b) => (b.marks || 0) - (a.marks || 0)).map(c => `
          <tr><td>${esc(c.cause)}</td><td class="n">−${c.marks}</td>
            <td class="n">${la.totalLost ? Math.round(((c.marks || 0) / la.totalLost) * 100) : 0}%</td>
            <td class="sm">${esc(c.detail || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${la.biggestSingleLoss ? `<div class="callout"><strong>Biggest single loss.</strong> ${esc(la.biggestSingleLoss)}</div>` : ''}`);

    /* --- actions --- */
    const actions = !put('actions') ? '' : sec('What to do first', `
      ${(f.priorityActions || []).length ? `<ol class="prio">${f.priorityActions.slice()
        .sort((a, b) => (a.rank || 99) - (b.rank || 99)).map(a => `
        <li><span class="prio-body">${esc(a.action)}</span>
          ${a.estimatedMarkGain != null ? `<span class="gain">+${a.estimatedMarkGain} marks</span>` : ''}
          ${a.type ? `<span class="cite">${esc(a.type)}</span>` : ''}</li>`).join('')}</ol>` : ''}
      ${(f.improvementAdvice || []).map(a => `
        <div class="adv"><h3>${esc(a.label)}</h3>
          <ul>${(a.points || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}`);

    /* --- writing --- */
    const w = f.writingAnalysis || {}, st = w.structure || {};
    const metrics = [
      ['Sub-parts labelled', st.subPartsLabelled == null ? null : (st.subPartsLabelled ? 'Yes' : 'No')],
      ['Answered in order', st.answeredInOrder == null ? null : (st.answeredInOrder ? 'Yes' : 'No')],
      ['Mean sentence', st.meanSentenceWords != null ? st.meanSentenceWords + ' words' : null],
      ['Over-long sentences', st.longSentenceCount != null ? String(st.longSentenceCount) : null],
      ['Run-on sentences', st.runOnCount != null ? String(st.runOnCount) : null],
      ['Signposting', st.signpostingScore || null]
    ].filter(m => m[1] != null);
    const writing = !put('writing') ? '' : sec('Writing analysis', `
      ${w.overallVerdict ? `<div class="callout"><p>${esc(w.overallVerdict)}</p></div>` : ''}
      ${metrics.length ? `<table class="grid tight"><tbody>${metrics.map(([k, v]) =>
        `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${st.proseVsList ? `<p><strong>Prose vs list.</strong> ${esc(st.proseVsList)}</p>` : ''}
      ${(w.buriedItems || []).length ? `<h3>Points the examiner could not credit</h3>
        ${w.buriedItems.map(b => `<div class="buried"><p><strong>${esc(b.item)}</strong>${b.where ? ` — ${esc(b.where)}` : ''}</p>
          ${b.issue ? `<p class="sm">${esc(b.issue)}</p>` : ''}${b.fix ? `<p class="fix">→ ${esc(b.fix)}</p>` : ''}</div>`).join('')}` : ''}
      ${(w.recurringErrors || []).length ? `<h3>Patterns that repeated</h3>
        ${w.recurringErrors.map(r => `<div class="buried"><p><strong>${esc(r.pattern)}</strong>${r.count != null ? ` (×${r.count})` : ''}</p>
          ${(r.examples || []).length ? `<ul class="sm">${r.examples.map(x => `<li>“${esc(x)}”</li>`).join('')}</ul>` : ''}
          ${r.fix ? `<p class="fix">→ ${esc(r.fix)}</p>` : ''}</div>`).join('')}` : ''}
      ${(f.writingImprovement || []).map(x => `
        <div class="adv"><h3>${esc(x.label)}</h3>
          ${(x.quotes || []).map(q => `<div class="rw"><p class="rw-o">“${esc(q.original)}”</p><p class="rw-n">→ ${esc(q.rewrite)}</p></div>`).join('')}
          ${(x.proTips || []).length ? `<ul>${x.proTips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`).join('')}
      ${w.paragraphRewrite ? `<h3>Rewritten in full${w.paragraphRewrite.label ? ' — ' + esc(w.paragraphRewrite.label) : ''}</h3>
        <div class="rw">${w.paragraphRewrite.original ? `<p class="rw-o">“${esc(w.paragraphRewrite.original)}”</p>` : ''}
          ${w.paragraphRewrite.rewritten ? `<p class="rw-n">→ ${esc(w.paragraphRewrite.rewritten)}</p>` : ''}</div>
        ${(w.paragraphRewrite.whatChanged || []).length ? `<ul class="sm">${w.paragraphRewrite.whatChanged.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}` : ''}
      ${(w.phraseBank || []).length ? `<h3>Phrase bank</h3>
        <p class="phrases">${w.phraseBank.map(p => `<span class="tag">${esc(p)}</span>`).join('')}</p>` : ''}`, { break: true });

    /* --- time --- */
    const t = f.timeManagement || {};
    const time = !put('time') || !f.timeManagement ? '' : sec('Time & volume', `
      <table class="grid tight"><tbody>
        ${t.budgetMinutes != null ? `<tr><th>Budget</th><td>${t.budgetMinutes} min</td></tr>` : ''}
        ${t.estimatedWordCount != null ? `<tr><th>Words written</th><td>${t.estimatedWordCount}</td></tr>` : ''}
        ${t.fitsBudget != null ? `<tr><th>Fits the budget</th><td>${t.fitsBudget ? 'Yes' : 'No'}</td></tr>` : ''}
        ${t.subPartConsumingBudget ? `<tr><th>Took the most time</th><td>${esc(t.subPartConsumingBudget)}</td></tr>` : ''}
      </tbody></table>
      ${t.comment ? `<p>${esc(t.comment)}</p>` : ''}`);

    /* --- guidelines --- */
    const gl = (f.guidelines || []);
    const gu = (gs?.guidelinesUsed || []);
    const guidelines = !put('guidelines') ? '' : sec('Guidelines', `
      ${gl.length ? `<table class="grid"><thead><tr><th>Guideline</th><th>Year</th><th>Relevance</th></tr></thead>
        <tbody>${gl.map(g => `<tr><td>${esc(g.guideline)}</td><td>${esc(g.year || '')}</td><td class="sm">${esc(g.relevance || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${gu.length ? `<h3>The scheme was built from</h3>
        <table class="grid"><thead><tr><th>Guideline</th><th>Edition / year</th><th>Note</th></tr></thead>
        <tbody>${gu.map(g => `<tr><td>${esc(g.guideline)}</td><td>${esc(g.year || '')}</td><td class="sm">${esc(g.note || '—')}</td></tr>`).join('')}</tbody></table>` : ''}`);

    /* --- learning --- */
    const learning = !put('learning') ? '' : sec('Key learning points', `
      ${(f.keyLearningPoints || []).length ? `<ol class="klp">${f.keyLearningPoints.map(k => `<li>${esc(k)}</li>`).join('')}</ol>` : ''}
      ${(f.flags || []).length ? `<div class="callout warn"><strong>Marker's caveats — treat as provisional.</strong>
        <ul>${f.flags.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`);

    /* --- model answer --- */
    const modelAnswer = !put('modelAnswer') || !f.modelAnswer ? '' : sec('Model answer', `
      <p class="note">Writable by hand in 20–25 minutes.</p>
      <div class="model">${md(f.modelAnswer)}</div>`, { break: true });

    const dateStr = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

    return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(f.code)} — ${esc(f.topic || 'Essay marking report')}</title>
<style>${css(tpl, colour)}</style></head>
<body class="tpl-${tpl} ${colour ? '' : 'mono'}">
<div class="sheet">
  ${cover}
  ${question}${breakdown}${examiner}${transcription}${markScheme}${fullScheme}
  ${loss}${actions}${writing}${time}${guidelines}${learning}${modelAnswer}
  <footer class="doc-foot">
    <span>${esc(f.code)} — ${esc(f.topic || '')}</span>
    <span>AUREUM · Pathway to MD · printed ${esc(dateStr)}</span>
  </footer>
</div>
</body></html>`;
  }

  /* ---------- print stylesheet (one sheet, four skins) ---------- */
  function css(tpl, colour) {
    return `
@page { size: A4 portrait; margin: 16mm 15mm 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #f1f2f6; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { background: #fff; }
/* on screen this is a preview of a page; in print it IS the page */
@media screen { .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 16mm 15mm 14mm;
  box-shadow: 0 2px 18px rgba(0,0,0,.16); } }

/* --- type --- */
body { font-family: ${tpl === 'classic' ? '"Georgia","Times New Roman",serif' : '"Helvetica Neue",Arial,sans-serif'};
  font-size: ${tpl === 'compact' ? '9pt' : tpl === 'annotated' ? '11pt' : '10pt'};
  line-height: ${tpl === 'compact' ? '1.35' : tpl === 'annotated' ? '1.75' : '1.5'}; }
h1, h2, h3 { font-family: ${tpl === 'clinical' ? '"Helvetica Neue",Arial,sans-serif' : '"Georgia","Times New Roman",serif'};
  margin: 0 0 .35em; line-height: 1.25; }
h1 { font-size: ${tpl === 'compact' ? '17pt' : '21pt'}; }
h2 { font-size: ${tpl === 'compact' ? '11.5pt' : '13pt'}; }
h3 { font-size: ${tpl === 'compact' ? '10pt' : '11pt'}; margin-top: 1em; }
p { margin: 0 0 .6em; }
ul, ol { margin: 0 0 .6em; padding-left: 1.35em; }
li { margin-bottom: .2em; }
.sm { font-size: .88em; }
.note { font-size: .85em; color: #555; margin-bottom: .8em; }
.mk { font-weight: 600; color: ${colour ? '#7a5a10' : '#444'}; font-size: .85em; white-space: nowrap; }
.cite { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .74em; color: #666;
  border: 1px solid #d8d8d8; border-radius: 3px; padding: 0 4px; white-space: nowrap; }

/* --- cover --- */
.cover { border-bottom: ${tpl === 'clinical' ? '3px solid ' + (colour ? '#0d8f7d' : '#111') : '2px solid #111'};
  padding-bottom: 12px; margin-bottom: 16px; }
.brand { font-size: 7.5pt; letter-spacing: .22em; text-transform: uppercase; color: ${colour ? '#7a5a10' : '#555'}; margin: 0 0 2px; }
.eyebrow { font-size: 8pt; letter-spacing: .12em; text-transform: uppercase; color: #666; margin: 0 0 4px; }
.cover h1 { margin: 0 0 4px; }
.sub { font-size: 9pt; color: #555; margin: 0 0 8px; }
.tags { margin: 0 0 10px; }
.tag { display: inline-block; font-size: 7.5pt; padding: 1px 7px; border-radius: 999px;
  border: 1px solid #ccc; margin: 0 4px 3px 0; color: #444; }
.tag.t-safety { border-color: ${colour ? '#c62828' : '#333'}; color: ${colour ? '#c62828' : '#111'}; font-weight: 700; }
.tag.t-verify { border-color: ${colour ? '#a5750f' : '#555'}; color: ${colour ? '#a5750f' : '#333'}; font-weight: 700; }
.tag.t-slcog { border-color: ${colour ? '#0d8f7d' : '#555'}; color: ${colour ? '#0d8f7d' : '#333'}; font-weight: 700; }
.scorebox { display: flex; gap: 16px; align-items: stretch; margin-top: 10px; }
.pct { flex: 0 0 116px; border: 2px solid #111; border-radius: 8px; padding: 10px 8px; text-align: center; }
.pct-n { display: block; font-size: 26pt; font-weight: 800; line-height: 1; }
.pct-b { display: block; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; margin-top: 5px; }
${colour ? `.pct.b-dist { border-color: #047857; color: #047857; }
.pct.b-pass { border-color: #0d8f7d; color: #0d8f7d; }
.pct.b-border { border-color: #a5750f; color: #a5750f; }
.pct.b-fail { border-color: #c62828; color: #c62828; }` : ''}
.kv { flex: 1; border-collapse: collapse; font-size: 9pt; }
.kv th { text-align: left; font-weight: 600; padding: 3px 8px 3px 0; white-space: nowrap; color: #444; width: 1%; }
.kv td { padding: 3px 12px 3px 0; }
.kv td.key { font-size: 8pt; color: #777; }

/* --- blocks --- */
.blk { margin: 0 0 16px; break-inside: auto; }
.blk.newpage { break-before: page; }
.blk > h2 { padding-bottom: 3px; margin-bottom: 8px;
  ${tpl === 'clinical'
    ? `border-left: 4px solid ${colour ? '#0d8f7d' : '#111'}; padding-left: 9px; border-bottom: none;`
    : 'border-bottom: 1px solid #111;'}
  ${tpl === 'classic' ? 'text-transform: none; letter-spacing: .01em;' : ''} }
h3 { break-after: avoid; }
h2 { break-after: avoid; }

.stem { font-size: 1.02em; }
.parts li { margin-bottom: .3em; }
.callout { border: 1px solid #d5d5d5; border-left: 3px solid ${colour ? '#0d8f7d' : '#111'};
  padding: 8px 11px; margin: 0 0 .8em; background: #fafafa; break-inside: avoid; }
.callout.warn { border-left-color: ${colour ? '#c62828' : '#111'}; }
.callout.ideal { border-left-color: ${colour ? '#0d8f7d' : '#111'}; }
.callout.cal { border-left-color: ${colour ? '#a5750f' : '#111'}; }
.callout ul { margin: .3em 0 0; }
.big-stat { font-size: 1.1em; }

/* --- tables --- */
.grid { width: 100%; border-collapse: collapse; font-size: .92em; margin: 0 0 .9em; break-inside: auto; }
.grid th, .grid td { border: 1px solid #d8d8d8; padding: 4px 7px; text-align: left; vertical-align: top; }
.grid thead th { background: ${colour ? '#eef4f3' : '#eee'}; font-weight: 700; font-size: .86em;
  letter-spacing: .04em; text-transform: uppercase; }
.grid tfoot th { background: #f6f6f6; font-weight: 700; }
.grid .n { text-align: right; white-space: nowrap; }
.grid.tight th { width: 34%; background: #fafafa; }
.grid tr { break-inside: avoid; }
.bar { display: block; height: 7px; background: #e6e6e6; border-radius: 4px; overflow: hidden; min-width: 60px; }
.bar i { display: block; height: 100%; background: ${colour ? '#0d8f7d' : '#666'}; }

/* --- transcription --- */
.page-blk { margin-bottom: 10px; break-inside: avoid; }
.page-n { font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; color: #777; margin: 0 0 3px; }
.script { border: 1px solid #e0e0e0; background: #fbfbfb; padding: 8px 10px; font-size: .92em; white-space: normal; }

/* --- mark scheme --- */
.ms-sec { margin-bottom: 12px; }
.ms-sec > h3 { border-bottom: 1px solid #ddd; padding-bottom: 2px; }
.ms-blk { margin: 0 0 8px; padding-left: 9px; border-left: 3px solid #ddd; break-inside: avoid; }
${colour ? `.ms-blk.cov { border-left-color: #0d8f7d; } .ms-blk.par { border-left-color: #a5750f; } .ms-blk.mis { border-left-color: #c62828; }` : ''}
.ms-blk-h { margin: 0 0 3px; display: flex; flex-wrap: wrap; gap: 7px; align-items: baseline; }
.st { font-size: 7.5pt; letter-spacing: .06em; text-transform: uppercase; font-weight: 700;
  border: 1px solid #ccc; border-radius: 3px; padding: 0 5px; }
${colour ? `.st.cov { color: #0d8f7d; border-color: #0d8f7d; } .st.par { color: #a5750f; border-color: #a5750f; }
.st.mis { color: #c62828; border-color: #c62828; } .st.cap { color: #c62828; border-color: #c62828; background: #fdeeee; }` : ''}
.cap-why { font-size: .88em; ${colour ? 'color: #a02020;' : ''} margin: 0 0 .35em; }
.pts { list-style: none; padding-left: 0; margin: 0; }
.pts li { display: flex; gap: 6px; align-items: flex-start; margin-bottom: .18em; break-inside: avoid; }
.pip { display: inline-block; width: 13px; text-align: center; font-weight: 800; flex: 0 0 13px; font-size: .9em; }
${colour ? `.pip.cov { color: #0d8f7d; } .pip.par { color: #a5750f; } .pip.mis { color: #c62828; } .pip.safe { color: #c62828; }` : ''}
.pt-note { display: block; font-style: italic; color: #666; font-size: .9em; }

/* --- blank scheme --- */
.gs-sec { margin-bottom: 14px; break-inside: auto; }
.gs-lbl { display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 3px; text-align: center;
  background: ${colour ? '#a5750f' : '#111'}; color: #fff; font-size: .85em; }
.gs-blk { margin: 0 0 7px; break-inside: avoid; }
.gs-blk-h { margin: 0 0 2px; }
.gs-items { margin: 0 0 .3em; padding-left: 1.2em; font-size: .95em; }

/* --- actions --- */
.prio { padding-left: 1.4em; }
.prio li { margin-bottom: .4em; break-inside: avoid; }
.gain { font-weight: 700; ${colour ? 'color: #0d8f7d;' : ''} margin-left: 6px; font-size: .88em; white-space: nowrap; }
.adv { margin-bottom: .7em; break-inside: avoid; }
.buried { border-left: 2px solid #ddd; padding-left: 9px; margin-bottom: .6em; break-inside: avoid; }
.fix { ${colour ? 'color: #0d8f7d;' : ''} font-size: .92em; margin: 0; }
.rw { border: 1px solid #e2e2e2; padding: 7px 9px; margin-bottom: .5em; background: #fafafa; break-inside: avoid; }
.rw-o { font-style: italic; color: #666; margin: 0 0 .25em; }
.rw-n { margin: 0; ${colour ? 'color: #0a5f52;' : ''} }
.phrases .tag { font-size: 8pt; }
.klp { padding-left: 1.4em; }
.klp li { margin-bottom: .3em; }

/* --- model answer --- */
.model { font-size: .96em; }
.model .md-h { margin: .9em 0 .3em; font-size: 10.5pt; break-after: avoid; }
.model .md-h1 { font-size: 12pt; }
.model .md-l { padding-left: 1.3em; }

/* --- foot --- */
.doc-foot { margin-top: 18px; padding-top: 6px; border-top: 1px solid #ddd;
  display: flex; justify-content: space-between; font-size: 7.5pt; color: #888; }

/* --- annotation copy: a blank column down the left of everything --- */
${tpl === 'annotated' ? `
@page { margin: 16mm 15mm 14mm 52mm; }
@media screen { .sheet { padding-left: 52mm; position: relative; }
  .sheet::before { content: ''; position: absolute; left: 44mm; top: 12mm; bottom: 12mm; width: 1px; background: #e3e3e3; } }
` : ''}
${tpl === 'compact' ? `
.pts li { margin-bottom: .08em; }
.blk { margin-bottom: 11px; }
.callout { padding: 6px 9px; }
` : ''}
`;
  }

  return { open, close, SECTIONS, TEMPLATES };
})();
