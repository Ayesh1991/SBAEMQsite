/* ============================================================
   tearoom.js — the study社 platform: a WALL and a CHAT.

   Two surfaces, one live state, both able to float over any page
   (including a running paper) so a thought never costs you your place:

     • WALL — a feed of posts. Text, photos, screenshots and files;
       a question posted from "Discuss with friends" arrives as a
       rich card carrying the whole stem, options and rationale.
       Reactions on the row, comments in a popup, replies nested one
       level, exactly the shape people already know from Facebook.
     • CHAT — direct and group rooms in the Messenger/WhatsApp idiom:
       bubbles, own-vs-other alignment, per-room unread, media.

   Live-ness is a single incremental poll per surface asking only for
   rows newer than the last check, so a quiet platform is nearly free.
   The interval is set by the developer (Tea room controller) and can
   go down to 1s; it still backs off when the tab is hidden or muted.

   Notifications are DERIVED, never stored: each row carries a
   timestamp and "seen up to" lives on the device. That means no extra
   table, no write amplification, and it works offline.
   ============================================================ */

const TeaRoom = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LETTERS = 'ABCDEFGHIJKLMNOPQRST';

  const SEEN_KEY = 'aureum.tea.seen';
  const MUTE_KEY = 'aureum.tea.mute';
  const CHAT_SEEN = 'aureum.chat.seen';
  const NOTIF_KEY = 'aureum.tea.desktopNotif';

  /* ---------------- state ---------------- */

  let posts = [];                     // newest first
  const comments = {};                // postId → [reply]
  const openPosts = new Set();
  let myRx = {};                      // postId → emoji
  let loaded = false, loading = null, moreAvailable = false;
  const PAGE = 25;

  let rooms = [], activeRoom = null, roomMsgs = {}, lastChatPoll = null;
  let me = null;
  let cards = {};                     // userId → { name, avatar }

  let pollTimer = null, lastPoll = null;
  let wallEl = null, chatEl = null;
  let wallOpen = false, chatOpen = false;
  let panelHost = null;
  const listeners = new Set();

  /* ---------------- config (developer-controlled) ---------------- */

  const DEFAULTS = { intervalOpen: 20, intervalIdle: 75, maxUploadMb: 8, desktopNotif: true, wallEnabled: true, chatEnabled: true };
  let cfg = { ...DEFAULTS };
  async function loadCfg() {
    try {
      const saved = (typeof Cache !== 'undefined')
        ? await Cache.wrap('tearoom-cfg', 60000, () => Backend.getTeaConfig?.())
        : await Backend.getTeaConfig?.();
      if (saved && typeof saved === 'object') cfg = { ...DEFAULTS, ...saved };
    } catch { /* defaults are fine */ }
    return cfg;
  }
  function config() { return cfg; }

  /* ---------------- helpers ---------------- */

  const now = () => Date.now();
  const ts = r => new Date(r.created_at || 0).getTime() || 0;
  const num = v => Number(v) || 0;
  /* Seen marks are mirrored to the profile row, so clearing the badge on the
     iPad clears it on the laptop too. The local copy is the fast path; the
     server copy is the truth we merge in on load and on every poll. */
  let remoteSeen = { wall: 0, chat: 0 };
  let pushSeenT = null;
  function seenAt() { return Math.max(num(localStorage.getItem(SEEN_KEY)), num(remoteSeen.wall)); }
  function chatSeenAt() { return Math.max(num(localStorage.getItem(CHAT_SEEN)), num(remoteSeen.chat)); }
  function pushSeen(patch) {
    Object.assign(remoteSeen, patch);
    clearTimeout(pushSeenT);
    pushSeenT = setTimeout(() => { try { Backend.setNotifSeen?.(remoteSeen); } catch {} }, 1200);
  }
  function markSeen(t) {
    const v = Math.max(t || now(), seenAt());
    try { localStorage.setItem(SEEN_KEY, String(v)); } catch {}
    pushSeen({ wall: v }); emit();
  }
  function markChatSeen(t) {
    const v = Math.max(t || now(), chatSeenAt());
    try { localStorage.setItem(CHAT_SEEN, String(v)); } catch {}
    pushSeen({ chat: v }); emit();
  }
  async function syncSeen() {
    try {
      const r = (await Backend.getNotifSeen?.()) || {};
      remoteSeen = { wall: Math.max(num(r.wall), num(remoteSeen.wall)), chat: Math.max(num(r.chat), num(remoteSeen.chat)) };
    } catch {}
    emit();
  }
  function muteUntil() { const v = num(localStorage.getItem(MUTE_KEY)); return v > now() ? v : 0; }
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
  /** Avatar chip: real picture when the member has uploaded one, initials otherwise. */
  function av(userId, name, small) {
    const c = cards[userId] || {};
    const nm = c.name || name || '?';
    const cls = 'tr-av' + (small ? ' sm' : '');
    return c.avatar
      ? `<img class="${cls} is-photo" src="${esc(c.avatar)}" alt="${esc(nm)}" loading="lazy">`
      : `<span class="${cls}" style="background:${tint(nm)}">${esc(initials(nm))}</span>`;
  }
  function tint(name) { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 62% 46%)`; }
  const isImg = m => /^image\//.test(m?.type || '') || /\.(png|jpe?g|gif|webp|avif)$/i.test(m?.name || '');
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  function unreadWall() {
    if (muteUntil()) return 0;
    const since = seenAt(); if (!since) return 0;
    let n = 0;
    for (const p of posts) if (!p.mine && ts(p) > since) n++;
    for (const id in comments) for (const c of comments[id]) if (!c.mine && ts(c) > since) n++;
    return n;
  }
  function unreadChat() {
    if (muteUntil()) return 0;
    const since = chatSeenAt(); if (!since) return 0;
    let n = 0;
    for (const rid in roomMsgs) for (const m of roomMsgs[rid]) if (!m.mine && ts(m) > since) n++;
    return n;
  }
  const unreadCount = () => unreadWall() + unreadChat();
  function latestStamp() {
    let m = 0;
    for (const p of posts) m = Math.max(m, ts(p));
    for (const id in comments) for (const c of comments[id]) m = Math.max(m, ts(c));
    return m;
  }
  function latestChatStamp() {
    let m = 0;
    for (const rid in roomMsgs) for (const x of roomMsgs[rid]) m = Math.max(m, ts(x));
    return m;
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach(fn => { try { fn(unreadCount()); } catch {} }); }

  /* ---------------- desktop notifications ---------------- */

  function notifAllowed() {
    try { return localStorage.getItem(NOTIF_KEY) !== '0' && cfg.desktopNotif !== false; } catch { return true; }
  }
  function setNotif(on) { try { localStorage.setItem(NOTIF_KEY, on ? '1' : '0'); } catch {} }
  async function askNotifPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
  }
  /** Fire a real OS notification, but never while muted or on your own posts. */
  function notify(title, body, onClick) {
    if (muteUntil()) return;
    toast(title, body, onClick);            // always: works on every device
    if (!notifAllowed()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body: String(body || '').slice(0, 160), tag: 'aureum-tea-' + Date.now(), icon: 'assets/logo-mark-192.png' });
      n.onclick = () => { window.focus(); try { onClick?.(); } catch {} n.close(); };
    } catch {}
  }

  /* ---------------- data ---------------- */

  async function ensureLoaded(force) {
    if (loaded && !force) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        me = me || await Backend.currentUser().catch(() => null);
        posts = (await Backend.listDiscussions?.({ limit: PAGE })) || [];
        moreAvailable = posts.length >= PAGE;
        posts.sort((a, b) => ts(b) - ts(a));
        myRx = (await Backend.myReactions?.(posts.map(p => p.id))) || {};
        loaded = true;
        lastPoll = new Date(Math.max(latestStamp(), now() - 60000)).toISOString();
        if (!seenAt()) markSeen(latestStamp() || now());
      } catch { posts = []; }
      loading = null;
    })();
    return loading;
  }
  async function loadComments(id, force) {
    if (comments[id] && !force) return comments[id];
    try { comments[id] = (await Backend.listDiscussionReplies?.(id)) || []; } catch { comments[id] = []; }
    return comments[id];
  }
  async function loadRooms() {
    try { rooms = (await Backend.listChatRooms?.()) || []; } catch { rooms = []; }
    // names come from the cards map; make sure it covers everyone in these rooms
    const missing = rooms.flatMap(r => (r.members || []).map(m => m.user_id)).some(id => id && !cards[id]);
    if (missing) { try { cards = { ...cards, ...((await Backend.listMemberCards?.()) || {}) }; } catch {} }
    return rooms;
  }

  async function poll() {
    if (!loaded) return;
    let changed = false;
    // ---- wall ----
    try {
      const out = await Backend.pollDiscussions?.(lastPoll);
      for (const p of (out?.threads || [])) if (!posts.some(x => x.id === p.id)) {
        posts.unshift(p); changed = true;
        if (!p.mine) notify(`${p.author_name || 'A friend'} posted`, p.topic, () => openWall());
      }
      for (const c of (out?.replies || [])) {
        const list = comments[c.discussion_id];
        if (list) { if (!list.some(x => x.id === c.id)) { list.push(c); changed = true; } }
        else { const p = posts.find(x => x.id === c.discussion_id); if (p) { p.reply_count = (p.reply_count || 0) + 1; if (!c.mine) p._newCm = true; changed = true; } }
        // a comment on YOUR post is the notification people actually want
        const parent = posts.find(x => x.id === c.discussion_id);
        if (!c.mine && parent?.mine) notify(`${c.author_name || 'Someone'} commented on your post`, c.body, () => { openWall(); openComments(c.discussion_id); });
      }
      if (out?.threads?.length || out?.replies?.length) {
        lastPoll = new Date(Math.max(latestStamp(), Date.parse(lastPoll) || 0)).toISOString();
      }
    } catch {}
    // ---- chat ----
    try {
      const msgs = await Backend.pollChat?.(lastChatPoll);
      for (const m of (msgs || [])) {
        const list = roomMsgs[m.room_id] || (roomMsgs[m.room_id] = []);
        if (!list.some(x => x.id === m.id)) {
          list.push(m); changed = true;
          if (!m.mine) {
            const r = rooms.find(x => x.id === m.room_id);
            notify(`${m.author_name || 'New message'}${r?.title ? ' · ' + r.title : ''}`, m.body, () => openChat(m.room_id));
          }
        }
      }
      if (msgs?.length) lastChatPoll = new Date(Math.max(latestChatStamp(), Date.parse(lastChatPoll) || 0)).toISOString();
    } catch {}
    if (changed) { posts.sort((a, b) => ts(b) - ts(a)); repaint(); emit(); }
    // another device may have read things — pull the shared seen mark in
    if ((poll._n = (poll._n || 0) + 1) % 6 === 0) syncSeen();
  }

  function interval() {
    if (document.hidden || muteUntil()) return 0;
    const open = (wallOpen || chatOpen || panelHost);
    return Math.max(1, num(open ? cfg.intervalOpen : cfg.intervalIdle) || (open ? 20 : 75)) * 1000;
  }
  function schedule() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    const ms = interval(); if (!ms) return;
    pollTimer = setInterval(poll, ms);
  }

  async function init() {
    if (!Backend.listDiscussions) return;
    await loadCfg();
    await syncSeen();
    try { cards = (await Backend.listMemberCards?.()) || {}; } catch { cards = {}; }
    await ensureLoaded();
    await loadRooms();
    lastChatPoll = new Date(now() - 60000).toISOString();
    if (notifAllowed()) askNotifPermission();
    emit(); schedule();
    document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden) poll(); });
  }

  /* ---------------- posting ---------------- */

  async function post(payload) {
    const row = await Backend.addDiscussion(payload);
    posts.unshift(row); comments[row.id] = [];
    markSeen(Math.max(ts(row), seenAt()));
    repaint();
    return row;
  }
  async function comment(postId, body, opts) {
    const row = await Backend.addDiscussionReply(postId, body, opts);
    (comments[postId] || (comments[postId] = [])).push(row);
    const p = posts.find(x => x.id === postId);
    if (p) p.reply_count = (comments[postId] || []).length;
    markSeen(Math.max(ts(row), seenAt()));
    repaint();
    return row;
  }
  /** Called by the "Discuss with friends" button under a rationale. */
  async function share(ctx, topic) {
    const row = await post({
      questionKey: ctx.questionKey, paperTitle: ctx.paperTitle, answerText: ctx.answerText,
      rationale: ctx.rationale, question: ctx.question || null, topic, kind: 'question'
    });
    openWall();
    return row;
  }
  async function react(postId, on) {
    try { await Backend.setReaction?.(postId, on); } catch {}
    if (on) myRx[postId] = '👍'; else delete myRx[postId];
    const p = posts.find(x => x.id === postId);
    if (p) p.reaction_count = Math.max(0, (p.reaction_count || 0) + (on ? 1 : -1));
    repaint();
  }

  /* ---------------- uploads ---------------- */

  async function pickFiles(accept) {
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.multiple = true; if (accept) i.accept = accept;
      i.onchange = () => res([...i.files]);
      i.click();
    });
  }
  async function uploadAll(files, onProgress) {
    const max = (num(cfg.maxUploadMb) || 8) * 1048576;
    const out = [];
    for (const f of files) {
      if (f.size > max) { alert(`"${f.name}" is larger than the ${cfg.maxUploadMb} MB limit.`); continue; }
      onProgress?.(f.name);
      try { out.push(await Backend.uploadTeaFile(f)); } catch (e) { alert(e.message || e); }
    }
    return out;
  }

  /* ---------------- paste & drag-drop ----------------
     A screenshot is the single most useful thing to share in exam prep, and
     nobody wants a file dialog for it. Any composer accepts:
       • Cmd/Ctrl-V of an image straight off the clipboard,
       • pasted rich text (kept as plain text, so a pasted paragraph from a
         guideline arrives clean rather than as markup),
       • files dragged anywhere onto the surface.
     `bag` is the caller's pending-file array; `redraw` repaints its chips. */
  function attachDropPaste(root, bag, redraw) {
    if (root.dataset.dropWired === '1') return;
    root.dataset.dropWired = '1';

    const add = files => { if (files.length) { bag.push(...files); redraw(); } };

    root.addEventListener('paste', e => {
      const items = [...(e.clipboardData?.items || [])];
      const files = items.filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
      if (files.length) {
        e.preventDefault();
        // clipboard images arrive unnamed — give them something readable
        add(files.map((f, i) => f.name && f.name !== 'image.png' ? f
          : new File([f], `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${i || ''}.png`, { type: f.type || 'image/png' })));
        return;
      }
      // plain-text paste: strip formatting so pasted guideline text stays clean
      const html = e.clipboardData?.getData('text/html');
      if (html && e.target.tagName === 'TEXTAREA') {
        e.preventDefault();
        const txt = e.clipboardData.getData('text/plain') || html.replace(/<[^>]+>/g, ' ');
        const t = e.target, st = t.selectionStart, en = t.selectionEnd;
        t.value = t.value.slice(0, st) + txt + t.value.slice(en);
        t.selectionStart = t.selectionEnd = st + txt.length;
        t.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    let depth = 0;
    const over = e => { e.preventDefault(); };
    root.addEventListener('dragenter', e => { e.preventDefault(); if (depth++ === 0) root.classList.add('is-dropping'); });
    root.addEventListener('dragover', over);
    root.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; root.classList.remove('is-dropping'); } });
    root.addEventListener('drop', e => {
      e.preventDefault(); depth = 0; root.classList.remove('is-dropping');
      add([...(e.dataTransfer?.files || [])]);
    });
  }

  /* ---------------- in-app notifications ----------------
     The OS Notification API is unavailable on iPad Safari unless the site is
     installed as a PWA, so a toast inside the app is the delivery that always
     works. It doubles as the click-through to the thing that changed. */
  function toast(title, body, onClick) {
    if (muteUntil()) return;
    let stack = document.querySelector('.tr-toasts');
    if (!stack) { stack = document.createElement('div'); stack.className = 'tr-toasts'; document.body.appendChild(stack); }
    const t = document.createElement('div');
    t.className = 'tr-toast';
    t.innerHTML = `<span class="tr-toast-ico">🔔</span>
      <span class="tr-toast-txt"><b>${esc(title)}</b><i>${esc(String(body || '').slice(0, 90))}</i></span>
      <button class="tr-toast-x" aria-label="Dismiss">✕</button>`;
    stack.appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-open'));
    const kill = () => { t.classList.remove('is-open'); setTimeout(() => t.remove(), 250); };
    t.querySelector('.tr-toast-x').addEventListener('click', e => { e.stopPropagation(); kill(); });
    t.addEventListener('click', () => { try { onClick?.(); } catch {} kill(); });
    setTimeout(kill, 7000);
  }

  /* ---------------- wall rendering ---------------- */

  function mediaHTML(media, compact) {
    const list = (media || []).filter(Boolean);
    if (!list.length) return '';
    const imgs = list.filter(isImg), files = list.filter(m => !isImg(m));
    return `
      ${imgs.length ? `<div class="tw-media ${imgs.length > 1 ? 'is-grid' : ''}">${imgs.slice(0, 4).map((m, i) => `
        <a class="tw-shot" href="${esc(m.url)}" target="_blank" rel="noopener">
          <img src="${esc(m.url)}" alt="${esc(m.name || 'image')}" loading="lazy">
          ${i === 3 && imgs.length > 4 ? `<span class="tw-more">+${imgs.length - 4}</span>` : ''}
        </a>`).join('')}</div>` : ''}
      ${files.length ? `<div class="tw-files">${files.map(m => `
        <a class="tw-file" href="${esc(m.url)}" target="_blank" rel="noopener" download>
          <span class="tw-file-ico">📎</span>
          <span class="tw-file-name">${esc(m.name || 'file')}</span>
          <span class="tw-file-size">${m.size ? kb(m.size) : ''}</span>
        </a>`).join('')}</div>` : ''}`;
  }

  function questionHTML(p) {
    if (!p.hasQuestion && !p.question && !p.answer_text) return '';
    return `<details class="tw-q" data-q-shell>
      <summary><span class="tw-q-kind">Q</span>${esc(p.paper_title || 'Question')}<span class="tw-q-more">show the question</span></summary>
      <div class="tw-q-body" data-q-body><p class="tr-empty">Loading…</p></div>
    </details>`;
  }
  async function fillQuestion(shell, id) {
    const body = shell.querySelector('[data-q-body]');
    if (!body || body.dataset.done === '1') return;
    const p = posts.find(x => x.id === id);
    if (p && !p.question && !p._qLoaded) {
      try { Object.assign(p, (await Backend.getDiscussionQuestion?.(id)) || {}); } catch {}
      p._qLoaded = true;
    }
    body.dataset.done = '1';
    body.innerHTML = questionBodyHTML(p) || '<p class="tr-empty">No question attached.</p>';
  }
  function questionBodyHTML(p) {
    const q = p?.question;
    if (!q) return `${p?.answer_text ? `<p class="tw-q-ans"><b>Answer:</b> ${esc(p.answer_text)}</p>` : ''}${p?.rationale ? `<p class="tw-q-rat">${esc(p.rationale)}</p>` : ''}`;
    const opts = (q.options || []).map((o, i) => `
      <li class="${i === q.answer ? 'is-answer' : ''}">${q.preLettered ? '' : `<span class="tw-q-let">${LETTERS[i]}</span>`}<span>${esc(o)}</span>${i === q.answer ? '<span class="tw-q-tick">✓</span>' : ''}</li>`).join('');
    return `
      ${q.theme ? `<p class="tw-q-theme">${esc(q.theme)}</p>` : ''}
      <p class="tw-q-stem">${esc(q.stem || '')}</p>
      ${q.lead ? `<p class="tw-q-lead">${esc(q.lead)}</p>` : ''}
      ${opts ? `<ol class="tw-q-opts">${opts}</ol>` : ''}
      ${q.rationale ? `<p class="tw-q-rat">${esc(q.rationale)}</p>` : ''}
      ${q.hook ? `<p class="tw-q-hook">💡 ${esc(q.hook)}</p>` : ''}`;
  }

  /** Does this post carry comments the reader hasn't seen? */
  function postHasNewComments(p) {
    const list = comments[p.id];
    if (list) return list.some(c => !c.mine && ts(c) > seenAt());
    // not opened yet: the poll bumps _newCm when a comment arrives for it
    return !!p._newCm;
  }
  function postHTML(p) {
    const n = comments[p.id] ? comments[p.id].length : (p.reply_count || 0);
    const fresh = !p.mine && ts(p) > seenAt();
    const newCm = postHasNewComments(p);
    const liked = !!myRx[p.id];
    return `<article class="tw-post ${fresh ? 'is-new' : ''} ${newCm ? 'has-newcm' : ''}" data-pid="${esc(p.id)}">
      <header class="tw-head">
        ${av(p.user_id, p.author_name)}
        <span class="tw-who"><b>${esc(p.author_name || 'A friend')}</b><i>${esc(relTime(p.created_at))}${p.kind === 'question' ? ' · shared a question' : ''}</i></span>
        ${fresh ? '<span class="tw-flag is-post" title="New post you haven\'t seen">NEW</span>' : ''}
        ${newCm ? '<span class="tw-flag is-cm" title="New comments since you last looked">💬 new</span>' : ''}
        ${p.mine ? `<button class="tr-del" data-act="del-post" title="Delete">🗑</button>` : ''}
      </header>
      ${p.topic ? `<p class="tw-text">${esc(p.topic)}</p>` : ''}
      ${questionHTML(p)}
      ${mediaHTML(p.media)}
      ${(p.reaction_count || n) ? `<div class="tw-counts">
        ${p.reaction_count ? `<span>👍 ${p.reaction_count}</span>` : '<span></span>'}
        ${n ? `<span class="tw-cn ${newCm ? 'is-new' : ''}" data-act="comments">${n} comment${n === 1 ? '' : 's'}${newCm ? ' · new' : ''}</span>` : ''}
      </div>` : ''}
      <div class="tw-bar">
        <button class="tw-act ${liked ? 'is-on' : ''}" data-act="like">👍 <span>Like</span></button>
        <button class="tw-act" data-act="comments">💬 <span>Comment</span></button>
      </div>
    </article>`;
  }

  function commentTreeHTML(id) {
    const list = comments[id] || [];
    const roots = list.filter(c => !c.parent_id);
    const kids = c => list.filter(x => x.parent_id === c.id);
    const one = (c, depth) => `
      <div class="tw-cm ${depth ? 'is-reply' : ''} ${!c.mine && ts(c) > seenAt() ? 'is-new' : ''}" data-cid="${esc(c.id)}">
        ${av(c.user_id, c.author_name, true)}
        <div class="tw-cm-body">
          <div class="tw-cm-bubble"><span class="tw-cm-who">${esc(c.author_name || 'A friend')}</span><p>${esc(c.body)}</p>
            ${mediaHTML(c.media)}</div>
          <div class="tw-cm-meta">
            <span>${esc(relTime(c.created_at))}</span>
            ${depth ? '' : `<button class="tr-link" data-act="reply-to" data-rid="${esc(c.id)}">Reply</button>`}
            ${c.mine ? `<button class="tr-link" data-act="del-cm" data-rid="${esc(c.id)}">Delete</button>` : ''}
          </div>
          ${depth ? '' : kids(c).map(k => one(k, 1)).join('')}
        </div>
      </div>`;
    return roots.length ? roots.map(c => one(c, 0)).join('') : '<p class="tr-empty">No comments yet — start the discussion.</p>';
  }

  /** Facebook-style: comments live in their own popup over the feed. */
  async function openComments(postId) {
    const p = posts.find(x => x.id === postId); if (!p) return;
    document.querySelector('.tw-modal')?.remove();
    const m = document.createElement('div');
    m.className = 'tw-modal';
    m.innerHTML = `<div class="tw-sheet" role="dialog" aria-modal="true">
        <header class="tw-sheet-head">
          <h3>${p.kind === 'question' ? 'Discussion' : 'Post'}</h3>
          <button class="cov-x" aria-label="Close">✕</button>
        </header>
        <div class="tw-sheet-body">
          <div class="tw-sheet-post">${postHTML(p)}</div>
          <div class="tw-cm-list" id="tw-cms"><p class="tr-empty">Loading…</p></div>
        </div>
        <div class="tw-sheet-foot">
          <div class="tw-replying" id="tw-replying" hidden></div>
          <div class="tw-cm-new">
            <textarea rows="1" placeholder="Write a comment…  (Enter to send)"></textarea>
            <button class="tw-attach" data-act="cm-file" title="Attach">📎</button>
            <button class="tr-send" data-act="cm-send" title="Send">➤</button>
          </div>
          <div class="tw-pending" id="tw-cm-pending"></div>
        </div>
      </div>`;
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('is-open'));
    const close = () => m.remove();
    m.querySelector('.cov-x').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });

    await loadComments(postId);
    p._newCm = false;                       // opening the thread clears its flag
    const list = m.querySelector('#tw-cms');
    list.innerHTML = commentTreeHTML(postId);
    markSeen(Math.max(latestStamp(), seenAt()));

    let parentId = null, pending = [];
    const pendEl = m.querySelector('#tw-cm-pending');
    const replyEl = m.querySelector('#tw-replying');
    const paintPending = () => {
      pendEl.innerHTML = pending.map((f, i) => `<span class="tw-chip">${esc(f.name)}<button data-drop="${i}">×</button></span>`).join('');
    };
    m.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const drop = e.target.closest('[data-drop]');
      if (drop) { pending.splice(Number(drop.dataset.drop), 1); paintPending(); return; }
      if (act === 'reply-to') {
        parentId = e.target.dataset.rid;
        const who = (comments[postId] || []).find(c => c.id === parentId)?.author_name || '';
        replyEl.hidden = false;
        replyEl.innerHTML = `Replying to <b>${esc(who)}</b> <button class="tr-link" data-act="cancel-reply">cancel</button>`;
        m.querySelector('.tw-cm-new textarea').focus();
        return;
      }
      if (act === 'cancel-reply') { parentId = null; replyEl.hidden = true; return; }
      if (act === 'cm-file') { pending = pending.concat(await pickFiles()); paintPending(); return; }
      if (act === 'del-cm') {
        const rid = e.target.dataset.rid;
        try { await Backend.deleteDiscussionReply(postId, rid); } catch {}
        comments[postId] = (comments[postId] || []).filter(c => c.id !== rid && c.parent_id !== rid);
        p.reply_count = comments[postId].length;
        list.innerHTML = commentTreeHTML(postId); repaint();
        return;
      }
      if (act === 'like') { react(postId, !myRx[postId]); m.querySelector('.tw-sheet-post').innerHTML = postHTML(p); return; }
      if (act !== 'cm-send') return;
      const ta = m.querySelector('.tw-cm-new textarea');
      const body = ta.value.trim();
      if (!body && !pending.length) return;
      const btn = m.querySelector('[data-act="cm-send"]'); btn.disabled = true;
      try {
        const media = pending.length ? await uploadAll(pending) : [];
        await comment(postId, body, { parentId, media });
        ta.value = ''; pending = []; paintPending();
        parentId = null; replyEl.hidden = true;
        list.innerHTML = commentTreeHTML(postId);
        list.scrollTop = list.scrollHeight;
      } catch (err) { alert('Could not comment: ' + (err.message || err)); }
      btn.disabled = false;
    });
    attachDropPaste(m.querySelector('.tw-sheet'), pending, paintPending);
    m.addEventListener('keydown', e => {
      if (e.target.tagName === 'TEXTAREA' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); m.querySelector('[data-act="cm-send"]').click();
      }
    });
    m.addEventListener('toggle', e => {
      if (e.target.matches?.('[data-q-shell]') && e.target.open) fillQuestion(e.target, postId);
    }, true);
  }

  /* ---------------- wall surface ---------------- */

  function composerHTML() {
    return `<div class="tw-composer">
      <div class="tw-comp-row">
        ${av(me?.id, me?.name || 'me')}
        <textarea id="tw-new" rows="1" placeholder="Share a case, a question, a screenshot…"></textarea>
      </div>
      <div class="tw-pending" id="tw-pending"></div>
      <div class="tw-comp-bar">
        <button class="tw-tool" data-act="photo">🖼 Photo</button>
        <button class="tw-tool" data-act="file">📎 File</button>
        <button class="btn btn-gold btn-sm" data-act="post">Post</button>
      </div>
    </div>`;
  }
  function muteBarHTML() {
    const u = muteUntil();
    if (u) return `<div class="tr-muted-bar">🔕 Muted ~${Math.max(1, Math.round((u - now()) / 60000))} min <button class="tr-link" data-act="unmute">unmute</button></div>`;
    return `<div class="tr-mute-row"><span class="tr-mute-label">🔔</span>
      ${[['30m', 30], ['1h', 60], ['3h', 180]].map(([l, mm]) => `<button class="tr-chip" data-act="mute" data-m="${mm}">${l}</button>`).join('')}</div>`;
  }
  function feedHTML() {
    if (!posts.length) return `<p class="tr-empty big">The wall is quiet.<br>Post something, or tap ☕ <b>Discuss with friends</b> under any question.</p>`;
    return posts.map(postHTML).join('') + (moreAvailable ? `<button class="tr-older" data-act="older">Load older posts</button>` : '');
  }

  function paintWall(root) {
    const feed = root.querySelector('[data-tw-feed]');
    if (feed) { const y = feed.scrollTop; feed.innerHTML = feedHTML(); feed.scrollTop = y; }
    const mute = root.querySelector('[data-tr-mute]'); if (mute) mute.innerHTML = muteBarHTML();
  }

  function wireWall(root) {
    if (root.dataset.wired === '1') return;
    root.dataset.wired = '1';
    let pending = [];
    const paintPending = () => {
      const el = root.querySelector('#tw-pending');
      if (el) el.innerHTML = pending.map((f, i) => `<span class="tw-chip">${esc(f.name)}<button data-drop="${i}">×</button></span>`).join('');
    };
    root.addEventListener('click', async e => {
      const drop = e.target.closest('[data-drop]');
      if (drop) { pending.splice(Number(drop.dataset.drop), 1); paintPending(); return; }
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const act = btn.dataset.act;
      const card = btn.closest('[data-pid]');
      const pid = card?.dataset.pid;
      if (act === 'mute') { setMute(Number(btn.dataset.m) * 60000); repaint(); return; }
      if (act === 'unmute') { setMute(0); repaint(); return; }
      if (act === 'photo') { pending = pending.concat(await pickFiles('image/*')); paintPending(); return; }
      if (act === 'file') { pending = pending.concat(await pickFiles()); paintPending(); return; }
      if (act === 'post') {
        const ta = root.querySelector('#tw-new');
        const text = ta.value.trim();
        if (!text && !pending.length) return;
        btn.disabled = true; btn.textContent = 'Posting…';
        try {
          const media = pending.length ? await uploadAll(pending) : [];
          await post({ topic: text, media, kind: 'post' });
          ta.value = ''; ta.style.height = 'auto'; pending = []; paintPending();
        } catch (err) { alert('Could not post: ' + (err.message || err)); }
        btn.disabled = false; btn.textContent = 'Post';
        return;
      }
      if (act === 'older') {
        btn.disabled = true; btn.textContent = 'Loading…';
        try {
          const more = (await Backend.listDiscussions({ limit: PAGE, before: posts[posts.length - 1]?.created_at })) || [];
          moreAvailable = more.length >= PAGE;
          more.forEach(p => { if (!posts.some(x => x.id === p.id)) posts.push(p); });
          repaint();
        } catch { btn.disabled = false; btn.textContent = 'Load older posts'; }
        return;
      }
      if (!pid) return;
      if (act === 'like') { react(pid, !myRx[pid]); return; }
      if (act === 'comments') { openComments(pid); return; }
      if (act === 'del-post') {
        if (!confirm('Delete this post and its comments?')) return;
        try { await Backend.deleteDiscussion(pid); } catch {}
        posts = posts.filter(x => x.id !== pid); delete comments[pid];
        repaint();
      }
    });
    root.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') autoGrow(e.target); });
    attachDropPaste(root, pending, paintPending);
    root.addEventListener('toggle', e => {
      const d = e.target;
      if (d.matches?.('[data-q-shell]') && d.open) {
        const card = d.closest('[data-pid]'); if (card) fillQuestion(d, card.dataset.pid);
      }
    }, true);
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; }

  /* ---------------- chat surface ---------------- */

  /** A member's real name: the cards map first (always current), then the
      name stored on the membership row, then a neutral fallback. */
  function memberName(m) {
    return (cards[m.user_id]?.name) || m.display_name || 'Member';
  }
  function roomName(r) {
    if (r.title) return r.title;
    const others = (r.members || []).filter(m => m.user_id !== me?.id);
    return others.map(memberName).join(', ') || 'Direct chat';
  }
  /** WhatsApp shows the roster under a group's name — so do we. */
  function roomSubtitle(r) {
    if (!r || r.kind !== 'group') return '';
    const names = (r.members || []).map(m => m.user_id === me?.id ? 'You' : memberName(m));
    return names.length ? names.join(', ') : '';
  }
  /** Stable per-sender colour, the way group chats colour each speaker. */
  function senderColor(id, name) { return tint(cards[id]?.name || name || id); }
  function roomsHTML() {
    if (!rooms.length) return `<p class="tr-empty big">No conversations yet.<br>Start one with a study partner.</p>`;
    return rooms.map(r => {
      const msgs = roomMsgs[r.id] || [];
      const last = msgs[msgs.length - 1];
      const unread = msgs.filter(m => !m.mine && ts(m) > chatSeenAt()).length;
      const other = (r.members || []).find(m => m.user_id !== me?.id);
      const face = (r.kind !== 'group' && !r.title && other)
        ? av(other.user_id, memberName(other))
        : `<span class="tr-av tc-group-av">👥</span>`;
      return `<button class="tc-room ${activeRoom === r.id ? 'is-active' : ''}" data-room="${esc(r.id)}">
        ${face}
        <span class="tc-room-main">
          <span class="tc-room-name">${esc(roomName(r))}${r.kind === 'group' ? ` <i>· ${(r.members || []).length}</i>` : ''}</span>
          <span class="tc-room-last">${last ? esc((last.mine ? 'You: ' : '') + (last.body || '📎 attachment')).slice(0, 60) : 'No messages yet'}</span>
        </span>
        ${unread ? `<span class="tc-unread">${unread}</span>` : `<span class="tc-when">${last ? esc(relTime(last.created_at)) : ''}</span>`}
      </button>`;
    }).join('');
  }
  function messagesHTML(roomId) {
    const msgs = roomMsgs[roomId] || [];
    if (!msgs.length) return `<p class="tr-empty">No messages yet — say hello.</p>`;
    let lastDay = '', prevUser = null;
    return msgs.map(m => {
      const day = new Date(m.created_at || 0).toDateString();
      const sep = day !== lastDay ? `<div class="tc-day">${esc(new Date(m.created_at).toLocaleDateString())}</div>` : '';
      lastDay = day;
      const room = rooms.find(x => x.id === roomId);
      const isGroup = room?.kind === 'group' || !!room?.title;
      const who = cards[m.user_id]?.name || m.author_name || '';
      // in a group, only the FIRST message of a run carries the face + name,
      // exactly as WhatsApp stacks consecutive messages from one sender
      const runStart = !prevUser || prevUser !== m.user_id || sep;
      prevUser = m.user_id;
      return `${sep}<div class="tc-msg ${m.mine ? 'is-mine' : ''} ${runStart ? '' : 'is-run'}">
        ${m.mine ? '' : (runStart ? av(m.user_id, who, true) : '<span class="tc-av-gap"></span>')}
        <div class="tc-bubble">
          ${(!m.mine && isGroup && runStart) ? `<span class="tc-from" style="color:${senderColor(m.user_id, who)}">${esc(who)}</span>` : ''}
          ${m.body ? `<p>${esc(m.body)}</p>` : ''}
          ${mediaHTML(m.media)}
          <span class="tc-time">${esc(relTime(m.created_at))}</span>
        </div>
      </div>`;
    }).join('');
  }

  async function openRoom(roomId) {
    activeRoom = roomId;
    if (!roomMsgs[roomId]) {
      try { roomMsgs[roomId] = (await Backend.listChatMessages?.(roomId)) || []; } catch { roomMsgs[roomId] = []; }
    }
    try { await Backend.markRoomRead?.(roomId); } catch {}
    markChatSeen(Math.max(latestChatStamp(), chatSeenAt()));
    paintChat();
  }

  function paintChat() {
    if (!chatEl) return;
    const listEl = chatEl.querySelector('[data-tc-rooms]');
    const viewEl = chatEl.querySelector('[data-tc-view]');
    if (listEl) listEl.innerHTML = roomsHTML();
    if (!viewEl) return;
    chatEl.classList.toggle('has-room', !!activeRoom);
    if (!activeRoom) { viewEl.innerHTML = `<p class="tr-empty big">Pick a conversation, or start a new one.</p>`; return; }
    const r = rooms.find(x => x.id === activeRoom);
    viewEl.innerHTML = `
      <header class="tc-head">
        <button class="tc-back" data-act="back">‹</button>
        ${(() => { const o = (r?.members || []).find(m => m.user_id !== me?.id);
          return (r?.kind !== 'group' && o) ? av(o.user_id, memberName(o)) : `<span class="tr-av tc-group-av">👥</span>`; })()}
        <span class="tc-headtxt">
          <span class="tc-title">${esc(roomName(r || {}))}</span>
          ${roomSubtitle(r) ? `<span class="tc-sub">${esc(roomSubtitle(r))}</span>` : ''}
        </span>
      </header>
      <div class="tc-stream" data-tc-stream>${messagesHTML(activeRoom)}</div>
      <div class="tw-pending" id="tc-pending"></div>
      <div class="tc-compose">
        <button class="tw-attach" data-act="cfile" title="Attach">📎</button>
        <textarea rows="1" placeholder="Message…  (Enter to send)"></textarea>
        <button class="tr-send" data-act="csend" title="Send">➤</button>
      </div>`;
    const st = viewEl.querySelector('[data-tc-stream]');
    if (st) st.scrollTop = st.scrollHeight;
  }

  function wireChat(root) {
    if (root.dataset.wired === '1') return;
    root.dataset.wired = '1';
    let pending = [];
    const paintPending = () => {
      const el = root.querySelector('#tc-pending');
      if (el) el.innerHTML = pending.map((f, i) => `<span class="tw-chip">${esc(f.name)}<button data-drop="${i}">×</button></span>`).join('');
    };
    root.addEventListener('click', async e => {
      const drop = e.target.closest('[data-drop]');
      if (drop) { pending.splice(Number(drop.dataset.drop), 1); paintPending(); return; }
      const room = e.target.closest('[data-room]');
      if (room) { openRoom(room.dataset.room); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'back') { activeRoom = null; paintChat(); return; }
      if (act === 'newroom') { await newRoomFlow(); return; }
      if (act === 'cfile') { pending = pending.concat(await pickFiles()); paintPending(); return; }
      if (act !== 'csend') return;
      const ta = root.querySelector('.tc-compose textarea');
      const body = ta.value.trim();
      if ((!body && !pending.length) || !activeRoom) return;
      const btn = root.querySelector('[data-act="csend"]'); btn.disabled = true;
      try {
        const media = pending.length ? await uploadAll(pending) : [];
        const row = await Backend.sendChatMessage(activeRoom, body, media);
        (roomMsgs[activeRoom] || (roomMsgs[activeRoom] = [])).push(row);
        ta.value = ''; ta.style.height = 'auto'; pending = []; paintPending();
        markChatSeen(Math.max(latestChatStamp(), chatSeenAt()));
        paintChat();
      } catch (err) { alert('Could not send: ' + (err.message || err)); }
      btn.disabled = false;
    });
    root.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') autoGrow(e.target); });
    attachDropPaste(root, pending, paintPending);
    root.addEventListener('keydown', e => {
      if (e.target.tagName === 'TEXTAREA' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); root.querySelector('[data-act="csend"]')?.click();
      }
    });
  }

  async function newRoomFlow() {
    let people = [];
    try { people = (await Backend.listChatPeople?.()) || []; } catch {}
    const m = document.createElement('div');
    m.className = 'tw-modal is-open';
    m.innerHTML = `<div class="tw-sheet tc-newsheet" role="dialog" aria-modal="true">
        <header class="tw-sheet-head"><h3>New conversation</h3><button class="cov-x">✕</button></header>
        <div class="tw-sheet-body">
          <input class="nc-input" id="nr-title" placeholder="Group name (leave blank for a direct chat)">
          <p class="muted tiny" style="margin:10px 0 6px">Who's in it?</p>
          <div class="tc-people">${people.length ? people.map(p => `
            <label class="tc-person"><input type="checkbox" value="${esc(p.id)}"> <span class="tr-av sm" style="background:${tint(p.name)}">${esc(initials(p.name))}</span> ${esc(p.name)}</label>`).join('')
            : '<p class="muted">No other members yet.</p>'}</div>
          <div class="nc-actions"><button class="btn btn-gold" id="nr-go">Create</button></div>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.cov-x').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#nr-go').addEventListener('click', async () => {
      const title = m.querySelector('#nr-title').value.trim();
      const ids = [...m.querySelectorAll('.tc-people input:checked')].map(i => i.value);
      if (!ids.length && !title) { alert('Pick at least one person, or name a group.'); return; }
      try {
        const room = await Backend.createChatRoom({ title, kind: ids.length === 1 && !title ? 'direct' : 'group', memberIds: ids, myName: me?.name });
        await loadRooms(); close(); openRoom(room.id);
      } catch (err) { alert('Could not create: ' + (err.message || err)); }
    });
  }

  /* ---------------- docks + launchers ---------------- */

  function ensureWall() {
    if (wallEl) return wallEl;
    wallEl = document.createElement('div');
    wallEl.className = 'tr-dock tw-dock';
    wallEl.innerHTML = `<div class="tr-surface">
        <header class="tr-dock-head">
          <span class="tr-dock-title">🧱 Tea room wall</span>
          <div data-tr-mute class="tr-mute-wrap"></div>
          <button class="tr-icon" data-dock="close" title="Close">✕</button>
        </header>
        <div class="tw-body">
          ${composerHTML()}
          <div class="tw-feed" data-tw-feed></div>
        </div>
      </div>`;
    document.body.appendChild(wallEl);
    wireWall(wallEl.querySelector('.tr-surface'));
    wallEl.querySelector('[data-dock="close"]').addEventListener('click', closeWall);
    return wallEl;
  }
  function ensureChat() {
    if (chatEl) return chatEl;
    chatEl = document.createElement('div');
    chatEl.className = 'tr-dock tc-dock';
    chatEl.innerHTML = `<div class="tr-surface">
        <header class="tr-dock-head">
          <span class="tr-dock-title">💬 Chat</span>
          <button class="tr-icon" data-act="newroom" title="New conversation">＋</button>
          <button class="tr-icon" data-dock="close" title="Close">✕</button>
        </header>
        <div class="tc-body">
          <div class="tc-rooms" data-tc-rooms></div>
          <div class="tc-view" data-tc-view></div>
        </div>
      </div>`;
    document.body.appendChild(chatEl);
    wireChat(chatEl.querySelector('.tr-surface'));
    chatEl.querySelector('[data-dock="close"]').addEventListener('click', closeChat);
    return chatEl;
  }

  async function openWall() {
    ensureWall(); wallOpen = true; wallEl.classList.add('is-open');
    await ensureLoaded();
    // composer needs `me` for the avatar — repaint once known
    wallEl.querySelector('.tw-composer .tr-av')?.setAttribute('style', `background:${tint(me?.name)}`);
    paintWall(wallEl.querySelector('.tr-surface'));
    markSeen(Math.max(latestStamp(), seenAt()));
    schedule(); emit(); updateLaunchers();
  }
  function closeWall() { wallOpen = false; wallEl?.classList.remove('is-open'); schedule(); updateLaunchers(); }
  async function openChat(roomId) {
    ensureChat(); chatOpen = true; chatEl.classList.add('is-open');
    if (!rooms.length) await loadRooms();
    if (roomId) await openRoom(roomId); else paintChat();
    schedule(); emit(); updateLaunchers();
  }
  function closeChat() { chatOpen = false; chatEl?.classList.remove('is-open'); schedule(); updateLaunchers(); }
  const toggleWall = () => wallOpen ? closeWall() : openWall();
  const toggleChat = () => chatOpen ? closeChat() : openChat();

  function repaint() {
    if (panelHost && document.body.contains(panelHost)) paintWall(panelHost);
    if (wallEl && wallOpen) paintWall(wallEl.querySelector('.tr-surface'));
    if (chatEl && chatOpen) paintChat();
    updateLaunchers();
  }

  let launchBar = null;
  function ensureLaunchers() {
    if (launchBar) return launchBar;
    launchBar = document.createElement('div');
    launchBar.className = 'tr-launchbar';
    launchBar.innerHTML = `
      <button class="tr-launch" data-open="chat" title="Chat"><span class="tr-launch-ico">💬</span><span class="tr-launch-badge" hidden></span></button>
      <button class="tr-launch" data-open="wall" title="Tea room wall"><span class="tr-launch-ico">🧱</span><span class="tr-launch-badge" hidden></span></button>`;
    launchBar.addEventListener('click', e => {
      const b = e.target.closest('[data-open]'); if (!b) return;
      b.dataset.open === 'chat' ? toggleChat() : toggleWall();
    });
    document.body.appendChild(launchBar);
    return launchBar;
  }
  function updateLaunchers() {
    const bar = ensureLaunchers();
    const muted = !!muteUntil();
    const set = (sel, n, hide) => {
      const b = bar.querySelector(sel);
      b.classList.toggle('is-hidden', hide);
      b.classList.toggle('is-muted', muted);
      const badge = b.querySelector('.tr-launch-badge');
      badge.textContent = n > 99 ? '99+' : n; badge.hidden = !n;
    };
    set('[data-open="chat"]', unreadChat(), chatOpen || cfg.chatEnabled === false);
    set('[data-open="wall"]', unreadWall(), wallOpen || cfg.wallEnabled === false);
  }
  function mountLauncher() { ensureLaunchers(); updateLaunchers(); }
  function unmountLauncher() {
    launchBar?.remove(); launchBar = null;
    closeWall(); closeChat();
    wallEl?.remove(); wallEl = null; chatEl?.remove(); chatEl = null;
    reset();
  }

  /** Drop every trace of the signed-in person. Sign-out does not reload the
      page, so without this the next account inherits the previous one's
      identity, rooms and member cards until the tab is refreshed. */
  function reset() {
    clearTimeout(pollTimer); pollTimer = null; lastPoll = null;
    me = null; cards = {};
    posts = []; loaded = false; loading = null; moreAvailable = false;
    myRx = {}; openPosts.clear();
    for (const k in comments) delete comments[k];
    rooms = []; activeRoom = null; roomMsgs = {}; lastChatPoll = null;
    remoteSeen = { wall: 0, chat: 0 };
  }

  /* ---------------- Studio panel (full-page wall) ---------------- */

  async function renderPanel(host) {
    panelHost = host;
    me = me || await Backend.currentUser().catch(() => null);
    host.innerHTML = `<div class="tr-surface tw-panel">
        <div class="tr-bar">
          <div data-tr-mute class="tr-mute-wrap"></div>
          <button class="btn btn-ghost btn-sm" data-act="popwall">⧉ Pop out</button>
          <button class="btn btn-ghost btn-sm" data-act="popchat">💬 Chat</button>
        </div>
        ${composerHTML()}
        <div class="tw-feed" data-tw-feed><p class="tr-empty">Loading…</p></div>
      </div>`;
    const root = host.querySelector('.tr-surface');
    wireWall(root);
    root.querySelector('[data-act="popwall"]').addEventListener('click', () => openWall());
    root.querySelector('[data-act="popchat"]').addEventListener('click', () => openChat());
    await ensureLoaded();
    paintWall(root);
    markSeen(Math.max(latestStamp(), seenAt()));
    schedule(); emit();
  }
  function releasePanel() { panelHost = null; schedule(); }

  return {
    init, onChange, unreadCount, toast, syncSeen, unreadWall, unreadChat,
    renderPanel, releasePanel, mountLauncher, unmountLauncher,
    openWall, closeWall, toggleWall, openChat, closeChat, toggleChat,
    openComments, share, post, setMute, muteUntil,
    loadCfg, config, setNotif, askNotifPermission,
    // kept for callers written against v1
    openDock: openWall, closeDock: closeWall, toggleDock: toggleWall
  };
})();
