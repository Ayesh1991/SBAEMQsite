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
    { re: /^#\/dev$/, fn: renderDev }
  ];

  async function route() {
    Quiz.destroy();
    const hash = location.hash || '#/';
    const match = routes.find(r => r.re.test(hash));
    if (!match) { location.hash = '#/'; return; }
    const user = await Backend.currentUser();
    if (!match.public && !user) { location.hash = '#/auth'; return; }
    await syncExamDate(user);

    ThreeBG.setMood(match.fn === renderLanding ? 'hero' : 'interior');
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
    nav.innerHTML = `
      <a class="brand" href="#/">
        <img class="brand-logo" src="assets/logo-mark.svg" alt=""> ${esc(cfg.brandName)}<span class="brand-sub">${esc(cfg.brandTag)}</span>
      </a>
      <div class="nav-links">
        ${user ? `
          <a href="#/dashboard" class="${location.hash === '#/dashboard' ? 'active' : ''}">Dashboard</a>
          <a href="#/library" class="${location.hash.startsWith('#/library') || location.hash.startsWith('#/paper') ? 'active' : ''}">Library</a>
          <a href="#/profile" class="${location.hash === '#/profile' ? 'active' : ''}">Profile</a>
          ${isDev ? `<a href="#/dev" class="${location.hash === '#/dev' ? 'active' : ''}">Developer</a>` : ''}
          <button class="btn btn-ghost btn-sm" id="nav-logout">Sign out</button>
        ` : `<a href="#/auth" class="btn btn-primary btn-sm">Sign in</a>`}
      </div>`;
    nav.querySelector('#nav-logout')?.addEventListener('click', async () => {
      await Backend.signOut(); sessionStorage.removeItem('aureum-dev'); location.hash = '#/';
    });
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

  async function renderAuth() {
    if (await Backend.currentUser()) { location.hash = '#/dashboard'; return; }
    let mode = 'signin';

    function paint() {
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
              ? `New here? <a href="#" id="auth-toggle">Create an account</a>`
              : `Already registered? <a href="#" id="auth-toggle">Sign in</a>`}</p>
          </div>
        </section>`;
      document.getElementById('auth-toggle').addEventListener('click', e => { e.preventDefault(); mode = mode === 'signin' ? 'signup' : 'signin'; paint(); FX.viewIn(view); });
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
    Charts.scoreTrend(document.getElementById('chart-trend'), Progression.scoreSeries(progress));
    Charts.sectionBars(document.getElementById('chart-cats'), Progression.categoryAccuracy(progress));

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

  async function renderQuiz(paperId, kind, mode, user) {
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
        const summary = await Backend.recordAttempt(attempt);
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
        // AI
        if (window.AI && cfg.ai?.enabled) {
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

        <div class="card danger-zone" data-animate>
          <h3 class="card-title">Data</h3>
          <p class="muted">${Backend.mode === 'cloud' ? 'Synced to your account across devices.' : 'Stored in this browser.'}</p>
          <button class="btn btn-ghost" id="export-data">Export my data (JSON)</button>
          <button class="btn btn-danger" id="reset-progress">Reset all progress</button>
        </div>
      </section>`;

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

  /* ================= developer console ================= */

  async function renderDev(user) {
    const authorised = user.email === cfg.developer.email || sessionStorage.getItem('aureum-dev') === '1';
    if (!authorised) return renderDevGate(user);
    await DevConsole.render(view, { cfg, Data, Backend, esc, FX });
  }

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

  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', async () => {
    const canvas = document.getElementById('bg-canvas');
    if (canvas) ThreeBG.init(canvas);
    try { await Backend.init(); } catch (e) { console.warn('Backend init:', e); }
    route();
  });
})();
