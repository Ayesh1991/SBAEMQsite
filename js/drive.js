/* ============================================================
   drive.js — keeping OSCE recordings in the candidate's own Drive.

   WHY THIS SHAPE

   The recording is swept off the server after 24 hours, because storage
   is finite and it is not the app's to keep. But the value of hearing
   your own answer is highest a fortnight later, revising for the real
   thing. So the tape goes into the candidate's OWN Drive: unlimited by
   anything AUREUM pays for, owned by the person who spoke, and gone the
   moment they delete the folder.

   THE SCOPE IS `drive.file`, AND THAT MATTERS

   It grants access ONLY to files this app created, plus files the user
   hands over through the Picker. It cannot see the rest of the Drive —
   not documents, not photos. It is also classified non-sensitive, which
   is what keeps this out of Google's paid security assessment.

   The consequence to be honest about: a file dropped into the folder by
   hand is invisible to us. This is a place we WRITE to, never a folder
   we read back wholesale.

   NEVER LOAD-BEARING

   Marking never waits for Drive and never fails because of it. The
   upload happens after an attempt is saved, in the background, and a
   failure is recorded and shown rather than retried into oblivion. The
   whole module answers `false` to everything when it is not connected.

   THE TOKEN LASTS AN HOUR, THE CONSENT ABOUT A WEEK

   A browser-side token client gives a one-hour access token and no
   refresh token — deliberately, because storing refresh tokens for
   every user means holding long-lived Google credentials for a feature
   whose entire point is that the file is theirs. While the OAuth app is
   in Testing, Google expires the grant after about seven days, so the
   connection lapses and has to be re-made. That is why the state is
   shown wherever it matters rather than discovered when a tape is lost.

   WHY THE PROBE AND THE OUTBOX EXIST

   A lapsed grant used to be discovered at the worst possible moment: on
   the upload, after fifteen minutes had been spoken, in a `catch {}`
   that said nothing. The tape then sat on the server for twenty-four
   hours and was swept. Several stations went that way before anyone
   noticed the folder had stopped filling.

   Two changes stop that happening again, and they are deliberately at
   opposite ends of the recording:

   • `probe()` runs BEFORE the clock starts. It asks Google for a token
     silently, which is free when one is already held and cheap when it
     is not, and it costs nothing but a second at a moment when a
     "reconnect" prompt is merely a mild annoyance. Discovering the same
     fact after the tape exists is a loss.

   • `deposit()` is the ONLY way a recording is offered to Drive, and it
     writes the tape into an outbox whenever it cannot go — disconnected,
     lapsed, refused, offline. The outbox is what makes the failure
     countable and recoverable instead of invisible. `upload()` remains
     for the catch-up sweep, which already knows what it is doing.
   ============================================================ */

const Drive = (() => {
  const cfg = () => window.AUREUM_CONFIG || {};
  /* `driveSave`, NOT `drive` — that key already belongs to the question
     pipeline (the shared folders the importer reads), and a second one of
     the same name would have silently replaced it. */
  const conf = () => cfg().driveSave || {};
  const KEY = 'aureum.drive';
  const OUT_KEY = 'aureum.drive.outbox';

  const S = {
    OFF: 'off',                 // no client id configured at all
    OUT: 'disconnected',        // configured, never connected or signed out
    STALE: 'stale',             // was connected; the grant has lapsed
    ON: 'connected'
  };

  let tok = null, tokExp = 0, client = null, loading = null;

  const state = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const save = o => { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(state(), o))); } catch {} };
  const clientId = () => conf().clientId || '';
  const configured = () => !!clientId();

  /** Everything a badge needs, without a network call. */
  function status() {
    const waiting = pending().length;
    if (!configured()) return { code: S.OFF, waiting: 0, label: 'Drive saving is not set up on this deployment' };
    const st = state();
    if (!st.folderId) return { code: S.OUT, waiting, label: 'Not connected to Drive' };
    if (st.lapsed) {
      return { code: S.STALE, folder: st.folderName, waiting, error: st.lastError || '',
        label: `Drive needs reconnecting — the last upload was refused${st.lapsedAt
          ? ' on ' + new Date(st.lapsedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : ''}` };
    }
    return { code: S.ON, folder: st.folderName, since: st.since, saved: st.saved || 0,
      last: st.lastAt || 0, waiting, error: st.lastError || '',
      label: `Saving to “${st.folderName || 'your Drive folder'}”` };
  }
  const on = () => status().code === S.ON;

  /* ---------------- the outbox ----------------

     A recording that could not be copied is written down here, so that
     "it did not go" is a number on a screen rather than an absence
     nobody can see. Entries carry the SERVER path, not the tape: the
     blob may be tens of megabytes and localStorage is not the place for
     it, and while the tape is still within its twenty-four hours the
     path is enough to fetch it back and send it up.

     Capped, oldest dropped first. A queue that grows without limit
     eventually breaks the storage it lives in, and the twenty oldest
     misses are of no interest once they are past their sweep. */

  const OUT_MAX = 40;
  function pending() {
    try {
      const a = JSON.parse(localStorage.getItem(OUT_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch { return []; }
  }
  function writeOut(list) {
    try { localStorage.setItem(OUT_KEY, JSON.stringify(list.slice(-OUT_MAX))); } catch {}
  }
  /** Note that a tape did not make it. Idempotent on `id`. */
  function remember(t) {
    if (!t || !t.id) return;
    const list = pending().filter(x => x.id !== t.id);
    list.push({
      id: t.id, kind: t.kind || 'osce', topic: t.topic || '', path: t.path || '',
      when: t.when || Date.now(), noted: Date.now(), why: t.why || ''
    });
    writeOut(list);
    ping();
  }
  function forget(id) {
    const list = pending();
    const next = list.filter(x => x.id !== id);
    if (next.length !== list.length) { writeOut(next); ping(); }
  }
  function forgetAll() { writeOut([]); ping(); }

  /* Past its twenty-four hours the server copy is gone and the row can
     only mislead — it promises a recovery that cannot happen. */
  const recoverable = () => pending().filter(x => x.path && (Date.now() - (x.when || 0)) < 24 * 3600e3);

  /* ---------------- Google's scripts, loaded once and only if needed ---------------- */

  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some(s => s.src === src)) return res();
      const el = document.createElement('script');
      el.src = src; el.async = true; el.defer = true;
      el.onload = () => res(); el.onerror = () => rej(new Error('Google could not be reached.'));
      document.head.appendChild(el);
    });
  }
  async function ready() {
    if (loading) return loading;
    loading = (async () => {
      await loadScript('https://accounts.google.com/gsi/client');
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise(res => gapi.load('picker', res));
    })();
    return loading;
  }

  /**
   * An access token. `interactive` decides whether the user may be shown a
   * consent screen — silent renewal first, because being thrown a popup
   * mid-station would be worse than losing the upload.
   */
  /* WHAT ACTUALLY MEANS "THE GRANT IS GONE".

     This distinction is the whole of a bug that made people reconnect to
     Drive several times a week when Google's own expiry is weekly at
     worst. A silent token request fails for two completely different
     kinds of reason, and the old code treated them as one:

       • The grant really is gone, or Google wants the user to say yes
         again — `access_denied`, `consent_required`, `interaction_required`,
         `login_required`. Reconnecting is the only fix.

       • Nothing is wrong with the grant at all. The browser blocked the
         popup Google wanted to open (Safari does this to any popup not
         opened by a tap — and the probe before a station is not a tap),
         the tab was in the background, the network hiccuped, or the
         person closed the window. On iPad these are the COMMON case.

     The second kind used to latch `lapsed`, and `deposit()` then refused
     to try at all until somebody pressed Reconnect. One blocked popup on
     the brief screen therefore cost a manual reconnection, every time.

     So: only the first kind latches. The second clears the cached token
     and leaves the connection exactly as it was, to be tried again at the
     next upload — which is the moment that matters, and which by then may
     well succeed. */
  const GONE_RE = /access_denied|consent_required|interaction_required|login_required|invalid_grant|expired|revoked/i;
  const isGrantGone = e => GONE_RE.test(String(e?.error || e?.type || e?.message || e || ''));

  function token(interactive) {
    if (tok && Date.now() < tokExp - 60000) return Promise.resolve(tok);
    return new Promise((res, rej) => {
      try {
        client = client || google.accounts.oauth2.initTokenClient({
          client_id: clientId(),
          scope: 'https://www.googleapis.com/auth/drive.file',
          /* Whom to sign in as. Without it Google offers the account
             chooser to anybody signed into more than one account, which
             needs a popup — and a popup is the thing that gets blocked.
             It is a hint, not a restriction: the user can still pick
             another account on the consent screen. */
          hint: state().email || '',
          callback: () => {}
        });
        client.callback = r => {
          if (r && r.access_token) {
            tok = r.access_token;
            tokExp = Date.now() + (Number(r.expires_in || 3600) * 1000);
            save({ lapsed: false, lapsedAt: 0, lastError: '' });
            res(tok);
          } else {
            softFail(r, 'Google did not return a token.');
            rej(new Error(r?.error_description || r?.error || 'Google did not return a token.'));
          }
        };
        client.error_callback = e => {
          softFail(e, 'The Drive sign-in did not open.');
          rej(new Error(e?.message || 'The Drive sign-in was dismissed.'));
        };
        /* 'consent' only when the user pressed Connect and is expecting a
           screen. A renewal asks for no prompt, so a live grant renews
           without anything appearing. */
        client.requestAccessToken({ prompt: interactive ? 'consent' : '', hint: state().email || '' });
      } catch (e) { rej(e); }
    });
  }

  /** A failed token request: latch only when the grant is genuinely gone. */
  function softFail(e, fallback) {
    tok = null; tokExp = 0;
    if (isGrantGone(e)) markLapsed(e?.error_description || e?.message || fallback);
    else ping();
  }

  function markLapsed(why) {
    tok = null; tokExp = 0;
    if (state().folderId) save({ lapsed: true, lapsedAt: Date.now(), lastError: why || '' });
    ping();
  }

  /**
   * Is the grant still alive? Asked BEFORE a recording starts, never
   * after — see the header. Returns the status either way and never
   * throws, because a caller about to start a clock must not be made to
   * handle a Drive error.
   *
   * A token still in hand answers instantly and costs nothing, so this
   * is safe to call on every station. When one has to be fetched it is
   * fetched silently: a consent popup in front of a candidate about to
   * be examined would be worse than the lapse it is reporting.
   */
  async function probe() {
    if (!configured() || !state().folderId) return status();
    /* The probe REPORTS; it does not condemn. token() has already latched
       the connection if Google genuinely refused, so a rejection reaching
       here is either that (already recorded) or one of the harmless kinds
       — a blocked popup, a dropped network, a backgrounded tab. This used
       to call markLapsed on all of them, which is how a probe run
       automatically before every station, without a tap and therefore with
       its popup blocked, came to demand a manual reconnection several
       times a week. */
    try { await ready(); await token(false); save({ lapsed: false, lapsedAt: 0, lastError: '' }); }
    catch (e) { if (!state().lapsed) save({ lastError: e?.message || 'Drive could not be checked just now.' }); }
    ping();
    return status();
  }

  /* ---------------- connecting ---------------- */

  /** Let the user pick (or create) the folder. Returns the new status. */
  async function connect() {
    if (!configured()) throw new Error('No Google client ID is configured for this deployment.');
    await ready();
    await token(true);
    const folder = await pickFolder();
    save({ folderId: folder.id, folderName: folder.name, since: Date.now(), lapsed: false, lapsedAt: 0 });
    /* WHICH GOOGLE ACCOUNT THIS IS.

       Asked once, here, and only so that a later silent renewal can name
       the account instead of putting up a chooser — the chooser needs a
       popup and the popup is what gets blocked. `drive.file` is enough to
       read this one field, and if it is refused nothing is stored and the
       renewal behaves exactly as it did before. */
    try {
      const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
        { headers: { Authorization: 'Bearer ' + tok } });
      const who = r.ok ? (await r.json().catch(() => ({}))) : null;
      const email = who?.user?.emailAddress || '';
      if (email) save({ email });
    } catch { /* a hint we do not have is a hint we do not pass */ }
    ping();
    return status();
  }

  function pickFolder() {
    return new Promise((res, rej) => {
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder');
      const b = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(tok)
        .setTitle('Choose a folder for your OSCE recordings')
        .setCallback(d => {
          if (d.action === google.picker.Action.PICKED) {
            const f = d.docs?.[0];
            f ? res({ id: f.id, name: f.name || 'Drive folder' }) : rej(new Error('Nothing was chosen.'));
          } else if (d.action === google.picker.Action.CANCEL) {
            rej(new Error('No folder was chosen.'));
          }
        });
      if (conf().apiKey) b.setDeveloperKey(conf().apiKey);
      if (conf().appId) b.setAppId(conf().appId);
      b.build().setVisible(true);
    });
  }

  function disconnect() {
    try { if (tok) google.accounts.oauth2.revoke(tok, () => {}); } catch {}
    tok = null; tokExp = 0;
    try { localStorage.removeItem(KEY); } catch {}
    ping();
  }

  /* ---------------- uploading ----------------
     Multipart, because a fifteen-minute tape at 24 kbps is about 3 MB and
     resumable uploads buy nothing at that size but a second round trip. */

  async function upload(blob, name, meta = {}) {
    /* A folder is what this needs, not a clean bill of health: a stale
       `lapsed` must never be the reason a tape is not even attempted.
       If the grant really is gone the token request says so in a second
       and the tape goes to the outbox exactly as before. */
    if (!configured() || !state().folderId) return null;
    const st = state();
    await ready();
    let t;
    /* Silent — never a popup mid-station. A failure here does NOT by
       itself mean the grant is gone (see isGrantGone): token() has
       already latched it if it was, and if it was not then the tape goes
       to the outbox and the next upload tries again. */
    try { t = await token(false); }
    catch (e) { save({ lastError: e?.message || 'Google would not renew the permission.' }); ping(); return null; }

    const body = () => {
      const f = new FormData();
      f.append('metadata', new Blob([JSON.stringify({
        name, parents: [st.folderId],
        description: meta.description || 'AUREUM OSCE recording',
        appProperties: Object.assign({ aureum: '1' }, meta.properties || {})
      })], { type: 'application/json' }));
      f.append('file', blob);
      return f;
    };

    /* Two goes, because the failure this most often meets is a phone
       changing network between the lift and the corridor, and one retry
       turns most of those into a success. A refusal is never retried:
       401 and 403 mean the grant is gone and asking again is asking the
       same question louder. */
    let last = '';
    for (let go = 0; go < 2; go++) {
      let res;
      try {
        res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
          { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: body() });
      } catch (e) {
        last = 'The connection dropped while the recording was going up.';
        if (go === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
        break;
      }
      if (res.status === 401 || res.status === 403) {
        markLapsed('Google refused the upload — the permission has expired.');
        return null;
      }
      if (!res.ok) {
        last = `Google refused the upload (HTTP ${res.status}).`;
        if (res.status >= 500 && go === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
        break;
      }
      const d = await res.json().catch(() => ({}));
      if (!d.id) { last = 'Google accepted the upload but named no file.'; break; }
      save({ saved: (st.saved || 0) + 1, lastAt: Date.now(), lastName: name, lapsed: false, lastError: '' });
      ping();
      return { id: d.id, name: d.name, link: d.webViewLink || `https://drive.google.com/file/d/${d.id}/view` };
    }
    save({ lastError: last });
    ping();
    return null;
  }

  /**
   * THE ONLY WAY A RECORDING IS OFFERED TO DRIVE.
   *
   * `track` is the tape's identity — { kind, id, topic, when, path } —
   * and passing it is what makes a miss visible. The rule this enforces
   * is that a caller may decide WHETHER a tape is worth keeping, but it
   * cannot decide to lose one quietly: every path out of here either
   * returns a file or leaves a row in the outbox saying why it did not.
   *
   * Never throws. The marking is the deliverable; this is the bonus.
   */
  async function deposit(blob, name, meta = {}, track = null) {
    if (!configured()) return null;
    const note = why => { if (track) remember(Object.assign({}, track, { why })); };
    /* NOT CONNECTING IS A CHOICE; STOPPING IS A FAULT.
       A candidate who never chose a folder is not owed a queue of things
       that did not go there, and filling one would put a permanent
       complaint on their billing page about a feature they declined. The
       outbox exists for the case that actually cost recordings: a folder
       that WAS taking tapes and quietly stopped. */
    if (!state().folderId) return null;
    /* A LAPSED FLAG IS A WARNING, NOT A LOCK.

       This used to return here without trying, so a connection marked
       stale by one blocked popup stayed stale until somebody pressed
       Reconnect — and every recording in between went to the outbox
       untried. The flag is worth showing; it is not worth refusing on.
       Trying costs one silent token request, and succeeding clears the
       flag by itself. */
    let up = null;
    try { up = await upload(blob, name, meta); }
    catch (e) { note(e?.message || 'The upload failed.'); return null; }
    if (!up) { note(state().lastError || 'The upload failed.'); return null; }
    if (track) forget(track.id);
    return up;
  }

  /** A tidy, sortable name so a year of these is still navigable. */
  function nameFor(topic, when, ext) {
    const d = new Date(when || Date.now());
    const p = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
    const safe = String(topic || 'OSCE station').replace(/[\\/:*?"<>|]/g, '-').slice(0, 70).trim();
    return `${stamp} — ${safe}.${ext || 'webm'}`;
  }

  /* ---------------- telling the app ---------------- */

  const watchers = new Set();
  function onChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
  function ping() { watchers.forEach(fn => { try { fn(status()); } catch {} }); }

  /** The badge, wherever it is wanted. */
  function badgeHtml() {
    const s = status();
    if (s.code === S.OFF) return '';
    const dot = { disconnected: 'off', stale: 'warn', connected: 'on' }[s.code] || 'off';
    return `<span class="dv-badge is-${dot}" title="${esc(s.label)}"><i></i>${
      s.code === 'connected' ? 'Drive' : s.code === 'stale' ? 'Drive — reconnect' : 'Drive off'}</span>`;
  }

  /**
   * THE ALARM.
   *
   * Shown where a recording is about to be made or has just been made,
   * and nowhere else — a warning on every page is a warning nobody
   * reads. Silent when Drive is off for this deployment (nothing to
   * say), and silent when it is working (a green light on every screen
   * is noise).
   *
   * `when` is 'before' or 'after', because the two moments want
   * different words: before a station the fix is free, after one the
   * honest thing is to say what is now at risk and by when.
   */
  function warnHtml(when) {
    const s = status();
    if (s.code === S.OFF || s.code === S.ON) return '';
    const stale = s.code === S.STALE;
    /* Someone who has never connected a folder is invited on the report,
       once the tape exists and the 24-hour clock is a real fact. They are
       not nagged on the way INTO a station about a feature they have not
       asked for — a banner shown before every station is a banner nobody
       reads by the third one, including when it finally matters. */
    if (!stale && when !== 'after') return '';
    const head = stale
      ? '⚠ Drive has stopped taking your recordings'
      : '☁ Your recordings are not being copied to Drive';
    const body = when === 'after'
      ? (stale
        ? `Google ends the permission after about a week. This tape is on the AUREUM server for 24 hours — reconnect
           within that time and it can still be copied up. After that it is gone.`
        : `This tape is on the AUREUM server for 24 hours and then swept. Connect a folder and it can be copied up
           before then.`)
      : (stale
        ? `Google ended the permission — nothing has been copied since. Two taps now and this station is saved.`
        : `Nothing recorded here is being kept beyond 24 hours. Connect a folder once and every station after it is
           yours to keep.`);
    const wait = s.waiting
      ? ` <strong>${s.waiting} recording${s.waiting === 1 ? '' : 's'}</strong> ${s.waiting === 1 ? 'is' : 'are'} waiting.`
      : '';
    return `<div class="dv-warn is-${stale ? 'stale' : 'out'}">
      <p><strong>${head}</strong></p>
      <p class="tiny">${body}${wait}</p>
      <a class="btn btn-ghost btn-sm" href="#/billing">${stale ? 'Reconnect Drive' : 'Connect a folder'} →</a>
    </div>`;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return { S, status, on, configured, connect, disconnect, upload, deposit, probe, nameFor,
    onChange, badgeHtml, warnHtml, markLapsed,
    pending, recoverable, remember, forget, forgetAll };
})();
