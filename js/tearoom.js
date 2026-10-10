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
  /* WHICH WALL IS OPEN. null is the one everybody shares — the tea room as
     it always was. A room id is that group's wall, and a non-member cannot
     read it at all: the rows never leave the database. */
  let wallRoom = null;
  let me = null;
  let cards = {};                     // userId → { name, avatar }

  let pollTimer = null, lastPoll = null;
  let wallEl = null, chatEl = null;
  /* The chat used to live only in a dock. A group's own page hosts the same
     conversation inline, so painting walks every live host instead of the
     one element it used to assume. */
  let chatPanelEl = null;
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
  /* One row announces itself ONCE. The poll asks for a time window, so the
     same row legitimately comes back on several cycles; without this the
     window turns into a drumbeat of identical toasts that only stops when
     the tab is closed. Keyed by row id, so it survives any path into
     notify() — new toast, re-poll, or a repaint. */
  const announced = new Set();
  function announceOnce(id, title, body, onClick) {
    if (!id || announced.has(id)) return;
    announced.add(id);
    // a long session should not grow this without bound
    if (announced.size > 600) { const it = announced.values(); for (let i = 0; i < 200; i++) announced.delete(it.next().value); }
    notify(title, body, onClick);
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
        posts = (await Backend.listDiscussions?.({ limit: PAGE, roomId: wallRoom })) || [];
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
      const out = await Backend.pollDiscussions?.(lastPoll, { roomId: wallRoom });
      for (const p of (out?.threads || [])) if (!posts.some(x => x.id === p.id)) {
        posts.unshift(p); changed = true;
        if (!p.mine) announceOnce(p.id, `${p.author_name || 'A friend'} posted`, p.topic, () => openWall());
      }
      for (const c of (out?.replies || [])) {
        const list = comments[c.discussion_id];
        const known = list ? list.some(x => x.id === c.id) : false;
        if (list) { if (!known) { list.push(c); changed = true; } }
        else { const p = posts.find(x => x.id === c.discussion_id); if (p) { p.reply_count = (p.reply_count || 0) + 1; if (!c.mine) p._newCm = true; changed = true; } }
        // a comment on YOUR post is the notification people actually want —
        // but only the first time we meet it, and never while you are already
        // looking at that thread
        const parent = posts.find(x => x.id === c.discussion_id);
        if (!c.mine && parent?.mine && !known && !openPosts.has(c.discussion_id)) {
          announceOnce(c.id, `${c.author_name || 'Someone'} commented on your post`, c.body,
            () => { openWall(); openComments(c.discussion_id); });
        }
      }
      // Advance the window past everything this response carried. latestStamp()
      // cannot be trusted here: a comment on a thread whose replies are not
      // loaded is never stored, so it would leave lastPoll where it was and
      // the same rows would return on every cycle, for ever.
      const newestWall = Math.max(
        ...(out?.threads || []).map(ts), ...(out?.replies || []).map(ts), 0);
      if (newestWall) lastPoll = new Date(Math.max(newestWall, Date.parse(lastPoll) || 0)).toISOString();
    } catch {}
    // ---- chat ----
    try {
      const msgs = await Backend.pollChat?.(lastChatPoll);
      for (const m of (msgs || [])) {
        const list = roomMsgs[m.room_id] || (roomMsgs[m.room_id] = []);
        if (!list.some(x => x.id === m.id)) {
          list.push(m); changed = true;
          if (!m.mine && !(chatOpen && activeRoom === m.room_id)) {
            const r = rooms.find(x => x.id === m.room_id);
            announceOnce(m.id, `${m.author_name || 'New message'}${r?.title ? ' · ' + r.title : ''}`, m.body, () => openChat(m.room_id));
          }
        }
      }
      const newestChat = Math.max(...(msgs || []).map(ts), 0);
      if (newestChat) lastChatPoll = new Date(Math.max(newestChat, Date.parse(lastChatPoll) || 0)).toISOString();
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
    wireSheets();
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
    /* A post lands on the wall that is open. Taking the room from the view
       rather than asking again is what makes it impossible to be reading
       one group and posting to another. */
    const row = await Backend.addDiscussion({ ...payload, roomId: wallRoom });
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
    // last line of defence: never stack a toast that is already on screen
    const sig = title + ' ' + body;
    if ([...stack.children].some(el => el.dataset.sig === sig)) return;
    const t = document.createElement('div');
    t.className = 'tr-toast';
    t.dataset.sig = sig;
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

  /* The attempt objects behind the cards above, by key. They are held here
     rather than serialised into a data- attribute because a whole marking
     scheme in an HTML attribute is both enormous and one escaping mistake
     away from being a hole. */
  const sheetStash = {};
  /* One listener for every sheet card anywhere — the chat repaints often
     and per-card listeners would be rebound on every repaint. */
  let sheetWired = false;
  function wireSheets() {
    if (sheetWired) return;
    sheetWired = true;
    document.addEventListener('click', async e => {
      const b = e.target.closest('[data-import-sheet]');
      if (!b) return;
      e.preventDefault();
      const key = b.dataset.importSheet;
      const a = sheetStash[key];
      const msg = document.querySelector(`[data-sheet-msg="${key}"]`);
      if (!a) { if (msg) msg.textContent = 'That sheet is no longer in this view — reopen the chat.'; return; }
      b.disabled = true;
      if (msg) msg.textContent = 'Importing…';
      try {
        const saved = await Marksheet.importAttempt(a);
        if (msg) msg.innerHTML = '✓ In your attempts. <a class="link" href="#/osce/result/'
          + encodeURIComponent(saved.id) + '">Open it →</a>';
      } catch (err) {
        b.disabled = false;
        if (msg) msg.textContent = err.message || String(err);
      }
    });
  }

  function mediaHTML(media, compact) {
    const list = (media || []).filter(Boolean);
    if (!list.length) return '';
    /* A marked OSCE sheet arrives as an attachment on an ordinary message.
       It is not a file to download — it is an ATTEMPT, and what you want to
       do with it is put it in your own record. So it draws as a card with
       one button rather than a paperclip, and the message body is written
       to still make sense if this branch never runs. */
    const sheets = list.filter(m => m && m.kind === 'osce-marksheet' && m.attempt);
    const rest = list.filter(m => !(m && m.kind === 'osce-marksheet'));
    const imgs = rest.filter(isImg), files = rest.filter(m => !isImg(m));
    return `
      ${sheets.map((m, i) => {
        const a = m.attempt, r = a.result || {};
        const key = 'ms' + Math.random().toString(36).slice(2, 9);
        sheetStash[key] = a;
        return `<div class="tc-sheet">
          <span class="tc-sheet-ico">📋</span>
          <div class="tc-sheet-b">
            <strong>${esc(a.station?.topic || 'An OSCE station')}</strong>
            <span class="tc-sheet-s ${r.pass ? 'is-pass' : 'is-fail'}">${r.total} / ${r.max} · ${r.percent}%</span>
            <em>${a.source === 'manual'
              ? `Marked in person${a.examiner?.name ? ' by ' + esc(a.examiner.name) : ''}`
              : a.source === 'claude' ? 'Marked by a chat model'
              /* A hand marking and an AUREUM marking of the SAME sitting
                 arrive together. Labelling both "marked in person" would
                 make the pair look like one message sent twice. */
              : `Marked by AUREUM${a.sitting ? ' — the same recording' : ''}`}</em>
          </div>
          <button class="btn btn-gold btn-sm" data-import-sheet="${key}">Import</button>
          <span class="tc-sheet-msg" data-sheet-msg="${key}"></span>
        </div>`;
      }).join('')}
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
    // a modal swapped out from under us never runs its own close()
    document.querySelector('.tw-modal')?.remove();
    openPosts.clear();
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
    // while this thread is on screen, its new comments arrive in the list —
    // announcing them as well would be telling you what you are already reading
    openPosts.add(postId);
    const close = () => { openPosts.delete(postId); m.remove(); };
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
    [chatEl, chatPanelEl].filter(Boolean).forEach(paintChatInto);
  }
  function paintChatInto(hostEl) {
    const listEl = hostEl.querySelector('[data-tc-rooms]');
    const viewEl = hostEl.querySelector('[data-tc-view]');
    if (listEl) listEl.innerHTML = roomsHTML();
    if (!viewEl) return;
    hostEl.classList.toggle('has-room', !!activeRoom);
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

  /* WHO IS IN IT, AND WHO RUNS IT.
     v124 gave every member the same powers: anybody could add anybody and
     nobody could be removed. This is the panel where that stopped being
     true. Everything in it is a request the DATABASE decides — the buttons
     below are hidden from an ordinary member because showing somebody a
     control that will refuse them is its own small insult, not because
     hiding it is the rule. A member who forges the call is still refused. */
  async function membersFlow(roomId, surface) {
    if (!roomId) return;
    const room = (rooms || []).find(r => r.id === roomId);
    const chosen = new Map();
    let list = [];
    const m = document.createElement('div');
    m.className = 'tw-modal is-open';
    m.innerHTML = `<div class="tw-sheet tc-newsheet" role="dialog" aria-modal="true">
        <header class="tw-sheet-head"><h3>Group members</h3><button class="cov-x">✕</button></header>
        <div class="tw-sheet-body" id="gm-body"><p class="muted">Loading…</p></div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.cov-x').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    const body = m.querySelector('#gm-body');
    const say = (t, bad) => { const el = m.querySelector('#gm-msg'); if (el) { el.textContent = t; el.className = 'dev-row-msg' + (bad ? ' bad' : ''); } };

    async function load() {
      try { list = await Backend.listRoomMembers(roomId); }
      catch (err) { body.innerHTML = `<p class="bad">Could not read the members: ${esc(err.message || err)}</p>`; return; }
      paint();
    }
    function paint() {
      const iAmAdmin = list.some(p => p.me && p.role === 'admin');
      const admins = list.filter(p => p.role === 'admin').length;
      body.innerHTML = `
        ${iAmAdmin ? `<div class="gm-rename">
          <input class="nc-input" id="gm-title" value="${esc(room?.title || '')}" placeholder="Group name">
          <button class="btn btn-ghost btn-sm" id="gm-ren">Rename</button>
        </div>` : `<p class="muted tiny">${esc(room?.title || 'Group')}</p>`}
        <p class="muted tiny" style="margin:14px 0 6px">${list.length} member${list.length === 1 ? '' : 's'}${iAmAdmin ? '' : ' · only an admin can add or remove people'}</p>
        <div class="gm-list">${list.map(p => `
          <div class="gm-row" data-uid="${esc(p.id)}">
            <span class="tr-av sm" style="background:${tint(p.name)}">${esc(initials(p.name))}</span>
            <span class="gm-n">${esc(p.name)}${p.me ? ' <i>(you)</i>' : ''}${p.userNo ? ` <span class="nc-hit-no">#${esc(p.userNo)}</span>` : ''}</span>
            <span class="gm-role ${p.role === 'admin' ? 'is-admin' : ''}">${p.role === 'admin' ? 'Admin' : 'Member'}</span>
            ${iAmAdmin && !p.me ? `<button class="btn btn-ghost btn-sm" data-role="${esc(p.id)}" data-to="${p.role === 'admin' ? 'member' : 'admin'}">${p.role === 'admin' ? 'Make member' : 'Make admin'}</button>` : ''}
            ${iAmAdmin && !p.me ? `<button class="bp-x" data-kick="${esc(p.id)}" title="Remove from the group">✕</button>` : ''}
          </div>`).join('')}</div>
        ${iAmAdmin ? `
          <p class="muted tiny" style="margin:16px 0 6px">Add somebody — search by name or user number.</p>
          <input class="nc-input" id="gm-find" placeholder="e.g. Nimal, or 10042" autocomplete="off">
          <div class="nc-picked" id="gm-picked"></div>
          <div class="nc-results" id="gm-results"></div>
          <div class="nc-actions"><button class="btn btn-gold" id="gm-add">Add to group</button></div>` : ''}
        <div class="nc-actions" style="justify-content:flex-start">
          <button class="btn btn-ghost btn-sm" id="gm-leave">Leave this group</button>
        </div>
        <p class="dev-row-msg" id="gm-msg"></p>`;
      wire(iAmAdmin, admins);
    }
    function paintPicked() {
      const picked = m.querySelector('#gm-picked'); if (!picked) return;
      picked.innerHTML = [...chosen.values()].map(p => `
        <span class="nc-chip">${esc(p.name)}${p.userNo ? ` <i>#${esc(p.userNo)}</i>` : ''}
          <button data-drop="${esc(p.id)}" aria-label="Remove">✕</button></span>`).join('');
      picked.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', () => {
        chosen.delete(b.dataset.drop); paintPicked();
      }));
    }
    function wire(iAmAdmin) {
      m.querySelector('#gm-ren')?.addEventListener('click', async () => {
        const t = m.querySelector('#gm-title').value.trim();
        try { await Backend.renameRoom(roomId, t); if (room) room.title = t || null;
          say('Renamed.'); await loadRooms(); if (surface) paintWallRooms(surface);
          const h = surface?.querySelector('[data-tw-title]'); if (h) h.textContent = '👥 ' + (t || 'Group');
        } catch (err) { say(err.message || String(err), true); }
      });
      m.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', async () => {
        try { await Backend.setRoomMemberRole(roomId, b.dataset.role, b.dataset.to); await load(); say('Role changed.'); }
        catch (err) { say(err.message || String(err), true); }
      }));
      m.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', async () => {
        const who = list.find(p => p.id === b.dataset.kick);
        if (!confirm(`Remove ${who?.name || 'this person'} from the group?`)) return;
        try { await Backend.removeRoomMember(roomId, b.dataset.kick); await load(); say('Removed.'); }
        catch (err) { say(err.message || String(err), true); }
      }));
      m.querySelector('#gm-leave')?.addEventListener('click', async () => {
        if (!confirm('Leave this group? You will stop seeing its wall, chat and papers.')) return;
        try {
          await Backend.leaveRoom(roomId);
          await loadRooms(); close();
          /* The wall you were reading is one you can no longer read, so it
             goes back to everybody's rather than sitting there empty. */
          wallRoom = null; posts = []; myRx = {}; loaded = false; lastPoll = null;
          Object.keys(comments).forEach(k => delete comments[k]);
          if (surface) {
            paintWallRooms(surface);
            const t = surface.querySelector('[data-tw-title]');
            if (t) t.textContent = '🧱 Tea room wall';
            await ensureLoaded(true);
            repaint();
          }
        } catch (err) { say(err.message || String(err), true); }
      });
      if (!iAmAdmin) return;
      let timer = null;
      m.querySelector('#gm-find')?.addEventListener('input', e => {
        const q = e.target.value;
        const results = m.querySelector('#gm-results');
        clearTimeout(timer);
        timer = setTimeout(async () => {
          if (String(q).trim().length < 2) { results.innerHTML = ''; return; }
          let found = [];
          try { found = (await Backend.searchPeople?.(q)) || []; } catch { found = []; }
          /* Somebody already in the group is not a search result — offering
             to add them again is a button that does nothing. */
          const already = new Set(list.map(p => p.id));
          const fresh = found.filter(p => !chosen.has(p.id) && !already.has(p.id));
          results.innerHTML = fresh.length
            ? fresh.map(p => `<button class="nc-hit" data-add="${esc(p.id)}" data-name="${esc(p.name)}" data-no="${esc(p.userNo || '')}">
                <span class="tr-av sm" style="background:${tint(p.name)}">${esc(initials(p.name))}</span>
                <span class="nc-hit-n">${esc(p.name)}</span>
                ${p.userNo ? `<span class="nc-hit-no">#${esc(p.userNo)}</span>` : ''}</button>`).join('')
            : `<p class="muted tiny" style="padding:8px 2px">Nobody new matches “${esc(q)}”.</p>`;
          results.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
            chosen.set(b.dataset.add, { id: b.dataset.add, name: b.dataset.name, userNo: b.dataset.no });
            paintPicked(); b.remove();
          }));
        }, 220);
      });
      m.querySelector('#gm-add')?.addEventListener('click', async () => {
        const ids = [...chosen.keys()];
        if (!ids.length) { say('Find somebody first.', true); return; }
        try { await Backend.addRoomMembers(roomId, ids); chosen.clear(); await load(); say('Added.'); }
        catch (err) { say(err.message || String(err), true); }
      });
    }
    await load();
  }

  /* SEARCH, NOT FIVE HUNDRED CHECKBOXES. The old picker listed everybody
     with a tick-box beside them, which worked for eight people and stops
     working somewhere around thirty. Searching by NAME finds the person
     you are thinking of; searching by their USER NUMBER finds the right
     one of the three people with that name, and the number is what people
     read out to each other. */
  async function newRoomFlow() {
    const chosen = new Map();                       // id -> { id, name, userNo }
    const m = document.createElement('div');
    m.className = 'tw-modal is-open';
    m.innerHTML = `<div class="tw-sheet tc-newsheet" role="dialog" aria-modal="true">
        <header class="tw-sheet-head"><h3>New group</h3><button class="cov-x">✕</button></header>
        <div class="tw-sheet-body">
          <input class="nc-input" id="nr-title" placeholder="Group name (leave blank for a direct chat)">
          <p class="muted tiny" style="margin:12px 0 6px">Who's in it? Search by name or user number.</p>
          <input class="nc-input" id="nr-find" placeholder="e.g. Nimal, or 10042" autocomplete="off">
          <div class="nc-picked" id="nr-picked"></div>
          <div class="nc-results" id="nr-results"></div>
          <div class="nc-actions"><button class="btn btn-gold" id="nr-go">Create</button></div>
          <p class="dev-row-msg" id="nr-msg"></p>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.cov-x').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });

    const results = m.querySelector('#nr-results');
    const picked = m.querySelector('#nr-picked');
    function paintPicked() {
      picked.innerHTML = [...chosen.values()].map(p => `
        <span class="nc-chip">${esc(p.name)}${p.userNo ? ` <i>#${esc(p.userNo)}</i>` : ''}
          <button data-drop="${esc(p.id)}" aria-label="Remove">✕</button></span>`).join('');
      picked.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', () => {
        chosen.delete(b.dataset.drop); paintPicked();
      }));
    }
    /* Debounced: a search per keystroke is a query per keystroke, and the
       answer to "Nim" is never worth sending. */
    let timer = null;
    m.querySelector('#nr-find').addEventListener('input', e => {
      const q = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (String(q).trim().length < 2) { results.innerHTML = ''; return; }
        let found = [];
        try { found = (await Backend.searchPeople?.(q)) || []; } catch { found = []; }
        const fresh = found.filter(p => !chosen.has(p.id));
        results.innerHTML = fresh.length
          ? fresh.map(p => `<button class="nc-hit" data-add="${esc(p.id)}" data-name="${esc(p.name)}" data-no="${esc(p.userNo || '')}">
              <span class="tr-av sm" style="background:${tint(p.name)}">${esc(initials(p.name))}</span>
              <span class="nc-hit-n">${esc(p.name)}</span>
              ${p.userNo ? `<span class="nc-hit-no">#${esc(p.userNo)}</span>` : ''}</button>`).join('')
          : `<p class="muted tiny" style="padding:8px 2px">Nobody matches “${esc(q)}”.</p>`;
        results.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
          chosen.set(b.dataset.add, { id: b.dataset.add, name: b.dataset.name, userNo: b.dataset.no });
          paintPicked(); b.remove();
        }));
      }, 220);
    });

    m.querySelector('#nr-go').addEventListener('click', async () => {
      const title = m.querySelector('#nr-title').value.trim();
      const ids = [...chosen.keys()];
      const msg = m.querySelector('#nr-msg');
      if (!ids.length && !title) { msg.textContent = 'Find at least one person, or name a group.'; msg.className = 'dev-row-msg bad'; return; }
      try {
        const room = await Backend.createChatRoom({ title, kind: ids.length === 1 && !title ? 'direct' : 'group', memberIds: ids, myName: me?.name });
        await loadRooms(); close();
        /* The strip is redrawn whether or not the wall is on screen: it is
           cheap, and a group that only appears after a reload reads as a
           group that was not created. */
        if (wallEl) paintWallRooms(wallEl.querySelector('.tr-surface'));
        openRoom(room.id);
      } catch (err) {
        const msg = m.querySelector('#nr-msg');
        msg.textContent = 'Could not create: ' + (err.message || err); msg.className = 'dev-row-msg bad';
      }
    });
  }

  /* ---------------- docks + launchers ---------------- */

  function ensureWall() {
    if (wallEl) return wallEl;
    wallEl = document.createElement('div');
    wallEl.className = 'tr-dock tw-dock';
    wallEl.innerHTML = `<div class="tr-surface">
        <header class="tr-dock-head">
          <span class="tr-dock-title" data-tw-title>🧱 Tea room wall</span>
          <div data-tr-mute class="tr-mute-wrap"></div>
          <button class="tr-icon" data-dock="close" title="Close">✕</button>
        </header>
        <div class="tw-rooms" data-tw-rooms></div>
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

  /* THE SWITCHER. One strip: everybody's wall, then each group this person
     is in. Groups they are not in are not listed, because a group they
     cannot read is not a place they can go — and naming it would leak that
     it exists. */
  function paintWallRooms(surface) {
    const host = surface?.querySelector('[data-tw-rooms]');
    if (!host) return;
    const mine = (rooms || []).filter(r => r.kind === 'group' || (r.title || '').trim());
    /* ONE WAY IN, WHERE GROUPS ARE ACTUALLY USED. Until v127 the only way
       to make a group was a ＋ inside the chat dock, which is a place you
       go to chat — so people looking at the wall, where groups are read,
       could not find it at all. The strip now always draws, because
       "＋ New group" is the thing somebody with no groups needs most. */
    host.innerHTML = `
      ${mine.length ? `<button class="tw-room${wallRoom ? '' : ' is-on'}" data-wall-room="">🧱 Everyone</button>` : ''}
      ${mine.map(r => `<button class="tw-room${wallRoom === r.id ? ' is-on' : ''}" data-wall-room="${esc(r.id)}">${esc(r.title || 'Group')}</button>`).join('')}
      ${wallRoom ? `<button class="tw-room tw-room-go" data-act="members" title="Who is in this group">👥 Members</button>` : ''}
      ${wallRoom ? `<a class="tw-room tw-room-go" href="#/group/${encodeURIComponent(wallRoom)}">📝 Papers</a>` : ''}
      <button class="tw-room tw-room-new" data-act="newgroup" title="Make a study group">＋ New group</button>`;
    host.querySelector('[data-act="newgroup"]')?.addEventListener('click', () => newRoomFlow());
    host.querySelector('[data-act="members"]')?.addEventListener('click', () => membersFlow(wallRoom, surface));
    host.querySelectorAll('[data-wall-room]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.wallRoom || null;
      if (id === wallRoom) return;
      wallRoom = id;
      const t = surface.querySelector('[data-tw-title]');
      if (t) t.textContent = id ? '👥 ' + (mine.find(r => r.id === id)?.title || 'Group') : '🧱 Tea room wall';
      /* A different wall is a different set of posts, so the loaded ones
         are dropped rather than filtered — a stale post from the last
         group appearing in this one is the failure this whole release is
         about. */
      /* `comments` is a const object shared by the whole module, so it is
         emptied in place rather than replaced — reassigning it throws, and
         the throw took the rest of this handler with it. */
      posts = []; myRx = {}; loaded = false; lastPoll = null;
      Object.keys(comments).forEach(k => delete comments[k]);
      paintWallRooms(surface);
      const feed = surface.querySelector('[data-tw-feed]');
      if (feed) feed.innerHTML = '<p class="muted" style="padding:16px">Loading…</p>';
      await ensureLoaded(true);
      repaint();
    }));
  }

  async function openWall() {
    ensureWall(); wallOpen = true; wallEl.classList.add('is-open');
    /* The groups have to be in hand before the strip can be drawn, and the
       wall is often opened before the chat ever is. */
    if (!rooms.length) await loadRooms();
    await ensureLoaded();
    // composer needs `me` for the avatar — repaint once known
    wallEl.querySelector('.tw-composer .tr-av')?.setAttribute('style', `background:${tint(me?.name)}`);
    paintWallRooms(wallEl.querySelector('.tr-surface'));
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
    if ((chatEl && chatOpen) || chatPanelEl) paintChat();
    updateLaunchers();
  }

  /* ---------------- the corner ----------------

     Three things live in the bottom-right corner now — chat, the wall and
     the code scanner — and three permanent bubbles is two too many on a
     phone held in one hand. So they fold into one.

     Closed, the button carries the unread count for everything behind it;
     nothing is hidden by folding, which is the difference between a
     drawer and a place things go missing. The state is remembered,
     because somebody who wants the fan open wants it open tomorrow. */
  const OPEN_KEY = 'aureum.dock.open';
  const dockOpen = () => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };
  const setDockOpen = v => { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch {} };

  let launchBar = null;
  function ensureLaunchers() {
    if (launchBar) return launchBar;
    launchBar = document.createElement('div');
    launchBar.className = 'tr-launchbar' + (dockOpen() ? ' is-open' : '');
    const scanner = typeof QR !== 'undefined';
    const assistant = typeof Assist !== 'undefined';
    launchBar.innerHTML = `
      <div class="tr-fan">
        ${/* The assistant sits at the TOP of the fan — furthest from the
              thumb that opened it, which sounds like the wrong place and
              is not: it is the one you reach for deliberately, where the
              chat and the wall are things you glance at. Being first out
              of the fan also makes it the one you see. */''}
        ${assistant ? `<button class="tr-launch tr-launch-as" data-open="assist" title="Ask AUREUM" aria-label="Ask AUREUM">
          <span class="tr-launch-ico">${Assist.ICON}</span></button>` : ''}
        ${scanner ? `<button class="tr-launch tr-launch-qr" data-open="qr" title="Scan a code" aria-label="Scan a code">
          <span class="tr-launch-ico">${QR.ICON}</span></button>` : ''}
        <button class="tr-launch" data-open="wall" title="Tea room wall"><span class="tr-launch-ico">🧱</span><span class="tr-launch-badge" hidden></span></button>
        <button class="tr-launch" data-open="chat" title="Chat"><span class="tr-launch-ico">💬</span><span class="tr-launch-badge" hidden></span></button>
      </div>
      <button class="tr-launch tr-launch-main" data-dock aria-expanded="${dockOpen() ? 'true' : 'false'}" title="Chat, wall and the code scanner">
        <span class="tr-launch-ico tr-dot" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="tr-launch-badge" hidden></span>
      </button>`;
    launchBar.addEventListener('click', e => {
      if (e.target.closest('[data-dock]')) {
        const on = !launchBar.classList.contains('is-open');
        launchBar.classList.toggle('is-open', on);
        launchBar.querySelector('[data-dock]').setAttribute('aria-expanded', on ? 'true' : 'false');
        setDockOpen(on); updateLaunchers();
        return;
      }
      const b = e.target.closest('[data-open]'); if (!b) return;
      if (b.dataset.open === 'qr') { try { QR.scan(); } catch {} return; }
      if (b.dataset.open === 'assist') { try { Assist.toggle(); } catch {} return; }
      b.dataset.open === 'chat' ? toggleChat() : toggleWall();
    });
    document.body.appendChild(launchBar);
    return launchBar;
  }
  function updateLaunchers() {
    const bar = ensureLaunchers();
    const muted = !!muteUntil();
    const set = (sel, n, hide) => {
      const b = bar.querySelector(sel); if (!b) return;
      b.classList.toggle('is-hidden', hide);
      b.classList.toggle('is-muted', muted);
      const badge = b.querySelector('.tr-launch-badge');
      if (!badge) return;
      badge.textContent = n > 99 ? '99+' : n; badge.hidden = !n;
    };
    /* Open means the button that opened it steps aside — the same rule
       the chat and the wall follow, so the fan never has a button that
       does nothing but close what is already in front of it. */
    set('[data-open="assist"]', 0, typeof Assist !== 'undefined' && Assist.isOpen());
    set('[data-open="chat"]', unreadChat(), chatOpen || cfg.chatEnabled === false);
    set('[data-open="wall"]', unreadWall(), wallOpen || cfg.wallEnabled === false);
    /* Folded away is not the same as gone: whatever is waiting inside is
       counted on the button that hides it. */
    const total = (cfg.chatEnabled === false ? 0 : unreadChat()) + (cfg.wallEnabled === false ? 0 : unreadWall());
    const main = bar.querySelector('[data-dock] .tr-launch-badge');
    if (main) {
      const show = total && !bar.classList.contains('is-open');
      main.textContent = total > 99 ? '99+' : total;
      main.hidden = !show;
    }
    bar.querySelector('[data-dock]')?.classList.toggle('is-muted', muted);
  }
  function mountLauncher() {
    ensureLaunchers(); updateLaunchers();
    /* The assistant's own open/close has to move its button too, and it
       can be opened from places that are not this bar. */
    if (typeof Assist !== 'undefined' && !mountLauncher._as) {
      mountLauncher._as = Assist.onChange(() => updateLaunchers());
    }
  }
  function unmountLauncher() {
    launchBar?.remove(); launchBar = null;
    closeWall(); closeChat();
    try { Assist.unmount(); } catch {}
    wallEl?.remove(); wallEl = null; chatEl?.remove(); chatEl = null; chatPanelEl = null;
    reset();
  }

  /** Drop every trace of the signed-in person. Sign-out does not reload the
      page, so without this the next account inherits the previous one's
      identity, rooms and member cards until the tab is refreshed. */
  function reset() {
    clearTimeout(pollTimer); pollTimer = null; lastPoll = null;
    me = null; cards = {};
    posts = []; loaded = false; loading = null; moreAvailable = false;
    myRx = {}; openPosts.clear(); announced.clear();
    for (const k in comments) delete comments[k];
    rooms = []; activeRoom = null; roomMsgs = {}; lastChatPoll = null;
    remoteSeen = { wall: 0, chat: 0 };
  }

  /* ---------------- Studio panel (full-page wall) ---------------- */

  /* THE FULL-PAGE WALL, and since v128 the wall of ONE GROUP too.
     This panel never had the room strip the pop-out dock got in v124, so
     the Studio page — the main way people read the wall — could not switch
     to a group or make one at all.

     THE FIX IS NOT A SECOND STRIP HERE. A strip on this panel and a strip
     in the dock are two switchers over one piece of state, and clicking
     either leaves the other's header naming the wall you just left. So
     this panel stays the SHARED wall, groups get a page of their own, and
     the Studio points at it with a tile. The roomId argument is what that
     page mounts: the same posts, the same composer, addressed to the
     group. */
  async function renderPanel(host, roomId) {
    panelHost = host;
    me = me || await Backend.currentUser().catch(() => null);
    const want = roomId || null;
    /* Switching wall means dropping what was loaded, not filtering it — a
       post left over from the last wall appearing in this one is the bug
       v124 was about. */
    if (want !== wallRoom) {
      wallRoom = want; posts = []; myRx = {}; loaded = false; lastPoll = null;
      Object.keys(comments).forEach(k => delete comments[k]);
    }
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
    root.querySelector('[data-act="popchat"]').addEventListener('click', () => openChat(want || undefined));
    await ensureLoaded();
    paintWall(root);
    markSeen(Math.max(latestStamp(), seenAt()));
    schedule(); emit();
  }
  function releasePanel() { panelHost = null; schedule(); }

  /* ---------------- a group's own chat, inline ---------------- */
  async function renderChatPanel(host, roomId) {
    me = me || await Backend.currentUser().catch(() => null);
    if (!rooms.length) await loadRooms();
    host.innerHTML = `<div class="tr-surface tc-inline">
        <div class="tc-body"><div class="tc-view" data-tc-view></div></div>
      </div>`;
    chatPanelEl = host.querySelector('.tr-surface');
    wireChat(chatPanelEl);
    await openRoom(roomId);
  }
  function releaseChatPanel() { chatPanelEl = null; }

  /* EVERYTHING SHARED IN THE GROUP, in one list. The files are already
     carried on the posts and the messages; what was missing was anywhere
     to see them together, which is what "shared in the group" means to
     somebody looking for the handout from last Tuesday. */
  async function groupFiles(roomId) {
    const out = [];
    const take = (media, who, when, where) => (media || []).forEach(m => {
      if (m && m.url) out.push({ url: m.url, name: m.name || 'file', type: m.type || '', who, when, where });
    });
    try {
      (await Backend.listDiscussions?.({ limit: 200, roomId }) || [])
        .forEach(p => take(p.media, p.author_name, p.created_at, 'wall'));
    } catch { /* one source failing should not empty the other */ }
    try {
      (await Backend.listChatMessages?.(roomId) || [])
        .forEach(m => take(m.media, m.author_name, m.created_at, 'chat'));
    } catch { /* ditto */ }
    return out.sort((a, b) => String(b.when || '').localeCompare(String(a.when || '')));
  }

  return {
    init, onChange, unreadCount, toast, syncSeen, unreadWall, unreadChat,
    renderPanel, releasePanel, mountLauncher, unmountLauncher,
    renderChatPanel, releaseChatPanel, groupFiles,
    openMembers: (roomId, surface) => membersFlow(roomId, surface),
    newGroup: () => newRoomFlow(),
    openWall, closeWall, toggleWall, openChat, closeChat, toggleChat,
    openComments, share, post, setMute, muteUntil,
    loadCfg, config, setNotif, askNotifPermission,
    // test seam: drive one poll cycle deterministically instead of waiting
    // on the timer, so the "same notification over and over" bug stays fixed
    _pollNow: poll, _reload: () => ensureLoaded(true),
    // kept for callers written against v1
    openDock: openWall, closeDock: closeWall, toggleDock: toggleWall
  };
})();
