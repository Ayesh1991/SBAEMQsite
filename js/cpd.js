/* ============================================================
   cpd.js — the CPD section (TOG true/false self-assessment).

   Source JSON is `ogr-cpd-v1`: a VOLUME holds several topics
   ("sections"), each holding true/false questions carrying an
   answer, a rationale and a memory hook.

   The reading model is deliberately unlike the SBA runner. A CPD
   set is not an exam — it is a self-check you work through at your
   own pace — so each question resolves the moment you answer it:
   the verdict, the rationale and the hook open in place, and the
   next card is already there. Nothing is hidden behind a "submit",
   and nothing is lost if you wander off, because every answer is
   saved as it is given.

   Every question also carries the full AUREUM AI surface: the tutor
   (with provider choice), Search the web, and — for anyone running
   the AI ecosystem — Copy question, so the same claim can be put to
   an outside model cold.

   Access is doubly gated: the developer grants `cpd` per user, and
   the user then switches it on in their Profile. Only then does the
   tab appear in the Library.
   ============================================================ */

const CPD = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const VOL_KEY = 'cpd-volumes';
  const VOL_TTL = 15 * 60 * 1000;

  /* ---------------- data ---------------- */

  async function volumes() {
    const loader = () => Backend.getCpdVolumes().then(r => r || []);
    const list = (typeof Cache !== 'undefined') ? await Cache.wrap(VOL_KEY, VOL_TTL, loader) : await loader();
    // newest volume first; "Volume 23, Issue 1" sorts naturally on the numbers
    return list.slice().sort((a, b) => volOrder(b) - volOrder(a));
  }
  function bustVolumes() { if (typeof Cache !== 'undefined') Cache.bust(VOL_KEY); }
  function volOrder(v) {
    const m = String(v.volume || '').match(/(\d+)\D+(\d+)/);
    return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
  }
  const sectionsOf = v => v.sections || [];
  const questionsOf = s => s.questions || [];
  const qKey = (v, s, q) => `${v.id}:${s.id}:${q.id}`;

  function scoreOf(v, s, prog) {
    const qs = questionsOf(s);
    let done = 0, right = 0;
    qs.forEach(q => { const r = prog[qKey(v, s, q)]; if (r) { done++; if (r.correct) right++; } });
    return { total: qs.length, done, right, pct: done ? Math.round((right / done) * 100) : null };
  }
  function volumeScore(v, prog) {
    let total = 0, done = 0, right = 0;
    sectionsOf(v).forEach(s => { const x = scoreOf(v, s, prog); total += x.total; done += x.done; right += x.right; });
    return { total, done, right, pct: done ? Math.round((right / done) * 100) : null };
  }

  /* ================= volume list (#/library/cpd) ================= */

  async function renderList(view, user) {
    const shell = window.__aureumLibraryShell;
    view.innerHTML = shell('cpd', `<div id="cpd-body"><p class="muted">Loading CPD volumes…</p></div>`);
    FX.viewIn(view);
    const [list, prog] = await Promise.all([
      volumes().catch(() => []),
      Backend.getCpdProgress().catch(() => ({}))
    ]);
    const body = view.querySelector('#cpd-body');

    if (!list.length) {
      body.innerHTML = `
        <div class="card" data-animate>
          <h3 class="card-title">No CPD volumes yet</h3>
          <p class="muted">The site owner publishes TOG CPD question sets here. Each volume covers several topics of
            true/false self-assessment, with the reasoning and a memory hook behind every answer.</p>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div class="cpd-hero" data-animate>
        <div class="cpd-hero-glow" aria-hidden="true"></div>
        <p class="kicker">CONTINUING PROFESSIONAL DEVELOPMENT</p>
        <h1 class="page-title">CPD</h1>
        <p class="muted">True/false self-assessment from <em>The Obstetrician &amp; Gynaecologist</em>. Answer a statement and the
          verdict, the reasoning and the memory hook open straight away — no submit, nothing to lose. Every answer is saved as
          you give it.</p>
      </div>
      <div class="cpd-vols" data-animate>
        ${list.map(v => {
          const sc = volumeScore(v, prog);
          const secs = sectionsOf(v);
          return `
          <a class="cpd-vol" href="#/library/cpd/${encodeURIComponent(v.id)}">
            <div class="cpd-vol-ring" style="--p:${sc.total ? (sc.done / sc.total) * 100 : 0}">
              <span>${sc.total ? Math.round((sc.done / sc.total) * 100) : 0}<i>%</i></span>
            </div>
            <div class="cpd-vol-main">
              <h3>${esc(v.volume || v.id)}</h3>
              <p class="muted tiny">${esc(v.source || 'TOG CPD')}</p>
              <p class="cpd-vol-meta">${secs.length} topic${secs.length !== 1 ? 's' : ''} · ${sc.total} statements
                ${sc.done ? ` · <strong class="${sc.pct >= 70 ? 'good' : sc.pct >= 50 ? '' : 'bad'}">${sc.pct}% correct</strong>` : ''}</p>
            </div>
            <span class="cpd-vol-go">→</span>
          </a>`;
        }).join('')}
      </div>`;
  }

  /* ================= topics in a volume (#/library/cpd/:id) ================= */

  async function renderVolume(view, volumeId, user) {
    const shell = window.__aureumLibraryShell;
    const [list, prog] = await Promise.all([
      volumes().catch(() => []),
      Backend.getCpdProgress().catch(() => ({}))
    ]);
    const v = list.find(x => x.id === volumeId);
    if (!v) {
      view.innerHTML = shell('cpd', `<p class="muted">That volume is no longer published. <a class="link" href="#/library/cpd">Back to CPD</a></p>`);
      FX.viewIn(view); return;
    }
    const sc = volumeScore(v, prog);

    view.innerHTML = shell('cpd', `
      <a class="link muted dev-back" href="#/library/cpd">← CPD volumes</a>
      <header data-animate>
        <p class="kicker">${esc(v.subcategory || 'TOG CPD QUESTIONS')}</p>
        <h1 class="page-title">${esc(v.volume || v.id)}</h1>
        <p class="muted">${esc(v.source || '')}${v.doi ? ` · DOI ${esc(v.doi)}` : ''}</p>
        ${sc.done ? `<p class="cpd-vol-sum">${sc.done} of ${sc.total} answered ·
          <strong class="${sc.pct >= 70 ? 'good' : sc.pct >= 50 ? '' : 'bad'}">${sc.pct}% correct</strong></p>` : ''}
      </header>
      <div class="cpd-topics" data-animate>
        ${sectionsOf(v).map((s, i) => {
          const x = scoreOf(v, s, prog);
          const state = x.done === 0 ? 'fresh' : x.done < x.total ? 'part' : 'done';
          return `
          <a class="cpd-topic is-${state}" href="#/library/cpd/${encodeURIComponent(v.id)}/${encodeURIComponent(s.id)}">
            <span class="cpd-topic-n">${String(i + 1).padStart(2, '0')}</span>
            <span class="cpd-topic-main">
              <span class="cpd-topic-title">${esc(s.topic || s.id)}</span>
              ${s.folderTag ? `<span class="cpd-topic-tag">${esc(s.folderTag)}</span>` : ''}
              <span class="cpd-topic-bar"><i style="width:${x.total ? (x.done / x.total) * 100 : 0}%"></i></span>
            </span>
            <span class="cpd-topic-side">
              <span class="cpd-topic-count">${x.done}/${x.total}</span>
              ${x.done ? `<span class="cpd-topic-pct ${x.pct >= 70 ? 'good' : x.pct >= 50 ? '' : 'bad'}">${x.pct}%</span>`
                       : `<span class="muted tiny">not started</span>`}
            </span>
          </a>`;
        }).join('')}
      </div>`);
    FX.viewIn(view);
  }

  /* ================= the runner (#/library/cpd/:vol/:sec) ================= */

  async function renderTopic(view, volumeId, sectionId, user) {
    const [list, prog] = await Promise.all([
      volumes().catch(() => []),
      Backend.getCpdProgress().catch(() => ({}))
    ]);
    const v = list.find(x => x.id === volumeId);
    const s = v && sectionsOf(v).find(x => x.id === sectionId);
    if (!v || !s) {
      view.innerHTML = `<section class="page narrow"><p class="muted">That topic is no longer available.
        <a class="link" href="#/library/cpd">Back to CPD</a></p></section>`;
      FX.viewIn(view); return;
    }
    const qs = questionsOf(s);
    const answers = {};                                   // qid → { picked, correct }
    qs.forEach(q => { const r = prog[qKey(v, s, q)]; if (r) answers[q.id] = { picked: r.answer, correct: r.correct }; });

    view.innerHTML = `
      <section class="page cpd-run">
        <a class="link muted dev-back" href="#/library/cpd/${encodeURIComponent(v.id)}">← ${esc(v.volume || 'Volume')}</a>
        <header class="cpd-run-head" data-animate>
          <p class="kicker">${esc(v.volume || '')}${s.folderTag ? ' · ' + esc(s.folderTag) : ''}</p>
          <h1 class="page-title">${esc(s.topic || '')}</h1>
          <div class="cpd-meter">
            <div class="cpd-meter-bar"><i id="cpd-fill"></i></div>
            <p class="cpd-meter-txt" id="cpd-meter"></p>
            <button class="btn btn-ghost btn-sm" id="cpd-reset" title="Clear your answers for this topic and start again">↺ Start over</button>
          </div>
        </header>
        <div class="cpd-cards" id="cpd-cards"></div>
        <div class="cpd-done card" id="cpd-done" hidden></div>
      </section>`;

    const cardsEl = view.querySelector('#cpd-cards');
    cardsEl.innerHTML = qs.map((q, i) => cardHTML(q, i, answers[q.id])).join('');

    // one delegated listener on the persistent list — re-wiring per card on
    // every answer is how listener stacks are born
    cardsEl.addEventListener('click', async e => {
      const tf = e.target.closest('[data-tf]');
      if (tf) return answer(tf);
      const aiBtn = e.target.closest('[data-cpd-ai]');
      if (aiBtn) return toggleAi(aiBtn);
      const cp = e.target.closest('[data-cpd-copy]');
      if (cp) return copyOne(cp);
    });

    view.querySelector('#cpd-reset').addEventListener('click', async () => {
      if (!confirm('Clear your answers for this topic?')) return;
      try { await Backend.resetCpdSection(v.id, s.id); } catch {}
      Object.keys(answers).forEach(k => delete answers[k]);
      cardsEl.innerHTML = qs.map((q, i) => cardHTML(q, i, null)).join('');
      paintMeter();
    });

    paintMeter();
    FX.viewIn(view);

    /* ---- one card ---- */
    function cardHTML(q, i, state) {
      const shown = !!state;
      const right = state?.correct;
      const ecoOn = (typeof Ecosystem !== 'undefined' && Ecosystem.enabled());
      return `
        <article class="cpd-card ${shown ? (right ? 'is-right' : 'is-wrong') : ''}" data-q="${esc(q.id)}" data-animate>
          <div class="cpd-card-head">
            <span class="cpd-num">${String(i + 1).padStart(2, '0')}</span>
            ${shown ? `<span class="cpd-verdict ${right ? 'good' : 'bad'}">${right ? '✓ Correct' : '✗ Not quite'}</span>` : ''}
          </div>
          <p class="cpd-stem">${esc(q.stem)}</p>
          <div class="cpd-tf" role="group" aria-label="True or false">
            <button class="cpd-tf-btn cpd-true ${state && state.picked === true ? 'is-picked' : ''}"
              data-tf="true" data-qid="${esc(q.id)}" ${shown ? 'disabled' : ''}>TRUE</button>
            <button class="cpd-tf-btn cpd-false ${state && state.picked === false ? 'is-picked' : ''}"
              data-tf="false" data-qid="${esc(q.id)}" ${shown ? 'disabled' : ''}>FALSE</button>
          </div>
          <div class="cpd-reveal" ${shown ? '' : 'hidden'}>
            <p class="cpd-answer">The statement is <strong>${q.answer ? 'TRUE' : 'FALSE'}</strong>.</p>
            <div class="cpd-rationale">${esc(q.rationale || '')}</div>
            ${q.hook ? `<p class="cpd-hook"><span>💡</span>${esc(q.hook)}</p>` : ''}
            <div class="cpd-actions">
              <button class="btn btn-ghost btn-sm" data-cpd-ai data-qid="${esc(q.id)}">✨ Explore with AI</button>
              ${ecoOn ? `<button class="btn btn-ghost btn-sm" data-cpd-copy data-qid="${esc(q.id)}"
                title="Copy the statement as plain text — without the answer, reasoning or hook">📋 Copy question</button>` : ''}
            </div>
            <div class="cpd-ai" data-ai-host="${esc(q.id)}"></div>
          </div>
        </article>`;
    }

    /* ---- answering ---- */
    async function answer(btn) {
      const qid = btn.dataset.qid;
      const q = qs.find(x => x.id === qid); if (!q || answers[qid]) return;
      const picked = btn.dataset.tf === 'true';
      const correct = picked === !!q.answer;
      answers[qid] = { picked, correct };

      const card = btn.closest('.cpd-card');
      card.classList.add(correct ? 'is-right' : 'is-wrong');
      card.querySelectorAll('[data-tf]').forEach(b => {
        b.disabled = true;
        b.classList.toggle('is-picked', (b.dataset.tf === 'true') === picked);
      });
      const head = card.querySelector('.cpd-card-head');
      if (!head.querySelector('.cpd-verdict')) {
        const v2 = document.createElement('span');
        v2.className = 'cpd-verdict ' + (correct ? 'good' : 'bad');
        v2.textContent = correct ? '✓ Correct' : '✗ Not quite';
        head.appendChild(v2);
      }
      const rev = card.querySelector('.cpd-reveal');
      rev.hidden = false;
      if (typeof FX !== 'undefined') FX.viewIn?.(rev);

      paintMeter();
      try {
        await Backend.saveCpdAnswer({
          qkey: qKey(v, s, q), volume_id: v.id, section_id: s.id, answer: picked, correct
        });
      } catch { /* the answer is on screen either way; it re-saves next time */ }
      if (typeof Progression !== 'undefined' && correct) { try { await Backend.addXp?.(2); } catch {} }
    }

    /* ---- AI tutor, per card ---- */
    function toggleAi(btn) {
      const qid = btn.dataset.qid;
      const q = qs.find(x => x.id === qid); if (!q) return;
      const host = btn.closest('.cpd-card').querySelector(`[data-ai-host="${CSS.escape(qid)}"]`);
      if (host.dataset.open === '1') { host.dataset.open = '0'; host.innerHTML = ''; btn.classList.remove('is-on'); return; }
      host.dataset.open = '1'; btn.classList.add('is-on');
      if (typeof AI === 'undefined') return;
      // A true/false claim reads to the tutor as a two-option question whose
      // correct option is the truth value — so the usual explain/chat/web
      // machinery works unchanged.
      AI.attach(host, {
        questionKey: `cpd:${qKey(v, s, q)}`,
        kind: 'CPD', theme: s.topic || '', stem: q.stem, lead: 'True or false?',
        options: ['True', 'False'], answer: q.answer ? 0 : 1,
        chosen: answers[qid] ? (answers[qid].picked ? 0 : 1) : null,
        rationale: q.rationale || '', hook: q.hook || '',
        paperTitle: `${v.volume || 'CPD'} · ${s.topic || ''}`
      });
    }

    /* ---- copy for the outside models ---- */
    async function copyOne(btn) {
      const q = qs.find(x => x.id === btn.dataset.qid); if (!q) return;
      const ok = await Ecosystem.copyQuestion({
        theme: `${s.topic || ''} (CPD · true or false)`,
        stem: q.stem, lead: 'Is this statement true or false, and why?',
        options: ['True', 'False'], answer: q.answer ? 0 : 1
      });
      btn.textContent = ok ? '✓ Copied — paste it in' : '⚠ Press ⌘/Ctrl-C';
      btn.classList.toggle('is-done', ok);
      setTimeout(() => { if (btn.isConnected) { btn.textContent = '📋 Copy question'; btn.classList.remove('is-done'); } }, 2200);
    }

    /* ---- progress ---- */
    function paintMeter() {
      const done = Object.keys(answers).length;
      const right = Object.values(answers).filter(a => a.correct).length;
      const pct = done ? Math.round((right / done) * 100) : 0;
      const fill = view.querySelector('#cpd-fill');
      const txt = view.querySelector('#cpd-meter');
      if (fill) fill.style.width = (qs.length ? (done / qs.length) * 100 : 0) + '%';
      if (txt) txt.innerHTML = done
        ? `<strong>${done}</strong> of ${qs.length} answered · <strong class="${pct >= 70 ? 'good' : pct >= 50 ? '' : 'bad'}">${pct}%</strong> correct`
        : `${qs.length} statements · answer one to begin`;
      const doneEl = view.querySelector('#cpd-done');
      if (!doneEl) return;
      if (done === qs.length && qs.length) {
        doneEl.hidden = false;
        doneEl.innerHTML = `
          <div class="cpd-done-ring ${pct >= 70 ? 'good' : pct >= 50 ? '' : 'bad'}">${pct}<i>%</i></div>
          <h2>Topic complete</h2>
          <p class="muted">${right} of ${qs.length} correct. The ones you missed are worth a second read — their memory hooks
            are the fastest way to make them stick.</p>
          <div class="cpd-done-acts">
            <a class="btn btn-gold" href="#/library/cpd/${encodeURIComponent(v.id)}">Back to the volume</a>
            <button class="btn btn-ghost" id="cpd-again">↺ Start over</button>
          </div>`;
        doneEl.querySelector('#cpd-again').addEventListener('click', () => view.querySelector('#cpd-reset').click());
      } else { doneEl.hidden = true; doneEl.innerHTML = ''; }
    }
  }

  return { renderList, renderVolume, renderTopic, volumes, bustVolumes, sectionsOf, questionsOf };
})();
