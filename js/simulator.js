/* ============================================================
   simulator.js — the adaptive exam simulator (developer, exam-mode).

   What it does
     1. Builds a lightweight on-device INDEX of every published
        question (qkey, category, theme, a matching blob, a heuristic
        difficulty). Cached, so it downloads once — new papers become
        eligible automatically (the index rebuilds when papers change
        or on demand).
     2. SELECTS a 30-SBA + 30-EMQ mock shaped to the PGIM blueprint:
        weights → target counts, priority boosts, difficulty tuned to
        the candidate, and NO repeats of questions already seen.
        Selection is deterministic + a little randomness so each day
        differs; it never invents questions — it samples the vetted
        bank only.
     3. ADAPTS: each run's per-topic accuracy feeds the next day —
        weak buckets get more weight, difficulty tracks the candidate.
     4. Runs through the SAME quiz UI as the library, adds a "⚠ Flawed"
        control so below-standard questions are excluded from scoring,
        collects performance, and offers an AI coaching plan
        (Claude or Gemini).

   Only the YAML blueprint weights drive selection; medical content is
   never generated — Blueprint + this file only choose and score.
   ============================================================ */

const Simulator = (() => {
  const esc = Quiz.esc;
  const IDX_KEY = 'sim-qindex';
  const IDX_TTL = 30 * 60 * 1000;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let coachProvider = 'claude';   // dev default; the toggle changes it

  /* ---------------- question index ---------------- */

  function difficultyOf(q) {
    let d = 0.35;
    const stem = (q.stem || '') + ' ' + (q.lead || '');
    if (stem.length > 320) d += 0.15; else if (stem.length > 180) d += 0.07;
    const opts = (q.options || []).length;
    if (opts >= 8) d += 0.1; else if (opts >= 6) d += 0.05;
    if (/most appropriate|next best|best (investigation|management|step)|first-line|initial/i.test(stem)) d += 0.1;
    if ((q.rationale || '').length > 400) d += 0.08;
    if (/\b(rare|atypical|unusual|contraindicat)/i.test(stem + ' ' + (q.rationale || ''))) d += 0.05;
    return clamp(d, 0.1, 0.9);
  }

  async function buildIndex(force) {
    if (force && typeof Cache !== 'undefined') Cache.bust(IDX_KEY);
    const loader = async () => {
      const papers = await Data.publishedPapers();
      const recs = [];
      for (const p of papers) {
        let loaded;
        try { loaded = await Data.loadPaper(p.id); } catch { continue; }
        const paper = loaded.paper;
        const cat = paper.category || loaded.path.category?.title || '';
        const sub = paper.subcategory || loaded.path.topic?.title || '';
        Data.flatten(paper, 'SBA').forEach(q => recs.push(mk(p, q, 'SBA', cat, sub)));
        Data.flatten(paper, 'EMQ').forEach(q => recs.push(mk(p, q, 'EMQ', cat, q.theme || sub)));
      }
      return recs;
    };
    return (typeof Cache !== 'undefined') ? Cache.wrap(IDX_KEY, IDX_TTL, loader) : loader();
  }
  function mk(p, q, kind, category, group) {
    const text = [group, q.theme, q.stem, q.lead, (q.rationale || '').slice(0, 160)].filter(Boolean).join(' ');
    return { qkey: `${p.id}:${kind}:${q.number}`, paperId: p.id, paperTitle: p.title, number: q.number, kind, category, group, text, difficulty: difficultyOf(q) };
  }

  /* ---------------- empirical enrichment (stats + AI tags) ---------------- */

  const STATS_TTL = 10 * 60 * 1000;
  async function loadStats() {
    const loader = async () => {
      const rows = (Backend.listQuestionStats ? await Backend.listQuestionStats().catch(() => []) : []) || [];
      const map = {}; rows.forEach(r => map[r.questionKey] = r); return map;
    };
    return (typeof Cache !== 'undefined') ? Cache.wrap('sim-qstats', STATS_TTL, loader) : loader();
  }
  async function loadTags() {
    const loader = async () => {
      const rows = (Backend.listQuestionTags ? await Backend.listQuestionTags().catch(() => []) : []) || [];
      const map = {}; rows.forEach(r => map[r.questionKey] = r); return map;
    };
    return (typeof Cache !== 'undefined') ? Cache.wrap('sim-qtags', STATS_TTL, loader) : loader();
  }
  /**
   * Difficulty ladder: cohort-measured wrong-rate (once ≥5 attempts, weight
   * grows with evidence) > AI tagger's estimate > the text heuristic.
   * Tags also sharpen matching: the tagged topic/keywords join the match
   * text and carry an exact-topic marker used by the selector.
   */
  function enrich(index, stats, tags) {
    return index.map(r => {
      const out = { ...r };
      const tg = tags[r.qkey];
      if (tg) {
        out.tagTopic = tg.topic || '';
        out.text = [tg.topic, tg.category, ...(tg.tags || [])].filter(Boolean).join(' ') + ' ' + r.text;
        if (tg.difficulty != null) out.difficulty = clamp((r.difficulty + Number(tg.difficulty)) / 2, 0.1, 0.9);
      }
      const st = stats[r.qkey];
      if (st && st.attempts >= 5) {
        const empirical = clamp(1 - st.correct / st.attempts, 0.05, 0.95);
        const w = Math.min(1, st.attempts / 20);       // full trust at 20 attempts
        out.difficulty = clamp(out.difficulty * (1 - w) + empirical * w, 0.05, 0.95);
        out.attempts = st.attempts;
        out.avgTime = st.attempts ? st.totalTimeSec / st.attempts : 0;
      }
      return out;
    });
  }

  /* ---------------- history / adaptation ---------------- */

  async function loadHistory() {
    const mocks = (Backend.listMockResults ? await Backend.listMockResults().catch(() => []) : []) || [];
    const excludedArr = (Backend.listExcludedQuestions ? await Backend.listExcludedQuestions().catch(() => []) : []) || [];
    // questions flagged as wrong by ANYONE and not yet fixed by the developer
    // stay out of every new mock (see the Question review workshop)
    const flaggedArr = (Backend.listGlobalFlaggedKeys ? await Backend.listGlobalFlaggedKeys().catch(() => []) : []) || [];
    const excluded = new Set([...excludedArr, ...flaggedArr]);
    const seen = new Set();
    const bucketAgg = {};
    // Recency-decayed accuracy: a mock's evidence halves every 14 days, so
    // the weakness profile tracks the candidate you are NOW, not the one
    // who sat a paper two months ago.
    const HALF_LIFE_DAYS = 14;
    mocks.forEach(m => {
      (m.questionKeys || []).forEach(k => seen.add(k));
      const ageDays = Math.max(0, (Date.now() - new Date(m.date || Date.now()).getTime()) / 86400000);
      const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      for (const b in (m.buckets || {})) {
        const s = m.buckets[b]; const agg = bucketAgg[b] || (bucketAgg[b] = { seen: 0, correct: 0, rawSeen: 0 });
        agg.seen += (s.seen || 0) * w; agg.correct += (s.correct || 0) * w; agg.rawSeen += s.seen || 0;
      }
    });
    const recent = mocks.slice(0, 3);
    const acc = recent.length ? recent.reduce((a, m) => a + (m.percent || 0), 0) / recent.length / 100 : 0.5;
    return { seen, excluded, flagged: new Set(flaggedArr), bucketAgg, targetDifficulty: clamp(0.35 + acc * 0.4, 0.3, 0.8), mocks };
  }

  function perfFactor(label, hist) {
    const a = hist.bucketAgg[label];
    if (!a || (a.rawSeen || 0) < 3) return 1;       // not enough evidence yet
    const acc = a.seen > 0 ? a.correct / a.seen : 0.65;   // decayed = recent-you
    return clamp(1 + (0.65 - acc) * 0.8, 0.7, 1.5); // weaker topic → sampled more
  }

  /* ---------------- selection ---------------- */

  function select(bp, index, hist) {
    const rnd = () => Math.random();
    const avail = r => !hist.excluded.has(r.qkey);
    const unseen = r => !hist.seen.has(r.qkey);

    function pickForSection(kindWanted, buckets, keyOf, total) {
      const pool = index.filter(r => r.kind === kindWanted && avail(r));
      // adaptive weights → target counts
      const adj = buckets.map(b => ({ b, weight: b.weight * perfFactor(keyOf(b), hist) }));
      const counts = Blueprint.distribute(adj.map(x => ({ weight: x.weight })), total);
      const chosen = [];
      const used = new Set();

      // AI-tagged questions match their bucket EXACTLY (+4) — keyword
      // affinity is only the fallback for untagged questions.
      const tagHit = (b, r) => {
        if (!r.tagTopic) return 0;
        const t = Blueprint.normStr(r.tagTopic), k = Blueprint.normStr(keyOf(b));
        return t && k && (t === k || t.includes(k) || k.includes(t)) ? 4 : 0;
      };
      const scoreFor = (b, r) =>
        tagHit(b, r) +
        Blueprint.affinity(b.areas, keyOf(b), r.text) * 1.4 +
        (Blueprint.boostFor(bp, r.text) - 1) * 2 +
        (1 - Math.abs(r.difficulty - hist.targetDifficulty)) * 0.8 +
        rnd() * 0.7;

      buckets.forEach((b, bi) => {
        let need = counts[bi];
        if (need <= 0) return;
        // category-true candidates first (EMQ has no category gate → whole pool)
        const inCat = kindWanted === 'SBA' && b.category
          ? pool.filter(r => !used.has(r.qkey) && sameCat(r.category, b.category))
          : pool.filter(r => !used.has(r.qkey));
        const tiers = [inCat.filter(unseen), inCat, pool.filter(r => !used.has(r.qkey) && unseen(r)), pool.filter(r => !used.has(r.qkey))];
        for (const tier of tiers) {
          if (need <= 0) break;
          const ranked = tier.map(r => ({ r, s: scoreFor(b, r) })).sort((x, y) => y.s - x.s);
          for (const { r } of ranked) {
            if (need <= 0) break;
            if (used.has(r.qkey)) continue;
            used.add(r.qkey); chosen.push({ ...r, bucket: keyOf(b) }); need--;
          }
        }
      });
      // top up if any bucket was starved
      if (chosen.length < total) {
        const rest = pool.filter(r => !used.has(r.qkey)).sort((a, c) => (unseen(c) - unseen(a)) || (rnd() - 0.5));
        for (const r of rest) { if (chosen.length >= total) break; used.add(r.qkey); chosen.push({ ...r, bucket: r.group || r.category || 'General' }); }
      }
      return chosen.slice(0, total);
    }

    const sbaRecs = pickForSection('SBA', bp.sba, b => b.subcategory || b.category, bp.paper.sbaCount || 30);
    const emqRecs = pickForSection('EMQ', bp.emq, b => b.theme, bp.paper.emqCount || 30);
    return { sbaRecs, emqRecs };
  }
  function sameCat(a, b) { a = Blueprint.normStr(a); b = Blueprint.normStr(b); return a && b && (a === b || a.includes(b) || b.includes(a)); }

  /* ---------------- resolve records → full questions ---------------- */

  async function resolve(recs) {
    const byPaper = {};
    recs.forEach(r => (byPaper[r.paperId] || (byPaper[r.paperId] = [])).push(r));
    const dict = {};
    for (const pid of Object.keys(byPaper)) {
      let loaded; try { loaded = await Data.loadPaper(pid); } catch { continue; }
      const flat = {};
      ['SBA', 'EMQ'].forEach(kind => Data.flatten(loaded.paper, kind).forEach(q => flat[`${pid}:${kind}:${q.number}`] = q));
      byPaper[pid].forEach(r => { const q = flat[r.qkey]; if (q) dict[r.qkey] = { ...q, _qkey: r.qkey, _paperTitle: r.paperTitle, bucket: r.bucket, difficulty: r.difficulty }; });
    }
    return dict;
  }

  /* ---------------- home (#/simulator) ---------------- */

  async function renderHome(view, user) {
    coachProvider = 'claude';
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">ADAPTIVE SIMULATOR · DEVELOPER</p>
          <h1 class="page-title">Daily exam simulator</h1>
          <p class="muted">A fresh 30-SBA + 30-EMQ mock shaped to the PGIM blueprint, tuned each day to your performance. Questions are drawn from the live bank — never repeated, never invented.</p>
        </header>
        <div id="sim-body"><p class="muted">Preparing the engine…</p></div>
      </section>`;

    const [bp, rawIndex, hist, stats, tags] = await Promise.all([Blueprint.load(), buildIndex(), loadHistory(), loadStats(), loadTags()]);
    const index = enrich(rawIndex, stats, tags);
    const body = view.querySelector('#sim-body');

    const sbaTotal = index.filter(r => r.kind === 'SBA').length;
    const emqTotal = index.filter(r => r.kind === 'EMQ').length;
    const unseenSba = index.filter(r => r.kind === 'SBA' && !hist.seen.has(r.qkey) && !hist.excluded.has(r.qkey)).length;
    const unseenEmq = index.filter(r => r.kind === 'EMQ' && !hist.seen.has(r.qkey) && !hist.excluded.has(r.qkey)).length;
    const enough = unseenSba >= 10 && unseenEmq >= 10;

    // weak areas (lowest accuracy with enough evidence)
    const weak = Object.entries(hist.bucketAgg)
      .filter(([, a]) => a.seen >= 3)
      .map(([label, a]) => ({ label, pct: Math.round((a.correct / a.seen) * 100), seen: a.seen }))
      .sort((x, y) => x.pct - y.pct).slice(0, 5);

    const last = hist.mocks[0];
    body.innerHTML = `
      <div class="sim-hero card" data-animate>
        <div class="sim-hero-main">
          <p class="sim-hero-kicker">Blueprint v${bp.version || 1}${bp.updated ? ' · ' + esc(bp.updated) : ''} · ${bp.sba.length} SBA topics · ${bp.emq.length} EMQ themes</p>
          <h2>${hist.mocks.length ? `Mock #${hist.mocks.length + 1}` : 'Your first mock'}</h2>
          <p class="muted">${enough
            ? `Ready — ${unseenSba} SBA & ${unseenEmq} EMQ still unseen in the bank.`
            : `<span class="bad">Not enough unseen questions yet.</span> Publish more papers (or clear a flaw exclusion). SBA unseen: ${unseenSba}, EMQ unseen: ${unseenEmq}.`}</p>
          <div class="sim-hero-actions">
            <button class="btn btn-gold btn-lg" id="sim-start" ${enough ? '' : 'disabled'}>Generate today's mock →</button>
            <button class="btn btn-ghost btn-sm" id="sim-rebuild" title="Re-scan published papers into the index">↻ Rebuild index</button>
          </div>
        </div>
        <div class="sim-hero-side">
          <div class="sim-stat"><strong>${sbaTotal + emqTotal}</strong><span>Questions indexed</span></div>
          <div class="sim-stat"><strong>${Object.keys(tags).length}</strong><span>AI-tagged</span></div>
          <div class="sim-stat"><strong>${hist.mocks.length}</strong><span>Mocks taken</span></div>
          <div class="sim-stat"><strong>${last ? last.percent + '%' : '—'}</strong><span>Last score</span></div>
        </div>
      </div>

      ${masteryHeatmapHTML(bp, hist)}

      ${weak.length ? `
        <div class="card" data-animate>
          <h3 class="card-title">Where tomorrow's paper will push you</h3>
          <p class="muted">These weakest topics are up-weighted in the next mock.</p>
          <div class="sim-weak">${weak.map(w => `
            <div class="sim-weak-row">
              <span class="sim-weak-label">${esc(w.label)}</span>
              <div class="sim-weak-bar"><span class="${w.pct < 50 ? 'bad' : w.pct < 70 ? '' : 'good'}" style="width:${w.pct}%"></span></div>
              <span class="sim-weak-pct">${w.pct}%</span>
            </div>`).join('')}</div>
        </div>` : ''}

      ${hist.mocks.length ? `
        <div class="card" data-animate>
          <h3 class="card-title">Recent mocks</h3>
          <div class="table-scroll"><table class="table">
            <thead><tr><th>#</th><th>Date</th><th>Score</th><th>SBA/EMQ</th><th>Excluded</th><th></th></tr></thead>
            <tbody>${hist.mocks.slice(0, 8).map((m, i) => `
              <tr>
                <td>${hist.mocks.length - i}</td>
                <td class="muted">${new Date(m.date).toLocaleDateString()}</td>
                <td><strong class="${m.percent >= 70 ? 'good' : m.percent >= 50 ? '' : 'bad'}">${m.percent}%</strong> <span class="muted">(${m.correct}/${m.scored})</span></td>
                <td class="muted">${m.sbaCount || 0}/${m.emqCount || 0}</td>
                <td class="muted">${(m.excludedKeys || []).length}</td>
                <td><a class="link" href="#/simulator/result/${encodeURIComponent(m.id)}">Review</a></td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>` : ''}`;

    body.querySelector('#sim-start')?.addEventListener('click', () => { location.hash = '#/simulator/run'; });
    body.querySelector('#sim-rebuild')?.addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = '↻ Rebuilding…';
      // Also drop the cached AI tags/stats (10-min TTL) so freshly-tagged
      // questions are picked up immediately instead of waiting out the
      // cache window — "rebuild" should mean fully fresh, not just papers.
      if (typeof Cache !== 'undefined') { Cache.bust('sim-qtags'); Cache.bust('sim-qstats'); }
      await buildIndex(true); renderHome(view, user);
    });
  }

  /* ---------------- syllabus mastery heatmap ---------------- */

  // One cell per blueprint bucket, coloured by the candidate's
  // recency-decayed accuracy. Grey = untested; that IS the signal.
  function masteryHeatmapHTML(bp, hist) {
    const cells = [
      ...(bp.sba || []).map(b => ({ label: b.subcategory || b.category, kind: 'SBA' })),
      ...(bp.emq || []).map(b => ({ label: b.theme, kind: 'EMQ' }))
    ].map(c => {
      const a = hist.bucketAgg[c.label];
      const pct = a && a.seen > 0 && (a.rawSeen || 0) >= 1 ? Math.round((a.correct / a.seen) * 100) : null;
      return { ...c, pct, n: a ? (a.rawSeen || 0) : 0 };
    });
    if (!cells.length) return '';
    const tone = p => p == null ? 'hm-none' : p < 50 ? 'hm-bad' : p < 70 ? 'hm-mid' : 'hm-good';
    return `
      <div class="card" data-animate>
        <h3 class="card-title">Syllabus mastery map</h3>
        <p class="muted">Recency-weighted accuracy per blueprint topic (last ~2 weeks count double). Grey cells are untested — they're the hidden risk.</p>
        <div class="sim-heatmap">${cells.map(c => `
          <div class="hm-cell ${tone(c.pct)}" title="${esc(c.label)} · ${c.pct == null ? 'not tested yet' : c.pct + '% (' + c.n + ' scored)'}">
            <span class="hm-pct">${c.pct == null ? '·' : c.pct}</span>
            <span class="hm-label">${esc(c.label)}</span>
            <span class="hm-kind">${c.kind}</span>
          </div>`).join('')}</div>
        <div class="palette-legend hm-legend">
          <span><i class="dot" style="background:#e05263"></i>&lt;50%</span>
          <span><i class="dot" style="background:#e8a33d"></i>50–69%</span>
          <span><i class="dot" style="background:#34d399"></i>≥70%</span>
          <span><i class="dot" style="background:#3a405e"></i>Untested</span>
        </div>
      </div>`;
  }

  /* ---------------- run (#/simulator/run) ---------------- */

  async function startRun(view, user) {
    view.innerHTML = `<section class="page narrow"><header data-animate><p class="kicker">ADAPTIVE SIMULATOR</p><h1 class="page-title">Building your mock…</h1><p class="muted">Sampling the blueprint across the live bank.</p></header></section>`;
    let bp, index, hist;
    try {
      const [b, raw, h, stats, tags] = await Promise.all([Blueprint.load(), buildIndex(), loadHistory(), loadStats(), loadTags()]);
      bp = b; hist = h; index = enrich(raw, stats, tags);
    }
    catch (e) { view.innerHTML = `<section class="page narrow"><p class="bad">Could not prepare the mock: ${esc(e.message || e)}</p><a class="btn btn-ghost" href="#/simulator">Back</a></section>`; return; }

    const plan = select(bp, index, hist);
    const dict = await resolve([...plan.sbaRecs, ...plan.emqRecs]);
    const sbaQ = plan.sbaRecs.map(r => dict[r.qkey]).filter(Boolean);
    const emqQ = plan.emqRecs.map(r => dict[r.qkey]).filter(Boolean);
    const questions = [...sbaQ, ...emqQ].map((q, i) => ({ ...q, number: i + 1 }));

    if (questions.length < 4) {
      view.innerHTML = `<section class="page narrow"><p class="bad">Not enough eligible questions to build a mock yet. Publish more papers, then rebuild the index.</p><a class="btn btn-ghost" href="#/simulator">Back</a></section>`;
      return;
    }

    const loaded = {
      meta: { id: 'sim-' + new Date().toISOString().slice(0, 10), title: 'Daily adaptive mock', categoryId: null, topicId: null },
      paper: { topic: 'Daily adaptive mock' },
      path: { category: { title: 'Adaptive simulator' }, topic: null }
    };
    const counts = { sba: sbaQ.length, emq: emqQ.length };

    view.innerHTML = '';
    Quiz.start(view, loaded, questions, {
      mode: 'exam', kind: 'MIX', sessionKey: null, simulator: true,
      // Real PGIM SBA+EMQ paper is 2 hours — cap at 120 min even if an older
      // stored blueprint still says 180. A shorter blueprint value is honoured.
      timeLimitMinutes: Math.min(bp.paper.durationMin || 120, 120),
      onFinish: async (attempt) => {
        const mock = await saveMock(attempt, bp, counts, questions);
        try { if (typeof ReviewQueue !== 'undefined') ReviewQueue.addFromAttempt(attempt); } catch { /* optional */ }
        location.hash = mock ? '#/simulator/result/' + encodeURIComponent(mock.id) : '#/simulator';
      },
      onQuit: () => { location.hash = '#/simulator'; }
    });
  }

  async function saveMock(attempt, bp, counts, questions) {
    const buckets = {};
    attempt.detail.forEach(d => {
      if (d.excluded) return;
      const b = d.bucket || '(unbucketed)';
      const agg = buckets[b] || (buckets[b] = { seen: 0, correct: 0 });
      agg.seen++; if (d.isCorrect) agg.correct++;
    });
    const bySection = { SBA: { seen: 0, correct: 0 }, EMQ: { seen: 0, correct: 0 } };
    attempt.detail.forEach(d => { if (d.excluded) return; const s = bySection[d.kind]; if (s) { s.seen++; if (d.isCorrect) s.correct++; } });
    const result = {
      date: attempt.date, total: attempt.total, scored: attempt.scored, correct: attempt.correct,
      percent: attempt.percent, durationSec: attempt.durationSec, timedOut: attempt.timedOut,
      questionKeys: questions.map(q => q._qkey), excludedKeys: attempt.excludedKeys || [],
      buckets, bySection, sbaCount: counts.sba, emqCount: counts.emq, blueprintVersion: bp.version,
      detail: attempt.detail.map(d => ({ qkey: d.qkey, bucket: d.bucket, kind: d.kind, isCorrect: d.isCorrect, excluded: d.excluded, chosen: d.chosen, correct: d.correct, timeSec: d.timeSec || 0 }))
    };
    // anonymous score into the cohort distribution (percentile curve)
    try { Backend.saveCohortScore?.(result.percent).catch?.(() => {}); } catch {}
    try { return await Backend.saveMockResult(result); } catch { return null; }
  }

  /* ---------------- result (#/simulator/result/:id) ---------------- */

  async function renderResult(view, mockId, user) {
    const mock = Backend.getMockResult ? await Backend.getMockResult(mockId).catch(() => null) : null;
    if (!mock) { view.innerHTML = `<section class="page narrow"><p class="muted">That mock could not be found. <a class="link" href="#/simulator">Back</a></p></section>`; return; }
    coachProvider = (user && user.isDeveloper) ? 'claude' : 'gemini';

    const bp = await Blueprint.load().catch(() => ({ notes: '' }));
    const verdict = mock.percent >= 70 ? { t: 'On pass trajectory', c: 'good' } : mock.percent >= 50 ? { t: 'Building', c: '' } : { t: 'Foundation work needed', c: 'bad' };
    const bucketRows = Object.entries(mock.buckets || {}).map(([label, a]) => ({ label, pct: Math.round((a.correct / a.seen) * 100), seen: a.seen, correct: a.correct }))
      .sort((x, y) => x.pct - y.pct);
    const sec = mock.bySection || {};
    const secPct = s => s && s.seen ? Math.round((s.correct / s.seen) * 100) : 0;

    view.innerHTML = `
      <section class="page narrow results-page">
        <header class="results-head" data-animate>
          <p class="kicker">Adaptive mock · ${new Date(mock.date).toLocaleDateString()} · ${Math.floor(mock.durationSec / 60)}m</p>
          <div class="score-hero"><span id="score-big">0%</span></div>
          <p class="verdict ${verdict.c}">${verdict.t}</p>
          <p class="muted">${mock.correct} of ${mock.scored} scored correct${(mock.excludedKeys || []).length ? ` · ${(mock.excludedKeys || []).length} excluded as flawed` : ''}</p>
          <div class="sim-section-split">
            <div class="sim-split"><span class="chip chip-sba">SBA</span> <strong class="${secPct(sec.SBA) >= 70 ? 'good' : ''}">${secPct(sec.SBA)}%</strong> <span class="muted">(${sec.SBA?.correct || 0}/${sec.SBA?.seen || 0})</span></div>
            <div class="sim-split"><span class="chip chip-emq">EMQ</span> <strong class="${secPct(sec.EMQ) >= 70 ? 'good' : ''}">${secPct(sec.EMQ)}%</strong> <span class="muted">(${sec.EMQ?.correct || 0}/${sec.EMQ?.seen || 0})</span></div>
          </div>
          <div class="results-actions">
            <a class="btn btn-gold" href="#/simulator/run">New mock</a>
            <a class="btn btn-ghost" href="#/simulator">Simulator home</a>
          </div>
        </header>

        <div class="card" data-animate>
          <h3 class="card-title">Blueprint breakdown</h3>
          <p class="muted">How you scored across the topics this paper sampled — weakest first.</p>
          <div class="sim-weak">${bucketRows.map(b => `
            <div class="sim-weak-row">
              <span class="sim-weak-label">${esc(b.label)}</span>
              <div class="sim-weak-bar"><span class="${b.pct < 50 ? 'bad' : b.pct < 70 ? '' : 'good'}" style="width:${b.pct}%"></span></div>
              <span class="sim-weak-pct">${b.correct}/${b.seen}</span>
            </div>`).join('')}</div>
        </div>

        ${pacingHTML(mock)}
        <div id="sim-cohort"></div>

        <div class="card sim-coach" data-animate>
          <div class="sim-coach-head">
            <h3 class="card-title">AI coaching plan</h3>
            <div class="ai-providers" id="coach-prov">
              <button class="ai-prov ${coachProvider === 'gemini' ? 'active' : ''}" data-prov="gemini">Gemini Flash</button>
              <button class="ai-prov ${coachProvider === 'claude' ? 'active' : ''}" data-prov="claude">Claude</button>
            </div>
          </div>
          <p class="muted">A focused next-steps plan built from your per-topic scores and the blueprint's examiner tendencies.</p>
          <button class="btn btn-ai" id="coach-go">✨ Generate my plan</button>
          <div class="sim-coach-out" id="coach-out"></div>
        </div>

        <h2 class="review-title" data-animate>Answer review</h2>
        <div class="review-list" id="sim-review"><p class="muted">Loading questions…</p></div>
      </section>`;

    FX.scoreReveal(document.getElementById('score-big'), mock.percent);
    if (mock.percent >= 70) FX.confetti(view.querySelector('.results-head'));

    // hide the coach if it's switched off in the AI systems panel
    try {
      if (typeof AI !== 'undefined' && AI.featureOn && !(await AI.featureOn('ai_coach'))) view.querySelector('.sim-coach')?.remove();
    } catch { /* default: keep it */ }

    // coach provider toggle + generate
    view.querySelectorAll('#coach-prov .ai-prov').forEach(b => b.addEventListener('click', () => {
      view.querySelectorAll('#coach-prov .ai-prov').forEach(x => x.classList.toggle('active', x === b));
      coachProvider = b.dataset.prov;
    }));
    view.querySelector('#coach-go')?.addEventListener('click', () => runCoach(view, mock, bp, bucketRows, sec));

    // cohort percentile curve (async — needs the shared score table)
    renderCohort(view.querySelector('#sim-cohort'), mock);

    // review (resolve the questions from cache)
    const canAiCards = !!(user && (user.isDeveloper || user.featureFlags?.ai_flashcards));
    renderReview(view.querySelector('#sim-review'), mock, canAiCards);
  }

  /* ---------------- pacing analysis ---------------- */

  function pacingHTML(mock) {
    const rows = (mock.detail || []).filter(d => d.timeSec > 0);
    if (rows.length < 5) return '';                  // older mocks have no timing
    const scored = rows.filter(d => !d.excluded);
    const totalSec = rows.reduce((s, d) => s + d.timeSec, 0);
    const avg = Math.round(totalSec / rows.length);
    // real paper budget: 120 min / 60 q = 120 s per question
    const budget = 120;
    const rushedWrong = scored.filter(d => d.chosen != null && !d.isCorrect && d.timeSec < 15).length;
    const perBucket = {};
    scored.forEach(d => { const b = perBucket[d.bucket || '(other)'] || (perBucket[d.bucket || '(other)'] = { t: 0, n: 0 }); b.t += d.timeSec; b.n++; });
    const slowest = Object.entries(perBucket).map(([label, b]) => ({ label, avg: Math.round(b.t / b.n) }))
      .sort((x, y) => y.avg - x.avg).slice(0, 3);
    const longest = [...scored].sort((x, y) => y.timeSec - x.timeSec)[0];
    const pace = avg <= budget ? `on pace (budget ${budget}s/question)` : `<span class="bad">${avg - budget}s/question over the 2-hour budget</span>`;
    return `
      <div class="card" data-animate>
        <h3 class="card-title">Pacing analysis</h3>
        <p class="muted">Average <strong>${avg}s</strong> per question — ${pace}.</p>
        <div class="sim-pacing">
          ${slowest.map(s => `<div class="sim-pace-row"><span>${esc(s.label)}</span><div class="sim-weak-bar"><span class="${s.avg > budget ? 'bad' : ''}" style="width:${Math.min(100, (s.avg / (budget * 2)) * 100)}%"></span></div><span class="sim-weak-pct">${s.avg}s avg</span></div>`).join('')}
        </div>
        ${rushedWrong ? `<p class="muted">⚡ <strong class="bad">${rushedWrong}</strong> wrong answer${rushedWrong > 1 ? 's' : ''} given in under 15 seconds — slow down: cheap marks are leaking on rushed guesses.</p>` : ''}
        ${longest && longest.timeSec > budget * 2 ? `<p class="muted">🐢 Longest single question: <strong>${Math.round(longest.timeSec / 60)}m ${longest.timeSec % 60}s</strong> — in the real exam, flag it and move on.</p>` : ''}
      </div>`;
  }

  /* ---------------- cohort percentile ---------------- */

  async function renderCohort(host, mock) {
    if (!host) return;
    let scores = [];
    try { scores = (await Backend.listCohortScores?.()) || []; } catch { scores = []; }
    if (scores.length < 4) return;                   // needs a real distribution
    const values = scores.map(s => s.percent);
    const below = values.filter(v => v < mock.percent).length;
    const pctile = Math.round((below / values.length) * 100);
    const bins = new Array(10).fill(0);
    values.forEach(v => bins[Math.min(9, Math.floor(v / 10))]++);
    const maxBin = Math.max(...bins, 1);
    const W = 520, H = 130, bw = W / 10;
    const bars = bins.map((n, i) => {
      const h = Math.round((n / maxBin) * (H - 30));
      const mine = Math.min(9, Math.floor(mock.percent / 10)) === i;
      return `<rect x="${i * bw + 3}" y="${H - 18 - h}" width="${bw - 6}" height="${h}" rx="3" fill="${mine ? '#f4c95d' : '#3a4a7a'}"/>` +
        `<text x="${i * bw + bw / 2}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#8a92ad">${i * 10}</text>`;
    }).join('');
    host.innerHTML = `
      <div class="card" data-animate>
        <h3 class="card-title">Where you stand in the cohort</h3>
        <p class="muted">You scored higher than <strong class="good">${pctile}%</strong> of the ${values.length} mock sittings recorded on this platform (anonymous, last 4 months). Gold bar = your band.</p>
        <svg class="sim-cohort-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cohort score distribution">${bars}</svg>
      </div>`;
  }

  async function runCoach(view, mock, bp, bucketRows, sec) {
    const out = view.querySelector('#coach-out');
    out.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>`;
    const analytics = {
      percent: mock.percent, correct: mock.correct, scored: mock.scored,
      sba: `${sec.SBA?.correct || 0}/${sec.SBA?.seen || 0}`, emq: `${sec.EMQ?.correct || 0}/${sec.EMQ?.seen || 0}`,
      buckets: bucketRows.map(b => ({ label: b.label, correct: b.correct, seen: b.seen, pct: b.pct }))
    };
    try {
      const token = await Backend.getAccessToken();
      if (!token) throw new Error('Sign in to use the AI coach.');
      const res = await fetch((window.AUREUM_CONFIG?.ai?.apiBase) || '/api/explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          action: 'coach', provider: coachProvider,
          model: coachProvider === 'claude' ? window.AUREUM_CONFIG.ai.claudeModel : window.AUREUM_CONFIG.ai.geminiModel,
          dailyLimit: window.AUREUM_CONFIG.ai.dailyLimit,
          analytics, blueprintNotes: bp.notes || ''
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Coach failed (HTTP ${res.status}).`);
      out.innerHTML = `<div class="ai-body sim-coach-body">${mdBlock(data.text)}</div>
        <button class="btn btn-ghost btn-sm" id="coach-save">💾 Save plan to Studio</button>`;
      out.querySelector('#coach-save').addEventListener('click', async e => {
        e.target.disabled = true;
        try { await Backend.saveAiItem({ questionKey: null, paperTitle: 'Adaptive mock ' + new Date(mock.date).toLocaleDateString(), kind: 'summary', title: 'Coaching plan', content: '# Coaching plan\n\n' + data.text, mime: 'text/markdown' }); e.target.textContent = '✓ Saved'; }
        catch { e.target.textContent = 'Could not save'; }
      });
    } catch (e) {
      out.innerHTML = `<p class="ai-error">${esc(e.message || e)}</p>`;
    }
  }

  async function renderReview(host, mock, canAiCards) {
    const recs = (mock.detail || []).map(d => ({ paperId: String(d.qkey).split(':')[0], qkey: d.qkey, kind: d.kind, paperTitle: '' }));
    const dict = await resolve(recs);
    if (!Object.keys(dict).length) { host.innerHTML = `<p class="muted">The questions in this mock are no longer available to review (unpublished).</p>`; return; }
    const wrong = (mock.detail || []).filter(d => !d.excluded && !d.isCorrect && dict[d.qkey]);
    const cardsBar = canAiCards && wrong.length ? `
      <div class="card sim-aicards" data-animate>
        <div class="sim-aicards-row">
          <div><h3 class="card-title">🃏 Turn mistakes into flashcards</h3>
          <p class="muted">AI writes spaced-repetition cards from your ${wrong.length} wrong answer${wrong.length > 1 ? 's' : ''} and files them in your personal “From my mistakes” deck.</p></div>
          <button class="btn btn-gold" id="sim-gen-cards">Generate ${Math.min(wrong.length, 12)} card set${wrong.length > 1 ? 's' : ''}</button>
        </div>
        <p class="dev-row-msg" id="sim-cards-msg"></p>
      </div>` : '';
    host.innerHTML = cardsBar + (mock.detail || []).map((d, i) => {
      const q = dict[d.qkey];
      if (!q) return '';
      const L = q.preLettered ? '' : Quiz.LETTERS[q.answer] + '. ';
      const chosen = d.chosen == null ? null : (q.preLettered ? '' : Quiz.LETTERS[d.chosen] + '. ') + q.options[d.chosen];
      return `
        <article class="review-item ${d.excluded ? 'r-excluded' : d.isCorrect ? 'r-correct' : 'r-wrong'}" data-animate>
          <header class="review-item-head">
            <span class="r-badge">${d.excluded ? '⚠' : d.isCorrect ? '✓' : '✗'}</span>
            <span class="r-num">Q${i + 1} · <span class="chip chip-${q.kind.toLowerCase()}">${q.kind}</span>${q.bucket ? ' · ' + esc(q.bucket) : ''}${d.excluded ? ' · excluded' : ''}</span>
          </header>
          ${q.kind === 'EMQ' && q.theme ? `<p class="q-lead"><strong>${esc(q.theme)}</strong>${q.instruction ? ' — ' + esc(q.instruction) : ''}</p>` : ''}
          <p class="q-stem">${esc(q.stem)}</p>
          ${q.lead ? `<p class="q-lead">${esc(q.lead)}</p>` : ''}
          <p class="r-line ${d.isCorrect ? 'good' : 'bad'}">${d.chosen == null ? '<span class="bad">Not answered.</span>' : 'Your answer: ' + esc(chosen)}</p>
          ${!d.isCorrect ? `<p class="r-line good">Correct: ${L}${esc(q.options[q.answer])}</p>` : ''}
          ${q.rationale ? `<p class="r-expl">${esc(q.rationale)}</p>` : ''}
          ${q.hook ? `<p class="r-hook">💡 ${esc(q.hook)}</p>` : ''}
          <div class="qedit-slot" data-qk="${esc(d.qkey)}"></div>
          <div class="ai-slot" data-ai="${i}"></div>
        </article>`;
    }).join('');

    // mount qedit (flag/exclude) + AI on each reviewed question
    host.querySelectorAll('.qedit-slot').forEach(slot => {
      const qk = slot.dataset.qk; const q = dict[qk]; if (!q || typeof QEdit === 'undefined') return;
      QEdit.mount(slot, { questionKey: qk, rationale: q.rationale || '', paperTitle: q._paperTitle || 'Mock', answerText: (q.preLettered ? '' : Quiz.LETTERS[q.answer] + '. ') + q.options[q.answer] });
    });
    if (typeof AI !== 'undefined' && window.AUREUM_CONFIG?.ai?.enabled) {
      host.querySelectorAll('.ai-slot').forEach(slot => {
        const d = (mock.detail || [])[Number(slot.dataset.ai)]; const q = d && dict[d.qkey]; if (!q) return;
        AI.attach(slot, { questionKey: d.qkey, kind: q.kind, theme: q.theme || '', stem: q.stem, lead: q.lead || '', options: q.options, answer: q.answer, chosen: d.chosen, rationale: q.rationale || '', hook: q.hook || '', reference: q.reference || '', paperTitle: q._paperTitle || 'Mock', preLettered: q.preLettered });
      });
    }
    host.querySelector('#sim-gen-cards')?.addEventListener('click', e => generateAiCards(e.target, host.querySelector('#sim-cards-msg'), wrong, dict));
  }

  /* ---------------- AI flashcards from wrong answers ---------------- */

  async function generateAiCards(btn, msg, wrong, dict) {
    btn.disabled = true;
    const items = wrong.slice(0, 12);                // cost guard per run
    const made = [];
    try {
      const token = await Backend.getAccessToken();
      if (!token) throw new Error('Sign in first.');
      for (let i = 0; i < items.length; i++) {
        msg.textContent = `Writing cards… ${i + 1}/${items.length}`; msg.className = 'dev-row-msg muted';
        const q = dict[items[i].qkey];
        const res = await fetch(window.AUREUM_CONFIG?.ai?.apiBase || '/api/explain', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ action: 'flashcard', dailyLimit: window.AUREUM_CONFIG?.ai?.dailyLimit,
            question: { kind: q.kind, theme: q.theme || '', stem: q.stem, lead: q.lead || '', options: q.options, answer: q.answer, chosen: items[i].chosen, rationale: q.rationale || '', preLettered: q.preLettered } })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Card generation failed (HTTP ${res.status}).`);
        let cards = [];
        try { cards = JSON.parse(String(data.text).replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '')); } catch { cards = []; }
        (Array.isArray(cards) ? cards : []).forEach((c, ci) => {
          if (c.question && c.answer) made.push({ id: `${items[i].qkey}#${ci}`, question: c.question, answer: c.answer, keyPoint: c.keyPoint || '' });
        });
      }
      if (!made.length) throw new Error('The AI returned no usable cards — try again.');
      // merge into the personal deck (dedupe by card id → re-running is safe)
      const decks = (await Backend.listUserDecks?.()) || [];
      const ex = decks.find(d => d.id === 'deck-ai-mistakes');
      const have = new Map((ex?.content?.cards || []).map(c => [c.id, c]));
      made.forEach(c => have.set(c.id, c));
      const cards = [...have.values()];
      await Backend.saveUserDeck({ id: 'deck-ai-mistakes', title: 'From my mistakes (AI)', source: 'AI-generated from your wrong answers', cardCount: cards.length, personal: true, content: { topic: 'From my mistakes', cards } });
      msg.innerHTML = `✓ ${made.length} card${made.length > 1 ? 's' : ''} added — deck now ${cards.length} cards. <a class="link" href="#/cards/deck-ai-mistakes">Open deck →</a>`;
      msg.className = 'dev-row-msg good';
    } catch (e) {
      msg.textContent = e.message || String(e); msg.className = 'dev-row-msg bad';
    }
    btn.disabled = false;
  }

  function mdBlock(md) {
    let h = esc(md);
    h = h.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>').replace(/^##\s+(.+)$/gm, '<h3>$1</h3>').replace(/^#\s+(.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(?:^|\n)\s*[-•]\s+(.+)/g, '\n<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>');
    h = h.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    return '<p>' + h + '</p>';
  }

  return { renderHome, startRun, renderResult, buildIndex, select, loadHistory };
})();
