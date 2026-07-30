/* ============================================================
   tearoom.js — the shared study chat.

   One module, two surfaces, one state:
     • the Studio → Tea room panel (full page), and
     • a floating dock that can sit over ANY page — including a
       running paper — so a thought can be posted without leaving
       the question.

   Design decisions worth knowing:
     • LIVE, not reload-driven. A single incremental poll asks only
       for rows newer than the last check, so a quiet board costs two
       near-empty queries. Polling backs off when the tab is hidden,
       slows right down when nothing is open, and stops while muted.
     • UNREAD is derived, not stored server-side: every thread/reply
       carries a timestamp, and "seen up to" lives in localStorage.
       No extra table, no write amplification, works offline.
     • MUTE is a study tool. During a mock the dock goes quiet — no
       badge, no polling — until the chosen time passes.
     • Threads carry the WHOLE question (stem, options, answer,
       rationale, hook), collapsed by default so the board stays
       scannable and expandable when a discussion needs the detail.
   ============================================================ */

const TeaRoom = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LETTERS = 'ABCDEFGHIJKLMNOPQRST';

  const SEEN_KEY = 'aureum.tea.seen';
  const MUTE_KEY = 'aureum.tea.mute';
  const OPEN_KEY = 'aureum.tea.dock';

  let threads = [];                 // newest first
  const replies = {};               // threadId → [reply]
  const openThreads = new Set();    // thread ids whose comments are expanded
  let loaded = false, loading = null;
  let pollTimer = null, lastPoll = null;
  let dockEl = null, dockOpen = false, dockMin = false;
  let panelHost = null;             // Studio panel mount, when on that page
  const listeners = new Set();      // badge subscribers

  /* ---------------- small helpers ---------------- */

  const now = () => Date.now();
  const ts = r => new Date(r.created_at || 0).getTime() || 0;
  function seenAt() { const v = Number(localStorage.getItem(SEEN_KEY) || 0); return v || 0; }
  function markSeen(t) { try { localStorage.setItem(SEEN_KEY, String(t || now())); } catch {} emit(); }
  function muteUntil() { const v = Number(localStorage.getItem(MUTE_KEY) || 0); return v > now() ? v : 0; }
  function setMute(ms) {
    try { ms ? localStorage.setItem(MUTE_KEY, String(now() + ms)) : localStorage.removeItem(MUTE_KEY); } catch {}
    emit(); schedule();
  }
  function relTime(iso) {
    const d = new Date(iso || 0).getTime(); if (!d) return '';
    const s = Math.floor((now() - d) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return new Date(d).toLocaleDateString();
  }
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  /* Deterministic avatar tint from the name — recognisable at a glance,
     the way every chat app colours its default avatars. */
  function tint(name) {
    let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 62% 46%)`;
  }

  /** Unread = anything newer than "seen", excluding my own posts. */
  function unreadCount() {
    if (muteUntil()) return 0;
    const since = seenAt(); if (!since) return 0;
    let n = 0;
    for (const t of threads) { if (!t.mine && ts(t) > since) n++; }
    for (const id in replies) for (const r of replies[id]) { if (!r.mine && ts(r) > since) n++; }
    return n;
  }
  function latestStamp() {
    let m = 0;
    for (const t of threads) m = Math.max(m, ts(t));
    for (const id in replies) for (const r of replies[id]) m = Math.max(m, ts(r));
    return m;
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach(fn => { try { fn(unreadCount()); } catch {} }); }

  /* ---------------- data ---------------- */

  async function ensureLoaded(force) {
    if (loaded && !force) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        threads = (await Backend.listDiscussions?.()) || [];
        threads.sort((a, b) => ts(b) - ts(a));
        loaded = true;
        lastPoll = new Date(Math.max(latestStamp(), now() - 60000)).toISOString();
        if (!seenAt()) markSeen(latestStamp() || now());     // first run: start clean
      } catch { threads = []; }
      loading = null;
    })();
    return loading;
  }

  async function loadReplies(id, force) {
    if (replies[id] && !force) return replies[id];
    try { replies[id] = (await Backend.listDiscussionReplies?.(id)) || []; }
    catch { replies[id] = []; }
    return replies[id];
  }

  /** One incremental round-trip; merges anything new and repaints. */
  async function poll() {
    if (!loaded || !Backend.pollDiscussions) return;
    let out;
    try { out = await Backend.pollDiscussions(lastPoll); } catch { return; }
    let changed = false;
    for (const t of (out.threads || [])) {
      if (!threads.some(x => x.id === t.id)) { threads.unshift(t); changed = true; }
    }
    for (const r of (out.replies || [])) {
      const list = replies[r.discussion_id];
      if (list) { if (!list.some(x => x.id === r.id)) { list.push(r); changed = true; } }
      else {
        // comments we haven't opened: keep the counter honest without fetching
        const th = threads.find(x => x.id === r.discussion_id);
        if (th) { th.reply_count = (th.reply_count || 0) + 1; changed = true; }
      }
    }
    if (changed) {
      threads.sort((a, b) => ts(b) - ts(a));
      lastPoll = new Date(Math.max(latestStamp(), Date.parse(lastPoll) || 0)).toISOString();
      repaint();
      emit();
    }
  }

  /* Adaptive cadence: fast while you're reading it, slow when it's only
     feeding the badge, off while hidden or muted — battery and egress both. */
  function interval() {
    if (document.hidden || muteUntil()) return 0;
    if ((dockOpen && !dockMin) || panelHost) return 20000;
    return 75000;
  }
  function schedule() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    const ms = interval(); if (!ms) return;
    pollTimer = setInterval(poll, ms);
  }

  async function init() {
    if (!Backend.listDiscussions) return;
    await ensureLoaded();
    emit(); schedule();
    document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden) poll(); });
    if (localStorage.getItem(OPEN_KEY) === '1') openDock();
  }

  /* ---------------- posting ---------------- */

  async function post(payload) {
    const row = await Backend.addDiscussion(payload);
    threads.unshift(row);
    replies[row.id] = [];
    markSeen(Math.max(ts(row), seenAt()));
    repaint();
    return row;
  }
  async function reply(threadId, body) {
    const row = await Backend.addDiscussionReply(threadId, body);
    (replies[threadId] || (replies[threadId] = [])).push(row);
    const th = threads.find(t => t.id === threadId);
    if (th) th.reply_count = (replies[threadId] || []).length;
    markSeen(Math.max(ts(row), seenAt()));
    repaint();
    return row;
  }

  /** Called by the "Discuss with friends" button under a rationale. */
  async function share(ctx, topic) {
    return post({
      questionKey: ctx.questionKey, paperTitle: ctx.paperTitle,
      answerText: ctx.answerText, rationale: ctx.rationale,
      question: ctx.question || null, topic
    });
  }

  /* ---------------- rendering ---------------- */

  function questionCardHTML(t) {
    const q = t.question;
    if (!q) {
      // legacy thread (answer-only) — still render what we kept
      if (!t.answer_text && !t.rationale) return '';
      return `<div class="tr-q"><div class="tr-q-body">
        ${t.answer_text ? `<p class="tr-q-ans"><b>Answer:</b> ${esc(t.answer_text)}</p>` : ''}
        ${t.rationale ? `<p class="tr-q-rat">${esc(t.rationale)}</p>` : ''}</div></div>`;
    }
    const opts = (q.options || []).map((o, i) => `
      <li class="${i === q.answer ? 'is-answer' : ''}">
        ${q.preLettered ? '' : `<span class="tr-q-let">${LETTERS[i]}</span>`}<span>${esc(o)}</span>
        ${i === q.answer ? '<span class="tr-q-tick">✓</span>' : ''}
      </li>`).join('');
    return `<details class="tr-q">
      <summary><span class="tr-q-kind">${esc(q.kind || 'SBA')}</span>${esc(t.paper_title || '')}<span class="tr-q-more">show question</span></summary>
      <div class="tr-q-body">
        ${q.theme ? `<p class="tr-q-theme">${esc(q.theme)}</p>` : ''}
        <p class="tr-q-stem">${esc(q.stem || '')}</p>
        ${q.lead ? `<p class="tr-q-lead">${esc(q.lead)}</p>` : ''}
        ${opts ? `<ol class="tr-q-opts">${opts}</ol>` : ''}
        ${q.rationale ? `<p class="tr-q-rat">${esc(q.rationale)}</p>` : ''}
        ${q.hook ? `<p class="tr-q-hook">💡 ${esc(q.hook)}</p>` : ''}
        ${q.reference ? `<p class="tr-q-ref">§ ${esc(q.reference)}</p>` : ''}
      </div>
    </details>`;
  }

  function threadCardHTML(t, compact) {
    const list = replies[t.id];
    const n = list ? list.length : (t.reply_count || 0);
    const open = openThreads.has(t.id);
    const fresh = !t.mine && ts(t) > seenAt();
    return `<article class="tr-card ${compact ? 'is-compact' : ''} ${fresh ? 'is-new' : ''}" data-tid="${esc(t.id)}">
      <header class="tr-head">
        <span class="tr-av" style="background:${tint(t.author_name)}">${esc(initials(t.author_name))}</span>
        <span class="tr-who">${esc(t.author_name || 'A friend')}</span>
        <span class="tr-time">${esc(relTime(t.created_at))}</span>
        ${t.mine ? `<button class="tr-del" data-act="del-thread" title="Delete">🗑</button>` : ''}
      </header>
      <p class="tr-topic">${esc(t.topic)}</p>
      ${questionCardHTML(t)}
      <div class="tr-actions">
        <button class="tr-link" data-act="toggle">${open ? '▾ Hide' : '▸ '}${n ? `${n} ${n === 1 ? 'comment' : 'comments'}` : 'Comment'}</button>
      </div>
      <div class="tr-comments" ${open ? '' : 'hidden'}></div>
    </article>`;
  }

  function commentsHTML(id) {
    const list = replies[id] || [];
    return `
      ${list.length ? list.map(r => `
        <div class="tr-cm ${!r.mine && ts(r) > seenAt() ? 'is-new' : ''}">
          <span class="tr-av sm" style="background:${tint(r.author_name)}">${esc(initials(r.author_name))}</span>
          <div class="tr-cm-body">
            <div class="tr-cm-bubble"><span class="tr-who">${esc(r.author_name || 'A friend')}</span><p>${esc(r.body)}</p></div>
            <div class="tr-cm-meta"><span>${esc(relTime(r.created_at))}</span>${r.mine ? `<button class="tr-link" data-act="del-reply" data-rid="${esc(r.id)}">delete</button>` : ''}</div>
          </div>
        </div>`).join('') : '<p class="tr-empty">No comments yet — start the discussion.</p>'}
      <div class="tr-cm-new">
        <textarea rows="1" placeholder="Write a comment…  (Enter to send, Shift+Enter for a new line)"></textarea>
        <button class="tr-send" data-act="send" title="Send">➤</button>
      </div>`;
  }

  function listHTML(compact) {
    if (!threads.length) return `<p class="tr-empty big">The tea room is quiet.<br>Start a topic, or tap ☕ <b>Discuss with friends</b> under any question's explanation.</p>`;
    return threads.map(t => threadCardHTML(t, compact)).join('');
  }

  function composerHTML() {
    return `<div class="tr-new">
      <textarea id="tr-new-text" rows="1" placeholder="Start a discussion…"></textarea>
      <button class="btn btn-gold btn-sm" data-act="new">Post</button>
    </div>`;
  }

  function muteBarHTML() {
    const u = muteUntil();
    if (u) {
      const mins = Math.max(1, Math.round((u - now()) / 60000));
      return `<div class="tr-muted-bar">🔕 Muted for ~${mins} min <button class="tr-link" data-act="unmute">unmute</button></div>`;
    }
    return `<div class="tr-mute-row">
      <span class="tr-mute-label">🔔 Mute</span>
      ${[['30m', 30], ['1h', 60], ['3h', 180]].map(([l, m]) => `<button class="tr-chip" data-act="mute" data-m="${m}">${l}</button>`).join('')}
    </div>`;
  }

  /* ---------------- shared wiring (panel + dock use one code path) --------- */

  function paintInto(root, compact) {
    const body = root.querySelector('[data-tr-list]');
    if (!body) return;
    const scroll = body.scrollTop;
    body.innerHTML = listHTML(compact);
    body.scrollTop = scroll;
    // re-open any expanded comment sections
    openThreads.forEach(id => {
      const card = body.querySelector(`[data-tid="${CSS.escape(id)}"] .tr-comments`);
      if (card) { card.hidden = false; card.innerHTML = commentsHTML(id); }
    });
    const mute = root.querySelector('[data-tr-mute]');
    if (mute) mute.innerHTML = muteBarHTML();
  }

  function repaint() {
    if (panelHost && document.body.contains(panelHost)) paintInto(panelHost, false);
    if (dockEl && dockOpen) {
      paintInto(dockEl, true);
      const b = dockEl.querySelector('.tr-dock-count');
      if (b) { const n = unreadCount(); b.textContent = n || ''; b.hidden = !n; }
    }
    updateLauncher();
  }

  function wire(root, compact) {
    if (root.dataset.trWired === '1') return;      // attach ONCE per surface
    root.dataset.trWired = '1';

    root.addEventListener('click', async e => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const act = btn.dataset.act;
      const card = btn.closest('[data-tid]');
      const id = card?.dataset.tid;

      if (act === 'mute') { setMute(Number(btn.dataset.m) * 60000); repaint(); return; }
      if (act === 'unmute') { setMute(0); repaint(); return; }

      if (act === 'new') {
        const ta = root.querySelector('#tr-new-text, .tr-new textarea');
        const text = ta.value.trim(); if (!text) return;
        btn.disabled = true;
        try { await post({ topic: text }); ta.value = ''; autoGrow(ta); }
        catch (err) { alert('Could not post: ' + (err.message || err)); }
        btn.disabled = false; return;
      }
      if (act === 'toggle') {
        const box = card.querySelector('.tr-comments');
        if (openThreads.has(id)) { openThreads.delete(id); box.hidden = true; box.innerHTML = ''; }
        else {
          openThreads.add(id); box.hidden = false;
          box.innerHTML = '<p class="tr-empty">Loading…</p>';
          await loadReplies(id);
          box.innerHTML = commentsHTML(id);
          markSeen(Math.max(latestStamp(), seenAt()));
        }
        btn.textContent = (openThreads.has(id) ? '▾ Hide ' : '▸ ') + (() => { const n = (replies[id] || []).length; return n ? `${n} ${n === 1 ? 'comment' : 'comments'}` : 'Comment'; })();
        return;
      }
      if (act === 'send') {
        const ta = card.querySelector('.tr-cm-new textarea');
        const body = ta.value.trim(); if (!body) return;
        btn.disabled = true;
        try { await reply(id, body); ta.value = ''; }
        catch (err) { alert('Could not comment: ' + (err.message || err)); }
        btn.disabled = false; return;
      }
      if (act === 'del-thread') {
        if (!confirm('Delete your post and all its comments?')) return;
        try { await Backend.deleteDiscussion(id); } catch {}
        threads = threads.filter(t => t.id !== id); delete replies[id]; openThreads.delete(id);
        repaint(); return;
      }
      if (act === 'del-reply') {
        const rid = btn.dataset.rid;
        try { await Backend.deleteDiscussionReply(id, rid); } catch {}
        replies[id] = (replies[id] || []).filter(r => r.id !== rid);
        const th = threads.find(t => t.id === id); if (th) th.reply_count = replies[id].length;
        card.querySelector('.tr-comments').innerHTML = commentsHTML(id);
        return;
      }
    });

    // Enter sends, Shift+Enter newlines — the convention every chat app uses
    root.addEventListener('keydown', e => {
      const ta = e.target;
      if (ta.tagName !== 'TEXTAREA' || e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const send = ta.closest('.tr-cm-new')?.querySelector('[data-act="send"]')
                || ta.closest('.tr-new')?.querySelector('[data-act="new"]');
      send?.click();
    });
    root.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') autoGrow(e.target); });
    // reading the room marks it read
    root.addEventListener('scroll', () => markSeen(Math.max(latestStamp(), seenAt())), { capture: true, passive: true });
  }

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; }

  /* ---------------- surface 1: the Studio panel ---------------- */

  async function renderPanel(host) {
    panelHost = host;
    host.innerHTML = `
      <div class="tr-surface tr-panel">
        <div class="tr-bar">
          <div data-tr-mute class="tr-mute-wrap"></div>
          <button class="btn btn-ghost btn-sm" data-act="pop">⧉ Pop out</button>
        </div>
        ${composerHTML()}
        <div class="tr-list" data-tr-list><p class="tr-empty">Loading…</p></div>
      </div>`;
    const root = host.querySelector('.tr-surface');
    wire(root, false);
    root.querySelector('[data-act="pop"]').addEventListener('click', () => { openDock(); });
    await ensureLoaded();
    paintInto(root, false);
    markSeen(Math.max(latestStamp(), seenAt()));
    schedule(); emit();
  }
  function releasePanel() { panelHost = null; schedule(); }

  /* ---------------- surface 2: the floating dock ----------------
     Fixed, self-contained, and below the quiz's idle overlay in the stack,
     so it can ride over a running paper without ever covering an exam
     dialog or stealing the runner's keyboard shortcuts.            */

  function ensureDock() {
    if (dockEl) return dockEl;
    dockEl = document.createElement('div');
    dockEl.className = 'tr-dock';
    dockEl.innerHTML = `
      <div class="tr-surface">
        <header class="tr-dock-head">
          <span class="tr-dock-title">☕ Tea room <span class="tr-dock-count" hidden></span></span>
          <button class="tr-icon" data-dock="min" title="Minimise">—</button>
          <button class="tr-icon" data-dock="close" title="Close">✕</button>
        </header>
        <div class="tr-dock-body">
          <div data-tr-mute class="tr-mute-wrap"></div>
          ${composerHTML()}
          <div class="tr-list" data-tr-list></div>
        </div>
      </div>`;
    document.body.appendChild(dockEl);
    const root = dockEl.querySelector('.tr-surface');
    wire(root, true);
    dockEl.querySelector('[data-dock="min"]').addEventListener('click', () => {
      dockMin = !dockMin; dockEl.classList.toggle('is-min', dockMin); schedule();
    });
    dockEl.querySelector('[data-dock="close"]').addEventListener('click', closeDock);
    return dockEl;
  }

  async function openDock() {
    ensureDock();
    dockOpen = true; dockMin = false;
    dockEl.classList.add('is-open'); dockEl.classList.remove('is-min');
    try { localStorage.setItem(OPEN_KEY, '1'); } catch {}
    await ensureLoaded();
    paintInto(dockEl, true);
    markSeen(Math.max(latestStamp(), seenAt()));
    schedule(); emit();
  }
  function closeDock() {
    dockOpen = false;
    dockEl?.classList.remove('is-open');
    try { localStorage.removeItem(OPEN_KEY); } catch {}
    schedule(); updateLauncher();
  }
  function toggleDock() { dockOpen ? closeDock() : openDock(); }

  /* ---------------- launcher bubble ---------------- */

  let launcher = null;
  function ensureLauncher() {
    if (launcher) return launcher;
    launcher = document.createElement('button');
    launcher.className = 'tr-launch';
    launcher.title = 'Tea room';
    launcher.innerHTML = `<span class="tr-launch-ico">☕</span><span class="tr-launch-badge" hidden></span>`;
    launcher.addEventListener('click', toggleDock);
    document.body.appendChild(launcher);
    return launcher;
  }
  function updateLauncher() {
    const el = ensureLauncher();
    const n = unreadCount();
    el.classList.toggle('is-hidden', dockOpen);
    el.classList.toggle('is-muted', !!muteUntil());
    const b = el.querySelector('.tr-launch-badge');
    b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
  }
  function mountLauncher() { ensureLauncher(); updateLauncher(); }
  function unmountLauncher() { launcher?.remove(); launcher = null; closeDock(); dockEl?.remove(); dockEl = null; }

  return {
    init, onChange, unreadCount, renderPanel, releasePanel,
    openDock, closeDock, toggleDock, mountLauncher, unmountLauncher,
    share, post, setMute, muteUntil
  };
})();
