/* ============================================================
   appearance.js — how AUREUM looks, and the quick-settings dock.

   Two things live here because they are the same thing:

   1. The ENGINE. A theme sets a palette of CSS custom properties on
      :root. Any of them can be overridden per user — page background,
      card colour, body text, secondary text, accent, second accent,
      highlight, borders — plus text size and motion. Overrides are
      written as inline properties on <html>, which beat the theme's
      own rules without touching them, so "reset" is a single
      removeProperty and the theme comes straight back.

   2. The DOCK. A round button in the bottom-LEFT corner, mirroring the
      tea-room bubbles on the right. It opens the same controls as
      Profile → Appearance, in reach from any page: the panel markup is
      built once here and used by both, so the two can never drift.

   Everything is stored on the device immediately (so it survives a
   reload with no network) and pushed to the account when signed in
   (so it follows you to another device).
   ============================================================ */

const Appearance = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const KEY = 'aureum.appearance';
  const THEMES = [
    ['dark', '🌙', 'Dark', 'The signature deep-navy look'],
    ['light', '☀️', 'Light', 'Bright, high-contrast daytime'],
    ['night', '🌌', 'Night', 'Dimmed OLED black for late study']
  ];

  /* Which CSS variable each user-facing control drives. Keep this list
     short and meaningful — a colour picker per element would be unusable
     and would let anyone paint text the colour of its own background. */
  const TOKENS = [
    { id: 'bg', css: '--bg', label: 'Page background', kind: 'bg' },
    { id: 'surface', css: '--surface', label: 'Cards & panels', kind: 'bg' },
    { id: 'surface2', css: '--surface-2', label: 'Insets & fields', kind: 'bg' },
    { id: 'ink', css: '--ink', label: 'Body text', kind: 'ink' },
    { id: 'ink2', css: '--ink-2', label: 'Secondary text', kind: 'ink' },
    { id: 'teal', css: '--teal', label: 'Accent & links', kind: 'accent' },
    { id: 'violet', css: '--violet', label: 'Second accent', kind: 'accent' },
    { id: 'gold', css: '--gold', label: 'Highlights', kind: 'accent' },
    { id: 'hairline', css: '--hairline', label: 'Borders', kind: 'line' }
  ];

  /* Swatches offered per kind. Every accent here clears 4.5:1 on both a
     near-black and a near-white surface, so a choice cannot make the
     interface unreadable on either theme. */
  const SWATCHES = {
    accent: ['#5eead4', '#34d399', '#38bdf8', '#a78bfa', '#f472b6', '#fb923c',
      '#f4c95d', '#0d8f7d', '#1d5fd0', '#6d3ff0', '#c2410c', '#be185d'],
    ink: ['#f4f5fb', '#e2e8f0', '#cbd5e1', '#a7abc4', '#0f172a', '#1f2937',
      '#334155', '#48546b', '#fef3c7', '#dbeafe', '#dcfce7', '#fae8ff'],
    bg: ['#0a0c18', '#12152b', '#181c38', '#05060c', '#111827', '#1c1917',
      '#ffffff', '#f8fafc', '#f4f6fa', '#eef1f7', '#fffbeb', '#f0fdf4'],
    line: ['rgba(255,255,255,.08)', 'rgba(255,255,255,.16)', 'rgba(255,255,255,.28)',
      'rgba(15,23,42,.08)', 'rgba(15,23,42,.16)', 'rgba(15,23,42,.30)']
  };

  const SCALES = [['xs', 'A', .9, 'Small'], ['sm', 'A', .96, 'Cosy'],
    ['md', 'A', 1, 'Default'], ['lg', 'A', 1.09, 'Large'], ['xl', 'A', 1.2, 'Largest']];

  const DEFAULTS = { theme: 'dark', scale: 'md', energy: false, motion: false, colors: {} };
  let st = Object.assign({}, DEFAULTS);
  let saver = null;                       // set by app.js: pushes prefs to the account
  const listeners = [];

  /* ---------- read / write ---------- */
  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (!raw) {
      // migrate the two keys that existed before this module
      raw = {};
      try {
        const t = localStorage.getItem('aureum.theme'); if (t) raw.theme = t;
        if (localStorage.getItem('aureum.energy') === '1') raw.energy = true;
      } catch {}
    }
    st = Object.assign({}, DEFAULTS, raw, { colors: Object.assign({}, raw?.colors) });
    return st;
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {}
    // keep the old keys in step — the boot script and ThreeBG still read them
    try {
      localStorage.setItem('aureum.theme', st.theme);
      localStorage.setItem('aureum.energy', st.energy ? '1' : '0');
    } catch {}
    if (saver) { try { saver({ appearance: JSON.parse(JSON.stringify(st)), theme: st.theme, energySaving: st.energy }); } catch {} }
    listeners.forEach(fn => { try { fn(st); } catch {} });
  }

  /* ---------- apply ---------- */
  function apply() {
    const r = document.documentElement;
    r.setAttribute('data-theme', THEMES.some(t => t[0] === st.theme) ? st.theme : 'dark');
    const sc = SCALES.find(s => s[0] === st.scale) || SCALES[2];
    r.style.setProperty('--ui-scale', sc[2]);
    TOKENS.forEach(t => {
      const v = st.colors[t.id];
      if (v) r.style.setProperty(t.css, v); else r.style.removeProperty(t.css);
    });
    // the brand gradient is built from the two accents, so it must follow them
    if (st.colors.teal || st.colors.violet) {
      r.style.setProperty('--grad', `linear-gradient(100deg, ${st.colors.teal || 'var(--teal)'}, ${st.colors.violet || 'var(--violet)'})`);
    } else r.style.removeProperty('--grad');
    r.classList.toggle('energy-saving', !!st.energy);
    r.classList.toggle('reduce-motion', !!st.motion);
    try { ThreeBG.setEnergySaving?.(st.energy); } catch {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', st.colors.bg
      || (st.theme === 'light' ? '#f4f6fb' : st.theme === 'night' ? '#05060c' : '#0a0c18'));
  }

  function init(save) { if (save) saver = save; load(); apply(); }
  function set(patch) { Object.assign(st, patch); apply(); persist(); }
  function setColor(id, value) {
    if (value) st.colors[id] = value; else delete st.colors[id];
    apply(); persist();
  }
  function reset() { st = Object.assign({}, DEFAULTS, { theme: st.theme, colors: {} }); apply(); persist(); }
  function state() { return JSON.parse(JSON.stringify(st)); }
  function onChange(fn) { listeners.push(fn); }
  /** Adopt the account's stored appearance (called once the user is known). */
  function adopt(prefs) {
    if (!prefs) return;
    if (prefs.appearance) st = Object.assign({}, DEFAULTS, prefs.appearance,
      { colors: Object.assign({}, prefs.appearance.colors) });
    else {
      if (prefs.theme) st.theme = prefs.theme;
      if (prefs.energySaving != null) st.energy = !!prefs.energySaving;
    }
    apply();
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {}
    listeners.forEach(fn => { try { fn(st); } catch {} });
  }

  /* ---------- the shared control panel ---------- */

  function swatchRow(t) {
    const cur = st.colors[t.id] || '';
    return `
      <div class="ap-tok" data-tok="${t.id}">
        <div class="ap-tok-head">
          <span class="ap-tok-label">${esc(t.label)}</span>
          <button class="ap-tok-reset ${cur ? '' : 'is-off'}" data-reset-tok="${t.id}"
            title="Back to the theme's own colour">reset</button>
        </div>
        <div class="ap-sw-row">
          ${(SWATCHES[t.kind] || []).map(c => `
            <button class="ap-sw ${cur === c ? 'active' : ''}" data-sw="${t.id}" data-col="${esc(c)}"
              style="--sw:${esc(c)}" title="${esc(c)}" aria-label="${esc(t.label)} ${esc(c)}"></button>`).join('')}
          <label class="ap-sw ap-sw-custom ${cur && !(SWATCHES[t.kind] || []).includes(cur) ? 'active' : ''}"
            title="Any colour you like" style="--sw:${esc(cur || '#888')}">
            <input type="color" data-pick-tok="${t.id}" value="${esc(/^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888')}">
          </label>
        </div>
      </div>`;
  }

  /** The whole control set. Used by the dock AND by Profile → Appearance. */
  function panelHTML(opts = {}) {
    const compact = !!opts.compact;
    return `
      <div class="ap-panel ${compact ? 'is-compact' : ''}">
        <div class="ap-grp">
          <h4 class="ap-h">Theme</h4>
          <div class="ap-themes">
            ${THEMES.map(([id, ico, label, desc]) => `
              <button class="ap-theme ${st.theme === id ? 'active' : ''}" data-ap-theme="${id}">
                <span class="ap-theme-sw theme-sw-${id}"></span>
                <span class="ap-theme-l">${ico} ${esc(label)}</span>
                ${compact ? '' : `<span class="ap-theme-d">${esc(desc)}</span>`}
              </button>`).join('')}
          </div>
        </div>

        <div class="ap-grp">
          <h4 class="ap-h">Text size</h4>
          <div class="ap-scale">
            ${SCALES.map(([id, , mult, label]) => `
              <button class="ap-scale-b ${st.scale === id ? 'active' : ''}" data-ap-scale="${id}"
                style="font-size:${(mult * 0.86).toFixed(2)}rem" title="${esc(label)}">A</button>`).join('')}
          </div>
          <p class="ap-note">Scales the whole interface, not just the body copy — everything stays in proportion.</p>
        </div>

        <div class="ap-grp">
          <h4 class="ap-h">Comfort</h4>
          <label class="ap-toggle">
            <span><strong>🔋 Energy saving</strong><em>Stops the animated background and heavy motion to save battery.</em></span>
            <span class="ap-sw-t"><input type="checkbox" data-ap-flag="energy" ${st.energy ? 'checked' : ''}><i></i></span>
          </label>
          <label class="ap-toggle">
            <span><strong>🎞 Reduce motion</strong><em>Removes transitions and reveal animations. Layout is unchanged.</em></span>
            <span class="ap-sw-t"><input type="checkbox" data-ap-flag="motion" ${st.motion ? 'checked' : ''}><i></i></span>
          </label>
        </div>

        <div class="ap-grp">
          <details class="ap-colors" ${opts.openColors ? 'open' : ''}>
            <summary><h4 class="ap-h">Colours — every part of the interface</h4><span class="dc-caret">▸</span></summary>
            <p class="ap-note">Each control below paints one part of the interface. Anything you leave alone keeps the
              theme's own colour, so you can change one thing without redesigning the site.</p>
            ${TOKENS.map(swatchRow).join('')}
            <button class="btn btn-ghost btn-sm" data-ap-reset style="margin-top:10px">↺ Back to the theme's colours</button>
          </details>
        </div>
      </div>`;
  }

  /** Wire a rendered panel. Safe to call on the dock and on Profile at once. */
  function wire(root) {
    if (!root || root.dataset.apWired === '1') return;
    root.dataset.apWired = '1';
    root.addEventListener('click', e => {
      const th = e.target.closest('[data-ap-theme]');
      if (th) { set({ theme: th.dataset.apTheme }); return refresh(root); }
      const scl = e.target.closest('[data-ap-scale]');
      if (scl) { set({ scale: scl.dataset.apScale }); return refresh(root); }
      const sw = e.target.closest('[data-sw]');
      if (sw) { setColor(sw.dataset.sw, sw.dataset.col); return refresh(root); }
      const rs = e.target.closest('[data-reset-tok]');
      if (rs) { setColor(rs.dataset.resetTok, null); return refresh(root); }
      if (e.target.closest('[data-ap-reset]')) { reset(); return refresh(root); }
    });
    root.addEventListener('change', e => {
      const fl = e.target.closest('[data-ap-flag]');
      if (fl) { set({ [fl.dataset.apFlag]: fl.checked }); return; }
      const pk = e.target.closest('[data-pick-tok]');
      if (pk) { setColor(pk.dataset.pickTok, pk.value); return refresh(root); }
    });
    // a live preview while dragging the OS colour picker
    root.addEventListener('input', e => {
      const pk = e.target.closest('[data-pick-tok]');
      if (pk) { st.colors[pk.dataset.pickTok] = pk.value; apply(); }
    });
  }
  /** Redraw a panel in place, keeping where you were in it. */
  function refresh(root) {
    const open = !!root.querySelector('.ap-colors')?.open;
    const compact = !!root.querySelector('.ap-panel')?.classList.contains('is-compact');
    const scroller = root.closest('.ap-sheet-body') || root;
    const y = scroller.scrollTop;
    root.innerHTML = panelHTML({ compact, openColors: open });
    scroller.scrollTop = y;
  }

  /* ---------- the bottom-left dock ---------- */

  let dock = null;
  function mountDock() {
    if (dock) return;
    dock = document.createElement('div');
    dock.className = 'ap-dock';
    dock.innerHTML = `
      <button class="ap-fab" id="ap-fab" aria-expanded="false" aria-label="Appearance and settings" title="Appearance & settings">
        <span aria-hidden="true">⚙</span>
      </button>
      <div class="ap-sheet" id="ap-sheet" hidden>
        <header class="ap-sheet-head">
          <div><p class="kicker">QUICK SETTINGS</p><h3>Appearance</h3></div>
          <button class="ap-sheet-x" id="ap-sheet-x" aria-label="Close">✕</button>
        </header>
        <div class="ap-sheet-body" id="ap-sheet-body"></div>
        <footer class="ap-sheet-foot">
          <a class="link" href="#/profile">All settings in Profile →</a>
        </footer>
      </div>`;
    document.body.appendChild(dock);
    const fab = dock.querySelector('#ap-fab');
    const sheet = dock.querySelector('#ap-sheet');
    const body = dock.querySelector('#ap-sheet-body');
    const openSheet = on => {
      sheet.hidden = !on;
      fab.setAttribute('aria-expanded', String(on));
      fab.classList.toggle('is-on', on);
      if (on) { body.innerHTML = panelHTML({ compact: true }); wire(body); }
    };
    fab.addEventListener('click', () => openSheet(sheet.hidden));
    dock.querySelector('#ap-sheet-x').addEventListener('click', () => openSheet(false));
    /* Close on a click outside — decided at POINTERDOWN, not at click.
       Choosing a theme redraws the panel, so by the time the click event
       reaches document the button that was pressed has been replaced and is
       no longer inside the dock; testing containment then read every choice
       as an outside click and shut the sheet after a single change. */
    let downInside = false;
    document.addEventListener('pointerdown', e => { downInside = !!dock && dock.contains(e.target); }, true);
    document.addEventListener('click', () => { if (!sheet.hidden && !downInside) openSheet(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) openSheet(false); });
    window.addEventListener('hashchange', () => openSheet(false));
  }
  function unmountDock() { if (dock) { dock.remove(); dock = null; } }

  return { init, adopt, set, setColor, reset, state, onChange, apply,
    panelHTML, wire, refresh, mountDock, unmountDock, THEMES, TOKENS, SCALES };
})();
