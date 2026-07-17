/* ============================================================
   cache.js — on-device cache for expensive Supabase reads.

   Purpose: Supabase's free tier bills egress (bytes leaving the
   database). The published-papers list carries every paper's full
   content inline, so re-downloading it on every page view burns the
   monthly egress allowance fast. This module downloads such payloads
   ONCE and reuses them from localStorage until they are explicitly
   busted (on publish/unpublish) or expire.

   Design:
     • Every entry is versioned by SCHEMA (bump to invalidate all) and
       stamped with a save time so a TTL can expire stale data.
     • wrap(key, ttl, loader) returns fresh cache or runs the loader,
       stores the result, and returns it. If the loader throws but a
       (possibly stale) cached copy exists, the cached copy is returned
       so the app keeps working offline / when egress-limited.
     • bust(key) / clear() invalidate entries after a write.

   Nothing medical or private is special-cased here; it's a thin,
   defensive key/value layer. Callers decide what is safe to cache.
   ============================================================ */

const Cache = (() => {
  const NS = 'aureum.cache.';
  const SCHEMA = 3;                 // bump to invalidate every cached entry
  const memo = new Map();           // in-tab memo so one view doesn't re-parse JSON

  function k(key) { return NS + key; }

  function read(key) {
    if (memo.has(key)) return memo.get(key);
    let raw;
    try { raw = localStorage.getItem(k(key)); } catch { return null; }
    if (!raw) return null;
    let rec;
    try { rec = JSON.parse(raw); } catch { return null; }
    if (!rec || rec.v !== SCHEMA) { remove(key); return null; }
    memo.set(key, rec);
    return rec;
  }

  function write(key, data) {
    const rec = { v: SCHEMA, t: Date.now(), data };
    memo.set(key, rec);
    try { localStorage.setItem(k(key), JSON.stringify(rec)); }
    catch {
      // storage full — drop our own oldest entries and retry once
      try { pruneOldest(6); localStorage.setItem(k(key), JSON.stringify(rec)); } catch { /* give up, memo still holds it */ }
    }
    return data;
  }

  function remove(key) {
    memo.delete(key);
    try { localStorage.removeItem(k(key)); } catch { /* ignore */ }
  }

  /** Fresh cached value (within maxAgeMs), else null. maxAgeMs<=0 ⇒ never expire on age. */
  function get(key, maxAgeMs) {
    const rec = read(key);
    if (!rec) return null;
    if (maxAgeMs > 0 && Date.now() - rec.t > maxAgeMs) return null;
    return rec.data;
  }

  function set(key, data) { return write(key, data); }

  /** Return the raw record (data + age) even if past its TTL — used as a fallback. */
  function stale(key) { const rec = read(key); return rec ? rec.data : null; }

  /**
   * wrap(key, ttlMs, loader): serve fresh cache, else load + store.
   * On loader failure, fall back to any stale cache so the UI survives.
   */
  async function wrap(key, ttlMs, loader) {
    const fresh = get(key, ttlMs);
    if (fresh !== null) return fresh;
    try {
      const data = await loader();
      return write(key, data);
    } catch (err) {
      const fallback = stale(key);
      if (fallback !== null) return fallback;
      throw err;
    }
  }

  function bust(key) { remove(key); }

  function clear() {
    memo.clear();
    try {
      const rm = [];
      for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith(NS)) rm.push(key); }
      rm.forEach(key => localStorage.removeItem(key));
    } catch { /* ignore */ }
  }

  function pruneOldest(n) {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(NS)) continue;
      try { const rec = JSON.parse(localStorage.getItem(key)); entries.push([key, rec?.t || 0]); } catch { entries.push([key, 0]); }
    }
    entries.sort((a, b) => a[1] - b[1]).slice(0, n).forEach(([key]) => localStorage.removeItem(key));
  }

  /** Human-readable age of an entry, for "cached · 4 min ago" hints. */
  function ageText(key) {
    const rec = read(key);
    if (!rec) return '';
    const s = Math.round((Date.now() - rec.t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }

  return { wrap, get, set, stale, bust, clear, ageText, SCHEMA };
})();
