/* ============================================================
   cpd.js — the CPD section (TOG true/false self-assessment).

   Source JSON is `ogr-cpd-v1` or `ogr-cpd-v2`: a VOLUME holds several
   topics ("sections"), each holding questions with a rationale and a
   memory hook. v1 is entirely true/false. v2 tags each question with
   `qtype` and mixes in single-best-answer items, which carry their
   own lettered options and answer key — the later TOG issues do this,
   usually as a separate SBA section per topic. Both render here.

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

  /* ogr-cpd-v2 mixes true/false and single-best-answer questions in one
     volume, tagged by `qtype`. v1 files have no tag and are all true/false,
     so an absent tag means TF. Everything below branches on this one call. */
  const isSBA = q => String(q.qtype || 'TF').toUpperCase() === 'SBA';
  const optionsOf = q => (q.options || []).map((o, i) =>
    typeof o === 'string' ? { key: String.fromCharCode(65 + i), text: o } : o);
  /** The pick, as stored: 'true'/'false' for TF, the option key for SBA. */
  const choiceOf = row => row ? (row.choice != null ? String(row.choice) : String(row.answer)) : null;
  const isRight = (q, choice) => isSBA(q)
    ? String(choice).toUpperCase() === String(q.answer).toUpperCase()
    : (String(choice) === 'true') === !!q.answer;
  /** What the section is made of — used for the badge on the topic row. */
  function kindOf(sec) {
    const qs = questionsOf(sec);
    const sba = qs.filter(isSBA).length;
    if (!qs.length) return '';
    if (sba === qs.length) return 'SBA';
    if (sba === 0) return 'True / false';
    return `${qs.length - sba} T/F · ${sba} SBA`;
  }

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
            true/false and single-best-answer self-assessment, with the reasoning and a memory hook behind every answer.</p>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div class="cpd-hero" data-animate>
        <div class="cpd-hero-glow" aria-hidden="true"></div>
        <p class="kicker">CONTINUING PROFESSIONAL DEVELOPMENT</p>
        <h1 class="page-title">CPD</h1>
        <p class="muted">Self-assessment from <em>The Obstetrician &amp; Gynaecologist</em> — true/false statements and, in the later
          issues, single-best-answer questions. Answer one and the verdict, the reasoning and the memory hook open straight
          away — no submit, nothing to lose. Every answer is saved as you give it.</p>
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
              <p class="cpd-vol-meta">${secs.length} topic${secs.length !== 1 ? 's' : ''} · ${sc.total} question${sc.total !== 1 ? 's' : ''}${
                (() => { const n = secs.reduce((m, x) => m + questionsOf(x).filter(isSBA).length, 0);
                  return n ? ` <span class="cpd-mix">incl. ${n} SBA</span>` : ''; })()}
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
              <span class="cpd-topic-tag">${s.folderTag ? esc(s.folderTag) + ' · ' : ''}${esc(kindOf(s))}</span>
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

  /* ================= the runner (#/library/cpd/:vol/:sec) =================

     Redesigned for reading speed. A TOG CPD paper does not ask five
     unrelated questions — it sets ONE lead-in and hangs five statements
     off it:

         With regard to the suboptimal intrauterine environment,
           1. around 20% of women in the UK are obese at booking.
           2. 1% of women globally experience gestational diabetes.

     The import repeats that lead-in inside every stem, so the old card
     list made you read the same twenty words five times over. The lead-in
     is now detected, printed ONCE as a group heading, and each statement
     is a single tight line with TRUE/FALSE at the end of it — the shape of
     the paper itself.

     Answering keeps its full feedback: verdict, rationale and memory hook
     open under the line. Nothing was removed to make it fast; the
     repetition was removed. "Detailed" restores the old roomy cards for
     anyone who prefers them, and the choice is remembered.

     Keys, because the mouse is the slow part: T/Y = true, F/N = false,
     1..9 = pick an option, ↑/↓ move, and focus jumps to the next
     unanswered line the moment you answer one.
     ======================================================================= */

  const DENS_KEY = 'aureum.cpd.density';
  const density = () => { try { return localStorage.getItem(DENS_KEY) === 'detailed' ? 'detailed' : 'rapid'; } catch { return 'rapid'; } };
  const setDensity = d => { try { localStorage.setItem(DENS_KEY, d); } catch {} };

  /* ---- find the lead-in shared by consecutive statements ---- */
  const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(0, i); };
  /* Trim a raw common prefix back to a point where it reads as a whole
     lead-in. The trailing space must be OPTIONAL: once a third statement
     joins a group the shared prefix is the previous lead-in itself, which
     ends exactly at the comma with nothing after it. Requiring a space there
     dropped the clause match and fell through to the cut-at-last-word rule,
     which chopped "…suboptimal intrauterine environment," back to
     "…suboptimal intrauterine" and pushed the noun into every statement. */
  function tidyLead(p) {
    if (!p) return '';
    const clause = p.match(/^(.*[,:;])(?:\s|$)/);      // "With regard to X," — the usual TOG shape
    if (clause && clause[1].length >= 16) return clause[1];
    const word = p.replace(/\s+\S*$/, '').trim();      // otherwise cut at the last whole word
    return word.length >= 20 ? word : '';
  }
  /** Group consecutive questions under the longest lead-in they all share. */
  function groupStems(qs) {
    const groups = [];
    qs.forEach(q => {
      const g = groups[groups.length - 1];
      if (g) {
        const lead = tidyLead(lcp(g.lead || g.qs[0].stem || '', q.stem || ''));
        if (lead) { g.lead = lead; g.qs.push(q); return; }
      }
      groups.push({ lead: '', qs: [q] });
    });
    // a lead-in over a single statement saves nothing, so drop it
    groups.forEach(g => { if (g.qs.length < 2) g.lead = ''; });
    return groups;
  }
  /** What is left of a stem once its group's lead-in is lifted off. */
  function tailOf(q, lead) {
    const s = String(q.stem || '');
    if (!lead || !s.startsWith(lead)) return s;
    return s.slice(lead.length).replace(/^[\s,;:]+/, '').trim() || s;
  }

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
    const groups = groupStems(qs);
    const numOf = {}; qs.forEach((q, i) => numOf[q.id] = i + 1);
    const answers = {};                                   // qid → { picked, correct }
    qs.forEach(q => { const r = prog[qKey(v, s, q)]; if (r) answers[q.id] = { picked: choiceOf(r), correct: r.correct }; });
    let dens = density();

    view.innerHTML = `
      <section class="page cpd-run cpd-d-${dens}">
        <a class="link muted dev-back" href="#/library/cpd/${encodeURIComponent(v.id)}">← ${esc(v.volume || 'Volume')}</a>
        <header class="cpd-run-head" data-animate>
          <p class="kicker">${esc(v.volume || '')}${s.folderTag ? ' · ' + esc(s.folderTag) : ''}</p>
          <h1 class="page-title">${esc(s.topic || '')}</h1>
          <div class="cpd-meter">
            <div class="cpd-meter-bar"><i id="cpd-fill"></i></div>
            <p class="cpd-meter-txt" id="cpd-meter"></p>
            <div class="cpd-dens" role="group" aria-label="Reading density">
              <button class="cpd-dens-b ${dens === 'rapid' ? 'active' : ''}" data-dens="rapid"
                title="One line a statement, lead-in shown once">⚡ Rapid</button>
              <button class="cpd-dens-b ${dens === 'detailed' ? 'active' : ''}" data-dens="detailed"
                title="Full cards, each statement written out in full">☰ Detailed</button>
            </div>
            <button class="btn btn-ghost btn-sm" id="cpd-reset" title="Clear your answers for this topic and start again">↺ Start over</button>
          </div>
          <p class="cpd-keys muted tiny">${groups.filter(g => g.lead).length
            ? `<strong>${groups.filter(g => g.lead).length}</strong> shared lead-in${groups.filter(g => g.lead).length === 1 ? '' : 's'} lifted out of ${qs.length} statements — read each one once. `
            : ''}Keys: <kbd>T</kbd>/<kbd>F</kbd> answer · <kbd>1</kbd>–<kbd>9</kbd> pick an option · <kbd>↑</kbd><kbd>↓</kbd> move.</p>
        </header>
        <div class="cpd-cards" id="cpd-cards"></div>
        <div class="cpd-done card" id="cpd-done" hidden></div>
        <div id="cpd-recap"></div>
      </section>`;

    const cardsEl = view.querySelector('#cpd-cards');
    paint();

    // one delegated listener on the persistent list — re-wiring per card on
    // every answer is how listener stacks are born
    cardsEl.addEventListener('click', async e => {
      const pick = e.target.closest('[data-pick]');
      if (pick) return answer(pick);
      const aiBtn = e.target.closest('[data-cpd-ai]');
      if (aiBtn) return toggleAi(aiBtn);
      const cp = e.target.closest('[data-cpd-copy]');
      if (cp) return copyOne(cp);
    });
    cardsEl.addEventListener('keydown', onKey);

    view.querySelector('.cpd-dens').addEventListener('click', e => {
      const b = e.target.closest('[data-dens]'); if (!b || b.dataset.dens === dens) return;
      dens = b.dataset.dens; setDensity(dens);
      view.querySelector('.cpd-run').className = `page cpd-run cpd-d-${dens}`;
      view.querySelectorAll('.cpd-dens-b').forEach(x => x.classList.toggle('active', x === b));
      paint(); paintMeter();
    });

    view.querySelector('#cpd-reset').addEventListener('click', async () => {
      if (!confirm('Clear your answers for this topic?')) return;
      try { await Backend.resetCpdSection(v.id, s.id); } catch {}
      Object.keys(answers).forEach(k => delete answers[k]);
      paint(); paintMeter();
    });

    paintMeter();
    FX.viewIn(view);

    function paint() {
      cardsEl.innerHTML = dens === 'rapid'
        ? groups.map(groupHTML).join('')
        : qs.map(q => cardHTML(q, numOf[q.id] - 1, answers[q.id])).join('');
    }

    /* ---------- rapid: a lead-in, then one line a statement ---------- */
    function groupHTML(g) {
      return `
        <section class="cpdr-group${g.lead ? ' has-lead' : ''}">
          ${g.lead ? `<p class="cpdr-lead">${esc(g.lead)}</p>` : ''}
          <div class="cpdr-rows">${g.qs.map(q => rowHTML(q, g.lead)).join('')}</div>
        </section>`;
    }
    function rowHTML(q, lead) {
      const state = answers[q.id];
      const shown = !!state, right = state?.correct, sba = isSBA(q);
      const opts = optionsOf(q);
      const key = String(q.answer).toUpperCase();
      const picks = sba
        ? `<div class="cpdr-opts">${opts.map((o, i) => {
            const k = String(o.key).toUpperCase();
            const isPick = shown && String(state.picked).toUpperCase() === k;
            const isKey = shown && k === key;
            return `<button class="cpdr-opt ${isKey ? 'is-key' : ''} ${isPick ? 'is-picked' : ''}"
              data-pick="${esc(o.key)}" data-qid="${esc(q.id)}" ${shown ? 'disabled' : ''}>
              <span class="cpdr-opt-k">${esc(o.key)}</span><span>${esc(o.text)}</span></button>`;
          }).join('')}</div>`
        : `<div class="cpdr-tf">
            <button class="cpdr-b cpdr-t ${shown && String(state.picked) === 'true' ? 'is-picked' : ''} ${shown && q.answer ? 'is-key' : ''}"
              data-pick="true" data-qid="${esc(q.id)}" ${shown ? 'disabled' : ''} title="True (T)">T</button>
            <button class="cpdr-b cpdr-f ${shown && String(state.picked) === 'false' ? 'is-picked' : ''} ${shown && !q.answer ? 'is-key' : ''}"
              data-pick="false" data-qid="${esc(q.id)}" ${shown ? 'disabled' : ''} title="False (F)">F</button>
          </div>`;
      return `
        <article class="cpdr-row ${sba ? 'is-sba' : ''} ${shown ? (right ? 'is-right' : 'is-wrong') : ''}"
          data-q="${esc(q.id)}" tabindex="0">
          <span class="cpdr-n">${String(numOf[q.id]).padStart(2, '0')}</span>
          <p class="cpdr-txt">${esc(tailOf(q, lead))}</p>
          ${sba ? '<span class="cpdr-sbatag">SBA</span>' : picks}
          <span class="cpdr-mark">${shown ? (right ? '✓' : '✗') : ''}</span>
          ${sba ? picks : ''}
          <div class="cpdr-why" ${shown ? '' : 'hidden'}>${whyHTML(q)}</div>
        </article>`;
    }
    /** The feedback block: verdict, reasoning, memory hook, AI. Same content in both densities. */
    function whyHTML(q) {
      const sba = isSBA(q);
      const opts = optionsOf(q);
      const key = String(q.answer).toUpperCase();
      const kOpt = opts.find(o => String(o.key).toUpperCase() === key);
      const ecoOn = (typeof Ecosystem !== 'undefined' && Ecosystem.enabled());
      const verdict = sba
        ? `The answer is <strong>${esc(key)}</strong>${kOpt ? ' — ' + esc(kOpt.text) : ''}.`
        : `The statement is <strong>${q.answer ? 'TRUE' : 'FALSE'}</strong>.`;
      return `
        <p class="cpd-answer">${verdict}</p>
        <div class="cpd-rationale">${esc(q.rationale || '')}</div>
        ${q.hook ? `<p class="cpd-hook"><span>💡</span>${esc(q.hook)}</p>` : ''}
        <div class="cpd-actions">
          <button class="btn btn-ghost btn-sm" data-cpd-ai data-qid="${esc(q.id)}">✨ Explore with AI</button>
          ${ecoOn ? `<button class="btn btn-ghost btn-sm" data-cpd-copy data-qid="${esc(q.id)}"
            title="Copy the statement as plain text — without the answer, reasoning or hook">📋 Copy question</button>` : ''}
        </div>
        <div class="cpd-ai" data-ai-host="${esc(q.id)}"></div>`;
    }

    /* ---------- detailed: the roomy card ---------- */
    function cardHTML(q, i, state) {
      const shown = !!state, right = state?.correct, sba = isSBA(q);
      const opts = optionsOf(q);
      const correctKey = String(q.answer).toUpperCase();
      const picks = sba
        ? `<div class="cpd-opts" role="group" aria-label="Single best answer">
            ${opts.map(o => {
              const k = String(o.key).toUpperCase();
              const isPick = shown && String(state.picked).toUpperCase() === k;
              const isKey = shown && k === correctKey;
              return `<button class="cpd-opt ${isKey ? 'is-key' : ''} ${isPick ? 'is-picked' : ''}"
                data-pick="${esc(o.key)}" data-qid="${esc(q.id)}" ${shown ? 'disabled' : ''}>
                <span class="cpd-opt-key">${esc(o.key)}</span>
                <span class="cpd-opt-txt">${esc(o.text)}</span>
                ${isKey ? '<span class="cpd-opt-mark good">✓</span>' : isPick ? '<span class="cpd-opt-mark bad">✗</span>' : ''}
              </button>`;
            }).join('')}
          </div>`
        : `<div class="cpd-tf" role="group" aria-label="True or false">
            <button class="cpd-tf-btn cpd-true ${shown && String(state.picked) === 'true' ? 'is-picked' : ''}"
              data-pick="true" data-qid="${esc(q.id)}" ${shown ? 'disabled' : ''}>TRUE</button>
            <button class="cpd-tf-btn cpd-false ${shown && String(state.picked) === 'false' ? 'is-picked' : ''}"
              data-pick="false" data-qid="${esc(q.id)}" ${shown ? 'disabled' : ''}>FALSE</button>
          </div>`;
      return `
        <article class="cpd-card ${sba ? 'is-sba' : ''} ${shown ? (right ? 'is-right' : 'is-wrong') : ''}"
          data-q="${esc(q.id)}" tabindex="0" data-animate>
          <div class="cpd-card-head">
            <span class="cpd-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="cpd-type">${sba ? 'SBA' : 'True / false'}</span>
            ${shown ? `<span class="cpd-verdict ${right ? 'good' : 'bad'}">${right ? '✓ Correct' : '✗ Not quite'}</span>` : ''}
          </div>
          <p class="cpd-stem">${esc(q.stem)}</p>
          ${picks}
          <div class="cpd-reveal" ${shown ? '' : 'hidden'}>${whyHTML(q)}</div>
        </article>`;
    }

    /* ---------- keys: the mouse is the slow part ---------- */
    function onKey(e) {
      const row = e.target.closest('.cpdr-row, .cpd-card');
      if (!row || e.metaKey || e.ctrlKey || e.altKey) return;
      const qid = row.dataset.q;
      const q = qs.find(x => x.id === qid); if (!q) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowdown' || k === 'arrowup') {
        e.preventDefault();
        const all = [...cardsEl.querySelectorAll('.cpdr-row, .cpd-card')];
        const n = all[all.indexOf(row) + (k === 'arrowdown' ? 1 : -1)];
        if (n) { n.focus(); n.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      if (answers[qid]) return;
      let sel = null;
      if (!isSBA(q) && (k === 't' || k === 'y')) sel = 'true';
      else if (!isSBA(q) && (k === 'f' || k === 'n')) sel = 'false';
      else if (isSBA(q) && /^[1-9]$/.test(k)) {
        const o = optionsOf(q)[Number(k) - 1]; if (o) sel = String(o.key);
      } else if (isSBA(q) && /^[a-z]$/.test(k)) {
        const o = optionsOf(q).find(x => String(x.key).toLowerCase() === k); if (o) sel = String(o.key);
      }
      if (!sel) return;
      e.preventDefault();
      const btn = row.querySelector(`[data-pick="${CSS.escape(sel)}"]`);
      if (btn) answer(btn);
    }

    /* ---------- answering ---------- */
    async function answer(btn) {
      const qid = btn.dataset.qid;
      const q = qs.find(x => x.id === qid); if (!q || answers[qid]) return;
      const picked = btn.dataset.pick;                 // 'true'/'false' or an option key
      const correct = isRight(q, picked);
      answers[qid] = { picked, correct };

      const row = btn.closest('.cpdr-row, .cpd-card');
      row.classList.add(correct ? 'is-right' : 'is-wrong');
      const key = String(q.answer).toUpperCase();
      row.querySelectorAll('[data-pick]').forEach(b => {
        b.disabled = true;
        const val = b.dataset.pick;
        b.classList.toggle('is-picked', val === picked);
        const isKey = isSBA(q) ? String(val).toUpperCase() === key : (val === 'true') === !!q.answer;
        b.classList.toggle('is-key', isKey);
        // mark the right one and a wrong pick, the way a paper is marked
        if (b.classList.contains('cpd-opt') && (isKey || val === picked) && !b.querySelector('.cpd-opt-mark')) {
          const m = document.createElement('span');
          m.className = 'cpd-opt-mark ' + (isKey ? 'good' : 'bad');
          m.textContent = isKey ? '✓' : '✗';
          b.appendChild(m);
        }
      });
      const tick = row.querySelector('.cpdr-mark');
      if (tick) tick.textContent = correct ? '✓' : '✗';
      const head = row.querySelector('.cpd-card-head');
      if (head && !head.querySelector('.cpd-verdict')) {
        const el = document.createElement('span');
        el.className = 'cpd-verdict ' + (correct ? 'good' : 'bad');
        el.textContent = correct ? '✓ Correct' : '✗ Not quite';
        head.appendChild(el);
      }
      const rev = row.querySelector('.cpdr-why, .cpd-reveal');
      if (rev) { rev.innerHTML = whyHTML(q); rev.hidden = false; }

      // straight on to the next thing you have not answered
      const all = [...cardsEl.querySelectorAll('.cpdr-row, .cpd-card')];
      const next = all.slice(all.indexOf(row) + 1).find(r => !answers[r.dataset.q]);
      if (next && document.activeElement !== document.body) next.focus({ preventScroll: true });

      paintMeter();
      try {
        await Backend.saveCpdAnswer({
          qkey: qKey(v, s, q), volume_id: v.id, section_id: s.id,
          // `answer` stays boolean for true/false so older rows and any code
          // reading it keep working; `choice` is the general record
          answer: isSBA(q) ? null : (picked === 'true'),
          choice: String(picked), correct
        });
      } catch { /* the answer is on screen either way; it re-saves next time */ }
      if (typeof Progression !== 'undefined' && correct) { try { await Backend.addXp?.(2); } catch {} }
    }

    /* ---------- AI tutor, per question ---------- */
    function toggleAi(btn) {
      const qid = btn.dataset.qid;
      const q = qs.find(x => x.id === qid); if (!q) return;
      const host = btn.closest('.cpdr-row, .cpd-card').querySelector(`[data-ai-host="${CSS.escape(qid)}"]`);
      if (host.dataset.open === '1') { host.dataset.open = '0'; host.innerHTML = ''; btn.classList.remove('is-on'); return; }
      host.dataset.open = '1'; btn.classList.add('is-on');
      if (typeof AI === 'undefined') return;
      // A true/false claim reads to the tutor as a two-option question whose
      // correct option is the truth value — so the usual explain/chat/web
      // machinery works unchanged.
      const opts = optionsOf(q);
      const sba = isSBA(q);
      const keyIdx = sba ? Math.max(0, opts.findIndex(o => String(o.key).toUpperCase() === String(q.answer).toUpperCase()))
                         : (q.answer ? 0 : 1);
      const pickIdx = answers[qid]
        ? (sba ? opts.findIndex(o => String(o.key).toUpperCase() === String(answers[qid].picked).toUpperCase())
               : (String(answers[qid].picked) === 'true' ? 0 : 1))
        : null;
      AI.attach(host, {
        questionKey: `cpd:${qKey(v, s, q)}`,
        kind: sba ? 'SBA' : 'CPD', theme: s.topic || '', stem: q.stem,
        lead: sba ? 'Which is the single best answer?' : 'True or false?',
        options: sba ? opts.map(o => o.text) : ['True', 'False'],
        answer: keyIdx, chosen: pickIdx != null && pickIdx >= 0 ? pickIdx : null,
        rationale: q.rationale || '', hook: q.hook || '',
        paperTitle: `${v.volume || 'CPD'} · ${s.topic || ''}`
      });
    }

    /* ---------- copy for the outside models ---------- */
    async function copyOne(btn) {
      const q = qs.find(x => x.id === btn.dataset.qid); if (!q) return;
      const sba = isSBA(q);
      const opts = optionsOf(q);
      const ok = await Ecosystem.copyQuestion({
        theme: `${s.topic || ''} (CPD · ${sba ? 'single best answer' : 'true or false'})`,
        stem: q.stem,
        lead: sba ? 'Which is the single best answer, and why?' : 'Is this statement true or false, and why?',
        // the option letters are already in the source, so keep them verbatim
        options: sba ? opts.map(o => `${o.key}. ${o.text}`) : ['True', 'False'],
        preLettered: sba, answer: 0
      });
      btn.textContent = ok ? '✓ Copied — paste it in' : '⚠ Press ⌘/Ctrl-C';
      btn.classList.toggle('is-done', ok);
      setTimeout(() => { if (btn.isConnected) { btn.textContent = '📋 Copy question'; btn.classList.remove('is-done'); } }, 2200);
    }

    /* ---------- progress, and the one-pass recap ---------- */
    function paintMeter() {
      const done = Object.keys(answers).length;
      const right = Object.values(answers).filter(a => a.correct).length;
      const pct = done ? Math.round((right / done) * 100) : 0;
      const fill = view.querySelector('#cpd-fill');
      const txt = view.querySelector('#cpd-meter');
      if (fill) fill.style.width = (qs.length ? (done / qs.length) * 100 : 0) + '%';
      if (txt) txt.innerHTML = done
        ? `<strong>${done}</strong> of ${qs.length} answered · <strong class="${pct >= 70 ? 'good' : pct >= 50 ? '' : 'bad'}">${pct}%</strong> correct`
        : `${qs.length} question${qs.length !== 1 ? 's' : ''} · answer one to begin`;
      const doneEl = view.querySelector('#cpd-done');
      const recapEl = view.querySelector('#cpd-recap');
      if (!doneEl) return;
      if (done === qs.length && qs.length) {
        doneEl.hidden = false;
        doneEl.innerHTML = `
          <div class="cpd-done-ring ${pct >= 70 ? 'good' : pct >= 50 ? '' : 'bad'}">${pct}<i>%</i></div>
          <h2>Topic complete</h2>
          <p class="muted">${right} of ${qs.length} correct. Everything worth carrying away is collected below — the ones you
            missed first, then every memory hook in one pass.</p>
          <div class="cpd-done-acts">
            <a class="btn btn-gold" href="#/library/cpd/${encodeURIComponent(v.id)}">Back to the volume</a>
            <button class="btn btn-ghost" id="cpd-again">↺ Start over</button>
          </div>`;
        doneEl.querySelector('#cpd-again').addEventListener('click', () => view.querySelector('#cpd-reset').click());
        if (recapEl) recapEl.innerHTML = recapHTML();
      } else {
        doneEl.hidden = true; doneEl.innerHTML = '';
        if (recapEl) recapEl.innerHTML = '';
      }
    }
    /* Re-reading the hooks one after another is the fastest revision this
       section can offer, so they are gathered here rather than left scattered
       one per card up the page. */
    function recapHTML() {
      const wrong = qs.filter(q => answers[q.id] && !answers[q.id].correct);
      const hooks = qs.filter(q => q.hook);
      const line = q => `
        <li>
          <span class="cpd-rc-n">${String(numOf[q.id]).padStart(2, '0')}</span>
          <span class="cpd-rc-body">
            <span class="cpd-rc-stem">${esc(q.stem)}</span>
            <span class="cpd-rc-ans">${isSBA(q)
              ? 'Answer: ' + esc(String(q.answer).toUpperCase())
              : 'Answer: ' + (q.answer ? 'TRUE' : 'FALSE')}</span>
            ${q.hook ? `<span class="cpd-rc-hook">💡 ${esc(q.hook)}</span>` : ''}
          </span>
        </li>`;
      return `
        ${wrong.length ? `
        <div class="card cpd-recap is-wrong" data-animate>
          <h3 class="card-title">✗ The ${wrong.length} you missed</h3>
          <p class="muted tiny">Read these again now, while the reasoning is still fresh.</p>
          <ul class="cpd-rc-list">${wrong.map(line).join('')}</ul>
        </div>` : ''}
        ${hooks.length ? `
        <div class="card cpd-recap" data-animate>
          <h3 class="card-title">💡 Every memory hook, in one pass</h3>
          <p class="muted tiny">All ${hooks.length} hooks from this topic together — one screen, one read.</p>
          <ul class="cpd-hooks">${hooks.map(q => `<li><span class="cpd-rc-n">${String(numOf[q.id]).padStart(2, '0')}</span>${esc(q.hook)}</li>`).join('')}</ul>
        </div>` : ''}`;
    }
  }

  return { renderList, renderVolume, renderTopic, volumes, bustVolumes, sectionsOf, questionsOf };
})();
