/* ============================================================
   store.js — persistence layer (localStorage)
   Users, sessions and per-user performance live in the browser.
   Keys are namespaced under "aureum." to avoid collisions.
   ============================================================ */

const Store = (() => {
  const NS = 'aureum.';

  function read(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.warn('Store read failed for', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Store write failed for', key, e);
      return false;
    }
  }

  function remove(key) {
    localStorage.removeItem(NS + key);
  }

  /* ---------- users ---------- */

  function getUsers() {
    return read('users', {});
  }

  function saveUser(user) {
    const users = getUsers();
    users[user.email] = user;
    write('users', users);
  }

  function getUser(email) {
    return getUsers()[email] || null;
  }

  /* ---------- session ---------- */

  function getSession() {
    return read('session', null);
  }

  function setSession(email) {
    write('session', { email, since: Date.now() });
  }

  function clearSession() {
    remove('session');
  }

  /* ---------- per-user progress ---------- */

  function progressKey(email) {
    return 'progress.' + email;
  }

  function getProgress(email) {
    return read(progressKey(email), {
      xp: 0,
      attempts: [],            // most recent first
      streak: { lastDay: null, count: 0 },
      flaggedQuestions: []
    });
  }

  function saveProgress(email, progress) {
    write(progressKey(email), progress);
  }

  /** Record a finished attempt and update xp + streak. Returns summary. */
  function recordAttempt(email, attempt) {
    const p = getProgress(email);

    const xpGained = attempt.correct * 10 + (attempt.percent === 100 ? 25 : 0);
    p.xp += xpGained;

    // streak: consecutive calendar days with at least one completed set
    const today = new Date().toISOString().slice(0, 10);
    if (p.streak.lastDay !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      p.streak.count = p.streak.lastDay === yesterday ? p.streak.count + 1 : 1;
      p.streak.lastDay = today;
    }

    attempt.id = 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    attempt.xpGained = xpGained;
    p.attempts.unshift(attempt);
    if (p.attempts.length > 400) p.attempts.length = 400; // cap history

    saveProgress(email, p);
    return { xpGained, xpTotal: p.xp, streak: p.streak.count, attemptId: attempt.id };
  }

  function getAttempt(email, attemptId) {
    return getProgress(email).attempts.find(a => a.id === attemptId) || null;
  }

  /** Best score + attempt count per topic id. */
  function topicStats(email) {
    const stats = {};
    for (const a of getProgress(email).attempts) {
      const s = stats[a.topicId] || (stats[a.topicId] = { attempts: 0, best: 0, last: null });
      s.attempts += 1;
      if (a.percent > s.best) s.best = a.percent;
      if (!s.last) s.last = a; // attempts are newest-first
    }
    return stats;
  }

  return {
    read, write, remove,
    getUsers, saveUser, getUser,
    getSession, setSession, clearSession,
    getProgress, saveProgress, recordAttempt, getAttempt, topicStats
  };
})();
