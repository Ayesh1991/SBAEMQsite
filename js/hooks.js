/* ============================================================
   hooks.js — the memory-hook library.

   Every question in the bank can carry a `hook`: the one-line
   mnemonic that makes the fact stick ("vAMA miscarriage risk →
   roughly one in two"). Scattered across 9000+ questions they are
   invisible; gathered and grouped by topic they become a revision
   asset you can read end to end.

   How it is organised:
     • one DECK per topic, taken from the AI question tags where a
       question has been tagged, falling back to the paper's own
       title so nothing is orphaned;
     • decks collapse and expand — the page opens as a scannable
       grid of topic cards, not a wall of text;
     • each hook can reveal its RATIONALE and its QUESTION on
       demand, because a hook you can't decode is just a riddle;
     • one search box filters hooks, rationales and topics at once.

   The index is expensive to build (every published paper) so it is
   cached like the simulator's — built once, reused for an hour.
   ============================================================ */

const Hooks = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LETTERS = 'ABCDEFGHIJKLMNOPQRST';
  const KEY = 'hook-index';
  const TTL = 60 * 60 * 1000;

  let index = null;         // [{ qkey, hook, rationale, topic, paper, kind, q }]

  /* ---------------- reading colour ----------------
     A wall of saturated amber is tiring at this density. Each swatch carries
     a DARK-theme and a LIGHT-theme value so the same choice stays legible in
     both — a pale cream that reads beautifully on black would vanish on white.
     Tuned for long reading: mid-luminance, low-to-moderate saturation. */
  const IN_KEY = 'aureum.hookInk';
  const PALETTE = [
    { id: 'paper',    name: 'Paper',     dark: '#e6eaf5', light: '#1e2636' },
    { id: 'sand',     name: 'Sand',      dark: '#e9dfc6', light: '#5a4a24' },
    { id: 'amber',    name: 'Amber',     dark: '#f4c95d', light: '#8a6212' },
    { id: 'peach',    name: 'Peach',     dark: '#f3bd9a', light: '#9c5322' },
    { id: 'rose',     name: 'Rose',      dark: '#f0aab7', light: '#a82f4a' },
    { id: 'lavender', name: 'Lavender',  dark: '#c4b2f5', light: '#5b31d6' },
    { id: 'sky',      name: 'Sky',       dark: '#9ad0f2', light: '#12639f' },
    { id: 'teal',     name: 'Teal',      dark: '#7cd9d0', light: '#0d7873' },
    { id: 'mint',     name: 'Mint',      dark: '#93ddb4', light: '#1f7548' },
    { id: 'sage',     name: 'Sage',      dark: '#bcd3a4', light: '#4d6f31' }
  ];
  const inkOf = id => PALETTE.find(p => p.id === id) || PALETTE[2];   // amber default
  function savedInk() { try { return localStorage.getItem(IN_KEY) || 'amber'; } catch { return 'amber'; } }
  function applyInk(id) {
    const c = inkOf(id);
    // both values are set; the stylesheet picks per theme, so switching
    // light/dark keeps the chosen colour readable without re-picking.
    document.documentElement.style.setProperty('--hook-ink', c.dark);
    document.documentElement.style.setProperty('--hook-ink-light', c.light);
    try { localStorage.setItem(IN_KEY, id); } catch {}
  }
  function inkPickerHTML() {
    const cur = savedInk();
    return `<div class="hk-ink" title="Reading colour for the hooks">
      <span class="hk-ink-label">Colour</span>
      ${PALETTE.map(p => `<button class="hk-swatch ${p.id === cur ? 'active' : ''}" data-ink="${p.id}"
        title="${p.name}" aria-label="${p.name}"><span style="background:${p.dark}"></span></button>`).join('')}
    </div>`;
  }

  /* ---------------- index ---------------- */

  async function build(force) {
    if (force && typeof Cache !== 'undefined') Cache.bust(KEY);
    const loader = async () => {
      const papers = await Data.publishedPapers();
      let tags = {};
      try { ((await Backend.listQuestionTags?.()) || []).forEach(t => tags[t.questionKey] = t); } catch { /* untagged is fine */ }
      const out = [];
      for (const p of papers) {
        let loaded; try { loaded = await Data.loadPaper(p.id); } catch { continue; }
        const paperTitle = loaded.paper.topic || loaded.meta.title || p.title;
        for (const kind of ['SBA', 'EMQ']) {
          for (const q of Data.flatten(loaded.paper, kind)) {
            if (!q.hook || !String(q.hook).trim()) continue;      // only real hooks
            const qkey = `${p.id}:${kind}:${q.number}`;
            const tg = tags[qkey];
            out.push({
              qkey, kind,
              hook: String(q.hook).trim(),
              rationale: q.rationale || '',
              // the AI tag is the meaningful topic; the paper is the fallback
              topic: (tg?.topic || '').trim() || paperTitle,
              tagged: !!tg?.topic,
              paper: paperTitle,
              q: { stem: q.stem || '', lead: q.lead || '', theme: q.theme || '', options: q.options || [], answer: q.answer, preLettered: !!q.preLettered, reference: q.reference || '' }
            });
          }
        }
      }
      return out;
    };
    index = (typeof Cache !== 'undefined') ? await Cache.wrap(KEY, TTL, loader) : await loader();
    return index;
  }

  function decks(list) {
    const map = new Map();
    for (const h of list) {
      const k = h.topic;
      if (!map.has(k)) map.set(k, { topic: k, tagged: h.tagged, hooks: [] });
      map.get(k).hooks.push(h);
    }
    // biggest decks first — that is where the revision value is
    return [...map.values()].sort((a, b) => b.hooks.length - a.hooks.length || a.topic.localeCompare(b.topic));
  }

  /* ---------------- render ---------------- */

  const norm = s => String(s || '').toLowerCase();
  function matches(h, terms) {
    if (!terms.length) return true;
    const hay = norm(h.hook + ' ' + h.rationale + ' ' + h.topic + ' ' + h.paper + ' ' + h.q.stem);
    return terms.every(t => hay.includes(t));      // AND, like the question-bank search
  }

  function hookHTML(h, i) {
    return `<div class="hk-item" data-hi="${i}">
      <p class="hk-text">💡 ${esc(h.hook)}</p>
      <div class="hk-btns">
        ${h.rationale ? `<button class="hk-btn" data-show="rat">Rationale</button>` : ''}
        <button class="hk-btn" data-show="q">Question</button>
        <span class="hk-src">${esc(h.paper)}</span>
      </div>
      <div class="hk-reveal" hidden></div>
    </div>`;
  }

  function rationaleHTML(h) { return `<div class="hk-rat">${esc(h.rationale)}</div>`; }
  function questionHTML(h) {
    const q = h.q;
    const opts = (q.options || []).map((o, i) => `
      <li class="${i === q.answer ? 'is-answer' : ''}">${q.preLettered ? '' : `<span class="hk-let">${LETTERS[i]}</span>`}<span>${esc(o)}</span>${i === q.answer ? '<span class="hk-tick">✓</span>' : ''}</li>`).join('');
    return `<div class="hk-q">
      ${q.theme ? `<p class="hk-q-theme">${esc(q.theme)}</p>` : ''}
      <p class="hk-q-stem">${esc(q.stem)}</p>
      ${q.lead ? `<p class="hk-q-lead">${esc(q.lead)}</p>` : ''}
      ${opts ? `<ol class="hk-q-opts">${opts}</ol>` : ''}
      ${q.reference ? `<p class="hk-q-ref">§ ${esc(q.reference)}</p>` : ''}
    </div>`;
  }

  /**
   * Renders the hook library into `host`. Self-contained: owns its own
   * search, deck expansion and reveal state.
   */
  async function render(host) {
    host.innerHTML = `<div class="hk-loading"><p class="muted">Gathering memory hooks from the question bank…</p></div>`;
    let list;
    try { list = await build(); } catch { list = []; }
    if (!list.length) {
      host.innerHTML = `<p class="muted">No memory hooks found yet. Hooks appear here as questions carrying a 💡 hook are published.</p>`;
      return;
    }

    const open = new Set();
    let terms = [];

    host.innerHTML = `
      <div class="hk-toolbar">
        <div class="lib-search hk-search">
          <span class="lib-search-ico">⌕</span>
          <input type="search" id="hk-q" placeholder="Search hooks, rationales or topics… e.g. eclampsia, PPH, 53%" autocomplete="off">
        </div>
        <span class="hk-count" id="hk-count"></span>
        <button class="btn btn-ghost btn-sm" id="hk-expand">Expand all</button>
        <button class="btn btn-ghost btn-sm" id="hk-refresh" title="Rebuild from the latest published papers">↻</button>
      </div>
      ${inkPickerHTML()}
      <div id="hk-decks"></div>`;

    applyInk(savedInk());
    host.querySelector('.hk-ink').addEventListener('click', e => {
      const b = e.target.closest('[data-ink]'); if (!b) return;
      applyInk(b.dataset.ink);
      host.querySelectorAll('.hk-swatch').forEach(s => s.classList.toggle('active', s === b));
    });

    const decksEl = host.querySelector('#hk-decks');
    const countEl = host.querySelector('#hk-count');

    function draw() {
      const filtered = list.filter(h => matches(h, terms));
      const ds = decks(filtered);
      countEl.textContent = `${filtered.length} hook${filtered.length === 1 ? '' : 's'} · ${ds.length} topic${ds.length === 1 ? '' : 's'}`;
      if (!ds.length) { decksEl.innerHTML = `<p class="muted hk-empty">No hooks match that search.</p>`; return; }
      // when searching, open every matching deck — you want to see the hits
      const autoOpen = terms.length > 0;
      decksEl.innerHTML = `<div class="hk-decks">${ds.map(d => {
        const isOpen = autoOpen || open.has(d.topic);
        return `<section class="hk-deck ${isOpen ? 'is-open' : ''}" data-topic="${esc(d.topic)}">
          <button class="hk-deck-head" data-deck>
            <span class="hk-deck-ico">💡</span>
            <span class="hk-deck-title">${esc(d.topic)}</span>
            ${d.tagged ? '' : '<span class="hk-deck-untagged" title="Grouped by paper — this topic is not AI-tagged yet">paper</span>'}
            <span class="hk-deck-n">${d.hooks.length}</span>
            <span class="hk-deck-caret">▸</span>
          </button>
          <div class="hk-deck-body" ${isOpen ? '' : 'hidden'}>${isOpen ? d.hooks.map((h, i) => hookHTML(h, list.indexOf(h))).join('') : ''}</div>
        </section>`;
      }).join('')}</div>`;
      decksEl.dataset.filtered = JSON.stringify([]);   // reveal state resets per redraw
    }

    // one delegated handler for decks and per-hook reveals
    decksEl.addEventListener('click', e => {
      const head = e.target.closest('[data-deck]');
      if (head) {
        const sec = head.closest('.hk-deck');
        const topic = sec.dataset.topic;
        const body = sec.querySelector('.hk-deck-body');
        const nowOpen = body.hidden;
        if (nowOpen) {
          open.add(topic);
          const hooks = list.filter(h => h.topic === topic && matches(h, terms));
          body.innerHTML = hooks.map(h => hookHTML(h, list.indexOf(h))).join('');
          body.hidden = false; sec.classList.add('is-open');
        } else {
          open.delete(topic);
          body.hidden = true; body.innerHTML = ''; sec.classList.remove('is-open');
        }
        return;
      }
      const btn = e.target.closest('[data-show]');
      if (!btn) return;
      const item = btn.closest('.hk-item');
      const h = list[Number(item.dataset.hi)];
      const box = item.querySelector('.hk-reveal');
      const want = btn.dataset.show;
      if (box.dataset.showing === want) {              // toggle off
        box.hidden = true; box.innerHTML = ''; box.dataset.showing = '';
        item.querySelectorAll('.hk-btn').forEach(b => b.classList.remove('active'));
        return;
      }
      box.dataset.showing = want;
      box.innerHTML = want === 'rat' ? rationaleHTML(h) : questionHTML(h);
      box.hidden = false;
      item.querySelectorAll('.hk-btn').forEach(b => b.classList.toggle('active', b === btn));
    });

    let t = null;
    host.querySelector('#hk-q').addEventListener('input', e => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => { terms = norm(v).split(/\s+/).filter(Boolean); draw(); }, 160);
    });
    host.querySelector('#hk-expand').addEventListener('click', e => {
      const all = decks(list.filter(h => matches(h, terms)));
      const expanding = open.size < all.length;
      open.clear();
      if (expanding) all.forEach(d => open.add(d.topic));
      e.target.textContent = expanding ? 'Collapse all' : 'Expand all';
      draw();
    });
    host.querySelector('#hk-refresh').addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = '…';
      list = await build(true);
      e.target.disabled = false; e.target.textContent = '↻';
      draw();
    });

    draw();
  }

  return { render, build };
})();
