/* ============================================================
   backend.js — pluggable data layer.

   Two implementations behind one interface:
     • Cloud (Supabase) — accounts, progress, published papers,
       resume sessions, notes, custom curriculum, AI cache/usage.
       Active when AUREUM_CONFIG.supabase.url / anonKey are set.
     • Local (localStorage) — zero-config fallback for any static host.

   The app talks only to Backend.* and never needs to know which is live.
   ============================================================ */

const Backend = (() => {
  const cfg = window.AUREUM_CONFIG || {};
  const useCloud = !!(cfg.supabase && cfg.supabase.url && cfg.supabase.anonKey);
  const devEmail = (cfg.developer && cfg.developer.email || '').toLowerCase();

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

  function blankProgress() { return { xp: 0, attempts: [], streak: { lastDay: null, count: 0 } }; }
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

    async function init() {}

    async function signUp({ name, email, password, position }) {
      name = String(name || '').trim(); email = norm(email);
      if (name.length < 2) throw new Error('Please enter your full name.');
      if (!emailOK(email)) throw new Error('Please enter a valid email address.');
      if (String(password).length < 8) throw new Error('Password must be at least 8 characters.');
      const all = users();
      if (all[email]) throw new Error('An account with this email already exists. Try signing in.');
      const salt = randomSalt();
      all[email] = { id: email, name, email, position: position || 'Registrar', salt, passHash: await sha256(salt + password), createdAt: Date.now() };
      write('users', all); write('session', { email });
      return { user: publicUser(all[email]), needsConfirmation: false };
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
      const email = sessionEmail(); const u = email ? users()[email] : null;
      return u ? publicUser(u) : null;
    }
    async function updateProfile(patch) {
      const email = sessionEmail(); const all = users();
      if (!email || !all[email]) throw new Error('Not signed in.');
      Object.assign(all[email], patch); write('users', all);
      return publicUser(all[email]);
    }

    const pKey = e => 'progress.' + e;
    async function getProgress() { const e = sessionEmail(); return e ? read(pKey(e), blankProgress()) : blankProgress(); }
    async function recordAttempt(attempt) {
      const e = sessionEmail(); const p = read(pKey(e), blankProgress());
      const xpGained = applyAttempt(p, attempt); write(pKey(e), p);
      return { xpGained, xpTotal: p.xp, streak: p.streak.count, attemptId: attempt.id };
    }
    async function getAttempt(id) { return (await getProgress()).attempts.find(a => a.id === id) || null; }
    async function resetProgress() { const e = sessionEmail(); if (e) del(pKey(e)); }

    async function getPublishedPapers() { return read('published', []); }
    async function publishPaper(meta) {
      const list = read('published', []); const i = list.findIndex(p => p.id === meta.id);
      if (i >= 0) list[i] = meta; else list.push(meta); write('published', list); return meta;
    }
    async function unpublishPaper(id) { write('published', read('published', []).filter(p => p.id !== id)); }

    /* exam date */
    async function getExamDate() { const e = sessionEmail(); return (e && users()[e]?.examDate) || null; }
    async function setExamDate(iso) { const e = sessionEmail(); if (e) { const all = users(); all[e].examDate = iso; write('users', all); } }

    /* resume sessions */
    const sKey = e => 'sessions.' + e;
    async function saveSession(key, state) { const e = sessionEmail(); if (!e) return; const s = read(sKey(e), {}); s[key] = { state, updated: Date.now() }; write(sKey(e), s); }
    async function loadSession(key) { const e = sessionEmail(); return e ? (read(sKey(e), {})[key]?.state || null) : null; }
    async function clearSession(key) { const e = sessionEmail(); if (!e) return; const s = read(sKey(e), {}); delete s[key]; write(sKey(e), s); }
    async function listSessions() { const e = sessionEmail(); if (!e) return []; const s = read(sKey(e), {}); return Object.entries(s).map(([key, v]) => ({ key, updated: v.updated, state: v.state })); }

    /* notes */
    const nKey = e => 'notes.' + e;
    async function getNote(qk) { const e = sessionEmail(); return e ? (read(nKey(e), {})[qk] || null) : null; }
    async function saveNote(qk, body) { const e = sessionEmail(); if (!e) return; const n = read(nKey(e), {}); if (body) n[qk] = body; else delete n[qk]; write(nKey(e), n); }
    async function getNotesForPaper(prefix) { const e = sessionEmail(); if (!e) return {}; const n = read(nKey(e), {}); const out = {}; for (const k in n) if (k.startsWith(prefix)) out[k] = n[k]; return out; }

    /* custom curriculum */
    async function getCustomCurriculum() { return read('curriculum', { categories: [] }); }
    async function saveCustomCurriculum(data) { write('curriculum', data); }

    /* AI (local mode has no server function — the app disables AI in local) */
    async function getAccessToken() { return null; }

    function publicUser(u) { return { id: u.id, name: u.name, email: u.email, position: u.position, createdAt: u.createdAt, isDeveloper: norm(u.email) === devEmail }; }

    return { init, signUp, signIn, signOut, currentUser, updateProfile,
      getProgress, recordAttempt, getAttempt, resetProgress,
      getPublishedPapers, publishPaper, unpublishPaper,
      getExamDate, setExamDate, saveSession, loadSession, clearSession, listSessions,
      getNote, saveNote, getNotesForPaper, getCustomCurriculum, saveCustomCurriculum, getAccessToken };
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
      return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load Supabase library.')); document.head.appendChild(s); });
    }
    async function uid() { const { data } = await sb.auth.getUser(); return data.user ? data.user.id : null; }
    async function init() { await ensureClient(); }

    async function signUp({ name, email, password, position }) {
      await ensureClient();
      const { data, error } = await sb.auth.signUp({ email: norm(email), password, options: { data: { name, position: position || 'Registrar' } } });
      if (error) throw new Error(error.message);
      const needsConfirmation = !data.session;      // Supabase returns no session when email confirmation is required
      if (data.session && data.user) {              // signed in immediately (confirmation off)
        try { await sb.from('profiles').upsert({ id: data.user.id, name, email: norm(email), position: position || 'Registrar' }); } catch {}
        return { user: await currentUser(), needsConfirmation: false };
      }
      return { user: null, needsConfirmation };     // must verify email before first sign-in
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
        id: data.user.id, email: data.user.email,
        name: prof?.name || data.user.user_metadata?.name || data.user.email,
        position: prof?.position || data.user.user_metadata?.position || 'Registrar',
        examDate: prof?.exam_date || null,
        createdAt: data.user.created_at,
        isDeveloper: norm(data.user.email) === devEmail
      };
    }
    async function updateProfile(patch) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      await sb.from('profiles').update(patch).eq('id', id);
      return currentUser();
    }

    async function getProgress() {
      await ensureClient(); const id = await uid(); if (!id) return blankProgress();
      const { data: rows } = await sb.from('attempts').select('*').eq('user_id', id).order('created_at', { ascending: false });
      const { data: prof } = await sb.from('profiles').select('xp, streak_count, streak_last_day').eq('id', id).single();
      return { xp: prof?.xp || 0, streak: { count: prof?.streak_count || 0, lastDay: prof?.streak_last_day || null }, attempts: (rows || []).map(r => ({ id: r.id, ...r.payload })) };
    }
    async function recordAttempt(attempt) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      const progress = await getProgress();
      const xpGained = applyAttempt(progress, attempt);
      await sb.from('attempts').insert({ id: attempt.id, user_id: id, payload: attempt });
      await sb.from('profiles').update({ xp: progress.xp, streak_count: progress.streak.count, streak_last_day: progress.streak.lastDay }).eq('id', id);
      return { xpGained, xpTotal: progress.xp, streak: progress.streak.count, attemptId: attempt.id };
    }
    async function getAttempt(id) {
      await ensureClient();
      const { data } = await sb.from('attempts').select('*').eq('id', id).single();
      return data ? { id: data.id, ...data.payload } : null;
    }
    async function resetProgress() {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('attempts').delete().eq('user_id', id);
      await sb.from('profiles').update({ xp: 0, streak_count: 0, streak_last_day: null }).eq('id', id);
    }

    async function getPublishedPapers() { await ensureClient(); const { data } = await sb.from('papers').select('*'); return (data || []).map(r => r.meta); }
    async function publishPaper(meta) { await ensureClient(); await sb.from('papers').upsert({ id: meta.id, meta }); return meta; }
    async function unpublishPaper(id) { await ensureClient(); await sb.from('papers').delete().eq('id', id); }

    /* exam date */
    async function getExamDate() { const u = await currentUser(); return u?.examDate || null; }
    async function setExamDate(iso) { await updateProfile({ exam_date: iso }); }

    /* resume sessions */
    async function saveSession(key, state) { await ensureClient(); const id = await uid(); if (!id) return; await sb.from('sessions').upsert({ user_id: id, key, state, updated_at: new Date().toISOString() }); }
    async function loadSession(key) { await ensureClient(); const id = await uid(); if (!id) return null; const { data } = await sb.from('sessions').select('state').eq('user_id', id).eq('key', key).single(); return data?.state || null; }
    async function clearSession(key) { await ensureClient(); const id = await uid(); if (!id) return; await sb.from('sessions').delete().eq('user_id', id).eq('key', key); }
    async function listSessions() { await ensureClient(); const id = await uid(); if (!id) return []; const { data } = await sb.from('sessions').select('key, state, updated_at').eq('user_id', id).order('updated_at', { ascending: false }); return (data || []).map(r => ({ key: r.key, updated: r.updated_at, state: r.state })); }

    /* notes */
    async function getNote(qk) { await ensureClient(); const id = await uid(); if (!id) return null; const { data } = await sb.from('notes').select('body').eq('user_id', id).eq('question_key', qk).single(); return data?.body || null; }
    async function saveNote(qk, body) { await ensureClient(); const id = await uid(); if (!id) return; if (body) await sb.from('notes').upsert({ user_id: id, question_key: qk, body, updated_at: new Date().toISOString() }); else await sb.from('notes').delete().eq('user_id', id).eq('question_key', qk); }
    async function getNotesForPaper(prefix) { await ensureClient(); const id = await uid(); if (!id) return {}; const { data } = await sb.from('notes').select('question_key, body').eq('user_id', id).like('question_key', prefix + '%'); const out = {}; (data || []).forEach(r => out[r.question_key] = r.body); return out; }

    /* custom curriculum */
    async function getCustomCurriculum() { await ensureClient(); const { data } = await sb.from('curriculum').select('data').eq('id', 'default').single(); return data?.data || { categories: [] }; }
    async function saveCustomCurriculum(data) { await ensureClient(); await sb.from('curriculum').upsert({ id: 'default', data, updated_at: new Date().toISOString() }); }

    /* AI auth token for the Cloudflare function */
    async function getAccessToken() { await ensureClient(); const { data } = await sb.auth.getSession(); return data.session?.access_token || null; }

    return { init, signUp, signIn, signOut, currentUser, updateProfile,
      getProgress, recordAttempt, getAttempt, resetProgress,
      getPublishedPapers, publishPaper, unpublishPaper,
      getExamDate, setExamDate, saveSession, loadSession, clearSession, listSessions,
      getNote, saveNote, getNotesForPaper, getCustomCurriculum, saveCustomCurriculum, getAccessToken };
  })();

  const impl = useCloud ? Cloud : Local;
  return Object.assign({ mode: useCloud ? 'cloud' : 'local' }, impl);
})();
