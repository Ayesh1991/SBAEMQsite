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
    { re: /^#\/paper\/([^/]+)$/, fn: renderPaper },
    { re: /^#\/quiz\/([^/]+)\/(SBA|EMQ)\/(exam|study)$/, fn: renderQuiz },
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
    { re: /^#\/dev(?:\/(papers|cards|users|blueprint|review|ai))?$/, fn: renderDev }
  ];
  const devOnly = user => !!(user && (user.email === cfg.developer.email || sessionStorage.getItem('aureum-dev') === '1'));

  async function route() {
    Quiz.destroy();
    const hash = location.hash || '#/';
    // Supabase recovery links land with tokens in the hash — let the client
    // consume them and wait for the PASSWORD_RECOVERY event (below).
    if (/access_token=|type=recovery/.test(hash)) { renderResetPassword(); return; }
    const match = routes.find(r => r.re.test(hash));
    if (!match) { location.hash = '#/'; return; }
    const user = await Backend.currentUser();
    if (!match.public && !user) { location.hash = '#/auth'; return; }
    // registration approval gate: pending/denied accounts see only a notice
    if (user && !devOnly(user) && user.status && user.status !== 'approved' && !match.public) {
      renderApprovalGate(user); return;
    }
    await syncExamDate(user);

    ThreeBG.setMood(match.fn === renderLanding ? 'hero' : 'interior');
    { const rf = routeFlag?.(); if (rf) touchUse(rf); }   // visiting the tab counts as using it
    renderNav(user);
    view.className = 'view';
    window.scrollTo(0, 0);
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
          <a href="#/studio" class="${location.hash === '#/studio' ? 'active' : ''}">Studio</a>
          <a href="#/peer" class="${location.hash === '#/peer' ? 'active' : ''}">Peer review</a>
          ${fcOn ? `<a href="#/cards" class="${location.hash.startsWith('#/cards') ? 'active' : ''}">Flashcards</a>` : ''}
          ${simOn ? `<a href="#/simulator" class="${location.hash.startsWith('#/simulator') ? 'active' : ''}">Simulator</a>` : ''}
          ${simOn ? `<a href="#/mistakes" class="${location.hash.startsWith('#/mistakes') ? 'active' : ''}">My mistakes</a>` : ''}
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

  async function renderLibrary(user) {
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
          ${sbaN ? runCard('SBA', sbaN, bestFor('SBA'), paperId, sessions) : ''}
          ${emqN ? runCard('EMQ', emqN, bestFor('EMQ'), paperId, sessions) : ''}
        </div>
        <p class="muted mode-note">
          <strong>Exam mode</strong> is timed and shows feedback at the end.
          <strong>Study mode</strong> shows the answer and rationale immediately after each question.
          A half-finished paper is saved automatically so you can resume it here.
        </p>
      </section>`;

    // restart handlers
    view.querySelectorAll('[data-restart]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault();
      const key = b.dataset.restart;
      try { await Backend.clearSession(key); } catch {}
      location.hash = '#/quiz/' + key.split(':').map(encodeURIComponent).join('/');
    }));
  }

  function runCard(kind, n, best, paperId, sessions) {
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
      return `<a class="btn ${cls}" href="${href}">${label}${mode === 'exam' ? ' · ~' + mins + ' min' : ''}</a>`;
    }
    return `
      <div class="run-card">
        <div class="run-head">
          <span class="chip chip-${kind.toLowerCase()}">${kind}</span>
          <span class="run-count">${n} question${n > 1 ? 's' : ''}</span>
        </div>
        <p class="muted run-best">${best}</p>
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

  async function renderQuiz(paperId, kind, mode, user) {
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
    const questions = Data.flatten(loaded.paper, kind);
    if (!questions.length) throw new Error(`This paper has no ${kind} questions.`);
    const sessionKey = `${paperId}:${kind}:${mode}`;
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
            answerText: (q.preLettered ? '' : Quiz.LETTERS[q.answer] + '. ') + q.options[q.answer]
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

        ${(!isPaid(user) && (isGranted(user, 'simulator') || isGranted(user, 'flashcards'))) ? `
        <div class="card" data-animate>
          <h3 class="card-title">Study tools</h3>
          <p class="muted">🔒 These tools are approved for your account but need an <strong>active payment</strong> —
            contact the site owner to activate your access.</p>
        </div>` : ''}
        ${(isPaid(user) && (isGranted(user, 'simulator') || isGranted(user, 'flashcards'))) ? `
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
          <h3 class="card-title">Full history (${(progress.attempts || []).length})</h3>
          ${(progress.attempts || []).length ? `
            <div class="table-scroll"><table class="table">
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

      <h4 class="aiu-sub">Last 30 days</h4>
      <svg class="aiu-spark" viewBox="0 0 240 48" preserveAspectRatio="none" role="img" aria-label="Daily AI cost, last 30 days">${spark}</svg>

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

  /* ================= studio (private AI gallery) ================= */

  async function renderStudio(user) {
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">STUDIO · PRIVATE TO YOU</p>
          <h1 class="page-title">Your AI studio</h1>
          <p class="muted">Every conversation, chart, mind map, infographic and note you've created — grouped by paper, private to your account.</p>
        </header>
        <div class="studio-stats" id="studio-stats" data-animate hidden></div>
        <div class="studio-toolbar" data-animate>
          <div class="studio-filters" id="studio-filters"></div>
          <input type="search" id="studio-search" class="studio-search" placeholder="Search your studio…" autocomplete="off">
        </div>
        <div id="studio-body"><p class="muted">Loading your studio…</p></div>
      </section>`;

    const [items, notes, papers] = await Promise.all([
      Backend.listAiItems ? Backend.listAiItems().catch(() => []) : Promise.resolve([]),
      Backend.listAllNotes ? Backend.listAllNotes().catch(() => []) : Promise.resolve([]),
      Data.publishedPapers().catch(() => [])
    ]);
    const titleOf = {}; papers.forEach(p => titleOf[p.id] = p.title);

    const records = [];
    items.forEach(it => records.push({
      kind: it.kind, when: it.created ? new Date(it.created).getTime() : 0,
      paper: it.paperTitle || titleOf[String(it.questionKey || '').split(':')[0]] || 'Unfiled',
      qnum: String(it.questionKey || '').split(':')[2] || '', ai: it,
      del: () => Backend.deleteAiItem(it.id)
    }));
    notes.forEach(n => {
      const [pid, , num] = String(n.question_key).split(':');
      records.push({ kind: 'note', when: 0, paper: titleOf[pid] || pid || 'Unfiled', qnum: num || '', note: n.body, del: () => Backend.saveNote(n.question_key, '') });
    });
    records.sort((a, b) => b.when - a.when);
    records.forEach((r, i) => r._i = i);

    // summary band: what's in the studio at a glance
    const statsEl = view.querySelector('#studio-stats');
    if (statsEl && records.length) {
      const paperCount = new Set(records.map(r => r.paper)).size;
      const latest = records.find(r => r.when);
      statsEl.hidden = false;
      statsEl.innerHTML = `
        <div class="studio-stat"><strong>${records.length}</strong><span>Saved items</span></div>
        <div class="studio-stat"><strong>${records.filter(r => r.kind === 'chat').length}</strong><span>Conversations</span></div>
        <div class="studio-stat"><strong>${records.filter(r => r.kind === 'note').length}</strong><span>Notes</span></div>
        <div class="studio-stat"><strong>${paperCount}</strong><span>Papers covered</span></div>
        ${latest ? `<div class="studio-stat"><strong>${esc(new Date(latest.when).toLocaleDateString())}</strong><span>Last saved</span></div>` : ''}`;
    }

    const label = k => k === 'note' ? 'Note' : (AI.kindLabel ? AI.kindLabel(k) : k);
    const icon = k => k === 'note' ? '🗒' : (AI.kindIcon ? AI.kindIcon(k) : '✨');
    const live = () => records.filter(r => !r._deleted);
    const present = () => [...new Set(live().map(r => r.kind))];

    let filter = 'all', search = '';
    const filtersEl = view.querySelector('#studio-filters');
    const bodyEl = view.querySelector('#studio-body');
    const searchEl = view.querySelector('#studio-search');

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
      return [r.paper, r.qnum, r.note || '', r.ai?.title || '', r.ai?.content || ''].join(' ').toLowerCase().includes(search);
    }
    function cardHTML(r) {
      const head = `
        <div class="studio-card-head">
          <span class="studio-card-kind">${icon(r.kind)} ${esc(label(r.kind))}${r.qnum ? ' · Q' + esc(r.qnum) : ''}</span>
          ${r.when ? `<span class="studio-card-when">${esc(new Date(r.when).toLocaleDateString())}</span>` : ''}
          <button class="studio-card-del" data-rid="${r._i}" title="Delete">🗑</button>
        </div>`;
      const body = r.kind === 'note'
        ? `<div class="studio-card-body"><div class="note-shown">🗒 <span>${esc(r.note)}</span></div></div>`
        : `<div class="studio-card-body" data-render="${r._i}"></div>`;
      return `<article class="studio-card ${r.kind === 'chat' ? 'is-chat' : ''}">${head}${body}</article>`;
    }
    function draw() {
      const shown = records.filter(matches);
      if (!shown.length) {
        bodyEl.innerHTML = `<p class="muted studio-empty">${live().length ? 'Nothing matches that filter.' : 'Your studio is empty. Open a question in Study mode, tap ✨ Explore with AI, and every chat, chart, mind map and summary you make is saved here for next time.'}</p>`;
        return;
      }
      const groups = {};
      shown.forEach(r => (groups[r.paper] || (groups[r.paper] = [])).push(r));
      bodyEl.innerHTML = Object.keys(groups).map(paper => `
        <details class="studio-group" open>
          <summary><span class="studio-group-title">${esc(paper)}</span><span class="studio-group-count">${groups[paper].length}</span></summary>
          <div class="studio-grid">${groups[paper].map(cardHTML).join('')}</div>
        </details>`).join('');
      bodyEl.querySelectorAll('[data-render]').forEach(el => { const r = records[Number(el.dataset.render)]; if (r && r.ai) AI.renderSavedItem(el, r.ai); });
      bodyEl.querySelectorAll('.studio-card-del').forEach(b => b.addEventListener('click', async () => {
        const r = records[Number(b.dataset.rid)]; if (!r || !confirm('Delete this item from your studio?')) return;
        try { await r.del(); } catch {}
        r._deleted = true; drawFilters(); draw();
      }));
      if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo(bodyEl.querySelectorAll('.studio-card'), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' });
      }
    }
    searchEl.addEventListener('input', () => { search = searchEl.value.trim().toLowerCase(); draw(); });
    drawFilters(); draw();
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
  async function renderCards(user) { if (!canUse(user, 'flashcards')) return renderLocked('Flashcards'); await Flashcards.renderList(view, user); }
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
  window.addEventListener('DOMContentLoaded', async () => {
    const canvas = document.getElementById('bg-canvas');
    if (canvas) ThreeBG.init(canvas);
    try { await Backend.init(); } catch (e) { console.warn('Backend init:', e); }
    route();
  });
})();
