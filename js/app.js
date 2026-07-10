/* ============================================================
   app.js — hash router + views.
   Routes: #/  #/auth  #/dashboard  #/library  #/topic/:id
           #/quiz/:id  #/results/:attemptId  #/profile
   ============================================================ */

(() => {
  const view = document.getElementById('view');
  const esc = Quiz.esc;

  /* ================= router ================= */

  const routes = [
    { re: /^#?\/?$/, fn: renderLanding, public: true },
    { re: /^#\/auth$/, fn: renderAuth, public: true },
    { re: /^#\/dashboard$/, fn: renderDashboard },
    { re: /^#\/library$/, fn: renderLibrary },
    { re: /^#\/topic\/(.+)$/, fn: renderTopic },
    { re: /^#\/quiz\/(.+)$/, fn: renderQuiz },
    { re: /^#\/results\/(.+)$/, fn: renderResults },
    { re: /^#\/profile$/, fn: renderProfile }
  ];

  async function route() {
    Quiz.destroy(); // leaving a quiz mid-run tears it down cleanly
    const hash = location.hash || '#/';
    const match = routes.find(r => r.re.test(hash));
    const user = Auth.currentUser();

    if (!match) { location.hash = '#/'; return; }
    if (!match.public && !user) { location.hash = '#/auth'; return; }

    ThreeBG.setMood(match.fn === renderLanding ? 'hero' : 'interior');
    renderNav(user);
    view.className = 'view';
    window.scrollTo(0, 0);

    try {
      await match.fn(...(hash.match(match.re) || []).slice(1).map(decodeURIComponent), user);
    } catch (err) {
      view.innerHTML = `
        <section class="page narrow" data-animate>
          <h1 class="page-title">Something went wrong</h1>
          <p class="muted">${esc(err.message || String(err))}</p>
          <a class="btn btn-primary" href="#/dashboard">Back to dashboard</a>
        </section>`;
    }
    FX.viewIn(view);
  }

  /* ================= nav ================= */

  function renderNav(user) {
    const nav = document.getElementById('nav');
    nav.innerHTML = `
      <a class="brand" href="#/">
        <span class="brand-mark">✦</span> AUREUM<span class="brand-sub">MRCOG</span>
      </a>
      <div class="nav-links">
        ${user ? `
          <a href="#/dashboard" class="${location.hash === '#/dashboard' ? 'active' : ''}">Dashboard</a>
          <a href="#/library" class="${location.hash.startsWith('#/library') || location.hash.startsWith('#/topic') ? 'active' : ''}">Library</a>
          <a href="#/profile" class="${location.hash === '#/profile' ? 'active' : ''}">Profile</a>
          <button class="btn btn-ghost btn-sm" id="nav-logout">Sign out</button>
        ` : `
          <a href="#/auth" class="btn btn-primary btn-sm">Sign in</a>
        `}
      </div>`;
    nav.querySelector('#nav-logout')?.addEventListener('click', () => {
      Auth.logout();
      location.hash = '#/';
    });
  }

  /* ================= landing ================= */

  async function renderLanding() {
    const user = Auth.currentUser();
    view.innerHTML = `
      <section class="hero">
        <p class="hero-kicker">MRCOG PART 2 · PART 3 — SBA & EMQ MASTERY</p>
        <h1 class="hero-title">
          <span class="line">Train like it's</span>
          <span class="line grad">exam day.</span>
        </h1>
        <p class="hero-sub">Curated single-best-answer and extended-matching questions, written to the
          RCOG curriculum. Timed sets, instant explanations with guideline references, and a
          progression system that turns revision into momentum.</p>
        <div class="hero-cta">
          ${user
            ? `<a class="btn btn-gold btn-lg" href="#/dashboard">Continue training →</a>`
            : `<a class="btn btn-gold btn-lg" href="#/auth">Begin your ascent →</a>
               <a class="btn btn-ghost btn-lg" href="#/auth">I have an account</a>`}
        </div>
        <div class="hero-stats" id="hero-stats"></div>
      </section>

      <section class="feature-band">
        <div class="feature" data-animate>
          <span class="feature-icon">⚡</span>
          <h3>Exam-faithful engine</h3>
          <p>SBAs and theme-based EMQs delivered exactly as the written paper asks them — with
             timing, flagging and a question navigator.</p>
        </div>
        <div class="feature" data-animate>
          <span class="feature-icon">📖</span>
          <h3>Explanations that teach</h3>
          <p>Every answer is justified against NICE and RCOG Green-top guidance, so a wrong answer
             becomes a topic you now own.</p>
        </div>
        <div class="feature" data-animate>
          <span class="feature-icon">🜚</span>
          <h3>A progression worth chasing</h3>
          <p>Climb from Medical Student to MRCOG Examiner. Streaks, XP and per-section analytics
             keep the long campaign honest.</p>
        </div>
      </section>`;

    FX.heroIntro(view);

    // live library stats under the hero
    try {
      const manifest = await Data.loadManifest();
      let topics = 0, sections = 0;
      for (const c of manifest.curricula) {
        sections += c.sections.length;
        for (const s of c.sections) topics += s.topics.length;
      }
      const host = document.getElementById('hero-stats');
      if (host) {
        host.innerHTML = `
          <div class="hero-stat"><strong>${manifest.curricula.length}</strong><span>Curricula</span></div>
          <div class="hero-stat"><strong>${sections}</strong><span>Sections</span></div>
          <div class="hero-stat"><strong>${topics}</strong><span>Question sets</span></div>`;
      }
    } catch { /* stats are decorative */ }
  }

  /* ================= auth ================= */

  function renderAuth() {
    if (Auth.currentUser()) { location.hash = '#/dashboard'; return; }
    let mode = 'signin';

    function paint() {
      view.innerHTML = `
        <section class="page narrow auth-page" data-animate>
          <div class="auth-card">
            <h1 class="page-title">${mode === 'signin' ? 'Welcome back' : 'Create your profile'}</h1>
            <p class="muted">${mode === 'signin'
              ? 'Sign in to continue your MRCOG campaign.'
              : 'Your progress, streaks and analytics will live in this profile.'}</p>
            <form id="auth-form" novalidate>
              ${mode === 'signup' ? `
                <label class="field"><span>Full name</span>
                  <input type="text" name="name" autocomplete="name" placeholder="Dr. Jane Doe" required>
                </label>` : ''}
              <label class="field"><span>Email address</span>
                <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required>
              </label>
              <label class="field"><span>Password</span>
                <input type="password" name="password" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}"
                  placeholder="${mode === 'signup' ? 'At least 8 characters' : '••••••••'}" required>
              </label>
              <p class="form-error" id="auth-error" role="alert" hidden></p>
              <button class="btn btn-gold btn-block" type="submit">
                ${mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
            <p class="auth-swap">
              ${mode === 'signin'
                ? `New here? <a href="#" id="auth-toggle">Create an account</a>`
                : `Already registered? <a href="#" id="auth-toggle">Sign in</a>`}
            </p>
            <p class="auth-note">Accounts are stored privately in this browser. Use the same device
               and browser to keep your progression.</p>
          </div>
        </section>`;

      document.getElementById('auth-toggle').addEventListener('click', e => {
        e.preventDefault();
        mode = mode === 'signin' ? 'signup' : 'signin';
        paint();
        FX.viewIn(view);
      });

      document.getElementById('auth-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const errBox = document.getElementById('auth-error');
        errBox.hidden = true;
        try {
          if (mode === 'signup') {
            await Auth.register(f.get('name'), f.get('email'), f.get('password'));
          } else {
            await Auth.login(f.get('email'), f.get('password'));
          }
          location.hash = '#/dashboard';
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
          FX.shake(errBox.closest('.auth-card'));
        }
      });
    }
    paint();
  }

  /* ================= dashboard ================= */

  async function renderDashboard(user) {
    const manifest = await Data.loadManifest();
    const progress = Store.getProgress(user.email);
    const stats = Progression.summarise(progress);
    const lvl = stats.level;
    const nameParts = user.name.split(/\s+/).filter(w => !/^(dr|prof|mr|mrs|ms|miss)\.?$/i.test(w));
    const firstName = nameParts[0] || user.name;

    view.innerHTML = `
      <section class="page">
        <header class="dash-head" data-animate>
          <div>
            <p class="kicker">${greeting()}, ${esc(firstName)}</p>
            <h1 class="page-title">Your campaign</h1>
          </div>
          <a class="btn btn-gold" href="#/library">Practise now →</a>
        </header>

        <div class="level-banner" data-animate>
          <div class="level-emblem">${lvl.emblem}</div>
          <div class="level-info">
            <p class="level-name">Level ${lvl.number} — ${lvl.title}</p>
            <div class="level-bar"><span id="level-fill"></span></div>
            <p class="level-next muted">
              ${lvl.next ? `${lvl.xpForNext} XP to ${lvl.next.title}` : 'Summit reached — the examiner’s chair is yours.'}
            </p>
          </div>
          <div class="level-xp"><strong id="xp-count">0</strong><span>Total XP</span></div>
        </div>

        <div class="stat-row" data-animate>
          <div class="stat-tile"><strong id="st-sets">0</strong><span>Sets completed</span></div>
          <div class="stat-tile"><strong id="st-q">0</strong><span>Questions answered</span></div>
          <div class="stat-tile"><strong id="st-streak">0</strong><span>Day streak 🔥</span></div>
          <div class="stat-tile ring-tile"><div id="ring-acc"></div></div>
        </div>

        <div class="dash-grid">
          <div class="card" data-animate>
            <h3 class="card-title">Score trend</h3>
            <div class="chart-host" id="chart-trend"></div>
          </div>
          <div class="card" data-animate>
            <h3 class="card-title">Accuracy by section</h3>
            <div class="chart-host" id="chart-sections"></div>
          </div>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Recent sets</h3>
          <div id="recent-list"></div>
        </div>
      </section>`;

    // animated numbers
    FX.countUp(document.getElementById('xp-count'), stats.xp);
    FX.countUp(document.getElementById('st-sets'), stats.setsCompleted);
    FX.countUp(document.getElementById('st-q'), stats.questionsAnswered);
    FX.countUp(document.getElementById('st-streak'), stats.streak);
    FX.fillBar(document.getElementById('level-fill'), lvl.progress);

    Charts.ring(document.getElementById('ring-acc'), stats.accuracy, 'Accuracy');
    Charts.scoreTrend(document.getElementById('chart-trend'), Progression.scoreSeries(progress));
    Charts.sectionBars(document.getElementById('chart-sections'),
      Progression.sectionAccuracy(progress, Data.topicIndex()));

    // recent attempts
    const recent = progress.attempts.slice(0, 6);
    document.getElementById('recent-list').innerHTML = recent.length ? `
      <table class="table">
        <thead><tr><th>Set</th><th>Mode</th><th>Score</th><th>Date</th><th></th></tr></thead>
        <tbody>
          ${recent.map(a => `
            <tr>
              <td>${esc(a.topicTitle)}</td>
              <td><span class="chip chip-${a.mode.toLowerCase()}">${a.mode}</span></td>
              <td><strong class="${a.percent >= 70 ? 'good' : a.percent >= 50 ? '' : 'bad'}">${a.percent}%</strong>
                  <span class="muted">(${a.correct}/${a.total})</span></td>
              <td class="muted">${new Date(a.date).toLocaleDateString()}</td>
              <td><a class="link" href="#/results/${a.id}">Review</a>
                  · <a class="link" href="#/quiz/${encodeURIComponent(a.topicId)}">Retake</a></td>
            </tr>`).join('')}
        </tbody>
      </table>` :
      `<p class="muted">No sets completed yet. <a class="link" href="#/library">Open the library</a> and begin.</p>`;
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Night shift' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  /* ================= library ================= */

  async function renderLibrary(user) {
    const manifest = await Data.loadManifest();
    const tStats = Store.topicStats(user.email);

    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">QUESTION LIBRARY</p>
          <h1 class="page-title">Choose your battlefield</h1>
          <p class="muted">Curriculum → section → topic. New sets appear here as they are published.</p>
        </header>
        ${manifest.curricula.map(cur => `
          <div class="curriculum-block" data-animate>
            <h2 class="curriculum-title">${esc(cur.title)}</h2>
            <p class="muted">${esc(cur.subtitle || '')}</p>
            ${cur.sections.map(sec => `
              <div class="section-block">
                <h3 class="section-title">${esc(sec.title)}</h3>
                <div class="topic-grid">
                  ${sec.topics.map(t => {
                    const s = tStats[t.id];
                    return `
                      <a class="topic-card" href="#/topic/${encodeURIComponent(t.id)}">
                        <div class="topic-top">
                          <span class="chip chip-${t.mode.toLowerCase()}">${t.mode}</span>
                          ${s ? `<span class="best ${s.best >= 70 ? 'good' : ''}">Best ${s.best}%</span>` : `<span class="best new">NEW</span>`}
                        </div>
                        <h4>${esc(t.title)}</h4>
                        <p class="muted">${s ? `${s.attempts} attempt${s.attempts > 1 ? 's' : ''}` : 'Not attempted yet'}</p>
                        <div class="topic-meter"><span style="width:${s ? s.best : 0}%"></span></div>
                      </a>`;
                  }).join('')}
                </div>
              </div>`).join('')}
          </div>`).join('')}
      </section>`;
  }

  /* ================= topic detail ================= */

  async function renderTopic(topicId, user) {
    await Data.loadManifest();
    const loaded = await Data.loadSet(topicId);
    const s = Store.topicStats(user.email)[topicId];
    const count = loaded.questions.length;

    view.innerHTML = `
      <section class="page narrow">
        <a class="link muted" href="#/library" data-animate>← Library</a>
        <header data-animate>
          <span class="chip chip-${loaded.set.mode.toLowerCase()}">${loaded.set.mode}</span>
          <h1 class="page-title">${esc(loaded.set.title)}</h1>
          <p class="muted">${esc(loaded.curriculum.title)} · ${esc(loaded.section.title)}</p>
        </header>

        <div class="card topic-detail" data-animate>
          <div class="detail-grid">
            <div><strong>${count}</strong><span>Questions</span></div>
            <div><strong>${loaded.set.timeLimitMinutes ? loaded.set.timeLimitMinutes + ' min' : 'Untimed'}</strong><span>Time limit</span></div>
            <div><strong>${s ? s.best + '%' : '—'}</strong><span>Best score</span></div>
            <div><strong>${s ? s.attempts : 0}</strong><span>Attempts</span></div>
          </div>
          ${loaded.set.mode === 'EMQ' ? `
            <p class="muted emq-note">Extended matching: each scenario is answered from its theme's
               full option list — options may be used once, more than once, or not at all.</p>` : ''}
          <div class="detail-actions">
            <a class="btn btn-gold btn-lg" href="#/quiz/${encodeURIComponent(topicId)}">
              ${s ? 'Retake set →' : 'Start set →'}
            </a>
            ${s?.last ? `<a class="btn btn-ghost" href="#/results/${s.last.id}">Review last attempt</a>` : ''}
          </div>
        </div>
      </section>`;
  }

  /* ================= quiz ================= */

  async function renderQuiz(topicId, user) {
    await Data.loadManifest();
    const loaded = await Data.loadSet(topicId);
    view.innerHTML = '';
    Quiz.start(view, loaded, {
      onFinish(attempt) {
        const summary = Store.recordAttempt(user.email, attempt);
        location.hash = '#/results/' + summary.attemptId;
      },
      onQuit() {
        location.hash = '#/topic/' + encodeURIComponent(topicId);
      }
    });
  }

  /* ================= results & review ================= */

  async function renderResults(attemptId, user) {
    await Data.loadManifest();
    const attempt = Store.getAttempt(user.email, attemptId);
    if (!attempt) throw new Error('That attempt could not be found.');

    let questions = null;
    try { questions = (await Data.loadSet(attempt.topicId)).questions; }
    catch { /* set may have been unpublished; show score only */ }

    const verdict =
      attempt.percent >= 85 ? { label: 'Examiner-grade', cls: 'good' } :
      attempt.percent >= 70 ? { label: 'On pass trajectory', cls: 'good' } :
      attempt.percent >= 50 ? { label: 'Building — review below', cls: '' } :
                              { label: 'Foundation work needed', cls: 'bad' };

    view.innerHTML = `
      <section class="page narrow results-page">
        <header class="results-head" data-animate>
          <p class="kicker">${esc(attempt.topicTitle)} · ${attempt.mode}${attempt.timedOut ? ' · time expired' : ''}</p>
          <div class="score-hero"><span id="score-big">0%</span></div>
          <p class="verdict ${verdict.cls}">${verdict.label}</p>
          <p class="muted">${attempt.correct} of ${attempt.total} correct ·
            ${Math.floor(attempt.durationSec / 60)}m ${attempt.durationSec % 60}s ·
            <strong class="gold">+${attempt.xpGained} XP</strong></p>
          <div class="results-actions">
            <a class="btn btn-gold" href="#/quiz/${encodeURIComponent(attempt.topicId)}">Retake set</a>
            <a class="btn btn-ghost" href="#/library">Library</a>
            <a class="btn btn-ghost" href="#/dashboard">Dashboard</a>
          </div>
        </header>

        ${questions ? `
          <h2 class="review-title" data-animate>Answer review</h2>
          <div class="review-list">
            ${questions.map((q, i) => {
              const d = attempt.detail[i];
              return `
                <article class="review-item ${d.isCorrect ? 'r-correct' : 'r-wrong'}" data-animate>
                  <header class="review-item-head">
                    <span class="r-badge">${d.isCorrect ? '✓' : '✗'}</span>
                    <span class="r-num">Q${i + 1}${q.kind === 'EMQ' ? ` · ${esc(q.theme)}` : ''}</span>
                  </header>
                  <p class="q-stem">${esc(q.stem)}</p>
                  <p class="r-line">
                    ${d.chosen === null
                      ? `<span class="bad">Not answered.</span>`
                      : d.isCorrect
                        ? `<span class="good">Your answer: ${Quiz.LETTERS[d.chosen]} — ${esc(q.options[d.chosen])}</span>`
                        : `<span class="bad">Your answer: ${Quiz.LETTERS[d.chosen]} — ${esc(q.options[d.chosen])}</span>`}
                  </p>
                  ${!d.isCorrect ? `
                    <p class="r-line good">Correct: ${Quiz.LETTERS[q.answer]} — ${esc(q.options[q.answer])}</p>` : ''}
                  ${q.explanation ? `<p class="r-expl">${esc(q.explanation)}</p>` : ''}
                  ${q.reference ? `<p class="r-ref">§ ${esc(q.reference)}</p>` : ''}
                </article>`;
            }).join('')}
          </div>` : `<p class="muted" data-animate>This set is no longer published, so the question review is unavailable.</p>`}
      </section>`;

    FX.scoreReveal(document.getElementById('score-big'), attempt.percent);
    if (attempt.percent >= 70) FX.confetti(view.querySelector('.results-head'));
  }

  /* ================= profile ================= */

  async function renderProfile(user) {
    await Data.loadManifest();
    const progress = Store.getProgress(user.email);
    const stats = Progression.summarise(progress);
    const lvl = stats.level;

    view.innerHTML = `
      <section class="page narrow">
        <header data-animate>
          <p class="kicker">PROFILE</p>
          <h1 class="page-title">${esc(user.name)}</h1>
          <p class="muted">${esc(user.email)} · member since ${new Date(user.createdAt).toLocaleDateString()}</p>
        </header>

        <div class="card" data-animate>
          <h3 class="card-title">The ascent</h3>
          <ol class="ladder">
            ${Progression.LEVELS.map((L, i) => `
              <li class="ladder-step
                ${i < lvl.index ? 'passed' : ''}
                ${i === lvl.index ? 'current' : ''}">
                <span class="ladder-emblem">${L.emblem}</span>
                <span class="ladder-name">${L.title}</span>
                <span class="ladder-xp muted">${L.xp} XP</span>
              </li>`).join('')}
          </ol>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Full history (${progress.attempts.length})</h3>
          ${progress.attempts.length ? `
            <table class="table">
              <thead><tr><th>Set</th><th>Mode</th><th>Score</th><th>Date</th><th></th></tr></thead>
              <tbody>
                ${progress.attempts.map(a => `
                  <tr>
                    <td>${esc(a.topicTitle)}</td>
                    <td><span class="chip chip-${a.mode.toLowerCase()}">${a.mode}</span></td>
                    <td><strong class="${a.percent >= 70 ? 'good' : a.percent >= 50 ? '' : 'bad'}">${a.percent}%</strong></td>
                    <td class="muted">${new Date(a.date).toLocaleDateString()}</td>
                    <td><a class="link" href="#/results/${a.id}">Review</a></td>
                  </tr>`).join('')}
              </tbody>
            </table>` : `<p class="muted">Nothing yet — your history builds as you complete sets.</p>`}
        </div>

        <div class="card danger-zone" data-animate>
          <h3 class="card-title">Data</h3>
          <p class="muted">Your profile and history are stored in this browser only.</p>
          <button class="btn btn-ghost" id="export-data">Export my data (JSON)</button>
          <button class="btn btn-danger" id="reset-progress">Reset all progress</button>
        </div>
      </section>`;

    document.getElementById('export-data').addEventListener('click', () => {
      const blob = new Blob(
        [JSON.stringify({ user: { name: user.name, email: user.email }, progress }, null, 2)],
        { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aureum-mrcog-progress.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.getElementById('reset-progress').addEventListener('click', () => {
      if (confirm('Erase all attempts, XP and streaks? This cannot be undone.')) {
        Store.remove('progress.' + user.email);
        route();
      }
    });
  }

  /* ================= boot ================= */

  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('bg-canvas');
    if (canvas) ThreeBG.init(canvas);
    route();
  });
})();
