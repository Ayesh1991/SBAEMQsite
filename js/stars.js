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
  let broken = '';                  // why the store could not be read, if it could not
  const listeners = new Set();

  const ping = () => listeners.forEach(fn => { try { fn(); } catch {} });

  /* IT IS THE PERSON'S MARK, NOT THE DEVICE'S.

     Every mark is stored against the signed-in account in the database,
     never in this browser — so starring a station on an iPad shows it
     starred on a phone, on a laptop, and on somebody else's computer the
     moment that person signs in as themselves. Nothing here reads or
     writes localStorage, deliberately: a per-device star would be
     discovered to be per-device in the week before the exam, on the
     device that does not have it.

     The one exception is local mode — no Supabase configured — where
     there is no account and no server to be user-specific about. That is
     the development backend and it is single-device by definition.

     WHICH MEANS THE TABLE HAS TO EXIST. Until supabase/schema.sql is run
     with the osce_stars table in it, every read comes back empty and
     every write is refused. That is not a silent state: it is recorded
     here and said plainly wherever a mark is offered, because "I starred
     it and it did not stick" is the worst way to find out. */
  const MISSING = /relation .*osce_stars.* does not exist|could not find the table|schema cache|PGRST205|42P01/i;
  const why = e => {
    const m = String(e?.message || e?.code || e || '');
    return MISSING.test(m)
      ? 'The stars table has not been created yet — run supabase/schema.sql on the database and they will save.'
      : m || 'The stars could not be reached.';
  };

  /** Everything the signed-in candidate has marked, in one request. */
  async function load(force) {
    if (cache && !force) return cache;
    if (loading && !force) return loading;
    loading = (async () => {
      try {
        const rows = await Backend.listOsceStars();
        const m = {};
        (rows || []).forEach(r => { if (r && r.stationId && r.mark) m[r.stationId] = r.mark; });
        cache = m; broken = '';
      } catch (e) {
        /* An unreachable store is not an opinion — but it is not nothing
           either, and the difference has to be visible. */
        cache = cache || {}; broken = why(e);
      }
      loading = null;
      return cache;
    })();
    return loading;
  }

  /** '' when the store is fine, otherwise why it is not. */
  const trouble = () => broken;

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
      /* The optimism is put back. A star that stayed gold over a write
         that failed would be a promise the app cannot keep. */
      if (was) cache[id] = was; else delete cache[id];
      broken = why(e);
      ping();
      throw new Error(broken);
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
  function bust() { cache = null; loading = null; broken = ''; }

  return { STAR, LOW, load, of, starred, low, ready, trouble, idsAt, counts, set, toggleStar, toggleLow,
    onChange, html, wire, paint, bust };
})();
