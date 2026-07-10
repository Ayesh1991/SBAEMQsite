/* ============================================================
   quiz.js — the SBA / EMQ runner, two modes:

     • 'exam'  — timed (optional), no feedback until submission,
                 with a question navigator and flagging. Mirrors
                 the real paper.
     • 'study' — no timer; after you pick an answer the correct
                 answer, rationale and memory hook appear
                 immediately, then you advance. Mirrors the
                 original review-as-you-go HTML app.

   EMQ options in ogr-paper-v1 already carry an "A." prefix, so
   when q.preLettered is true the letter chip is suppressed.
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
   * opts: { mode:'exam'|'study', kind:'SBA'|'EMQ', timeLimitMinutes, onFinish, onQuit }
   */
  function start(container, loaded, questions, opts) {
    state = {
      container, loaded, questions,
      mode: opts.mode === 'study' ? 'study' : 'exam',
      kind: opts.kind,
      answers: new Array(questions.length).fill(null),
      revealed: new Array(questions.length).fill(false),
      flags: new Set(),
      index: 0,
      startedAt: Date.now(),
      onFinish: opts.onFinish,
      onQuit: opts.onQuit,
      timeLimitSec: state_timeLimit(opts),
      timerId: null,
      remaining: null
    };
    if (state.mode === 'exam' && state.timeLimitSec > 0) {
      state.remaining = state.timeLimitSec;
      state.timerId = setInterval(tick, 1000);
    }
    document.addEventListener('keydown', onKey);
    render();
  }

  function state_timeLimit(opts) {
    if (opts.mode === 'study') return 0;
    if (Number.isFinite(opts.timeLimitMinutes)) return opts.timeLimitMinutes * 60;
    return 0;
  }

  function destroy() {
    if (state?.timerId) clearInterval(state.timerId);
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
    const { questions, index, mode } = state;
    const q = questions[index];
    const answered = state.answers.filter(a => a !== null).length;
    const total = questions.length;

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

        <div class="quiz-body ${mode === 'study' ? 'quiz-body-study' : ''}">
          <main class="quiz-question" id="quiz-question">
            ${q.kind === 'EMQ' && q.theme ? `
              <div class="emq-theme">
                <h3>${esc(q.theme)}</h3>
                ${q.instruction ? `<p>${esc(q.instruction)}</p>` : ''}
              </div>` : ''}
            <p class="q-number">Question ${index + 1} of ${total}</p>
            <p class="q-stem">${esc(q.stem)}</p>
            ${q.lead ? `<p class="q-lead">${esc(q.lead)}</p>` : ''}
            <div class="q-options ${q.kind === 'EMQ' ? 'q-options-emq' : ''}" id="q-options">
              ${q.options.map((opt, i) => optionHTML(q, i, opt)).join('')}
            </div>
            <div id="q-feedback"></div>
          </main>

          ${mode === 'exam' ? navigatorHTML() : ''}
        </div>

        <footer class="quiz-foot">
          <button class="btn btn-ghost" id="quiz-prev" ${index === 0 ? 'disabled' : ''}>← Previous</button>
          ${mode === 'exam'
            ? `<button class="btn btn-ghost ${state.flags.has(index) ? 'flag-on' : ''}" id="quiz-flag">
                 ${state.flags.has(index) ? '⚑ Flagged' : '⚐ Flag'}
               </button>`
            : `<span class="study-score" id="study-score"></span>`}
          ${index < total - 1
            ? `<button class="btn btn-primary" id="quiz-next">Next →</button>`
            : `<button class="btn btn-gold" id="quiz-submit">${mode === 'study' ? 'Finish & see summary' : 'Submit paper'}</button>`}
        </footer>
      </div>`;

    // wire events
    state.container.querySelector('#q-options').addEventListener('click', e => {
      const btn = e.target.closest('.q-option');
      if (btn && !btn.disabled) choose(Number(btn.dataset.idx));
    });
    state.container.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => goto(Number(b.dataset.goto))));
    state.container.querySelector('#quiz-prev')?.addEventListener('click', () => go(-1));
    state.container.querySelector('#quiz-next')?.addEventListener('click', () => go(1));
    state.container.querySelector('#quiz-submit')?.addEventListener('click', () => submit(false));
    state.container.querySelector('#quiz-flag')?.addEventListener('click', toggleFlag);
    state.container.querySelector('#quiz-quit').addEventListener('click', () => {
      if (confirm('Leave this set? Progress in this run will not be saved.')) { const q = state.onQuit; destroy(); q(); }
    });

    if (state.mode === 'study') updateStudyScore();
    if (state.revealed[index]) showFeedback();     // returning to an already-answered study question
    FX.questionSwap(state.container.querySelector('#quiz-question'), 1);
  }

  function optionHTML(q, i, opt) {
    const chosen = state.answers[state.index] === i;
    const revealed = state.revealed[state.index];
    let cls = 'q-option';
    if (chosen) cls += ' selected';
    if (revealed) {
      if (i === q.answer) cls += ' correct';
      else if (chosen) cls += ' incorrect';
    }
    const letter = q.preLettered ? '' : `<span class="q-letter">${LETTERS[i]}</span>`;
    const mark = revealed ? (i === q.answer ? '<span class="opt-mark good">✓</span>' : (chosen ? '<span class="opt-mark bad">✗</span>' : '')) : '';
    return `<button class="${cls}" data-idx="${i}" ${revealed ? 'disabled' : ''}>
      ${letter}<span class="q-text">${esc(opt)}</span>${mark}
    </button>`;
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
                ${state.flags.has(i) ? 'flagged' : ''}"
                data-goto="${i}" aria-label="Go to question ${i + 1}">${i + 1}</button>`).join('')}
          </div>
          <div class="palette-legend">
            <span><i class="dot dot-done"></i>Answered</span>
            <span><i class="dot dot-flag"></i>Flagged</span>
          </div>
        </div>
        <p class="quiz-hint">Keys: <kbd>A–H</kbd> answer · <kbd>←</kbd><kbd>→</kbd> move · <kbd>F</kbd> flag</p>
      </aside>`;
  }

  /* ---------------- interactions ---------------- */

  function choose(idx) {
    if (state.revealed[state.index]) return;         // locked in study mode after reveal
    state.answers[state.index] = idx;

    if (state.mode === 'study') {
      state.revealed[state.index] = true;
      // repaint options with correct/incorrect styling
      const wrap = state.container.querySelector('#q-options');
      const q = state.questions[state.index];
      wrap.innerHTML = q.options.map((opt, i) => optionHTML(q, i, opt)).join('');
      showFeedback();
      updateStudyScore();
      const sel = wrap.querySelector('.q-option.correct');
      if (sel) FX.pulse(sel);
    } else {
      state.container.querySelectorAll('.q-option').forEach((b, i) => b.classList.toggle('selected', i === idx));
      state.container.querySelector(`[data-goto="${state.index}"]`)?.classList.add('done');
      FX.pulse(state.container.querySelector('.q-option.selected'));
      const answered = state.answers.filter(a => a !== null).length;
      state.container.querySelector('.quiz-progressbar span').style.width = (answered / state.questions.length) * 100 + '%';
      if (state.index < state.questions.length - 1) {
        setTimeout(() => { if (state && state.answers[state.index] === idx) go(1); }, 300);
      }
    }
  }

  function showFeedback() {
    const q = state.questions[state.index];
    const chosen = state.answers[state.index];
    const isCorrect = chosen === q.answer;
    const box = state.container.querySelector('#q-feedback');
    box.innerHTML = `
      <div class="feedback ${isCorrect ? 'fb-correct' : 'fb-wrong'}">
        <p class="fb-verdict">${isCorrect ? '✓ Correct' : '✗ Not quite'} — answer is
          ${q.preLettered ? esc(q.options[q.answer]) : LETTERS[q.answer] + '. ' + esc(q.options[q.answer])}</p>
        ${q.rationale ? `<p class="fb-rationale">${esc(q.rationale)}</p>` : ''}
        ${q.hook ? `<p class="fb-hook">💡 ${esc(q.hook)}</p>` : ''}
        ${q.reference ? `<p class="fb-ref">§ ${esc(q.reference)}</p>` : ''}
      </div>`;
    if (!isCorrect) FX.shake(box.querySelector('.feedback'));
  }

  function updateStudyScore() {
    const done = state.revealed.filter(Boolean).length;
    let correct = 0;
    state.revealed.forEach((r, i) => { if (r && state.answers[i] === state.questions[i].answer) correct++; });
    const el = state.container.querySelector('#study-score');
    if (el) el.innerHTML = done ? `Score so far: <strong>${correct}/${done}</strong>` : 'Pick an answer to see the explanation';
  }

  function toggleFlag() {
    if (state.flags.has(state.index)) state.flags.delete(state.index); else state.flags.add(state.index);
    render();
  }
  function go(d) { goto(state.index + d); }
  function goto(i) { if (i >= 0 && i < state.questions.length) { state.index = i; render(); } }

  function submit(timedOut) {
    const { questions, answers } = state;
    if (state.mode === 'exam') {
      const unanswered = answers.filter(a => a === null).length;
      if (!timedOut && unanswered > 0 && !confirm(`${unanswered} question${unanswered > 1 ? 's' : ''} unanswered. Submit anyway?`)) return;
    }
    let correct = 0;
    const detail = questions.map((q, i) => {
      const ok = answers[i] === q.answer;
      if (ok) correct++;
      return { chosen: answers[i], correct: q.answer, isCorrect: ok };
    });
    const meta = state.loaded.meta, path = state.loaded.path;
    const attempt = {
      paperId: meta.id,
      paperTitle: state.loaded.paper.topic || meta.title,
      kind: state.kind,                 // 'SBA' | 'EMQ'
      studyMode: state.mode === 'study',
      categoryId: meta.categoryId,
      categoryTitle: path.category?.title || '',
      topicId: meta.topicId,
      topicTitle: path.topic?.title || '',
      date: new Date().toISOString(),
      durationSec: Math.round((Date.now() - state.startedAt) / 1000),
      timedOut: !!timedOut,
      total: questions.length,
      correct,
      percent: Math.round((correct / questions.length) * 100),
      detail
    };
    const finish = state.onFinish;
    destroy();
    finish(attempt);
  }

  return { start, destroy, LETTERS, esc };
})();
