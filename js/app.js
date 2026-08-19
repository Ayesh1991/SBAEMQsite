/* ============================================================
   app.js — hash router + views for AUREUM · Pathway to MD.
   Routes:
     #/               landing (+ exam countdown)
     #/auth           sign in / create account
     #/dashboard      progress, tier, analytics
     #/library        collapsible curriculum + search
     #/paper/:id      paper detail → choose SBA/EMQ + mode
     #/quiz/:id/:kind/:mode   run a set
     #/results/:aid   results + review
     #/profile        position, ladder, history, data
     #/dev            developer console (import from Drive)
   ============================================================ */

(() => {
  const view = document.getElementById('view');
  const esc = Quiz.esc;
  const cfg = window.AUREUM_CONFIG;

  const routes = [
    { re: /^#?\/?$/, fn: renderLanding, public: true },
    { re: /^#\/auth$/, fn: renderAuth, public: true },
    { re: /^#\/dashboard$/, fn: renderDashboard },
    { re: /^#\/library$/, fn: renderLibrary },
    { re: /^#\/library\/notes$/, fn: renderLibraryNotes },
    { re: /^#\/library\/essay$/, fn: (u) => Essay.renderList(view, u) },
    { re: /^#\/library\/essay\/writing$/, fn: (u) => Essay.renderWritingLab(view, u) },
    { re: /^#\/library\/essay\/how$/, fn: (u) => Essay.renderHow(view, u) },
    { re: /^#\/library\/essay\/pgim$/, fn: (u) => Essay.renderList(view, u, 'pgim') },
    { re: /^#\/library\/essay\/feedback\/([^/]+)$/, fn: (code, u) => Essay.renderFeedback(view, code, u) },
    { re: /^#\/library\/essay\/([^/]+)\/write\/(\d+)$/, fn: (id, qi, u) => Essay.renderWrite(view, id, qi, u) },
    { re: /^#\/library\/essay\/([^/]+)$/, fn: (id, u) => Essay.renderPaper(view, id, u) },
    { re: /^#\/osce$/, fn: (u) => OSCE.renderBank(view, u) },
    { re: /^#\/osce\/sim$/, fn: (u) => OSCE.renderSim(view, u) },
    { re: /^#\/osce\/mine$/, fn: (u) => OSCE.renderMine(view, u) },
    { re: /^#\/osce\/edit$/, fn: (u) => OSCE.renderEdit(view, null, u) },
    { re: /^#\/osce\/edit\/([^/]+)$/, fn: (id, u) => OSCE.renderEdit(view, id, u) },
    { re: /^#\/osce\/station\/([^/]+)$/, fn: (id, u) => OSCE.renderStation(view, id, u) },
    { re: /^#\/osce\/run\/([^/]+)$/, fn: (sid, u) => OSCE.renderRun(view, sid, u) },
    { re: /^#\/osce\/result\/([^/]+)$/, fn: (id, u) => OSCE.renderResult(view, id, u) },
    { re: /^#\/billing$/, fn: (u) => Wallet.renderBilling(view, u) },
    { re: /^#\/library\/cpd$/, fn: (u) => cpdGate(u) && CPD.renderList(view, u) },
    { re: /^#\/library\/cpd\/([^/]+)\/([^/]+)$/, fn: (v, sec, u) => cpdGate(u) && CPD.renderTopic(view, v, sec, u) },
    { re: /^#\/library\/cpd\/([^/]+)$/, fn: (v, u) => cpdGate(u) && CPD.renderVolume(view, v, u) },
    { re: /^#\/paper\/([^/]+)$/, fn: renderPaper },
    { re: /^#\/quiz\/([^/]+)\/(SBA|EMQ)\/(exam|study)$/, fn: renderQuiz },
    { re: /^#\/quiz\/([^/]+)\/(SBA|EMQ)\/(exam|study)\/fresh$/, fn: (p, k, m, u) => renderQuiz(p, k, m, u, true) },
    { re: /^#\/results\/([^/]+)$/, fn: renderResults },
    { re: /^#\/profile$/, fn: renderProfile },
    { re: /^#\/studio$/, fn: renderStudio },
    { re: /^#\/review$/, fn: renderReview },
    { re: /^#\/peer$/, fn: renderPeerReview },
    { re: /^#\/cards$/, fn: renderCards },
    { re: /^#\/cards\/([^/]+)$/, fn: renderDeck },
    { re: /^#\/simulator$/, fn: renderSimHome },
    { re: /^#\/simulator\/run$/, fn: renderSimRun },
    { re: /^#\/simulator\/design$/, fn: renderSimDesign },
    { re: /^#\/simulator\/search$/, fn: renderSimSearch },
    { re: /^#\/mistakes$/, fn: renderMistakes },
    { re: /^#\/mistakes\/deck\/([^/]+)$/, fn: renderMistakeDeck },
    { re: /^#\/simulator\/result\/([^/]+)$/, fn: renderSimResult },
    { re: /^#\/dev(?:\/(papers|cards|users|blueprint|review|ai|essays|tearoom|cpd|osce|settings))?$/, fn: renderDev }
  ];
  const devOnly = user => !!(user && (user.email === cfg.developer.email || sessionStorage.getItem('aureum-dev') === '1'));

  // EGRESS: currentUser() reads the profiles row from Supabase on every
  // hashchange — dozens of reads while a user clicks around. Cache it in
  // memory for a few seconds so rapid navigation costs one read, not ten.
  // Invalidated immediately whenever we change the profile ourselves.
  let _userCache = null, _userCacheAt = 0;
  const USER_TTL = 8000;
  async function cachedUser() {
    if (_userCache && Date.now() - _userCacheAt < USER_TTL) return _userCache;
    _userCache = await Backend.currentUser();
    _userCacheAt = Date.now();
    return _userCache;
  }
  function invalidateUser() { _userCache = null; }

  // remember scroll position per route so returning to a tab lands where you left
  const _scroll = {};
  let _lastHash = location.hash;

  /** Bounce anyone who has not been granted CPD back to the Library. */
  function cpdGate(user) {
    if (cpdAllowed(user)) return true;
    location.hash = '#/library';
    return false;
  }

  async function route() {
    Quiz.destroy();
    if (_lastHash) _scroll[_lastHash] = window.scrollY;   // save the outgoing page's position
    const hash = location.hash || '#/';
    // Supabase recovery links land with tokens in the hash — let the client
    // consume them and wait for the PASSWORD_RECOVERY event (below).
    if (/access_token=|type=recovery/.test(hash)) { renderResetPassword(); return; }
    const match = routes.find(r => r.re.test(hash));
    if (!match) { location.hash = '#/'; return; }
    const user = await cachedUser();
    if (!match.public && !user) { location.hash = '#/auth'; return; }
    // registration approval gate: pending/denied accounts see only a notice
    if (user && !devOnly(user) && user.status && user.status !== 'approved' && !match.public) {
      renderApprovalGate(user); return;
    }
    await syncExamDate(user);

    ThreeBG.setMood(match.fn === renderLanding ? 'hero' : 'interior');
    { const rf = routeFlag?.(); if (rf) touchUse(rf); }   // visiting the tab counts as using it
    window.__aureumUser = user;
    if (user) applyPrefsAppearance(user);       // theme + energy-saving from prefs
    renderNav(user);
    startTeaRoom(user);                         // live chat + dock, once per session
    if (typeof Ecosystem !== 'undefined') { if (user) Ecosystem.sync(); else Ecosystem.suspend(); }
    if (typeof TeaRoom !== 'undefined') TeaRoom.releasePanel();   // leaving a page drops its panel mount
    view.className = 'view';
    _lastHash = hash;
    try {
      const args = (hash.match(match.re) || []).slice(1).map(decodeURIComponent);
      await match.fn(...args, user);
    } catch (err) {
      view.innerHTML = `<section class="page narrow" data-animate>
        <h1 class="page-title">Something went wrong</h1>
        <p class="muted">${esc(err.message || String(err))}</p>
        <a class="btn btn-primary" href="#/dashboard">Back to dashboard</a></section>`;
    }
    FX.viewIn(view);
    // restore the scroll position we saved for this route (else top)
    const y = _scroll[hash] || 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  /* ================= appearance: theme + energy saving ================= */

  const THEMES = ['dark', 'light', 'night'];
  /* The engine in appearance.js owns the palette, the text scale and the
     per-component colour overrides. These keep their old names because the
     rest of the app calls them, but they are now thin wrappers — there is
     exactly one place that decides what the interface looks like. */
  const applyTheme = theme => Appearance.set({ theme: THEMES.includes(theme) ? theme : 'dark' });
  const applyEnergySaving = on => Appearance.set({ energy: !!on });
  // apply the user's stored prefs (cloud) once known; localStorage handled the instant boot
  let _apChecked = false;
  function applyPrefsAppearance(user) {
    if (_apChecked) return; _apChecked = true;
    Appearance.adopt(user?.prefs);
    // the ecosystem follows the account, so switching on at home shows up at work
    if (user?.prefs?.aiEcosystem != null && typeof Ecosystem !== 'undefined'
        && Ecosystem.enabled() !== !!user.prefs.aiEcosystem) {
      Ecosystem.setEnabled(!!user.prefs.aiEcosystem);
    }
  }

  /* ================= nav ================= */

  function renderNav(user) {
    const nav = document.getElementById('nav');
    const isDev = user && (user.email === cfg.developer.email || sessionStorage.getItem('aureum-dev') === '1');
    const simOn = isDev || (isPaid(user) && user?.featureFlags?.simulator && user?.prefs?.simulator);
    const fcOn = isDev || (isPaid(user) && user?.featureFlags?.flashcards && user?.prefs?.flashcards);
    nav.innerHTML = `
      <a class="brand" href="#/">
        <img class="brand-logo" src="assets/logo-mark.svg" alt=""> ${esc(cfg.brandName)}<span class="brand-sub">${esc(cfg.brandTag)}</span>
      </a>
      ${user ? `<button class="nav-burger" id="nav-burger" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>` : ''}
      <div class="nav-links" id="nav-links">
        ${user ? `
          <a href="#/dashboard" class="${location.hash === '#/dashboard' ? 'active' : ''}">Dashboard</a>
          <a href="#/library" class="${location.hash.startsWith('#/library') || location.hash.startsWith('#/paper') ? 'active' : ''}">Library</a>
          <a href="#/osce" class="${location.hash.startsWith('#/osce') ? 'active' : ''}">OSCE</a>
          <a href="#/studio" class="${location.hash === '#/studio' ? 'active' : ''}">Studio<span class="nav-badge nav-badge-tea" id="nav-tea-badge" hidden></span></a>
          <a href="#/peer" class="${location.hash === '#/peer' ? 'active' : ''}">Peer review</a>
          ${simOn ? `<a href="#/simulator" class="${location.hash.startsWith('#/simulator') ? 'active' : ''}">Simulator</a>` : ''}
          ${isDev ? `<a href="#/dev" class="${location.hash.startsWith('#/dev') ? 'active' : ''}">Developer<span class="nav-badge" id="nav-dev-badge" hidden></span></a>` : ''}
          <a href="#/profile" class="${location.hash === '#/profile' ? 'active' : ''}">Profile</a>
          <button class="btn btn-ghost btn-sm" id="nav-logout">Sign out</button>
        ` : `<a href="#/auth" class="btn btn-primary btn-sm">Sign in</a>`}
      </div>`;
    nav.querySelector('#nav-logout')?.addEventListener('click', async () => {
      await Backend.signOut(); sessionStorage.removeItem('aureum-dev'); location.hash = '#/';
    });
    // mobile: hamburger dropdown (links collapse into a sheet under the bar)
    const burger = nav.querySelector('#nav-burger');
    burger?.addEventListener('click', () => {
      const open = nav.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => nav.classList.remove('nav-open')));
    // developer: pending approvals badge (proposals + registrations)
    if (isDev) refreshDevBadge();
    // tea room: unread count on the Studio tab, kept live by the module
    if (user) paintTeaBadge(typeof TeaRoom !== 'undefined' ? TeaRoom.unreadCount() : 0);
  }

  function paintTeaBadge(n) {
    const b = document.getElementById('nav-tea-badge');
    if (!b) return;
    b.textContent = n > 99 ? '99+' : n;
    b.hidden = !n;
  }
  /* Start the tea room once per signed-in session: it owns its own polling,
     the floating dock and the launcher bubble from here on. */
  let _teaStarted = false;
  function startTeaRoom(user) {
    if (typeof TeaRoom === 'undefined') return;
    if (!user) { if (_teaStarted) { TeaRoom.unmountLauncher(); _teaStarted = false; }
      try { Appearance.unmountDock(); } catch {} return; }
    try { Appearance.mountDock(); } catch {}
    if (_teaStarted) return;
    _teaStarted = true;
    TeaRoom.onChange(paintTeaBadge);
    TeaRoom.mountLauncher();
    TeaRoom.init();
  }

  // small red count on the Developer tab: pending proposals + pending users
  async function refreshDevBadge() {
    try {
      const [props, users] = await Promise.all([
        Backend.listProposals().catch(() => []),
        Backend.listAllUsers().catch(() => [])
      ]);
      const n = props.filter(p => p.status === 'pending').length +
                users.filter(u => u.status === 'pending').length;
      const el = document.getElementById('nav-dev-badge');
      if (el) { el.textContent = n > 9 ? '9+' : String(n); el.hidden = n === 0; }
    } catch { /* badge is best-effort */ }
  }

  /* ================= countdown ================= */

  // The exam date is configurable on the home page. When signed in it is
  // saved to the user's profile (so it survives re-login on any device);
  // localStorage is the offline/logged-out cache.
  let examDateCache = null;
  function getExamDate() {
    if (examDateCache) return examDateCache;
    try { const v = localStorage.getItem('aureum.examDate'); if (v) return (examDateCache = v); } catch { /* ignore */ }
    return cfg.exam.date;
  }
  async function setExamDate(iso) {
    examDateCache = iso;
    try { localStorage.setItem('aureum.examDate', iso); } catch { /* ignore */ }
    try { if (await Backend.currentUser()) await Backend.setExamDate(iso); } catch { /* ignore */ }
  }
  // On login, the profile's exam date wins; if the profile has none yet,
  // push the local choice up so it persists from now on.
  async function syncExamDate(user) {
    if (!user) return;
    if (user.examDate) {
      examDateCache = user.examDate;
      try { localStorage.setItem('aureum.examDate', user.examDate); } catch { /* ignore */ }
    } else {
      const local = getExamDate();
      if (local && local !== cfg.exam.date) { try { await Backend.setExamDate(local); } catch { /* ignore */ } }
    }
  }
  function examCountdown() {
    const target = new Date(getExamDate() + 'T00:00:00');
    const days = Math.ceil((target - new Date()) / 86400000);
    return { target, days };
  }
  function fmtExamDate(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ================= landing ================= */

  async function renderLanding(user) {
    const examISO = getExamDate();
    const { days } = examCountdown();

    view.innerHTML = `
      <section class="hero">
        <p class="hero-kicker">MD PART 2 · SBA & EMQ MASTERY</p>
        <h1 class="hero-title">
          <span class="line">Train like it's</span>
          <span class="line grad">exam day.</span>
        </h1>
        <p class="hero-sub">A focused practice platform for O&amp;G Registrars and Senior Registrars preparing for the
          <strong>${esc(cfg.exam.name)}</strong> — and equally at home for MRCOG Part 2 &amp; 3. Single-best-answer and
          extended-matching questions written from articles and guidelines by your study group, with rationale and a
          memory hook on every answer.</p>

        <div class="countdown" id="countdown" data-days="${days}">
          <div class="cd-number"><strong id="cd-num">0</strong><span>${days >= 0 ? 'days to the exam' : 'days since exam'}</span></div>
          <label class="cd-picker" title="Set your exam date">
            <span class="cd-picker-label">🗓 Your exam date</span>
            <input type="date" id="cd-date-input" value="${examISO}">
          </label>
        </div>

        <div class="hero-cta">
          ${user
            ? `<a class="btn btn-gold btn-lg" href="#/library">Practise now →</a>`
            : `<a class="btn btn-gold btn-lg" href="#/auth">Create your profile →</a>
               <a class="btn btn-ghost btn-lg" href="#/auth">Sign in</a>`}
        </div>
        <div class="hero-stats" id="hero-stats"></div>
      </section>

      <section class="feature-band">
        <div class="feature" data-animate>
          <span class="feature-icon">📝</span>
          <h3>Two ways to practise</h3>
          <p><strong>Exam mode</strong> times you and gives feedback at the end, like the real paper.
             <strong>Study mode</strong> reveals the answer, rationale and hook the moment you choose — learn as you go.</p>
        </div>
        <div class="feature" data-animate>
          <span class="feature-icon">🗂️</span>
          <h3>Mapped to the curriculum</h3>
          <p>Obstetrics, Gynaecology, Clinical Governance and TOG — browse a collapsible tree or search any topic or
             paper in a keystroke. SBA and EMQ are marked on every paper.</p>
        </div>
        <div class="feature" data-animate>
          <span class="feature-icon">📈</span>
          <h3>Progress that follows you</h3>
          <p>Your account, XP, streaks and analytics sync across devices. Repeat any set as often as you like — every
             attempt is recorded.</p>
        </div>
      </section>`;

    FX.heroIntro(view);
    FX.countUp(document.getElementById('cd-num'), Math.abs(days));

    // live exam-date picker
    const dateInput = document.getElementById('cd-date-input');
    dateInput?.addEventListener('change', () => {
      if (!dateInput.value) return;
      setExamDate(dateInput.value);
      const c = examCountdown();
      const numEl = document.getElementById('cd-num');
      const labelEl = numEl.nextElementSibling;
      if (labelEl) labelEl.textContent = c.days >= 0 ? 'days to the exam' : 'days since exam';
      FX.countUp(numEl, Math.abs(c.days));
      FX.pulse(document.getElementById('countdown'));
    });

    try {
      await Data.loadSyllabus();
      const papers = await Data.publishedPapers();
      let sba = 0, emq = 0;
      papers.forEach(p => { sba += (p.sba || 0); emq += (p.emq || 0); });
      const host = document.getElementById('hero-stats');
      if (host) host.innerHTML = `
        <div class="hero-stat"><strong>${papers.length}</strong><span>Papers</span></div>
        <div class="hero-stat"><strong>${sba}</strong><span>SBA questions</span></div>
        <div class="hero-stat"><strong>${emq}</strong><span>EMQ items</span></div>`;
    } catch { /* decorative */ }
  }

  /* ================= auth ================= */

  function renderResetPassword() {
    renderNav(null);
    view.innerHTML = `
      <section class="page narrow auth-page" data-animate>
        <div class="auth-card">
          <h1 class="page-title">Choose a new password</h1>
          <p class="muted">You followed a valid reset link — set your new password below.</p>
          <form id="reset-form" novalidate>
            <label class="field"><span>New password</span>
              <input type="password" name="p1" autocomplete="new-password" placeholder="At least 8 characters" required></label>
            <label class="field"><span>Confirm new password</span>
              <input type="password" name="p2" autocomplete="new-password" placeholder="Repeat it" required></label>
            <p class="form-error" id="reset-error" role="alert" hidden></p>
            <button class="btn btn-gold btn-block" type="submit">Set new password</button>
          </form>
        </div>
      </section>`;
    FX.viewIn(view);
    view.querySelector('#reset-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target), errBox = view.querySelector('#reset-error');
      errBox.hidden = true;
      if (String(f.get('p1')).length < 8) { errBox.textContent = 'Password must be at least 8 characters.'; errBox.hidden = false; return; }
      if (f.get('p1') !== f.get('p2')) { errBox.textContent = 'The two passwords do not match.'; errBox.hidden = false; return; }
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        await Backend.updatePassword(f.get('p1'));
        view.querySelector('.auth-card').innerHTML = `
          <div class="verify-icon">🔐</div>
          <h1 class="page-title">Password updated</h1>
          <p class="muted">You're signed in with your new password.</p>
          <a class="btn btn-gold btn-block" href="#/dashboard">Go to dashboard</a>`;
        history.replaceState(null, '', location.pathname + '#/dashboard');
      } catch (err) { errBox.textContent = err.message; errBox.hidden = false; btn.disabled = false; }
    });
  }

  function renderApprovalGate(user) {
    renderNav(null);
    const denied = user.status === 'denied';
    view.innerHTML = `
      <section class="page narrow auth-page" data-animate>
        <div class="auth-card verify-card">
          <div class="verify-icon">${denied ? '⛔' : '⏳'}</div>
          <h1 class="page-title">${denied ? 'Access denied' : 'Awaiting approval'}</h1>
          <p class="muted">${denied
            ? 'Your account has not been approved for this platform. If you believe this is a mistake, contact the site owner.'
            : 'Your account is created — the site owner reviews every new registration. You\'ll have full access as soon as they approve you.'}</p>
          <button class="btn btn-ghost btn-block" id="gate-signout">Sign out</button>
        </div>
      </section>`;
    FX.viewIn(view);
    view.querySelector('#gate-signout').addEventListener('click', async () => { await Backend.signOut(); location.hash = '#/'; });
  }

  async function renderAuth() {
    if (await Backend.currentUser()) { location.hash = '#/dashboard'; return; }
    let mode = 'signin';
    let regOpen = true;
    try { regOpen = await Backend.getRegistrationOpen(); } catch { regOpen = true; }

    function paint() {
      if (mode === 'signup' && !regOpen) {
        view.innerHTML = `
          <section class="page narrow auth-page" data-animate>
            <div class="auth-card verify-card">
              <div class="verify-icon">🚪</div>
              <h1 class="page-title">Registrations are closed</h1>
              <p class="muted">New accounts are currently by invitation from the site owner. If you've been invited, ask them to open registration for you.</p>
              <button class="btn btn-gold btn-block" id="reg-back">Back to sign in</button>
            </div>
          </section>`;
        view.querySelector('#reg-back').addEventListener('click', () => { mode = 'signin'; paint(); FX.viewIn(view); });
        return;
      }
      if (mode === 'forgot') {
        view.innerHTML = `
          <section class="page narrow auth-page" data-animate>
            <div class="auth-card">
              <h1 class="page-title">Reset your password</h1>
              <p class="muted">Enter your account email — we'll send you a secure link to set a new password.</p>
              <form id="forgot-form" novalidate>
                <label class="field"><span>Email address</span>
                  <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required></label>
                <p class="form-error" id="forgot-error" role="alert" hidden></p>
                <button class="btn btn-gold btn-block" type="submit">Send reset link</button>
              </form>
              <p class="auth-swap"><a href="#" id="forgot-back">← Back to sign in</a></p>
            </div>
          </section>`;
        view.querySelector('#forgot-back').addEventListener('click', e => { e.preventDefault(); mode = 'signin'; paint(); FX.viewIn(view); });
        view.querySelector('#forgot-form').addEventListener('submit', async e => {
          e.preventDefault();
          const errBox = view.querySelector('#forgot-error');
          const email = new FormData(e.target).get('email');
          const btn = e.target.querySelector('button'); btn.disabled = true;
          try {
            await Backend.requestPasswordReset(email);
            view.querySelector('.auth-card').innerHTML = `
              <div class="verify-icon">📮</div>
              <h1 class="page-title">Check your inbox</h1>
              <p class="muted">If an account exists for <strong>${esc(email)}</strong>, a password-reset link is on its way.
                Open it on this device to choose a new password.</p>
              <p class="tiny muted">The link can take a minute — check spam too.</p>`;
          } catch (err) { errBox.textContent = err.message; errBox.hidden = false; btn.disabled = false; }
        });
        return;
      }
      view.innerHTML = `
        <section class="page narrow auth-page" data-animate>
          <div class="auth-card">
            <h1 class="page-title">${mode === 'signin' ? 'Welcome back' : 'Create your profile'}</h1>
            <p class="muted">${mode === 'signin' ? 'Sign in to continue your preparation.' : 'Your progress, streaks and analytics live in this profile.'}
              ${Backend.mode === 'local' ? '<br><span class="tiny">This deployment stores accounts in this browser.</span>' : ''}</p>
            <form id="auth-form" novalidate>
              ${mode === 'signup' ? `
                <label class="field"><span>Full name</span>
                  <input type="text" name="name" autocomplete="name" placeholder="Dr. Nimali Perera" required></label>
                <label class="field"><span>Your position</span>
                  <select name="position">
                    ${Progression.POSITIONS.map(p => `<option value="${p}">${p}</option>`).join('')}
                  </select></label>` : ''}
              <label class="field"><span>Email address</span>
                <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required></label>
              <label class="field"><span>Password</span>
                <input type="password" name="password" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}"
                  placeholder="${mode === 'signup' ? 'At least 8 characters' : '••••••••'}" required></label>
              <p class="form-error" id="auth-error" role="alert" hidden></p>
              <button class="btn btn-gold btn-block" type="submit">${mode === 'signin' ? 'Sign in' : 'Create account'}</button>
            </form>
            <p class="auth-swap">${mode === 'signin'
              ? `New here? <a href="#" id="auth-toggle">Create an account</a> · <a href="#" id="auth-forgot">Forgot password?</a>`
              : `Already registered? <a href="#" id="auth-toggle">Sign in</a>`}</p>
          </div>
        </section>`;
      document.getElementById('auth-toggle').addEventListener('click', e => { e.preventDefault(); mode = mode === 'signin' ? 'signup' : 'signin'; paint(); FX.viewIn(view); });
      document.getElementById('auth-forgot')?.addEventListener('click', e => { e.preventDefault(); mode = 'forgot'; paint(); FX.viewIn(view); });
      document.getElementById('auth-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = new FormData(e.target), errBox = document.getElementById('auth-error');
        errBox.hidden = true;
        const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          if (mode === 'signup') {
            const { needsConfirmation } = await Backend.signUp({ name: f.get('name'), email: f.get('email'), password: f.get('password'), position: f.get('position') });
            if (needsConfirmation) { showVerifyNotice(f.get('email')); return; }
            location.hash = '#/dashboard';
          } else {
            await Backend.signIn(f.get('email'), f.get('password'));
            location.hash = '#/dashboard';
          }
        } catch (err) {
          errBox.textContent = err.message; errBox.hidden = false; btn.disabled = false;
          FX.shake(errBox.closest('.auth-card'));
        }
      });
      function showVerifyNotice(email) {
        view.innerHTML = `
          <section class="page narrow auth-page" data-animate>
            <div class="auth-card verify-card">
              <div class="verify-icon">✉️</div>
              <h1 class="page-title">Email has been sent — please verify</h1>
              <p class="muted">We've sent a verification link to <strong>${esc(email)}</strong>.
                 Open it to activate your account, then come back and sign in.</p>
              <p class="tiny muted">Can't find it? Check your spam folder. The link can take a minute to arrive.</p>
              <button class="btn btn-gold btn-block" id="verify-back">Back to sign in</button>
            </div>
          </section>`;
        view.querySelector('#verify-back').addEventListener('click', () => { mode = 'signin'; paint(); FX.viewIn(view); });
        FX.viewIn(view);
      }
    }
    paint();
  }

  /* ================= dashboard ================= */

  async function renderDashboard(user) {
    await Data.loadSyllabus();
    const progress = await Backend.getProgress();
    let publishedCount = 0;
    try { publishedCount = (await Data.publishedPapers()).length; } catch { /* decorative */ }
    let reviewDue = [];
    try { reviewDue = await ReviewQueue.dueItems(); } catch { /* optional */ }
    let writing = null;
    try { if (typeof Essay !== 'undefined' && Essay.writingSummary) { const fb = (await Backend.listEssayFeedback()) || []; if (fb.length) writing = Essay.writingSummary(fb); } } catch { /* optional */ }
    const ready = Progression.readiness(progress, publishedCount);
    const stats = Progression.summarise(progress);
    const tier = stats.tier;
    const first = firstName(user.name);
    const { days } = examCountdown();

    view.innerHTML = `
      <section class="page">
        <header class="dash-head" data-animate>
          <div>
            <p class="kicker">${greeting()}, ${esc(first)} · ${esc(user.position || 'Registrar')}</p>
            <h1 class="page-title">Your preparation</h1>
          </div>
          <a class="btn btn-gold" href="#/library">Practise now →</a>
        </header>

        <div class="banner-row">
          <div class="level-banner" data-animate>
            <div class="level-emblem">${tier.emblem}</div>
            <div class="level-info">
              <p class="level-name">${tier.title} tier</p>
              <div class="level-bar"><span id="level-fill"></span></div>
              <p class="level-next muted">${tier.next ? `${tier.xpForNext} XP to ${tier.next.title}` : 'Top tier reached — outstanding.'}</p>
            </div>
            <div class="level-xp"><strong id="xp-count">0</strong><span>Total XP</span></div>
          </div>
          <div class="exam-chip ${days < 0 ? 'past' : days <= 30 ? 'soon' : ''}" data-animate>
            <strong id="exam-days">0</strong>
            <span>${days < 0 ? 'days since exam' : 'days to exam'}</span>
          </div>
        </div>

        <div class="stat-row" data-animate>
          <div class="stat-tile"><strong id="st-sets">0</strong><span>Sets completed</span></div>
          <div class="stat-tile"><strong id="st-q">0</strong><span>Questions answered</span></div>
          <div class="stat-tile"><strong id="st-streak">0</strong><span>Day streak 🔥</span></div>
          <div class="stat-tile ring-tile"><div id="ring-acc"></div></div>
        </div>

        <div id="dash-mocks"></div>
        <div id="dash-osce"></div>

        <div class="dash-grid">
          <div class="card readiness-card" data-animate>
            <h3 class="card-title">Exam readiness</h3>
            ${ready ? `
              <div class="readiness-body">
                <div id="ring-ready"></div>
                <div class="readiness-parts">
                  ${[['Recent accuracy', ready.accuracy], ['Syllabus coverage', ready.coverage], ['Consistency (14d)', ready.consistency]].map(([label, v]) => `
                    <div class="readiness-part">
                      <span class="readiness-label">${label}</span>
                      <div class="readiness-bar"><span style="width:${v}%"></span></div>
                      <span class="readiness-val">${v}%</span>
                    </div>`).join('')}
                  <p class="tiny muted">${ready.trend > 0.5 ? `📈 Trending up (+${ready.trend} on recent sets)` : ready.trend < -0.5 ? `📉 Recent sets dipped (${ready.trend}) — steady on` : '➡ Holding steady'} · blends accuracy, coverage and practice rhythm.</p>
                </div>
              </div>` : `<p class="muted">Complete a few sets and your readiness estimate appears here.</p>`}
          </div>
          <div class="card review-card" data-animate>
            <h3 class="card-title">Review queue</h3>
            ${reviewDue.length ? `
              <div class="review-cta">
                <div class="review-due-badge"><strong>${reviewDue.length}</strong><span>question${reviewDue.length > 1 ? 's' : ''} due</span></div>
                <p class="muted">Questions you got wrong, back on their spaced-repetition date. Clear them while they're fresh.</p>
                <a class="btn btn-gold" href="#/review">Review now →</a>
              </div>` : `
              <div class="review-cta">
                <div class="review-due-badge review-clear"><strong>✓</strong><span>all clear</span></div>
                <p class="muted">Nothing due. Wrong answers from any set are scheduled back here automatically — tomorrow first, then at growing intervals.</p>
              </div>`}
          </div>
          ${writing ? `
          <div class="card writing-card" data-animate>
            <h3 class="card-title">✍ Writing skills</h3>
            <div class="review-cta">
              <div class="writing-badge"><strong>${writing.avg != null ? writing.avg + '%' : '—'}</strong><span>essay avg · ${writing.count} marked</span></div>
              <p class="muted">${writing.top ? `Your most-flagged writing weakness is <strong>${esc(writing.top.label)}</strong> (${writing.top.count}× across your papers).` : 'Upload marked essays to see your writing patterns.'} ${writing.trend > 1 ? '📈 Trending up.' : writing.trend < -1 ? '📉 Slipping lately.' : ''}</p>
              <a class="btn btn-gold" href="#/library/essay/writing">Open the writing lab →</a>
            </div>
          </div>` : ''}
        </div>

        <div class="dash-grid">
          <div class="card" data-animate><h3 class="card-title">Score trend</h3><div class="chart-host" id="chart-trend"></div></div>
          <div class="card" data-animate><h3 class="card-title">Accuracy by category</h3><div class="chart-host" id="chart-cats"></div></div>
        </div>

        <div class="card" data-animate><h3 class="card-title">Recent sets</h3><div id="recent-list"></div></div>
      </section>`;

    FX.countUp(document.getElementById('xp-count'), stats.xp);
    FX.countUp(document.getElementById('st-sets'), stats.setsCompleted);
    FX.countUp(document.getElementById('st-q'), stats.questionsAnswered);
    FX.countUp(document.getElementById('st-streak'), stats.streak);
    FX.countUp(document.getElementById('exam-days'), Math.abs(days));
    FX.fillBar(document.getElementById('level-fill'), tier.progress);
    Charts.ring(document.getElementById('ring-acc'), stats.accuracy, 'Accuracy');
    if (ready) Charts.ring(document.getElementById('ring-ready'), ready.score, 'Ready');
    Charts.scoreTrend(document.getElementById('chart-trend'), Progression.scoreSeries(progress));
    Charts.sectionBars(document.getElementById('chart-cats'), Progression.categoryAccuracy(progress));

    /* OSCE progress, painted after the dashboard is already up — a slow read
       must never hold back the page. Hidden entirely until there is at least
       one marked station, so it is never an empty box. */
    (async () => {
      try {
        const host = document.getElementById('dash-osce');
        if (!host || typeof OSCE === 'undefined') return;
        const rows = await OSCE.progress();
        if (!rows.length) return;
        const passes = rows.filter(r => r.pass).length;
        const best = Math.max(...rows.map(r => r.percent));
        const avg = Math.round(rows.reduce((n, r) => n + r.percent, 0) / rows.length);
        const last5 = rows.slice(-5);
        const trend = rows.length >= 4
          ? Math.round(last5.reduce((n, r) => n + r.percent, 0) / last5.length
              - rows.slice(0, Math.max(1, rows.length - 5)).reduce((n, r) => n + r.percent, 0) / Math.max(1, rows.length - 5))
          : null;
        host.innerHTML = `
          <div class="card os-dash" data-animate>
            <div class="es-inbox-head">
              <h3 class="card-title">🎙 OSCE progress</h3>
              <a class="link" href="#/osce">Open the stations →</a>
            </div>
            <div class="os-dash-stats">
              <div><strong>${rows.length}</strong><span>stations marked</span></div>
              <div><strong class="${passes / rows.length >= .5 ? 'good' : 'bad'}">${passes}/${rows.length}</strong><span>at or above the pass mark</span></div>
              <div><strong>${avg}%</strong><span>average</span></div>
              <div><strong>${best}%</strong><span>best</span></div>
              ${trend != null ? `<div><strong class="${trend >= 0 ? 'good' : 'bad'}">${trend >= 0 ? '+' : ''}${trend}</strong><span>last 5 vs before</span></div>` : ''}
            </div>
            <div class="os-dash-charts">
              <div class="os-dash-c">
                <span class="os-dash-k">Where your scores sit</span>
                <div id="os-hist"></div>
              </div>
              <div class="os-dash-c">
                <span class="os-dash-k">Station by station</span>
                <div id="os-trend"></div>
              </div>
            </div>
            <div class="os-dash-recent">
              ${rows.slice(-6).reverse().map(r => `
                <a class="os-dash-row ${r.pass ? 'is-pass' : 'is-fail'}" href="#/osce/result/${encodeURIComponent(r.id)}">
                  <span class="os-dash-t">${esc(r.station)}</span>
                  <span class="os-dash-b"><i style="width:${r.percent}%"></i></span>
                  <span class="os-dash-p">${r.percent}%</span>
                </a>`).join('')}
            </div>
          </div>`;
        const passMark = rows.find(r => r.passMark != null && r.max)
          ? Math.round((rows.find(r => r.passMark != null && r.max).passMark / rows.find(r => r.passMark != null && r.max).max) * 100) : 70;
        Charts.histogram(document.getElementById('os-hist'), rows.map(r => r.percent), { passMark });
        Charts.osceTrend(document.getElementById('os-trend'), rows, passMark);
        FX.viewIn?.(host);
      } catch { /* the dashboard is fine without it */ }
    })();
    renderMockChart(document.getElementById('dash-mocks'), user);

    const recent = (progress.attempts || []).slice(0, 6);
    document.getElementById('recent-list').innerHTML = recent.length ? `
      <div class="table-scroll"><table class="table">
        <thead><tr><th>Paper</th><th>Type</th><th>Mode</th><th>Score</th><th>Date</th><th></th></tr></thead>
        <tbody>${recent.map(a => `
          <tr>
            <td>${esc(a.paperTitle)}</td>
            <td><span class="chip chip-${a.kind.toLowerCase()}">${a.kind}</span></td>
            <td class="muted">${a.studyMode ? 'Study' : 'Exam'}</td>
            <td><strong class="${a.percent >= 70 ? 'good' : a.percent >= 50 ? '' : 'bad'}">${a.percent}%</strong> <span class="muted">(${a.correct}/${a.total})</span></td>
            <td class="muted">${new Date(a.date).toLocaleDateString()}</td>
            <td><a class="link" href="#/results/${a.id}">Review</a></td>
          </tr>`).join('')}</tbody>
      </table></div>` :
      `<p class="muted">No sets yet. <a class="link" href="#/library">Open the library</a> and begin.</p>`;
  }

  function greeting() { const h = new Date().getHours(); return h < 5 ? 'Night shift' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  function firstName(name) {
    const parts = String(name).split(/\s+/).filter(w => !/^(dr|prof|mr|mrs|ms|miss)\.?$/i.test(w));
    return parts[0] || name;
  }

  /* ================= library (collapsible + search) ================= */

  const CAT_META = {
    obstetrics:  { letter: 'O', grad: 'linear-gradient(135deg,#5eead4,#3987e5)', glow: 'rgba(94,234,212,0.35)' },
    gynaecology: { letter: 'G', grad: 'linear-gradient(135deg,#a78bfa,#e879b9)', glow: 'rgba(167,139,250,0.35)' },
    governance:  { letter: 'C', grad: 'linear-gradient(135deg,#f4c95d,#e8a33d)', glow: 'rgba(244,201,93,0.32)' },
    tog:         { letter: 'T', grad: 'linear-gradient(135deg,#3987e5,#5eead4)', glow: 'rgba(57,135,229,0.32)' }
  };
  function catMeta(id) { return CAT_META[id] || { letter: (id || '?')[0].toUpperCase(), grad: 'var(--grad)', glow: 'rgba(94,234,212,0.3)' }; }

  // Library is a HUB: Question bank + Essay + (Flashcards, My mistakes when
  // enabled) share a sub-nav. This shell renders that bar around any inner
  // library page; Essay.js reaches it via window.__aureumLibraryShell.
  function librarySubnav(active, user) {
    const u = user || window.__aureumUser;
    const fcOn = u && (devOnly(u) || (isPaid(u) && u.featureFlags?.flashcards && u.prefs?.flashcards));
    const cpdOn = u && (devOnly(u) || (isPaid(u) && u.featureFlags?.cpd && u.prefs?.cpd));
    const simOn = u && (devOnly(u) || (isPaid(u) && u.featureFlags?.simulator && u.prefs?.simulator));
    const tab = (id, href, label) => `<a class="lib-tab ${active === id ? 'active' : ''}" href="${href}">${label}</a>`;
    return `<div class="lib-subnav" data-animate>
      ${tab('bank', '#/library', 'Question bank')}
      ${tab('essay', '#/library/essay', 'Essay')}
      ${tab('notes', '#/library/notes', 'Notes')}
      ${cpdOn ? tab('cpd', '#/library/cpd', 'CPD') : ''}
      ${fcOn ? tab('cards', '#/cards', 'Flashcards') : ''}
      ${simOn ? tab('mistakes', '#/mistakes', 'My mistakes') : ''}
    </div>`;
  }
  function libraryShell(active, inner, user) {
    return `<section class="page">${librarySubnav(active, user)}${inner}</section>`;
  }
  window.__aureumLibraryShell = (active, inner) => libraryShell(active, inner);

  async function renderLibrary(user) {
    window.__aureumUser = user;
    const [syllabus, papers, progress] = await Promise.all([Data.loadSyllabus(), Data.publishedPapers(), Backend.getProgress()]);
    const pStats = Progression.paperStats(progress);

    const byTopic = {};
    for (const p of papers) (byTopic[p.topicId] || (byTopic[p.topicId] = [])).push(p);

    // per-category tallies
    const cats = syllabus.categories.map(cat => {
      let paperN = 0, topicN = 0;
      cat.sections.forEach(s => s.topics.forEach(t => { const n = byTopic[t.id]?.length || 0; if (n) { paperN += n; topicN += 1; } }));
      return { cat, paperN, topicN };
    });
    const liveCats = cats.filter(c => c.paperN > 0);

    view.innerHTML = `
      <section class="page">
        ${librarySubnav('bank', user)}
        <header data-animate>
          <p class="kicker">QUESTION LIBRARY</p>
          <h1 class="page-title">Choose a paper</h1>
          <p class="muted">Browse the curriculum, or search a topic or paper. Each paper is marked
            <span class="chip chip-sba">SBA</span> and, where present, <span class="chip chip-emq">EMQ</span>.</p>
        </header>

        <div class="lib-search" data-animate>
          <span class="lib-search-ico">⌕</span>
          <input type="search" id="lib-search" placeholder="Search papers and topics… e.g. eclampsia, PPH, HRT" autocomplete="off">
        </div>

        ${(() => { const pb = Data.papersProblem?.(); return pb ? `
        <div class="bank-alert" data-animate role="alert">
          <span class="bank-alert-ico">⚠</span>
          <div class="bank-alert-body">
            <strong>The question bank did not load properly.</strong>
            <p>${esc(pb.message)}</p>
            <p class="muted tiny">Papers are stored in the database, not on this device — a failed read cannot delete them.
              Reload the bank to try again.</p>
          </div>
          <button class="btn btn-gold btn-sm" id="bank-reload">↻ Reload the bank</button>
        </div>` : ''; })()}

        <div class="lib-filters" id="lib-filters" data-animate>
          <button class="filter-chip active" data-filter="all">All <span>${papers.length}</span></button>
          ${liveCats.map(({ cat, paperN }) => `
            <button class="filter-chip" data-filter="${cat.id}">
              <i class="fc-dot" style="background:${catMeta(cat.id).grad}"></i>${esc(cat.title)} <span>${paperN}</span>
            </button>`).join('')}
        </div>

        <div id="lib-results" class="lib-results" hidden></div>

        <div id="lib-tree">
          ${liveCats.map(({ cat, paperN, topicN }) => chapterCard(cat, paperN, topicN, byTopic, pStats)).join('')}
          ${cats.filter(c => c.paperN === 0).length ? `
            <p class="lib-empty muted">More categories unlock as papers are published:
              ${cats.filter(c => c.paperN === 0).map(c => esc(c.cat.title)).join(' · ')}.</p>` : ''}
        </div>
      </section>`;

    // entrance animation for chapters
    if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo('.chapter', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.09, ease: 'power3.out' });
    }

    // animate paper cards when a section opens
    view.querySelectorAll('details.chapter-section').forEach(d => {
      d.addEventListener('toggle', () => {
        if (d.open && typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          gsap.fromTo(d.querySelectorAll('.paper-card'), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: 'power2.out', clearProps: 'transform' });
        }
      });
    });

    /* A failed bank read is recoverable: throw away every cached copy —
       including the coverage index built from it — and read again. */
    view.querySelector('#bank-reload')?.addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = '↻ Reloading…';
      try { await Data.reloadPapers(); } catch {}
      route();
    });

    // category filter chips
    const filters = view.querySelector('#lib-filters');
    filters.addEventListener('click', e => {
      const btn = e.target.closest('.filter-chip'); if (!btn) return;
      filters.querySelectorAll('.filter-chip').forEach(b => b.classList.toggle('active', b === btn));
      const f = btn.dataset.filter;
      view.querySelectorAll('.chapter').forEach(ch => { ch.hidden = !(f === 'all' || ch.dataset.cat === f); });
      if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo(view.querySelectorAll('.chapter:not([hidden])'), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.07, ease: 'power2.out' });
      }
    });

    // search
    const searchable = papers.map(p => {
      const path = Data.topicPath(p.categoryId, p.sectionId, p.topicId);
      return { p, hay: [p.title, p.source, path.category?.title, path.section?.title, path.topic?.title].filter(Boolean).join(' ').toLowerCase() };
    });
    const input = view.querySelector('#lib-search');
    const results = view.querySelector('#lib-results');
    const tree = view.querySelector('#lib-tree');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { results.hidden = true; tree.hidden = false; filters.hidden = false; return; }
      tree.hidden = true; filters.hidden = true; results.hidden = false;
      const hits = searchable.filter(s => s.hay.includes(q)).slice(0, 48);
      results.innerHTML = hits.length
        ? `<p class="muted lib-results-count">${hits.length} match${hits.length > 1 ? 'es' : ''} for “${esc(q)}”</p><div class="paper-grid">${hits.map(h => paperCard(h.p, pStats)).join('')}</div>`
        : `<p class="muted">No papers match “${esc(q)}”. New papers appear here as they are published.</p>`;
      if (hits.length && typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo(results.querySelectorAll('.paper-card'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' });
      }
    });
  }

  /* ---- Library → Notes: user-designed study notes with tags + hooks ---- */
  async function renderLibraryNotes(user) {
    window.__aureumUser = user;
    view.innerHTML = libraryShell('notes', `
      <header data-animate>
        <p class="kicker">STUDY NOTES</p>
        <h1 class="page-title">Notes, tags &amp; hooks</h1>
        <p class="muted">A memory hook is only useful pinned to the concept it hangs on. Read every hook in the bank grouped by topic, and write your own notes alongside them.</p>
      </header>
      <div class="notes-tabs" data-animate>
        <button class="notes-tab active" data-ntab="hooks">💡 Hook library</button>
        <button class="notes-tab" data-ntab="mine">📝 My notes</button>
      </div>
      <div id="hooks-wrap"></div>
      <div id="notes-wrap" hidden><p class="muted">Loading your notes…</p></div>`, user);

    // sub-tabs: the hook library is the default view, personal notes the second
    const hooksWrap = view.querySelector('#hooks-wrap');
    const notesWrap = view.querySelector('#notes-wrap');
    let hooksDrawn = false;
    const showTab = (which) => {
      view.querySelectorAll('.notes-tab').forEach(b => b.classList.toggle('active', b.dataset.ntab === which));
      hooksWrap.hidden = which !== 'hooks';
      notesWrap.hidden = which !== 'mine';
      if (which === 'hooks' && !hooksDrawn && typeof Hooks !== 'undefined') { hooksDrawn = true; Hooks.render(hooksWrap); }
    };
    view.querySelectorAll('.notes-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.ntab)));
    showTab('hooks');

    const [notes, tags] = await Promise.all([
      Backend.listUserNotes ? Backend.listUserNotes().catch(() => []) : Promise.resolve([]),
      Backend.listQuestionTags ? Backend.listQuestionTags().catch(() => []) : Promise.resolve([])
    ]);
    // the AI taxonomy — distinct topic tags, offered as suggestions so a user's
    // notes align with the same vocabulary the question bank is tagged with.
    const tagPool = [...new Set(tags.flatMap(t => [t.topic, ...(t.tags || [])]).filter(Boolean).map(s => String(s).trim()))].sort((a, b) => a.localeCompare(b)).slice(0, 60);

    let wrap = view.querySelector('#notes-wrap');
    let editing = null, search = '';
    const esc2 = esc;

    // The composer is a collapsed card — the list of notes is what you come
    // here to read; writing is one click away rather than always occupying
    // the top third of the page (and the 60-tag suggestion wall with it).
    function composer() {
      const n = editing || {};
      return `
        <details class="card note-composer" ${editing ? 'open' : ''} id="nc-card">
          <summary class="nc-summary"><span class="nc-plus">✚</span> ${editing ? 'Edit note' : 'Write a new note'}</summary>
          <div class="nc-fields">
            <input type="text" id="nc-title" class="nc-input" placeholder="Title — the concept, e.g. 'Magnesium sulphate in severe pre-eclampsia'" value="${esc2(n.title || '')}">
            <textarea id="nc-body" class="nc-input" placeholder="Your explanation, the facts you keep forgetting, the reasoning…">${esc2(n.body || '')}</textarea>
            <input type="text" id="nc-hook" class="nc-input" placeholder="💡 Memory hook / mnemonic (optional)" value="${esc2(n.hook || '')}">
            <input type="text" id="nc-tags" class="nc-input" placeholder="Tags, comma-separated — the topics this note belongs to" value="${esc2((n.tags || []).join(', '))}">
            ${tagPool.length ? `<details class="note-tagsug-wrap"><summary class="tagsug-toggle">Suggested topic tags (${tagPool.length})</summary>
              <div class="note-tagsug">${tagPool.map(t => `<button class="tagsug" data-tag="${esc2(t)}">${esc2(t)}</button>`).join('')}</div></details>` : ''}
            <div class="nc-actions">
              <button class="btn btn-gold" id="nc-save">${editing ? 'Save changes' : 'Save note'}</button>
              ${editing ? '<button class="btn btn-ghost" id="nc-cancel">Cancel</button>' : ''}
            </div>
          </div>
        </details>`;
    }
    function noteCard(n) {
      return `<article class="card note-item" data-nid="${esc2(n.id)}">
        <div class="note-item-head"><h4>${esc2(n.title || 'Untitled')}</h4>
          <span class="note-item-actions"><button class="link" data-edit="${esc2(n.id)}">Edit</button> · <button class="link" data-del="${esc2(n.id)}">Delete</button></span></div>
        ${n.body ? `<p class="note-item-body">${esc2(n.body)}</p>` : ''}
        ${n.hook ? `<p class="note-item-hook">💡 ${esc2(n.hook)}</p>` : ''}
        ${(n.tags || []).length ? `<div class="note-item-tags">${n.tags.map(t => `<span class="note-tag">${esc2(t)}</span>`).join('')}</div>` : ''}
      </article>`;
    }
    function matches(n) {
      if (!search) return true;
      return [n.title, n.body, n.hook, (n.tags || []).join(' ')].join(' ').toLowerCase().includes(search);
    }
    function draw() {
      const shown = notes.filter(matches);
      wrap = view.querySelector('#notes-wrap');
      wrap.innerHTML = `
        ${composer()}
        <div class="notes-toolbar" data-animate>
          <input type="search" id="notes-search" class="studio-search" placeholder="Search notes by word, hook or tag…" value="${esc2(search)}" autocomplete="off">
          <span class="muted">${notes.length} note${notes.length === 1 ? '' : 's'}</span>
        </div>
        <div class="notes-grid" data-animate>${shown.length ? shown.map(noteCard).join('') : `<p class="muted studio-empty">${notes.length ? 'No notes match that search.' : 'No notes yet — write your first above.'}</p>`}</div>`;
      wire();
    }
    function wire() {
      const g = (id) => wrap.querySelector(id);
      wrap.querySelectorAll('.tagsug').forEach(b => b.addEventListener('click', () => {
        const input = g('#nc-tags'); const cur = input.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!cur.includes(b.dataset.tag)) cur.push(b.dataset.tag);
        input.value = cur.join(', ');
      }));
      g('#nc-save')?.addEventListener('click', async () => {
        const note = {
          id: editing?.id, title: g('#nc-title').value.trim(), body: g('#nc-body').value.trim(),
          hook: g('#nc-hook').value.trim(), tags: g('#nc-tags').value.split(',').map(s => s.trim()).filter(Boolean)
        };
        if (!note.title && !note.body) { g('#nc-title').focus(); return; }
        const btn = g('#nc-save'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const saved = await Backend.saveUserNote(note);
          const row = { id: saved.id, title: saved.title, body: saved.body, hook: saved.hook, tags: saved.tags || note.tags, question_key: saved.question_key };
          if (editing) { const i = notes.findIndex(x => x.id === editing.id); if (i >= 0) notes[i] = row; editing = null; }
          else notes.unshift(row);
          draw();
        } catch (e) { btn.disabled = false; btn.textContent = 'Save note'; alert('Could not save: ' + (e.message || e)); }
      });
      g('#nc-cancel')?.addEventListener('click', () => { editing = null; draw(); });
      g('#notes-search')?.addEventListener('input', e => { search = e.target.value.trim().toLowerCase(); const grid = wrap.querySelector('.notes-grid'); const shown = notes.filter(matches); grid.innerHTML = shown.length ? shown.map(noteCard).join('') : `<p class="muted studio-empty">No notes match that search.</p>`; bindItems(); });
      bindItems();
    }
    function bindItems() {
      wrap.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { editing = notes.find(n => n.id === b.dataset.edit) || null; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
      wrap.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const n = notes.find(x => x.id === b.dataset.del); if (!n || !confirm('Delete this note?')) return;
        try { await Backend.deleteUserNote(n.id); } catch {}
        const i = notes.indexOf(n); if (i >= 0) notes.splice(i, 1); draw();
      }));
    }
    draw();
  }

  function chapterCard(cat, paperN, topicN, byTopic, pStats) {
    const m = catMeta(cat.id);
    const sections = cat.sections.map(sec => {
      const liveTopics = sec.topics.filter(t => byTopic[t.id]?.length);
      if (!liveTopics.length) return '';
      const secCount = liveTopics.reduce((n, t) => n + byTopic[t.id].length, 0);
      return `
        <details class="chapter-section">
          <summary>
            <span class="cs-caret">▸</span>
            <span class="cs-title">${esc(sec.title)}</span>
            <span class="cs-count">${secCount}</span>
          </summary>
          <div class="cs-body">
            ${liveTopics.map(t => `
              <div class="topic-group">
                <p class="topic-group-title">${esc(t.title)}</p>
                <div class="paper-grid">${byTopic[t.id].map(p => paperCard(p, pStats)).join('')}</div>
              </div>`).join('')}
          </div>
        </details>`;
    }).join('');

    return `
      <article class="chapter" data-cat="${cat.id}" style="--chapter-glow:${m.glow}">
        <header class="chapter-head">
          <span class="chapter-medallion" style="background:${m.grad}">${m.letter}</span>
          <div class="chapter-heading">
            <h2>${esc(cat.title)}</h2>
            <p class="muted">${paperN} paper${paperN !== 1 ? 's' : ''} · ${topicN} topic${topicN !== 1 ? 's' : ''}</p>
          </div>
          <span class="chapter-count" style="background:${m.grad}">${paperN}</span>
        </header>
        <div class="chapter-sections">${sections}</div>
      </article>`;
  }

  function paperCard(p, pStats) {
    const sba = pStats[p.id + ':SBA'];
    const emq = pStats[p.id + ':EMQ'];
    const best = Math.max(sba?.best || 0, emq?.best || 0);
    const attempted = !!(sba || emq);
    const m = catMeta(p.categoryId);
    return `
      <a class="paper-card" href="#/paper/${encodeURIComponent(p.id)}" style="--card-accent:${m.grad}">
        <div class="paper-badges">
          <span class="chip chip-sba">SBA ${p.sba || 0}</span>
          ${p.emq ? `<span class="chip chip-emq">EMQ ${p.emq}</span>` : ''}
          ${!attempted ? `<span class="chip chip-new">NEW</span>` : ''}
        </div>
        <h4>${esc(p.title)}</h4>
        <p class="paper-source muted">${esc(p.source || '')}</p>
        <div class="paper-meter"><span style="width:${best}%"></span></div>
        <div class="paper-foot">
          ${attempted ? `<span class="best ${best >= 70 ? 'good' : ''}">Best ${best}%</span>` : `<span class="best muted">Not attempted</span>`}
          <span class="paper-go">Open →</span>
        </div>
      </a>`;
  }

  /* ================= paper detail (choose kind + mode) ================= */

  async function renderPaper(paperId, user) {
    const loaded = await Data.loadPaper(paperId);
    const { meta, paper, path } = loaded;
    const sbaN = Data.countSBA(paper), emqN = Data.countEMQ(paper);
    const progress = await Backend.getProgress();
    const pStats = Progression.paperStats(progress);

    // saved (resumable) sessions for this paper, keyed by "kind:mode"
    const sessions = {};
    try {
      (await Backend.listSessions()).forEach(s => {
        if (s.key.startsWith(paperId + ':')) {
          const [, kind, mode] = s.key.split(':');
          const st = s.state || {};
          if ((st.answered || 0) > 0 && st.answered < st.total) sessions[kind + ':' + mode] = st;
        }
      });
    } catch { /* optional */ }

    function bestFor(kind) { const s = pStats[paperId + ':' + kind]; return s ? `Best ${s.best}% · ${s.attempts} attempt${s.attempts > 1 ? 's' : ''}` : 'Not attempted yet'; }

    // Questions from this paper you've already answered ANYWHERE — including
    // inside simulator mocks. Re-reading those wastes revision time, so each
    // deck offers to skip them.
    let seenSet = new Set();
    try { seenSet = (typeof Coverage !== 'undefined') ? (await Coverage.attempted()).seen : new Set(); } catch {}
    const seenIn = kind => Data.flatten(paper, kind).filter(q => seenSet.has(`${paperId}:${kind}:${q.number}`)).length;

    view.innerHTML = `
      <section class="page narrow">
        <a class="link muted" href="#/library" data-animate>← Library</a>
        <header data-animate>
          <p class="kicker">${esc(path.category?.title || '')}${path.section ? ' · ' + esc(path.section.title) : ''}</p>
          <h1 class="page-title">${esc(paper.topic || meta.title)}</h1>
          <p class="muted">${esc(paper.source || meta.source || '')}</p>
          ${paper.description ? `<p class="paper-desc">${esc(paper.description)}</p>` : ''}
        </header>

        <div class="run-grid">
          ${sbaN ? runCard('SBA', sbaN, bestFor('SBA'), paperId, sessions, seenIn('SBA')) : ''}
          ${emqN ? runCard('EMQ', emqN, bestFor('EMQ'), paperId, sessions, seenIn('EMQ')) : ''}
        </div>
        <p class="muted mode-note">
          <strong>Exam mode</strong> is timed and shows feedback at the end.
          <strong>Study mode</strong> shows the answer and rationale immediately after each question.
          A half-finished paper is saved automatically so you can resume it here.
        </p>
      </section>`;

    // "skip seen" toggle → point this card's runs at the unseen-only route
    view.querySelectorAll('[data-fresh]').forEach(cb => cb.addEventListener('change', () => {
      const card = cb.closest('.run-card');
      card.querySelectorAll('[data-run]').forEach(a => {
        const base = a.getAttribute('href').replace(/\/fresh$/, '');
        a.setAttribute('href', cb.checked ? base + '/fresh' : base);
      });
      card.classList.toggle('is-fresh', cb.checked);
    }));

    // restart handlers
    view.querySelectorAll('[data-restart]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault();
      const key = b.dataset.restart;
      try { await Backend.clearSession(key); } catch {}
      location.hash = '#/quiz/' + key.split(':').map(encodeURIComponent).join('/');
    }));
  }

  function runCard(kind, n, best, paperId, sessions, seen = 0) {
    const fresh = Math.max(0, n - seen);
    const mins = Math.max(5, Math.round(n * 1.8));
    function actions(mode, label) {
      const s = sessions[kind + ':' + mode];
      const href = `#/quiz/${encodeURIComponent(paperId)}/${kind}/${mode}`;
      const cls = mode === 'exam' ? 'btn-gold' : 'btn-primary';
      if (s) {
        return `<div class="resume-pair">
          <a class="btn ${cls}" href="${href}">Resume ${label} · ${s.answered}/${s.total}</a>
          <a class="btn btn-ghost btn-sm" href="#" data-restart="${paperId}:${kind}:${mode}">Restart</a>
        </div>`;
      }
      return `<a class="btn ${cls}" data-run="${mode}" href="${href}">${label}${mode === 'exam' ? ' · ~' + mins + ' min' : ''}</a>`;
    }
    // Some of this deck may already have come up inside a mock. Skipping those
    // turns a re-read into a pure gap-filling session.
    const freshRow = seen > 0 ? `
      <label class="run-fresh ${fresh ? '' : 'is-dry'}">
        <input type="checkbox" data-fresh="${kind}" ${fresh ? '' : 'disabled'}>
        <span class="run-fresh-box"></span>
        <span class="run-fresh-txt">Skip the <b>${seen}</b> I've already seen
          <i>${fresh ? `· ${fresh} unseen left` : '· none left unseen'}</i></span>
      </label>` : '';
    return `
      <div class="run-card" data-kind="${kind}">
        <div class="run-head">
          <span class="chip chip-${kind.toLowerCase()}">${kind}</span>
          <span class="run-count">${n} question${n > 1 ? 's' : ''}</span>
          ${seen > 0 ? `<span class="run-seen" title="Answered before, here or in a mock">${seen} seen</span>` : ''}
        </div>
        <p class="muted run-best">${best}</p>
        ${freshRow}
        <div class="run-actions">
          ${actions('exam', 'Exam mode')}
          ${actions('study', 'Study mode')}
        </div>
      </div>`;
  }

  /* ================= quiz ================= */

  /* unpaid accounts: 30 SBA/EMQ answers per day across the library */
  const FREE_DAILY_Q = 30;
  function dqKey(user) { return 'aureum.dq.' + (user?.id || 'anon') + '.' + new Date().toISOString().slice(0, 10); }
  function dailyCount(user) { try { return Number(localStorage.getItem(dqKey(user))) || 0; } catch { return 0; } }
  function addDailyCount(user, n) { try { localStorage.setItem(dqKey(user), String(dailyCount(user) + n)); } catch { /* ignore */ } }

  async function renderQuiz(paperId, kind, mode, user, freshOnly) {
    if (!isPaid(user) && dailyCount(user) >= FREE_DAILY_Q) {
      view.innerHTML = `
        <section class="page narrow" data-animate>
          <div class="card locked-card">
            <span class="locked-ico">⏳</span>
            <h1 class="page-title">Daily limit reached</h1>
            <p class="muted">The free plan covers <strong>${FREE_DAILY_Q} questions a day</strong> — you've used them all. Come back tomorrow,
              or ask the site owner about full access (unlimited practice, AI tutor, simulator and flashcards).</p>
            <a class="btn btn-gold" href="#/dashboard">Back to dashboard</a>
          </div>
        </section>`;
      return;
    }
    const loaded = await Data.loadPaper(paperId);
    let questions = Data.flatten(loaded.paper, kind);
    if (!questions.length) throw new Error(`This paper has no ${kind} questions.`);
    // unseen-only run: drop anything already answered (here or in a mock) and
    // renumber, so the paper reads 1..n rather than showing gaps
    if (freshOnly) {
      let seen = new Set();
      try { seen = (typeof Coverage !== 'undefined') ? (await Coverage.attempted()).seen : new Set(); } catch {}
      const fresh = questions.filter(q => !seen.has(`${paperId}:${kind}:${q.number}`));
      if (!fresh.length) {
        view.innerHTML = `<section class="page narrow" data-animate>
          <div class="card fc-complete"><div class="fc-complete-ring">✓</div>
          <h2>Nothing left unseen here</h2>
          <p class="muted">You've already answered every ${kind} question in this paper. Run the full deck to revise, or pick another paper.</p>
          <a class="btn btn-gold" href="#/paper/${encodeURIComponent(paperId)}">Back to the paper</a></div></section>`;
        return;
      }
      questions = fresh.map((q, i) => ({ ...q, _qkey: `${paperId}:${kind}:${q.number}`, number: i + 1 }));
    }
    // a fresh-only run gets its own resume slot so it can't clash with the full deck
    const sessionKey = `${paperId}:${kind}:${mode}${freshOnly ? ':fresh' : ''}`;
    let resume = null;
    try {
      const saved = await Backend.loadSession(sessionKey);
      if (saved && (saved.answered || 0) > 0 && saved.answered < saved.total) resume = saved;
      else if (saved) { await Backend.clearSession(sessionKey); }   // stale/complete
    } catch { /* optional */ }
    view.innerHTML = '';
    Quiz.start(view, loaded, questions, {
      mode, kind, sessionKey, resume,
      timeLimitMinutes: Math.max(5, Math.round(questions.length * 1.8)),
      onFinish: async (attempt) => {
        addDailyCount(user, (attempt.detail || []).filter(d => d.chosen != null).length);
        const summary = await Backend.recordAttempt(attempt);
        try { ReviewQueue.addFromAttempt(attempt); } catch { /* optional */ }
        location.hash = '#/results/' + summary.attemptId;
      },
      onQuit: () => { location.hash = '#/paper/' + encodeURIComponent(paperId); }
    });
  }

  /* ================= results & review ================= */

  async function renderResults(attemptId, user) {
    await Data.loadSyllabus();
    const attempt = await Backend.getAttempt(attemptId);
    if (!attempt) throw new Error('That attempt could not be found.');

    let questions = null;
    try { questions = Data.flatten((await Data.loadPaper(attempt.paperId)).paper, attempt.kind); } catch { /* unpublished */ }

    const verdict = attempt.percent >= 85 ? { label: 'Distinction-grade', cls: 'good' }
      : attempt.percent >= 70 ? { label: 'On pass trajectory', cls: 'good' }
      : attempt.percent >= 50 ? { label: 'Building — review below', cls: '' }
      : { label: 'Foundation work needed', cls: 'bad' };

    view.innerHTML = `
      <section class="page narrow results-page">
        <header class="results-head" data-animate>
          <p class="kicker">${esc(attempt.paperTitle)} · ${attempt.kind} · ${attempt.studyMode ? 'Study' : 'Exam'}${attempt.timedOut ? ' · time expired' : ''}</p>
          <div class="score-hero"><span id="score-big">0%</span></div>
          <p class="verdict ${verdict.cls}">${verdict.label}</p>
          <p class="muted">${attempt.correct} of ${attempt.total} correct ·
            ${Math.floor(attempt.durationSec / 60)}m ${attempt.durationSec % 60}s ·
            <strong class="gold">+${attempt.xpGained} XP</strong></p>
          <div class="results-actions">
            <a class="btn btn-gold" href="#/quiz/${encodeURIComponent(attempt.paperId)}/${attempt.kind}/${attempt.studyMode ? 'study' : 'exam'}">Retake</a>
            <a class="btn btn-ghost" href="#/paper/${encodeURIComponent(attempt.paperId)}">Paper</a>
            <a class="btn btn-ghost" href="#/dashboard">Dashboard</a>
          </div>
        </header>
        ${questions ? `
          <h2 class="review-title" data-animate>Answer review</h2>
          <div class="review-list">
            ${questions.map((q, i) => {
              const d = attempt.detail[i] || {};
              const L = q.preLettered ? '' : Quiz.LETTERS[q.answer] + '. ';
              const chosenTxt = d.chosen == null ? null : (q.preLettered ? '' : Quiz.LETTERS[d.chosen] + '. ') + esc(q.options[d.chosen]);
              return `
                <article class="review-item ${d.isCorrect ? 'r-correct' : 'r-wrong'}" data-animate>
                  <header class="review-item-head">
                    <span class="r-badge">${d.isCorrect ? '✓' : '✗'}</span>
                    <span class="r-num">Q${i + 1}${q.kind === 'EMQ' && q.theme ? ' · ' + esc(q.theme) : ''}</span>
                  </header>
                  <p class="q-stem">${esc(q.stem)}</p>
                  ${q.lead ? `<p class="q-lead">${esc(q.lead)}</p>` : ''}
                  <p class="r-line ${d.isCorrect ? 'good' : 'bad'}">${d.chosen == null ? '<span class="bad">Not answered.</span>' : 'Your answer: ' + chosenTxt}</p>
                  ${!d.isCorrect ? `<p class="r-line good">Correct: ${L}${esc(q.options[q.answer])}</p>` : ''}
                  ${q.rationale ? `<p class="r-expl">${esc(q.rationale)}</p>` : ''}
                  ${q.hook ? `<p class="r-hook">💡 ${esc(q.hook)}</p>` : ''}
                  ${q.reference ? `<p class="r-ref">§ ${esc(q.reference)}</p>` : ''}
                  <div class="qedit-slot"></div>
                  <div class="r-note" data-note-key="${esc(attempt.paperId + ':' + attempt.kind + ':' + q.number)}"></div>
                  <div class="ai-slot" data-ai-i="${i}"></div>
                </article>`;
            }).join('')}
          </div>` : `<p class="muted" data-animate>This paper is no longer published, so the review is unavailable.</p>`}
      </section>`;

    FX.scoreReveal(document.getElementById('score-big'), attempt.percent);
    if (attempt.percent >= 70) FX.confetti(view.querySelector('.results-head'));

    // mount AI panels + notes on each reviewed question
    if (questions) {
      let notes = {};
      try { notes = await Backend.getNotesForPaper(attempt.paperId + ':' + attempt.kind + ':'); } catch { /* optional */ }
      questions.forEach((q, i) => {
        const d = attempt.detail[i] || {};
        const item = view.querySelectorAll('.review-item')[i];
        if (!item) return;
        // note display
        const nKey = attempt.paperId + ':' + attempt.kind + ':' + q.number;
        const noteEl = item.querySelector('.r-note');
        if (notes[nKey]) noteEl.innerHTML = `<div class="note-shown">🗒 <span>${esc(notes[nKey])}</span></div>`;
        // developer flag / edit-explanation (and any correction, shown to all)
        if (typeof QEdit !== 'undefined') {
          QEdit.mount(item.querySelector('.qedit-slot'), {
            questionKey: nKey, rationale: q.rationale || '', paperTitle: attempt.paperTitle,
            answerText: (q.preLettered ? '' : Quiz.LETTERS[q.answer] + '. ') + q.options[q.answer],
            question: Quiz.snapshotQuestion(q)
          });
        }
        // AI ("AI" is a lexical const — window.AI is always undefined, so the
        // old window.AI check silently disabled the tutor in every review)
        if (typeof AI !== 'undefined' && cfg.ai?.enabled) {
          AI.attach(item.querySelector('.ai-slot'), {
            questionKey: nKey, kind: q.kind, theme: q.theme || '', stem: q.stem, lead: q.lead || '',
            options: q.options, answer: q.answer, chosen: d.chosen, rationale: q.rationale || '',
            hook: q.hook || '', reference: q.reference || '', paperTitle: attempt.paperTitle, preLettered: q.preLettered
          });
        }
      });
    }
  }

  /* ================= profile ================= */

  async function renderProfile(user) {
    const progress = await Backend.getProgress();
    const stats = Progression.summarise(progress);
    const tier = stats.tier;
    const webPref = (typeof AI !== 'undefined' && AI.webMode) ? AI.webMode() : 'tab';

    view.innerHTML = `
      <section class="page narrow">
        <header data-animate>
          <p class="kicker">PROFILE</p>
          <h1 class="page-title">${esc(user.name)}</h1>
          <p class="muted">${esc(user.email)} · member since ${new Date(user.createdAt || Date.now()).toLocaleDateString()}</p>
        </header>

        <div class="card" data-animate>
          <h3 class="card-title">Position</h3>
          <p class="muted">Your training grade for the PGIM programme.</p>
          <div class="position-picker" id="position-picker">
            ${Progression.POSITIONS.map(p => `
              <button class="pos-btn ${user.position === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join('')}
          </div>
          <p class="save-note" id="pos-note" hidden>Saved ✓</p>
        </div>

        ${(!isPaid(user) && (isGranted(user, 'simulator') || isGranted(user, 'flashcards') || isGranted(user, 'cpd'))) ? `
        <div class="card" data-animate>
          <h3 class="card-title">Study tools</h3>
          <p class="muted">🔒 These tools are approved for your account but need an <strong>active payment</strong> —
            contact the site owner to activate your access.</p>
        </div>` : ''}
        ${(isPaid(user) && (isGranted(user, 'simulator') || isGranted(user, 'flashcards') || isGranted(user, 'cpd'))) ? `
        <div class="card" data-animate>
          <h3 class="card-title">Study tools</h3>
          <p class="muted">The site owner has approved these tools for your account. Switch one on and it stays on.</p>
          <div class="pref-toggles">
            ${isGranted(user, 'simulator') ? `
            <label class="pref-toggle">
              <span><strong>🎯 Adaptive simulator</strong><br><span class="muted tiny">Daily blueprint-shaped mocks + design your own custom papers.</span></span>
              <label class="dev-flag"><input type="checkbox" data-pref="simulator" ${user.prefs?.simulator ? 'checked' : ''}><span></span></label>
            </label>` : ''}
            ${isGranted(user, 'flashcards') ? `
            <label class="pref-toggle">
              <span><strong>🃏 Flashcards</strong><br><span class="muted tiny">Spaced-repetition decks with tap-to-flip and swipe gestures.</span></span>
              <label class="dev-flag"><input type="checkbox" data-pref="flashcards" ${user.prefs?.flashcards ? 'checked' : ''}><span></span></label>
            </label>` : ''}
            ${isGranted(user, 'cpd') ? `
            <label class="pref-toggle">
              <span><strong>📖 CPD</strong><br><span class="muted tiny">TOG true/false self-assessment by volume and topic, with the reasoning and a memory hook behind every answer.</span></span>
              <label class="dev-flag"><input type="checkbox" data-pref="cpd" ${user.prefs?.cpd ? 'checked' : ''}><span></span></label>
            </label>` : ''}
          </div>
          <p class="save-note" id="pref-note" hidden>Saved ✓</p>
        </div>` : ''}

        <div class="card" data-animate id="ai-usage-card">
          <h3 class="card-title">AI usage &amp; billing</h3>
          <div id="ai-usage-body"><p class="muted">Loading your AI usage…</p></div>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Mastery tiers</h3>
          <ol class="ladder">
            ${Progression.TIERS.map((T, i) => `
              <li class="ladder-step ${i < tier.index ? 'passed' : ''} ${i === tier.index ? 'current' : ''}">
                <span class="ladder-emblem">${T.emblem}</span>
                <span class="ladder-name">${T.title}</span>
                <span class="ladder-xp muted">${T.xp} XP</span>
              </li>`).join('')}
          </ol>
        </div>

        <div class="card" data-animate>
          <details class="fold" id="history-fold">
            <summary class="fold-sum">
              <h3 class="card-title">Full history (${(progress.attempts || []).length})</h3>
              <span class="fold-hint muted tiny">Tap to open</span>
            </summary>
            <div class="fold-body">
            ${(progress.attempts || []).length ? `
              <div class="table-scroll table-cap"><table class="table">
                <thead><tr><th>Paper</th><th>Type</th><th>Mode</th><th>Score</th><th>Date</th><th></th></tr></thead>
                <tbody>${progress.attempts.map(a => `
                  <tr>
                    <td>${esc(a.paperTitle)}</td>
                    <td><span class="chip chip-${a.kind.toLowerCase()}">${a.kind}</span></td>
                    <td class="muted">${a.studyMode ? 'Study' : 'Exam'}</td>
                    <td><strong class="${a.percent >= 70 ? 'good' : a.percent >= 50 ? '' : 'bad'}">${a.percent}%</strong></td>
                    <td class="muted">${new Date(a.date).toLocaleDateString()}</td>
                    <td><a class="link" href="#/results/${a.id}">Review</a></td>
                  </tr>`).join('')}</tbody>
              </table></div>` : `<p class="muted">Nothing yet — your history builds as you complete sets.</p>`}
            </div>
          </details>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Change password</h3>
          <form id="pw-form" class="pw-form" novalidate>
            <label class="field"><span>New password</span>
              <input type="password" name="p1" autocomplete="new-password" placeholder="At least 8 characters" required></label>
            <label class="field"><span>Confirm new password</span>
              <input type="password" name="p2" autocomplete="new-password" placeholder="Repeat it" required></label>
            <p class="form-error" id="pw-error" role="alert" hidden></p>
            <button class="btn btn-primary" type="submit">Update password</button>
            <p class="save-note" id="pw-note" hidden>Password updated ✓</p>
          </form>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Profile picture</h3>
          <p class="muted">Shown beside everything you post in the tea room, so friends recognise you at a glance.</p>
          <div class="avatar-row">
            <div class="avatar-preview" id="avatar-prev">${user.avatar
              ? `<img src="${esc(user.avatar)}" alt="Your picture">`
              : `<span>${esc((user.name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase())}</span>`}</div>
            <div class="avatar-acts">
              <label class="btn btn-gold btn-sm" style="cursor:pointer">⬆ Upload a picture
                <input type="file" id="avatar-file" accept="image/*" hidden></label>
              <span class="dev-status" id="avatar-msg"></span>
              <p class="muted tiny">A square photo works best. Max 4 MB.</p>
            </div>
          </div>
        </div>

        <div class="card wl-profile" data-animate>
          <h3 class="card-title">💳 Billing &amp; balance</h3>
          <p class="muted">AUREUM runs on a prepaid balance in rupees. Top up by uploading a bank slip; every AI call
            is metered and drawn from it.</p>
          <div class="wl-profile-row">
            <span class="wl-profile-bal" id="wl-prof-bal">…</span>
            <a class="btn btn-gold btn-sm" href="#/billing">Open billing &amp; top up →</a>
          </div>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Appearance</h3>
          <p class="muted">Everything about how AUREUM looks. Your choices are saved on this device at once and follow your
            account to any other. The same controls sit behind the <strong>⚙</strong> button in the bottom-left corner of
            every page, so you can change them without coming back here.</p>
          <div id="ap-profile-panel"></div>
          <label class="pref-toggle" style="margin-top:14px">
            <span><strong>🌐 Where web searches open</strong><br><span class="muted tiny">Used by “Search the web” in the AI tutor. A side window keeps the question on screen beside the source.</span></span>
            <select class="sel" id="websearch-mode">
              <option value="tab" ${webPref !== 'inline' ? 'selected' : ''}>New tab</option>
              <option value="inline" ${webPref === 'inline' ? 'selected' : ''}>Side window</option>
            </select>
          </label>
          <p class="save-note" id="appearance-note" hidden>Saved ✓</p>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">AUREUM AI ecosystem</h3>
          <p class="muted">Keep Gemini, ChatGPT, NotebookLM, Claude, Perplexity or Grok open beside AUREUM. A dock appears
            on the left, the page makes room for it, and a <strong>📋 Copy question</strong> button appears under every
            question so you can paste the stem and options straight into the model — without the answer, rationale or hook,
            so you are asking it cold.</p>
          <label class="pref-toggle" style="margin-top:12px">
            <span><strong>✦ Turn the ecosystem on</strong><br><span class="muted tiny">Adds the AI dock, the resizable split and the copy button. Nothing changes for anyone else.</span></span>
            <label class="dev-flag"><input type="checkbox" id="eco-toggle" ${(typeof Ecosystem !== 'undefined' && Ecosystem.enabled()) ? 'checked' : ''}><span></span></label>
          </label>
          <p class="muted tiny eco-caveat">Those platforms send headers that forbid any website from displaying them in a
            frame, so AUREUM opens each one in a companion window it positions beside your browser and re-uses when you
            switch platform. On iPad, Safari makes it a tab instead — use iPadOS Split View for a true side-by-side.</p>
          <p class="save-note" id="eco-note-saved" hidden>Saved ✓</p>
        </div>

        <div class="card danger-zone" data-animate>
          <h3 class="card-title">Data</h3>
          <p class="muted">${Backend.mode === 'cloud' ? 'Synced to your account across devices.' : 'Stored in this browser.'}</p>
          <button class="btn btn-ghost" id="export-data">Export my data (JSON)</button>
          <button class="btn btn-danger" id="reset-progress">Reset all progress</button>
        </div>
      </section>`;

    view.querySelectorAll('input[data-pref]').forEach(cb => cb.addEventListener('change', async () => {
      cb.disabled = true;
      try {
        await Backend.setPref(cb.dataset.pref, cb.checked);
        if (cb.checked) touchUse(cb.dataset.pref);          // start the 5-min activity clock
        const fresh = await Backend.currentUser();          // re-read → nav updates instantly
        renderNav(fresh);
        const note = view.querySelector('#pref-note'); note.hidden = false; setTimeout(() => note.hidden = true, 1800);
      } catch (e2) { cb.checked = !cb.checked; alert('Could not save: ' + (e2.message || e2)); }
      cb.disabled = false;
    }));

    renderAiUsage(view.querySelector('#ai-usage-body'), user);

    view.querySelector('#pw-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target), errBox = view.querySelector('#pw-error'), note = view.querySelector('#pw-note');
      errBox.hidden = true; note.hidden = true;
      if (String(f.get('p1')).length < 8) { errBox.textContent = 'Password must be at least 8 characters.'; errBox.hidden = false; return; }
      if (f.get('p1') !== f.get('p2')) { errBox.textContent = 'The two passwords do not match.'; errBox.hidden = false; return; }
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try { await Backend.updatePassword(f.get('p1')); e.target.reset(); note.hidden = false; setTimeout(() => note.hidden = true, 2500); }
      catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
      btn.disabled = false;
    });

    async function saveAppearancePref(patch) {
      const note = view.querySelector('#appearance-note');
      try {
        const prefs = Object.assign({}, (await Backend.currentUser())?.prefs, patch);
        await Backend.updateProfile({ prefs }); invalidateUser();
        if (note) { note.hidden = false; setTimeout(() => note.hidden = true, 1500); }
      } catch (e) { /* localStorage already holds it for this device */ }
    }
    view.querySelector('#avatar-file')?.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const msg = view.querySelector('#avatar-msg');
      if (f.size > 4 * 1048576) { msg.innerHTML = '<span class="bad">That image is over 4 MB.</span>'; return; }
      msg.textContent = 'Uploading…'; msg.className = 'dev-status';
      try {
        const url = await Backend.uploadAvatar(f);
        view.querySelector('#avatar-prev').innerHTML = `<img src="${esc(url)}" alt="Your picture">`;
        msg.innerHTML = '<span class="good">✓ Saved</span>';
        invalidateUser();
      } catch (err) { msg.innerHTML = `<span class="bad">${esc(err.message || err)}</span>`; }
      e.target.value = '';
    });
    // the prepaid balance, fetched after the page is up
    (async () => {
      try {
        const b = typeof Wallet !== 'undefined' ? await Wallet.badge() : null;
        const el = view.querySelector('#wl-prof-bal');
        if (el && b) { el.textContent = b.text; el.classList.toggle('is-empty', b.empty); }
        else if (el) el.textContent = '—';
      } catch { const el = view.querySelector('#wl-prof-bal'); if (el) el.textContent = '—'; }
    })();

    // one panel definition, used here and in the bottom-left dock
    const apHost = view.querySelector('#ap-profile-panel');
    if (apHost) { apHost.innerHTML = Appearance.panelHTML({ openColors: false }); Appearance.wire(apHost); }
    view.querySelector('#eco-toggle')?.addEventListener('change', e => {
      if (typeof Ecosystem !== 'undefined') Ecosystem.setEnabled(e.target.checked);
      saveAppearancePref({ aiEcosystem: e.target.checked });
      const note = view.querySelector('#eco-note-saved');
      if (note) { note.hidden = false; setTimeout(() => note.hidden = true, 1500); }
    });
    view.querySelector('#websearch-mode')?.addEventListener('change', e => {
      if (typeof AI !== 'undefined' && AI.setWebMode) AI.setWebMode(e.target.value);
      const note = view.querySelector('#appearance-note');
      if (note) { note.hidden = false; setTimeout(() => note.hidden = true, 1500); }
    });

    // The history table is long; remember whether it was left open so the
    // cards below it (picture, appearance) stay within easy reach.
    const fold = view.querySelector('#history-fold');
    if (fold) {
      try { fold.open = localStorage.getItem('aureum.history.open') === '1'; } catch {}
      fold.addEventListener('toggle', () => {
        try { localStorage.setItem('aureum.history.open', fold.open ? '1' : '0'); } catch {}
      });
    }

    view.querySelector('#position-picker').addEventListener('click', async e => {
      const btn = e.target.closest('.pos-btn'); if (!btn) return;
      view.querySelectorAll('.pos-btn').forEach(b => b.classList.toggle('active', b === btn));
      await Backend.updateProfile({ position: btn.dataset.pos });
      const note = view.querySelector('#pos-note'); note.hidden = false; setTimeout(() => note.hidden = true, 1800);
    });
    view.querySelector('#export-data').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ user: { name: user.name, email: user.email, position: user.position }, progress }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aureum-progress.json'; a.click(); URL.revokeObjectURL(a.href);
    });
    view.querySelector('#reset-progress').addEventListener('click', async () => {
      if (confirm('Erase all attempts, XP and streaks? This cannot be undone.')) { await Backend.resetProgress(); route(); }
    });
  }

  /* ================= profile: AI usage & billing ================= */

  async function renderAiUsage(host, user) {
    if (!host) return;
    if (Backend.mode !== 'cloud') {
      host.innerHTML = `<p class="muted">AI usage tracking runs on the live site (cloud backend). Nothing is metered in local mode.</p>`;
      return;
    }
    let myRows = [], counts = { all: 1, simulator: 1, dev: 1 }, sharedRows = [], features = {};
    try {
      await Billing.loadRates();                 // dev's rate card before pricing anything
      [myRows, counts, sharedRows, features] = await Promise.all([
        Backend.listMyTokenUsage(),
        Backend.getEligibleCounts(),
        Backend.listSharedUsage().catch(() => []),
        Backend.getAiFeatures().catch(() => ({}))
      ]);
    } catch (e) {
      host.innerHTML = `<p class="bad">Could not load your AI usage — ${esc(e.message || e)}<br>
        <span class="muted tiny">If this is a fresh deployment, the updated supabase/schema.sql needs to be run once.</span></p>`;
      return;
    }
    const sharedCtx = { rows: sharedRows, features, counts, selfUser: user };
    const month = new Date().toISOString().slice(0, 7);
    const sumM = Billing.mySummary(user, myRows, sharedCtx, month);
    const sumAll = Billing.mySummary(user, myRows, sharedCtx, null);

    if (!myRows.length && !sumAll.sharedTotal) {
      host.innerHTML = `<p class="muted">You haven't used any AI features yet — ask the tutor a question, generate flashcards, or run a mock coach, and your metered usage and cost will appear here.</p>`;
      return;
    }

    // combined mechanism list (personal + your share of shared pools), all-time
    const mechAll = [
      ...sumAll.personal.map(l => ({ ...l, kind: 'personal' })),
      ...sumAll.shared.map(l => ({ feature: l.feature, label: l.label, icon: Billing.featureIcon(l.feature), cost: l.cost, n: l.n, kind: 'shared' }))
    ].sort((a, b) => b.cost - a.cost);

    /* Month-by-month ledger: personal spend plus this user's share of the
       shared pools, so "what did AI cost me in June?" has an answer rather
       than only "this month" and a running total. */
    const thisMonthKey = new Date().toISOString().slice(0, 7);
    const monthKeys = [...new Set([
      ...myRows.map(r => String(r.day).slice(0, 7)),
      ...(sharedCtx?.rows || []).map(r => String(r.day).slice(0, 7))
    ])].filter(Boolean).sort().reverse();
    const monthRows = monthKeys.map(month => {
      const sum = Billing.summarise(myRows.filter(r => String(r.day).slice(0, 7) === month));
      const shared = Billing.sharedLines(user, sharedCtx, month).reduce((a, l) => a + l.cost, 0);
      return {
        month, label: Billing.monthLabel ? Billing.monthLabel(month) : month,
        calls: sum.calls, tokens: sum.inputTokens + sum.outputTokens,
        personal: sum.total, shared, total: sum.total + shared
      };
    });
    const allTime = monthRows.reduce((a, r) => ({
      calls: a.calls + r.calls, tokens: a.tokens + r.tokens,
      personal: a.personal + r.personal, shared: a.shared + r.shared, total: a.total + r.total
    }), { calls: 0, tokens: 0, personal: 0, shared: 0, total: 0 });

    // 30-day cost sparkline (personal spend)
    const series = Billing.dailyCost(myRows, 30);
    const maxDay = Math.max(...series.map(d => d.cost), 0.0001);
    const spark = series.map((d, i) => {
      const h = Math.max(1, Math.round((d.cost / maxDay) * 42));
      return `<rect x="${i * 8}" y="${46 - h}" width="6" height="${h}" rx="1.5" fill="${d.cost > 0 ? '#f4c95d' : '#3a405e'}"><title>${d.day}: ${Billing.usd(d.cost, 4)}</title></rect>`;
    }).join('');

    host.innerHTML = `
      <p class="muted">Every AI call you make is metered from the provider's own token counts — the same billing-grade data behind your invoice. Nothing here is estimated.</p>
      <div class="dev-users-stats aiu-stats">
        <div><strong>${Billing.usd(sumM.total)}</strong><span>This month</span></div>
        <div><strong>${Billing.usd(sumAll.total)}</strong><span>All time</span></div>
        <div><strong>${Billing.fmtInt(sumM.tokens)}</strong><span>Tokens this month</span></div>
        <div><strong>${Billing.fmtInt(sumM.calls)}</strong><span>AI calls this month</span></div>
      </div>

      <h4 class="aiu-sub">Where your spend goes${' '}<span class="muted tiny">(all time)</span></h4>
      <div class="aiu-mechs">
        ${mechAll.length ? mechAll.map(l => `
          <div class="aiu-mech">
            <span class="aiu-mech-name">${l.icon} ${esc(l.label)}${l.kind === 'shared' ? ` <span class="muted tiny">shared · your 1/${l.n}</span>` : ''}</span>
            <div class="aiu-bar"><span style="width:${Math.round((l.cost / (mechAll[0].cost || 1)) * 100)}%"></span></div>
            <span class="aiu-mech-cost">${Billing.usd(l.cost, l.cost < 0.1 ? 4 : 2)}</span>
          </div>`).join('') : `<p class="muted">No spend yet.</p>`}
      </div>

      <h4 class="aiu-sub">Month by month</h4>
      <div class="table-scroll"><table class="table aiu-months">
        <thead><tr><th>Month</th><th class="num">Calls</th><th class="num">Tokens</th><th class="num">Personal</th><th class="num">Shared</th><th class="num">Total</th></tr></thead>
        <tbody>${monthRows.length ? monthRows.map(r => `
          <tr class="${r.month === thisMonthKey ? 'is-current' : ''}">
            <td>${esc(r.label)}${r.month === thisMonthKey ? ' <span class="muted tiny">(this month)</span>' : ''}</td>
            <td class="num">${Billing.fmtInt(r.calls)}</td>
            <td class="num">${Billing.fmtInt(r.tokens)}</td>
            <td class="num">${Billing.usd(r.personal, r.personal < 0.1 ? 4 : 2)}</td>
            <td class="num">${Billing.usd(r.shared, r.shared < 0.1 ? 4 : 2)}</td>
            <td class="num"><strong>${Billing.usd(r.total, r.total < 0.1 ? 4 : 2)}</strong></td>
          </tr>`).join('') : '<tr><td colspan="6" class="muted">No metered months yet.</td></tr>'}
        </tbody>
        <tfoot><tr><th>All time</th><th class="num">${Billing.fmtInt(allTime.calls)}</th><th class="num">${Billing.fmtInt(allTime.tokens)}</th>
          <th class="num">${Billing.usd(allTime.personal, 2)}</th><th class="num">${Billing.usd(allTime.shared, 2)}</th>
          <th class="num"><strong>${Billing.usd(allTime.total, 2)}</strong></th></tr></tfoot>
      </table></div>

      <h4 class="aiu-sub">Last 30 days</h4>
      <svg class="aiu-spark" viewBox="0 0 240 48" preserveAspectRatio="none" role="img" aria-label="Daily AI cost, last 30 days">${spark}</svg>

      <h4 class="aiu-sub">Current rates <span class="muted tiny">· USD per 1,000,000 tokens</span></h4>
      <div class="table-scroll"><table class="table aiu-rates">
        <thead><tr><th>Model</th><th class="num">Input</th><th class="num">Output</th></tr></thead>
        <tbody>${Billing.rateCard().filter(r => !/\(retired\)/i.test(r.label)).map(r => `
          <tr><td>${esc(r.label)}</td><td class="num">$${r.in.toFixed(2)}</td><td class="num">$${r.out.toFixed(2)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="tiny muted">Providers report token counts only — never a price — so every cost here is computed from these rates. They are billed at cost, never marked up.</p>

      <div class="aiu-actions">
        <button class="btn btn-gold btn-sm" id="aiu-bill">🧾 Generate my invoice</button>
        <span class="muted tiny">Downloadable as JPEG / PNG / PDF, any month.</span>
      </div>
      <p class="tiny muted aiu-note">💡 <strong>Personal</strong> costs (tutor, coach, flashcards) are your own token use. <strong>Shared</strong> costs are your equal fraction of platform-wide AI jobs (e.g. question tagging), split across eligible users — never marked up.</p>`;

    host.querySelector('#aiu-bill').addEventListener('click', () => Billing.openBillModal(user, myRows, sharedCtx));
  }

  /* ================= dashboard: mock exam trajectory ================= */

  // Futuristic mock-paper chart: neon bars per mock (band-coloured), a
  // glowing trend line, the 70% pass line, and XP-per-mock markers.
  async function renderMockChart(host, user) {
    if (!host) return;
    let mocks = [];
    try { mocks = ((await Backend.listMockResults()) || []).filter(m => !m.custom); } catch { mocks = []; }
    if (!mocks.length) { host.innerHTML = ''; return; }
    const series = mocks.slice().reverse();          // oldest → newest
    const shown = series.slice(-14);                 // last 14 mocks
    const W = 720, H = 220, PAD = 34, bw = (W - PAD * 2) / Math.max(shown.length, 6);
    const y = p => H - 30 - (p / 100) * (H - 60);
    const bandCol = p => p >= 70 ? '#34d399' : p >= 50 ? '#e8a33d' : '#e05263';
    const bars = shown.map((m, i) => {
      const x = PAD + i * bw + bw * 0.18, w = bw * 0.64, h = (H - 30) - y(m.percent);
      return `<rect x="${x}" y="${y(m.percent)}" width="${w}" height="${Math.max(2, h)}" rx="4"
        fill="url(#mg${m.percent >= 70 ? 'G' : m.percent >= 50 ? 'A' : 'R'})" opacity="0.92">
        <title>Mock ${i + 1 + Math.max(0, series.length - 14)} · ${m.percent}% · ${new Date(m.date).toLocaleDateString()}${m.xpGained ? ' · +' + m.xpGained + ' XP' : ''}</title></rect>` +
        `<text x="${x + w / 2}" y="${y(m.percent) - 6}" text-anchor="middle" font-size="10" fill="${bandCol(m.percent)}">${m.percent}</text>`;
    }).join('');
    const pts = shown.map((m, i) => `${PAD + i * bw + bw / 2},${y(m.percent)}`).join(' ');
    const avg = Math.round(shown.reduce((s, m) => s + m.percent, 0) / shown.length);
    const best = Math.max(...shown.map(m => m.percent));
    const xpTotal = series.reduce((s, m) => s + (m.xpGained || 0), 0);
    host.innerHTML = `
      <div class="card mock-chart-card" data-animate>
        <div class="mock-chart-head">
          <h3 class="card-title">Mock exam trajectory</h3>
          <div class="mock-chart-stats">
            <span><strong>${series.length}</strong> mocks</span>
            <span>avg <strong class="${avg >= 70 ? 'good' : ''}">${avg}%</strong></span>
            <span>best <strong class="good">${best}%</strong></span>
            ${xpTotal ? `<span><strong class="dev-cost">+${xpTotal}</strong> XP earned</span>` : ''}
          </div>
        </div>
        <svg class="mock-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mock scores over time">
          <defs>
            <linearGradient id="mgG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#0d9468"/></linearGradient>
            <linearGradient id="mgA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4c95d"/><stop offset="1" stop-color="#b57b1e"/></linearGradient>
            <linearGradient id="mgR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e05263"/><stop offset="1" stop-color="#8f2836"/></linearGradient>
            <filter id="mglow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          ${[0, 25, 50, 75, 100].map(g => `<line x1="${PAD}" y1="${y(g)}" x2="${W - PAD}" y2="${y(g)}" stroke="rgba(255,255,255,.05)"/>` +
            `<text x="${PAD - 8}" y="${y(g) + 3}" text-anchor="end" font-size="9" fill="#5b6478">${g}</text>`).join('')}
          <line x1="${PAD}" y1="${y(70)}" x2="${W - PAD}" y2="${y(70)}" stroke="#34d399" stroke-dasharray="6 5" opacity=".55"/>
          <text x="${W - PAD}" y="${y(70) - 5}" text-anchor="end" font-size="9" fill="#34d399">PASS 70%</text>
          ${bars}
          ${shown.length > 1 ? `<polyline points="${pts}" fill="none" stroke="#7dd3fc" stroke-width="2" filter="url(#mglow)" opacity=".9"/>` : ''}
          ${shown.map((m, i) => `<circle cx="${PAD + i * bw + bw / 2}" cy="${y(m.percent)}" r="3" fill="#7dd3fc"/>`).join('')}
        </svg>
        <p class="tiny muted">Every completed mock also pays into your Total XP (10 XP per correct answer). Designed papers are charted separately in the simulator.</p>
      </div>`;
  }

  /* ================= My mistakes (per-mock AI decks + weakness log) ================= */

  async function renderMistakeDeck(deckId, user) {
    if (!canUse(user, 'simulator')) return renderLocked('My mistakes');
    await Flashcards.renderDeck(view, deckId, user);
  }

  async function renderMistakes(user) {
    if (!canUse(user, 'simulator')) return renderLocked('My mistakes');
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">MY MISTAKES · TURN LOSSES INTO MARKS</p>
          <h1 class="page-title">Mistake lab</h1>
          <p class="muted">Everything you've got wrong, weaponised: per-mock AI flashcard decks, your weakness map, and a
            study checklist that feeds straight into the next mock's design.</p>
        </header>
        <div id="mk-body"><p class="muted">Analysing your history…</p></div>
      </section>`;
    injectLibNav('mistakes', user);
    FX.viewIn(view);

    let mocks = [], decks = [], hist = null;
    try { mocks = ((await Backend.listMockResults()) || []); } catch { mocks = []; }
    try { decks = ((await Backend.listUserDecks()) || []).filter(d => /^deck-ai-/.test(d.id)); } catch { decks = []; }
    try { hist = await Simulator.loadHistory(); } catch { hist = { bucketAgg: {} }; }
    const studied = Object.assign({}, user.prefs?.studiedAreas || {});

    // wrong answers per topic across every mock (raw counts)
    const wrongBy = {};
    let totalWrong = 0, totalScored = 0;
    mocks.forEach(m => (m.detail || []).forEach(d => {
      if (d.excluded) return;
      totalScored++;
      if (!d.isCorrect && d.chosen != null) { totalWrong++; const b = d.bucket || '(other)'; wrongBy[b] = (wrongBy[b] || 0) + 1; }
    }));
    const wrongTop = Object.entries(wrongBy).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 10);
    const maxWrong = Math.max(...wrongTop.map(w => w.n), 1);

    // weakness list: decayed accuracy < 70% with evidence
    const weak = Object.entries(hist.bucketAgg || {})
      .filter(([, a]) => (a.rawSeen || 0) >= 3 && a.seen > 0 && (a.correct / a.seen) < 0.7)
      .map(([label, a]) => ({ label, pct: Math.round((a.correct / a.seen) * 100) }))
      .sort((x, y) => x.pct - y.pct);

    const cardsTotal = decks.reduce((s, d) => s + (d.cardCount || d.content?.cards?.length || 0), 0);
    const body = view.querySelector('#mk-body');
    body.innerHTML = `
      <div class="dev-users-stats mk-stats" data-animate>
        <div><strong>${totalWrong}</strong><span>Mistakes logged</span></div>
        <div><strong>${totalScored ? Math.round(((totalScored - totalWrong) / totalScored) * 100) + '%' : '—'}</strong><span>Overall accuracy</span></div>
        <div><strong>${decks.length}</strong><span>AI mistake decks</span></div>
        <div><strong>${weak.length}</strong><span>Weak areas open</span></div>
      </div>

      ${weak.length ? `
      <div class="card" data-animate>
        <h3 class="card-title">🎯 Weakness checklist</h3>
        <p class="muted">Tick an area once you've studied it — the next mock's weakness screen uses this to decide
          whether to test you there again.</p>
        <div class="mk-weak-list">${weak.map(w => `
          <label class="mk-weak-row ${studied[w.label] ? 'is-studied' : ''}">
            <input type="checkbox" data-studied="${esc(w.label)}" ${studied[w.label] ? 'checked' : ''}>
            <span class="mk-weak-name">${esc(w.label)}</span>
            <span class="mk-weak-pct ${w.pct < 50 ? 'bad' : ''}">${w.pct}%</span>
            <span class="mk-weak-state">${studied[w.label] ? '✓ studied' : 'to study'}</span>
          </label>`).join('')}</div>
        <p class="save-note" id="mk-note" hidden>Saved ✓</p>
      </div>` : ''}

      ${wrongTop.length ? `
      <div class="card" data-animate>
        <h3 class="card-title">Where the marks leaked</h3>
        <div class="mk-bars">${wrongTop.map(w => `
          <div class="mk-bar-row">
            <span class="mk-bar-label">${esc(w.label)}</span>
            <div class="mk-bar"><span style="width:${Math.round((w.n / maxWrong) * 100)}%"></span></div>
            <span class="mk-bar-n">${w.n}</span>
          </div>`).join('')}</div>
      </div>` : ''}

      <div class="card" data-animate>
        <h3 class="card-title">🃏 AI mistake decks — one per paper</h3>
        <p class="muted">Cards the AI wrote from YOUR wrong answers, kept separate per mock so you can revisit each sitting.
          They run in the full spaced-repetition engine.</p>
        ${decks.length ? `<div class="mk-decks">${decks.map(d => `
          <a class="mk-deck" href="#/mistakes/deck/${encodeURIComponent(d.id)}">
            <span class="mk-deck-ico">🃏</span>
            <span class="mk-deck-title">${esc(d.title)}</span>
            <span class="mk-deck-meta">${d.cardCount || d.content?.cards?.length || 0} cards</span>
          </a>`).join('')}</div>`
        : `<p class="muted">No decks yet — finish a mock, then use “Turn mistakes into flashcards” on the results page.</p>`}
      </div>`;

    body.querySelectorAll('[data-studied]').forEach(cb => cb.addEventListener('change', async () => {
      const label = cb.dataset.studied;
      if (cb.checked) studied[label] = new Date().toISOString().slice(0, 10); else delete studied[label];
      const row = cb.closest('.mk-weak-row');
      row.classList.toggle('is-studied', cb.checked);
      row.querySelector('.mk-weak-state').textContent = cb.checked ? '✓ studied' : 'to study';
      try {
        const prefs = Object.assign({}, (await Backend.currentUser())?.prefs, { studiedAreas: studied });
        await Backend.updateProfile({ prefs });
        const note = body.querySelector('#mk-note'); if (note) { note.hidden = false; setTimeout(() => note.hidden = true, 1500); }
      } catch (e) { alert('Could not save: ' + (e.message || e)); }
    }));
  }

  /* ================= peer review (open to every user) ================= */

  async function renderPeerReview(user) {
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">PEER REVIEW · OPEN TO EVERYONE</p>
          <h1 class="page-title">Review flagged questions</h1>
          <p class="muted">Questions the cohort flagged as wrong, waiting for a fix. Propose a corrected version —
            cite the guideline — and it goes to the site owner for approval. <strong>Nothing changes for anyone
            until they approve it</strong>, and approved fixes carry your name.</p>
        </header>
        <div id="pr-mine"></div>
        <div id="pr-list" data-animate><p class="muted">Loading flagged questions…</p></div>
      </section>`;
    FX.viewIn(view);

    // my earlier proposals + their status
    try {
      const mine = await Backend.listMyProposals();
      if (mine.length) {
        view.querySelector('#pr-mine').innerHTML = `
          <div class="card" data-animate>
            <details class="dev-collapse"><summary><span class="card-title">My proposals (${mine.length})</span><span class="dc-caret">▸</span></summary>
              ${mine.map(m => `<p class="pr-mine-row"><span class="chip pr-st-${esc(m.status)}">${esc(m.status)}</span>
                <code>${esc(m.questionKey)}</code> <span class="muted tiny">${new Date(m.created).toLocaleDateString()}</span></p>`).join('')}
            </details>
          </div>`;
      }
    } catch { /* optional */ }

    const host = view.querySelector('#pr-list');
    let flags = [];
    try { flags = await Backend.listFlaggedDetails(); } catch (e) {
      host.innerHTML = `<p class="bad">Could not load flagged questions — ${esc(e.message || e)}</p>`; return;
    }
    if (!flags.length) { host.innerHTML = `<p class="muted card" style="padding:20px">🎉 Nothing is flagged right now — the bank is clean. Flag any question you doubt while practising and it will appear here.</p>`; return; }

    const papers = await Data.publishedPapers();
    const titleOf = pid => papers.find(p => p.id === pid)?.title || pid;
    host.innerHTML = flags.map((f, i) => {
      const [pid, kind, num] = String(f.questionKey).split(':');
      return `
        <div class="dev-row card" data-pr="${i}">
          <div class="dev-row-head">
            <div>
              <p class="dev-file">🚩 ${esc(titleOf(pid))} · <span class="chip chip-${(kind || 'sba').toLowerCase()}">${esc(kind)}</span> Q${num}</p>
              ${(f.notes || []).length ? `<p class="muted tiny">Flagged because: ${f.notes.map(esc).join(' · ')}</p>` : '<p class="muted tiny">No reason given.</p>'}
            </div>
            <button class="btn btn-gold btn-sm" data-pr-open="${i}">✎ Review &amp; propose a fix</button>
          </div>
          <div class="qr-editor" data-pr-host="${i}"></div>
          <p class="dev-row-msg" data-pr-msg="${i}"></p>
        </div>`;
    }).join('');

    flags.forEach((f, i) => {
      view.querySelector(`[data-pr-open="${i}"]`).addEventListener('click', () => openProposalEditor(f, i));
    });

    async function openProposalEditor(f, i) {
      const hostEl = view.querySelector(`[data-pr-host="${i}"]`);
      const msg = view.querySelector(`[data-pr-msg="${i}"]`);
      if (hostEl.dataset.open === '1') { hostEl.dataset.open = '0'; hostEl.innerHTML = ''; return; }
      hostEl.dataset.open = '1';
      hostEl.innerHTML = `<p class="muted">Loading question…</p>`;
      const [pid, kind, numS] = String(f.questionKey).split(':');
      let flat;
      try {
        const loaded = await Data.loadPaper(pid);
        flat = Data.flatten(loaded.paper, kind).find(q => q.number === Number(numS));
      } catch (e) { hostEl.innerHTML = `<p class="bad">${esc(e.message || e)}</p>`; return; }
      if (!flat) { hostEl.innerHTML = `<p class="bad">Question not found (it may have been fixed already).</p>`; return; }
      hostEl.innerHTML = `
        <div class="qr-form">
          ${flat.theme ? `<label>Theme<input type="text" data-p="theme" value="${esc(flat.theme)}"></label>` : ''}
          <label>Stem<textarea data-p="stem">${esc(flat.stem)}</textarea></label>
          ${flat.lead ? `<label>Lead-in<input type="text" data-p="lead" value="${esc(flat.lead)}"></label>` : ''}
          <label>Options — one per line<textarea data-p="options" class="qr-options">${esc(flat.options.join('\n'))}</textarea></label>
          <label>Correct answer
            <select data-p="answer">${flat.options.map((o, oi) => `<option value="${oi}" ${oi === flat.answer ? 'selected' : ''}>${esc(String(o).slice(0, 80))}</option>`).join('')}</select></label>
          <label>Rationale<textarea data-p="rationale">${esc(flat.rationale || '')}</textarea></label>
          <label>Why is your version right? Cite the guideline (required)
            <textarea data-p="note" placeholder="e.g. NICE NG133 (2023) recommends labetalol first-line…"></textarea></label>
          <div class="qedit-btns">
            <button class="btn btn-gold btn-sm" data-p="send">📤 Send to the owner for approval</button>
          </div>
        </div>`;
      const val = k => hostEl.querySelector(`[data-p="${k}"]`)?.value;
      hostEl.querySelector('[data-p="send"]').addEventListener('click', async ev => {
        const note = String(val('note') || '').trim();
        if (note.length < 10) { msg.textContent = 'Please cite why your version is correct — the owner approves on that basis.'; msg.className = 'dev-row-msg bad'; return; }
        const opts = String(val('options') || '').split('\n').map(x => x.trim()).filter(Boolean);
        if (opts.length < 2) { msg.textContent = 'Need at least 2 options.'; msg.className = 'dev-row-msg bad'; return; }
        ev.target.disabled = true;
        try {
          await Backend.submitProposal({ questionKey: f.questionKey, note,
            proposed: { stem: val('stem'), lead: val('lead') || '', theme: val('theme') || '',
              options: opts, answer: Math.min(Number(val('answer')) || 0, opts.length - 1), rationale: val('rationale') || '' } });
          msg.textContent = '✓ Sent — the owner will review your proposal. Thank you for sharpening the bank.';
          msg.className = 'dev-row-msg good';
          hostEl.dataset.open = '0'; hostEl.innerHTML = '';
        } catch (e) { msg.textContent = e.message || String(e); msg.className = 'dev-row-msg bad'; ev.target.disabled = false; }
      });
    }
  }

  /* ================= studio — mission control ================= */

  async function renderStudio(user) {
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">STUDIO · MISSION CONTROL</p>
          <h1 class="page-title">Your studio</h1>
          <p class="muted">Your private workshop and the shared tea room — creations, notes and conversations, all in one console.</p>
        </header>
        <div class="studio-console" id="studio-console" data-animate></div>
        <div id="studio-panel" data-animate><p class="muted">Loading…</p></div>
      </section>`;

    const [items, notes, papers] = await Promise.all([
      Backend.listAiItems ? Backend.listAiItems().catch(() => []) : Promise.resolve([]),
      Backend.listAllNotes ? Backend.listAllNotes().catch(() => []) : Promise.resolve([]),
      Data.publishedPapers().catch(() => [])
    ]);
    const titleOf = {}; papers.forEach(p => titleOf[p.id] = p.title);

    // ---- creations (AI items) ----
    const creations = [];
    items.forEach(it => creations.push({
      kind: it.kind, when: it.created ? new Date(it.created).getTime() : 0,
      paper: it.paperTitle || titleOf[String(it.questionKey || '').split(':')[0]] || 'Unfiled',
      qnum: String(it.questionKey || '').split(':')[2] || '', ai: it,
      del: () => Backend.deleteAiItem(it.id)
    }));
    creations.sort((a, b) => b.when - a.when);
    creations.forEach((r, i) => r._i = i);

    // ---- notes ----
    const noteList = notes.map(n => {
      const [pid, , num] = String(n.question_key).split(':');
      return { key: n.question_key, paper: titleOf[pid] || pid || 'Unfiled', qnum: num || '', body: n.body };
    }).filter(n => n.body);

    const panel = view.querySelector('#studio-panel');
    const consoleEl = view.querySelector('#studio-console');
    const tiles = [
      { id: 'tearoom', ico: '☕', title: 'Tea room', sub: 'Discuss with friends', count: (typeof TeaRoom !== 'undefined' ? TeaRoom.unreadCount() : 0) || '💬', accent: 'linear-gradient(135deg,#f4c95d,#e8a33d)' },
      { id: 'creations', ico: '✨', title: 'AI creations', sub: 'Charts · mind maps · chats', count: creations.length, accent: 'linear-gradient(135deg,#7dd3fc,#a78bfa)' },
      { id: 'notes', ico: '🗒', title: 'My notes', sub: 'Quick jottings by question', count: noteList.length, accent: 'linear-gradient(135deg,#5eead4,#34d399)' }
    ];
    let active = 'tearoom';
    function drawConsole() {
      consoleEl.innerHTML = tiles.map(t => `
        <button class="studio-tile ${active === t.id ? 'active' : ''}" data-tile="${t.id}" style="--tile-accent:${t.accent}">
          <span class="studio-tile-ico">${t.ico}</span>
          <span class="studio-tile-txt"><strong>${t.title}</strong><span>${t.sub}</span></span>
          <span class="studio-tile-count">${t.count}</span>
        </button>`).join('');
      consoleEl.querySelectorAll('[data-tile]').forEach(b => b.addEventListener('click', () => { active = b.dataset.tile; drawConsole(); drawPanel(); }));
    }
    function drawPanel() {
      if (active === 'tearoom') return drawTearoom();
      if (active === 'notes') return drawNotes();
      return drawCreations();
    }

    /* ---- panel: AI creations ---- */
    const label = k => AI.kindLabel ? AI.kindLabel(k) : k;
    const icon = k => AI.kindIcon ? AI.kindIcon(k) : '✨';
    function drawCreations() {
      const live = () => creations.filter(r => !r._deleted);
      const present = () => [...new Set(live().map(r => r.kind))];
      let filter = 'all', search = '';
      panel.innerHTML = `
        <div class="studio-toolbar">
          <div class="studio-filters" id="studio-filters"></div>
          <input type="search" id="studio-search" class="studio-search" placeholder="Search your creations…" autocomplete="off">
        </div>
        <div id="studio-body"></div>`;
      const filtersEl = panel.querySelector('#studio-filters');
      const bodyEl = panel.querySelector('#studio-body');
      const searchEl = panel.querySelector('#studio-search');
      function drawFilters() {
        const L = live();
        filtersEl.innerHTML = `<button class="filter-chip ${filter === 'all' ? 'active' : ''}" data-k="all">All <span>${L.length}</span></button>` +
          present().map(k => `<button class="filter-chip ${filter === k ? 'active' : ''}" data-k="${k}">${icon(k)} ${esc(label(k))} <span>${L.filter(r => r.kind === k).length}</span></button>`).join('');
        filtersEl.querySelectorAll('.filter-chip').forEach(b => b.addEventListener('click', () => { filter = b.dataset.k; drawFilters(); draw(); }));
      }
      function matches(r) {
        if (r._deleted) return false;
        if (filter !== 'all' && r.kind !== filter) return false;
        if (!search) return true;
        return [r.paper, r.qnum, r.ai?.title || '', r.ai?.content || ''].join(' ').toLowerCase().includes(search);
      }
      function cardHTML(r) {
        return `<article class="studio-card ${r.kind === 'chat' ? 'is-chat' : ''}">
          <div class="studio-card-head">
            <span class="studio-card-kind">${icon(r.kind)} ${esc(label(r.kind))}${r.qnum ? ' · Q' + esc(r.qnum) : ''}</span>
            ${r.when ? `<span class="studio-card-when">${esc(new Date(r.when).toLocaleDateString())}</span>` : ''}
            <button class="studio-card-del" data-rid="${r._i}" title="Delete">🗑</button>
          </div>
          <div class="studio-card-body" data-render="${r._i}"></div>
        </article>`;
      }
      function draw() {
        const shown = creations.filter(matches);
        if (!shown.length) {
          bodyEl.innerHTML = `<p class="muted studio-empty">${live().length ? 'Nothing matches that filter.' : 'No creations yet. Open a question in Study mode, tap ✨ Explore with AI, and every chart, mind map and summary lands here.'}</p>`;
          return;
        }
        const groups = {};
        shown.forEach(r => (groups[r.paper] || (groups[r.paper] = [])).push(r));
        bodyEl.innerHTML = Object.keys(groups).map(paper => `
          <details class="studio-group" open>
            <summary><span class="studio-group-title">${esc(paper)}</span><span class="studio-group-count">${groups[paper].length}</span></summary>
            <div class="studio-grid">${groups[paper].map(cardHTML).join('')}</div>
          </details>`).join('');
        bodyEl.querySelectorAll('[data-render]').forEach(el => { const r = creations[Number(el.dataset.render)]; if (r && r.ai) AI.renderSavedItem(el, r.ai); });
        bodyEl.querySelectorAll('.studio-card-del').forEach(b => b.addEventListener('click', async () => {
          const r = creations[Number(b.dataset.rid)]; if (!r || !confirm('Delete this item from your studio?')) return;
          try { await r.del(); } catch {}
          r._deleted = true; drawFilters(); draw();
        }));
      }
      searchEl.addEventListener('input', () => { search = searchEl.value.trim().toLowerCase(); draw(); });
      drawFilters(); draw();
    }

    /* ---- panel: My notes ---- */
    function drawNotes() {
      let search = '';
      panel.innerHTML = `
        <div class="studio-toolbar">
          <p class="muted" style="margin:0">Quick notes you jotted on questions. For structured study notes with tags and hooks, see <a class="link" href="#/library/notes">Library → Notes</a>.</p>
          <input type="search" id="note-search" class="studio-search" placeholder="Search notes…" autocomplete="off">
        </div>
        <div id="note-body"></div>`;
      const bodyEl = panel.querySelector('#note-body');
      function draw() {
        const shown = noteList.filter(n => !search || (n.body + ' ' + n.paper).toLowerCase().includes(search));
        if (!shown.length) { bodyEl.innerHTML = `<p class="muted studio-empty">${noteList.length ? 'No notes match that search.' : 'No notes yet. In Study mode, tap 🗒 Note under any question to jot a reminder.'}</p>`; return; }
        const groups = {};
        shown.forEach(n => (groups[n.paper] || (groups[n.paper] = [])).push(n));
        bodyEl.innerHTML = Object.keys(groups).map(paper => `
          <details class="studio-group" open>
            <summary><span class="studio-group-title">${esc(paper)}</span><span class="studio-group-count">${groups[paper].length}</span></summary>
            <div class="studio-grid">${groups[paper].map(n => `
              <article class="studio-card"><div class="studio-card-head"><span class="studio-card-kind">🗒 Note${n.qnum ? ' · Q' + esc(n.qnum) : ''}</span></div>
              <div class="studio-card-body"><div class="note-shown"><span>${esc(n.body)}</span></div></div></article>`).join('')}</div>
          </details>`).join('');
      }
      panel.querySelector('#note-search').addEventListener('input', e => { search = e.target.value.trim().toLowerCase(); draw(); });
      draw();
    }

    /* ---- panel: Tea room — delegated to the TeaRoom module, so the page
           panel and the floating dock share one live state. ---- */
    function drawTearoom() {
      if (typeof TeaRoom === 'undefined') { panel.innerHTML = '<p class="muted">Tea room unavailable.</p>'; return; }
      TeaRoom.renderPanel(panel);
    }

    drawConsole(); drawPanel();
  }

  /* ================= developer console ================= */

  async function renderDev(section, user) {
    if (!devOnly(user)) return renderDevGate(user);
    if (!(await ensureDevKey())) { location.hash = '#/dashboard'; return; }
    await DevConsole.render(view, { cfg, Data, Backend, esc, FX }, section || 'hub');
  }

  /**
   * Passkey gate for the developer console. Asks once per session; the key
   * is verified server-side against the Cloudflare secret PASS_KEY
   * (functions/api/devkey.js). If PASS_KEY isn't configured yet — or the
   * site runs in local mode — the developer code from config.js unlocks it,
   * so you're never locked out.
   */
  function ensureDevKey() {
    if (sessionStorage.getItem('aureum-passkey') === '1') return Promise.resolve(true);
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'passkey-overlay';
      overlay.innerHTML = `
        <div class="passkey-modal" role="dialog" aria-modal="true" aria-label="Developer passkey">
          <div class="passkey-ico">🔐</div>
          <h2>Developer passkey</h2>
          <p class="muted">Enter the passkey to open the developer console.</p>
          <form id="pk-form">
            <input type="password" id="pk-input" inputmode="numeric" autocomplete="off"
              maxlength="16" placeholder="• • • •" aria-label="Passkey">
            <p class="form-error" id="pk-error" hidden></p>
            <div class="passkey-btns">
              <button class="btn btn-gold" type="submit">Unlock</button>
              <button class="btn btn-ghost" type="button" id="pk-cancel">Cancel</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#pk-input');
      const err = overlay.querySelector('#pk-error');
      const done = ok => { overlay.remove(); resolve(ok); };
      setTimeout(() => input.focus(), 50);
      if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo('.passkey-modal', { opacity: 0, y: 26, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'power3.out' });
      }
      overlay.querySelector('#pk-cancel').addEventListener('click', () => done(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
      overlay.querySelector('#pk-form').addEventListener('submit', async e => {
        e.preventDefault();
        const key = input.value.trim();
        if (!key) return;
        err.hidden = true;
        let ok = false, configured = true;
        try {
          const res = await fetch('/api/devkey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
          if (res.ok) { const data = await res.json().catch(() => ({})); ok = !!data.ok; configured = data.configured !== false; }
          else configured = false;                   // endpoint missing (local / old deploy)
        } catch { configured = false; }              // network error / local mode
        if (!ok && !configured) ok = key === cfg.developer.code;   // fallback so you're never locked out
        if (ok) { sessionStorage.setItem('aureum-passkey', '1'); done(true); }
        else {
          err.textContent = configured ? 'Incorrect passkey.' : 'Incorrect. (PASS_KEY not set in Cloudflare yet — the developer code also works.)';
          err.hidden = false; input.value = ''; input.focus();
          FX.shake(overlay.querySelector('.passkey-modal'));
        }
      });
    });
  }

  /* ================= flashcards & simulator (two-key access) ================= */

  // TWO KEYS turn these tabs on, plus payment:
  //   1. the developer's GRANT (featureFlags — trigger-protected).
  //      Without it the toggle isn't even visible in Profile.
  //   2. the user's own ACTIVATION (prefs — flipped once in Profile and it
  //      STAYS on; no expiry).
  // Unpaid users (no `paid` flag) don't get these tabs at all.
  const isPaid = user => devOnly(user) || !!user?.featureFlags?.paid;
  const canUse = (user, flag) => devOnly(user) || (isPaid(user) && !!user?.featureFlags?.[flag] && !!user?.prefs?.[flag]);
  const isGranted = (user, flag) => devOnly(user) || !!user?.featureFlags?.[flag];
  /** CPD needs BOTH the developer's grant and the user's own switch. Used by
      the Library tab and by the routes, so a typed-in URL cannot walk past the
      gate the tab respects. */
  const cpdAllowed = user => !!user && (devOnly(user) || (isPaid(user) && user.featureFlags?.cpd && user.prefs?.cpd));
  const touchUse = () => {};   // retained no-op (activation no longer expires)
  const routeFlag = () => null;
  async function renderReview(user) { await ReviewQueue.renderRun(view, user); }
  function renderLocked(title) {
    view.innerHTML = `
      <section class="page narrow" data-animate>
        <div class="card locked-card">
          <span class="locked-ico">🔒</span>
          <h1 class="page-title">${esc(title)} is invite-only for now</h1>
          <p class="muted">This advanced feature is being rolled out gradually. Ask the site owner to enable it on your account — everything else keeps working as normal.</p>
          <a class="btn btn-gold" href="#/dashboard">Back to dashboard</a>
        </div>
      </section>`;
  }
  // prepend the Library sub-nav to a sub-page rendered by another module
  function injectLibNav(active, user) {
    const page = view.querySelector('.page'); if (!page) return;
    const nav = document.createElement('div');
    nav.innerHTML = librarySubnav(active, user);
    page.insertBefore(nav.firstElementChild, page.firstChild);
  }
  async function renderCards(user) { if (!canUse(user, 'flashcards')) return renderLocked('Flashcards'); await Flashcards.renderList(view, user); injectLibNav('cards', user); }
  async function renderDeck(deckId, user) { if (!canUse(user, 'flashcards')) return renderLocked('Flashcards'); await Flashcards.renderDeck(view, deckId, user); }
  async function renderSimHome(user) { if (!canUse(user, 'simulator')) return renderLocked('The adaptive simulator'); await Simulator.renderHome(view, user); }
  async function renderSimRun(user) { if (!canUse(user, 'simulator')) return renderLocked('The adaptive simulator'); await Simulator.startRun(view, user); }
  async function renderSimDesign(user) { if (!canUse(user, 'simulator')) return renderLocked('The adaptive simulator'); await Simulator.renderDesign(view, user); }
  async function renderSimSearch(user) { if (!canUse(user, 'simulator')) return renderLocked('The adaptive simulator'); await Simulator.renderSearch(view, user); }
  async function renderSimResult(id, user) { if (!canUse(user, 'simulator')) return renderLocked('The adaptive simulator'); await Simulator.renderResult(view, id, user); }

  function renderDevGate(user) {
    view.innerHTML = `
      <section class="page narrow" data-animate>
        <p class="kicker">DEVELOPER</p>
        <h1 class="page-title">Restricted area</h1>
        <p class="muted">The developer console lets the site owner import and index question papers from Google Drive.
          Enter the developer code to continue.</p>
        <div class="auth-card" style="margin-top:20px">
          <form id="dev-form">
            <label class="field"><span>Developer code</span>
              <input type="password" name="code" placeholder="Developer code" autocomplete="off"></label>
            <p class="form-error" id="dev-error" hidden></p>
            <button class="btn btn-gold btn-block" type="submit">Unlock</button>
          </form>
        </div>
      </section>`;
    view.querySelector('#dev-form').addEventListener('submit', e => {
      e.preventDefault();
      const code = new FormData(e.target).get('code');
      if (code === cfg.developer.code) { sessionStorage.setItem('aureum-dev', '1'); renderNav(user); route(); }
      else { const err = view.querySelector('#dev-error'); err.textContent = 'Incorrect code.'; err.hidden = false; }
    });
  }

  /* ================= boot ================= */

  try { Backend.onPasswordRecovery?.(() => renderResetPassword()); } catch { /* optional */ }
  window.addEventListener('hashchange', route);
  // Apply the last-used appearance from localStorage BEFORE first paint so
  // there's no flash of the wrong theme (prefs sync refines it after auth).
  /* The engine writes to the device at once and to the account when signed
     in, so a change made on the phone is on the laptop next time. */
  try {
    Appearance.init(async patch => {
      try {
        const u = await Backend.currentUser();
        if (!u) return;
        await Backend.updateProfile({ prefs: Object.assign({}, u.prefs, patch) });
        invalidateUser();
      } catch { /* the device copy already holds it */ }
    });
  } catch (e) { console.warn('appearance:', e); }
  const _energyBoot = (() => { try { return Appearance.state().energy; } catch { return false; } })();
  window.addEventListener('DOMContentLoaded', async () => {
    const canvas = document.getElementById('bg-canvas');
    if (canvas && !_energyBoot) ThreeBG.init(canvas);
    try { await Backend.init(); } catch (e) { console.warn('Backend init:', e); }
    route();
  });
})();
