/* ============================================================
   review.js — spaced repetition on WRONG questions.

   Every SBA/EMQ a user gets wrong (library runs and simulator mocks
   alike) is automatically converted into a review item scheduled with
   the same SM-2 engine as the flashcards:
     wrong → due tomorrow;  answered right on review → interval grows;
     wrong again on review → back to tomorrow, ease drops.

   The dashboard shows how many items are due; "Review now" runs up to
   20 of them through the normal quiz UI in study mode. Available to
   every signed-in user — it's their own mistakes.
   ============================================================ */

const ReviewQueue = (() => {
  const esc = Quiz.esc;
  const today = () => new Date().toISOString().slice(0, 10);
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  const MAX_SESSION = 20;

  /* ---------- capture wrong answers from any finished attempt ---------- */

  async function addFromAttempt(attempt) {
    if (!Backend.saveReviewItem || attempt.studyMode === undefined && !attempt.detail) return;
    let existing = {};
    try { (await Backend.listReviewItems()).forEach(it => existing[it.question_key] = it); } catch { /* first run */ }
    for (const d of (attempt.detail || [])) {
      if (!d.qkey || d.excluded || d.isCorrect || d.chosen == null) continue;   // unanswered ≠ wrong knowledge
      const prev = existing[d.qkey];
      const item = {
        paperTitle: attempt.paperTitle || '',
        due: tomorrow(), interval: 1,
        ease: Math.max(1.3, (prev?.ease ?? 2.5) - (prev ? 0.2 : 0)),
        reps: 0, lapses: (prev?.lapses || 0) + (prev ? 1 : 0),
        wrongCount: (prev?.wrongCount || 0) + 1
      };
      try { await Backend.saveReviewItem(d.qkey, item); } catch { /* non-fatal */ }
    }
  }

  async function dueItems() {
    if (!Backend.listReviewItems) return [];
    let items = [];
    try { items = await Backend.listReviewItems(); } catch { return []; }
    const t = today();
    return items.filter(it => !it.due || it.due <= t);
  }

  /* ---------- resolve qkeys → renderable questions ---------- */

  async function resolve(qkeys) {
    const byPaper = {};
    qkeys.forEach(k => { const pid = String(k).split(':')[0]; (byPaper[pid] || (byPaper[pid] = [])).push(k); });
    const dict = {};
    for (const pid of Object.keys(byPaper)) {
      let loaded; try { loaded = await Data.loadPaper(pid); } catch { continue; }
      ['SBA', 'EMQ'].forEach(kind => Data.flatten(loaded.paper, kind).forEach(q => {
        dict[`${pid}:${kind}:${q.number}`] = { ...q, _qkey: `${pid}:${kind}:${q.number}`, _paperTitle: loaded.paper.topic || loaded.meta.title };
      }));
    }
    return dict;
  }

  /* ---------- the review session (#/review) ---------- */

  async function renderRun(view, user) {
    view.innerHTML = `<section class="page narrow"><header data-animate><p class="kicker">REVIEW QUEUE</p><h1 class="page-title">Loading your due questions…</h1></header></section>`;
    const due = (await dueItems()).sort((a, b) => (a.due || '') < (b.due || '') ? -1 : 1).slice(0, MAX_SESSION);
    if (!due.length) {
      view.innerHTML = `<section class="page narrow" data-animate>
        <div class="card fc-complete"><div class="fc-complete-ring">✓</div>
        <h2>Nothing due for review</h2>
        <p class="muted">Wrong answers from your sets appear here on their review date. Keep practising!</p>
        <a class="btn btn-gold" href="#/library">Open the library</a></div></section>`;
      return;
    }
    const dict = await resolve(due.map(it => it.question_key));
    const itemByKey = {}; due.forEach(it => itemByKey[it.question_key] = it);
    const questions = due.map(it => dict[it.question_key]).filter(Boolean).map((q, i) => ({ ...q, number: i + 1 }));
    if (!questions.length) {
      view.innerHTML = `<section class="page narrow" data-animate><p class="muted">The due questions belong to papers that are no longer published.</p><a class="btn btn-ghost" href="#/dashboard">Dashboard</a></section>`;
      return;
    }

    const loaded = {
      meta: { id: 'review-' + today(), title: 'Review queue', categoryId: null, topicId: null },
      paper: { topic: 'Review queue — questions you got wrong' },
      path: { category: { title: 'Spaced review' }, topic: null }
    };
    view.innerHTML = '';
    Quiz.start(view, loaded, questions, {
      mode: 'study', kind: 'MIX', sessionKey: null,
      onFinish: async (attempt) => {
        // reschedule each item by its outcome (uses the flashcards' SM-2)
        for (let i = 0; i < questions.length; i++) {
          const qk = questions[i]._qkey;
          const it = itemByKey[qk]; if (!it) continue;
          const d = attempt.detail[i] || {};
          try {
            if (d.isCorrect) {
              const next = Flashcards.schedule({ ease: it.ease, reps: it.reps, lapses: it.lapses, interval: it.interval }, 'good');
              if (next.interval >= 90) await Backend.removeReviewItem(qk);   // mastered — retire it
              else await Backend.saveReviewItem(qk, { paperTitle: it.paperTitle, due: next.due, interval: next.interval, ease: next.ease, reps: next.reps, lapses: next.lapses, wrongCount: it.wrongCount });
            } else {
              await Backend.saveReviewItem(qk, { paperTitle: it.paperTitle, due: tomorrow(), interval: 1, ease: Math.max(1.3, (it.ease || 2.5) - 0.2), reps: 0, lapses: (it.lapses || 0) + 1, wrongCount: (it.wrongCount || 1) + 1 });
            }
          } catch { /* keep going */ }
        }
        const summary = await Backend.recordAttempt(attempt);
        location.hash = '#/results/' + summary.attemptId;
      },
      onQuit: () => { location.hash = '#/dashboard'; }
    });
  }

  return { addFromAttempt, dueItems, renderRun };
})();
