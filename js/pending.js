/* ============================================================
   pending.js — work that was recorded but never marked.

   THE PROBLEM THIS EXISTS FOR

   You sit a station, or present a case, in a ward with one bar of
   signal. You press Mark. The request fails. Until now that was the end
   of it: the marking error was shown, the recording lived in a variable,
   and the moment the tab was closed or Safari reclaimed the page, the
   fifteen minutes were gone. Nothing on the site remembered it had ever
   happened.

   So an attempt that could not be marked is now WRITTEN DOWN before the
   error is shown, and it survives the tab closing, the iPad sleeping and
   the browser being killed. When the connection comes back it is sent.

   WHY INDEXEDDB AND NOT localStorage

   The recording is the whole point of keeping it, and a thirty-minute
   tape is about five megabytes. localStorage holds strings, caps out
   around five megabytes for EVERYTHING, and would have to hold base64 —
   a third bigger again. IndexedDB stores the Blob itself, with no
   encoding and no practical ceiling.

   The queue is deliberately DEVICE-LOCAL. The whole failure it exists for
   is "the network is not there", so a queue that needed the network to be
   written would be useless at precisely the moment it is wanted.

   WHAT IT NEVER DOES

   It never marks anything by itself and never spends money on its own.
   Sending costs credit, and credit is spent by a person pressing a
   button, never by a background task deciding the signal looks better
   now. It watches the connection and SAYS it is ready; the press is
   still yours.
   ============================================================ */

const Pending = (() => {
  const DB = 'aureum-pending', STORE = 'items', VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DB, VERSION); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('by_owner', 'owner');
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('This browser would not open its local store.'));
    });
    return dbp;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      let out;
      try { out = fn(s); } catch (e) { return rej(e); }
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('The local store refused the write.'));
    });
  }

  /* Whose queue this is. Two people sharing an iPad must not see each
     other's recordings — and the id is the account, not the device. */
  let owner = '';
  function setOwner(email) { owner = String(email || '').trim().toLowerCase(); }

  /**
   * Write down an attempt that could not be marked.
   *
   * @param {object} item
   *   kind    'osce' | 'case'
   *   id      the attempt id — the SAME id the marked attempt will carry,
   *           so sending it later replaces this row rather than doubling it
   *   title   what to show in the list
   *   payload everything the send needs, minus the audio
   *   blob    the recording, or null when there was none
   *   reason  why it failed, in the words the candidate saw
   */
  async function put(item) {
    const rec = Object.assign({
      owner, at: Date.now(), tries: 0, lastTry: 0, reason: ''
    }, item, { owner: owner || item.owner || '' });
    await tx('readwrite', s => s.put(rec));
    ping();
    return rec;
  }

  async function all() {
    const rows = await tx('readonly', s => {
      const out = [];
      return new Promise(res => {
        const cur = s.openCursor();
        cur.onsuccess = e => {
          const c = e.target.result;
          if (!c) return res(out);
          if (!owner || !c.value.owner || c.value.owner === owner) out.push(c.value);
          c.continue();
        };
        cur.onerror = () => res(out);
      });
    });
    const list = await rows;
    return (list || []).sort((a, b) => b.at - a.at);
  }
  async function get(id) { return tx('readonly', s => new Promise(res => {
    const r = s.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null);
  })).then(p => p); }

  async function drop(id) { await tx('readwrite', s => s.delete(id)); ping(); }

  /** Record a failed send without losing the item. */
  async function bumpTry(id, reason) {
    const row = await get(id);
    if (!row) return;
    row.tries = (row.tries || 0) + 1;
    row.lastTry = Date.now();
    row.reason = reason || row.reason;
    await tx('readwrite', s => s.put(row));
    ping();
  }

  async function count() { try { return (await all()).length; } catch { return 0; } }

  /* ---------------- telling the app ---------------- */

  const watchers = new Set();
  function onChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
  async function ping() {
    let n = 0; try { n = await count(); } catch {}
    watchers.forEach(fn => { try { fn(n, navigator.onLine !== false); } catch {} });
  }
  window.addEventListener('online', ping);
  window.addEventListener('offline', ping);

  /** Is this the kind of failure that a queue can fix? */
  function isConnectionFailure(err) {
    const m = String(err?.message || err || '');
    if (navigator.onLine === false) return true;
    return /network|failed to fetch|load failed|timed? ?out|connection|offline|ECONN|NetworkError|HTTP 5\d\d|HTTP 429|502|503|504/i.test(m);
  }

  /** A short, honest line about why this is sitting here. */
  function reasonLine(row) {
    if (!row) return '';
    const tries = row.tries || 0;
    return (row.reason || 'The marking did not go through.')
      + (tries > 1 ? ` Tried ${tries} times.` : '');
  }

  return { setOwner, put, all, get, drop, bumpTry, count, onChange, ping,
    isConnectionFailure, reasonLine };
})();
