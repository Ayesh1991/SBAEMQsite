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

    async function listAllNotes() { const e = sessionEmail(); if (!e) return []; const n = read(nKey(e), {}); return Object.entries(n).map(([question_key, body]) => ({ question_key, body })); }

    /* custom curriculum */
    async function getCustomCurriculum() { return read('curriculum', { categories: [] }); }
    async function saveCustomCurriculum(data) { write('curriculum', data); }

    /* AI saves (chats, charts, infographics, mind maps, summaries) */
    const aKey = e => 'aisaves.' + e;
    const newId = () => 'ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    async function saveAiItem(item) {
      const e = sessionEmail(); if (!e) return null;
      const list = read(aKey(e), []);
      const rec = { id: newId(), questionKey: item.questionKey || null, paperTitle: item.paperTitle || '', kind: item.kind, title: item.title || '', content: item.content || '', mime: item.mime || 'text/plain', created: Date.now() };
      list.unshift(rec); if (list.length > 1000) list.length = 1000; write(aKey(e), list); return rec;
    }
    async function saveAiChat(questionKey, messages, paperTitle) {
      const e = sessionEmail(); if (!e) return null;
      const list = read(aKey(e), []);
      const i = list.findIndex(x => x.kind === 'chat' && x.questionKey === questionKey);
      const rec = { id: i >= 0 ? list[i].id : newId(), questionKey, paperTitle: paperTitle || (i >= 0 ? list[i].paperTitle : ''), kind: 'chat', title: 'Conversation', content: JSON.stringify(messages || []), mime: 'application/json', created: i >= 0 ? list[i].created : Date.now(), updated: Date.now() };
      if (i >= 0) list[i] = rec; else list.unshift(rec); write(aKey(e), list); return rec;
    }
    async function listAiItems(questionKey) { const e = sessionEmail(); if (!e) return []; const list = read(aKey(e), []); return questionKey ? list.filter(x => x.questionKey === questionKey) : list; }
    async function deleteAiItem(id) { const e = sessionEmail(); if (!e) return; write(aKey(e), read(aKey(e), []).filter(x => x.id !== id)); }

    /* question edits (developer flag + explanation override) — global on this device */
    async function getQuestionEdit(qk) { const m = read('qedits', {}); return m[qk] || null; }
    async function saveQuestionEdit(qk, patch) {
      const m = read('qedits', {}); m[qk] = Object.assign({}, m[qk], patch, { updated: Date.now() });
      if (!m[qk].flagged && !m[qk].flag_note && !m[qk].explanation) delete m[qk];
      write('qedits', m); return m[qk] || null;
    }

    /* per-user question edits (personal flag / correction) + simulator exclusion */
    const uqKey = e => 'uqedits.' + e;
    async function getUserQuestionEdit(qk) { const e = sessionEmail(); if (!e) return null; return read(uqKey(e), {})[qk] || null; }
    async function saveUserQuestionEdit(qk, patch) {
      const e = sessionEmail(); if (!e) return null;
      const m = read(uqKey(e), {});
      m[qk] = Object.assign({}, m[qk], patch, { updated: Date.now() });
      if (!m[qk].flagged && !m[qk].flag_note && !m[qk].explanation && !m[qk].excluded) delete m[qk];
      write(uqKey(e), m); return m[qk] || null;
    }
    async function listExcludedQuestions() { const e = sessionEmail(); if (!e) return []; const m = read(uqKey(e), {}); return Object.keys(m).filter(qk => m[qk].excluded); }

    /* flashcards — decks are global (developer-published); SRS progress is per-user */
    async function getFlashcardDecks() { return read('decks', []); }
    async function publishFlashcardDeck(meta) { const l = read('decks', []); const i = l.findIndex(d => d.id === meta.id); if (i >= 0) l[i] = meta; else l.push(meta); write('decks', l); return meta; }
    async function unpublishFlashcardDeck(id) { write('decks', read('decks', []).filter(d => d.id !== id)); }
    const cpKey = e => 'cardprog.' + e;
    async function getCardProgress(deckId) { const e = sessionEmail(); if (!e) return {}; return read(cpKey(e), {})[deckId] || {}; }
    async function saveCardProgress(deckId, cardId, s) { const e = sessionEmail(); if (!e) return; const m = read(cpKey(e), {}); (m[deckId] || (m[deckId] = {}))[cardId] = s; write(cpKey(e), m); }
    async function listAllCardProgress() { const e = sessionEmail(); if (!e) return {}; return read(cpKey(e), {}); }

    /* blueprint — single global doc (developer-editable) */
    async function getBlueprint() { return read('blueprint', null); }
    async function saveBlueprint(doc) { write('blueprint', doc); return doc; }

    /* adaptive-simulator mock results — per-user */
    const mKey = e => 'mocks.' + e;
    async function saveMockResult(result) { const e = sessionEmail(); if (!e) return null; const l = read(mKey(e), []); result.id = result.id || ('mock-' + Date.now().toString(36)); l.unshift(result); if (l.length > 200) l.length = 200; write(mKey(e), l); return result; }
    async function listMockResults() { const e = sessionEmail(); if (!e) return []; return read(mKey(e), []); }
    async function getMockResult(id) { return (await listMockResults()).find(m => m.id === id) || null; }

    /* AI (local mode has no server function — the app disables AI in local) */
    async function getAccessToken() { return null; }

    function publicUser(u) { return { id: u.id, name: u.name, email: u.email, position: u.position, createdAt: u.createdAt, isDeveloper: norm(u.email) === devEmail }; }

    return { init, signUp, signIn, signOut, currentUser, updateProfile,
      getProgress, recordAttempt, getAttempt, resetProgress,
      getPublishedPapers, publishPaper, unpublishPaper,
      getExamDate, setExamDate, saveSession, loadSession, clearSession, listSessions,
      getNote, saveNote, getNotesForPaper, listAllNotes, getCustomCurriculum, saveCustomCurriculum,
      saveAiItem, saveAiChat, listAiItems, deleteAiItem, getQuestionEdit, saveQuestionEdit,
      getUserQuestionEdit, saveUserQuestionEdit, listExcludedQuestions,
      getFlashcardDecks, publishFlashcardDeck, unpublishFlashcardDeck,
      getCardProgress, saveCardProgress, listAllCardProgress,
      getBlueprint, saveBlueprint, saveMockResult, listMockResults, getMockResult, getAccessToken };
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
    async function listAllNotes() { await ensureClient(); const id = await uid(); if (!id) return []; const { data } = await sb.from('notes').select('question_key, body').eq('user_id', id); return data || []; }

    /* custom curriculum */
    async function getCustomCurriculum() { await ensureClient(); const { data } = await sb.from('curriculum').select('data').eq('id', 'default').single(); return data?.data || { categories: [] }; }
    async function saveCustomCurriculum(data) { await ensureClient(); await sb.from('curriculum').upsert({ id: 'default', data, updated_at: new Date().toISOString() }); }

    /* AI saves (chats, charts, infographics, mind maps, summaries) */
    const newId = () => 'ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    function mapAi(r) { return { id: r.id, questionKey: r.question_key, paperTitle: r.paper_title, kind: r.kind, title: r.title, content: r.content, mime: r.mime, created: r.created_at }; }
    async function saveAiItem(item) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const rec = { id: newId(), user_id: id, question_key: item.questionKey || null, paper_title: item.paperTitle || '', kind: item.kind, title: item.title || '', content: item.content || '', mime: item.mime || 'text/plain' };
      try { await sb.from('ai_saves').insert(rec); } catch {}
      return mapAi(rec);
    }
    async function saveAiChat(questionKey, messages, paperTitle) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const content = JSON.stringify(messages || []);
      const { data: ex } = await sb.from('ai_saves').select('id').eq('user_id', id).eq('question_key', questionKey).eq('kind', 'chat').limit(1);
      if (ex && ex.length) { await sb.from('ai_saves').update({ content, paper_title: paperTitle || '', created_at: new Date().toISOString() }).eq('id', ex[0].id); return { id: ex[0].id }; }
      const rec = { id: newId(), user_id: id, question_key: questionKey, paper_title: paperTitle || '', kind: 'chat', title: 'Conversation', content, mime: 'application/json' };
      await sb.from('ai_saves').insert(rec); return mapAi(rec);
    }
    async function listAiItems(questionKey) {
      await ensureClient(); const id = await uid(); if (!id) return [];
      let q = sb.from('ai_saves').select('*').eq('user_id', id).order('created_at', { ascending: false });
      if (questionKey) q = q.eq('question_key', questionKey);
      const { data } = await q; return (data || []).map(mapAi);
    }
    async function deleteAiItem(id) { await ensureClient(); const u = await uid(); if (!u) return; await sb.from('ai_saves').delete().eq('id', id).eq('user_id', u); }

    /* question edits (developer flag + explanation override) */
    async function getQuestionEdit(qk) {
      await ensureClient();
      const { data } = await sb.from('question_edits').select('*').eq('question_key', qk).single();
      return data ? { flagged: !!data.flagged, flag_note: data.flag_note || '', explanation: data.explanation || '', updated: data.updated_at } : null;
    }
    async function saveQuestionEdit(qk, patch) {
      await ensureClient();
      const u = await currentUser();
      const row = Object.assign({ question_key: qk }, patch, { updated_by: u?.email || null, updated_at: new Date().toISOString() });
      await sb.from('question_edits').upsert(row);
      return getQuestionEdit(qk);
    }

    /* per-user question edits (personal flag / correction) + simulator exclusion */
    function mapUqe(d) { return d ? { flagged: !!d.flagged, flag_note: d.flag_note || '', explanation: d.explanation || '', excluded: !!d.excluded, updated: d.updated_at } : null; }
    async function getUserQuestionEdit(qk) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const { data } = await sb.from('user_question_edits').select('*').eq('user_id', id).eq('question_key', qk).single();
      return mapUqe(data);
    }
    async function saveUserQuestionEdit(qk, patch) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const row = Object.assign({ user_id: id, question_key: qk }, patch, { updated_at: new Date().toISOString() });
      await sb.from('user_question_edits').upsert(row, { onConflict: 'user_id,question_key' });
      return getUserQuestionEdit(qk);
    }
    async function listExcludedQuestions() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data } = await sb.from('user_question_edits').select('question_key').eq('user_id', id).eq('excluded', true);
      return (data || []).map(r => r.question_key);
    }

    /* flashcards — decks global (dev-published), SRS progress per-user */
    async function getFlashcardDecks() { await ensureClient(); const { data } = await sb.from('flashcard_decks').select('*'); return (data || []).map(r => r.meta); }
    async function publishFlashcardDeck(meta) { await ensureClient(); await sb.from('flashcard_decks').upsert({ id: meta.id, meta }); return meta; }
    async function unpublishFlashcardDeck(id) { await ensureClient(); await sb.from('flashcard_decks').delete().eq('id', id); }
    async function getCardProgress(deckId) {
      await ensureClient(); const id = await uid(); if (!id) return {};
      const { data } = await sb.from('flashcard_progress').select('*').eq('user_id', id).eq('deck_id', deckId);
      const out = {}; (data || []).forEach(r => out[r.card_id] = { due: r.due, interval: r.interval, ease: r.ease, reps: r.reps, lapses: r.lapses, updated: r.updated_at }); return out;
    }
    async function saveCardProgress(deckId, cardId, s) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('flashcard_progress').upsert({ user_id: id, deck_id: deckId, card_id: String(cardId), due: s.due, interval: s.interval, ease: s.ease, reps: s.reps, lapses: s.lapses || 0, updated_at: new Date().toISOString() }, { onConflict: 'user_id,deck_id,card_id' });
    }
    async function listAllCardProgress() {
      await ensureClient(); const id = await uid(); if (!id) return {};
      const { data } = await sb.from('flashcard_progress').select('deck_id,card_id,due,interval,ease,reps,lapses').eq('user_id', id);
      const out = {}; (data || []).forEach(r => { (out[r.deck_id] || (out[r.deck_id] = {}))[r.card_id] = { due: r.due, interval: r.interval, ease: r.ease, reps: r.reps, lapses: r.lapses }; }); return out;
    }

    /* blueprint — single global doc (dev-editable) */
    async function getBlueprint() { await ensureClient(); const { data } = await sb.from('app_config').select('data').eq('id', 'blueprint').single(); return data?.data || null; }
    async function saveBlueprint(doc) { await ensureClient(); await sb.from('app_config').upsert({ id: 'blueprint', data: doc, updated_at: new Date().toISOString() }); return doc; }

    /* adaptive-simulator mock results — per-user */
    async function saveMockResult(result) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      result.id = result.id || ('mock-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      await sb.from('mock_results').insert({ id: result.id, user_id: id, payload: result }); return result;
    }
    async function listMockResults() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data } = await sb.from('mock_results').select('id,payload').eq('user_id', id).order('created_at', { ascending: false });
      return (data || []).map(r => ({ id: r.id, ...r.payload }));
    }
    async function getMockResult(mid) {
      await ensureClient();
      const { data } = await sb.from('mock_results').select('id,payload').eq('id', mid).single();
      return data ? { id: data.id, ...data.payload } : null;
    }

    /* AI auth token for the Cloudflare function */
    async function getAccessToken() { await ensureClient(); const { data } = await sb.auth.getSession(); return data.session?.access_token || null; }

    return { init, signUp, signIn, signOut, currentUser, updateProfile,
      getProgress, recordAttempt, getAttempt, resetProgress,
      getPublishedPapers, publishPaper, unpublishPaper,
      getExamDate, setExamDate, saveSession, loadSession, clearSession, listSessions,
      getNote, saveNote, getNotesForPaper, listAllNotes, getCustomCurriculum, saveCustomCurriculum,
      saveAiItem, saveAiChat, listAiItems, deleteAiItem, getQuestionEdit, saveQuestionEdit,
      getUserQuestionEdit, saveUserQuestionEdit, listExcludedQuestions,
      getFlashcardDecks, publishFlashcardDeck, unpublishFlashcardDeck,
      getCardProgress, saveCardProgress, listAllCardProgress,
      getBlueprint, saveBlueprint, saveMockResult, listMockResults, getMockResult, getAccessToken };
  })();

  const impl = useCloud ? Cloud : Local;
  return Object.assign({ mode: useCloud ? 'cloud' : 'local' }, impl);
})();
