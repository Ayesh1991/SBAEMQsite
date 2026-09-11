/* ============================================================
   bucket.js — the stations you are going to sit, kept until you do.

   WHAT IT IS FOR

   Revision does not work the way the circuit builder assumed. The
   builder draws a round for you — balanced across the blueprint, or at
   random, or whatever is unseen — and that is right when you want the
   exam to surprise you. It is no use at all for the other way people
   work: browsing the bank over a week, recognising four stations worth
   doing, and wanting them kept until Saturday morning.

   So this is a cart. You drop stations into it as you find them and sit
   the whole thing as one circuit when you have the time.

   WHY IT IS NOT A THIRD KIND OF STAR

   A star says "worth coming back to". The bucket says "doing this next".
   They are different questions and a station is routinely both — the
   station you starred last week is exactly the one you now want to sit —
   so they are separate stores. One row per station could only ever
   answer one of the two.

   AND WHY A STATION LEAVES IT BY BEING SAT

   The bucket empties itself, but only by the one event that means you
   are finished with the station: SITTING it. Not starting the circuit —
   a round ended after two of five must leave the other three where they
   were, because they are exactly as much "still to do" as they were an
   hour ago. Not skipping it either: a skip is a decision not to sit it
   today, and clearing it would silently undo the reason it was collected.

   A cart that empties on any other event is a cart you stop trusting
   with anything you care about.
   ============================================================ */

const Bucket = (() => {

  let cache = null;                 // [{ stationId, at }] once loaded, oldest first
  let loading = null;
  let broken = '';
  const listeners = new Set();
  const ping = () => listeners.forEach(fn => { try { fn(); } catch {} });

  const MISSING = /relation .*osce_bucket.* does not exist|could not find the table|schema cache|PGRST205|42P01/i;
  const why = e => {
    const m = String(e?.message || e?.code || e || '');
    return MISSING.test(m)
      ? 'The bucket table has not been created yet — run supabase/schema.sql on the database.'
      : m || 'The bucket could not be reached.';
  };

  /** Everything in the bucket, in the order it was collected. */
  async function load(force) {
    if (cache && !force) return cache;
    if (loading && !force) return loading;
    loading = (async () => {
      try {
        const rows = await Backend.listOsceBucket();
        cache = (rows || []).filter(r => r && r.stationId)
          .sort((a, b) => (a.at || 0) - (b.at || 0));
        broken = '';
      } catch (e) { cache = cache || []; broken = why(e); }
      loading = null;
      return cache;
    })();
    return loading;
  }

  const ids = () => (cache || []).map(r => r.stationId);
  const has = id => (cache || []).some(r => r.stationId === id);
  const count = () => (cache || []).length;
  const ready = () => cache != null;
  const trouble = () => broken;

  /**
   * Put one in, or take it out. Optimistic, for the same reason the star
   * is: a cart that fills in a beat after the finger has moved on does
   * not feel like a cart.
   */
  async function set(id, inIt) {
    await load();
    const was = has(id);
    if (inIt && !was) cache.push({ stationId: id, at: Date.now() });
    if (!inIt && was) cache = cache.filter(r => r.stationId !== id);
    ping();
    try {
      await Backend.setOsceBucket(id, !!inIt);
      return !!inIt;
    } catch (e) {
      if (was && !inIt) cache.push({ stationId: id, at: Date.now() });
      if (!was && inIt) cache = cache.filter(r => r.stationId !== id);
      broken = why(e); ping();
      throw new Error(broken);
    }
  }
  const toggle = id => set(id, !has(id));

  /**
   * Take these out because they have been SAT. The only other way the
   * bucket empties, and the reason it is safe to leave things in it —
   * see the header.
   */
  async function done(idList) {
    const want = (idList || []).filter(id => has(id));
    if (!want.length) return 0;
    await load();
    cache = cache.filter(r => !want.includes(r.stationId));
    ping();
    try { await Backend.clearOsceBucket(want); } catch { /* it will be re-read */ }
    return want.length;
  }

  async function empty() {
    await load();
    cache = []; ping();
    try { await Backend.clearOsceBucket(null); } catch {}
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function bust() { cache = null; loading = null; broken = ''; }

  /* ---------------- the control ----------------

     A bucket, drawn rather than an emoji for the reason every other icon
     in AUREUM is: 🧺 and 🛒 are different pictures on every platform and
     this one sits next to the star, where the pair has to read as a pair. */
  const ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M4.2 8.4h15.6l-1.5 10.1a2 2 0 0 1-2 1.7H7.7a2 2 0 0 1-2-1.7L4.2 8.4z"
      stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M8.6 8.4l2.2-4.6M15.4 8.4l-2.2-4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
  const ICON_IN = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M4.2 8.4h15.6l-1.5 10.1a2 2 0 0 1-2 1.7H7.7a2 2 0 0 1-2-1.7L4.2 8.4z"
      fill="currentColor" opacity=".22"/>
    <path d="M4.2 8.4h15.6l-1.5 10.1a2 2 0 0 1-2 1.7H7.7a2 2 0 0 1-2-1.7L4.2 8.4z"
      stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M8.6 8.4l2.2-4.6M15.4 8.4l-2.2-4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M9.2 13.6l2.1 2.1 3.9-3.9" stroke="currentColor" stroke-width="1.9"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  /** The button, drawn the same everywhere it appears. */
  function html(id, compact) {
    const on = has(id);
    return `<span class="bk-mark" data-bk-mark="${escAttr(id)}">
      <button type="button" class="st-b bk-b ${on ? 'is-on' : ''}" data-bk-set="1"
        title="${on ? 'In your simulator bucket — press to take it out' : 'Add it to your simulator bucket'}"
        aria-pressed="${on}">${on ? ICON_IN : ICON}${compact ? '' : `<span>${on ? 'In the bucket' : 'Add to bucket'}</span>`}</button>
    </span>`;
  }

  /** Delegate every bucket button inside `host`. */
  function wire(host, onSet) {
    if (!host || host.__bkWired) return;
    host.__bkWired = true;
    host.addEventListener('click', async e => {
      const b = e.target.closest('[data-bk-set]');
      if (!b || !host.contains(b)) return;
      e.preventDefault(); e.stopPropagation();          // the cards are anchors
      const box = b.closest('[data-bk-mark]');
      const id = box?.dataset.bkMark;
      if (!id) return;
      b.disabled = true;
      let now = has(id);
      try { now = await toggle(id); }
      catch (err) { b.disabled = false; alert('That could not be saved: ' + (err?.message || err)); return; }
      b.disabled = false;
      paint(host);
      try { onSet?.(id, now); } catch {}
    });
  }

  /** Redraw every bucket control inside `host`. */
  function paint(host) {
    (host || document).querySelectorAll('[data-bk-mark]').forEach(box => {
      const on = has(box.dataset.bkMark);
      const b = box.querySelector('.bk-b');
      if (!b) return;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on);
      b.title = on ? 'In your simulator bucket — press to take it out' : 'Add it to your simulator bucket';
      const label = b.querySelector('span');
      b.innerHTML = (on ? ICON_IN : ICON) + (label ? `<span>${on ? 'In the bucket' : 'Add to bucket'}</span>` : '');
    });
  }

  const escAttr = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return { ICON, ICON_IN, load, ids, has, count, ready, trouble, set, toggle, done, empty,
    onChange, html, wire, paint, bust };
})();
