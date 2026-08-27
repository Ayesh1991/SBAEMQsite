/* ============================================================
   cases.js — the case-based discussion, as the PGIM Part II runs it.

   WHAT THIS IS FOR

   You see the patient on the ward: fifteen minutes of history, then the
   examination. You walk out with it in your head. Then you sit down, open
   the case here, and PRESENT — out loud, from memory, the way you will on
   the day. The site listens, pushes when you dry up, asks the written
   questions when you have finished, and afterwards marks the whole tape
   against what a complete presentation actually contains.

   WHY IT IS NOT "THE OSCE TAB WITH A LONGER CLOCK"

   An OSCE has a marking scheme: a fixed list of points, a total, a pass
   mark. A long case has neither. It has a STRUCTURE — what a complete
   history contains, what a complete management plan contains — and a set
   of viva questions whose model answers were written by someone who sits
   the exam. Marking those two things the same way would flatten both.

   THE RULE THAT MAKES A CHEAP MODEL GOOD ENOUGH

   The questions are NOT invented. Every one is read from the case file,
   in phase order, and the model answers are already written. The model
   picks which question comes next and how to phrase a follow-up; it never
   decides what the syllabus is. A small model reading real PGIM questions
   examines better than a large one improvising, and costs a fiftieth as
   much. Rules first, model second — the same principle as the blueprint
   tagger and the OSCE probe engine.

   THE THREE THINGS IT MUST NEVER DO

   1. Interrupt fluency. If you are talking, it is silent. The whole point
      of a long case is that you get to run — a push during a good answer
      is worse than no push at all. Questions are HELD to the end of a
      phase unless you genuinely stop.
   2. Hand over an answer. A push names an area, never a fact.
   3. Lose the tape. The recording is written to the local queue before
      anything is sent anywhere, so a failed marking costs a retry and
      never the half-hour.
   ============================================================ */

const Cases = (() => {
  const cfg = () => window.AUREUM_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const rid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  /* ---------------- who may see this at all ----------------
     Off for everyone by default. The developer always has it; anyone else
     needs the grant, turned on one user at a time in the Developer tab.
     A section this expensive to run should not appear for someone who has
     not been given it. */
  function allowed(user) {
    if (!user) return false;
    if (user.email && cfg().developer && user.email === cfg().developer.email) return true;
    if (sessionStorage.getItem('aureum-dev') === '1') return true;
    return !!user.featureFlags?.cases;
  }

  /* ---------------- the bank ---------------- */

  let _cases = null;
  async function cases() {
    if (_cases) return _cases;
    _cases = await Backend.getCases();
    return _cases;
  }
  function bustCases() { _cases = null; }

  /* ---------------- the shape of a long case ----------------
     These are the six components the PGIM Part II long case actually runs
     in, in order. A case file may name its phases anything it likes — the
     older four-phase files still work — but where an id matches one of
     these it gets the proper label and short name on the stepper, so the
     candidate always knows which component they are in. */
  const COMPONENTS = [
    { id: 'history', short: 'History', label: 'History', ask: 'Present your patient.', minutes: 8 },
    { id: 'summary', short: 'Summary', label: 'Summary of the history', ask: 'Summarise the history for me.', minutes: 2 },
    { id: 'examination', short: 'Examination', label: 'Examination', ask: 'What did you find on examination?', minutes: 4 },
    { id: 'problems', short: 'Problems', label: 'Problem list and differential diagnosis', ask: 'Give me your problem list and your differential diagnosis.', minutes: 4 },
    { id: 'discussion', short: 'Discussion', label: 'Investigations, management and follow-up', ask: 'How would you investigate and manage her, and what follow-up would you arrange?', minutes: 10 },
    { id: 'viva', short: 'Viva', label: "Examiner's viva", ask: 'Some questions to finish.', minutes: 4 }
  ];
  const componentOf = id => COMPONENTS.find(c => c.id === String(id || '').toLowerCase()) || null;
  /* Older files used `diagnosis` and `management`; map them onto the two
     components they correspond to rather than leaving them unlabelled. */
  const ALIAS = { diagnosis: 'problems', investigations: 'discussion', management: 'discussion', plan: 'discussion' };
  const shortOf = p => {
    const c = componentOf(p.id) || componentOf(ALIAS[String(p.id || '').toLowerCase()]);
    return c ? c.short : (p.short || String(p.ask || p.id || '').split(/[\s,.]+/).slice(0, 2).join(' '));
  };

  /** The component you are in, always on screen. */
  function stepperHtml(ph, at) {
    if (!ph.length) return '';
    return `<ol class="cs-step" aria-label="Which part of the case you are in">
      ${ph.map((p, i) => `<li class="${i === at ? 'is-now' : i < at ? 'is-done' : ''}">
        <i>${i < at ? '✓' : i + 1}</i><span>${esc(shortOf(p))}</span></li>`).join('')}
    </ol>`;
  }

  const minutesOf = c => Number(c.minutes) || 30;
  const phasesOf = c => c.phases || [];
  const questionsOf = c => c.questions || [];
  /** Every expected item across every phase — what a complete case contains. */
  const expectedOf = c => phasesOf(c).flatMap(p => (p.expect || []).map(x => ({ phase: p.id, item: x })));

  /* ---------------- how long a pause is a pause ----------------
     Five seconds by default rather than the OSCE's three, and the reason
     is the exam itself: a long-case examiner lets you think. Three seconds
     into a management plan is not a thought block, it is a breath. */
  const WAIT_KEY = 'aureum.cases.waitms';
  const WAIT_MIN = 2000, WAIT_MAX = 20000, WAIT_DEF = 5000;
  function waitMs() {
    try {
      const raw = localStorage.getItem(WAIT_KEY);
      if (raw == null || raw === '') return WAIT_DEF;
      const n = Number(raw);
      return Number.isFinite(n) && n >= WAIT_MIN ? Math.min(WAIT_MAX, n) : WAIT_DEF;
    } catch { return WAIT_DEF; }
  }
  function setWaitMs(ms) {
    try { localStorage.setItem(WAIT_KEY, String(Math.max(WAIT_MIN, Math.min(WAIT_MAX, ms | 0)))); } catch {}
  }

  /* ---------------- sessions in progress ----------------
     Kept in localStorage, not the cloud: a case half-presented is not
     something anyone else needs, and it must survive a dropped connection.
     The TAPE is not in here — a blob does not belong in a string store —
     it lives in the recorder until the case ends. */
  const SKEY = 'aureum.case:';
  const sessionOf = id => { try { return JSON.parse(localStorage.getItem(SKEY + id) || 'null'); } catch { return null; } };
  const saveSession = s => { try { localStorage.setItem(SKEY + s.id, JSON.stringify(s)); } catch {} };
  const dropSession = id => { try { localStorage.removeItem(SKEY + id); } catch {} };
  function openSessions() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(SKEY)) { const s = sessionOf(k.slice(SKEY.length)); if (s) out.push(s); }
      }
    } catch {}
    return out.sort((a, b) => (b.started || 0) - (a.started || 0));
  }

  /* ================= what the candidate has plausibly said =================
     The same token-overlap test the OSCE uses, and it exists for the same
     reason: to decide whether an expected item is still outstanding WITHOUT
     asking a model, so the examiner can push while offline and for free. */
  const STOP = new Set(('the a an and or of to in for with on at by is are was were be been if then than that this those these ' +
    'as it its from into any all not no yes will would should could can may might do does did have has had ' +
    'patient woman women she her he his they them their you your i my we our').split(' '));
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));

  function saidAlready(item, said) {
    const need = words(item);
    if (!need.length) return true;
    const have = new Set(words(said));
    const hit = need.filter(w => have.has(w)).length;
    return hit / need.length >= 0.6;
  }
  const missingIn = (phase, said) => (phase?.expect || []).filter(x => !saidAlready(x, said));

  /* ---------------- editing an expected item where you read it ----------------
     Same contract as the OSCE scheme: the pencil reads and writes the whole
     case through the normal publish path, so an inline correction and an
     imported replacement are the same write. */
  const pExpect = (phaseId, i) =>
    (typeof QuickEdit === 'undefined') ? '' : QuickEdit.pencil(QuickEdit.caseRef(phaseId, i), 'Edit this expected item');
  const pMust = (qi, i) =>
    (typeof QuickEdit === 'undefined') ? '' : QuickEdit.pencil(QuickEdit.mustRef(qi, i), 'Edit this must-hit');

  function wireCaseEdit(host, caseId) {
    if (typeof QuickEdit === 'undefined' || !caseId) return;
    QuickEdit.attach(host, {
      load: () => Backend.getCase(caseId),
      find: QuickEdit.caseFind,
      save: async doc => { await Backend.publishCase(doc); bustCases(); },
      onSaved: () => bustCases()
    });
  }

  /* ================= the bank page ================= */

  async function renderBank(view, user) {
    if (!allowed(user)) return notYours(view);
    view.innerHTML = `<section class="page"><p class="muted">Loading the cases…</p></section>`;
    let list = [];
    try { list = await cases(); }
    catch (e) { view.innerHTML = `<section class="page"><p class="qr-danger">${esc(e.message)}</p></section>`; return; }

    const open = openSessions();
    let pending = [];
    try { pending = (await Pending.all()).filter(p => p.kind === 'case'); } catch {}

    view.innerHTML = `
      <section class="page cs-bank">
        ${tabs('bank')}
        <header class="cs-head">
          <p class="kicker">CASE-BASED DISCUSSION</p>
          <h1>The long case, out loud.</h1>
          <p class="muted">See the patient on the ward, then present from memory. The examiner listens, pushes when
            you stop, and asks the written questions when you are done. Afterwards the whole recording is marked
            against what a complete presentation contains.</p>
        </header>

        ${open.length ? `<div class="cs-resume">
          <h3>Unfinished</h3>
          ${open.map(s => `<div class="cs-resume-row">
            <span><strong>${esc(s.topic || s.case_id)}</strong>
              <em class="muted tiny">${s.phase ? 'in ' + esc(s.phase) : 'not started'} · ${fmt(s.elapsed || 0)} in</em></span>
            <span><a class="btn btn-gold btn-sm" href="#/cases/run/${encodeURIComponent(s.id)}">Resume</a>
              <button class="btn btn-ghost btn-sm qr-danger" data-drop="${esc(s.id)}">Discard</button></span>
          </div>`).join('')}
        </div>` : ''}

        ${pending.length ? `<div class="cs-pending">
          <h3>⏳ Waiting to be marked <span class="cs-pill">${pending.length}</span></h3>
          <p class="muted tiny">These were recorded but never marked — the connection was not there when you pressed.
            Nothing has been lost. Send them whenever you are back online.</p>
          <a class="btn btn-gold btn-sm" href="#/cases/mine">Open the queue →</a>
        </div>` : ''}

        <div class="cs-search">
          <input type="search" id="cs-q" placeholder="Search the cases — topic, patient, anything in the vignette"
            autocomplete="off" value="${esc(lastSearch())}">
          <span class="muted tiny" id="cs-count"></span>
        </div>
        <div class="cs-grid" id="cs-grid"></div>
        <p class="cs-empty muted" id="cs-empty" hidden></p>
      </section>`;
    FX.viewIn(view);

    const grid = view.querySelector('#cs-grid');
    const countEl = view.querySelector('#cs-count');
    const emptyEl = view.querySelector('#cs-empty');
    const box = view.querySelector('#cs-q');

    function paint() {
      const q = box.value.trim().toLowerCase();
      setLastSearch(box.value);
      /* Search runs over the topic, the vignette and the sources — never
         over the model answers, which is why `search` is built the way it
         is in the backend. A search box that could surface an answer would
         be a way to read the answers. */
      const hits = !q ? list : list.filter(c =>
        (c.search || (c.topic + ' ' + c.vignette).toLowerCase()).includes(q));
      countEl.textContent = q ? `${hits.length} of ${list.length}` : `${list.length} case${list.length === 1 ? '' : 's'}`;
      emptyEl.hidden = hits.length > 0;
      emptyEl.textContent = list.length
        ? 'No case matches that.'
        : 'No cases have been imported yet. The developer adds them under Developer → Cases.';
      grid.innerHTML = hits.map(c => `
        <a class="cs-card" href="#/cases/case/${encodeURIComponent(c.id)}">
          <span class="cs-card-time">${minutesOf(c)} min</span>
          <strong>${esc(c.topic || c.id)}</strong>
          <span class="cs-card-v">${esc(String(c.vignette || '').slice(0, 190))}${(c.vignette || '').length > 190 ? '…' : ''}</span>
          <span class="cs-card-f">${c.phase_count || 0} phases · ${c.q_count || 0} viva questions</span>
        </a>`).join('');
    }
    box.addEventListener('input', paint);
    paint();

    view.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', () => {
      if (!confirm('Discard that unfinished case? Nothing recorded so far is kept.')) return;
      dropSession(b.dataset.drop); renderBank(view, user);
    }));
  }

  const SEARCH_KEY = 'aureum.cases.q';
  const lastSearch = () => { try { return sessionStorage.getItem(SEARCH_KEY) || ''; } catch { return ''; } };
  const setLastSearch = v => { try { sessionStorage.setItem(SEARCH_KEY, v); } catch {} };

  function notYours(view) {
    view.innerHTML = `
      <section class="page">
        <div class="card cs-locked">
          <h2>Case discussion</h2>
          <p class="muted">This section is not switched on for your account. It runs a full thirty-minute long case
            with a live examiner and marks the recording afterwards, so it is granted one account at a time.
            Ask the developer if you would like it.</p>
          <a class="btn btn-ghost" href="#/dashboard">Back to the dashboard</a>
        </div>
      </section>`;
    FX.viewIn(view);
  }

  /* Three tabs, and the names have to earn their keep:
       Cases            — cases to sit here
       My sittings      — what happened when you sat them here
       My case discussions — discussions had ELSEWHERE, imported
     "My discussions" for the second one was the wrong word the moment the
     third existed. */
  /* `.lib-subnav` / `.lib-tab`, the same bar the OSCE tab and Theory use.

     v76 invented a class called `.os-tabs` for these and never wrote a rule
     for it, so the three links rendered as bare text with no spacing and no
     tab styling — they read as one run-on sentence. There is one tab bar in
     this app and this is it. */
  const tabs = at => {
    const tab = (id, href, label) =>
      `<a class="lib-tab ${at === id ? 'active' : ''}" href="${href}">${label}</a>`;
    return `<div class="lib-subnav" data-animate>
      ${tab('bank', '#/cases', 'Cases')}
      ${tab('mine', '#/cases/mine', 'My sittings')}
      ${tab('mine-disc', '#/cases/mine-disc', 'My case discussions')}
    </div>`;
  };

  /* ================= one case, before you sit it ================= */

  async function renderCase(view, id, user) {
    if (!allowed(user)) return notYours(view);
    view.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;
    let c;
    try { c = await Backend.getCase(id); }
    catch (e) { view.innerHTML = `<section class="page"><p class="qr-danger">${esc(e.message)}</p></section>`; return; }
    if (!c) { view.innerHTML = `<section class="page"><p class="muted">That case is not here.</p></section>`; return; }

    const ph = phasesOf(c), qs = questionsOf(c);
    view.innerHTML = `
      <section class="page cs-one">
        <a class="link tiny" href="#/cases">← All cases</a>
        <p class="kicker">CASE DISCUSSION · ${minutesOf(c)} MINUTES</p>
        <h1>${esc(c.topic || '')}</h1>
        <div class="cs-vignette">
          <h3>The patient</h3>
          <p>${esc(c.vignette || '')}</p>
        </div>

        <div class="cs-plan">
          <h3>How the half hour runs</h3>
          <ol class="cs-phases">
            ${ph.map(p => `<li><strong>${esc(p.ask || p.id)}</strong>
              <em class="muted tiny">about ${p.minutes || 5} minutes${(p.expect || []).length
                ? ' · ' + (p.expect || []).length + ' things a complete answer contains' : ''}</em></li>`).join('')}
          </ol>
          <p class="muted tiny">The examiner stays silent while you are talking. It speaks only when you have
            genuinely stopped for ${(waitMs() / 1000).toFixed(0)} seconds, or when a phase has run its time.</p>
        </div>

        <div class="cs-go">
          <button class="btn btn-gold btn-lg" id="cs-start">▶ Present this case</button>
          <button class="btn btn-ghost" id="cs-examine">🧑‍🏫 Examine someone else on it</button>
        </div>

        <details class="dev-collapse cs-reveal">
          <summary><span class="card-title">Show every question and model answer</span><span class="dc-caret">▸</span></summary>
          <p class="cs-warn">These are the answers. Open this to examine a colleague, or afterwards to revise —
            not before you present it yourself.</p>
          <div class="cs-qa">
            ${ph.map(p => (p.expect || []).length ? `
              <div class="cs-qa-block">
                <h4>${esc(p.ask || p.id)}</h4>
                <ul>${(p.expect || []).map((x, xi) => `
                  <li data-qe-line><span class="qe-text">${esc(x)}</span>${pExpect(p.id, xi)}</li>`).join('')}</ul>
              </div>` : '').join('')}
            ${qs.map((q, i) => `
              <div class="cs-qa-block">
                <h4>Q${i + 1}. ${esc(q.q || '')}</h4>
                ${q.model ? `<p class="cs-model">${esc(q.model)}</p>` : ''}
                ${(q.mustHit || []).length ? `<p class="cs-must"><strong>Must hit:</strong></p>
                  <ul>${q.mustHit.map((m, mi) => `
                    <li data-qe-line><span class="qe-text">${esc(m)}</span>${pMust(i, mi)}</li>`).join('')}</ul>` : ''}
                ${q.followUp ? `<p class="cs-follow"><strong>Follow-up:</strong> ${esc(q.followUp)}</p>` : ''}
              </div>`).join('')}
          </div>
        </details>

        ${(c.sources || []).length ? `<p class="cs-src muted tiny">Sources: ${(c.sources || []).map(esc).join(' · ')}</p>` : ''}
      </section>`;
    FX.viewIn(view);
    wireCaseEdit(view, c.id);

    view.querySelector('#cs-start').addEventListener('click', async () => {
      const sid = rid('cs');
      await saveSession({ id: sid, case_id: c.id, topic: c.topic, phase: null, at: 0,
        elapsed: 0, started: Date.now(), asked: [], notes: {} });
      location.hash = '#/cases/run/' + encodeURIComponent(sid);
    });
    view.querySelector('#cs-examine').addEventListener('click', () => {
      location.hash = '#/cases/examine/' + encodeURIComponent(c.id);
    });
  }

  /* ================= examining someone else =================
     Built because it is what actually happens: two candidates in a room,
     one presents, the other examines. Without this the examiner has to
     invent questions, which teaches the wrong thing to both of them. */

  async function renderExamine(view, id, user) {
    if (!allowed(user)) return notYours(view);
    let c;
    try { c = await Backend.getCase(id); } catch (e) {
      view.innerHTML = `<section class="page"><p class="qr-danger">${esc(e.message)}</p></section>`; return;
    }
    if (!c) { view.innerHTML = `<section class="page"><p class="muted">That case is not here.</p></section>`; return; }
    const qs = questionsOf(c);

    view.innerHTML = `
      <section class="page cs-exam">
        <a class="link tiny" href="#/cases/case/${encodeURIComponent(c.id)}">← Back to the case</a>
        <p class="kicker">EXAMINER'S COPY</p>
        <h1>${esc(c.topic || '')}</h1>
        <p class="muted">Ask these in order. Tap a question to show its model answer — keep it hidden while they
          are still answering, so you are listening rather than reading.</p>
        <div class="cs-vignette"><h3>The patient they saw</h3><p>${esc(c.vignette || '')}</p></div>

        ${phasesOf(c).map(p => `
          <div class="cs-exam-phase">
            <h3>${esc(p.ask || p.id)} <em class="muted tiny">about ${p.minutes || 5} min</em></h3>
            <p class="muted tiny">Tick what they cover. What is left unticked at the end is what to feed back on.</p>
            <ul class="cs-tick">
              ${(p.expect || []).map((x, i) => `<li data-qe-line><label>
                <input type="checkbox" data-tick="${esc(p.id)}-${i}"><span class="qe-text">${esc(x)}</span></label>${
                pExpect(p.id, i)}</li>`).join('')}
            </ul>
          </div>`).join('')}

        <div class="cs-exam-phase">
          <h3>Viva</h3>
          ${qs.map((q, i) => `
            <details class="cs-exam-q">
              <summary><strong>Q${i + 1}.</strong> ${esc(q.q || '')}</summary>
              ${q.model ? `<p class="cs-model">${esc(q.model)}</p>` : ''}
              ${(q.mustHit || []).length ? `<ul class="cs-must-list">${q.mustHit.map((m, mi) => `
                <li data-qe-line><span class="qe-text">${esc(m)}</span>${pMust(i, mi)}</li>`).join('')}</ul>` : ''}
              ${q.followUp ? `<p class="cs-follow"><strong>Then ask:</strong> ${esc(q.followUp)}</p>` : ''}
            </details>`).join('')}
        </div>
      </section>`;
    FX.viewIn(view);
    wireCaseEdit(view, c.id);
  }

  /* ================= the live session ================= */

  let live = null, tickTimer = null, running = false;

  function stopLive() { try { live?.kill(); } catch {} live = null; }

  async function renderRun(view, sid, user) {
    if (!allowed(user)) return notYours(view);
    const s = sessionOf(sid);
    if (!s) { location.hash = '#/cases'; return; }
    let c;
    try { c = await Backend.getCase(s.case_id); } catch (e) {
      view.innerHTML = `<section class="page"><p class="qr-danger">${esc(e.message)}</p></section>`; return;
    }
    if (!c) { view.innerHTML = `<section class="page"><p class="muted">That case is not here.</p></section>`; return; }

    const ph = phasesOf(c), qs = questionsOf(c);
    const total = minutesOf(c) * 60;
    let elapsed = s.elapsed || 0;
    let at = s.at || 0;                     // which phase
    const asked = new Set(s.asked || []);   // which written questions have been put
    let notes = s.notes || {};              // typed notes per phase, if any

    view.innerHTML = `
      <section class="page cs-run">
        <div class="os-run-bar">
          <div class="os-run-id">
            <span class="os-run-n">CASE DISCUSSION</span>
            <span class="os-run-topic">${esc(c.topic || '')}</span>
          </div>
          <div class="os-clock" id="cs-clock"><span id="cs-time">${fmt(total - elapsed)}</span><i id="cs-ring"></i></div>
          <div class="os-run-acts">
            <button class="btn btn-ghost btn-sm" id="cs-qbtn">📋 Questions</button>
            <button class="btn btn-ghost btn-sm" id="cs-pause" hidden>⏸ Pause</button>
            <button class="btn btn-ghost btn-sm qr-danger" id="cs-quit">Leave</button>
          </div>
        </div>
        <div class="os-progress"><i id="cs-prog"></i></div>
        <div id="cs-stage"></div>
      </section>`;
    FX.viewIn(view);

    const stage = view.querySelector('#cs-stage');

    /* THE DRAWER HAS TO LEAVE THE VIEW.

       `.view` is `position: relative; z-index: 1`, which makes it a stacking
       context — so a panel inside it can ask for z-index 220 and still sit
       underneath the nav bar's 20, because the whole view is behind it. The
       symptom was the drawer's own close button being unclickable, with no
       way to shut the panel once opened.

       Raising `.view` would move every other layer on the site. Moving the
       one panel out to the body is the small change: it is fixed-position
       anyway, so it never needed to be inside the page it covers.

       It must then be cleaned up by hand — replacing #view does not remove
       a node that is no longer in #view. */
    document.querySelectorAll('#cs-drawer').forEach(d => d.remove());
    const drawer = document.createElement('aside');
    drawer.className = 'cs-drawer';
    drawer.id = 'cs-drawer';
    drawer.hidden = true;
    document.body.appendChild(drawer);
    const killDrawer = () => { try { drawer.remove(); } catch {} };
    window.addEventListener('hashchange', killDrawer, { once: true });
    const timeEl = view.querySelector('#cs-time');
    const ringEl = view.querySelector('#cs-ring');
    const progEl = view.querySelector('#cs-prog');
    const pauseBtn = view.querySelector('#cs-pause');

    view.querySelector('#cs-quit').addEventListener('click', () => {
      if (!confirm('Leave this case? What you have recorded so far is not kept.')) return;
      stopLive(); clearInterval(tickTimer); tickTimer = null; killDrawer(); location.hash = '#/cases';
    });
    pauseBtn.addEventListener('click', () => running ? pause() : resume());
    view.querySelector('#cs-qbtn').addEventListener('click', () => {
      drawer.hidden = !drawer.hidden;
      if (!drawer.hidden) paintDrawer();
    });

    /* ---- the clock ---- */
    function paintClock() {
      const clock = view.querySelector('#cs-clock');
      if (!clock) return;
      const left = total - elapsed;
      timeEl.textContent = fmt(left);
      const pc = Math.max(0, Math.min(1, elapsed / total));
      ringEl.style.setProperty('--p', String(pc));
      progEl.style.width = (pc * 100) + '%';
      clock.classList.toggle('is-low', left <= 180 && left > 0);
      clock.classList.toggle('is-out', left <= 0);
    }

    function persist() {
      saveSession({ id: sid, case_id: c.id, topic: c.topic, phase: ph[at]?.id || null, at,
        elapsed, started: s.started, asked: [...asked], notes });
    }

    /* ---- the phases ---- */

    function show() {
      if (at >= ph.length) return finish();
      const p = ph[at];
      probes.disarm();
      stage.innerHTML = `
        ${stepperHtml(ph, at)}
        <div class="cs-phase">
          <p class="cs-phase-n">Part ${at + 1} of ${ph.length} · about ${p.minutes || 5} minutes</p>
          <h2 class="cs-ask">${esc(p.ask || p.id)}</h2>
          <div class="cs-hear" id="cs-hear"></div>
          <div class="os-probe" id="cs-probe" hidden></div>
          <div class="cs-note">
            <label class="muted tiny" for="cs-jot">Anything you want the marker to be sure of (optional — the
              recording is the record)</label>
            <textarea id="cs-jot" rows="2" placeholder="Type only what you want to be certain is counted.">${esc(notes[p.id] || '')}</textarea>
          </div>
          <div class="cs-phase-acts">
            <button class="btn btn-gold" id="cs-next"></button>
            <span class="muted tiny">The examiner will also move you on when the time for this part is up.</span>
          </div>
        </div>`;
      const jot = stage.querySelector('#cs-jot');
      jot.addEventListener('input', () => { notes[p.id] = jot.value; persist(); });
      stage.querySelector('#cs-next').addEventListener('click', () => nextPhase());
      paintNext();
      probes.armFor(p, () => saidIn(p.id));
      phaseStarted = Date.now();
      persist();
      if (!drawer.hidden) paintDrawer();
    }

    /* ================= what the examiner can actually hear =================

       THE BUG THIS FIXES

       The examiner used to be handed the TYPED NOTE BOX as "what the
       candidate has said". That box is almost always empty, so every push
       was computed from a blank transcript: nothing said, every expected
       item still missing, and a model told "PHASE: Present your patient /
       THEY HAVE JUST SAID: (nothing yet)" quite reasonably replied "Could
       you please present the patient to me?" — over and over, while the
       candidate was in the middle of presenting the patient.

       So: where the browser has a recogniser, its words are accumulated
       per phase and THAT is what the examiner reasons about. Where it does
       not — Safari has never shipped one, which is most iPads — the
       examiner is told plainly that it cannot read the answer, and it
       falls back to generic pushes rather than inventing a question from
       an empty page. A model with nothing to read must not be asked to
       comment on what it cannot read. */

    const heard = {};                 // phase id → what the recogniser caught
    let recogOn = false, lastWords = '';
    const saidIn = id => [(heard[id] || ''), (notes[id] || '')].filter(Boolean).join(' ');

    function onHeard(text) {
      if (!text) return;
      recogOn = true;
      const id = ph[at]?.id;
      if (!id) return;
      heard[id] = ((heard[id] || '') + ' ' + text).trim().slice(-6000);
      lastWords = text;
      paintHear();
    }

    /* The indicator. Three honest states, and never a fourth that pretends:
         · words coming in — the recogniser is working, show the last of them
         · a level but no words — we can hear you, we cannot read you
         · nothing at all — say so, because a dead microphone looks identical
           to a quiet one and only one of them is fixable. */
    let hearPaint = '';
    function paintHear() {
      const el = stage.querySelector('#cs-hear');
      if (!el) return;
      const lvl = live?.level ? live.level() : -1;
      const st = probes.status();
      let cls, txt, tail = '';
      if (lvl < 0) {
        cls = 'is-nometer';
        txt = 'This browser gives no microphone level — the examiner will not interrupt you at all';
      } else if (recogOn) {
        cls = st.mode === 'quiet' ? 'is-quiet' : 'is-hearing';
        txt = st.mode === 'quiet' ? `You have stopped — the examiner will speak in ${Math.ceil((st.left || 0) / 1000)}s`
          : 'Hearing you';
        tail = lastWords ? `<em class="cs-hear-w">…${esc(lastWords.slice(-90))}</em>` : '';
      } else if (st.mode === 'quiet') {
        cls = 'is-quiet';
        txt = `You have stopped — the examiner will speak in ${Math.ceil((st.left || 0) / 1000)}s`;
      } else if (st.mode === 'listening' || st.mode === 'waiting') {
        cls = 'is-hearing';
        txt = st.mode === 'waiting' ? 'Ready — start speaking' : 'Hearing you';
        tail = '<em class="cs-hear-w">This browser cannot write down what you say. The recording is still the record.</em>';
      } else { cls = 'is-idle'; txt = ''; }
      const key = cls + txt + tail;
      if (key === hearPaint) return;
      hearPaint = key;
      el.className = 'cs-hear ' + cls;
      el.innerHTML = txt ? `<i class="cs-hear-dot"></i><span>${esc(txt)}</span>${tail}` : '';
    }

    let phaseStarted = Date.now();

    /** The written questions for the phase we are in that have not been put. */
    const owedHere = () => qs.map((q, i) => ({ q, i }))
      .filter(x => (x.q.phase || 'viva') === ph[at]?.id && !asked.has(qid(x.q, x.i)));

    /* The button has to say what it is going to do. It used to read "Finish
       the case →" while there were still five questions to be asked, so
       pressing it appeared to do nothing five times running. The examiner
       asking its remaining questions before letting you go is right; hiding
       that behind a button labelled Finish is not. */
    function paintNext() {
      const b = stage.querySelector('#cs-next');
      if (!b) return;
      const n = owedHere().length;
      b.textContent = n
        ? (n === 1 ? 'Ready for the last question →' : `Ready for the next question → (${n} left)`)
        : at === ph.length - 1 ? 'Finish the case →' : 'I have finished this part →';
    }

    async function nextPhase() {
      /* Before moving on, put any written question for THIS phase that has
         not been asked. A phase is not over because the candidate says so —
         it is over when its questions have been asked. */
      const owed = owedHere();
      if (owed.length) { await putQuestion(owed[0].q, owed[0].i); paintNext(); return; }
      at++;
      if (at >= ph.length) return finish();
      show();
    }

    const qid = (q, i) => String(q.id ?? i);

    /** Ask one written question out loud and show it. */
    async function putQuestion(q, i) {
      asked.add(qid(q, i));
      persist();
      showLine(q.q, 'question');
      await sayAloud(q.q);
      if (!drawer.hidden) paintDrawer();
    }

    function showLine(line, kind) {
      const host = stage.querySelector('#cs-probe');
      if (!host) return;
      host.hidden = false;
      host.className = 'os-probe cs-' + (kind || 'push');
      host.innerHTML = `<span class="os-probe-who">Examiner</span> ${esc(line)}`;
      host.classList.remove('is-in'); void host.offsetWidth; host.classList.add('is-in');
    }

    /* ---- the examiner's voice ----
       Groq first, because a synthetic monotone reading a viva question does
       not rehearse anything. The browser voice is the fallback so a rate
       limit costs realism, never the question. */
    async function sayAloud(text) {
      if (!text) return;
      try {
        const clip = OSCE.voiceOn() ? await OSCE.groqVoice(text) : null;
        if (clip && live?.speakClip) { if (await live.speakClip(clip)) return; }
      } catch {}
      try { OSCE.speak(text, { rate: 0.98 }); } catch {}
    }

    /* ================= the probe engine =================

       THE ONE RULE: SILENCE, NEVER FLUENCY.

       If the microphone can hear you, nothing happens. Not a nudge, not a
       question, not a sound. The examiner speaks only when you have
       genuinely stopped for the set number of seconds — and "genuinely" is
       doing real work there: the gaps between words and between sentences
       are not stops, and are not treated as any.

       When you do stop, the WRITTEN question for this phase comes first.
       Only when the bank for this phase is empty does a model get asked for
       a line, and even then it names an area, never a fact. */
    const probes = (() => {
      let timer = null, p = null, getText = null, busy = false;
      let lastSpoke = 0, quietSince = 0, everHeard = false, lastPaint = null;
      let floor = null, lastVoiceAt = 0;
      const SPEAK_OVER = 0.045, GAP_MS = 750;
      const COOLDOWN = 8000;

      function listen(lvl, now) {
        if (lvl < 0) return null;
        const over = floor != null && lvl > floor + SPEAK_OVER;
        if (floor == null) floor = lvl;
        else if (lvl < floor) floor = lvl * 0.35 + floor * 0.65;
        else if (!over) floor = floor * 0.995 + lvl * 0.001;
        if (over) lastVoiceAt = now;
        return lastVoiceAt > 0 && (now - lastVoiceAt) < GAP_MS;
      }

      function status() {
        if (!p) return { mode: 'idle' };
        if (!live?.level || live.level() < 0) return { mode: 'nometer' };
        if (!everHeard) return { mode: 'waiting' };
        if (!quietSince) return { mode: 'listening' };
        return { mode: 'quiet', left: Math.max(0, waitMs() - (Date.now() - quietSince)) };
      }

      function armFor(phase, textFn) {
        disarm();
        p = phase; getText = textFn;
        lastSpoke = Date.now(); quietSince = 0; everHeard = false;
        floor = null; lastVoiceAt = 0;
        timer = setInterval(tick, 150);
        paint();
      }
      function disarm() { if (timer) clearInterval(timer); timer = null; p = null; lastPaint = null; paint(); }

      async function tick() {
        paint();
        paintHear();
        if (busy || !p || !running) return;

        /* The phase's own clock. A part that has run its time moves on by
           itself, exactly as an examiner would — but only between
           sentences, never mid-word. */
        const phaseSecs = (Date.now() - phaseStarted) / 1000;
        const budget = (p.minutes || 5) * 60;

        const now = Date.now();
        const lvl = live?.level ? live.level() : -1;
        if (lvl < 0) return;                       // no meter: never interrupt blind
        const talking = listen(lvl, now);
        if (talking) { everHeard = true; quietSince = 0; return; }

        if (now - lastSpoke < COOLDOWN) return;
        if (!everHeard && now - lastSpoke < 45000) return;
        if (!quietSince) { quietSince = lastVoiceAt || now; return; }
        if (now - quietSince < waitMs()) return;

        busy = true;
        try {
          /* THE BANK FIRST. A written question is a real PGIM question with
             a model answer behind it; a generated one is a guess. */
          const owed = qs.map((q, i) => ({ q, i }))
            .filter(x => (x.q.phase || 'viva') === p.id && !asked.has(qid(x.q, x.i)));
          if (owed.length) {
            await putQuestion(owed[0].q, owed[0].i);
            paintNext();
          } else if (phaseSecs > budget * 0.8) {
            /* Out of written questions and near the end of the part —
               move them on rather than filling time. */
            showLine(at === ph.length - 1 ? 'Thank you. Let us stop there.' : 'Good. Let us move on.', 'move');
            await sayAloud(at === ph.length - 1 ? 'Thank you. Let us stop there.' : 'Good. Let us move on.');
            lastSpoke = Date.now(); quietSince = 0; busy = false;
            setTimeout(() => { at++; at >= ph.length ? finish() : show(); }, 900);
            return;
          } else {
            const line = await pushLine();
            showLine(line, 'push');
            await sayAloud(line);
          }
          lastSpoke = Date.now(); quietSince = 0;
        } catch { /* a push that fails is a push that did not happen */ }
        busy = false;
        paint();
      }

      const GENERIC = ['Go on.', 'What else would you add?', 'Anything further?',
        'Can you expand on that?', 'And?', 'Tell me more about that.'];

      /* Anything that amounts to "start presenting" is forbidden once the
         part has begun. This is the exact line the examiner kept repeating
         into the middle of a history, and no amount of prompt wording is
         worth trusting on its own — a re-ask is refused here, at the last
         possible moment, whatever the model returned. */
      const RESTART = /\b(present (the|your|this) (patient|case)|start(ing)? (your|the) presentation|begin (your|the) presentation|tell me about (the|your) patient|introduce (the|your) patient|go ahead and present)\b/i;

      /** One line. The model is asked ONLY when there is a transcript to reason about. */
      async function pushLine() {
        const said = (getText && getText()) || '';
        const generic = GENERIC[Math.floor(Math.random() * GENERIC.length)];

        /* WITHOUT A TRANSCRIPT, DO NOT ASK THE MODEL.

           On Safari there is no recogniser, so `said` is empty however long
           and however well the candidate has been talking. Sending that to
           a model is asking it to comment on a blank page, and what comes
           back is a request to start presenting — the very thing that was
           wrong. A generic push is honest: it says "keep going" without
           pretending to know what was said. */
        if (!said.trim()) return generic;

        const missing = missingIn(p, said);
        if (!missing.length) return generic;
        try {
          if (typeof Wallet !== 'undefined' && !(await Wallet.canSpend())) return generic;
          const token = await Backend.getAccessToken();
          if (!token) return generic;
          const res = await fetch(cfg().ai.apiBase, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ action: 'caseask', provider: 'gemini', model: cfg().ai?.geminiModel,
              dailyLimit: cfg().ai.dailyLimit,
              topic: c.topic, phase: p.ask || p.id, said: said.slice(-1200),
              // the model is told the presentation is UNDER WAY, so it never
              // frames its line as an invitation to begin
              underway: true,
              missing: missing.slice(0, 6).map(x => String(x).slice(0, 200)) })
          });
          if (!res.ok) return generic;
          const d = await res.json().catch(() => ({}));
          const t = String(d.text || '').trim().replace(/^["']|["']$/g, '');
          if (!t || t.length >= 170) return generic;
          return RESTART.test(t) ? generic : t;
        } catch { return generic; }
      }

      function paint() {
        const el = stage.querySelector('#cs-listen');
        if (!el) return;
        const st = status();
        const txt = {
          idle: '',
          nometer: 'This device gives no microphone level, so the examiner cannot tell when you have stopped — it will not interrupt you',
          waiting: 'Examiner listening…',
          listening: 'Examiner listening…',
          quiet: `Examiner about to speak… ${Math.ceil((st.left || 0) / 1000)}s`
        }[st.mode] || '';
        if (txt === lastPaint) return;
        lastPaint = txt;
        el.hidden = !txt;
        el.className = 'os-listen is-' + st.mode;
        el.textContent = txt;
      }

      return { armFor, disarm, tick, status, paint };
    })();

    /* ---- the question drawer ----
       Requirement in its own right: being able to pick a question and answer
       it out loud, rather than waiting to be asked. */
    function paintDrawer() {
      const p = ph[at];
      drawer.innerHTML = `
        <div class="cs-drawer-in">
          <div class="cs-drawer-h">
            <strong>Questions</strong>
            <button class="btn btn-ghost btn-sm" id="cs-drawer-x">✕</button>
          </div>
          <p class="muted tiny">Tap one to have it asked aloud now. Answer it out loud — it is on the same
            recording either way.</p>
          ${qs.map((q, i) => {
            const done = asked.has(qid(q, i));
            const mine = (q.phase || 'viva') === p?.id;
            return `<button class="cs-drawer-q ${done ? 'is-done' : ''} ${mine ? 'is-now' : ''}" data-ask="${i}">
              <span class="cs-drawer-n">${done ? '✓' : i + 1}</span>
              <span>${esc(q.q || '')}</span>
            </button>`;
          }).join('') || '<p class="muted tiny">This case has no written viva questions.</p>'}
        </div>`;
      drawer.querySelector('#cs-drawer-x')?.addEventListener('click', () => { drawer.hidden = true; });
      drawer.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', async () => {
        const i = Number(b.dataset.ask);
        await putQuestion(qs[i], i);
        paintNext();
        drawer.hidden = true;
      }));
    }

    /* ---- start ---- */
    stage.innerHTML = `
      <div class="cs-brief">
        <p class="kicker">BEFORE YOU BEGIN</p>
        <h2>${esc(c.topic || '')}</h2>
        <div class="cs-vignette"><h3>The patient you saw</h3><p>${esc(c.vignette || '')}</p></div>
        <p class="muted">You have ${minutesOf(c)} minutes. Present as you would in the room — history first, then
          your summary and problem list, then your management plan. The examiner will not interrupt you while
          you are talking.</p>
        <div class="os-mic" id="cs-mic"></div>
        <div class="os-pdial-box">
          <label class="os-pdial-head">
            <span><strong>How long a pause before the examiner speaks?</strong></span>
            <span class="os-pdial-num" id="cs-wait-v">${(waitMs() / 1000).toFixed(1)}s</span>
          </label>
          <input type="range" id="cs-wait" min="${WAIT_MIN}" max="${WAIT_MAX}" step="500" value="${waitMs()}">
          <div class="os-pdial-scale"><span>2s — pushy</span><span>20s — lets you think</span></div>
          <p class="muted tiny">Gaps between words and between sentences are never counted as a pause. This is
            how long a real stop has to last before you are asked something.</p>
        </div>
        <button class="btn btn-gold btn-lg" id="cs-begin">▶ Start the case</button>
      </div>`;

    const wait = stage.querySelector('#cs-wait'), waitV = stage.querySelector('#cs-wait-v');
    wait.addEventListener('input', () => {
      setWaitMs(Number(wait.value));
      waitV.textContent = (Number(wait.value) / 1000).toFixed(1) + 's';
    });

    stage.querySelector('#cs-begin').addEventListener('click', async () => {
      const micHost = stage.querySelector('#cs-mic');
      live = OSCE.makeCapture(micHost, true);
      /* Where the browser has a recogniser, its words are what the examiner
         reasons about. Safari has never shipped one and attach() is then a
         no-op — which is fine, and SAID so on screen, rather than leaving
         the examiner to conclude that a silent transcript means silence. */
      live.attach(onHeard);
      const ok = await live.start();
      if (!ok && live.state && live.state().failed) {
        micHost.insertAdjacentHTML('beforeend',
          `<p class="qr-danger tiny">The case cannot run without the microphone — the whole recording is what gets marked.</p>`);
        return;
      }
      running = true;
      pauseBtn.hidden = false;
      tickTimer = setInterval(() => {
        if (!running) return;
        elapsed++;
        paintClock();
        if (elapsed % 5 === 0) persist();
        if (elapsed >= total) { finish(); }
      }, 1000);
      show();
      paintClock();
    });

    function pause() { running = false; pauseBtn.textContent = '▶ Resume'; try { live?.pause(); } catch {} probes.disarm(); }
    function resume() { running = true; pauseBtn.textContent = '⏸ Pause'; try { live?.resume(); } catch {} if (ph[at]) probes.armFor(ph[at], () => saidIn(ph[at].id)); }

    /* ---- the end ---- */
    async function finish() {
      running = false;
      clearInterval(tickTimer); tickTimer = null;
      probes.disarm();
      killDrawer();
      stage.innerHTML = `<div class="cs-phase"><p class="muted">Stopping the recording…</p></div>`;
      let rec = null;
      try { rec = await live?.stop(); } catch {}
      stopLive();
      dropSession(sid);
      await renderDebrief(view, c, {
        id: rid('ca'), case_id: c.id, notes, asked: [...asked], heard,
        elapsed, started: s.started
      }, rec, user);
    }
  }

  /* ================= the debrief: what it will cost, then send ================= */

  /** ~32 tokens a second of audio, plus the case file, plus what comes back. */
  function estimate(c, rec) {
    const secs = rec?.secs || (minutesOf(c) * 60);
    const caseWords = [c.vignette, ...phasesOf(c).flatMap(p => [p.ask, ...(p.expect || [])]),
      ...questionsOf(c).flatMap(q => [q.q, q.model, ...(q.mustHit || [])])].join(' ').split(/\s+/).length;
    const inTok = Math.round(secs * 32) + Math.round(caseWords * 1.3) + 900;
    const outTok = 1400 + phasesOf(c).length * 420 + questionsOf(c).length * 260;
    return { inTok, outTok, secs };
  }

  function priceOf() {
    // the case marker is Flash-Lite, always: it is the only model that takes
    // half an hour of compressed audio inline at a sane price
    const p = (cfg().ai?.pricing || {})['gemini-3.1-flash-lite'] || { in: 0.25, out: 1.5 };
    return { label: 'Gemini 3.1 Flash-Lite', model: cfg().ai?.geminiModel || 'gemini-3.1-flash-lite', rate: p };
  }

  async function renderDebrief(view, c, base, rec, user) {
    const pr = priceOf();
    const est = estimate(c, rec);
    const rate = (typeof Wallet !== 'undefined') ? Wallet.rate() : 340;
    const usd = (est.inTok / 1e6) * pr.rate.in + (est.outTok / 1e6) * pr.rate.out;

    const stage = view.querySelector('#cs-stage') || view;
    stage.innerHTML = `
      <div class="cs-debrief">
        <p class="kicker">THAT IS THE CASE</p>
        <h2>${esc(c.topic || '')}</h2>
        <p class="muted">${rec
          ? `${fmt(rec.secs)} recorded · ${(rec.bytes / 1048576).toFixed(1)} MB`
          : 'No recording was captured — there is nothing to mark.'}</p>

        ${rec ? `
        <div class="cs-audio">
          <audio controls src="${rec.url}"></audio>
          <a class="btn btn-ghost btn-sm" href="${rec.url}"
             download="CASE-${esc((c.topic || 'case').replace(/[^a-z0-9]+/gi, '-'))}-${new Date().toISOString().slice(0, 10)}.${rec.ext}">⬇ Download the recording</a>
        </div>

        <div class="cs-cost">
          <span class="cs-cost-l">BEFORE YOU PRESS</span>
          about <strong>${(est.inTok + est.outTok).toLocaleString()}</strong> tokens
          (${est.inTok.toLocaleString()} in + ${est.outTok.toLocaleString()} out) on <strong>${esc(pr.label)}</strong>
          — <strong>$${usd.toFixed(3)} · LKR ${(usd * rate).toFixed(2)}</strong>
          <span class="muted tiny">at LKR ${rate}/USD · charged to <strong>Discussion coach</strong></span>
        </div>

        <button class="btn btn-gold btn-lg" id="cs-mark">🎧 Mark this discussion</button>
        <p class="cs-msg" id="cs-msg"></p>
        ` : `<a class="btn btn-ghost" href="#/cases">Back to the cases</a>`}
      </div>`;

    if (!rec) return;
    const msg = stage.querySelector('#cs-msg');
    const btn = stage.querySelector('#cs-mark');
    btn.addEventListener('click', () => sendForMarking({ c, base, rec, btn, msg, user, pr }));
  }

  /* ---------------- the send ----------------
     The order here is deliberate and is the whole of the "never lose it"
     promise: the tape is queued LOCALLY first, then uploaded, then marked.
     Every step after the first can fail without costing the half hour. */
  async function sendForMarking({ c, base, rec, btn, msg, user, pr }) {
    const say = t => { if (msg) msg.textContent = t; };
    btn.disabled = true;
    try { Pending.setOwner(user?.email || ''); } catch {}

    /* 1. Write it down before anything can go wrong. */
    say('Saving the recording on this device…');
    try {
      await Pending.put({ kind: 'case', id: base.id, title: c.topic || c.id,
        blob: rec.blob, mime: rec.mime, secs: rec.secs,
        payload: { case_id: c.id, notes: base.notes, asked: base.asked, heard: base.heard || {},
          elapsed: base.elapsed, started: base.started },
        reason: 'Not sent yet.' });
    } catch { /* a browser with no IndexedDB still gets to try the send */ }

    /* 2. The 24-hour cloud copy, so the tape is downloadable from any device
          and so Drive can take it later. Never load-bearing. */
    let audioPath = null, audioExpires = 0;
    try {
      say('Storing the recording…');
      const up = await Backend.uploadCaseAudio(base.id, rec.blob);
      if (up) { audioPath = up.path; audioExpires = up.expires; }
    } catch { /* the marking matters more than the copy */ }

    /* 3. Mark. */
    try {
      if (typeof Wallet !== 'undefined' && !(await Wallet.canSpend())) {
        throw new Error(Wallet.blockedMessage ? Wallet.blockedMessage() : 'There is no credit left on this account.');
      }
      say('Sending the recording to be marked. A half-hour case takes a minute or two…');
      const token = await Backend.getAccessToken();
      const body = {
        action: 'casemark', provider: 'gemini', model: pr.model, dailyLimit: cfg().ai.dailyLimit,
        case: {
          topic: c.topic, vignette: c.vignette, minutes: minutesOf(c),
          phases: phasesOf(c).map(p => ({ id: p.id, ask: p.ask, minutes: p.minutes, expect: p.expect || [] })),
          questions: questionsOf(c).map((q, i) => ({ id: q.id ?? i, q: q.q, model: q.model, mustHit: q.mustHit || [] }))
        },
        asked: base.asked || [],
        notes: base.notes || {},
        /* What the browser wrote down, per phase. It is a HINT for the
           marker, never the record: the tape is the record, and where the
           browser has no recogniser this is simply absent. */
        heard: base.heard || {},
        audio: { mime: rec.mime || 'audio/webm', data: await OSCE.toBase64(rec.blob) }
      };
      const res = await fetch(cfg().ai.apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Marking failed (HTTP ${res.status}).`);
      const result = parseCase(data.text, data.finish);

      const rateN = (typeof Wallet !== 'undefined') ? Wallet.rate() : 340;
      const usd = ((data.usage?.in || 0) / 1e6) * pr.rate.in + ((data.usage?.out || 0) / 1e6) * pr.rate.out;
      const attempt = Object.assign({}, base, {
        status: 'marked',
        case: { topic: c.topic, vignette: c.vignette, minutes: minutesOf(c) },
        phases: phasesOf(c), questions: questionsOf(c),
        result, created: Date.now(),
        model: data.model || pr.model, modelLabel: pr.label,
        audioPath, audioExpires, audioSecs: rec.secs,
        cost: { inTok: data.usage?.in || 0, outTok: data.usage?.out || 0, usd, lkr: usd * rateN, rate: rateN }
      });
      await Backend.saveCaseAttempt(attempt);
      try { if (typeof Wallet !== 'undefined') Wallet.bust(); } catch {}
      try { await Pending.drop(base.id); } catch {}

      /* The Drive copy, last and never awaited — the report is already safe. */
      try {
        if (typeof Drive !== 'undefined' && Drive.on()) {
          Drive.upload(rec.blob, Drive.nameFor('CASE — ' + (c.topic || ''), Date.now(), rec.ext),
            { description: 'AUREUM case discussion' });
        }
      } catch {}

      location.hash = '#/cases/result/' + encodeURIComponent(attempt.id);
    } catch (e) {
      /* Marking failed. The tape is already in the queue and an unmarked
         row goes in the list, so this is a delay, not a loss. */
      btn.disabled = false;
      const why = e.message || 'The marking did not go through.';
      try { await Pending.bumpTry(base.id, why); } catch {}
      try {
        await Backend.saveCaseAttempt(Object.assign({}, base, {
          status: 'unmarked', created: Date.now(),
          case: { topic: c.topic, vignette: c.vignette, minutes: minutesOf(c) },
          audioPath, audioExpires, audioSecs: rec.secs, lastError: why
        }));
      } catch {}
      say('');
      if (msg) msg.innerHTML = `<span class="qr-danger">${esc(why)}</span><br>
        <span class="muted tiny">The recording is saved on this device and listed under
        <a class="link" href="#/cases/mine">My discussions</a> as waiting to be marked. Nothing is lost —
        press Mark again, or send it from there when you have signal.</span>`;
    }
  }

  /** Same salvage discipline as the OSCE marker: a cut-off answer is still an answer. */
  function parseCase(text, finish) {
    let raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let d = null;
    try { d = JSON.parse(raw); } catch {
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
      if (a >= 0 && b > a) { try { d = JSON.parse(raw.slice(a, b + 1)); } catch {} }
      if (!d && typeof OSCE?.salvageJson === 'function') d = OSCE.salvageJson(raw);
    }
    if (!d) {
      throw new Error(finish === 'MAX_TOKENS'
        ? 'The marker ran out of room before it finished. Press Mark again — it is given more room on a retry.'
        : 'The marker did not return readable marks. Try again in a moment.');
    }
    d.phases = d.phases || []; d.questions = d.questions || [];
    d.max = d.max || 100;
    d.total = Number(d.total) || 0;
    d.percent = d.percent != null ? Number(d.percent) : Math.round((d.total / d.max) * 100);
    d.pass = d.pass != null ? !!d.pass : d.percent >= 50;
    return d;
  }

  /* ================= my discussions, and the unmarked queue ================= */

  async function renderMine(view, user) {
    if (!allowed(user)) return notYours(view);
    view.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;
    try { Pending.setOwner(user?.email || ''); } catch {}
    let rows = [], queue = [];
    try { rows = await Backend.listCaseAttempts(); } catch {}
    try { queue = (await Pending.all()).filter(p => p.kind === 'case'); } catch {}
    const queued = new Set(queue.map(q => q.id));

    view.innerHTML = `
      <section class="page cs-mine">
        ${tabs('mine')}
        <h1>My discussions</h1>

        <div class="cs-queue">
          <h3>⏳ Waiting to be marked ${queue.length ? `<span class="cs-pill">${queue.length}</span>` : ''}</h3>
          ${queue.length ? `
            <p class="muted tiny">Recorded, kept on this device, never marked. Sending costs credit, so nothing is
              sent until you press — the site will not spend your money on its own while you are not looking.</p>
            <div id="cs-queue-list">${queue.map(row => `
              <div class="cs-q-row" data-qrow="${esc(row.id)}">
                <div>
                  <strong>${esc(row.title || row.id)}</strong>
                  <em class="muted tiny">${new Date(row.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    · ${fmt(row.secs || 0)}${row.blob ? ` · ${(row.blob.size / 1048576).toFixed(1)} MB` : ' · no recording'}</em>
                  <em class="cs-q-why muted tiny">${esc(Pending.reasonLine(row))}</em>
                </div>
                <div class="cs-q-acts">
                  ${row.blob ? `<button class="btn btn-ghost btn-sm" data-dl="${esc(row.id)}">⬇</button>` : ''}
                  <button class="btn btn-gold btn-sm" data-send="${esc(row.id)}">Send for marking</button>
                  <button class="btn btn-ghost btn-sm qr-danger" data-del="${esc(row.id)}">Discard</button>
                </div>
              </div>`).join('')}</div>
            <p class="cs-msg" id="cs-qmsg"></p>`
            : '<p class="muted tiny">Nothing waiting. Every discussion you have recorded has been marked.</p>'}
        </div>

        <h3 class="cs-past-h">Marked</h3>
        ${rows.filter(r => r.status !== 'unmarked' || !queued.has(r.id)).length ? `
        <table class="cs-table">
          <thead><tr><th>Case</th><th>When</th><th>Score</th><th></th></tr></thead>
          <tbody>${rows.map(r => `
            <tr class="${r.status === 'unmarked' ? 'is-unmarked' : ''}">
              <td>${esc(r.topic || r.case_id)}</td>
              <td class="muted tiny">${new Date(r.created).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</td>
              <td>${r.result
                ? `<span class="cs-score ${r.result.pass ? 'is-pass' : 'is-fail'}">${r.result.percent}%</span>`
                : '<span class="cs-score is-none">unmarked</span>'}</td>
              <td>${r.result
                ? `<a class="link" href="#/cases/result/${encodeURIComponent(r.id)}">Open →</a>`
                : '<span class="muted tiny">see the queue above</span>'}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<p class="muted tiny">No marked discussions yet.</p>'}
      </section>`;
    FX.viewIn(view);

    const qmsg = view.querySelector('#cs-qmsg');
    view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Discard that recording? It cannot be recovered.')) return;
      await Pending.drop(b.dataset.del);
      renderMine(view, user);
    }));
    view.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
      const row = await Pending.get(b.dataset.dl);
      if (!row?.blob) return;
      const url = URL.createObjectURL(row.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CASE-${String(row.title || 'case').replace(/[^a-z0-9]+/gi, '-')}.${/mp4|aac/.test(row.mime || '') ? 'm4a' : 'webm'}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }));
    view.querySelectorAll('[data-send]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.send;
      const row = await Pending.get(id);
      if (!row) return;
      if (!row.blob) {
        qmsg.innerHTML = '<span class="qr-danger">That row has no recording left to send.</span>';
        return;
      }
      b.disabled = true;
      qmsg.textContent = 'Loading the case…';
      try {
        const c = await Backend.getCase(row.payload.case_id);
        if (!c) throw new Error('That case is no longer in the bank.');
        const rec = { blob: row.blob, mime: row.mime, ext: /mp4|aac/.test(row.mime || '') ? 'm4a' : 'webm',
          secs: row.secs || 0, bytes: row.blob.size, url: '' };
        await sendForMarking({ c, base: Object.assign({ id: row.id }, row.payload), rec,
          btn: b, msg: qmsg, user, pr: priceOf() });
      } catch (e) {
        b.disabled = false;
        qmsg.innerHTML = `<span class="qr-danger">${esc(e.message)}</span>`;
      }
    }));
  }

  /* ================= the report ================= */

  async function renderResult(view, id, user) {
    if (!allowed(user)) return notYours(view);
    view.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;
    let a;
    try { a = await Backend.getCaseAttempt(id); } catch (e) {
      view.innerHTML = `<section class="page"><p class="qr-danger">${esc(e.message)}</p></section>`; return;
    }
    if (!a) { view.innerHTML = `<section class="page"><p class="muted">That discussion is not here.</p></section>`; return; }
    if (!a.result) {
      view.innerHTML = `<section class="page"><p class="muted">This one has not been marked yet.
        <a class="link" href="#/cases/mine">Open the queue →</a></p></section>`;
      FX.viewIn(view); return;
    }

    const r = a.result;
    const audioLive = a.audioExpires && Date.now() < a.audioExpires;

    view.innerHTML = `
      <section class="page cs-result">
        <a class="link tiny" href="#/cases/mine">← My discussions</a>
        <header class="cs-res-head">
          <div>
            <p class="kicker">CASE DISCUSSION · ${new Date(a.created).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</p>
            <h1>${esc(a.case?.topic || '')}</h1>
            <p class="muted tiny">${fmt(a.audioSecs || a.elapsed || 0)} spoken · marked by ${esc(a.modelLabel || a.model || '')}
              ${a.cost ? `· $${a.cost.usd.toFixed(3)} · LKR ${a.cost.lkr.toFixed(2)}` : ''}</p>
          </div>
          <div class="cs-pct ${r.pass ? 'is-pass' : 'is-fail'}">
            <b>${r.percent}%</b><span>${r.pass ? 'Pass' : 'Below the line'}</span>
          </div>
        </header>

        ${(a.phases || []).length ? stepperHtml(a.phases, (a.phases || []).length) : ''}

        ${r.examinerComment ? `<div class="cs-verdict"><h3>The examiner's verdict</h3><p>${esc(r.examinerComment)}</p></div>` : ''}

        ${(r.phases || []).map(p => `
          <div class="cs-res-phase">
            <h3>${esc(labelForPhase(a, p.id))} <span class="cs-res-mark">${p.awarded ?? 0} / ${p.max ?? 0}</span></h3>
            ${p.said ? `<p class="cs-said">“${esc(p.said)}”</p>` : ''}
            <ul class="cs-items">
              ${(p.items || []).map((it, ii) => `
                <li class="is-${String(it.status || 'missed').replace(/\s+/g, '-')}" data-qe-line>
                  <span class="cs-mark">${markOf(it.status)}</span>
                  <span><strong class="qe-text">${esc(it.item || '')}</strong>${pExpect(p.id, ii)}
                  ${it.note ? `<em class="muted tiny">${esc(it.note)}</em>` : ''}</span>
                </li>`).join('')}
            </ul>
            ${p.comment ? `<p class="cs-pcomment">${esc(p.comment)}</p>` : ''}
          </div>`).join('')}

        ${(r.questions || []).length ? `
        <div class="cs-res-viva">
          <h3>The viva</h3>
          ${(r.questions || []).map(q => `
            <details class="cs-res-q ${q.status === 'notAsked' ? 'is-notasked' : ''}">
              <summary><span class="cs-res-mark">${q.status === 'notAsked' ? '—' : `${q.awarded ?? 0} / ${q.max ?? 0}`}</span>
                ${esc(q.q || '')}</summary>
              ${q.status === 'notAsked'
                ? '<p class="muted tiny">This one was never put to you, so it is not marked. It is here to revise from.</p>'
                : `${q.said ? `<p class="cs-said">“${esc(q.said)}”</p>` : ''}
                   ${(q.hits || []).length ? `<ul class="cs-items">${q.hits.map(h => `
                      <li class="is-${String(h.status || 'missed').replace(/\s+/g, '-')}">
                        <span class="cs-mark">${markOf(h.status)}</span><span>${esc(h.point || '')}</span></li>`).join('')}</ul>` : ''}
                   ${q.versusModel ? `<p class="cs-vs"><strong>Against the model answer:</strong> ${esc(q.versusModel)}</p>` : ''}`}
              ${modelAnswerFor(a, q) ? `<div class="cs-model-box"><strong>The model answer</strong>
                <p>${esc(modelAnswerFor(a, q))}</p></div>` : ''}
            </details>`).join('')}
        </div>` : ''}

        ${(r.language || []).length ? `
        <div class="cs-lang">
          <h3>What you said, and what to say</h3>
          <p class="muted tiny">Heard on the recording. A typed transcript would have hidden every one of these.</p>
          <table class="cs-lang-t">
            <thead><tr><th>You said</th><th>Say</th><th>Why it matters</th></tr></thead>
            <tbody>${r.language.map(l => `<tr>
              <td class="cs-said-cell">${esc(l.said || '')}</td>
              <td><strong>${esc(l.correct || '')}</strong></td>
              <td class="muted tiny">${esc(l.why || '')}</td></tr>`).join('')}</tbody>
          </table>
        </div>` : ''}

        ${r.coaching ? `
        <div class="cs-coach">
          <h3>Mock-examiner feedback</h3>
          ${[['structure', 'Structure and signposting'], ['articulation', 'Articulation and clarity'],
             ['pronunciation', 'Pronunciation'], ['technique', 'Exam technique']]
            .filter(([k]) => r.coaching[k]).map(([k, lbl]) => `
              <div class="cs-coach-b"><h4>${lbl}</h4><p>${esc(r.coaching[k])}</p></div>`).join('')}
        </div>` : ''}

        ${(r.strengths || []).length || (r.improvements || []).length ? `
        <div class="cs-two">
          ${(r.strengths || []).length ? `<div><h3>What was good</h3><ul>${r.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          ${(r.improvements || []).length ? `<div><h3>What to change</h3><ul>${r.improvements.map(x =>
            `<li>${esc(x.action || x)}${x.marks ? ` <em class="muted tiny">worth ${x.marks}</em>` : ''}</li>`).join('')}</ul></div>` : ''}
        </div>` : ''}

        ${(r.keyLearning || []).length ? `<div class="cs-key"><h3>Carry away</h3>
          <ul>${r.keyLearning.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}

        <div class="cs-res-acts">
          <button class="btn btn-ghost" id="cs-print">🖨 Print / Save as PDF</button>
          ${audioLive ? `<button class="btn btn-ghost" id="cs-audio">🎧 The recording</button>` : `
            <span class="muted tiny">The recording has passed its 24 hours on the server${
              typeof Drive !== 'undefined' && Drive.on() ? ' — your Drive copy is still there.' : ' and has been deleted.'}</span>`}
        </div>
        <div id="cs-audio-host"></div>
      </section>`;
    FX.viewIn(view);

    /* Reading the report is when a wrong expected item is noticed, so the
       pencils are here too — writing back to the case itself. */
    wireCaseEdit(view, a.case_id);
    view.querySelector('#cs-print')?.addEventListener('click', () => printCase(a));
    view.querySelector('#cs-audio')?.addEventListener('click', async e => {
      const host = view.querySelector('#cs-audio-host');
      e.target.disabled = true;
      host.innerHTML = '<p class="muted tiny">Fetching…</p>';
      try {
        const url = await Backend.getCaseAudioUrl(a.audioPath);
        host.innerHTML = url
          ? `<div class="cs-audio"><audio controls src="${url}"></audio>
             <a class="btn btn-ghost btn-sm" href="${url}" download>⬇ Download</a></div>`
          : '<p class="muted tiny">It is no longer on the server.</p>';
      } catch { host.innerHTML = '<p class="muted tiny">It could not be fetched.</p>'; }
    });
  }

  const markOf = s => ({ covered: '✓', partial: '~', 'partly said': '~', missed: '✗' }[String(s || '').toLowerCase()] || '✗');
  const labelForPhase = (a, id) => (a.phases || []).find(p => p.id === id)?.ask || id || '';
  function modelAnswerFor(a, q) {
    const list = a.questions || [];
    const byN = list[(q.n || 0) - 1];
    if (byN && byN.model) return byN.model;
    const hit = list.find(x => String(x.q || '').slice(0, 40) === String(q.q || '').slice(0, 40));
    return hit?.model || '';
  }

  /* ---------------- print ----------------
     Uses the same sheet the OSCE report and study document use, so an iPad
     gets the share sheet rather than a silent nothing. */
  function printCase(a) {
    const r = a.result || {};
    const P = '.cs-print';
    const styles = `
@page { size: A4 portrait; margin: 16mm 15mm 14mm; }
${P} { color:#111; background:#fff; font-family:"Helvetica Neue",Arial,sans-serif; font-size:10pt; line-height:1.5; }
${P} h1{font-family:Georgia,serif;font-size:21pt;margin:0 0 4px}
${P} h2{font-size:13pt;margin:16px 0 6px;border-left:4px solid #0d8f7d;padding-left:9px}
${P} h3{font-size:10.5pt;margin:12px 0 4px}
${P} .brand{font-size:7.5pt;letter-spacing:.22em;text-transform:uppercase;color:#7a5a10;margin:0 0 2px}
${P} .pct{font-size:24pt;font-family:Georgia,serif}
${P} ul{margin:4px 0 8px 16px;padding:0}
${P} li{margin:2px 0}
${P} .said{border-left:2px solid #ddd;padding-left:9px;margin:5px 0;font-size:.9em;color:#555;font-style:italic}
${P} table{width:100%;border-collapse:collapse;font-size:9pt;margin:6px 0}
${P} th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
${P} .m{display:inline-block;width:13px;font-weight:700}
${P} .foot{margin-top:16px;padding-top:6px;border-top:1px solid #ddd;font-size:7.5pt;color:#888}`;

    const body = `<div class="cs-print">
      <p class="brand">AUREUM · Pathway to MD</p>
      <h1>${esc(a.case?.topic || '')}</h1>
      <p><span class="pct">${r.percent}%</span> — ${r.pass ? 'pass' : 'below the line'} ·
        ${new Date(a.created).toLocaleDateString('en-GB', { dateStyle: 'medium' })} ·
        ${fmt(a.audioSecs || a.elapsed || 0)} spoken</p>
      <p>${esc(a.case?.vignette || '')}</p>
      ${r.examinerComment ? `<h2>The examiner's verdict</h2><p>${esc(r.examinerComment)}</p>` : ''}
      ${(r.phases || []).map(p => `
        <h2>${esc(labelForPhase(a, p.id))} — ${p.awarded ?? 0}/${p.max ?? 0}</h2>
        ${p.said ? `<p class="said">${esc(p.said)}</p>` : ''}
        <ul>${(p.items || []).map(it => `<li><span class="m">${markOf(it.status)}</span> ${esc(it.item || '')}${
          it.note ? ` — <i>${esc(it.note)}</i>` : ''}</li>`).join('')}</ul>
        ${p.comment ? `<p>${esc(p.comment)}</p>` : ''}`).join('')}
      ${(r.questions || []).length ? `<h2>The viva</h2>${(r.questions || []).map(q => `
        <h3>${esc(q.q || '')} — ${q.status === 'notAsked' ? 'not asked' : `${q.awarded ?? 0}/${q.max ?? 0}`}</h3>
        ${q.said ? `<p class="said">${esc(q.said)}</p>` : ''}
        ${(q.hits || []).length ? `<ul>${q.hits.map(h => `<li><span class="m">${markOf(h.status)}</span> ${esc(h.point || '')}</li>`).join('')}</ul>` : ''}
        ${q.versusModel ? `<p><b>Against the model answer:</b> ${esc(q.versusModel)}</p>` : ''}
        ${modelAnswerFor(a, q) ? `<p><b>Model answer.</b> ${esc(modelAnswerFor(a, q))}</p>` : ''}`).join('')}` : ''}
      ${(r.language || []).length ? `<h2>What you said, and what to say</h2>
        <table><tr><th>You said</th><th>Say</th><th>Why</th></tr>
        ${r.language.map(l => `<tr><td>${esc(l.said || '')}</td><td><b>${esc(l.correct || '')}</b></td><td>${esc(l.why || '')}</td></tr>`).join('')}
        </table>` : ''}
      ${r.coaching ? `<h2>Mock-examiner feedback</h2>${[['structure', 'Structure'], ['articulation', 'Articulation'],
        ['pronunciation', 'Pronunciation'], ['technique', 'Exam technique']].filter(([k]) => r.coaching[k])
        .map(([k, lbl]) => `<h3>${lbl}</h3><p>${esc(r.coaching[k])}</p>`).join('')}` : ''}
      ${(r.keyLearning || []).length ? `<h2>Carry away</h2><ul>${r.keyLearning.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <p class="foot">AUREUM · Pathway to MD — case discussion, ${new Date().toLocaleDateString('en-GB')}</p>
    </div>`;

    if (typeof OSCE?.openPrintSheet === 'function') return OSCE.openPrintSheet(styles, body);
    // a standalone fallback, so print is never the thing that silently does nothing
    const w = document.createElement('div');
    w.id = 'cs-print-sheet';
    w.innerHTML = `<style>@media print{body>*{display:none!important}#cs-print-sheet{display:block!important}}
      ${styles}</style>${body}`;
    document.body.appendChild(w);
    setTimeout(() => { window.print(); setTimeout(() => w.remove(), 800); }, 60);
  }

  return {
    renderBank, renderCase, renderExamine, renderRun, renderResult, renderMine,
    tabsHtml: tabs, notYours,
    COMPONENTS, componentOf, shortOf, stepperHtml,
    allowed, cases, bustCases, waitMs, setWaitMs, saidAlready, missingIn,
    estimate, parseCase, minutesOf, phasesOf, questionsOf, expectedOf,
    openSessions, dropSession
  };
})();
