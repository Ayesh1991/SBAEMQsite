/* ============================================================
   blueprint.js — the PGIM exam blueprint: parse, store, plan.

   The blueprint is authored as Markdown with a YAML front-matter
   header (the file the developer analysed from 2022–2025 recall
   papers). The YAML header drives question SELECTION; the prose body
   is context for the AI coach only.

   Where it lives:
     • Uploaded in the Developer tab → parsed → stored in the backend
       (app_config row 'blueprint'), cached on-device.
     • Falls back to the bundled data/blueprint.md so the simulator
       works out of the box before anything is uploaded.

   Nothing here selects questions — it turns weights into target
   counts and exposes matchers; simulator.js does the sampling.
   ============================================================ */

const Blueprint = (() => {
  const KEY = 'blueprint-doc';
  const TTL = 30 * 60 * 1000;

  /* ---------- tiny front-matter YAML parser (for this blueprint shape) ---------- */

  function parseFrontMatter(src) {
    const text = String(src || '');
    let yaml = text, prose = '';
    const m = text.match(/^\s*---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (m) { yaml = m[1]; prose = m[2] || ''; }
    const doc = parseYaml(yaml);
    doc.notes = prose.trim();
    return normalise(doc);
  }

  function parseYaml(src) {
    const lines = [];
    for (const rawLine of String(src).split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      const indent = rawLine.match(/^ */)[0].length;
      const t = rawLine.slice(indent);
      if (t.startsWith('#')) continue;              // whole-line comment
      lines.push({ indent, text: t });
    }
    let pos = 0;
    const isMapItem = s => /^[^:\s][^:]*:(\s|$)/.test(s);

    function scalar(s) {
      s = s.trim();
      if ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))) return s.slice(1, -1);
      if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
      if (s === 'true') return true;
      if (s === 'false') return false;
      return s;
    }
    function parseSeq(indent) {
      const arr = [];
      while (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('- ')) {
        const after = lines[pos].text.slice(2);
        if (isMapItem(after)) {
          const inner = indent + 2;
          lines[pos] = { indent: inner, text: after };   // reflow the inline first key
          arr.push(parseMap(inner));
        } else { arr.push(scalar(after)); pos++; }
      }
      return arr;
    }
    function parseMap(indent) {
      const map = {};
      while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith('- ')) {
        const t = lines[pos].text;
        const ci = t.indexOf(':');
        const key = t.slice(0, ci).trim();
        const val = t.slice(ci + 1).trim();
        pos++;
        if (val !== '') map[key] = scalar(val);
        else if (pos < lines.length && lines[pos].indent > indent) {
          map[key] = lines[pos].text.startsWith('- ') ? parseSeq(lines[pos].indent) : parseMap(lines[pos].indent);
        } else map[key] = null;
      }
      return map;
    }
    return parseMap(0);
  }

  /* ---------- normalise into the shape the simulator wants ---------- */

  function normalise(doc) {
    doc = doc || {};
    const paper = doc.paper || {};
    return {
      id: doc.blueprint || 'blueprint',
      version: doc.version || 1,
      updated: doc.updated || '',
      paper: {
        sbaCount: num(paper.sba_count, 30),
        emqCount: num(paper.emq_count, 30),
        durationMin: num(paper.duration_min, 180),
        sbaMark: num(paper.sba_mark_each, 3),
        emqMark: num(paper.emq_mark_each, 3),
        negativeMarking: !!paper.negative_marking
      },
      sba: (doc.blueprint_sba || []).map(b => ({
        category: b.category || '', subcategory: b.subcategory || '',
        weight: num(b.weight, 0), areas: b.specific_areas || []
      })).filter(b => b.weight > 0),
      emq: (doc.blueprint_emq || []).map(b => ({
        theme: b.theme || '', weight: num(b.weight, 0), areas: b.specific_areas || []
      })).filter(b => b.weight > 0),
      priority: (doc.priority_topics || []).map(p => ({ match: p.match || '', boost: num(p.boost, 1) })).filter(p => p.match),
      notes: doc.notes || ''
    };
  }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

  /* ---------- load / save ---------- */

  async function fetchBundled() {
    try {
      const res = await fetch('data/blueprint.md', { cache: 'no-cache' });
      if (res.ok) return parseFrontMatter(await res.text());
    } catch { /* ignore */ }
    return null;
  }

  async function load() {
    const loader = async () => {
      let doc = null;
      try { doc = await Backend.getBlueprint?.(); } catch { doc = null; }
      if (doc && (doc.sba?.length || doc.emq?.length)) return doc;   // already-normalised stored doc
      const bundled = await fetchBundled();
      return bundled || { sba: [], emq: [], priority: [], paper: {}, notes: '' };
    };
    return (typeof Cache !== 'undefined') ? Cache.wrap(KEY, TTL, loader) : loader();
  }

  async function save(doc) {
    const normalised = doc.sba ? doc : normalise(doc);
    try { await Backend.saveBlueprint?.(normalised); } catch { /* dev only */ }
    if (typeof Cache !== 'undefined') Cache.set(KEY, normalised);
    return normalised;
  }
  function bust() { if (typeof Cache !== 'undefined') Cache.bust(KEY); }

  /* ---------- planning helpers ---------- */

  const normStr = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** Largest-remainder apportionment of `total` across weighted buckets. */
  function distribute(buckets, total) {
    const sum = buckets.reduce((s, b) => s + (b.weight || 0), 0) || 1;
    const raw = buckets.map(b => ({ b, exact: (b.weight / sum) * total }));
    const counts = raw.map(r => Math.floor(r.exact));
    let used = counts.reduce((a, c) => a + c, 0);
    const rema = raw.map((r, i) => ({ i, frac: r.exact - counts[i] })).sort((a, b) => b.frac - a.frac);
    let k = 0;
    while (used < total && k < rema.length * 4) { counts[rema[k % rema.length].i]++; used++; k++; }
    return counts;
  }

  /** Highest priority boost whose match phrase appears in the given text. */
  function boostFor(doc, text) {
    const hay = normStr(text);
    let boost = 1;
    for (const p of (doc.priority || [])) {
      if (hay.includes(normStr(p.match))) boost = Math.max(boost, p.boost);
    }
    return boost;
  }

  /** Score how well a question matches a blueprint bucket (0 = category only … higher = specific). */
  function affinity(bucketAreas, bucketName, qText) {
    const hay = normStr(qText);
    let score = 0;
    if (bucketName && hay.includes(normStr(bucketName))) score += 3;
    for (const a of (bucketAreas || [])) {
      const words = normStr(a).split(' ').filter(w => w.length > 4);
      const hits = words.filter(w => hay.includes(w)).length;
      if (hits) score += Math.min(2, hits * 0.5);
    }
    return score;
  }

  return { parseFrontMatter, normalise, load, save, bust, distribute, boostFor, affinity, normStr };
})();
