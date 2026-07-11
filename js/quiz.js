/* ============================================================
   quiz.js — the SBA / EMQ runner.

   Modes:
     • 'exam'  — timed (optional), feedback at the end, navigator + flags.
     • 'study' — no timer; answer/rationale/hook revealed instantly,
                 with a navigator, per-question notes, and an
                 "Explore with AI" panel under the explanation.

   Extras added in v3:
     • Autosave to Backend so a half-finished paper can be resumed.
     • Per-question notes (Backend.saveNote / getNote).
     • Study-mode question navigator.
     • AI.attach() hook under the study-mode explanation.
   ============================================================ */

const Quiz = (() => {
  let state = null;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRST';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /**
   * container, loaded ({meta, paper, path}), questions (flattened list),
   * opts: { mode, kind, timeLimitMinutes, sessionKey, resume, onFinish, onQuit }
   */
  function start(container, loaded, questions, opts) {
    const resume = opts.resume || null;
    state = {
      container, loaded, questions,
      mode: opts.mode === 'study' ? 'study' : 'exam',
      kind: opts.kind,
      sessionKey: opts.sessionKey || null,
      answers: resume?.answers?.length === questions.length ? resume.answers.slice() : new Array(questions.length).fill(null),
      revealed: resume?.revealed?.length === questions.length ? resume.revealed.slice() : new Array(questions.length).fill(false),
      flags: new Set(resume?.flags || []),
      index: Math.min(resume?.index || 0, questions.length - 1),
      startedAt: Date.now(),
      elapsedBase: resume?.elapsedBase || 0,
      onFinish: opts.onFinish,
      onQuit: opts.onQuit,
      timeLimitSec: state_timeLimit(opts),
      timerId: null,
      remaining: resume?.remaining != null ? resume.remaining : null,
      notes: {},
      saveTimer: null
    };
    if (state.mode === 'exam' && state.timeLimitSec > 0 && state.remaining == null) state.remaining = state.timeLimitSec;
    if (state.mode === 'exam' && state.remaining != null) state.timerId = setInterval(tick, 1000);

    document.addEventListener('keydown', onKey);

    // load any saved notes for this paper+kind, then render
    const prefix = notePrefix();
    if (Backend.getNotesForPaper) {
      Backend.getNotesForPaper(prefix).then(map => {
        for (const k in map) { const n = Number(k.split(':').pop()); if (!isNaN(n)) state.notes[n] = map[k]; }
        render();
      }).catch(render);
    } else render();
  }

  function state_timeLimit(opts) {
    if (opts.mode === 'study') return 0;
    return Number.isFinite(opts.timeLimitMinutes) ? opts.timeLimitMinutes * 60 : 0;
  }

  function destroy() {
    if (state?.timerId) clearInterval(state.timerId);
    if (state?.saveTimer) clearTimeout(state.saveTimer);
    document.removeEventListener('keydown', onKey);
    state = null;
  }

  function tick() {
    state.remaining -= 1;
    const t = state.container.querySelector('#quiz-timer');
    if (t) { t.textContent = fmtTime(state.remaining); t.classList.toggle('timer-low', state.remaining <= 60); }
    if (state.remaining <= 0) submit(true);
  }
  function fmtTime(sec) { sec = Math.max(0, sec); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

  /* ---------------- persistence (resume) ---------------- */

  function notePrefix() { return `${state.loaded.meta.id}:${state.kind}:`; }
  function questionKey(i) { return `${state.loaded.meta.id}:${state.kind}:${state.questions[i].number}`; }

  function snapshot() {
    return {
      answers: state.answers, revealed: state.revealed, flags: [...state.flags],
      index: state.index, remaining: state.remaining,
      mode: state.mode, kind: state.kind,
      paperTitle: state.loaded.paper.topic || state.loaded.meta.title,
      answered: state.answers.filter(a => a !== null).length, total: state.questions.length,
      savedAt: Date.now()
    };
  }
  function autosave() {
    if (!state.sessionKey || !Backend.saveSession) return;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    const snap = snapshot();
    state.saveTimer = setTimeout(() => { Backend.saveSession(state.sessionKey, snap).catch(() => {}); }, 600);
  }

  /* ---------------- keyboard ---------------- */

  function onKey(e) {
    if (!state || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(input|textarea|select)$/i.test(document.activeElement?.tagName || '')) return;
    const q = state.questions[state.index];
    if (e.key === 'ArrowRight') return go(1);
    if (e.key === 'ArrowLeft') return go(-1);
    if (e.key.toLowerCase() === 'f' && state.mode === 'exam') return toggleFlag();
    const idx = LETTERS.indexOf(e.key.toUpperCase());
    const num = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    const pick = idx >= 0 ? idx : num;
    if (pick >= 0 && pick < q.options.length) choose(pick);
  }

  /* ---------------- render ---------------- */

  function render() {
    if (!state) return;
    const { questions, index, mode } = state;
    const q = questions[index];
    const answered = state.answers.filter(a => a !== null).length;
    const total = questions.length;
    const hasNote = !!state.notes[q.number];

    state.container.innerHTML = `
      <div class="quiz-shell" data-animate>
        <header class="quiz-head">
          <div>
            <span class="chip chip-${q.kind.toLowerCase()}">${q.kind}</span>
            <span class="chip chip-mode">${mode === 'study' ? 'STUDY' : 'EXAM'}</span>
            <h2 class="quiz-title">${esc(state.loaded.paper.topic || state.loaded.meta.title)}</h2>
            <p class="quiz-crumb">${esc(state.loaded.path.category?.title || '')}${state.loaded.path.topic ? ' · ' + esc(state.loaded.path.topic.title) : ''}</p>
          </div>
          <div class="quiz-head-right">
            ${mode === 'exam' && state.timeLimitSec ? `<div class="quiz-timer" id="quiz-timer">${fmtTime(state.remaining)}</div>` : ''}
            <button class="btn btn-ghost btn-sm" id="quiz-quit">Exit</button>
          </div>
        </header>

        <div class="quiz-progressbar"><span style="width:${(answered / total) * 100}%"></span></div>

        <div class="quiz-body">
          <main class="quiz-question" id="quiz-question">
            ${q.kind === 'EMQ' && q.theme ? `
              <div class="emq-theme"><h3>${esc(q.theme)}</h3>${q.instruction ? `<p>${esc(q.instruction)}</p>` : ''}</div>` : ''}
            <p class="q-number">Question ${index + 1} of ${total}</p>
            <p class="q-stem">${esc(q.stem)}</p>
            ${q.lead ? `<p class="q-lead">${esc(q.lead)}</p>` : ''}
            <div class="q-options ${q.kind === 'EMQ' ? 'q-options-emq' : ''}" id="q-options">
              ${q.options.map((opt, i) => optionHTML(q, i, opt)).join('')}
            </div>
            <div id="q-feedback"></div>
            <div id="q-note"></div>
          </main>

          ${navigatorHTML()}
        </div>

        <footer class="quiz-foot">
          <button class="btn btn-ghost" id="quiz-prev" ${index === 0 ? 'disabled' : ''}>← Previous</button>
          <div class="quiz-foot-mid">
            ${mode === 'exam'
              ? `<button class="btn btn-ghost btn-sm ${state.flags.has(index) ? 'flag-on' : ''}" id="quiz-flag">${state.flags.has(index) ? '⚑ Flagged' : '⚐ Flag'}</button>`
              : `<span class="study-score" id="study-score"></span>`}
            <button class="btn btn-ghost btn-sm ${hasNote ? 'note-on' : ''}" id="quiz-note">${hasNote ? '🗒 Note ✓' : '🗒 Note'}</button>
          </div>
          ${index < total - 1
            ? `<button class="btn btn-primary" id="quiz-next">Next →</button>`
            : `<button class="btn btn-gold" id="quiz-submit">${mode === 'study' ? 'Finish & see summary' : 'Submit paper'}</button>`}
        </footer>
      </div>`;

    state.container.querySelector('#q-options').addEventListener('click', e => {
      const btn = e.target.closest('.q-option'); if (btn && !btn.disabled) choose(Number(btn.dataset.idx));
    });
    state.container.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => goto(Number(b.dataset.goto))));
    state.container.querySelector('#quiz-prev')?.addEventListener('click', () => go(-1));
    state.container.querySelector('#quiz-next')?.addEventListener('click', () => go(1));
    state.container.querySelector('#quiz-submit')?.addEventListener('click', () => submit(false));
    state.container.querySelector('#quiz-flag')?.addEventListener('click', toggleFlag);
    state.container.querySelector('#quiz-note').addEventListener('click', toggleNoteEditor);
    state.container.querySelector('#quiz-quit').addEventListener('click', () => {
      const keep = confirm('Exit this set? Your progress is saved — you can resume it later from the paper page.');
      if (keep) { autosaveNow(); const q = state.onQuit; destroy(); q(); }
    });

    if (state.mode === 'study') updateStudyScore();
    if (state.revealed[index]) showFeedback();
    FX.questionSwap(state.container.querySelector('#quiz-question'), 1);
  }

  function optionHTML(q, i, opt) {
    const chosen = state.answers[state.index] === i;
    const revealed = state.revealed[state.index];
    let cls = 'q-option';
    if (chosen) cls += ' selected';
    if (revealed) { if (i === q.answer) cls += ' correct'; else if (chosen) cls += ' incorrect'; }
    const letter = q.preLettered ? '' : `<span class="q-letter">${LETTERS[i]}</span>`;
    const mark = revealed ? (i === q.answer ? '<span class="opt-mark good">✓</span>' : (chosen ? '<span class="opt-mark bad">✗</span>' : '')) : '';
    return `<button class="${cls}" data-idx="${i}" ${revealed ? 'disabled' : ''}>${letter}<span class="q-text">${esc(opt)}</span>${mark}</button>`;
  }

  function navigatorHTML() {
    return `
      <aside class="quiz-side">
        <div class="palette-card">
          <h4>Navigator</h4>
          <div class="palette-grid">
            ${state.questions.map((_, i) => `
              <button class="palette-cell
                ${i === state.index ? 'current' : ''}
                ${state.answers[i] !== null ? 'done' : ''}
                ${state.flags.has(i) ? 'flagged' : ''}
                ${state.notes[state.questions[i].number] ? 'noted' : ''}"
                data-goto="${i}" aria-label="Go to question ${i + 1}">${i + 1}</button>`).join('')}
          </div>
          <div class="palette-legend">
            <span><i class="dot dot-done"></i>${state.mode === 'study' ? 'Seen' : 'Answered'}</span>
            ${state.mode === 'exam' ? '<span><i class="dot dot-flag"></i>Flagged</span>' : ''}
            <span><i class="dot dot-note"></i>Note</span>
          </div>
        </div>
        <p class="quiz-hint">Keys: <kbd>A–H</kbd> answer · <kbd>←</kbd><kbd>→</kbd> move${state.mode === 'exam' ? ' · <kbd>F</kbd> flag' : ''}</p>
      </aside>`;
  }

  /* ---------------- interactions ---------------- */

  function choose(idx) {
    if (state.revealed[state.index]) return;
    state.answers[state.index] = idx;

    if (state.mode === 'study') {
      state.revealed[state.index] = true;
      const wrap = state.container.querySelector('#q-options');
      const q = state.questions[state.index];
      wrap.innerHTML = q.options.map((opt, i) => optionHTML(q, i, opt)).join('');
      showFeedback();
      updateStudyScore();
      state.container.querySelector(`[data-goto="${state.index}"]`)?.classList.add('done');
      FX.pulse(wrap.querySelector('.q-option.correct'));
    } else {
      state.container.querySelectorAll('.q-option').forEach((b, i) => b.classList.toggle('selected', i === idx));
      state.container.querySelector(`[data-goto="${state.index}"]`)?.classList.add('done');
      FX.pulse(state.container.querySelector('.q-option.selected'));
      const answered = state.answers.filter(a => a !== null).length;
      state.container.querySelector('.quiz-progressbar span').style.width = (answered / state.questions.length) * 100 + '%';
      if (state.index < state.questions.length - 1) setTimeout(() => { if (state && state.answers[state.index] === idx) go(1); }, 300);
    }
    autosave();
  }

  function showFeedback() {
    const i = state.index, q = state.questions[i];
    const chosen = state.answers[i];
    const isCorrect = chosen === q.answer;
    const box = state.container.querySelector('#q-feedback');
    box.innerHTML = `
      <div class="feedback ${isCorrect ? 'fb-correct' : 'fb-wrong'}">
        <p class="fb-verdict">${isCorrect ? '✓ Correct' : '✗ Not quite'} — answer is
          ${q.preLettered ? esc(q.options[q.answer]) : LETTERS[q.answer] + '. ' + esc(q.options[q.answer])}</p>
        ${q.rationale ? `<p class="fb-rationale">${esc(q.rationale)}</p>` : ''}
        ${q.hook ? `<p class="fb-hook">💡 ${esc(q.hook)}</p>` : ''}
        ${q.reference ? `<p class="fb-ref">§ ${esc(q.reference)}</p>` : ''}
        <div class="ai-slot" id="ai-slot"></div>
      </div>`;
    if (!isCorrect) FX.shake(box.querySelector('.feedback'));

    // mount the Explore-with-AI panel
    if (typeof AI !== "undefined" && (window.AUREUM_CONFIG?.ai?.enabled)) {
      AI.attach(box.querySelector('#ai-slot'), aiContext(i));
    }
  }

  function aiContext(i) {
    const q = state.questions[i];
    return {
      questionKey: questionKey(i),
      kind: q.kind, theme: q.theme || '', stem: q.stem, lead: q.lead || '',
      options: q.options, answer: q.answer, chosen: state.answers[i],
      rationale: q.rationale || '', hook: q.hook || '', reference: q.reference || '',
      paperTitle: state.loaded.paper.topic || state.loaded.meta.title, preLettered: q.preLettered
    };
  }

  function updateStudyScore() {
    const done = state.revealed.filter(Boolean).length;
    let correct = 0;
    state.revealed.forEach((r, i) => { if (r && state.answers[i] === state.questions[i].answer) correct++; });
    const el = state.container.querySelector('#study-score');
    if (el) el.innerHTML = done ? `Score so far: <strong>${correct}/${done}</strong>` : 'Pick an answer to see the explanation';
  }

  /* ---------------- notes ---------------- */

  function toggleNoteEditor() {
    const host = state.container.querySelector('#q-note');
    if (host.dataset.open === '1') { host.dataset.open = '0'; host.innerHTML = ''; return; }
    host.dataset.open = '1';
    const q = state.questions[state.index];
    const existing = state.notes[q.number] || '';
    host.innerHTML = `
      <div class="note-editor">
        <label>Your note for this question</label>
        <textarea id="note-text" placeholder="Jot a reminder, a mnemonic, why you got it wrong…">${esc(existing)}</textarea>
        <div class="note-actions">
          <button class="btn btn-primary btn-sm" id="note-save">Save note</button>
          ${existing ? '<button class="btn btn-ghost btn-sm" id="note-del">Delete</button>' : ''}
        </div>
      </div>`;
    host.querySelector('#note-save').addEventListener('click', async () => {
      const body = host.querySelector('#note-text').value.trim();
      state.notes[q.number] = body || undefined;
      if (!body) delete state.notes[q.number];
      try { await Backend.saveNote(questionKey(state.index), body); } catch {}
      host.dataset.open = '0'; host.innerHTML = '';
      render();
    });
    host.querySelector('#note-del')?.addEventListener('click', async () => {
      delete state.notes[q.number];
      try { await Backend.saveNote(questionKey(state.index), ''); } catch {}
      host.dataset.open = '0'; host.innerHTML = '';
      render();
    });
  }

  /* ---------------- navigation ---------------- */

  function toggleFlag() {
    if (state.flags.has(state.index)) state.flags.delete(state.index); else state.flags.add(state.index);
    autosave(); render();
  }
  function go(d) { goto(state.index + d); }
  function goto(i) { if (i >= 0 && i < state.questions.length) { state.index = i; autosave(); render(); } }

  function autosaveNow() { if (state?.sessionKey && Backend.saveSession) Backend.saveSession(state.sessionKey, snapshot()).catch(() => {}); }

  function submit(timedOut) {
    const { questions, answers } = state;
    if (state.mode === 'exam') {
      const unanswered = answers.filter(a => a === null).length;
      if (!timedOut && unanswered > 0 && !confirm(`${unanswered} question${unanswered > 1 ? 's' : ''} unanswered. Submit anyway?`)) return;
    }
    let correct = 0;
    const detail = questions.map((q, i) => { const ok = answers[i] === q.answer; if (ok) correct++; return { chosen: answers[i], correct: q.answer, isCorrect: ok }; });
    const meta = state.loaded.meta, path = state.loaded.path;
    const attempt = {
      paperId: meta.id, paperTitle: state.loaded.paper.topic || meta.title,
      kind: state.kind, studyMode: state.mode === 'study',
      categoryId: meta.categoryId, categoryTitle: path.category?.title || '',
      topicId: meta.topicId, topicTitle: path.topic?.title || '',
      date: new Date().toISOString(), durationSec: Math.round((Date.now() - state.startedAt) / 1000),
      timedOut: !!timedOut, total: questions.length, correct, percent: Math.round((correct / questions.length) * 100), detail
    };
    // clear the resume session — the paper is finished
    if (state.sessionKey && Backend.clearSession) Backend.clearSession(state.sessionKey).catch(() => {});
    const finish = state.onFinish;
    destroy();
    finish(attempt);
  }

  return { start, destroy, LETTERS, esc };
})();
