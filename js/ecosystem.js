/* ============================================================
   ecosystem.js — the AUREUM AI Ecosystem.

   A Flexcil-style companion rail: AUREUM narrows to make room for a
   dock on the right, and the dock puts the outside AI platforms
   (Gemini, ChatGPT, Perplexity, NotebookLM, Claude, Grok) one tap
   away, with the question you are looking at already on the
   clipboard, ready to paste.

   TWO BROWSER LIMITS SHAPE ALL OF THIS, and neither can be coded
   around from a web page:

   1. They cannot be shown inside the dock. Every one serves
      `X-Frame-Options`/`frame-ancestors`, which tells the browser to
      refuse to render them inside another site. Flexcil manages it
      because a native webview is not a website and those headers do
      not bind it.

   2. A window we open cannot be found again. They all send
      Cross-Origin-Opener-Policy, whose purpose is to sever the tie to
      the opener: our handle starts reporting `closed` while the
      window sits in plain sight, and the window's name stops
      resolving. So "focus the one you already have" is not available,
      and attempting it produced both a second window on Windows and,
      on Safari, a blocked pop-up — the probe spent the single pop-up
      a browser grants per gesture.

   Hence the honest design: the button just OPENS the page, and says
   nothing about state it cannot observe. The cure for a cluttered
   chat history is PINNING — a platform's home page is defined to
   start a new conversation, so pin the address of the one chat you
   want and it reopens that instead.

   Off by default. Each user turns it on in Profile → AI ecosystem.
   ============================================================ */

const Ecosystem = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ON_KEY    = 'aureum.eco.on';
  const WIDTH_KEY = 'aureum.eco.width';
  const PROV_KEY  = 'aureum.eco.provider';
  const URLS_KEY  = 'aureum.eco.urls';        // provider id → the URL you pinned
  const SIDE_KEY  = 'aureum.eco.side';        // which half of the screen the window takes
  const HINT_KEY  = 'aureum.eco.hintSeen';

  const MIN_W = 280, MAX_W = 760, DEF_W = 390;

  /* ---------------- the platforms ----------------
     `embeds` is a claim about the platform's framing headers, not a
     wish: all six refuse framing today, so all six are false and the
     dock goes straight to the paired window without flashing an empty
     frame first. Flip one to true the day it starts allowing it — the
     runtime probe will still catch a wrong guess. */
  const PROVIDERS = [
    { id: 'gemini',     name: 'Google Gemini', ico: '✦', url: 'https://gemini.google.com/app',   tint: '#4285f4', embeds: false,
      pinHint: 'https://gemini.google.com/app/…' },
    { id: 'chatgpt',    name: 'ChatGPT',       ico: '◍', url: 'https://chatgpt.com/',            tint: '#10a37f', embeds: false,
      pinHint: 'https://chatgpt.com/c/…' },
    { id: 'notebooklm', name: 'NotebookLM',    ico: '📓', url: 'https://notebooklm.google.com/',  tint: '#f9ab00', embeds: false,
      pinHint: 'https://notebooklm.google.com/notebook/…' },
    // NOT /new — that URL is explicitly "start a fresh chat"
    { id: 'claude',     name: 'Claude',        ico: '✳', url: 'https://claude.ai/',              tint: '#d97757', embeds: false,
      pinHint: 'https://claude.ai/chat/…' },
    { id: 'perplexity', name: 'Perplexity',    ico: '⌖', url: 'https://www.perplexity.ai/',      tint: '#20a4a4', embeds: false,
      pinHint: 'https://www.perplexity.ai/search/…' },
    { id: 'grok',       name: 'Grok',          ico: '𝕏', url: 'https://grok.com/',               tint: '#8b8b8b', embeds: false,
      pinHint: 'https://grok.com/c/…' }
  ];
  const byId = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];

  /* ---------------- state ---------------- */

  let dockEl = null, tabEl = null, aiWin = null, open = false;
  const wins = {};                    // provider id → its own window handle
  let lastCopied = '';
  const listeners = new Set();

  const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };

  const enabled     = () => read(ON_KEY, '0') === '1';
  const provider    = () => byId(read(PROV_KEY, 'gemini'));
  const width       = () => Math.min(MAX_W, Math.max(MIN_W, Number(read(WIDTH_KEY, DEF_W)) || DEF_W));
  const side        = () => (read(SIDE_KEY, 'right') === 'left' ? 'left' : 'right');
  const pinnedUrls  = () => readJSON(URLS_KEY, {});
  const urlFor      = p => (pinnedUrls()[p.id] || p.url);

  /* iPadOS Safari reports itself as a Mac, so the touch-point test is the
     only reliable way to tell a real desktop from an iPad. It matters:
     window position/size arguments are honoured on desktop and silently
     ignored on iOS, where a popup simply becomes another tab. */
  const isTouchOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) ||
    (navigator.maxTouchPoints || 0) > 1 && /Android/.test(navigator.userAgent);

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach(fn => { try { fn(); } catch {} }); }

  /* ---------------- enable / disable ---------------- */

  function setEnabled(on) {
    write(ON_KEY, on ? '1' : '0');
    if (on) mount(); else { closeDock(); unmount(); }
    emit();
  }

  /** Called on every route. Puts the edge tab up (or takes it down). */
  function sync() {
    if (enabled()) mount(); else { closeDock(); unmount(); }
  }

  /** Take the dock down without forgetting the setting — used on sign-out,
      so the next sign-in brings it back rather than silently losing it. */
  function suspend() { closeDock(); unmount(); }

  function mount() {
    if (tabEl) return;
    tabEl = document.createElement('button');
    tabEl.className = 'eco-tab';
    tabEl.type = 'button';
    tabEl.title = 'AUREUM AI ecosystem';
    tabEl.innerHTML = `<span class="eco-tab-ico">✦</span><span class="eco-tab-txt">AI</span>`;
    tabEl.addEventListener('click', () => openDock());
    document.body.appendChild(tabEl);
  }
  function unmount() { tabEl?.remove(); tabEl = null; }

  /* ---------------- the dock ---------------- */

  function openDock(providerId) {
    if (!enabled()) return;
    if (providerId) write(PROV_KEY, providerId);
    if (!dockEl) buildDock();
    open = true;
    document.body.classList.add('eco-open');
    applyWidth(width());
    paintDock();
    emit();
  }
  function closeDock() {
    open = false;
    document.body.classList.remove('eco-open');
    dockEl?.remove(); dockEl = null;
    reflow();
    emit();
  }
  const isOpen = () => open;

  function applyWidth(w) {
    const v = Math.min(MAX_W, Math.max(MIN_W, w));
    document.documentElement.style.setProperty('--eco-w', v + 'px');
    write(WIDTH_KEY, v);
    reflow();
  }

  /* The nav collapses to its burger below 900px of VIEWPORT — but with the
     dock open what matters is the width left over for AUREUM, which CSS
     cannot see. Measure it here and let the stylesheet key off the class. */
  function reflow() {
    const left = open ? window.innerWidth - width() : window.innerWidth;
    document.body.classList.toggle('eco-narrow', open && left < 900);
  }
  window.addEventListener('resize', reflow);

  function buildDock() {
    dockEl = document.createElement('aside');
    dockEl.className = 'eco-dock';
    dockEl.setAttribute('aria-label', 'AUREUM AI ecosystem');
    document.body.appendChild(dockEl);
  }

  function paintDock() {
    if (!dockEl) return;
    const p = provider();
    dockEl.innerHTML = `
      <header class="eco-head">
        <span class="eco-brand">✦ AUREUM AI</span>
        <div class="eco-switch">
          <select id="eco-prov" title="Which platform this dock drives">
            ${PROVIDERS.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
        </div>
        <button class="eco-x" id="eco-close" title="Close the dock" aria-label="Close">✕</button>
      </header>
      <div class="eco-body" id="eco-body"></div>
      <footer class="eco-foot">
        <div class="eco-tray" id="eco-tray"></div>
      </footer>
      <div class="eco-grip" id="eco-grip" title="Drag to resize" role="separator" aria-orientation="vertical" tabindex="0"></div>`;

    paintBody();
    paintTray();

    dockEl.querySelector('#eco-close').addEventListener('click', closeDock);
    // Switching platform only re-points the DOCK. It must never navigate an
    // open window: each platform keeps its own, so your ChatGPT thread and
    // your NotebookLM both survive being switched between.
    dockEl.querySelector('#eco-prov').addEventListener('change', e => {
      write(PROV_KEY, e.target.value);
      paintBody();
    });
    wireGrip(dockEl.querySelector('#eco-grip'));
  }

  function paintBody() {
    const host = dockEl?.querySelector('#eco-body'); if (!host) return;
    const p = provider();
    const url = urlFor(p);

    // "open" means we opened it this session. We cannot verify it — COOP
     // severs the handle — so the wording promises only what is true.
    const pinned = !!pinnedUrls()[p.id];

    host.innerHTML = `
      <div class="eco-card" style="--eco-tint:${p.tint}">
        <div class="eco-card-top">
          <span class="eco-card-ico">${p.ico}</span>
          <span class="eco-card-name">${esc(p.name)}</span>
          ${pinned ? `<span class="eco-live" title="Opens your pinned conversation">📌 pinned</span>` : ''}
        </div>
        <button class="btn btn-gold btn-block eco-open-btn" id="eco-launch">Open ${esc(p.name)} →</button>
        <p class="eco-note" id="eco-note"></p>

        <div class="eco-pin-block ${pinned ? 'is-pinned' : ''}">
          <p class="eco-pin-lead">${pinned
            ? `📌 Opening <strong>your pinned conversation</strong> — the same chat every time, so nothing new piles up in your history.`
            : `<strong>Tired of a new chat every time?</strong> ${esc(p.name)}'s home page always starts a fresh one. Open the conversation you want to keep using, copy its address from the browser bar, and paste it here — this button will reopen <em>that</em> chat from now on.`}</p>
          <div class="eco-pin-row">
            <input type="url" id="eco-url" value="${esc(url)}" spellcheck="false"
              placeholder="${esc(p.pinHint || 'https://…')}">
            <button class="btn btn-ghost btn-sm" id="eco-url-save">${pinned ? 'Update' : 'Pin'}</button>
          </div>
          ${pinned ? `<button class="link tiny" id="eco-url-reset">Unpin — go back to ${esc(p.name)}'s home</button>` : ''}
        </div>
      </div>
      <div class="eco-frame-host" id="eco-frame"></div>
      <div class="eco-layout">
        <span class="eco-layout-label">Window side</span>
        <div class="eco-seg" id="eco-side">
          <button class="${side() === 'left' ? 'active' : ''}" data-side="left">◧ Left</button>
          <button class="${side() === 'right' ? 'active' : ''}" data-side="right">◨ Right</button>
        </div>
      </div>`;

    host.querySelector('#eco-launch').addEventListener('click', () => launch(p));
    host.querySelector('#eco-url-save').addEventListener('click', () => {
      const v = host.querySelector('#eco-url').value.trim();
      const m = pinnedUrls();
      if (v && v !== p.url) m[p.id] = v; else delete m[p.id];
      write(URLS_KEY, JSON.stringify(m));
      paintBody();
      note(v && v !== p.url ? `Pinned. ${esc(p.name)} now opens that conversation every time.` : 'Unpinned.', 'good');
    });
    host.querySelector('#eco-url-reset')?.addEventListener('click', () => {
      const m = pinnedUrls(); delete m[p.id];
      write(URLS_KEY, JSON.stringify(m));
      paintBody();
      note(`Back to ${esc(p.name)}'s home page.`, '');
    });
    host.querySelector('#eco-side').addEventListener('click', e => {
      const b = e.target.closest('[data-side]'); if (!b) return;
      write(SIDE_KEY, b.dataset.side);
      host.querySelectorAll('#eco-side button').forEach(x => x.classList.toggle('active', x === b));
      if (aiWin && !aiWin.closed) snap(aiWin);
    });

    note(isTouchOS()
      ? `Opens in a new tab. Pair it with AUREUM using iPadOS Split View.`
      : `Opens in a window snapped to the ${side()} half of your screen, and re-used when you switch platform.`, '');

    if (p.embeds) tryEmbed(p, url);
  }

  function note(html, kind) {
    const el = dockEl?.querySelector('#eco-note'); if (!el) return;
    el.className = 'eco-note' + (kind ? ' is-' + kind : '');
    el.innerHTML = html;
  }

  /* ---------------- embedding (for anything that permits it) ---------------- */

  function tryEmbed(p, url) {
    const host = dockEl?.querySelector('#eco-frame'); if (!host) return;
    host.innerHTML = `<iframe class="eco-frame" src="${esc(url)}" title="${esc(p.name)}"
      referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>`;
    const fr = host.querySelector('iframe');
    let settled = false;
    const fail = why => {
      if (settled) return; settled = true;
      host.innerHTML = '';
      note(`${esc(p.name)} refuses to be displayed inside another site${why ? ' (' + esc(why) + ')' : ''}, so it opens in a paired window instead.`, 'warn');
    };
    fr.addEventListener('load', () => {
      if (settled) return;
      // A frame that really loaded is cross-origin, so reading its location
      // THROWS. A frame the browser refused stays readable at about:blank.
      try {
        const href = fr.contentWindow.location.href;
        if (!href || href === 'about:blank') return fail('blocked by the site');
      } catch { settled = true; return; }        // threw ⇒ it loaded
    });
    setTimeout(() => fail('no response'), 6000);
  }

  /* ---------------- the paired window ---------------- */

  /** Geometry for a window snapped to one half of the screen. */
  function halfScreen() {
    const availW = screen.availWidth || screen.width || 1440;
    const availH = screen.availHeight || screen.height || 900;
    const availL = (screen.availLeft != null ? screen.availLeft : 0);
    const availT = (screen.availTop != null ? screen.availTop : 0);
    const w = Math.max(420, Math.round(availW / 2));
    return { w, h: availH, top: availT, left: side() === 'left' ? availL : availL + (availW - w) };
  }

  function snap(win) {
    if (isTouchOS()) return;                      // iOS ignores these; don't pretend
    const g = halfScreen();
    try { win.resizeTo(g.w, g.h); win.moveTo(g.left, g.top); } catch { /* some browsers refuse; harmless */ }
  }

  /* WHY THIS DOES NOT TRY TO RE-FIND A WINDOW ANY MORE.

     Every one of these platforms sends Cross-Origin-Opener-Policy, which is
     designed to CUT the link between the page that opened the window and the
     window itself. Once ChatGPT loads:
       • the handle we were holding is severed — it reports .closed === true
         even though the window is plainly still on screen; and
       • the window's NAME stops resolving from our context group, so
         window.open('', name) does not find it — it makes a brand-new blank
         window instead.
     That is the whole explanation for "it opens a new chat every time" on
     Windows. It is a deliberate browser security boundary, not a bug we can
     code around, and the earlier fix only looked right because the test
     mocked window.open and so never met COOP.

     On Safari it was worse. The probe spent the ONE pop-up a browser grants
     per user gesture, so the real open that followed was refused outright —
     the "Your browser blocked the tab" message. Hence: no probe, ever.

     So the dock now opens a platform AT MOST ONCE per browser session and
     afterwards points you at the window you already have. Switching to it is
     an OS gesture (Alt-Tab, ⌘-`, the tab bar) that no web page may perform. */
  const winName = p => 'aureum-ai-' + p.id;

  function launch(p) {
    const url = urlFor(p);
    const touch = isTouchOS();
    const g = halfScreen();
    // never '_blank' (always a fresh context) and never 'noopener' (returns
    // null); a stable name still helps the browsers that honour it
    const feats = touch ? '' : `popup=yes,width=${g.w},height=${g.h},left=${g.left},top=${g.top}`;
    let w = null;
    try { w = window.open(url, winName(p), feats); } catch { w = null; }
    if (!w) {
      return note(`Your browser blocked the ${touch ? 'tab' : 'window'}. <a class="link" href="${esc(url)}" target="_blank" rel="noopener">Open ${esc(p.name)}</a>, or allow pop-ups for AUREUM.`, 'warn');
    }
    wins[p.id] = w; aiWin = w;
    snap(w);
    try { w.focus(); } catch {}
    if (pinnedUrls()[p.id]) {
      note(`Opened your pinned ${esc(p.name)} conversation. Paste the question straight in.`, 'good');
    } else if (touch && read(HINT_KEY, '0') !== '1') {
      write(HINT_KEY, '1');
      note(`Opened in a tab. For a side-by-side, drag it out with iPadOS Split View. To stop a new chat appearing each time, pin one below.`, '');
    } else {
      note(`${esc(p.name)} is open. Paste the question straight in.`, 'good');
    }
  }


  /* ---------------- the clipboard tray ---------------- */

  /** Plain text of a question: the stem, the lead-in and the options.
      Deliberately NOT the correct answer, the rationale or the memory
      hook — the point is to ask an outside model cold and compare. */
  function questionText(q) {
    if (!q) return '';
    const L = 'ABCDEFGHIJKLMNOPQRST';
    const lines = [];
    if (q.theme) lines.push(String(q.theme).trim());
    if (q.instruction) lines.push(String(q.instruction).trim());
    if (q.stem) lines.push(String(q.stem).trim());
    if (q.lead) lines.push(String(q.lead).trim());
    const opts = q.options || [];
    if (opts.length) {
      lines.push('');
      opts.forEach((o, i) => lines.push(q.preLettered ? String(o) : `${L[i]}. ${o}`));
    }
    return lines.filter(x => x != null && String(x).length).join('\n').trim();
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      lastCopied = text; paintTray(); return true;
    } catch { /* older browsers / no permission — fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) { lastCopied = text; paintTray(); }
      return ok;
    } catch { return false; }
  }

  /** The one call the question review uses. */
  async function copyQuestion(q) {
    const text = questionText(q);
    const ok = await copyText(text);
    if (ok && enabled() && !open) openDock();     // surface where to paste it
    return ok;
  }

  function paintTray() {
    const el = dockEl?.querySelector('#eco-tray'); if (!el) return;
    if (!lastCopied) {
      el.innerHTML = `<p class="eco-tray-empty">Tap <strong>📋 Copy question</strong> under any question — the stem and options land here, ready to paste. The answer, rationale and hook stay behind, so you can ask cold.</p>`;
      return;
    }
    el.innerHTML = `
      <div class="eco-tray-head"><span>📋 On your clipboard</span>
        <button class="btn btn-ghost btn-sm" id="eco-recopy">Copy again</button></div>
      <pre class="eco-tray-body">${esc(lastCopied)}</pre>`;
    el.querySelector('#eco-recopy').addEventListener('click', async () => {
      const ok = await copyText(lastCopied);
      const b = el.querySelector('#eco-recopy');
      b.textContent = ok ? '✓ Copied' : 'Press ⌘/Ctrl-C';
      setTimeout(() => { if (b.isConnected) b.textContent = 'Copy again'; }, 1600);
    });
  }

  /* ---------------- resize ---------------- */

  function wireGrip(grip) {
    if (!grip || grip.dataset.wired === '1') return;
    grip.dataset.wired = '1';
    let dragging = false;
    // the dock is anchored to the RIGHT edge, so its width grows as the
    // pointer moves left — measure from the right edge, not from zero
    const move = x => applyWidth(window.innerWidth - x);
    const onMove = e => { if (!dragging) return; move((e.touches ? e.touches[0].clientX : e.clientX)); };
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('eco-dragging');
      // keep the paired window flush against the newly sized dock
      if (aiWin && !aiWin.closed) snap(aiWin);
    };
    const start = e => {
      dragging = true;
      document.body.classList.add('eco-dragging');
      if (e.cancelable) e.preventDefault();
    };
    grip.addEventListener('mousedown', start);
    grip.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
    // keyboard: the divider is a real control, not a mouse-only affordance
    grip.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { applyWidth(width() + 24); e.preventDefault(); }   // wider
      if (e.key === 'ArrowRight') { applyWidth(width() - 24); e.preventDefault(); }  // narrower
    });
  }

  return {
    PROVIDERS, enabled, setEnabled, sync, suspend, openDock, closeDock, isOpen,
    copyQuestion, copyText, questionText, onChange, provider
  };
})();
