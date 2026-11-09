/* ============================================================
   rapid.js — the T/F reader, in the shape CPD already proved.

   WHAT THIS IS. A paper's true/false section is five or six statements
   hanging off one lead-in — "Regarding pre-eclampsia:" and then six
   things that are each true or false. Shown one at a time, the lead-in
   is reprinted six times, the candidate loses the thread of what they
   are comparing, and six clicks of navigation buy nothing. CPD solved
   this already: the lead once, then one line a statement, T and F on
   each line, the verdict the instant you commit.

   IT IS NOT A THIRD MODE. It is a second VIEW of study mode, and that
   distinction is the whole design:

     * the same session key, so answers carry across when you switch
       presentation half way through a paper;
     * the same question keys — `paperId:TF:number` — so every mark,
       note, flag and review item lands exactly where the one-at-a-time
       reader would have put it;
     * the same attempt, built by Quiz.buildAttempt, so the history, the
       marksheet and the weakness profile that shapes the next mock
       cannot tell which reader produced it.

   STUDY ONLY, DELIBERATELY. The whole point is the answer appearing the
   moment you commit to a statement, and a page that shows you every
   statement at once is the wrong shape for a timed paper anyway — a
   candidate can read ahead, and the clock belongs to one question at a
   time. Exam mode stays with the one-at-a-time reader.

   THE FLATTENED TF IS A TWO-OPTION QUESTION. Data.flatten() turns each
   statement into options ['True','False'] with `answer` an INDEX — 0 is
   true, 1 is false — not the boolean the source file had. CPD's reader
   works on booleans. Everything here speaks indices, because the index
   is what the attempt and the question key already agree on, and
   converting at the boundary is how the two systems stay comparable.
   ============================================================ */
const Rapid = (() => {
  'use strict';

  const TRUE = 0, FALSE = 1;        // Data.tfAnswerIndex's order, not ours to change
  let state = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* The lead-in is printed once per group, so it is stripped off the
     front of a statement that repeats it. CPD does the same and for the
     same reason: an imported file sometimes carries the lead in both
     places and reading it twice on one line is worse than not at all. */
  function tail(q) {
    const lead = String(q.lead || '').trim();
    let t = String(q.stem || '').trim();
    if (lead && t.toLowerCase().startsWith(lead.toLowerCase())) t = t.slice(lead.length).trim();
    return t.replace(/^[-–—:,]\s*/, '') || String(q.stem || '');
  }

  /** Consecutive statements sharing a lead-in are one block. */
  function group(questions) {
    const out = [];
    questions.forEach((q, i) => {
      const lead = String(q.lead || '').trim();
      const last = out[out.length - 1];
      /* Only CONSECUTIVE ones: two separate blocks that happen to share
         a lead are still two blocks, and merging them would renumber
         nothing but would read as one impossible twelve-part question. */
      if (last && last.lead === lead && lead) last.items.push({ q, i });
      else out.push({ lead, items: [{ q, i }] });
    });
    return out;
  }

  function start(container, loaded, questions, opts) {
    const o = opts || {};
    const resume = o.resume || null;
    state = {
      container, loaded, questions,
      kind: o.kind || 'TF',
      sessionKey: o.sessionKey || null,
      answers: resume?.answers?.length === questions.length
        ? resume.answers.slice() : new Array(questions.length).fill(null),
      revealed: resume?.revealed?.length === questions.length
        ? resume.revealed.slice() : new Array(questions.length).fill(false),
      qTime: resume?.qTime?.length === questions.length
        ? resume.qTime.slice() : new Array(questions.length).fill(0),
      startedAt: Date.now(),
      elapsedBase: resume?.elapsedBase || 0,
      onFinish: o.onFinish, onQuit: o.onQuit, onSwitch: o.onSwitch,
      saveTimer: null
    };
    paint();
  }

  function destroy() {
    if (state?.saveTimer) clearTimeout(state.saveTimer);
    if (state) state.container.innerHTML = '';
    state = null;
  }

  const qkey = i => state.questions[i]._qkey
    || `${state.loaded.meta.id}:${state.kind}:${state.questions[i].number}`;
  const answered = () => state.answers.filter(a => a !== null).length;
  const correctN = () => state.questions.reduce((n, q, i) =>
    n + (state.answers[i] === q.answer ? 1 : 0), 0);

  function paint() {
    const { loaded, questions } = state;
    const blocks = group(questions);
    state.container.innerHTML = `
      <section class="page narrow rpd">
        <header class="rpd-head" data-animate>
          <a class="link muted" href="#/paper/${encodeURIComponent(loaded.meta.id)}">← ${esc(loaded.paper.topic || loaded.meta.title)}</a>
          <div class="rpd-bar">
            <span class="chip chip-mode">STUDY</span>
            <span class="chip chip-tf">T/F</span>
            <span class="rpd-score" id="rpd-score"></span>
            <button class="btn btn-ghost btn-sm" id="rpd-switch"
              title="Show one question at a time instead">☰ One at a time</button>
          </div>
          <p class="rpd-hint muted tiny">Tap <b>T</b> or <b>F</b> — the answer and the reasoning
            appear straight away. Keyboard: hover a line and press <kbd>T</kbd> or <kbd>F</kbd>.</p>
        </header>
        <div class="rpd-body" data-animate>${blocks.map(blockHTML).join('')}</div>
        <div class="rpd-foot" data-animate>
          <button class="btn btn-gold" id="rpd-finish">Finish &amp; see summary</button>
          <button class="btn btn-ghost" id="rpd-quit">Save &amp; exit</button>
        </div>
      </section>`;
    wire();
    updateScore();
    try { FX.viewIn(state.container); } catch {}
  }

  function blockHTML(b) {
    return `
      <section class="cpdr-group${b.lead ? ' has-lead' : ''}">
        ${b.lead ? `<p class="cpdr-lead">${esc(b.lead)}</p>` : ''}
        <div class="cpdr-rows">${b.items.map(it => rowHTML(it.q, it.i)).join('')}</div>
      </section>`;
  }

  function rowHTML(q, i) {
    const picked = state.answers[i];
    const shown = state.revealed[i];
    const right = shown && picked === q.answer;
    const on = v => shown && picked === v ? ' is-picked' : '';
    const key = v => shown && q.answer === v ? ' is-key' : '';
    return `
      <article class="cpdr-row${shown ? (right ? ' is-right' : ' is-wrong') : ''}"
        data-i="${i}" tabindex="0">
        <span class="cpdr-n">${String(q.number).padStart(2, '0')}</span>
        <p class="cpdr-txt">${esc(tail(q))}</p>
        <div class="cpdr-tf">
          <button class="cpdr-b cpdr-t${on(TRUE)}${key(TRUE)}" data-pick="${TRUE}" data-i="${i}"
            ${shown ? 'disabled' : ''} title="True (T)">T</button>
          <button class="cpdr-b cpdr-f${on(FALSE)}${key(FALSE)}" data-pick="${FALSE}" data-i="${i}"
            ${shown ? 'disabled' : ''} title="False (F)">F</button>
        </div>
        <span class="cpdr-mark">${shown ? (right ? '✓' : '✗') : ''}</span>
        <div class="cpdr-why"${shown ? '' : ' hidden'}>${whyHTML(q)}</div>
      </article>`;
  }

  function whyHTML(q) {
    return `
      <p class="cpd-answer">The statement is <strong>${q.answer === TRUE ? 'TRUE' : 'FALSE'}</strong>.</p>
      ${q.rationale ? `<div class="cpd-rationale">${esc(q.rationale)}</div>` : ''}
      ${q.hook ? `<p class="cpd-hook"><span>💡</span>${esc(q.hook)}</p>` : ''}`;
  }

  function wire() {
    const c = state.container;
    c.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () =>
      choose(Number(b.dataset.i), Number(b.dataset.pick))));
    /* Hover-and-press, the way somebody actually works down a list of
       six statements. Not a global hotkey: with every statement on one
       page there has to be a way of saying WHICH one. */
    c.querySelectorAll('.cpdr-row').forEach(row => row.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (k !== 't' && k !== 'f') return;
      e.preventDefault();
      choose(Number(row.dataset.i), k === 't' ? TRUE : FALSE);
    }));
    c.querySelector('#rpd-finish').addEventListener('click', finish);
    c.querySelector('#rpd-quit').addEventListener('click', async () => {
      await saveNow();
      const q = state.onQuit; destroy(); if (q) q();
    });
    c.querySelector('#rpd-switch').addEventListener('click', async () => {
      /* Switching presentation keeps the answers: same session key,
         same question keys, so it is the same attempt seen differently.
         The save has to land before the other reader reads it. */
      await saveNow();
      const f = state.onSwitch; destroy(); if (f) f();
    });
  }

  function choose(i, pick) {
    if (!state || state.revealed[i]) return;
    state.answers[i] = pick;
    state.revealed[i] = true;
    const q = state.questions[i];
    try {
      if (typeof Track !== 'undefined') {
        Track.log('answer', qkey(i), 'study', { chosen: pick });
        Track.log('reveal', qkey(i), 'study', { correct: pick === q.answer });
      }
    } catch {}
    /* Repaint the one row, not the page: a candidate half way down six
       statements must not be thrown back to the top. */
    const row = state.container.querySelector(`.cpdr-row[data-i="${i}"]`);
    if (row) {
      row.outerHTML = rowHTML(q, i);
      const fresh = state.container.querySelector(`.cpdr-row[data-i="${i}"]`);
      fresh?.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () =>
        choose(Number(b.dataset.i), Number(b.dataset.pick))));
      fresh?.addEventListener('keydown', e => {
        const k = e.key.toLowerCase();
        if (k !== 't' && k !== 'f') return;
        e.preventDefault();
        choose(Number(fresh.dataset.i), k === 't' ? TRUE : FALSE);
      });
      try { FX.pulse(fresh?.querySelector('.cpdr-b.is-key')); } catch {}
    }
    updateScore();
    save();
  }

  function updateScore() {
    const el = state.container.querySelector('#rpd-score');
    if (!el) return;
    const n = answered(), total = state.questions.length;
    el.innerHTML = n
      ? `<b>${correctN()}</b> / ${n} right <i>· ${total - n} left</i>`
      : `${total} statements`;
  }

  /* ---------- the same session and the same attempt ---------- */

  function snapshot() {
    return {
      answers: state.answers, revealed: state.revealed, qTime: state.qTime,
      index: 0, flags: [], flawed: [], strikes: [],
      elapsedBase: state.elapsedBase + Math.round((Date.now() - state.startedAt) / 1000),
      remaining: null,
      answered: answered(), total: state.questions.length
    };
  }
  function save() {
    if (!state.sessionKey || !Backend.saveSession) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 800);
  }
  /* Returns the write — see Quiz.autosaveNow. Switching view re-reads
     the session straight after, and losing that race would discard
     everything answered in this sitting. */
  function saveNow() {
    if (!state?.sessionKey || !Backend.saveSession) return Promise.resolve();
    return Backend.saveSession(state.sessionKey, snapshot()).catch(() => {});
  }

  function finish() {
    const { questions, answers } = state;
    const left = answers.filter(a => a === null).length;
    if (left && !confirm(`${left} statement${left > 1 ? 's' : ''} still unanswered. Finish anyway?`)) return;
    let correct = 0, scored = 0;
    const detail = questions.map((q, i) => {
      const ok = answers[i] === q.answer;
      scored++; if (ok) correct++;
      return { chosen: answers[i], correct: q.answer, isCorrect: ok, excluded: false,
        qkey: qkey(i), bucket: q.bucket || '', area: q.area || '', kind: q.kind,
        timeSec: state.qTime[i] || 0 };
    });
    try {
      const rows = detail.filter(d => d.chosen != null).map(d => ({ k: d.qkey, ok: d.isCorrect, t: d.timeSec }));
      if (rows.length && Backend.bumpQuestionStats) Backend.bumpQuestionStats(rows).catch(() => {});
    } catch {}
    try { if (typeof Track !== 'undefined') Track.flush(); } catch {}
    /* Quiz owns the shape — see buildAttempt's comment. Two builders
       that drifted would show as a history disagreeing with itself. */
    const attempt = Quiz.buildAttempt({
      loaded: state.loaded, kind: state.kind, studyMode: true,
      total: questions.length, scored, correct, detail,
      startedAt: state.startedAt, timedOut: false
    });
    if (state.sessionKey && Backend.clearSession) Backend.clearSession(state.sessionKey).catch(() => {});
    const done = state.onFinish;
    destroy();
    if (done) done(attempt);
  }

  return { start, destroy, _group: group, _tail: tail, TRUE, FALSE };
})();
