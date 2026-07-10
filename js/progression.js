/* ============================================================
   progression.js — XP, mastery tiers and derived analytics.
   Tiers are neutral mastery ranks (NOT UK training grades) — a
   candidate's clinical grade (Registrar / Senior Registrar) is a
   separate profile field.
   ============================================================ */

const Progression = (() => {

  const TIERS = [
    { xp: 0,    title: 'Foundation',   emblem: '◇' },
    { xp: 200,  title: 'Bronze',       emblem: '◈' },
    { xp: 500,  title: 'Silver',       emblem: '✦' },
    { xp: 1000, title: 'Gold',         emblem: '✧' },
    { xp: 1800, title: 'Platinum',     emblem: '❖' },
    { xp: 3000, title: 'Diamond',      emblem: '✵' },
    { xp: 4800, title: 'Distinction',  emblem: '❂' }
  ];

  const POSITIONS = ['Registrar', 'Senior Registrar'];

  function tierFor(xp) {
    let idx = 0;
    for (let i = 0; i < TIERS.length; i++) if (xp >= TIERS[i].xp) idx = i;
    const tier = TIERS[idx];
    const next = TIERS[idx + 1] || null;
    const span = next ? next.xp - tier.xp : 1;
    const into = next ? xp - tier.xp : span;
    return {
      index: idx, number: idx + 1, title: tier.title, emblem: tier.emblem, next,
      progress: next ? Math.min(1, into / span) : 1,
      xpForNext: next ? next.xp - xp : 0
    };
  }

  function summarise(progress) {
    const attempts = progress.attempts || [];
    let answered = 0, correct = 0;
    for (const a of attempts) { answered += a.total; correct += a.correct; }
    return {
      xp: progress.xp || 0,
      tier: tierFor(progress.xp || 0),
      streak: progress.streak?.count || 0,
      setsCompleted: attempts.length,
      questionsAnswered: answered,
      accuracy: answered ? Math.round((correct / answered) * 100) : null
    };
  }

  /** Per-category accuracy across attempts. */
  function categoryAccuracy(progress) {
    const by = {};
    for (const a of progress.attempts || []) {
      const key = a.categoryTitle || a.categoryId || 'Other';
      const s = by[key] || (by[key] = { label: key, correct: 0, total: 0 });
      s.correct += a.correct; s.total += a.total;
    }
    return Object.values(by)
      .map(s => ({ ...s, percent: Math.round((s.correct / s.total) * 100) }))
      .sort((a, b) => b.total - a.total);
  }

  /** Chronological score series (oldest→newest) for the trend chart. */
  function scoreSeries(progress, limit = 20) {
    return (progress.attempts || [])
      .slice(0, limit)
      .map(a => ({ date: a.date, percent: a.percent, title: a.paperTitle, mode: a.kind }))
      .reverse();
  }

  /** Best score + attempt count keyed by "paperId:kind" (SBA vs EMQ tracked separately). */
  function paperStats(progress) {
    const stats = {};
    for (const a of progress.attempts || []) {
      const key = a.paperId + ':' + a.kind;
      const s = stats[key] || (stats[key] = { attempts: 0, best: 0, last: null });
      s.attempts += 1;
      if (a.percent > s.best) s.best = a.percent;
      if (!s.last) s.last = a;
    }
    return stats;
  }

  return { TIERS, POSITIONS, tierFor, summarise, categoryAccuracy, scoreSeries, paperStats };
})();
