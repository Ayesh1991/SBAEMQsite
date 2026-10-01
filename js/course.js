/* ============================================================
   course.js — which exam is this person preparing for?

   THE ONE QUESTION THE WHOLE PLATFORM TURNS ON once there is more than
   one exam in it. A final MBBS candidate and an O&G Part 2 candidate
   open the same bank and must not see the same thing.

   THREE FACTS, ALL TRUE AT ONCE, and this module owns only the first:

     track      which exam is this for        pgim-og-2
     subject    which speciality is it about  obgyn
     collection where did it come from        PERA OSCE

   `collection` was here first and is untouched — it answers a different
   question and both answers are useful.

   WHY `Course` AND NOT `Track`. The database calls these rows `tracks`
   and this module reads them, but the name `Track` is already taken, by
   the interaction logger in track.js that quiz.js and ai.js call on
   every answer. Two modules cannot share a global, and the one that
   loads second wins silently — a whole subsystem going quiet with
   nothing on the console. So the table keeps its name and the module
   takes the word the candidate uses: a course.

   THE ASYMMETRY. A final MBBS candidate sits ONE exam covering FIVE
   subjects; a Part 2 candidate sits one exam in one speciality. So a
   person enrols in a TRACK, and `subject` filters inside it — which is a
   filter for the undergraduate and nothing at all for everybody else.
   One model, and no special case in the pages that use it.

   WHAT THIS IS NOT. It is not the security. Reading content you have not
   paid for is refused by the database, in the policies that call
   `can_read_tracks()` — see supabase/schema.sql. What happens here is
   RELEVANCE: not showing somebody four specialities they are not sitting.
   A filter in a browser is a convenience, never a lock, and treating it
   as one is how paid content leaks.
   ============================================================ */

const Course = (() => {

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* Read once per visit. The list of exams changes when a new speciality
     is opened — a few times a year — and re-reading it on every page is
     egress spent on an answer that has not changed. */
  let _tracks = null, _mine = null, _loaded = null;

  async function load(force) {
    if (force) { _tracks = _mine = _loaded = null; }
    if (_loaded) return _loaded;
    _loaded = (async () => {
      try {
        _tracks = await Backend.listTracks();
      } catch { _tracks = []; }
      try {
        _mine = await Backend.myEnrolments();
      } catch { _mine = []; }
      return { tracks: _tracks, mine: _mine };
    })();
    return _loaded;
  }
  const bust = () => {
    _tracks = _mine = _loaded = null;
    /* Everything scoped to a course has to be forgotten with it, or the
       next person — or the next course — reads the last one's. */
    forgetCourseScoped();
  };

  /**
   * Drop every cached thing that belongs to a course: the syllabus tree, the
   * exam blueprint, the paper/essay/case banks, and the derived indexes the
   * simulator and the coverage map build from them.
   *
   * ONE LIST, IN ONE PLACE. These caches are spread over six modules, and
   * the failure when one is missed is the worst kind — not an error, just
   * the previous course's content sitting on the page looking plausible.
   */
  function forgetCourseScoped() {
    try { Data.bustSyllabus?.(); } catch {}
    try { Data.bustPapers?.(); } catch {}
    try { Blueprint.bust?.(); } catch {}
    try { Essay.bustPapers?.(); } catch {}
    try { Cases.bustCases?.(); } catch {}
    try { if (typeof Cache !== 'undefined') ['coverage-index', 'sim-qindex', 'sim-qtags', 'sim-qstats'].forEach(k => Cache.bust(k)); } catch {}
  }

  /** Every course a candidate may choose right now. */
  const live = () => (_tracks || []).filter(t => t.isLive);
  const all = () => (_tracks || []).slice();
  const byId = id => (_tracks || []).find(t => t.id === id) || null;
  const mine = () => (_mine || []).slice();

  /**
   * The course this person is on. The primary enrolment, or — for an
   * account that predates all of this, or one whose primary was removed
   * — the only live course if there is exactly one.
   *
   * Returning null is a real answer and callers must handle it: it means
   * "not yet chosen", which is what a brand-new account is.
   */
  function current() {
    const p = (_mine || []).find(e => e.isPrimary);
    if (p) return byId(p.trackId);
    const l = live();
    return l.length === 1 ? l[0] : null;
  }
  const currentId = () => current()?.id || '';

  /** The entitlement this person holds for a course, if any. */
  const statusOf = id => (_mine || []).find(e => e.trackId === id)?.status || '';
  const isActive = id => {
    const e = (_mine || []).find(x => x.trackId === id);
    if (!e || e.status !== 'active') return false;
    return !e.validUntil || new Date(e.validUntil) > new Date();
  };

  /**
   * Does this row belong in front of the person on this course?
   *
   * UNTAGGED CONTENT IS SHOWN, and that is the opposite of what the
   * database does with it. The two are answering different questions:
   * the database is asked "may this be read", and errs shut so nothing
   * leaks; this is asked "is this relevant", and a row with no track is
   * not irrelevant, it is unfiled. Hiding it here would mean a station
   * whose tag somebody forgot silently vanishing from its own author's
   * bank with nothing to show them why.
   */
  function fits(row) {
    const t = row && (row.tracks || row.track);
    if (!t || !t.length) return true;
    const id = currentId();
    if (!id) return true;
    return (Array.isArray(t) ? t : [t]).includes(id);
  }

  /** The subject filter — five for a final MBBS candidate, none for the rest. */
  const subjects = () => (current()?.subjects || []).slice();
  const hasSubjects = () => subjects().length > 1;

  const SUBJECT_NAMES = {
    medicine: 'Medicine', surgery: 'Surgery', paediatrics: 'Paediatrics',
    obgyn: 'Obstetrics & Gynaecology', psychiatry: 'Psychiatry',
    anaesthesiology: 'Anaesthesiology'
  };
  const subjectName = id => SUBJECT_NAMES[id] || id;

  /**
   * What the people on a course are called.
   *
   * "Registrar / Senior Registrar" was hard-coded when there was one exam,
   * and it is wrong for every course that is not a PGIM one: a final MBBS
   * candidate is a student, and being asked to choose between two
   * postgraduate training grades is a question with no true answer. The
   * grade is decoration — greeting and invoice, gating nothing — but a
   * form that cannot be answered honestly is the first thing a new
   * candidate meets.
   *
   * An empty list means the course has not said, so the app's own list
   * stands. That is what every row holds until somebody edits it, so this
   * changes nothing for the course that exists today.
   */
  function positionsFor(id) {
    const own = (byId(id)?.positions || []).filter(Boolean);
    if (own.length) return own.slice();
    return (typeof Progression !== 'undefined' && Progression.POSITIONS)
      ? Progression.POSITIONS.slice() : [];
  }
  const positions = () => positionsFor(currentId());

  const STAGE_NAMES = {
    'mbbs-final': 'Undergraduate',
    'pg-entry': 'Postgraduate — entry',
    'pg-exit': 'Postgraduate — exit'
  };
  const stageName = id => STAGE_NAMES[id] || id;

  /* ---------- the choice made before there was an account ----------

     A candidate picks their course on the sign-up form, which on a cloud
     deployment is minutes or days before they are a user the database
     will accept a row from. The choice is held here in the meantime, and
     claimed on the first sign-in that finds it. Losing it is survivable
     — they change it in their profile — so nothing here throws. */
  const PENDING = 'aureum-course-pick';

  function remember(id) {
    try { if (id && byId(id)) localStorage.setItem(PENDING, id); } catch {}
  }

  /**
   * Apply a remembered choice, once, if this account has not already
   * chosen. An existing primary enrolment always wins: a stale pick left
   * in a shared browser must never move somebody else's course.
   */
  async function claimPending() {
    let id = null;
    try { id = localStorage.getItem(PENDING); } catch {}
    try {
      await load(true);
      /* NO CHOICE WAS OFFERED, SO MAKE IT. With one course open the form
         asks nothing — and an account with no enrolment at all is a real
         gap, not a tidy default: nothing says which course it is on and
         the bank works only by the accident of that course being free.
         The one course there is, is the answer. */
      if (!id) { const l = live(); if (l.length === 1) id = l[0].id; }
      if (!id) return null;
      if ((_mine || []).some(e => e.isPrimary)) { try { localStorage.removeItem(PENDING); } catch {} return null; }
      if (!byId(id)?.isLive) { try { localStorage.removeItem(PENDING); } catch {} return null; }
      await Backend.enrol(id);
      const c = await choose(id);
      try { localStorage.removeItem(PENDING); } catch {}
      return c;
    } catch { return null; }
  }

  /** Choose, or change, the exam being prepared for. */
  async function choose(id) {
    await Backend.setPrimaryTrack(id);
    _mine = await Backend.myEnrolments();
    /* A different exam is a different syllabus, a different blueprint and a
       different bank — the library, the coverage map, the simulator and the
       paper classifier all read them, and all of them would otherwise keep
       showing the course just left. */
    forgetCourseScoped();
    return current();
  }

  /**
   * The picker, grouped by stage — undergraduate above postgraduate,
   * because that is the order a career runs in.
   *
   * ONE COURSE IS NOT A CHOICE. With a single exam open, a picker is a
   * question with one answer: noise on the sign-up form, and one more
   * thing to get wrong. It draws nothing, and the caller shows nothing.
   */
  function picker(selectedId, name) {
    const l = live();
    if (l.length < 2) return '';
    const stages = [...new Set(l.map(t => t.stage))]
      .sort((a, b) => (a === 'mbbs-final' ? -1 : b === 'mbbs-final' ? 1 : a.localeCompare(b)));
    return `<div class="tk-pick" role="radiogroup" aria-label="What are you preparing for?">
      ${stages.map(st => `
        <div class="tk-group">
          <p class="tk-stage">${esc(stageName(st))}</p>
          ${l.filter(t => t.stage === st).map(t => `
            <label class="tk-opt${t.id === selectedId ? ' is-on' : ''}">
              <input type="radio" name="${esc(name || 'course')}" value="${esc(t.id)}"${t.id === selectedId ? ' checked' : ''}>
              <span class="tk-opt-n">${esc(t.short)}</span>
              <span class="tk-opt-f">${esc(t.name)}</span>
            </label>`).join('')}
        </div>`).join('')}
    </div>`;
  }

  /** Keep the chosen option lit as the radio moves. */
  function wirePicker(host) {
    if (!host || host.__tkWired) return;
    host.__tkWired = true;
    host.addEventListener('change', e => {
      const r = e.target.closest('input[type=radio]');
      if (!r) return;
      host.querySelectorAll('.tk-opt').forEach(o => o.classList.toggle('is-on', o.contains(r)));
    });
  }

  /**
   * The subject chips, for a course that has more than one subject.
   * `sel` is '' for "all". Returns nothing when there is nothing to
   * choose between — one subject is not a filter.
   */
  function subjectBar(sel) {
    const s = subjects();
    if (s.length < 2) return '';
    return `<div class="tk-subs" role="tablist" aria-label="Subject">
      <button type="button" class="tk-sub${sel ? '' : ' is-on'}" data-sub="">All subjects</button>
      ${s.map(id => `<button type="button" class="tk-sub${sel === id ? ' is-on' : ''}" data-sub="${esc(id)}">${esc(subjectName(id))}</button>`).join('')}
    </div>`;
  }

  /** Does this row belong under the chosen subject? Same unfiled rule as fits(). */
  function fitsSubject(row, sel) {
    if (!sel) return true;
    const s = row && (row.subject || (row.meta && row.meta.subject));
    if (!s) return true;
    return s === sel;
  }

  return { load, bust, live, all, byId, mine, current, currentId, statusOf, isActive,
    fits, fitsSubject, subjects, hasSubjects, subjectName, stageName, choose,
    positions, positionsFor,
    remember, claimPending,
    picker, wirePicker, subjectBar,
    _state: () => ({ tracks: _tracks, mine: _mine }) };
})();
