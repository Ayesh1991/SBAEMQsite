/* ============================================================
   stars.js — what the candidate thinks of a station.

   WHY ONE AXIS AND NOT TWO FLAGS

   Two things were asked for on the same day: a way to mark the stations
   worth going back over in the last week before the exam, and a way to
   leave the less important ones out of a practice circuit. They look like
   two features. They are the two ends of one judgement — "this one
   matters" and "this one matters less" — and a station is never both.

   So there is one value per station, `star` or `low`, and no row at all
   for the great majority a candidate has no opinion about. Two independent
   flags would have allowed the state that means nothing (starred AND low),
   and clearing one would have had to remember to clear the other.

   IT IS THE CANDIDATE'S OPINION, NOT THE BANK'S

   The bank already has a priority — collections carry 1–5, set by the
   developer, and the circuit builder weights the draw by it. This is a
   different thing and deliberately separate: the developer says what
   matters for the exam in general, the candidate says what matters for
   THEM. A candidate who has never once been asked about twin delivery
   should be able to star it without arguing with the bank.

   READ ONCE, HELD, AND WRITTEN THROUGH

   Every station card wants to know its mark, and a bank page draws two
   hundred of them. So the whole set is fetched in one request and kept
   in memory for the visit; a toggle writes through to the backend and
   updates the memory immediately, so the star fills in under the finger
   rather than after a round trip. A failed write puts the old value back
   and says so — a star that looks saved and is not would be discovered
   in the week before the exam, which is the one week it must not be.
   ============================================================ */

const Stars = (() => {
  const STAR = 'star', LOW = 'low';

  let cache = null;                 // { stationId: mark } once loaded
  let loading = null;
  const listeners = new Set();

  const ping = () => listeners.forEach(fn => { try { fn(); } catch {} });

  /** Everything the signed-in candidate has marked, in one request. */
  async function load(force) {
    if (cache && !force) return cache;
    if (loading && !force) return loading;
    loading = (async () => {
      try {
        const rows = await Backend.listOsceStars();
        const m = {};
        (rows || []).forEach(r => { if (r && r.stationId && r.mark) m[r.stationId] = r.mark; });
        cache = m;
      } catch { cache = cache || {}; }   /* an unreachable backend is not an opinion */
      loading = null;
      return cache;
    })();
    return loading;
  }

  /** The mark held right now, without waiting. '' until load() has run. */
  const of = id => (cache || {})[id] || '';
  const starred = id => of(id) === STAR;
  const low = id => of(id) === LOW;
  const ready = () => cache != null;

  /** Every station id at one mark, newest first is not meaningful here. */
  const idsAt = mark => Object.keys(cache || {}).filter(k => cache[k] === mark);
  const counts = () => {
    const c = { star: 0, low: 0 };
    Object.values(cache || {}).forEach(v => { if (c[v] != null) c[v]++; });
    return c;
  };

  /**
   * Set (or clear) the mark on one station. Optimistic: the memory and the
   * screen move first, the write follows, and a failure puts the old value
   * back rather than leaving a star that does not exist.
   */
  async function set(id, mark) {
    await load();
    const was = of(id);
    const want = mark === STAR || mark === LOW ? mark : '';
    if (want) cache[id] = want; else delete cache[id];
    ping();
    try {
      await Backend.setOsceStar(id, want || null, '');
      return want;
    } catch (e) {
      if (was) cache[id] = was; else delete cache[id];
      ping();
      throw e;
    }
  }

  /** Star → clear → star. The three-state cycle lives on the ↓ button. */
  const toggleStar = id => set(id, of(id) === STAR ? '' : STAR);
  const toggleLow = id => set(id, of(id) === LOW ? '' : LOW);

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /* ---------------- the control ----------------

     One pair of buttons, drawn the same everywhere it appears so that the
     ★ on a card and the ★ on the station page are recognisably the same
     control. `compact` drops the words and keeps the marks, for a card.

     It carries no click handler of its own: the pages that use it delegate
     from a container, because a bank page has two hundred of these and two
     hundred listeners is two hundred listeners. */
  function html(id, compact) {
    const m = of(id);
    return `<span class="st-mark ${compact ? 'is-compact' : ''}" data-st-mark="${escAttr(id)}">
      <button type="button" class="st-b st-star ${m === STAR ? 'is-on' : ''}" data-st-set="star"
        title="${m === STAR ? 'Starred for revision — press to unstar' : 'Star this for revision before the exam'}"
        aria-pressed="${m === STAR}">★${compact ? '' : `<span>${m === STAR ? 'Starred' : 'Star'}</span>`}</button>
      <button type="button" class="st-b st-low ${m === LOW ? 'is-on' : ''}" data-st-set="low"
        title="${m === LOW ? 'Marked less important — press to clear' : 'Less important: offer to skip it in a circuit'}"
        aria-pressed="${m === LOW}">↓${compact ? '' : `<span>${m === LOW ? 'Less important' : 'Lower'}</span>`}</button>
    </span>`;
  }

  /**
   * Delegate the clicks of every control inside `host`. Returns nothing to
   * unwire: the host is replaced whenever the page redraws.
   *
   * `onSet` is called after the write with (id, mark) so a page can repaint
   * a count or drop a card out of a filtered list.
   */
  function wire(host, onSet) {
    if (!host || host.__stWired) return;
    host.__stWired = true;
    host.addEventListener('click', async e => {
      const b = e.target.closest('[data-st-set]');
      if (!b || !host.contains(b)) return;
      /* Cards are anchors. Without this the star navigates to the station,
         which is the opposite of "keep it for later". */
      e.preventDefault(); e.stopPropagation();
      const box = b.closest('[data-st-mark]');
      const id = box?.dataset.stMark;
      if (!id) return;
      const want = b.dataset.stSet;
      b.disabled = true;
      let mark = of(id);
      try {
        mark = want === STAR ? await toggleStar(id) : await toggleLow(id);
      } catch (err) {
        b.disabled = false;
        alert('That could not be saved: ' + (err?.message || err));
        return;
      }
      b.disabled = false;
      paint(host);
      try { onSet?.(id, mark); } catch {}
    });
  }

  /** Redraw every control inside `host` from the marks now held. */
  function paint(host) {
    (host || document).querySelectorAll('[data-st-mark]').forEach(box => {
      const m = of(box.dataset.stMark);
      const s = box.querySelector('.st-star'), l = box.querySelector('.st-low');
      if (s) { s.classList.toggle('is-on', m === STAR); s.setAttribute('aria-pressed', m === STAR); }
      if (l) { l.classList.toggle('is-on', m === LOW); l.setAttribute('aria-pressed', m === LOW); }
      const compact = box.classList.contains('is-compact');
      if (!compact) {
        const st = s?.querySelector('span'), lo = l?.querySelector('span');
        if (st) st.textContent = m === STAR ? 'Starred' : 'Star';
        if (lo) lo.textContent = m === LOW ? 'Less important' : 'Lower';
      }
    });
  }

  const escAttr = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** Forget everything held — used when a different person signs in. */
  function bust() { cache = null; loading = null; }

  return { STAR, LOW, load, of, starred, low, ready, idsAt, counts, set, toggleStar, toggleLow,
    onChange, html, wire, paint, bust };
})();
