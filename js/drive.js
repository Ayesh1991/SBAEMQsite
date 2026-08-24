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
   ============================================================ */

const Drive = (() => {
  const cfg = () => window.AUREUM_CONFIG || {};
  /* `driveSave`, NOT `drive` — that key already belongs to the question
     pipeline (the shared folders the importer reads), and a second one of
     the same name would have silently replaced it. */
  const conf = () => cfg().driveSave || {};
  const KEY = 'aureum.drive';

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
    if (!configured()) return { code: S.OFF, label: 'Drive saving is not set up on this deployment' };
    const st = state();
    if (!st.folderId) return { code: S.OUT, label: 'Not connected to Drive' };
    if (st.lapsed) {
      return { code: S.STALE, folder: st.folderName,
        label: `Drive needs reconnecting — the last upload was refused${st.lapsedAt
          ? ' on ' + new Date(st.lapsedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : ''}` };
    }
    return { code: S.ON, folder: st.folderName, since: st.since, saved: st.saved || 0,
      last: st.lastAt || 0,
      label: `Saving to “${st.folderName || 'your Drive folder'}”` };
  }
  const on = () => status().code === S.ON;

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
  function token(interactive) {
    if (tok && Date.now() < tokExp - 60000) return Promise.resolve(tok);
    return new Promise((res, rej) => {
      try {
        client = client || google.accounts.oauth2.initTokenClient({
          client_id: clientId(),
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: () => {}
        });
        client.callback = r => {
          if (r && r.access_token) {
            tok = r.access_token;
            tokExp = Date.now() + (Number(r.expires_in || 3600) * 1000);
            save({ lapsed: false, lapsedAt: 0 });
            res(tok);
          } else {
            markLapsed();
            rej(new Error(r?.error_description || r?.error || 'Google did not return a token.'));
          }
        };
        client.error_callback = e => { markLapsed(); rej(new Error(e?.message || 'The Drive sign-in was dismissed.')); };
        client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      } catch (e) { rej(e); }
    });
  }
  function markLapsed() {
    tok = null; tokExp = 0;
    if (state().folderId) save({ lapsed: true, lapsedAt: Date.now() });
    ping();
  }

  /* ---------------- connecting ---------------- */

  /** Let the user pick (or create) the folder. Returns the new status. */
  async function connect() {
    if (!configured()) throw new Error('No Google client ID is configured for this deployment.');
    await ready();
    await token(true);
    const folder = await pickFolder();
    save({ folderId: folder.id, folderName: folder.name, since: Date.now(), lapsed: false, lapsedAt: 0 });
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
    if (!on()) return null;
    const st = state();
    await ready();
    let t;
    try { t = await token(false); }              // silent — never a popup mid-station
    catch { markLapsed(); return null; }

    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify({
      name, parents: [st.folderId],
      description: meta.description || 'AUREUM OSCE recording',
      appProperties: Object.assign({ aureum: '1' }, meta.properties || {})
    })], { type: 'application/json' }));
    body.append('file', blob);

    let res;
    try {
      res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body });
    } catch { return null; }
    if (res.status === 401 || res.status === 403) { markLapsed(); return null; }
    if (!res.ok) return null;
    const d = await res.json().catch(() => ({}));
    if (!d.id) return null;
    save({ saved: (st.saved || 0) + 1, lastAt: Date.now(), lastName: name, lapsed: false });
    ping();
    return { id: d.id, name: d.name, link: d.webViewLink || `https://drive.google.com/file/d/${d.id}/view` };
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
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return { S, status, on, configured, connect, disconnect, upload, nameFor, onChange, badgeHtml, markLapsed };
})();
