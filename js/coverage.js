/* ============================================================
   coverage.js — the two coverage maps.

   The mastery map answers "how WELL am I doing?". These answer the
   other half: "how MUCH of the ground have I actually walked?"

     • SYLLABUS coverage — the curriculum as taught. Sections
       (Early Pregnancy, Labour & Delivery…) are the cards; the
       topics beneath them are the drill-down.
     • BLUEPRINT coverage — the exam as sampled. Buckets are the
       cards; the blueprint's `specific_areas` are the drill-down.

   Deliberate arithmetic (this is the part people get wrong):
     – a TOPIC / AREA percentage is question-based: answered ÷ available.
     – a SECTION / BUCKET percentage is the MEAN of its children, NOT
       its pooled question count. Otherwise one 500-question topic
       drowns out nine small ones and a card reads 90% while nine
       topics sit untouched. Equal weight per child keeps a card
       honest: it can only be green when the whole area is green.

   Every number is derived from data already stored (published papers
   → syllabus path; attempts + mock results → answered question keys),
   so no new writes are needed for history. Going forward the simulator
   also stamps the blueprint area onto each question it serves, so the
   blueprint side stops depending on keyword inference.
   ============================================================ */

const Coverage = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const IDX_KEY = 'coverage-index';
  const IDX_TTL = 30 * 60 * 1000;

  /* ---------------- area matching (shared with the selector) ---------------- */

  const norm = s => (typeof Blueprint !== 'undefined' ? Blueprint.normStr(s)
    : String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  /** Significant words; short acronyms (HIV, DSD, LSCS) ARE the topic. */
  function areaWords(a) {
    const all = norm(a).split(' ').filter(Boolean);
    const long = all.filter(w => w.length > 4);
    return long.length ? long : all.filter(w => w.length >= 3);
  }
  const sameish = (a, b) => { a = norm(a); b = norm(b); return a && b && (a === b || a.includes(b) || b.includes(a)); };

  /* ---------------- the index ---------------- */

  /**
   * qkey → { paperId, categoryId, sectionId, topicId, kind, tokens }
   * Built from every published paper, so it knows the whole bank, not
   * just what the user has touched. Cached like the simulator's index.
   */
  async function buildIndex(force) {
    if (force && typeof Cache !== 'undefined') Cache.bust(IDX_KEY);
    const loader = async () => {
      const [papers] = await Promise.all([Data.publishedPapers()]);
      // the index covers every question in the bank, so pull the content once
      // rather than issuing one request per paper
      await Data.primeContent();
      let tags = {};
      try { ((await Backend.listQuestionTags?.()) || []).forEach(t => tags[t.questionKey] = t); } catch {}
      const rows = [];
      for (const p of papers) {
        let loaded; try { loaded = await Data.loadPaper(p.id); } catch { continue; }
        for (const kind of ['SBA', 'EMQ']) {
          for (const q of Data.flatten(loaded.paper, kind)) {
            const qkey = `${p.id}:${kind}:${q.number}`;
            const tg = tags[qkey];
            const text = norm([tg?.topic, tg?.category, ...(tg?.tags || []), q.theme, q.stem, q.lead,
              (q.rationale || '').slice(0, 160)].filter(Boolean).join(' '));
            rows.push({
              qkey, kind, paperId: p.id,
              categoryId: p.categoryId || '', sectionId: p.sectionId || '', topicId: p.topicId || '',
              category: loaded.paper.category || '', tagTopic: tg?.topic || '',
              tokens: new Set(text.split(' ').filter(Boolean)), text
            });
          }
        }
      }
      return rows;
    };
    // Sets don't survive the cache's JSON round-trip — rehydrate after read.
    const raw = (typeof Cache !== 'undefined')
      ? await Cache.wrap(IDX_KEY, IDX_TTL, async () => (await loader()).map(r => ({ ...r, tokens: [...r.tokens] })))
      : (await loader()).map(r => ({ ...r, tokens: [...r.tokens] }));
    return raw.map(r => ({ ...r, tokens: r.tokens instanceof Set ? r.tokens : new Set(r.tokens) }));
  }

  /* ---------------- what the user has answered ---------------- */

  /**
   * Every question this user has actually attempted, from BOTH sources:
   * library attempts and simulator mocks. Unanswered questions in a
   * finished paper don't count as covered — you didn't engage with them.
   */
  async function attempted() {
    const seen = new Set(), correct = new Set();
    const take = detail => (detail || []).forEach(d => {
      if (!d.qkey || d.chosen == null) return;
      seen.add(d.qkey);
      if (d.isCorrect) correct.add(d.qkey);
    });
    try { ((await Backend.getProgress())?.attempts || []).forEach(a => take(a.detail)); } catch {}
    try { ((await Backend.listMockResults?.()) || []).forEach(m => take(m.detail)); } catch {}
    return { seen, correct };
  }

  const pct = (done, total) => total > 0 ? Math.round((done / total) * 100) : 0;
  /** Mean of children — see the header note on why this is not pooled. */
  const meanPct = kids => kids.length ? Math.round(kids.reduce((s, k) => s + k.pct, 0) / kids.length) : 0;
  const band = p => p >= 70 ? 'ok' : p >= 35 ? 'mid' : p > 0 ? 'low' : 'none';

  /* ---------------- syllabus view ---------------- */

  async function syllabusView(index, prog) {
    const syl = await Data.loadSyllabus();
    const byTopic = {};
    index.forEach(r => { if (r.topicId) (byTopic[r.topicId] || (byTopic[r.topicId] = [])).push(r); });
    const out = [];
    for (const cat of (syl.categories || [])) {
      for (const sec of (cat.sections || [])) {
        const topics = (sec.topics || []).map(t => {
          const qs = byTopic[t.id] || [];
          const done = qs.filter(q => prog.seen.has(q.qkey)).length;
          const right = qs.filter(q => prog.correct.has(q.qkey)).length;
          return { id: t.id, title: t.title, total: qs.length, done, remaining: qs.length - done,
                   correct: right, pct: pct(done, qs.length), accuracy: done ? Math.round((right / done) * 100) : null };
        });
        const live = topics.filter(t => t.total > 0);       // a topic with no questions can't be "covered"
        if (!live.length) continue;
        out.push({
          id: sec.id, title: sec.title, category: cat.title, categoryId: cat.id,
          topics: topics.sort((a, b) => a.pct - b.pct || b.total - a.total),
          pct: meanPct(live),
          started: live.filter(t => t.done > 0).length, topicCount: live.length,
          totalQ: live.reduce((s, t) => s + t.total, 0),
          doneQ: live.reduce((s, t) => s + t.done, 0)
        });
      }
    }
    return out.sort((a, b) => a.pct - b.pct);
  }

  /* ---------------- blueprint view ---------------- */

  /** Questions matching one specific area, inside its bucket's pool. */
  function areaMatches(pool, area) {
    const w = areaWords(area);
    if (!w.length) return [];
    return pool.filter(r => w.some(x => r.tokens.has(x)));
  }
  function bucketPool(index, b, kind) {
    const byKind = index.filter(r => r.kind === kind);
    if (kind === 'SBA' && b.category) {
      const gated = byKind.filter(r => sameish(r.category, b.category));
      if (gated.length) return gated;
    }
    return byKind;
  }

  function blueprintView(index, prog, bp) {
    const build = (buckets, kind, keyOf) => buckets.map(b => {
      const name = keyOf(b);
      const pool = bucketPool(index, b, kind);
      const areas = (b.areas || []).map(a => {
        const qs = areaMatches(pool, a);
        const done = qs.filter(q => prog.seen.has(q.qkey)).length;
        const right = qs.filter(q => prog.correct.has(q.qkey)).length;
        return { area: a, total: qs.length, done, remaining: qs.length - done,
                 correct: right, pct: pct(done, qs.length), accuracy: done ? Math.round((right / done) * 100) : null };
      });
      const live = areas.filter(a => a.total > 0);
      // a bucket with no declared areas falls back to its own question pool
      const fallback = () => { const done = pool.filter(q => prog.seen.has(q.qkey)).length; return pct(done, pool.length); };
      return {
        name, kind, weight: b.weight || 0,
        areas: areas.sort((x, y) => x.pct - y.pct || y.total - x.total),
        pct: live.length ? meanPct(live) : fallback(),
        started: live.filter(a => a.done > 0).length, areaCount: live.length,
        totalQ: pool.length, doneQ: pool.filter(q => prog.seen.has(q.qkey)).length
      };
    });
    return [
      ...build(bp.sba || [], 'SBA', b => b.subcategory || b.category),
      ...build(bp.emq || [], 'EMQ', b => b.theme)
    ].sort((a, b) => a.pct - b.pct);
  }

  /* ---------------- shared UI: cards + modal ---------------- */

  function cardHTML(c, i, sub) {
    return `<button class="cov-card cov-${band(c.pct)}" data-ci="${i}">
      <span class="cov-ring" style="--p:${c.pct}"><span>${c.pct}<i>%</i></span></span>
      <span class="cov-card-main">
        <span class="cov-card-title">${esc(c.title || c.name)}</span>
        <span class="cov-card-sub">${sub(c)}</span>
      </span>
      <span class="cov-bar"><i style="width:${c.pct}%"></i></span>
    </button>`;
  }

  function openModal(title, kicker, bodyHTML) {
    document.querySelector('.cov-modal')?.remove();
    const m = document.createElement('div');
    m.className = 'cov-modal';
    m.innerHTML = `<div class="cov-sheet" role="dialog" aria-modal="true">
        <header class="cov-sheet-head">
          <div><p class="kicker">${esc(kicker)}</p><h3>${esc(title)}</h3></div>
          <button class="cov-x" aria-label="Close">✕</button>
        </header>
        <div class="cov-sheet-body">${bodyHTML}</div>
      </div>`;
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('keydown', onEsc); };
    const onEsc = e => { if (e.key === 'Escape') close(); };
    m.querySelector('.cov-x').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.addEventListener('keydown', onEsc);
    requestAnimationFrame(() => m.classList.add('is-open'));
    return m;
  }

  /** One row per child (topic or specific area). */
  function rowsHTML(kids, labelKey) {
    if (!kids.length) return `<p class="muted">Nothing indexed here yet.</p>`;
    return `<div class="cov-rows">${kids.map(k => `
      <div class="cov-row cov-${band(k.pct)}">
        <div class="cov-row-top">
          <span class="cov-row-name">${esc(k[labelKey])}</span>
          <span class="cov-row-pct">${k.total ? k.pct + '%' : '<span class="muted">no questions</span>'}</span>
        </div>
        <div class="cov-row-bar"><i style="width:${k.pct}%"></i></div>
        <div class="cov-row-meta">
          <span><b>${k.done}</b> done</span>
          <span><b>${k.remaining}</b> remaining</span>
          <span class="muted">${k.total} total</span>
          ${k.accuracy != null ? `<span class="cov-acc ${k.accuracy >= 70 ? 'good' : k.accuracy < 50 ? 'bad' : ''}">${k.accuracy}% correct</span>` : ''}
        </div>
      </div>`).join('')}</div>`;
  }

  function legendHTML() {
    return `<div class="cov-legend">
      <span><i class="cov-dot cov-none"></i>Untouched</span>
      <span><i class="cov-dot cov-low"></i>&lt;35%</span>
      <span><i class="cov-dot cov-mid"></i>35–69%</span>
      <span><i class="cov-dot cov-ok"></i>≥70%</span>
    </div>`;
  }

  /* ---------------- public renderers ---------------- */

  async function renderSyllabusMap(host) {
    host.innerHTML = `<div class="card cov-card-wrap" data-animate><h3 class="card-title">🗺 Syllabus coverage map</h3><p class="muted">Building…</p></div>`;
    let index, prog, view;
    try {
      [index, prog] = await Promise.all([buildIndex(), attempted()]);
      view = await syllabusView(index, prog);
    } catch { host.innerHTML = ''; return; }
    if (!view.length) { host.innerHTML = ''; return; }
    const overall = meanPct(view);
    host.innerHTML = `
      <div class="card cov-card-wrap" data-animate>
        <div class="cov-head">
          <div>
            <h3 class="card-title">🗺 Syllabus coverage map</h3>
            <p class="muted">How much of the curriculum you have actually worked through. A section's figure is the
              <strong>average of its topics</strong>, not its question total — so a card only turns green when the whole
              area does. Tap any card for the topics beneath it.</p>
          </div>
          <div class="cov-overall"><strong>${overall}%</strong><span>syllabus covered</span></div>
        </div>
        ${legendHTML()}
        <div class="cov-grid" id="cov-syl"></div>
      </div>`;
    const grid = host.querySelector('#cov-syl');
    grid.innerHTML = view.map((s, i) => cardHTML(s, i, c => `${c.started}/${c.topicCount} topics · ${c.doneQ}/${c.totalQ} Q`)).join('');
    grid.addEventListener('click', e => {
      const b = e.target.closest('[data-ci]'); if (!b) return;
      const s = view[Number(b.dataset.ci)];
      openModal(s.title, `${s.category} · ${s.pct}% covered · ${s.started}/${s.topicCount} topics started`,
        rowsHTML(s.topics, 'title'));
    });
  }

  async function renderBlueprintMap(host) {
    host.innerHTML = `<div class="card cov-card-wrap" data-animate><h3 class="card-title">🎯 Blueprint coverage map</h3><p class="muted">Building…</p></div>`;
    let index, prog, bp, view;
    try {
      [index, prog, bp] = await Promise.all([buildIndex(), attempted(), Blueprint.load()]);
      view = blueprintView(index, prog, bp);
    } catch { host.innerHTML = ''; return; }
    if (!view.length) { host.innerHTML = ''; return; }
    const overall = meanPct(view);
    host.innerHTML = `
      <div class="card cov-card-wrap" data-animate>
        <div class="cov-head">
          <div>
            <h3 class="card-title">🎯 Blueprint coverage map</h3>
            <p class="muted">The exam as it is actually sampled. Each bucket's figure is the <strong>average of its
              specific areas</strong> — the sub-topics the examiners rotate through — so a bucket can't look covered
              while half its areas are untouched. Tap a bucket to see them.</p>
          </div>
          <div class="cov-overall"><strong>${overall}%</strong><span>blueprint covered</span></div>
        </div>
        ${legendHTML()}
        <div class="cov-grid" id="cov-bp"></div>
      </div>`;
    const grid = host.querySelector('#cov-bp');
    grid.innerHTML = view.map((b, i) => cardHTML(b, i, c => `${c.kind} · w${c.weight} · ${c.started}/${c.areaCount} areas`)).join('');
    grid.addEventListener('click', e => {
      const el = e.target.closest('[data-ci]'); if (!el) return;
      const b = view[Number(el.dataset.ci)];
      openModal(b.name, `${b.kind} · weight ${b.weight} · ${b.pct}% covered · ${b.started}/${b.areaCount} areas started`,
        rowsHTML(b.areas, 'area'));
    });
  }

  /* ---------------- paper preview support ----------------
     Used by the simulator's "coverage map for this paper": given the
     planned question records, say which bucket and which specific area
     each one lands in, and offer the alternatives inside that bucket. */

  /** Best-matching specific area for a question record within a bucket. */
  function areaFor(rec, bucketDef) {
    let best = null, bestScore = 0;
    for (const a of (bucketDef?.areas || [])) {
      const w = areaWords(a);
      const hits = w.filter(x => rec.tokens?.has(x) || (rec.text || '').includes(x)).length;
      if (hits > bestScore) { bestScore = hits; best = a; }
    }
    return best;
  }

  function bucketDefs(bp) {
    const m = new Map();
    (bp.sba || []).forEach(b => m.set(b.subcategory || b.category, { ...b, kind: 'SBA' }));
    (bp.emq || []).forEach(b => m.set(b.theme, { ...b, kind: 'EMQ' }));
    return m;
  }

  return {
    buildIndex, attempted, syllabusView, blueprintView,
    renderSyllabusMap, renderBlueprintMap,
    areaFor, areaMatches, bucketPool, bucketDefs, areaWords, openModal, band, pct, meanPct, legendHTML
  };
})();
