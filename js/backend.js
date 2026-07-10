/* ============================================================
   backend.js — pluggable data layer.

   Two implementations behind one interface:
     • SupabaseBackend — cloud accounts + progress + published
       papers, shared across devices. Active when
       AUREUM_CONFIG.supabase.url / anonKey are set.
     • LocalBackend — browser localStorage. The zero-config
       fallback so the site runs immediately on any static host.

   The rest of the app talks only to `Backend.*` and never needs
   to know which one is live.

   Interface:
     Backend.mode                       'cloud' | 'local'
     await Backend.init()
     await Backend.signUp({name,email,password,position})
     await Backend.signIn(email, password)
     await Backend.signOut()
     await Backend.currentUser()        -> {id,name,email,position} | null
     await Backend.updateProfile(patch)
     await Backend.getProgress()        -> progress object
     await Backend.recordAttempt(att)   -> {xpGained,...}
     await Backend.getAttempt(id)
     await Backend.resetProgress()
     await Backend.getPublishedPapers() -> [paperMeta...]
     await Backend.publishPaper(meta)   -> stored meta
     await Backend.unpublishPaper(id)
   ============================================================ */

const Backend = (() => {
  const cfg = window.AUREUM_CONFIG || {};
  const useCloud = !!(cfg.supabase && cfg.supabase.url && cfg.supabase.anonKey);

  /* ---------------- shared helpers ---------------- */

  async function sha256(text) {
    if (window.crypto && crypto.subtle) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return 'fnv-' + (h >>> 0).toString(16);
  }
  function randomSalt() {
    const b = new Uint8Array(16);
    (crypto.getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => b[i] = (Math.random() * 256) | 0));
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const emailOK = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const norm = e => String(e || '').trim().toLowerCase();

  function blankProgress() {
    return { xp: 0, attempts: [], streak: { lastDay: null, count: 0 } };
  }
  function applyAttempt(progress, attempt) {
    const xpGained = attempt.correct * 10 + (attempt.percent === 100 ? 25 : 0);
    progress.xp = (progress.xp || 0) + xpGained;
    const today = new Date().toISOString().slice(0, 10);
    if (progress.streak.lastDay !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      progress.streak.count = progress.streak.lastDay === yesterday ? progress.streak.count + 1 : 1;
      progress.streak.lastDay = today;
    }
    attempt.id = 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    attempt.xpGained = xpGained;
    progress.attempts.unshift(attempt);
    if (progress.attempts.length > 500) progress.attempts.length = 500;
    return xpGained;
  }

  /* ================= LOCAL BACKEND ================= */

  const Local = (() => {
    const NS = 'aureum.';
    const read = (k, d) => { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
    const write = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; } catch { return false; } };
    const del = k => localStorage.removeItem(NS + k);

    const users = () => read('users', {});
    const sessionEmail = () => read('session', null)?.email || null;

    async function init() { /* nothing */ }

    async function signUp({ name, email, password, position }) {
      name = String(name || '').trim();
      email = norm(email);
      if (name.length < 2) throw new Error('Please enter your full name.');
      if (!emailOK(email)) throw new Error('Please enter a valid email address.');
      if (String(password).length < 8) throw new Error('Password must be at least 8 characters.');
      const all = users();
      if (all[email]) throw new Error('An account with this email already exists. Try signing in.');
      const salt = randomSalt();
      const passHash = await sha256(salt + password);
      all[email] = { id: email, name, email, position: position || 'Registrar', salt, passHash, createdAt: Date.now() };
      write('users', all);
      write('session', { email });
      return publicUser(all[email]);
    }

    async function signIn(email, password) {
      email = norm(email);
      const u = users()[email];
      if (!u) throw new Error('No account found for this email. Create one first.');
      if (await sha256(u.salt + password) !== u.passHash) throw new Error('Incorrect password. Please try again.');
      write('session', { email });
      return publicUser(u);
    }

    async function signOut() { del('session'); }

    async function currentUser() {
      const email = sessionEmail();
      const u = email ? users()[email] : null;
      return u ? publicUser(u) : null;
    }

    async function updateProfile(patch) {
      const email = sessionEmail();
      const all = users();
      if (!email || !all[email]) throw new Error('Not signed in.');
      Object.assign(all[email], patch);
      write('users', all);
      return publicUser(all[email]);
    }

    const pKey = email => 'progress.' + email;
    async function getProgress() {
      const email = sessionEmail();
      return email ? read(pKey(email), blankProgress()) : blankProgress();
    }
    async function recordAttempt(attempt) {
      const email = sessionEmail();
      const p = read(pKey(email), blankProgress());
      const xpGained = applyAttempt(p, attempt);
      write(pKey(email), p);
      return { xpGained, xpTotal: p.xp, streak: p.streak.count, attemptId: attempt.id };
    }
    async function getAttempt(id) {
      const p = await getProgress();
      return p.attempts.find(a => a.id === id) || null;
    }
    async function resetProgress() {
      const email = sessionEmail();
      if (email) del(pKey(email));
    }

    async function getPublishedPapers() { return read('published', []); }
    async function publishPaper(meta) {
      const list = read('published', []);
      const i = list.findIndex(p => p.id === meta.id);
      if (i >= 0) list[i] = meta; else list.push(meta);
      write('published', list);
      return meta;
    }
    async function unpublishPaper(id) {
      write('published', read('published', []).filter(p => p.id !== id));
    }

    function publicUser(u) { return { id: u.id, name: u.name, email: u.email, position: u.position, createdAt: u.createdAt }; }

    return { init, signUp, signIn, signOut, currentUser, updateProfile,
      getProgress, recordAttempt, getAttempt, resetProgress,
      getPublishedPapers, publishPaper, unpublishPaper };
  })();

  /* ================= SUPABASE BACKEND ================= */

  const Cloud = (() => {
    let sb = null;

    async function ensureClient() {
      if (sb) return sb;
      if (!window.supabase) await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js');
      sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);
      return sb;
    }
    function loadScript(src) {
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load Supabase library.'));
        document.head.appendChild(s);
      });
    }
    async function init() { await ensureClient(); }

    async function signUp({ name, email, password, position }) {
      await ensureClient();
      const { data, error } = await sb.auth.signUp({
        email: norm(email), password,
        options: { data: { name, position: position || 'Registrar' } }
      });
      if (error) throw new Error(error.message);
      // profile row (id = auth uid)
      if (data.user) {
        await sb.from('profiles').upsert({ id: data.user.id, name, email: norm(email), position: position || 'Registrar' });
      }
      return currentUser();
    }
    async function signIn(email, password) {
      await ensureClient();
      const { error } = await sb.auth.signInWithPassword({ email: norm(email), password });
      if (error) throw new Error(error.message);
      return currentUser();
    }
    async function signOut() { await ensureClient(); await sb.auth.signOut(); }

    async function currentUser() {
      await ensureClient();
      const { data } = await sb.auth.getUser();
      if (!data.user) return null;
      const { data: prof } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
      return {
        id: data.user.id,
        email: data.user.email,
        name: prof?.name || data.user.user_metadata?.name || data.user.email,
        position: prof?.position || data.user.user_metadata?.position || 'Registrar',
        createdAt: data.user.created_at
      };
    }
    async function updateProfile(patch) {
      await ensureClient();
      const { data } = await sb.auth.getUser();
      if (!data.user) throw new Error('Not signed in.');
      await sb.from('profiles').update(patch).eq('id', data.user.id);
      return currentUser();
    }

    async function getProgress() {
      await ensureClient();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return blankProgress();
      const { data: rows } = await sb.from('attempts').select('*').eq('user_id', u.user.id).order('created_at', { ascending: false });
      const { data: prof } = await sb.from('profiles').select('xp, streak_count, streak_last_day').eq('id', u.user.id).single();
      const attempts = (rows || []).map(r => ({ id: r.id, ...r.payload }));
      return {
        xp: prof?.xp || 0,
        streak: { count: prof?.streak_count || 0, lastDay: prof?.streak_last_day || null },
        attempts
      };
    }
    async function recordAttempt(attempt) {
      await ensureClient();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error('Not signed in.');
      const progress = await getProgress();
      const xpGained = applyAttempt(progress, attempt);           // updates progress + sets attempt.id
      await sb.from('attempts').insert({ id: attempt.id, user_id: u.user.id, payload: attempt });
      await sb.from('profiles').update({
        xp: progress.xp, streak_count: progress.streak.count, streak_last_day: progress.streak.lastDay
      }).eq('id', u.user.id);
      return { xpGained, xpTotal: progress.xp, streak: progress.streak.count, attemptId: attempt.id };
    }
    async function getAttempt(id) {
      await ensureClient();
      const { data } = await sb.from('attempts').select('*').eq('id', id).single();
      return data ? { id: data.id, ...data.payload } : null;
    }
    async function resetProgress() {
      await ensureClient();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return;
      await sb.from('attempts').delete().eq('user_id', u.user.id);
      await sb.from('profiles').update({ xp: 0, streak_count: 0, streak_last_day: null }).eq('id', u.user.id);
    }

    async function getPublishedPapers() {
      await ensureClient();
      const { data } = await sb.from('papers').select('*');
      return (data || []).map(r => r.meta);
    }
    async function publishPaper(meta) {
      await ensureClient();
      await sb.from('papers').upsert({ id: meta.id, meta });
      return meta;
    }
    async function unpublishPaper(id) {
      await ensureClient();
      await sb.from('papers').delete().eq('id', id);
    }

    return { init, signUp, signIn, signOut, currentUser, updateProfile,
      getProgress, recordAttempt, getAttempt, resetProgress,
      getPublishedPapers, publishPaper, unpublishPaper };
  })();

  const impl = useCloud ? Cloud : Local;
  return Object.assign({ mode: useCloud ? 'cloud' : 'local' }, impl);
})();
