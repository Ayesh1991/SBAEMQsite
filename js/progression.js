/* ============================================================
   progression.js — XP, levels and derived performance stats.
   Levels follow the O&G training ladder for a bit of theatre.
   ============================================================ */

const Progression = (() => {

  const LEVELS = [
    { xp: 0,    title: 'Medical Student',    emblem: '◇' },
    { xp: 150,  title: 'Foundation Doctor',  emblem: '◈' },
    { xp: 400,  title: 'ST1–2 Trainee',      emblem: '✦' },
    { xp: 800,  title: 'ST3–5 Registrar',    emblem: '✧' },
    { xp: 1400, title: 'ST6–7 Senior Registrar', emblem: '❖' },
    { xp: 2200, title: 'Post-CCT Fellow',    emblem: '✵' },
    { xp: 3200, title: 'Consultant',         emblem: '✹' },
    { xp: 4600, title: 'MRCOG Examiner',     emblem: '❂' }
  ];

  function levelFor(xp) {
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i;
    const level = LEVELS[idx];
    const next = LEVELS[idx + 1] || null;
    const span = next ? next.xp - level.xp : 1;
    const into = next ? xp - level.xp : span;
    return {
      index: idx,
      number: idx + 1,
      title: level.title,
      emblem: level.emblem,
      next,
      progress: next ? Math.min(1, into / span) : 1,
      xpIntoLevel: into,
      xpForNext: next ? next.xp - xp : 0
    };
  }

  /** Aggregate stats across attempts. */
  function summarise(progress) {
    const attempts = progress.attempts || [];
    let answered = 0, correct = 0;
    for (const a of attempts) { answered += a.total; correct += a.correct; }
    return {
      xp: progress.xp || 0,
      level: levelFor(progress.xp || 0),
      streak: progress.streak?.count || 0,
      setsCompleted: attempts.length,
      questionsAnswered: answered,
      accuracy: answered ? Math.round((correct / answered) * 100) : null
    };
  }

  /** Per-section accuracy, resolved through the manifest topic index. */
  function sectionAccuracy(progress, topicIdx) {
    const bySection = {};
    for (const a of progress.attempts || []) {
      const meta = topicIdx[a.topicId];
      if (!meta) continue;
      const key = meta.curriculum.id + '/' + meta.section.id;
      const s = bySection[key] || (bySection[key] = {
        label: meta.section.title,
        curriculum: meta.curriculum.title,
        correct: 0, total: 0
      });
      s.correct += a.correct;
      s.total += a.total;
    }
    return Object.values(bySection)
      .map(s => ({ ...s, percent: Math.round((s.correct / s.total) * 100) }))
      .sort((a, b) => b.total - a.total);
  }

  /** Chronological (oldest→newest) score series for the trend chart. */
  function scoreSeries(progress, limit = 20) {
    return (progress.attempts || [])
      .slice(0, limit)
      .map(a => ({ date: a.date, percent: a.percent, title: a.topicTitle, mode: a.mode }))
      .reverse();
  }

  return { LEVELS, levelFor, summarise, sectionAccuracy, scoreSeries };
})();
