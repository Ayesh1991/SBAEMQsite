/* ============================================================
   quiz.js — the SBA / EMQ runner.
   Renders one question at a time with a navigator palette,
   flagging, optional countdown timer and keyboard shortcuts
   (1–9/A–T select · ←/→ navigate · F flag). EMQ stems carry
   their theme's full option list, exam-style.
   ============================================================ */

const Quiz = (() => {
  let state = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }
  const LETTERS = 'ABCDEFGHIJKLMNOPQRST';

  /**
   * Mount a quiz into `container`.
   * loaded: result of Data.loadSet(topicId)
   * onFinish(attempt): called with the completed attempt record.
   * onQuit(): called when the candidate abandons the set.
   */
  function start(container, loaded, { onFinish, onQuit }) {
    state = {
      container, loaded, onFinish, onQuit,
      questions: loaded.questions,
      answers: new Array(loaded.questions.length).fill(null),
      flags: new Set(),
      index: 0,
      startedAt: Date.now(),
      timeLimitSec: (loaded.set.timeLimitMinutes || 0) * 60,
      timerId: null,
      remaining: null
    };
    if (state.timeLimitSec > 0) {
      state.remaining = state.timeLimitSec;
      state.timerId = setInterval(tick, 1000);
    }
    document.addEventListener('keydown', onKey);
    render();
  }

  function destroy() {
    if (state?.timerId) clearInterval(state.timerId);
    document.removeEventListener('keydown', onKey);
    state = null;
  }

  function tick() {
    state.remaining -= 1;
    const t = state.container.querySelector('#quiz-timer');
    if (t) {
      t.textContent = fmtTime(state.remaining);
      t.classList.toggle('timer-low', state.remaining <= 60);
    }
    if (state.remaining <= 0) submit(true);
  }

  function fmtTime(sec) {
    sec = Math.max(0, sec);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function onKey(e) {
    if (!state || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(input|textarea|select)$/i.test(document.activeElement?.tagName || '')) return;
    const q = state.questions[state.index];
    if (e.key === 'ArrowRight') { go(1); }
    else if (e.key === 'ArrowLeft') { go(-1); }
    else if (e.key.toLowerCase() === 'f') { toggleFlag(); }
    else {
      const letterIdx = LETTERS.indexOf(e.key.toUpperCase());
      const numIdx = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
      const idx = q.kind === 'EMQ' ? letterIdx : (numIdx !== -1 ? numIdx : letterIdx);
      if (idx >= 0 && idx < q.options.length) choose(idx);
    }
  }

  /* ---------------- rendering ---------------- */

  function render() {
    const { loaded, questions, index } = state;
    const q = questions[index];
    const answered = state.answers.filter(a => a !== null).length;

    state.container.innerHTML = `
      <div class="quiz-shell" data-animate>
        <header class="quiz-head">
          <div>
            <span class="chip chip-${q.kind.toLowerCase()}">${q.kind}</span>
            <h2 class="quiz-title">${esc(loaded.set.title)}</h2>
            <p class="quiz-crumb">${esc(loaded.curriculum.title)} · ${esc(loaded.section.title)}</p>
          </div>
          <div class="quiz-head-right">
            ${state.timeLimitSec ? `<div class="quiz-timer" id="quiz-timer">${fmtTime(state.remaining)}</div>` : ''}
            <button class="btn btn-ghost btn-sm" id="quiz-quit">Exit set</button>
          </div>
        </header>

        <div class="quiz-progressbar"><span style="width:${(answered / questions.length) * 100}%"></span></div>

        <div class="quiz-body">
          <main class="quiz-question" id="quiz-question">
            ${q.kind === 'EMQ' ? `
              <div class="emq-theme">
                <h3>${esc(q.theme)}</h3>
                ${q.instructions ? `<p>${esc(q.instructions)}</p>` : ''}
              </div>` : ''}
            <p class="q-number">Question ${index + 1} of ${questions.length}</p>
            <p class="q-stem">${esc(q.stem)}</p>
            <div class="q-options ${q.kind === 'EMQ' ? 'q-options-emq' : ''}" id="q-options">
              ${q.options.map((opt, i) => `
                <button class="q-option ${state.answers[index] === i ? 'selected' : ''}" data-idx="${i}">
                  <span class="q-letter">${LETTERS[i]}</span>
                  <span class="q-text">${esc(opt)}</span>
                </button>`).join('')}
            </div>
          </main>

          <aside class="quiz-side">
            <div class="palette-card">
              <h4>Navigator</h4>
              <div class="palette-grid">
                ${questions.map((_, i) => `
                  <button class="palette-cell
                    ${i === index ? 'current' : ''}
                    ${state.answers[i] !== null ? 'done' : ''}
                    ${state.flags.has(i) ? 'flagged' : ''}"
                    data-goto="${i}" aria-label="Go to question ${i + 1}">${i + 1}</button>`).join('')}
              </div>
              <div class="palette-legend">
                <span><i class="dot dot-done"></i>Answered</span>
                <span><i class="dot dot-flag"></i>Flagged</span>
              </div>
            </div>
            <p class="quiz-hint">Keys: <kbd>A–E</kbd> answer · <kbd>←</kbd><kbd>→</kbd> move · <kbd>F</kbd> flag</p>
          </aside>
        </div>

        <footer class="quiz-foot">
          <button class="btn btn-ghost" id="quiz-prev" ${index === 0 ? 'disabled' : ''}>← Previous</button>
          <button class="btn btn-ghost ${state.flags.has(index) ? 'flag-on' : ''}" id="quiz-flag">
            ${state.flags.has(index) ? '⚑ Flagged' : '⚐ Flag'}
          </button>
          ${index < questions.length - 1
            ? `<button class="btn btn-primary" id="quiz-next">Next →</button>`
            : `<button class="btn btn-gold" id="quiz-submit">Submit set</button>`}
        </footer>
      </div>`;

    // events
    state.container.querySelector('#q-options').addEventListener('click', e => {
      const btn = e.target.closest('.q-option');
      if (btn) choose(Number(btn.dataset.idx));
    });
    state.container.querySelectorAll('[data-goto]').forEach(b =>
      b.addEventListener('click', () => goto(Number(b.dataset.goto))));
    state.container.querySelector('#quiz-prev')?.addEventListener('click', () => go(-1));
    state.container.querySelector('#quiz-next')?.addEventListener('click', () => go(1));
    state.container.querySelector('#quiz-submit')?.addEventListener('click', () => submit(false));
    state.container.querySelector('#quiz-flag').addEventListener('click', toggleFlag);
    state.container.querySelector('#quiz-quit').addEventListener('click', () => {
      if (confirm('Leave this set? Your answers in this run will not be saved.')) {
        const quit = state.onQuit;
        destroy();
        quit();
      }
    });

    FX.questionSwap(state.container.querySelector('#quiz-question'), 1);
  }

  /* ---------------- interactions ---------------- */

  function choose(idx) {
    state.answers[state.index] = idx;
    state.container.querySelectorAll('.q-option').forEach((b, i) =>
      b.classList.toggle('selected', i === idx));
    const cell = state.container.querySelector(`[data-goto="${state.index}"]`);
    cell?.classList.add('done');
    FX.pulse(state.container.querySelector('.q-option.selected'));
    const answered = state.answers.filter(a => a !== null).length;
    state.container.querySelector('.quiz-progressbar span').style.width =
      (answered / state.questions.length) * 100 + '%';
    // auto-advance after a beat, exam-flow style
    if (state.index < state.questions.length - 1) {
      setTimeout(() => { if (state && state.answers[state.index] === idx) go(1); }, 320);
    }
  }

  function toggleFlag() {
    if (state.flags.has(state.index)) state.flags.delete(state.index);
    else state.flags.add(state.index);
    render();
  }

  function go(dir) { goto(state.index + dir); }

  function goto(i) {
    if (i < 0 || i >= state.questions.length) return;
    state.index = i;
    render();
  }

  function submit(timedOut) {
    const unanswered = state.answers.filter(a => a === null).length;
    if (!timedOut && unanswered > 0 &&
        !confirm(`You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?`)) {
      return;
    }
    const { loaded, questions, answers } = state;
    let correct = 0;
    const detail = questions.map((q, i) => {
      const isCorrect = answers[i] === q.answer;
      if (isCorrect) correct += 1;
      return { chosen: answers[i], correct: q.answer, isCorrect };
    });

    const attempt = {
      topicId: loaded.topic.id,
      topicTitle: loaded.set.title,
      curriculumId: loaded.curriculum.id,
      sectionId: loaded.section.id,
      mode: loaded.set.mode,
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
