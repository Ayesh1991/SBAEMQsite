/* ============================================================
   flashcards.js — spaced-repetition flashcards.

   • Decks are published by the developer (mirroring the paper
     pipeline, but a separate table) and cached on-device to spare
     Supabase egress.
   • Each card's schedule is per-user (SM-2), and is saved the moment
     a card is graded — so progress persists mid-deck ("halfway
     saving"), never only at the end.

   Card JSON: { id, question, answer, keyPoint, ... }
   Deck JSON: { topic, cards: [ card, … ] }
   ============================================================ */

const Flashcards = (() => {
  const esc = Quiz.esc;
  const DECKS_KEY = 'flashcard-decks';
  const DECKS_TTL = 15 * 60 * 1000;
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const isDue = st => !st || !st.due || st.due <= today();

  async function decks() {
    const loader = () => Backend.getFlashcardDecks().then(r => r || []);
    return (typeof Cache !== 'undefined') ? Cache.wrap(DECKS_KEY, DECKS_TTL, loader) : loader();
  }
  function bustDecks() { if (typeof Cache !== 'undefined') Cache.bust(DECKS_KEY); }

  /* ---------- SM-2 scheduling (4-button, day granularity) ---------- */

  function schedule(prev, grade) {
    // grade: 'again' | 'hard' | 'good' | 'easy'
    let ease = prev?.ease ?? 2.5;
    let reps = prev?.reps ?? 0;
    let lapses = prev?.lapses ?? 0;
    let interval;
    if (grade === 'again') {
      ease = Math.max(1.3, ease - 0.2); reps = 0; lapses += 1; interval = 0;         // reappears today
    } else if (grade === 'hard') {
      ease = Math.max(1.3, ease - 0.15);
      interval = reps === 0 ? 1 : Math.max(1, Math.round((prev?.interval || 1) * 1.2));
      reps += 1;
    } else if (grade === 'easy') {
      ease = ease + 0.15;
      interval = reps === 0 ? 4 : Math.round((prev?.interval || 1) * ease * 1.3);
      reps += 1;
    } else { // good
      interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round((prev?.interval || 1) * ease);
      reps += 1;
    }
    return { ease: Math.round(ease * 1000) / 1000, reps, lapses, interval, due: addDays(today(), interval) };
  }

  function deckStats(deck, prog) {
    let due = 0, learned = 0, fresh = 0, reviewDue = 0;
    for (const c of deck.content.cards) {
      const st = prog[c.id];
      if (!st) { fresh++; due++; }                       // new card: counts as something to do
      else {
        if ((st.reps || 0) > 0) learned++;
        if (isDue(st)) { due++; if ((st.reps || 0) > 0) reviewDue++; }   // reviewDue = learned & past its date
      }
    }
    return { total: deck.content.cards.length, due, learned, fresh, reviewDue };
  }

  /* ---------- deck list (#/cards) ---------- */

  function deckCardHTML(d, st) {
    const pct = st.total ? Math.round((st.learned / st.total) * 100) : 0;
    return `
      <a class="fc-deck" href="#/cards/${encodeURIComponent(d.id)}" style="--fc-accent:linear-gradient(135deg,#a78bfa,#5eead4)">
        <div class="fc-deck-top">
          <span class="fc-deck-ico">🃏</span>
          ${st.reviewDue ? `<span class="fc-due-badge">${st.reviewDue} to review</span>`
            : st.fresh ? `<span class="fc-new-badge">${st.fresh} new</span>`
            : `<span class="fc-done-badge">✓ up to date</span>`}
        </div>
        <h3 class="fc-deck-title">${esc(d.title)}</h3>
        <p class="fc-deck-source muted">${esc(d.source || '')}</p>
        <div class="fc-deck-meter"><span style="width:${pct}%"></span></div>
        <div class="fc-deck-foot">
          <span class="muted tiny">${st.total} cards · ${st.learned} learned</span>
          <span class="fc-deck-go">Study →</span>
        </div>
      </a>`;
  }
  function groupLetter(title) {
    const c = String(title || '').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  async function renderList(view, user) {
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">FLASHCARDS · SPACED REPETITION</p>
          <h1 class="page-title">Rapid recall decks</h1>
          <p class="muted">Guideline flashcards with a spaced-repetition schedule that brings each card back exactly when you're about to forget it. Your progress saves after every card.</p>
        </header>
        <div id="fc-body"><p class="muted">Loading your decks…</p></div>
      </section>`;

    const [list, allProg] = await Promise.all([
      decks().catch(() => []),
      Backend.listAllCardProgress ? Backend.listAllCardProgress().catch(() => ({})) : Promise.resolve({})
    ]);
    const body = view.querySelector('#fc-body');
    if (!list.length) {
      body.innerHTML = `<div class="fc-empty card"><span class="fc-empty-ico">🗂️</span>
        <p>No decks published yet.</p>
        <p class="muted tiny">Import flashcard JSON from the Developer tab to build your first deck.</p></div>`;
      return;
    }

    // stats + sortable model
    const rows = list.map(d => ({ d, st: deckStats(d, allProg[d.id] || {}) }))
      .sort((a, b) => a.d.title.localeCompare(b.d.title));
    const totalDue = rows.reduce((n, r) => n + r.st.due, 0);
    const totalCards = rows.reduce((n, r) => n + r.st.total, 0);

    body.innerHTML = `
      <div class="fc-summary card" data-animate>
        <div><strong>${rows.length}</strong><span>Decks</span></div>
        <div><strong class="${totalDue ? 'gold' : 'good'}">${totalDue}</strong><span>Cards due now</span></div>
        <div><strong>${totalCards}</strong><span>Total cards</span></div>
      </div>
      <div class="lib-search" data-animate>
        <span class="lib-search-ico">⌕</span>
        <input type="search" id="fc-search" placeholder="Search decks by name… e.g. breech, PPROM, FGR" autocomplete="off">
      </div>
      <div class="lib-filters" id="fc-filters" data-animate>
        <button class="filter-chip active" data-f="all">All <span>${rows.length}</span></button>
        <button class="filter-chip" data-f="due">Reviews due <span>${rows.filter(r => r.st.reviewDue).length}</span></button>
        <button class="filter-chip" data-f="progress">In progress <span>${rows.filter(r => r.st.learned && r.st.learned < r.st.total).length}</span></button>
        <button class="filter-chip" data-f="fresh">Not started <span>${rows.filter(r => !r.st.learned).length}</span></button>
      </div>
      <div id="fc-results" class="lib-results" hidden></div>
      <div id="fc-groups"></div>`;

    const groupsEl = body.querySelector('#fc-groups');
    const resultsEl = body.querySelector('#fc-results');
    const filtersEl = body.querySelector('#fc-filters');
    const searchEl = body.querySelector('#fc-search');
    let filter = 'all';

    const passFilter = r => filter === 'all' ? true
      : filter === 'due' ? r.st.reviewDue > 0
      : filter === 'progress' ? (r.st.learned > 0 && r.st.learned < r.st.total)
      : /* fresh */ r.st.learned === 0;

    function drawGroups() {
      const shown = rows.filter(passFilter);
      if (!shown.length) { groupsEl.innerHTML = `<p class="muted lib-empty">No decks match this filter.</p>`; return; }
      const groups = {};
      shown.forEach(r => (groups[groupLetter(r.d.title)] || (groups[groupLetter(r.d.title)] = [])).push(r));
      const letters = Object.keys(groups).sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));
      groupsEl.innerHTML = letters.map(L => `
        <details class="chapter-section fc-group" open>
          <summary><span class="cs-caret">▸</span><span class="cs-title">${L}</span><span class="cs-count">${groups[L].length}</span></summary>
          <div class="cs-body"><div class="fc-deck-grid">${groups[L].map(r => deckCardHTML(r.d, r.st)).join('')}</div></div>
        </details>`).join('');
    }

    function drawSearch(q) {
      const hits = rows.filter(r => r.d.title.toLowerCase().includes(q) || (r.d.source || '').toLowerCase().includes(q));
      resultsEl.innerHTML = hits.length
        ? `<p class="muted lib-results-count">${hits.length} deck${hits.length > 1 ? 's' : ''} matching “${esc(q)}”</p><div class="fc-deck-grid">${hits.map(r => deckCardHTML(r.d, r.st)).join('')}</div>`
        : `<p class="muted">No decks match “${esc(q)}”.</p>`;
    }

    filtersEl.addEventListener('click', e => {
      const btn = e.target.closest('.filter-chip'); if (!btn) return;
      filtersEl.querySelectorAll('.filter-chip').forEach(b => b.classList.toggle('active', b === btn));
      filter = btn.dataset.f; drawGroups();
    });
    searchEl.addEventListener('input', () => {
      const q = searchEl.value.trim().toLowerCase();
      if (!q) { resultsEl.hidden = true; groupsEl.hidden = false; filtersEl.hidden = false; return; }
      groupsEl.hidden = true; filtersEl.hidden = true; resultsEl.hidden = false; drawSearch(q);
    });

    drawGroups();
    if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo('.fc-group', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: 'power2.out' });
    }
  }

  /* ---------- study session (#/cards/:id) ---------- */

  async function renderDeck(view, deckId, user) {
    const list = await decks().catch(() => []);
    const deck = list.find(d => d.id === deckId);
    if (!deck) { view.innerHTML = `<section class="page narrow"><p class="muted">That deck is no longer published. <a class="link" href="#/cards">Back to decks</a></p></section>`; return; }

    const prog = (Backend.getCardProgress ? await Backend.getCardProgress(deckId).catch(() => ({})) : {}) || {};
    // queue: due cards first, then new ones; keep original order within groups
    const dueCards = deck.content.cards.filter(c => isDue(prog[c.id]));
    const queue = (dueCards.length ? dueCards : deck.content.cards.slice()).map(c => c.id);
    const studyAhead = dueCards.length === 0;

    const s = { queue, i: 0, done: 0, again: 0, good: 0, revealed: false, total: queue.length, prog, studyAhead };

    function card() { return deck.content.cards.find(c => c.id === s.queue[s.i]); }

    function paintFrame() {
      view.innerHTML = `
        <section class="page narrow fc-study">
          <header class="fc-study-head" data-animate>
            <a class="link muted" href="#/cards">← Decks</a>
            <div class="fc-study-titles">
              <h1 class="fc-study-title">${esc(deck.title)}</h1>
              ${s.studyAhead ? `<span class="fc-ahead-chip">Study-ahead · nothing due today</span>` : ''}
            </div>
          </header>
          <div class="fc-progress"><span id="fc-fill"></span></div>
          <p class="fc-counter" id="fc-counter"></p>
          <div id="fc-stage"></div>
        </section>`;
      paintCard();
    }

    function paintCard() {
      const c = card();
      const fill = view.querySelector('#fc-fill');
      const counter = view.querySelector('#fc-counter');
      const stage = view.querySelector('#fc-stage');
      if (fill) fill.style.width = (s.total ? (s.done / s.total) * 100 : 0) + '%';
      if (counter) counter.innerHTML = `Card <strong>${Math.min(s.done + 1, s.total)}</strong> of ${s.total} · <span class="good">${s.good} known</span> · <span class="bad">${s.again} to review</span>`;

      if (!c) return paintComplete();
      const st = s.prog[c.id];
      const meta = st && st.reps ? `seen ${st.reps}× · next in ${st.interval || 0}d` : 'new card';
      stage.innerHTML = `
        <div class="fc-card ${s.revealed ? 'is-flipped' : ''}" id="fc-card" data-animate>
          <div class="fc-card-inner">
            <div class="fc-face fc-front">
              <span class="fc-face-tag">Question · ${esc(meta)}</span>
              <div class="fc-qtext">${md(c.question)}</div>
              <button class="btn btn-gold fc-reveal" id="fc-reveal">Show answer</button>
            </div>
            <div class="fc-face fc-back">
              <span class="fc-face-tag">Answer</span>
              <div class="fc-atext">${md(c.answer)}</div>
              ${c.keyPoint ? `<div class="fc-keypoint">${md(c.keyPoint)}</div>` : ''}
            </div>
          </div>
        </div>
        <div class="fc-grades" id="fc-grades" ${s.revealed ? '' : 'hidden'}>
          <button class="fc-grade fc-again" data-g="again"><strong>Again</strong><span>&lt;1d</span></button>
          <button class="fc-grade fc-hard"  data-g="hard"><strong>Hard</strong><span>${previewInterval(st, 'hard')}</span></button>
          <button class="fc-grade fc-good"  data-g="good"><strong>Good</strong><span>${previewInterval(st, 'good')}</span></button>
          <button class="fc-grade fc-easy"  data-g="easy"><strong>Easy</strong><span>${previewInterval(st, 'easy')}</span></button>
        </div>
        <p class="fc-hint muted tiny">Tap the card to flip · Space / Enter flips · 1–4 grade</p>`;

      const reveal = () => { s.revealed = true; view.querySelector('#fc-card')?.classList.add('is-flipped'); const g = view.querySelector('#fc-grades'); if (g) g.hidden = false; };
      // After the answer is shown, tapping the card flips it back and forth
      // (question ↔ answer) as often as you like; the grade buttons stay put.
      const flipToggle = () => view.querySelector('#fc-card')?.classList.toggle('is-flipped');
      view.querySelector('#fc-reveal')?.addEventListener('click', reveal);
      view.querySelector('#fc-card')?.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        if (!s.revealed) reveal(); else flipToggle();
      });
      view.querySelectorAll('#fc-grades .fc-grade').forEach(b => b.addEventListener('click', () => grade(b.dataset.g)));
      if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo('#fc-card', { opacity: 0, y: 18, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'power2.out' });
      }
    }

    function previewInterval(st, g) { const n = schedule(st, g).interval; return n <= 0 ? '<1d' : n === 1 ? '1d' : n < 30 ? n + 'd' : Math.round(n / 30) + 'mo'; }

    async function grade(g) {
      const c = card(); if (!c) return;
      const next = schedule(s.prog[c.id], g);
      s.prog[c.id] = next;
      try { await Backend.saveCardProgress(deckId, c.id, next); } catch { /* saved locally in memory at least */ }
      if (g === 'again') { s.again++; s.queue.push(c.id); s.total++; }   // requeue at end this session
      else s.good++;
      s.done++; s.i++; s.revealed = false;
      paintCard();
    }

    function paintComplete() {
      const stage = view.querySelector('#fc-stage');
      view.querySelector('#fc-fill').style.width = '100%';
      const stats = deckStats(deck, s.prog);
      stage.innerHTML = `
        <div class="fc-complete card" data-animate>
          <div class="fc-complete-ring">✓</div>
          <h2>Deck complete</h2>
          <p class="muted">${s.good} known · ${s.again} sent back for review this session.</p>
          <div class="fc-complete-stats">
            <div><strong>${stats.learned}</strong><span>Cards learned</span></div>
            <div><strong>${stats.due}</strong><span>Still due</span></div>
            <div><strong>${stats.total}</strong><span>In deck</span></div>
          </div>
          <div class="fc-complete-actions">
            ${stats.due ? `<button class="btn btn-gold" id="fc-again-round">Review the ${stats.due} still due</button>` : ''}
            <a class="btn btn-ghost" href="#/cards">Back to decks</a>
          </div>
        </div>`;
      if (typeof FX !== 'undefined') FX.confetti?.(stage.querySelector('.fc-complete'));
      view.querySelector('#fc-again-round')?.addEventListener('click', () => renderDeck(view, deckId, user));
    }

    // keyboard
    function onKey(e) {
      if (/^(input|textarea|select)$/i.test(document.activeElement?.tagName || '')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!s.revealed) view.querySelector('#fc-reveal')?.click();
        else view.querySelector('#fc-card')?.classList.toggle('is-flipped');   // flip back & forth
        return;
      }
      if (s.revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); grade(['again', 'hard', 'good', 'easy'][Number(e.key) - 1]); }
    }
    document.addEventListener('keydown', onKey);
    const stop = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', stop); };
    window.addEventListener('hashchange', stop);

    paintFrame();
  }

  /* ---------- minimal markdown (bold + line breaks) ---------- */
  function md(s) {
    let h = esc(s);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    return '<p>' + h + '</p>';
  }

  return { renderList, renderDeck, bustDecks, decks, schedule, deckStats };
})();
