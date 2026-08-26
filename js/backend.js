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

  /* ---------- OSCE: a station's CARD vs the station itself ----------
     A station carries its scenario, every question and every marking point.
     The bank only needs enough to draw a card, so the counts are computed
     ONCE at publish time and stored alongside; the list then never has to
     ship the questions to tell you how many there are. */
  function withOsceCounts(meta) {
    const qs = meta.questions || [];
    return Object.assign({}, meta, {
      q_count: qs.length,
      points_count: qs.reduce((n, q) => n + (q.marking_points || []).length, 0),
      // the FILES live in storage; this is only so the bank can show a badge
      image_count: qs.reduce((n, q) => n + (q.images || []).length, 0),
      // one lowercased blob so the bank can be searched without the structure
      search: [meta.topic, meta.scenario, ...qs.map(q => q.prompt), ...qs.flatMap(q => q.marking_points || [])]
        .join(' ').toLowerCase().slice(0, 4000)
    });
  }
  const OSCE_CARD_KEYS = ['id', 'topic', 'scenario', 'station_time_min', 'reading_time_min',
    'total_marks', 'pass_mark', 'pass_mark_percent', 'q_count', 'points_count', 'image_count', 'collection',
    // the blueprint tag travels on the card: the circuit builder and the
    // coverage map both need it, and neither should pull whole stations
    'bp', 'edited_by', 'edited_at'];
  const osceCard = m => { const o = {}; OSCE_CARD_KEYS.forEach(k => { if (m[k] != null) o[k] = m[k]; }); return o; };
  /* ---------- Case discussions: the same card/document split ----------
     A case carries every phase's expectations and every viva question WITH
     its model answer. That is exactly what must not be shipped to the bank
     page — partly for weight, and partly because the bank is browsable
     before you sit the case and the model answers are the answers. */
  function withCaseCounts(meta) {
    const ph = meta.phases || [], qs = meta.questions || [];
    return Object.assign({}, meta, {
      phase_count: ph.length,
      q_count: qs.length,
      point_count: ph.reduce((n, p) => n + (p.expect || []).length, 0)
        + qs.reduce((n, q) => n + (q.mustHit || []).length, 0),
      minutes: Number(meta.minutes) || ph.reduce((n, p) => n + (Number(p.minutes) || 0), 0) || 30,
      /* Searchable on the topic and the VIGNETTE only. Putting the model
         answers in the search blob would let the bank's own search box
         become a way to read them. */
      search: [meta.topic, meta.vignette, (meta.sources || []).join(' ')]
        .join(' ').toLowerCase().slice(0, 2000)
    });
  }
  const CASE_CARD_KEYS = ['id', 'topic', 'vignette', 'minutes', 'phase_count', 'q_count',
    'point_count', 'sources', 'collection', 'search', 'edited_by', 'edited_at'];
  const caseCard = m => { const o = {}; CASE_CARD_KEYS.forEach(k => { if (m[k] != null) o[k] = m[k]; }); return o; };
  /** A discussion row for a LIST: the score and whether it was ever marked. */
  const caseAttemptCard = a => ({
    id: a.id, case_id: a.case_id, created: a.created || 0,
    topic: a.case?.topic || '', minutes: a.case?.minutes || 0,
    status: a.status || (a.result ? 'marked' : 'unmarked'),
    result: a.result ? { percent: a.result.percent, total: a.result.total, max: a.result.max, pass: !!a.result.pass } : null
  });

  /** An attempt row for a LIST: the score, never the answers. */
  const osceAttemptCard = a => ({
    id: a.id, station_id: a.station_id, created: a.created || 0,
    topic: a.station?.topic || '', passMark: a.station?.pass_mark ?? null,
    result: { percent: a.result?.percent, total: a.result?.total, max: a.result?.max, pass: !!a.result?.pass }
  });

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
    async function requestPasswordReset() { throw new Error('Password recovery by email works on the deployed (cloud) site.'); }
    async function updatePassword(newPassword) {
      const e = sessionEmail(); const all = users();
      if (!e || !all[e]) throw new Error('Not signed in.');
      if (String(newPassword).length < 8) throw new Error('Password must be at least 8 characters.');
      const salt = randomSalt();
      all[e].salt = salt; all[e].passHash = await sha256(salt + newPassword);
      write('users', all);
    }
    function onPasswordRecovery() {}
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
    async function addXp(points) {
      const e = sessionEmail(); if (!e || !points) return;
      const pr = read(pKey(e), blankProgress()); pr.xp = (pr.xp || 0) + points; write(pKey(e), pr);
    }
    async function resetProgress() { const e = sessionEmail(); if (e) del(pKey(e)); }

    /* The list is a CATALOGUE: light metadata only. `content` — every question
       of every paper — is fetched per paper, or in one go by the few features
       that genuinely need the whole bank. Mirrors the cloud impl exactly. */

    /* ---- OSCE stations + attempts ---- */
    async function getOsceStations() { return read('oscestations', []).map(osceCard); }
    async function getOsceSearchIndex() { return read('oscestations', []).map(x => ({ id: x.id, search: x.search || '' })); }
    async function getOsceStation(id) { return read('oscestations', []).find(x => x.id === id) || null; }
    async function publishOsceStation(meta) {
      const rec = withOsceCounts(meta);
      const e = sessionEmail(); if (e) { rec.edited_by = e; rec.edited_at = Date.now(); }
      const l = read('oscestations', []); const i = l.findIndex(x => x.id === rec.id); if (i >= 0) l[i] = rec; else l.push(rec);
      write('oscestations', l); return rec;
    }
    async function unpublishOsceStation(id) { write('oscestations', read('oscestations', []).filter(x => x.id !== id)); }
    /** Move stations into a bin. `ids` null/empty = every station. */
    async function moveOsceStations(ids, collection) {
      const want = ids && ids.length ? new Set(ids) : null;
      const l = read('oscestations', []); let n = 0;
      l.forEach(s => { if (!want || want.has(s.id)) { s.collection = collection; n++; } });
      write('oscestations', l); return n;
    }
    async function getGroqConfig() { return read('groqcfg', {}); }
    async function saveGroqConfig(c) { write('groqcfg', c); return c; }
    async function getOsceCollections() { return read('oscecollections', null); }
    async function saveOsceCollections(list) { write('oscecollections', list); return list; }
    async function getOsceBlueprint() { return read('osceblueprint', null); }
    async function saveOsceBlueprint(b) { write('osceblueprint', b); return b; }
    /** Write a blueprint tag onto stations without touching anything else. */
    async function tagOsceStations(map) {
      const l = read('oscestations', []); let n = 0;
      l.forEach(s => { if (map[s.id]) { s.bp = map[s.id]; n++; } });
      write('oscestations', l); return n;
    }
    async function listOsceDecks() { const e = sessionEmail(); if (!e) return []; return read('oscedecks:' + e, []); }
    async function saveOsceDeck(d) {
      const e = sessionEmail(); if (!e) return d;
      const l = read('oscedecks:' + e, []); const i = l.findIndex(x => x.id === d.id);
      if (i >= 0) l[i] = d; else l.unshift(d);
      write('oscedecks:' + e, l); return d;
    }
    async function deleteOsceDeck(id) {
      const e = sessionEmail(); if (!e) return;
      write('oscedecks:' + e, read('oscedecks:' + e, []).filter(x => x.id !== id));
    }
    /* ---- case discussions ----
       A case is a whole document (vignette, phases, questions with model
       answers), so the LIST is a card and the case itself is fetched only
       when one is opened — the same split as the OSCE bank, and for the
       same reason: the bank page must not download every model answer. */
    async function getCases() { return read('cases', []).map(caseCard); }
    async function getCase(id) { return read('cases', []).find(x => x.id === id) || null; }
    async function publishCase(meta) {
      const rec = withCaseCounts(meta);
      const e = sessionEmail(); if (e) { rec.edited_by = e; rec.edited_at = Date.now(); }
      const l = read('cases', []); const i = l.findIndex(x => x.id === rec.id);
      if (i >= 0) l[i] = rec; else l.push(rec);
      write('cases', l); return rec;
    }
    async function unpublishCase(id) { write('cases', read('cases', []).filter(x => x.id !== id)); }
    async function listCaseAttempts() { const e = sessionEmail(); if (!e) return []; return Object.values(read('caseattempts:' + e, {})).map(caseAttemptCard); }
    async function getCaseAttempt(id) { const e = sessionEmail(); if (!e) return null; return read('caseattempts:' + e, {})[id] || null; }
    async function saveCaseAttempt(a) { const e = sessionEmail(); if (!e) return a; const m = read('caseattempts:' + e, {}); m[a.id] = a; write('caseattempts:' + e, m); return a; }
    async function deleteCaseAttempt(id) { const e = sessionEmail(); if (!e) return; const m = read('caseattempts:' + e, {}); delete m[id]; write('caseattempts:' + e, m); }
    /* Local mode has no object store. The tape stays in the browser's own
       IndexedDB queue instead, so nothing is silently lost — it simply is
       not in the cloud, which is true and is said on screen. */
    async function uploadCaseAudio() { return null; }
    async function getCaseAudioUrl() { return null; }
    async function sweepCaseAudio() { return 0; }

    async function listOsceAttempts() { const e = sessionEmail(); if (!e) return []; return Object.values(read('osceattempts:' + e, {})).map(osceAttemptCard); }
    async function getOsceAttempt(id) { const e = sessionEmail(); if (!e) return null; return read('osceattempts:' + e, {})[id] || null; }
    async function saveOsceAttempt(a) { const e = sessionEmail(); if (!e) return a; const m = read('osceattempts:' + e, {}); m[a.id] = a; write('osceattempts:' + e, m); return a; }
    async function deleteOsceAttempt(id) { const e = sessionEmail(); if (!e) return; const m = read('osceattempts:' + e, {}); delete m[id]; write('osceattempts:' + e, m); }

    /* Local mode has no object store, so an image is kept as a data URL. That
       is fine for one device; the cloud path puts the bytes in storage and
       keeps only a path on the question. */
    async function uploadOsceImage(stationId, file) {
      const url = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error('Could not read that image.'));
        fr.readAsDataURL(file);
      });
      return { path: url, url };
    }
    function osceImageUrl(path) { return path || ''; }
    async function deleteOsceImage() { /* nothing to delete: the data URL went with the question */ }

    async function uploadOsceAudio(attemptId, blob) {
      const e = sessionEmail(); if (!e) return null;
      const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
      const m = read('osceaudio:' + e, {});
      m[attemptId] = { url: b64, at: Date.now() };
      write('osceaudio:' + e, m);
      return { path: attemptId, expires: Date.now() + 24 * 3600e3 };
    }
    async function getOsceAudioUrl(attemptId) { const e = sessionEmail(); if (!e) return null; return read('osceaudio:' + e, {})[attemptId]?.url || null; }
    async function sweepOsceAudio() {
      const e = sessionEmail(); if (!e) return 0;
      const m = read('osceaudio:' + e, {}); let n = 0;
      Object.keys(m).forEach(k => { if (Date.now() - (m[k].at || 0) > 24 * 3600e3) { delete m[k]; n++; } });
      if (n) write('osceaudio:' + e, m);
      return n;
    }

    /* ---- prepaid wallet ---- */
    async function getWalletConfig() { return read('walletcfg', { usdRate: 340, minTopUp: 300, packs: [300, 500, 1000, 2000] }); }
    async function saveWalletConfig(c) { write('walletcfg', c); return c; }
    async function listMyTopUps() { const e = sessionEmail(); if (!e) return []; return read('topups:' + e, []); }
    async function createTopUp(t) { const e = sessionEmail(); if (!e) throw new Error('Sign in first.');
      const l = read('topups:' + e, []); const row = Object.assign({ id: 't-' + Date.now().toString(36), created_at: new Date().toISOString(), user_email: e }, t);
      l.push(row); write('topups:' + e, l); const all = read('topupsall', []); all.push(row); write('topupsall', all); return row; }
    async function listAllTopUps() { return read('topupsall', []); }
    /** Developer credit for someone else — no slip, approved on the spot. */
    async function createTopUpFor(userId, t) {
      const all = users();
      const u = Object.values(all).find(x => x.id === userId || x.email === userId);
      const email = u ? u.email : userId;
      const row = Object.assign({ id: 't-' + Date.now().toString(36), created_at: new Date().toISOString(),
        user_email: email, user_id: u?.id || userId, status: 'approved', manual: true }, t);
      const l = read('topups:' + email, []); l.push(row); write('topups:' + email, l);
      const list = read('topupsall', []); list.push(row); write('topupsall', list);
      return row;
    }
    async function setTopUpStatus(id, status, note, extracted) {
      const stamp = r => { r.status = status; r.note = note || ''; if (extracted) r.extracted = extracted; };
      const all = read('topupsall', []); const r = all.find(x => x.id === id); if (r) { stamp(r); write('topupsall', all); }
      if (r?.user_email) { const l = read('topups:' + r.user_email, []); const m = l.find(x => x.id === id); if (m) { stamp(m); write('topups:' + r.user_email, l); } }
      return r; }
    async function getPublishedPapers() { return read('published', []).map(({ content, ...card }) => card); }
    async function getPaperContent(id) { const p = read('published', []).find(x => x.id === id); return p ? (p.content || null) : null; }
    async function getPaperContents() { return read('published', []).map(p => ({ id: p.id, content: p.content || null })); }
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

    /* review queue — wrong SBA/EMQ scheduled for spaced review */
    const rvKey = e => 'review.' + e;
    async function listReviewItems() { const e = sessionEmail(); if (!e) return []; const m = read(rvKey(e), {}); return Object.entries(m).map(([question_key, s]) => ({ question_key, ...s })); }
    async function saveReviewItem(qk, s) { const e = sessionEmail(); if (!e) return; const m = read(rvKey(e), {}); m[qk] = Object.assign({}, m[qk], s, { updated: Date.now() }); write(rvKey(e), m); }
    async function removeReviewItem(qk) { const e = sessionEmail(); if (!e) return; const m = read(rvKey(e), {}); delete m[qk]; write(rvKey(e), m); }

    /* users & feature flags (developer) */
    async function listAllUsers() {
      const all = users();
      return Object.values(all).map(u => ({ id: u.id, name: u.name, email: u.email, position: u.position, xp: read(pKey(u.email), blankProgress()).xp || 0, createdAt: u.createdAt, featureFlags: u.featureFlags || {} }));
    }
    async function setUserFeature(userId, flag, on) {
      const all = users(); const u = Object.values(all).find(x => x.id === userId || x.email === userId);
      if (!u) return; (u.featureFlags || (u.featureFlags = {}))[flag] = !!on; if (!on) delete u.featureFlags[flag];
      write('users', all);
    }
    /* self-service switches (Simulator / Flashcards) from the Profile tab */
    async function setPref(flag, on) {
      const e = sessionEmail(); if (!e) return;
      const all = users(); const u = all[e]; if (!u) return;
      (u.prefs || (u.prefs = {}))[flag] = !!on; if (!on) delete u.prefs[flag];
      write('users', all);
    }
    async function listAiUsage() { return {}; }        // local mode has no AI backend
    async function listAiTokenUsage() { return []; }   // local mode has no token meter
    async function listMyTokenUsage() { return []; }
    async function getEligibleCounts() { return { all: 1, simulator: 1, dev: 1 }; }

    /* tracking + empirical stats (local: stats aggregate on-device, events dropped) */
    async function logEvents() {}
    async function listRecentEvents() { return []; }
    async function bumpQuestionStats(rows) {
      const m = read('qstats', {});
      (rows || []).forEach(r => {
        const s = m[r.k] || (m[r.k] = { attempts: 0, correct: 0, time: 0 });
        s.attempts++; if (r.ok) s.correct++; s.time += r.t || 0;
      });
      write('qstats', m);
    }
    async function listQuestionStats() {
      const m = read('qstats', {});
      return Object.entries(m).map(([k, s]) => ({ questionKey: k, attempts: s.attempts, correct: s.correct, totalTimeSec: s.time }));
    }
    async function saveCohortScore() {}
    async function listCohortScores() { return []; }

    /* flag review — merges BOTH layers: users' personal flags AND the
       developer's global flags (question_edits), so a flag raised while
       signed in as the developer shows up in the workshop too. */
    async function listAllFlags() {
      const e = sessionEmail(); if (!e) return [];
      const m = read(uqKey(e), {});
      const out = Object.entries(m).filter(([, v]) => v.flagged && !v.resolved)
        .map(([question_key, v]) => ({ questionKey: question_key, flagNote: v.flag_note || '', userEmail: e, userName: e, updated: v.updated, resolved: !!v.resolved }));
      const g = read('qedits', {});
      Object.entries(g).filter(([, v]) => v.flagged).forEach(([qk, v]) =>
        out.push({ questionKey: qk, flagNote: v.flag_note || '', userEmail: devEmail, userName: 'Developer', updated: v.updated, resolved: false }));
      return out;
    }
    async function resolveFlags(qk) {
      const e = sessionEmail(); if (!e) return;
      const m = read(uqKey(e), {}); if (m[qk]) { m[qk].resolved = true; write(uqKey(e), m); }
      const g = read('qedits', {}); if (g[qk]?.flagged) { g[qk].flagged = false; write('qedits', g); }
    }
    async function listGlobalFlaggedKeys() {
      const e = sessionEmail(); if (!e) return [];
      const m = read(uqKey(e), {});
      const g = read('qedits', {});
      return [...new Set([
        ...Object.keys(m).filter(k => m[k].flagged && !m[k].resolved),
        ...Object.keys(g).filter(k => g[k].flagged)
      ])];
    }

    /* personal decks (AI flashcards from wrong answers) */
    const udKey = e => 'userdecks.' + e;
    async function saveUserDeck(meta) { const e = sessionEmail(); if (!e) return null; const l = read(udKey(e), []); const i = l.findIndex(d => d.id === meta.id); if (i >= 0) l[i] = meta; else l.push(meta); write(udKey(e), l); return meta; }
    async function listUserDecks() { const e = sessionEmail(); return e ? read(udKey(e), []) : []; }
    async function deleteUserDeck(id) { const e = sessionEmail(); if (!e) return; write(udKey(e), read(udKey(e), []).filter(d => d.id !== id)); }

    /* registration + user status (local: always open/approved) */
    async function getRegistrationOpen() { return read('regopen', true); }
    async function setRegistrationOpen(open) { write('regopen', !!open); }
    async function setUserStatus(userId, status) {
      const all = users(); const u = Object.values(all).find(x => x.id === userId || x.email === userId);
      if (u) { u.status = status; write('users', all); }
    }

    /* peer-review proposals (local mirror) */
    async function submitProposal(pr) {
      const e = sessionEmail(); if (!e) throw new Error('Sign in first.');
      const l = read('proposals', []);
      l.unshift({ id: Date.now(), questionKey: pr.questionKey, proposed: pr.proposed, note: pr.note || '',
        reviewerEmail: e, reviewerName: e, status: 'pending', created: Date.now() });
      write('proposals', l);
    }
    async function listMyProposals() { const e = sessionEmail(); return read('proposals', []).filter(x => x.reviewerEmail === e); }
    async function listProposals() { return read('proposals', []); }
    async function setProposalStatus(id, status) {
      const l = read('proposals', []); const x = l.find(y => y.id === id);
      if (x) { x.status = status; write('proposals', l); }
    }
    async function listFlaggedDetails() {
      const keys = await listGlobalFlaggedKeys();
      const e = sessionEmail(); const m = e ? read(uqKey(e), {}) : {};
      const g = read('qedits', {});
      return keys.map(k => ({ questionKey: k, notes: [m[k]?.flag_note, g[k]?.flag_note].filter(Boolean) }));
    }

    /* declined drive papers (never publish, never re-show) */
    async function getDeclinedPapers() { return read('declined', []); }
    async function declinePaper(key) { const l = read('declined', []); if (!l.includes(key)) l.push(key); write('declined', l); }

    /* essay papers (dev-published) + per-user essay feedback */
    async function getEssayPapers() { return read('essaypapers', []); }
    async function publishEssayPaper(meta) { const l = read('essaypapers', []); const i = l.findIndex(x => x.id === meta.id); if (i >= 0) l[i] = meta; else l.push(meta); write('essaypapers', l); return meta; }
    async function unpublishEssayPaper(id) { write('essaypapers', read('essaypapers', []).filter(x => x.id !== id)); }

    /* ---- CPD (TOG true/false) ---- */
    async function getCpdVolumes() { return read('cpdvolumes', []); }
    async function publishCpdVolume(meta) {
      const l = read('cpdvolumes', []); const i = l.findIndex(x => x.id === meta.id);
      if (i >= 0) l[i] = meta; else l.push(meta); write('cpdvolumes', l); return meta;
    }
    async function unpublishCpdVolume(id) { write('cpdvolumes', read('cpdvolumes', []).filter(x => x.id !== id)); }
    const cpdKey = e => 'cpdprog.' + e;
    async function getCpdProgress() { const e = sessionEmail(); return e ? read(cpdKey(e), {}) : {}; }
    async function saveCpdAnswer(row) {
      const e = sessionEmail(); if (!e) return;
      const m = read(cpdKey(e), {}); m[row.qkey] = row; write(cpdKey(e), m);
    }
    async function resetCpdSection(volumeId, sectionId) {
      const e = sessionEmail(); if (!e) return;
      const m = read(cpdKey(e), {});
      Object.keys(m).forEach(k => { if (m[k].volume_id === volumeId && m[k].section_id === sectionId) delete m[k]; });
      write(cpdKey(e), m);
    }
    const efKey = e => 'essayfb.' + e;
    async function saveEssayFeedback(fb) {
      const e = sessionEmail(); if (!e) return null;
      const m = read(efKey(e), {}); m[fb.code] = Object.assign({ created: Date.now() }, fb); write(efKey(e), m); return m[fb.code];
    }
    async function listEssayFeedback() { const e = sessionEmail(); if (!e) return []; return Object.values(read(efKey(e), {})); }
    async function getEssayFeedback(code) { const e = sessionEmail(); if (!e) return null; return read(efKey(e), {})[code] || null; }
    async function deleteEssayFeedback(code) { const e = sessionEmail(); if (!e) return; const m = read(efKey(e), {}); delete m[code]; write(efKey(e), m); }

    /* Tea-room discussions (shared board — local mirror) */
    function discAuthor() { const e = sessionEmail(); const u = e ? users()[e] : null; return u ? (u.name || u.email) : 'You'; }
    async function addDiscussion(post) {
      const e = sessionEmail(); if (!e) throw new Error('Not signed in.');
      const list = read('disc', []);
      const row = { id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), user_id: e, author_name: discAuthor(),
        question_key: post.questionKey || null, paper_title: post.paperTitle || null, answer_text: post.answerText || null,
        rationale: post.rationale || null, question: post.question || null, topic: post.topic || '',
        kind: post.kind || (post.question ? 'question' : 'post'), media: post.media || [], reaction_count: 0,
        created_at: new Date().toISOString(), reply_count: 0, mine: true };
      list.unshift(row); write('disc', list); return row;
    }
    async function pollDiscussions(sinceIso) {
      const e = sessionEmail(); if (!e) return { threads: [], replies: [] };
      const since = sinceIso || '';
      const replies = read('discR', {});
      return {
        threads: read('disc', []).filter(d => d.created_at > since).map(d => ({ ...d, mine: d.user_id === e })),
        replies: Object.values(replies).flat().filter(r => r.created_at > since).map(r => ({ ...r, mine: r.user_id === e }))
      };
    }
    async function listDiscussions(opts) {
      const e = sessionEmail(); const replies = read('discR', {});
      let rows = read('disc', []);
      if (opts?.before) rows = rows.filter(d => d.created_at < opts.before);
      // mirror the cloud's slim projection so both paths behave identically
      return rows.slice(0, opts?.limit || 40).map(d => ({
        id: d.id, user_id: d.user_id, author_name: d.author_name, question_key: d.question_key,
        paper_title: d.paper_title, topic: d.topic, created_at: d.created_at,
        kind: d.kind || 'post', media: d.media || [], reaction_count: d.reaction_count || 0,
        reply_count: (replies[d.id] || []).length, mine: d.user_id === e, hasQuestion: !!d.question_key
      }));
    }
    async function getDiscussionQuestion(discId) {
      const d = read('disc', []).find(x => x.id === discId);
      return d ? { question: d.question || null, answer_text: d.answer_text || null, rationale: d.rationale || null } : null;
    }
    async function deleteDiscussion(id) { write('disc', read('disc', []).filter(d => d.id !== id)); const r = read('discR', {}); delete r[id]; write('discR', r); }
    async function listDiscussionReplies(id) { const e = sessionEmail(); return (read('discR', {})[id] || []).map(r => ({ ...r, mine: r.user_id === e })); }
    async function addDiscussionReply(id, body, opts) {
      const e = sessionEmail(); if (!e) throw new Error('Not signed in.');
      const all = read('discR', {}); const list = all[id] || (all[id] = []);
      const row = { id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6), discussion_id: id, user_id: e, author_name: discAuthor(), body, parent_id: opts?.parentId || null, media: opts?.media || [], created_at: new Date().toISOString(), mine: true };
      list.push(row); write('discR', all); return row;
    }
    async function deleteDiscussionReply(id, replyId) { const all = read('discR', {}); if (all[id]) { all[id] = all[id].filter(r => r.id !== replyId); write('discR', all); } }

    /* User-designed study notes (tags + hooks) — local mirror */
    function unKey(e) { return 'unotes:' + norm(e); }
    async function listUserNotes() { const e = sessionEmail(); if (!e) return []; return read(unKey(e), []).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
    async function saveUserNote(note) {
      const e = sessionEmail(); if (!e) throw new Error('Not signed in.');
      const list = read(unKey(e), []); const now = Date.now();
      if (note.id) { const i = list.findIndex(n => n.id === note.id); if (i >= 0) { list[i] = Object.assign(list[i], note, { updated: now }); write(unKey(e), list); return list[i]; } }
      const row = { id: 'n' + now + Math.random().toString(36).slice(2, 6), title: note.title || '', body: note.body || '', hook: note.hook || '', tags: note.tags || [], question_key: note.questionKey || null, created: now, updated: now };
      list.unshift(row); write(unKey(e), list); return row;
    }
    async function deleteUserNote(noteId) { const e = sessionEmail(); if (!e) return; write(unKey(e), read(unKey(e), []).filter(n => n.id !== noteId)); }

    async function getTeaConfig() { return read('teacfg', null); }
    async function saveTeaConfig(c) { write('teacfg', c || {}); return c; }

    /* Model price card (USD per 1M tokens) — local mirror */
    async function getModelPricing() { return read('aipricing', null); }
    async function saveModelPricing(t) { write('aipricing', t || {}); return t; }

    /* ---------- Tea room v2 (local mirror) ---------- */
    async function uploadTeaFile(file) {
      // local mode keeps media as a data URL so the wall still works offline
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      return { url, path: '', name: file.name, type: file.type || '', size: file.size || 0 };
    }
    async function setReaction(postId, on, emoji) {
      const e = sessionEmail(); if (!e) return;
      const m = read('discRx', {}); const set = m[postId] || (m[postId] = {});
      if (on) set[e] = emoji || '👍'; else delete set[e];
      write('discRx', m);
      const list = read('disc', []); const p = list.find(x => x.id === postId);
      if (p) { p.reaction_count = Object.keys(set).length; write('disc', list); }
    }
    async function myReactions(postIds) {
      const e = sessionEmail(); const m = read('discRx', {}); const out = {};
      (postIds || []).forEach(id => { if (m[id] && m[id][e]) out[id] = m[id][e]; });
      return out;
    }
    async function listChatRooms() { const e = sessionEmail(); if (!e) return []; return read('rooms', []); }
    async function createChatRoom({ title, kind, memberIds, myName }) {
      const e = sessionEmail(); if (!e) throw new Error('Not signed in.');
      // keep the roster: room names and the WhatsApp-style sender labels are
      // resolved from it, so an empty members array reads as "Direct chat"
      const members = [{ room_id: null, user_id: e, display_name: myName || null }]
        .concat((memberIds || []).filter(u => u && u !== e).map(u => ({ user_id: u, display_name: null })));
      const room = { id: 'r' + Date.now(), kind: kind || 'group', title: title || null, created_by: e, created_at: new Date().toISOString(), last_message_at: new Date().toISOString(), members, mine: true };
      const list = read('rooms', []); list.unshift(room); write('rooms', list); return room;
    }
    async function listChatMessages(roomId, sinceIso) {
      const e = sessionEmail();
      return (read('msgs', {})[roomId] || []).filter(m => !sinceIso || m.created_at > sinceIso).map(m => ({ ...m, mine: m.user_id === e }));
    }
    async function sendChatMessage(roomId, body, media) {
      const e = sessionEmail(); if (!e) throw new Error('Not signed in.');
      const all = read('msgs', {}); const list = all[roomId] || (all[roomId] = []);
      const row = { id: 'm' + Date.now(), room_id: roomId, user_id: e, author_name: discAuthor(), body: body || '', media: media || [], created_at: new Date().toISOString(), mine: true };
      list.push(row); write('msgs', all);
      const rooms = read('rooms', []); const r = rooms.find(x => x.id === roomId); if (r) { r.last_message_at = row.created_at; write('rooms', rooms); }
      return row;
    }
    async function markRoomRead() {}
    async function pollChat(sinceIso) {
      const e = sessionEmail(); const all = read('msgs', {});
      return Object.values(all).flat().filter(m => !sinceIso || m.created_at > sinceIso).map(m => ({ ...m, mine: m.user_id === e }));
    }
    async function listChatPeople() { return Object.values(users()).map(u => ({ id: u.email, name: u.name, avatar: u.avatar || '' })); }
    async function listMemberCards() { const m = {}; Object.values(users()).forEach(u => m[u.email] = { name: u.name, avatar: u.avatar || '' }); return m; }
    async function uploadAvatar(file) {
      const e = sessionEmail(); if (!e) throw new Error('Not signed in.');
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const all = users(); if (all[e]) { all[e].avatar = url; write('users', all); }
      return url;
    }
    async function getNotifSeen() { const e = sessionEmail(); return e ? read('notifseen:' + norm(e), {}) : {}; }
    async function setNotifSeen(patch) { const e = sessionEmail(); if (!e) return; write('notifseen:' + norm(e), { ...read('notifseen:' + norm(e), {}), ...patch }); }

    /* AI feature registry + shared pools + tags (local mirrors) */
    async function getAiFeatures() { return read('aifeatures', {}); }
    async function saveAiFeatures(data) { write('aifeatures', data); return data; }
    async function listSharedUsage() { return []; }
    async function saveQuestionTags(rows) { const m = read('qtags', {}); (rows || []).forEach(r => m[r.questionKey] = r); write('qtags', m); }
    async function listQuestionTags() { return Object.values(read('qtags', {})); }

    /* AI (local mode has no server function — the app disables AI in local) */
    async function getAccessToken() { return null; }

    function publicUser(u) { return { id: u.id, name: u.name, email: u.email, position: u.position, createdAt: u.createdAt, isDeveloper: norm(u.email) === devEmail, featureFlags: u.featureFlags || {}, prefs: u.prefs || {}, avatar: u.avatar || '', status: u.status || 'approved' }; }

    return { init, signUp, signIn, signOut, requestPasswordReset, updatePassword, onPasswordRecovery, currentUser, updateProfile,
      getRegistrationOpen, setRegistrationOpen, setUserStatus, submitProposal, listMyProposals, listProposals, setProposalStatus, listFlaggedDetails, getDeclinedPapers, declinePaper,
      getEssayPapers, publishEssayPaper, unpublishEssayPaper, saveEssayFeedback, listEssayFeedback, getEssayFeedback, deleteEssayFeedback,
      getCpdVolumes, publishCpdVolume, unpublishCpdVolume, getCpdProgress, saveCpdAnswer, resetCpdSection,
      getProgress, recordAttempt, getAttempt, addXp, resetProgress,
      getOsceStations, getOsceStation, getOsceSearchIndex, publishOsceStation, unpublishOsceStation,
      moveOsceStations, getOsceCollections, saveOsceCollections, getGroqConfig, saveGroqConfig,
      getOsceBlueprint, saveOsceBlueprint, tagOsceStations, listOsceDecks, saveOsceDeck, deleteOsceDeck,
      listOsceAttempts, getOsceAttempt,
      saveOsceAttempt, deleteOsceAttempt, uploadOsceAudio, getOsceAudioUrl, sweepOsceAudio,
      /* case discussions — the SAME names in both backends, always */
      getCases, getCase, publishCase, unpublishCase,
      listCaseAttempts, getCaseAttempt, saveCaseAttempt, deleteCaseAttempt,
      uploadCaseAudio, getCaseAudioUrl, sweepCaseAudio,
      uploadOsceImage, osceImageUrl, deleteOsceImage,
      getWalletConfig, saveWalletConfig, listMyTopUps, createTopUp, createTopUpFor,
      listAllTopUps, setTopUpStatus,
      getPublishedPapers, getPaperContent, getPaperContents, publishPaper, unpublishPaper,
      getExamDate, setExamDate, saveSession, loadSession, clearSession, listSessions,
      getNote, saveNote, getNotesForPaper, listAllNotes, getCustomCurriculum, saveCustomCurriculum,
      saveAiItem, saveAiChat, listAiItems, deleteAiItem, getQuestionEdit, saveQuestionEdit,
      getUserQuestionEdit, saveUserQuestionEdit, listExcludedQuestions,
      getFlashcardDecks, publishFlashcardDeck, unpublishFlashcardDeck,
      getCardProgress, saveCardProgress, listAllCardProgress,
      getBlueprint, saveBlueprint, saveMockResult, listMockResults, getMockResult,
      listReviewItems, saveReviewItem, removeReviewItem, listAllUsers, setUserFeature, setPref, listAiUsage, listAiTokenUsage, listMyTokenUsage, getEligibleCounts,
      logEvents, listRecentEvents, bumpQuestionStats, listQuestionStats, saveCohortScore, listCohortScores,
      listAllFlags, resolveFlags, listGlobalFlaggedKeys, saveUserDeck, listUserDecks, deleteUserDeck,
      addDiscussion, listDiscussions, deleteDiscussion, listDiscussionReplies, addDiscussionReply, deleteDiscussionReply, pollDiscussions, getDiscussionQuestion,
      listUserNotes, saveUserNote, deleteUserNote,
      uploadTeaFile, setReaction, myReactions, listChatRooms, createChatRoom, listChatMessages, sendChatMessage, markRoomRead, pollChat, listChatPeople,
      listMemberCards, uploadAvatar, getNotifSeen, setNotifSeen,
      getAiFeatures, saveAiFeatures, getModelPricing, saveModelPricing, getTeaConfig, saveTeaConfig, listSharedUsage, saveQuestionTags, listQuestionTags, getAccessToken };
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

    /* PostgREST silently caps every select at ~1000 rows. Any read that can
       exceed that (question tags/stats, token meters, events, cohort scores)
       MUST page through — the cap once made the tagger believe questions
       beyond row 1000 were untagged and re-bill them. `build` returns a
       fresh query (with a stable order) for each page. */
    async function pageAll(build) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw new Error(error.message);
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return out;
    }

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
    async function requestPasswordReset(email) {
      await ensureClient();
      const redirectTo = location.origin + location.pathname;
      const { error } = await sb.auth.resetPasswordForEmail(norm(email), { redirectTo });
      if (error) throw new Error(error.message);
    }
    async function updatePassword(newPassword) {
      await ensureClient();
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
    }
    /* fires when the user lands here from a recovery email link */
    function onPasswordRecovery(cb) {
      ensureClient().then(() => sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') cb(); })).catch(() => {});
    }

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
        isDeveloper: norm(data.user.email) === devEmail,
        featureFlags: prof?.feature_flags || {},
        prefs: prof?.prefs || {},
        avatar: prof?.avatar_url || '',
        notifSeen: prof?.notif_seen || {},
        // the stored, unique reference — what a transfer is addressed to
        userNo: prof?.user_no || '',
        status: prof?.status || 'approved'
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
    async function addXp(points) {
      await ensureClient(); const id = await uid(); if (!id || !points) return;
      const { data } = await sb.from('profiles').select('xp').eq('id', id).single();
      await sb.from('profiles').update({ xp: (data?.xp || 0) + points }).eq('id', id);
    }
    async function resetProgress() {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('attempts').delete().eq('user_id', id);
      await sb.from('profiles').update({ xp: 0, streak_count: 0, streak_last_day: null }).eq('id', id);
    }

    /* ---------- catalogue reads ----------
       A catalogue (the question bank, the decks, the essay papers, the CPD
       volumes) must never be able to come back as an empty list because the
       READ failed. It used to: `const { data } = await sb.from(...)` throws
       away the error, so an expired token, a dropped connection or a
       statement timeout all produced `data === null` → `[]` → "the bank is
       empty", with nothing thrown. Data.publishedPapers() then cached that
       empty list over the good one for 15 minutes, and the whole SBA/EMQ bank
       appeared to have been deleted when every row was still in the database.

       So: errors throw, and the read is paged. PostgREST returns at most
       `max_rows` (1000 by default) per request, so a single unpaged select on
       a growing bank would silently truncate as well. */
    const PAGE = 500;
    async function catalogue(what, make) {
      await ensureClient();
      const out = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await make().range(from, from + PAGE - 1);
        if (error) throw new Error(`Could not read ${what}: ${error.message || error.code || 'read failed'}`);
        out.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      return out;
    }


    /* ---- OSCE stations + attempts ---- */
    /* The card only — the questions and the marking scheme stay in the
       database until a station is actually opened. */
    const OSCE_CARD_SELECT = 'id,topic:meta->>topic,scenario:meta->>scenario,' +
      'station_time_min:meta->station_time_min,reading_time_min:meta->reading_time_min,' +
      'total_marks:meta->total_marks,pass_mark:meta->pass_mark,pass_mark_percent:meta->pass_mark_percent,' +
      'q_count:meta->q_count,points_count:meta->points_count,image_count:meta->image_count,' +
      'collection:meta->>collection,bp:meta->bp,' +
      'edited_by:meta->>edited_by,edited_at:meta->edited_at';
    let osceCardsOk = true;
    async function getOsceStations() {
      if (osceCardsOk) {
        try {
          return await catalogue('the OSCE stations',
            () => sb.from('osce_stations').select(OSCE_CARD_SELECT).order('id'));
        } catch (e) {
          if (!/failed to parse|unexpected|selector|42601|PGRST100|PGRST20/i.test(String(e.message || e))) throw e;
          osceCardsOk = false;
        }
      }
      return (await catalogue('the OSCE stations', () => sb.from('osce_stations').select('id,meta').order('id'))).map(r => osceCard(r.meta));
    }
    /* The searchable text — every prompt and every marking point — is most of
       a card's weight and is needed only if someone actually types in the box,
       so it is a separate read that most visits never make. */
    async function getOsceSearchIndex() {
      return await catalogue('the OSCE search index',
        () => sb.from('osce_stations').select('id,search:meta->>search').order('id'));
    }
    /** The whole station, fetched when one is opened. */
    async function getOsceStation(id) {
      await ensureClient();
      const { data, error } = await sb.from('osce_stations').select('meta').eq('id', id).single();
      if (error) throw new Error(`Could not load that station: ${error.message || error.code || 'read failed'}`);
      return data?.meta || null;
    }
    async function publishOsceStation(meta) {
      await ensureClient();
      // stations are editable by any signed-in candidate now, so every save
      // carries its author — a wrong edit has to be attributable
      const rec = withOsceCounts(meta);
      try {
        const { data } = await sb.auth.getUser();
        if (data?.user) { rec.edited_by = data.user.email || data.user.id; rec.edited_at = Date.now(); }
      } catch { /* the save matters more than the signature */ }
      const { error } = await sb.from('osce_stations').upsert({ id: rec.id, meta: rec });
      if (error) throw new Error(error.message || 'Could not save that station.');
      return rec;
    }
    async function unpublishOsceStation(id) { await ensureClient(); await sb.from('osce_stations').delete().eq('id', id); }
    /* Move stations between bins. `ids` null/empty means every station.

       Filing 197 stations is a one-key change inside each `meta`, so doing it
       by downloading every station, editing it and writing it back would move
       roughly 8 MB in each direction to set one string. The RPC in schema.sql
       does it with jsonb_set inside Postgres — nothing leaves the database.
       Where that function is not installed yet the read-modify-write path
       still works, so this is never blocked on a migration. */
    async function moveOsceStations(ids, collection) {
      await ensureClient();
      const list = (ids && ids.length) ? ids : null;
      const { data, error } = await sb.rpc('osce_set_collection', { ids: list, coll: collection });
      if (!error) return Number(data) || 0;
      if (!/function|does not exist|PGRST202|schema cache/i.test(String(error.message || error.code))) {
        throw new Error('Could not move those stations: ' + (error.message || error.code));
      }
      // fallback: fetch, edit, write back, in pages so nothing times out.
      // catalogue() calls make() once per page, so this builds a fresh query
      // each time — a query builder cannot be re-ranged after it has run.
      const make = () => {
        const q = sb.from('osce_stations').select('id,meta').order('id');
        return list ? q.in('id', list) : q;
      };
      const rows = await catalogue('the OSCE stations', make);
      let n = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50)
          .map(r => ({ id: r.id, meta: Object.assign({}, r.meta, { collection }) }));
        const { error: e2 } = await sb.from('osce_stations').upsert(batch);
        if (e2) throw new Error('Could not move those stations: ' + (e2.message || e2.code));
        n += batch.length;
      }
      return n;
    }
    /* Which Groq models to use. Stored rather than compiled in, because a
       free tier retires models and following that should not need a deploy. */
    async function getGroqConfig() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'groq').single();
      return data?.data || {};
    }
    async function saveGroqConfig(c) {
      await ensureClient();
      await sb.from('app_config').upsert({ id: 'groq', data: c });
      return c;
    }
    async function getOsceCollections() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'osce').single();
      return data?.data?.collections || null;
    }
    async function saveOsceCollections(list) {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'osce').single();
      await sb.from('app_config').upsert({ id: 'osce', data: Object.assign({}, data?.data, { collections: list }) });
      return list;
    }
    /* The blueprint shares the 'osce' config row with the collections, so
       each must merge rather than overwrite — saving one used to erase the
       other. */
    async function getOsceBlueprint() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'osce').single();
      return data?.data?.blueprint || null;
    }
    async function saveOsceBlueprint(b) {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'osce').single();
      await sb.from('app_config').upsert({ id: 'osce', data: Object.assign({}, data?.data, { blueprint: b }) });
      return b;
    }
    /* Tagging touches one key of `meta` on many rows. Read-modify-write per
       station, in small batches: the alternative is a migration for a column
       that only the blueprint cares about. */
    async function tagOsceStations(map) {
      await ensureClient();
      const ids = Object.keys(map || {});
      if (!ids.length) return 0;
      let n = 0;
      for (let i = 0; i < ids.length; i += 40) {
        const slice = ids.slice(i, i + 40);
        const { data, error } = await sb.from('osce_stations').select('id,meta').in('id', slice);
        if (error) throw new Error('Could not read the stations to tag: ' + (error.message || error.code));
        const rows = (data || []).map(r => ({ id: r.id, meta: Object.assign({}, r.meta, { bp: map[r.id] }) }));
        if (!rows.length) continue;
        const { error: e2 } = await sb.from('osce_stations').upsert(rows);
        if (e2) throw new Error('Could not save the tags: ' + (e2.message || e2.code));
        n += rows.length;
      }
      return n;
    }
    /* Flashcard decks made from an attempt. Stored beside the attempts they
       came from, one row per deck, owned by the candidate. */
    async function listOsceDecks() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data, error } = await sb.from('osce_decks').select('id,attempt_id,payload,created_at')
        .eq('user_id', id).order('created_at', { ascending: false });
      if (error) return [];
      return (data || []).map(r => Object.assign({}, r.payload, { id: r.id, attemptId: r.attempt_id,
        created: new Date(r.created_at).getTime() }));
    }
    async function saveOsceDeck(d) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Sign in first.');
      const { error } = await sb.from('osce_decks').upsert({
        id: d.id, user_id: id, attempt_id: d.attemptId || null,
        payload: Object.assign({}, d, { id: undefined, attemptId: undefined, created: undefined }) });
      if (error) throw new Error('Could not save the deck: ' + (error.message || error.code));
      return d;
    }
    async function deleteOsceDeck(did) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('osce_decks').delete().eq('id', did).eq('user_id', id);
    }
    /* A list of attempts needs the score, not the answers. Selecting whole
       payloads shipped every question, every marking point and every
       transcript of every past station just to draw a row. */
    /* ---- case discussions ---- */
    async function getCases() {
      await ensureClient();
      return (await catalogue('the cases', () => sb.from('case_files').select('id,meta').order('id'))).map(r => caseCard(r.meta));
    }
    async function getCase(id) {
      await ensureClient();
      const { data, error } = await sb.from('case_files').select('meta').eq('id', id).single();
      if (error) throw new Error(`Could not load that case: ${error.message || error.code || 'read failed'}`);
      return data?.meta || null;
    }
    async function publishCase(meta) {
      await ensureClient();
      const rec = withCaseCounts(meta);
      try {
        const { data } = await sb.auth.getUser();
        if (data?.user) { rec.edited_by = data.user.email || data.user.id; rec.edited_at = Date.now(); }
      } catch {}
      const { error } = await sb.from('case_files').upsert({ id: rec.id, meta: rec });
      if (error) throw new Error(error.message || 'Could not save that case.');
      return rec;
    }
    async function unpublishCase(id) { await ensureClient(); await sb.from('case_files').delete().eq('id', id); }

    async function listCaseAttempts() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const light = 'id,case_id,created_at,topic:payload->case->>topic,status:payload->>status,'
        + 'percent:payload->result->percent,total:payload->result->total,max:payload->result->max,pass:payload->result->pass';
      const { data, error } = await sb.from('case_attempts').select(light).eq('user_id', id).order('created_at', { ascending: false });
      if (error) throw new Error('Could not read your case discussions: ' + (error.message || error.code));
      return (data || []).map(r => ({ id: r.id, case_id: r.case_id, created: new Date(r.created_at).getTime(),
        topic: r.topic || '', status: r.status || (r.percent == null ? 'unmarked' : 'marked'),
        result: r.percent == null ? null : { percent: r.percent, total: r.total, max: r.max, pass: !!r.pass } }));
    }
    async function getCaseAttempt(aid) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const { data } = await sb.from('case_attempts').select('id,case_id,payload,created_at').eq('id', aid).eq('user_id', id).single();
      return data ? Object.assign({}, data.payload, { id: data.id, case_id: data.case_id, created: new Date(data.created_at).getTime() }) : null;
    }
    async function saveCaseAttempt(a) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Sign in first.');
      const { error } = await sb.from('case_attempts').upsert({ id: a.id, user_id: id, case_id: a.case_id, payload: a });
      if (error) throw new Error(error.message || 'Could not save the discussion.');
      return a;
    }
    async function deleteCaseAttempt(aid) { await ensureClient(); const id = await uid(); if (!id) return; await sb.from('case_attempts').delete().eq('id', aid).eq('user_id', id); }

    /* The case tape shares the OSCE bucket. The storage policy keys on the
       first path segment being your own uid, so a `case-` prefix inside your
       own folder needs no new bucket and no new policy — and the nightly
       sweep that empties the bucket after 24 hours already covers it. */
    async function uploadCaseAudio(attemptId, blob) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const ext = /mp4|aac/.test(blob.type || '') ? 'm4a' : 'webm';
      const path = `${id}/case-${attemptId}.${ext}`;
      const { error } = await sb.storage.from(AUDIO_BUCKET).upload(path, blob, {
        cacheControl: '86400', upsert: true, contentType: blob.type || 'audio/webm' });
      if (error) throw new Error('Could not store the recording: ' + (error.message || ''));
      return { path, expires: Date.now() + AUDIO_TTL };
    }
    const getCaseAudioUrl = path => getOsceAudioUrl(path);
    const sweepCaseAudio = () => sweepOsceAudio();

    async function listOsceAttempts() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const light = 'id,station_id,created_at,topic:payload->station->>topic,passMark:payload->station->pass_mark,' +
        'percent:payload->result->percent,total:payload->result->total,max:payload->result->max,pass:payload->result->pass';
      const { data, error } = await sb.from('osce_attempts').select(light).eq('user_id', id).order('created_at', { ascending: false });
      if (error) throw new Error('Could not read your OSCE attempts: ' + (error.message || error.code));
      return (data || []).map(r => ({ id: r.id, station_id: r.station_id, created: new Date(r.created_at).getTime(),
        topic: r.topic || '', passMark: r.passMark ?? null,
        result: { percent: r.percent, total: r.total, max: r.max, pass: !!r.pass } }));
    }
    async function getOsceAttempt(aid) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const { data } = await sb.from('osce_attempts').select('id,station_id,payload,created_at').eq('id', aid).eq('user_id', id).single();
      return data ? Object.assign({}, data.payload, { id: data.id, station_id: data.station_id, created: new Date(data.created_at).getTime() }) : null;
    }
    async function saveOsceAttempt(a) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Sign in first.');
      const { error } = await sb.from('osce_attempts').upsert({ id: a.id, user_id: id, station_id: a.station_id, payload: a });
      if (error) throw new Error(error.message || 'Could not save the attempt.');
      return a;
    }
    async function deleteOsceAttempt(aid) { await ensureClient(); const id = await uid(); if (!id) return; await sb.from('osce_attempts').delete().eq('id', aid).eq('user_id', id); }

    /* ---- images on a station's questions ----
       The bytes go to storage and the question keeps only the path, so a
       station with six CTGs still costs the same to LIST as one with none.
       See the bucket note in supabase/schema.sql for why it is public. */
    const IMAGE_BUCKET = 'osce-images';
    const rid = () => (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, '');
    async function uploadOsceImage(stationId, file) {
      await ensureClient();
      const ext = /png/i.test(file.type) ? 'png' : /webp/i.test(file.type) ? 'webp' : /gif/i.test(file.type) ? 'gif' : 'jpg';
      const path = `${String(stationId || 'unfiled').replace(/[^a-z0-9-]/gi, '')}/${rid()}.${ext}`;
      const { error } = await sb.storage.from(IMAGE_BUCKET).upload(path, file, {
        cacheControl: '31536000', upsert: false, contentType: file.type || 'image/jpeg' });
      if (error) throw new Error('Could not upload that image: ' + (error.message || ''));
      const { data } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      return { path, url: data?.publicUrl || '' };
    }
    function osceImageUrl(path) {
      if (!path) return '';
      if (/^(https?:|data:)/i.test(path)) return path;   // a URL that came in with the JSON
      try { return sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data?.publicUrl || ''; } catch { return ''; }
    }
    async function deleteOsceImage(path) {
      await ensureClient();
      if (!path || /^(https?:|data:)/i.test(path)) return;
      await sb.storage.from(IMAGE_BUCKET).remove([path]);
    }

    /* ---- the OSCE recording, kept for 24 hours ----
       Small enough to store (24 kbps opus), useful enough to keep — hearing
       yourself back is the point — but not worth paying to store forever, so
       it is swept the day after. The bucket is private and every object lives
       under the owner's uid, which the storage policy enforces. */
    const AUDIO_BUCKET = 'osce-audio';
    const AUDIO_TTL = 24 * 3600e3;
    async function uploadOsceAudio(attemptId, blob) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const ext = /mp4|aac/.test(blob.type || '') ? 'm4a' : 'webm';
      const path = `${id}/${attemptId}.${ext}`;
      const { error } = await sb.storage.from(AUDIO_BUCKET).upload(path, blob, {
        cacheControl: '86400', upsert: true, contentType: blob.type || 'audio/webm' });
      if (error) throw new Error('Could not store the recording: ' + (error.message || ''));
      return { path, expires: Date.now() + AUDIO_TTL };
    }
    /** A signed link, valid for an hour, or null once the sweep has taken it. */
    async function getOsceAudioUrl(path) {
      await ensureClient(); if (!path) return null;
      const { data, error } = await sb.storage.from(AUDIO_BUCKET).createSignedUrl(path, 3600);
      if (error) return null;
      return data?.signedUrl || null;
    }
    /** Delete this user's own recordings once they are a day old. */
    async function sweepOsceAudio() {
      await ensureClient(); const id = await uid(); if (!id) return 0;
      const { data, error } = await sb.storage.from(AUDIO_BUCKET).list(id, { limit: 200 });
      if (error || !data) return 0;
      const stale = data.filter(o => Date.now() - new Date(o.created_at || o.updated_at || 0).getTime() > AUDIO_TTL);
      if (!stale.length) return 0;
      await sb.storage.from(AUDIO_BUCKET).remove(stale.map(o => `${id}/${o.name}`));
      return stale.length;
    }

    /* ---- prepaid wallet ---- */
    async function getWalletConfig() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'wallet').single();
      return data?.data || { usdRate: 340, minTopUp: 300, packs: [300, 500, 1000, 2000] };
    }
    async function saveWalletConfig(c) { await ensureClient(); await sb.from('app_config').upsert({ id: 'wallet', data: c }); return c; }
    async function listMyTopUps() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data } = await sb.from('credit_topups').select('id,amount_lkr,reference,status,note,created_at').eq('user_id', id).order('created_at', { ascending: false });
      return data || [];
    }
    async function createTopUp(t) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Sign in first.');
      const row = { user_id: id, amount_lkr: t.amount_lkr, reference: t.reference || '', status: 'pending',
        slip: t.slip || null, extracted: t.extracted || null };
      const { data, error } = await sb.from('credit_topups').insert(row).select('id').single();
      if (error) throw new Error(error.message || 'Could not send the top-up.');
      return Object.assign(row, { id: data?.id });
    }
    async function listAllTopUps() {
      await ensureClient();
      const { data, error } = await sb.from('credit_topups').select('*').order('created_at', { ascending: false });
      if (error) throw new Error('Could not read the top-ups: ' + (error.message || error.code));
      return data || [];
    }
    /* Credit somebody else, for a payment verified outside the app — no slip
       was uploaded, or the slip was unreadable. It lands approved, marked
       `manual`, with the developer's note recording how it was verified. */
    async function createTopUpFor(userId, t) {
      await ensureClient();
      const row = { user_id: userId, amount_lkr: t.amount_lkr, reference: t.reference || '',
        status: 'approved', note: t.note || '', slip: null,
        extracted: Object.assign({ manual: true }, t.extracted || null) };
      const { data, error } = await sb.from('credit_topups').insert(row).select('id').single();
      if (error) throw new Error(error.message || 'Could not add that credit.');
      return Object.assign(row, { id: data?.id });
    }
    async function setTopUpStatus(id, status, note, extracted) {
      await ensureClient();
      const patch = { status, note: note || '' };
      if (extracted) patch.extracted = extracted;      // confirming stamps the row, it does not re-approve it
      const { error } = await sb.from('credit_topups').update(patch).eq('id', id);
      if (error) throw new Error(error.message || 'Could not update that top-up.');
    }

    /* ---------- the catalogue vs the content ----------
       `meta` holds the paper's light metadata AND `content`: every stem,
       option and rationale in it. Selecting whole rows to draw a LIST of
       papers therefore shipped the entire question bank on every cache miss —
       roughly 12 MB at 150 papers — which is what made the read slow enough
       to time out, and what quietly spent the egress budget.

       PostgREST can project individual JSON keys, so the list now asks for
       just the fields a paper card needs and `content` never leaves the
       database. If a server rejects that projection the old whole-row read is
       used instead, so this can only ever be faster, never broken. */
    const CARD_SELECT = 'id,' +
      'title:meta->>title,source:meta->>source,driveKey:meta->>driveKey,file:meta->>file,' +
      'categoryId:meta->>categoryId,sectionId:meta->>sectionId,topicId:meta->>topicId,' +
      'sba:meta->sba,emq:meta->emq';
    let cardSelectOk = true;          // set false once if the server will not project
    const numOr0 = v => (v == null || v === '') ? 0 : (Number(v) || 0);

    async function getPublishedPapers() {
      if (cardSelectOk) {
        try {
          const rows = await catalogue('the question bank',
            () => sb.from('papers').select(CARD_SELECT).order('id'));
          return rows.map(r => ({ ...r, sba: numOr0(r.sba), emq: numOr0(r.emq) }));
        } catch (e) {
          // only a REJECTED PROJECTION falls back; a genuine read failure must surface
          if (!/failed to parse|unexpected|selector|42601|PGRST100|PGRST20/i.test(String(e.message || e))) throw e;
          cardSelectOk = false;
          console.warn('papers: JSON projection unavailable, falling back to whole rows —', e.message || e);
        }
      }
      return (await catalogue('the question bank', () => sb.from('papers').select('id,meta').order('id'))).map(r => r.meta);
    }
    /** One paper's questions, fetched when that paper is opened. */
    async function getPaperContent(id) {
      await ensureClient();
      const { data, error } = await sb.from('papers').select('meta').eq('id', id).single();
      if (error) throw new Error(`Could not load paper "${id}": ${error.message || error.code || 'read failed'}`);
      return data?.meta?.content || null;
    }
    /** Every paper's questions in one paged read — for the features that need the whole bank. */
    async function getPaperContents() {
      return (await catalogue('the question bank',
        () => sb.from('papers').select('id,meta').order('id')))
        .map(r => ({ id: r.id, content: r.meta?.content || null }));
    }
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
    async function getFlashcardDecks() {
      return (await catalogue('the flashcard decks', () => sb.from('flashcard_decks').select('id,meta').order('id'))).map(r => r.meta);
    }
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

    /* review queue — wrong SBA/EMQ scheduled for spaced review */
    async function listReviewItems() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data } = await sb.from('review_items').select('*').eq('user_id', id);
      return (data || []).map(r => ({ question_key: r.question_key, paperTitle: r.paper_title, due: r.due, interval: r.interval, ease: r.ease, reps: r.reps, lapses: r.lapses, wrongCount: r.wrong_count, streak: r.streak || 0 }));
    }
    async function saveReviewItem(qk, s) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('review_items').upsert({ user_id: id, question_key: qk, paper_title: s.paperTitle || null, due: s.due, interval: s.interval || 0, ease: s.ease || 2.5, reps: s.reps || 0, lapses: s.lapses || 0, wrong_count: s.wrongCount || 1, streak: s.streak || 0, updated_at: new Date().toISOString() }, { onConflict: 'user_id,question_key' });
    }
    async function removeReviewItem(qk) { await ensureClient(); const id = await uid(); if (!id) return; await sb.from('review_items').delete().eq('user_id', id).eq('question_key', qk); }

    /* users & feature flags (developer — RLS "profiles dev read/update" policies) */
    async function listAllUsers() {
      await ensureClient();
      const { data } = await sb.from('profiles').select('id,name,email,position,xp,created_at,feature_flags,prefs,status').order('created_at', { ascending: true });
      return (data || []).map(r => ({ id: r.id, name: r.name, email: r.email, position: r.position, xp: r.xp || 0, createdAt: r.created_at, featureFlags: r.feature_flags || {}, prefs: r.prefs || {}, status: r.status || 'approved' }));
    }
    async function setUserFeature(userId, flag, on) {
      await ensureClient();
      const { data } = await sb.from('profiles').select('feature_flags').eq('id', userId).single();
      const flags = Object.assign({}, data?.feature_flags);
      if (on) flags[flag] = true; else delete flags[flag];
      await sb.from('profiles').update({ feature_flags: flags }).eq('id', userId);
    }
    /* self-service switches (Simulator / Flashcards) — the user's own row */
    async function setPref(flag, on) {
      await ensureClient(); const id = await uid(); if (!id) return;
      const { data } = await sb.from('profiles').select('prefs').eq('id', id).single();
      const prefs = Object.assign({}, data?.prefs);
      if (on) prefs[flag] = true; else delete prefs[flag];
      await sb.from('profiles').update({ prefs }).eq('id', id);
    }
    /* AI usage per user (developer — "usage dev read" policy). Returns
       { userId: { total, today } } aggregated from the daily counters. */
    async function listAiUsage() {
      await ensureClient();
      const { data } = await sb.from('ai_usage').select('user_id, day, count');
      const today = new Date().toISOString().slice(0, 10);
      const out = {};
      (data || []).forEach(r => {
        const u = out[r.user_id] || (out[r.user_id] = { total: 0, today: 0 });
        u.total += r.count || 0;
        if (r.day === today) u.today += r.count || 0;
      });
      return out;
    }

    /* tracking + empirical stats */
    async function logEvents(batch) {
      await ensureClient(); const id = await uid(); if (!id || !batch?.length) return;
      await sb.from('question_events').insert(batch.map(e => ({ user_id: id, question_key: e.question_key, mode: e.mode, event: e.event, data: e.data })));
    }
    async function bumpQuestionStats(rows) {
      await ensureClient(); const id = await uid(); if (!id || !rows?.length) return;
      await sb.rpc('bump_question_stats', { p_rows: rows });
    }
    /* latest tracked events (developer — behaviour-insights analysis) */
    async function listRecentEvents(limit = 1500) {
      await ensureClient();
      const { data } = await sb.from('question_events')
        .select('question_key, mode, event, data, created_at')
        .order('created_at', { ascending: false }).limit(limit);
      return data || [];
    }
    async function listQuestionStats() {
      await ensureClient();
      const rows = await pageAll(() => sb.from('question_stats')
        .select('question_key, attempts, correct, total_time_sec').order('question_key'));
      return rows.map(r => ({ questionKey: r.question_key, attempts: r.attempts, correct: r.correct, totalTimeSec: r.total_time_sec }));
    }
    async function saveCohortScore(percent) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('cohort_scores').insert({ user_id: id, percent: Math.round(percent) });
    }
    async function listCohortScores(days = 120) {
      await ensureClient();
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const rows = await pageAll(() => sb.from('cohort_scores').select('user_id, percent, day').gte('day', cutoff).order('id'));
      return rows.map(r => ({ userId: r.userId ?? r.user_id, percent: r.percent, day: r.day }));
    }

    /* flag review workshop (developer — "uqe dev read/update" policies).
       Merges BOTH layers: users' personal flags (user_question_edits) AND
       the developer's own global flags (question_edits) — QEdit routes a
       signed-in developer's flag to the global layer, so without this merge
       the developer's flags would never appear in the workshop. */
    async function listAllFlags() {
      await ensureClient();
      const { data, error } = await sb.from('user_question_edits')
        .select('user_id, question_key, flag_note, resolved, updated_at')
        .eq('flagged', true).order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      const { data: profs } = await sb.from('profiles').select('id, name, email');
      const who = {}; (profs || []).forEach(p => who[p.id] = p);
      const out = (data || []).map(r => ({ questionKey: r.question_key, flagNote: r.flag_note || '',
        userName: who[r.user_id]?.name || '', userEmail: who[r.user_id]?.email || r.user_id,
        updated: r.updated_at, resolved: !!r.resolved }));
      const { data: glob } = await sb.from('question_edits')
        .select('question_key, flag_note, updated_by, updated_at').eq('flagged', true);
      (glob || []).forEach(r => out.push({ questionKey: r.question_key, flagNote: r.flag_note || '',
        userName: 'Developer (global flag)', userEmail: r.updated_by || devEmail,
        updated: r.updated_at, resolved: false }));
      return out;
    }
    async function resolveFlags(qk) {
      await ensureClient();
      await sb.from('user_question_edits').update({ resolved: true }).eq('question_key', qk).eq('flagged', true);
      // clear the developer's global flag too (its "resolved" IS unflagging);
      // the note stays on the record for history
      await sb.from('question_edits').update({ flagged: false }).eq('question_key', qk).eq('flagged', true);
    }
    /* keys flagged as wrong by ANYONE (users via the RPC, developer via the
       public-readable global layer) — kept out of new mocks until resolved */
    async function listGlobalFlaggedKeys() {
      await ensureClient();
      const { data } = await sb.rpc('list_flagged_keys');
      const { data: glob } = await sb.from('question_edits').select('question_key').eq('flagged', true);
      return [...new Set([...(data || []), ...(glob || []).map(r => r.question_key)])];
    }

    /* personal decks (AI flashcards from wrong answers) */
    async function saveUserDeck(meta) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      await sb.from('user_decks').upsert({ user_id: id, id: meta.id, meta, updated_at: new Date().toISOString() }, { onConflict: 'user_id,id' });
      return meta;
    }
    async function listUserDecks() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data } = await sb.from('user_decks').select('meta').eq('user_id', id);
      return (data || []).map(r => r.meta);
    }
    async function deleteUserDeck(deckId) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('user_decks').delete().eq('user_id', id).eq('id', deckId);
    }

    /* Tea-room discussions (shared board — RLS: read all, write/delete own) */
    async function discAuthorName() {
      const { data } = await sb.auth.getUser();
      if (!data?.user) return 'A friend';
      const { data: prof } = await sb.from('profiles').select('name').eq('id', data.user.id).single();
      return prof?.name || data.user.user_metadata?.name || (data.user.email || '').split('@')[0] || 'A friend';
    }
    async function addDiscussion(post) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      const row = { user_id: id, author_name: await discAuthorName(), question_key: post.questionKey || null,
        paper_title: post.paperTitle || null, answer_text: post.answerText || null, rationale: post.rationale || null,
        question: post.question || null, topic: post.topic || '',
        kind: post.kind || (post.question ? 'question' : 'post'), media: post.media || [] };
      const { data, error } = await sb.from('discussions').insert(row).select().single();
      if (error) throw error;
      return { ...data, mine: true, reply_count: 0 };
    }
    /* Incremental poll for live chat: only rows newer than `sinceIso`, so a
       quiet board costs two near-empty queries and the tea room stays live
       without anyone reloading the tab. */
    async function pollDiscussions(sinceIso) {
      await ensureClient(); const id = await uid(); if (!id) return { threads: [], replies: [] };
      const since = sinceIso || new Date(Date.now() - 60000).toISOString();
      const [t, r] = await Promise.all([
        sb.from('discussions').select(DISC_COLS).gt('created_at', since).order('created_at', { ascending: true }).limit(80),
        sb.from('discussion_replies').select('id,discussion_id,user_id,author_name,body,created_at').gt('created_at', since).order('created_at', { ascending: true }).limit(200)
      ]);
      return {
        threads: (t.data || []).map(x => ({ ...x, mine: x.user_id === id, hasQuestion: !!x.question_key })),
        replies: (r.data || []).map(x => ({ ...x, mine: x.user_id === id }))
      };
    }
    /* EGRESS: the list ships only what a card needs. The question snapshot and
       rationale are the heaviest fields and are collapsed in the UI anyway, so
       they are fetched lazily per thread (getDiscussionQuestion) instead of
       being broadcast for every row. Reply counts come from the trigger-kept
       column, so drawing badges costs nothing. */
    const DISC_COLS = 'id,user_id,author_name,question_key,paper_title,topic,created_at,reply_count,kind,media,reaction_count';
    async function listDiscussions(opts) {
      await ensureClient(); const id = await uid();
      const limit = opts?.limit || 40;
      let q = sb.from('discussions').select(DISC_COLS).order('created_at', { ascending: false }).limit(limit);
      if (opts?.before) q = q.lt('created_at', opts.before);          // "load older" paging
      const { data } = await q;
      return (data || []).map(r => ({ ...r, mine: r.user_id === id, hasQuestion: !!r.question_key }));
    }
    /** The heavy part of one thread, fetched only when a reader opens it. */
    async function getDiscussionQuestion(discId) {
      await ensureClient();
      const { data } = await sb.from('discussions').select('question,answer_text,rationale').eq('id', discId).single();
      return data || null;
    }
    async function deleteDiscussion(discId) { await ensureClient(); const id = await uid(); if (!id) return; await sb.from('discussions').delete().eq('id', discId).eq('user_id', id); }
    async function listDiscussionReplies(discId) {
      await ensureClient(); const id = await uid();
      const { data } = await sb.from('discussion_replies').select('*').eq('discussion_id', discId).order('created_at', { ascending: true });
      return (data || []).map(r => ({ ...r, mine: r.user_id === id }));
    }
    async function addDiscussionReply(discId, body, opts) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      const { data, error } = await sb.from('discussion_replies').insert({ discussion_id: discId, user_id: id, author_name: await discAuthorName(), body, parent_id: opts?.parentId || null, media: opts?.media || [] }).select().single();
      if (error) throw error;
      return { ...data, mine: true };
    }
    async function deleteDiscussionReply(discId, replyId) { await ensureClient(); const id = await uid(); if (!id) return; await sb.from('discussion_replies').delete().eq('id', replyId).eq('user_id', id); }

    /* User-designed study notes (tags + hooks) — RLS own-all */
    async function listUserNotes() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data } = await sb.from('user_notes').select('*').eq('user_id', id).order('updated_at', { ascending: false });
      return (data || []).map(r => ({ id: r.id, title: r.title, body: r.body, hook: r.hook, tags: r.tags || [], question_key: r.question_key, created: r.created_at, updated: r.updated_at }));
    }
    async function saveUserNote(note) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      const row = { user_id: id, title: note.title || '', body: note.body || '', hook: note.hook || '', tags: note.tags || [], question_key: note.questionKey || null, updated_at: new Date().toISOString() };
      if (note.id) { const { data, error } = await sb.from('user_notes').update(row).eq('id', note.id).eq('user_id', id).select().single(); if (error) throw error; return data; }
      const { data, error } = await sb.from('user_notes').insert(row).select().single(); if (error) throw error; return data;
    }
    async function deleteUserNote(noteId) { await ensureClient(); const id = await uid(); if (!id) return; await sb.from('user_notes').delete().eq('id', noteId).eq('user_id', id); }

    /* Tea-room platform settings (poll cadence, upload cap, switches). */
    async function getTeaConfig() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'tearoom').single();
      return data?.data || null;
    }
    async function saveTeaConfig(c) {
      await ensureClient();
      const { error } = await sb.from('app_config').upsert({ id: 'tearoom', data: c || {}, updated_at: new Date().toISOString() });
      if (error) throw new Error('Could not save: ' + error.message);
      return c;
    }

    /* Model price card (USD per 1M tokens), stored in app_config so every
       device and every invoice prices from the same table. */
    async function getModelPricing() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'model_pricing').single();
      return data?.data || null;
    }
    async function saveModelPricing(t) {
      await ensureClient();
      const { error } = await sb.from('app_config').upsert({ id: 'model_pricing', data: t || {}, updated_at: new Date().toISOString() });
      if (error) throw new Error('Could not save rates: ' + error.message);
      return t;
    }

    /* ---------- Tea room v2: media, reactions, threaded comments, chat ---------- */

    /** Upload a photo/screenshot/file to the public tearoom bucket. */
    async function uploadTeaFile(file) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      const safe = String(file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-60);
      const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
      const { error } = await sb.storage.from('tearoom').upload(path, file, { cacheControl: '3600', upsert: false });
      if (error) throw new Error('Upload failed: ' + error.message);
      const { data } = sb.storage.from('tearoom').getPublicUrl(path);
      return { url: data.publicUrl, path, name: file.name, type: file.type || '', size: file.size || 0 };
    }

    async function setReaction(postId, on, emoji) {
      await ensureClient(); const id = await uid(); if (!id) return;
      if (on) await sb.from('post_reactions').upsert({ post_id: postId, user_id: id, emoji: emoji || '👍' }, { onConflict: 'post_id,user_id' });
      else await sb.from('post_reactions').delete().eq('post_id', postId).eq('user_id', id);
    }
    async function myReactions(postIds) {
      await ensureClient(); const id = await uid(); if (!id || !postIds?.length) return {};
      const { data } = await sb.from('post_reactions').select('post_id,emoji').eq('user_id', id).in('post_id', postIds);
      const m = {}; (data || []).forEach(r => m[r.post_id] = r.emoji || '👍'); return m;
    }

    /* ---- chat ---- */
    async function listChatRooms() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data: mine } = await sb.from('chat_members').select('room_id,last_read_at').eq('user_id', id);
      const ids = (mine || []).map(m => m.room_id);
      if (!ids.length) return [];
      const readAt = {}; (mine || []).forEach(m => readAt[m.room_id] = m.last_read_at);
      const [{ data: rooms }, { data: members }] = await Promise.all([
        sb.from('chat_rooms').select('*').in('id', ids).order('last_message_at', { ascending: false }),
        sb.from('chat_members').select('room_id,user_id,display_name').in('room_id', ids)
      ]);
      const byRoom = {}; (members || []).forEach(m => (byRoom[m.room_id] || (byRoom[m.room_id] = [])).push(m));
      return (rooms || []).map(r => ({ ...r, members: byRoom[r.id] || [], lastReadAt: readAt[r.id], mine: r.created_by === id }));
    }
    async function createChatRoom({ title, kind, memberIds, myName }) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      const { data: room, error } = await sb.from('chat_rooms')
        .insert({ kind: kind || 'group', title: title || null, created_by: id }).select().single();
      if (error) throw new Error('Could not create the room: ' + error.message);
      // Own membership FIRST: the policies that let you add other people check
      // membership (or creatorship) of the room, and a multi-row insert cannot
      // see its own earlier rows.
      const { error: meErr } = await sb.from('chat_members').insert({ room_id: room.id, user_id: id, display_name: myName || null });
      if (meErr) throw new Error('Could not join the room: ' + meErr.message);
      const others = (memberIds || []).filter(u => u && u !== id).map(u => ({ room_id: room.id, user_id: u }));
      if (others.length) {
        const { error: oErr } = await sb.from('chat_members').insert(others);
        if (oErr) throw new Error('Room made, but adding members failed: ' + oErr.message);
      }
      return room;
    }
    async function listChatMessages(roomId, sinceIso) {
      await ensureClient();
      let q = sb.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(60);
      if (sinceIso) q = q.gt('created_at', sinceIso);
      const { data } = await q;
      const id = await uid();
      return (data || []).reverse().map(m => ({ ...m, mine: m.user_id === id }));
    }
    async function sendChatMessage(roomId, body, media) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      const { data, error } = await sb.from('chat_messages')
        .insert({ room_id: roomId, user_id: id, author_name: await discAuthorName(), body: body || '', media: media || [] })
        .select().single();
      if (error) throw error;
      return { ...data, mine: true };
    }
    async function markRoomRead(roomId) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('chat_members').update({ last_read_at: new Date().toISOString() }).eq('room_id', roomId).eq('user_id', id);
    }
    /** One cheap poll for the chat badge: newest message time per room. */
    async function pollChat(sinceIso) {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data: mine } = await sb.from('chat_members').select('room_id').eq('user_id', id);
      const ids = (mine || []).map(m => m.room_id);
      if (!ids.length) return [];
      const { data } = await sb.from('chat_messages')
        .select('id,room_id,user_id,author_name,body,created_at')
        .in('room_id', ids).gt('created_at', sinceIso || new Date(Date.now() - 60000).toISOString())
        .order('created_at', { ascending: true }).limit(120);
      return (data || []).map(m => ({ ...m, mine: m.user_id === id }));
    }
    /** Everyone who could be added to a room, with their avatar. */
    async function listChatPeople() {
      await ensureClient(); const id = await uid();
      const { data } = await sb.from('profiles').select('id,name,email,avatar_url').neq('id', id).limit(200);
      return (data || []).map(p => ({ id: p.id, name: p.name || (p.email || '').split('@')[0], avatar: p.avatar_url || '' }));
    }
    /** Name + avatar for everyone, so the wall and chat can show faces. */
    async function listMemberCards() {
      await ensureClient();
      const { data } = await sb.from('profiles').select('id,name,email,avatar_url').limit(300);
      const m = {};
      (data || []).forEach(p => m[p.id] = { name: p.name || (p.email || '').split('@')[0], avatar: p.avatar_url || '' });
      return m;
    }

    /* ---- profile picture ---- */
    async function uploadAvatar(file) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Not signed in.');
      const ext = (file.name || '').split('.').pop().replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
      const path = `${id}/avatar-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' });
      if (error) throw new Error('Upload failed: ' + error.message);
      const { data } = sb.storage.from('avatars').getPublicUrl(path);
      await sb.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', id);
      return data.publicUrl;
    }

    /* ---- cross-device notification state ----
       Seen marks live on the profile row, so reading on one device clears the
       badge on every other. */
    async function getNotifSeen() {
      await ensureClient(); const id = await uid(); if (!id) return {};
      const { data } = await sb.from('profiles').select('notif_seen').eq('id', id).single();
      return data?.notif_seen || {};
    }
    async function setNotifSeen(patch) {
      await ensureClient(); const id = await uid(); if (!id) return;
      const cur = await getNotifSeen();
      await sb.from('profiles').update({ notif_seen: { ...cur, ...patch } }).eq('id', id);
    }

    /* AI feature registry (app_config), shared pools, question tags */
    async function getAiFeatures() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'ai_features').single();
      return data?.data || {};
    }
    async function saveAiFeatures(cfgData) {
      await ensureClient();
      await sb.from('app_config').upsert({ id: 'ai_features', data: cfgData, updated_at: new Date().toISOString() });
      return cfgData;
    }
    async function listSharedUsage() {
      await ensureClient();
      const rows = await pageAll(() => sb.from('ai_shared_usage')
        .select('feature, day, provider, model, calls, input_tokens, output_tokens')
        .order('feature').order('day').order('provider').order('model'));
      return rows.map(r => ({ feature: r.feature, day: r.day, provider: r.provider, model: r.model,
        calls: r.calls || 0, inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0 }));
    }
    async function saveQuestionTags(rows) {
      await ensureClient(); if (!rows?.length) return;
      const { error } = await sb.from('question_tags').upsert(rows.map(r => ({
        question_key: r.questionKey, topic: r.topic || '', category: r.category || '',
        guideline: r.guideline || '', tags: r.tags || [], difficulty_est: r.difficulty ?? null,
        tagged_by: r.taggedBy || '', updated_at: new Date().toISOString()
      })));
      if (error) throw new Error('Could not save tags: ' + error.message);
    }
    async function listQuestionTags() {
      await ensureClient();
      const rows = await pageAll(() => sb.from('question_tags')
        .select('question_key, topic, category, guideline, tags, difficulty_est').order('question_key'));
      return rows.map(r => ({ questionKey: r.question_key, topic: r.topic, category: r.category,
        guideline: r.guideline, tags: r.tags || [], difficulty: r.difficulty_est }));
    }

    /* registration control + user approval status (dev-only writes: the
       protect trigger reverts non-dev changes to profiles.status) */
    async function getRegistrationOpen() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'registration').single();
      return data?.data?.open !== false;
    }
    async function setRegistrationOpen(open) {
      await ensureClient();
      await sb.from('app_config').upsert({ id: 'registration', data: { open: !!open }, updated_at: new Date().toISOString() });
    }
    async function setUserStatus(userId, status) {
      await ensureClient();
      await sb.from('profiles').update({ status }).eq('id', userId);
    }

    /* peer-review proposals: any user proposes, the developer decides */
    async function submitProposal(pr) {
      await ensureClient(); const id = await uid(); if (!id) throw new Error('Sign in first.');
      const { error } = await sb.from('question_edit_proposals')
        .insert({ question_key: pr.questionKey, reviewer_id: id, proposed: pr.proposed, note: pr.note || '' });
      if (error) throw new Error(error.message);
    }
    async function listMyProposals() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data } = await sb.from('question_edit_proposals').select('id, question_key, proposed, note, status, created_at')
        .eq('reviewer_id', id).order('created_at', { ascending: false });
      return (data || []).map(r => ({ id: r.id, questionKey: r.question_key, proposed: r.proposed, note: r.note, status: r.status, created: r.created_at }));
    }
    async function listProposals() {
      await ensureClient();
      const { data, error } = await sb.from('question_edit_proposals')
        .select('id, question_key, reviewer_id, proposed, note, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const { data: profs } = await sb.from('profiles').select('id, name, email');
      const who = {}; (profs || []).forEach(x => who[x.id] = x);
      return (data || []).map(r => ({ id: r.id, questionKey: r.question_key, proposed: r.proposed, note: r.note || '',
        status: r.status, created: r.created_at,
        reviewerName: who[r.reviewer_id]?.name || '', reviewerEmail: who[r.reviewer_id]?.email || r.reviewer_id }));
    }
    async function setProposalStatus(id, status) {
      await ensureClient();
      await sb.from('question_edit_proposals').update({ status, decided_at: new Date().toISOString() }).eq('id', id);
    }
    /* flagged questions + anonymous reasons for the peer-review tab */
    async function listFlaggedDetails() {
      await ensureClient();
      const { data } = await sb.rpc('list_flagged_details');
      return (data || []).map(r => ({ questionKey: r.question_key, notes: r.notes || [] }));
    }

    /* declined drive papers: never publish, never re-show in scans */
    async function getDeclinedPapers() {
      await ensureClient();
      const { data } = await sb.from('app_config').select('data').eq('id', 'declined_papers').single();
      return data?.data?.keys || [];
    }
    async function declinePaper(key) {
      await ensureClient();
      const keys = await getDeclinedPapers();
      if (!keys.includes(key)) keys.push(key);
      await sb.from('app_config').upsert({ id: 'declined_papers', data: { keys }, updated_at: new Date().toISOString() });
    }

    /* essay papers (dev-published, everyone reads) */
    async function getEssayPapers() {
      return (await catalogue('the essay papers', () => sb.from('essay_papers').select('id,meta').order('id'))).map(r => r.meta);
    }
    async function publishEssayPaper(meta) { await ensureClient(); await sb.from('essay_papers').upsert({ id: meta.id, meta }); return meta; }
    async function unpublishEssayPaper(id) { await ensureClient(); await sb.from('essay_papers').delete().eq('id', id); }

    /* ---- CPD (TOG true/false) ---- */
    async function getCpdVolumes() {
      return (await catalogue('the CPD volumes', () => sb.from('cpd_volumes').select('id,meta').order('id'))).map(r => r.meta);
    }
    async function publishCpdVolume(meta) { await ensureClient(); await sb.from('cpd_volumes').upsert({ id: meta.id, meta }); return meta; }
    async function unpublishCpdVolume(id) { await ensureClient(); await sb.from('cpd_volumes').delete().eq('id', id); }
    async function getCpdProgress() {
      await ensureClient(); const id = await uid(); if (!id) return {};
      const { data } = await sb.from('cpd_progress').select('qkey,volume_id,section_id,answer,correct').eq('user_id', id);
      const m = {}; (data || []).forEach(r => m[r.qkey] = r); return m;
    }
    async function saveCpdAnswer(row) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('cpd_progress').upsert({ user_id: id, ...row });
    }
    async function resetCpdSection(volumeId, sectionId) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('cpd_progress').delete().eq('user_id', id).eq('volume_id', volumeId).eq('section_id', sectionId);
    }
    /* per-user essay feedback */
    async function saveEssayFeedback(fb) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const row = { user_id: id, code: fb.code, data: fb, paper: fb.paper || String(fb.code || '').split('-')[0], percent: fb.score?.percent ?? null, band: fb.score?.band ?? null, created_at: new Date().toISOString() };
      await sb.from('essay_feedback').upsert(row, { onConflict: 'user_id,code' });
      return fb;
    }
    async function listEssayFeedback() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const { data } = await sb.from('essay_feedback').select('data, created_at').eq('user_id', id).order('created_at', { ascending: false });
      return (data || []).map(r => Object.assign({ created: r.created_at }, r.data));
    }
    async function getEssayFeedback(code) {
      await ensureClient(); const id = await uid(); if (!id) return null;
      const { data } = await sb.from('essay_feedback').select('data').eq('user_id', id).eq('code', code).single();
      return data?.data || null;
    }
    async function deleteEssayFeedback(code) {
      await ensureClient(); const id = await uid(); if (!id) return;
      await sb.from('essay_feedback').delete().eq('user_id', id).eq('code', code);
    }

    /* True token meter, one row per user × day × provider × model
       (developer — "tokens dev read" policy; users see only their own rows).
       Feeds the Users panel cost columns and the invoice generator. */
    async function listAiTokenUsage() {
      await ensureClient();
      const rows = await pageAll(() => sb.from('ai_token_usage')
        .select('user_id, day, provider, model, feature, calls, input_tokens, output_tokens')
        .order('day').order('user_id').order('provider').order('model'));
      return rows.map(r => ({ userId: r.user_id, day: r.day, provider: r.provider, model: r.model, feature: r.feature || 'tutor',
        calls: r.calls || 0, inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0 }));
    }
    /* the signed-in user's OWN metered tokens (RLS "own tokens read"); the
       eq() is belt-and-braces on top of the row-level policy. */
    async function listMyTokenUsage() {
      await ensureClient(); const id = await uid(); if (!id) return [];
      const rows = await pageAll(() => sb.from('ai_token_usage')
        .select('day, provider, model, feature, calls, input_tokens, output_tokens')
        .eq('user_id', id).order('day'));
      return rows.map(r => ({ userId: id, day: r.day, provider: r.provider, model: r.model, feature: r.feature || 'tutor',
        calls: r.calls || 0, inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0 }));
    }
    /* eligible-user counts per shared-split policy (no PII) for a user's own
       share of the shared pools */
    async function getEligibleCounts() {
      await ensureClient();
      try { const { data } = await sb.rpc('ai_eligible_counts'); return data || { all: 1, simulator: 1, dev: 1 }; }
      catch { return { all: 1, simulator: 1, dev: 1 }; }
    }

    /* AI auth token for the Cloudflare function */
    async function getAccessToken() { await ensureClient(); const { data } = await sb.auth.getSession(); return data.session?.access_token || null; }

    return { init, signUp, signIn, signOut, requestPasswordReset, updatePassword, onPasswordRecovery, currentUser, updateProfile,
      getRegistrationOpen, setRegistrationOpen, setUserStatus, submitProposal, listMyProposals, listProposals, setProposalStatus, listFlaggedDetails, getDeclinedPapers, declinePaper,
      getEssayPapers, publishEssayPaper, unpublishEssayPaper, saveEssayFeedback, listEssayFeedback, getEssayFeedback, deleteEssayFeedback,
      getCpdVolumes, publishCpdVolume, unpublishCpdVolume, getCpdProgress, saveCpdAnswer, resetCpdSection,
      getProgress, recordAttempt, getAttempt, addXp, resetProgress,
      getOsceStations, getOsceStation, getOsceSearchIndex, publishOsceStation, unpublishOsceStation,
      moveOsceStations, getOsceCollections, saveOsceCollections, getGroqConfig, saveGroqConfig,
      getOsceBlueprint, saveOsceBlueprint, tagOsceStations, listOsceDecks, saveOsceDeck, deleteOsceDeck,
      listOsceAttempts, getOsceAttempt,
      saveOsceAttempt, deleteOsceAttempt, uploadOsceAudio, getOsceAudioUrl, sweepOsceAudio,
      /* case discussions — the SAME names in both backends, always */
      getCases, getCase, publishCase, unpublishCase,
      listCaseAttempts, getCaseAttempt, saveCaseAttempt, deleteCaseAttempt,
      uploadCaseAudio, getCaseAudioUrl, sweepCaseAudio,
      uploadOsceImage, osceImageUrl, deleteOsceImage,
      getWalletConfig, saveWalletConfig, listMyTopUps, createTopUp, createTopUpFor,
      listAllTopUps, setTopUpStatus,
      getPublishedPapers, getPaperContent, getPaperContents, publishPaper, unpublishPaper,
      getExamDate, setExamDate, saveSession, loadSession, clearSession, listSessions,
      getNote, saveNote, getNotesForPaper, listAllNotes, getCustomCurriculum, saveCustomCurriculum,
      saveAiItem, saveAiChat, listAiItems, deleteAiItem, getQuestionEdit, saveQuestionEdit,
      getUserQuestionEdit, saveUserQuestionEdit, listExcludedQuestions,
      getFlashcardDecks, publishFlashcardDeck, unpublishFlashcardDeck,
      getCardProgress, saveCardProgress, listAllCardProgress,
      getBlueprint, saveBlueprint, saveMockResult, listMockResults, getMockResult,
      listReviewItems, saveReviewItem, removeReviewItem, listAllUsers, setUserFeature, setPref, listAiUsage, listAiTokenUsage, listMyTokenUsage, getEligibleCounts,
      logEvents, listRecentEvents, bumpQuestionStats, listQuestionStats, saveCohortScore, listCohortScores,
      listAllFlags, resolveFlags, listGlobalFlaggedKeys, saveUserDeck, listUserDecks, deleteUserDeck,
      addDiscussion, listDiscussions, deleteDiscussion, listDiscussionReplies, addDiscussionReply, deleteDiscussionReply, pollDiscussions, getDiscussionQuestion,
      listUserNotes, saveUserNote, deleteUserNote,
      uploadTeaFile, setReaction, myReactions, listChatRooms, createChatRoom, listChatMessages, sendChatMessage, markRoomRead, pollChat, listChatPeople,
      listMemberCards, uploadAvatar, getNotifSeen, setNotifSeen,
      getAiFeatures, saveAiFeatures, getModelPricing, saveModelPricing, getTeaConfig, saveTeaConfig, listSharedUsage, saveQuestionTags, listQuestionTags, getAccessToken };
  })();

  const impl = useCloud ? Cloud : Local;
  return Object.assign({ mode: useCloud ? 'cloud' : 'local' }, impl);
})();
