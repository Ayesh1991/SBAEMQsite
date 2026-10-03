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
  // Short TTL: the blueprint is edited live in the Studio and every dependent
  // surface (coverage maps, paper preview, mock selection, post-mock analysis)
  // must reflect an edit almost at once — including on the candidate's other
  // devices. It's one tiny row, so re-reading it often is cheap.
  const TTL = 2 * 60 * 1000;

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
        // A QUOTED item is always a scalar, even when it contains a colon.
        // ("Thyroid: antenatal care" is a topic name, not a key/value pair —
        //  reading it as a map is what produced [object Object] areas.)
        const quoted = /^\s*["']/.test(after);
        if (!quoted && isMapItem(after)) {
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
      /* Which course's exam this describes. Carried through normalise so a
         stored blueprint still knows, and so the bundled file can be
         refused as a fallback for a course it does not belong to. */
      track: doc.track || '',
      version: doc.version || 1,
      updated: doc.updated || '',
      paper: {
        sbaCount: num(paper.sba_count, 30),
        emqCount: num(paper.emq_count, 30),
        /* TRUE/FALSE DEFAULTS TO NONE, and that is the whole safety of
           this feature. v120 made true/false a real question type in a
           paper; a mock can draw from it too, but how many and from which
           topics is a judgement about a real exam that nobody has sat yet.
           Zero here, and no buckets below, means every existing blueprint
           produces exactly the mock it produced before — the mechanism
           ships and the weights are decided later, by somebody holding a
           real paper. */
        tfCount: num(paper.tf_count, 0),
        tfMark: num(paper.tf_mark_each, 1),
        durationMin: num(paper.duration_min, 180),
        sbaMark: num(paper.sba_mark_each, 3),
        emqMark: num(paper.emq_mark_each, 3),
        negativeMarking: !!paper.negative_marking
      },
      sba: (doc.blueprint_sba || []).map(b => ({
        category: b.category || '', subcategory: b.subcategory || '',
        weight: num(b.weight, 0), areas: cleanAreas(b.specific_areas || b.areas)
      })).filter(b => b.weight > 0),
      emq: (doc.blueprint_emq || []).map(b => ({
        theme: b.theme || '', weight: num(b.weight, 0), areas: cleanAreas(b.specific_areas || b.areas)
      })).filter(b => b.weight > 0),
      /* Shaped like the SBA buckets, because a true/false statement is
         filed under a subject the same way — see Data.flatten, where it is
         a single-best-answer with two options. */
      tf: (doc.blueprint_tf || []).map(b => ({
        category: b.category || '', subcategory: b.subcategory || '',
        weight: num(b.weight, 0), areas: cleanAreas(b.specific_areas || b.areas)
      })).filter(b => b.weight > 0),
      priority: (doc.priority_topics || []).map(p => ({ match: p.match || '', boost: num(p.boost, 1) })).filter(p => p.match),
      notes: doc.notes || ''
    };
  }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

  /* Areas must always be plain strings. Older saves (and the pre-fix parser)
     could store a map like {"Thyroid": "antenatal care"} for a quoted line
     containing a colon; flatten those back to readable text instead of
     rendering "[object Object]". */
  function cleanAreas(list) {
    const out = [];
    for (const a of (list || [])) {
      if (a == null) continue;
      if (typeof a === 'string') { const s = a.trim(); if (s) out.push(s); }
      else if (typeof a === 'object') {
        for (const k in a) {
          const v = a[k];
          out.push(v == null || v === '' ? String(k).trim() : `${k}: ${typeof v === 'object' ? Object.keys(v).join(', ') : v}`.trim());
        }
      } else out.push(String(a));
    }
    return out;
  }

  /* ---------- load / save ---------- */

  async function fetchBundled() {
    try {
      const res = await fetch('data/blueprint.md', { cache: 'no-cache' });
      if (res.ok) return parseFrontMatter(await res.text());
    } catch { /* ignore */ }
    return null;
  }

  /* ---------- ONE BLUEPRINT PER COURSE ----------

     A blueprint is the SHAPE OF ONE EXAM: how many SBAs, how many EMQs,
     how long, what each topic is worth. None of that transfers. A final
     MBBS mock built from the Part 2 weights is a Part 2 paper wearing
     another name, and an anatomy candidate given thirty O&G SBAs has been
     handed somebody else's exam.

     So the stored row is keyed by course, and the bundled data/blueprint.md
     is the fallback for the course it NAMES and for no other — otherwise
     every new course would silently inherit Part 2's paper. A course with
     no blueprint has an empty one, which the simulator reports rather than
     building a mock out of nothing. */
  const trackNow = async () => {
    try {
      if (typeof Course === 'undefined') return '';
      await Course.load();
      return Course.currentId() || '';
    } catch { return ''; }
  };
  const keyFor = t => t ? KEY + ':' + t : KEY;
  const EMPTY = () => ({ sba: [], emq: [], tf: [], priority: [], paper: {}, notes: '' });

  async function load(trackId) {
    const t = trackId === undefined ? await trackNow() : (trackId || '');
    const loader = async () => {
      let doc = null;
      try { doc = await Backend.getBlueprint?.(t); } catch { doc = null; }
      if (doc && (doc.sba?.length || doc.emq?.length)) return doc;   // already-normalised stored doc
      const bundled = await fetchBundled();
      /* THE BUNDLED FILE IS ONE COURSE'S. With no course resolved at all it
         still applies, so a deployment that has never run the schema keeps
         the simulator it had before courses existed. */
      if (bundled && (!t || !bundled.track || bundled.track === t)) return bundled;
      return EMPTY();
    };
    return (typeof Cache !== 'undefined') ? Cache.wrap(keyFor(t), TTL, loader) : loader();
  }

  async function save(doc, trackId) {
    const normalised = doc.sba ? doc : normalise(doc);
    const t = trackId === undefined ? await trackNow() : (trackId || '');
    try { await Backend.saveBlueprint?.(normalised, t); } catch { /* dev only */ }
    if (typeof Cache !== 'undefined') {
      Cache.set(keyFor(t), normalised);
      // Everything derived from the blueprint must be rebuilt, or the maps and
      // the next paper would keep quoting the buckets/areas you just changed.
      ['coverage-index', 'sim-qindex', 'sim-qtags', 'sim-qstats'].forEach(k => Cache.bust(k));
    }
    try { window.dispatchEvent(new CustomEvent('aureum:blueprint-changed', { detail: normalised })); } catch {}
    return normalised;
  }
  /* Busting one course's copy is never enough: a course switch has to drop
     them all, and the caller that switches does not know which are cached. */
  function bust(trackId) {
    if (typeof Cache === 'undefined') return;
    if (trackId) { Cache.bust(keyFor(trackId)); return; }
    Cache.bust(KEY);
    try {
      (typeof Course !== 'undefined' ? Course.all() : []).forEach(t => Cache.bust(keyFor(t.id)));
    } catch { /* the unkeyed one is busted either way */ }
  }

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

  /* ---------- serialise a normalised doc back to blueprint Markdown ----------
     Lets the Blueprint Studio round-trip: edit visually here, export the exact
     Markdown you'd paste back into the Claude project or data/blueprint.md. */
  function toMarkdown(doc) {
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '\\"') + '"';
    const p = doc.paper || {};
    const L = [];
    L.push('---');
    L.push('blueprint: ' + (doc.id || 'blueprint'));
    L.push('version: ' + (doc.version || 1));
    L.push('updated: ' + q(doc.updated || new Date().toISOString().slice(0, 10)));
    L.push('paper:');
    L.push('  sba_count: ' + (p.sbaCount ?? 30));
    L.push('  emq_count: ' + (p.emqCount ?? 30));
    L.push('  duration_min: ' + (p.durationMin ?? 180));
    L.push('  sba_mark_each: ' + (p.sbaMark ?? 3));
    L.push('  emq_mark_each: ' + (p.emqMark ?? 3));
    L.push('  negative_marking: ' + (p.negativeMarking ? 'true' : 'false'));
    /* Written only when there IS true/false, so a blueprint that has none
       exports exactly as it did before this release — an unasked-for
       "tf_count: 0" in every file is a diff that means nothing. */
    if (num(p.tfCount, 0) > 0) {
      L.push('  tf_count: ' + p.tfCount);
      L.push('  tf_mark_each: ' + (p.tfMark ?? 1));
    }
    const areas = (arr) => (arr || []).length ? ['    specific_areas:', ...(arr).map(a => '      - ' + q(a))] : [];
    L.push('blueprint_sba:');
    (doc.sba || []).forEach(b => {
      L.push('  - category: ' + q(b.category || ''));
      L.push('    subcategory: ' + q(b.subcategory || ''));
      L.push('    weight: ' + (b.weight || 0));
      areas(b.areas).forEach(x => L.push(x));
    });
    L.push('blueprint_emq:');
    (doc.emq || []).forEach(b => {
      L.push('  - theme: ' + q(b.theme || ''));
      L.push('    weight: ' + (b.weight || 0));
      areas(b.areas).forEach(x => L.push(x));
    });
    /* THE EXPORT IS THE ROUND TRIP. The Studio offers this file as the one to
       paste back into data/blueprint.md; a section it cannot write is a
       section that disappears the first time somebody uses the button it is
       documented with. The buckets are not editable in the Studio — they
       still have to come out of it. */
    if ((doc.tf || []).length) {
      L.push('blueprint_tf:');
      doc.tf.forEach(b => {
        L.push('  - category: ' + q(b.category || ''));
        L.push('    subcategory: ' + q(b.subcategory || ''));
        L.push('    weight: ' + (b.weight || 0));
        areas(b.areas).forEach(x => L.push(x));
      });
    }
    if ((doc.priority || []).length) {
      L.push('priority_topics:');
      doc.priority.forEach(pt => { L.push('  - match: ' + q(pt.match || '')); L.push('    boost: ' + (pt.boost || 1)); });
    }
    L.push('---');
    L.push('');
    if (doc.notes) L.push(doc.notes);
    return L.join('\n');
  }

  return { parseFrontMatter, normalise, load, save, bust, distribute, boostFor, affinity, normStr, toMarkdown };
})();
