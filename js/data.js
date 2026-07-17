/* ============================================================
   data.js — loads the curriculum (syllabus), the manifest of
   published papers, and individual papers in the group's
   "ogr-paper-v1" schema (each file carries both SBA and EMQ).

   Published papers come from two places, merged:
     • the static manifest.json committed with the site, and
     • any papers published through the developer console
       (stored via the backend: Supabase in the cloud, or
       localStorage locally).
   ============================================================ */

const Data = (() => {
  let manifest = null;      // { papers: [...] }
  let syllabus = null;      // { categories: [...] }
  const fileCache = new Map();

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
    return res.json();
  }

  async function loadSyllabus(force) {
    if (!syllabus || force) {
      const base = await fetchJSON('data/syllabus.json');
      // deep-clone so merges don't accumulate across reloads
      const merged = JSON.parse(JSON.stringify(base));
      let custom = null;
      try { custom = await Backend.getCustomCurriculum(); } catch { /* optional */ }
      if (custom && Array.isArray(custom.categories)) mergeCurriculum(merged, custom);
      syllabus = merged;
    }
    return syllabus;
  }

  /** Merge developer-added categories/sections/topics on top of the static tree. */
  function mergeCurriculum(base, custom) {
    for (const cCat of custom.categories) {
      let cat = base.categories.find(c => c.id === cCat.id);
      if (!cat) { cat = { id: cCat.id, title: cCat.title, sections: [] }; base.categories.push(cat); }
      if (cCat.title) cat.title = cat.title || cCat.title;
      for (const cSec of (cCat.sections || [])) {
        let sec = cat.sections.find(s => s.id === cSec.id);
        if (!sec) { sec = { id: cSec.id, title: cSec.title, topics: [] }; cat.sections.push(sec); }
        for (const cTop of (cSec.topics || [])) {
          if (!sec.topics.find(t => t.id === cTop.id)) {
            sec.topics.push({ id: cTop.id, title: cTop.title, tags: cTop.tags || [cTop.title] });
          }
        }
      }
    }
  }

  async function loadManifest() {
    if (!manifest) manifest = await fetchJSON('data/manifest.json');
    return manifest;
  }

  /** All published papers = static manifest + backend-published, de-duplicated by id.
      The backend list carries each paper's full content inline, so it is cached
      on-device (Cache) to spare Supabase egress; publishing busts the cache. */
  const PAPERS_KEY = 'published-papers';
  const PAPERS_TTL = 15 * 60 * 1000;   // 15 min freshness; publish/unpublish busts sooner
  async function publishedPapers() {
    await loadManifest();
    const fromManifest = manifest.papers || [];
    let fromBackend = [];
    try {
      const loader = () => Backend.getPublishedPapers().then(r => r || []);
      fromBackend = (typeof Cache !== 'undefined'
        ? await Cache.wrap(PAPERS_KEY, PAPERS_TTL, loader)
        : await loader()) || [];
    } catch { /* backend optional */ }
    const byId = new Map();
    for (const p of fromManifest) byId.set(p.id, p);
    for (const p of fromBackend) byId.set(p.id, p);      // backend overrides/extends
    return [...byId.values()];
  }
  /** Call after publishing/unpublishing so the next read re-fetches from Supabase. */
  function bustPapers() { if (typeof Cache !== 'undefined') Cache.bust(PAPERS_KEY); }

  /* ---------- syllabus helpers ---------- */

  function categoryById(id) { return (syllabus?.categories || []).find(c => c.id === id) || null; }

  function topicPath(categoryId, sectionId, topicId) {
    const cat = categoryById(categoryId);
    const sec = cat?.sections.find(s => s.id === sectionId);
    const top = sec?.topics.find(t => t.id === topicId);
    return { category: cat, section: sec, topic: top };
  }

  /** Map a paper's folderTag to a syllabus {categoryId, sectionId, topicId}, else null. */
  function classifyByTag(tag) {
    if (!tag || !syllabus) return null;
    const needle = String(tag).trim().toLowerCase();
    for (const cat of syllabus.categories) {
      for (const sec of cat.sections) {
        for (const top of sec.topics) {
          if ((top.tags || []).some(t => t.toLowerCase() === needle)) {
            return { categoryId: cat.id, sectionId: sec.id, topicId: top.id };
          }
        }
      }
    }
    // looser contains-match as a fallback
    for (const cat of syllabus.categories) {
      for (const sec of cat.sections) {
        for (const top of sec.topics) {
          if ((top.tags || []).some(t => needle.includes(t.toLowerCase()) || t.toLowerCase().includes(needle))) {
            return { categoryId: cat.id, sectionId: sec.id, topicId: top.id };
          }
        }
      }
    }
    return null;
  }

  /* ---------- paper parsing (ogr-paper-v1) ---------- */

  function countSBA(paper) { return (paper.sba || paper.questions || []).length; }
  function countEMQ(paper) {
    const blocks = paper.emq || paper.themes || [];
    return blocks.reduce((n, b) => n + ((b.stems || []).length), 0);
  }

  function validatePaper(paper) {
    const errors = [];
    if (!paper || typeof paper !== 'object') return ['File is not a JSON object.'];
    const title = paper.topic || paper.title;
    if (!title) errors.push('Missing "topic" (or "title").');
    const sba = paper.sba || paper.questions || [];
    const emq = paper.emq || paper.themes || [];
    if (!Array.isArray(sba) && !Array.isArray(emq)) errors.push('Needs an "sba" and/or "emq" array.');
    if ((sba.length + emq.length) === 0) errors.push('Paper has no SBA or EMQ content.');

    sba.forEach((q, i) => {
      if (!q.stem) errors.push(`SBA ${i + 1}: missing "stem".`);
      if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`SBA ${i + 1}: needs at least 2 options.`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) {
        errors.push(`SBA ${i + 1}: "answer" must be a valid 0-based option index.`);
      }
    });
    emq.forEach((b, bi) => {
      if (!Array.isArray(b.options) || b.options.length < 3) errors.push(`EMQ theme ${bi + 1}: needs an option list (3+).`);
      (b.stems || []).forEach((s, si) => {
        if (!s.stem) errors.push(`EMQ ${bi + 1}.${si + 1}: missing "stem".`);
        if (!Number.isInteger(s.answer) || s.answer < 0 || s.answer >= (b.options || []).length) {
          errors.push(`EMQ ${bi + 1}.${si + 1}: "answer" must be a valid 0-based option index.`);
        }
      });
    });
    return errors;
  }

  /**
   * Turn a paper into a flat renderable question list, filtered by kind.
   * kind = 'SBA' | 'EMQ' | 'ALL'
   * SBA options get lettered by the UI. EMQ options in ogr-paper-v1 already
   * carry their "A. " prefix, so we flag preLettered to avoid double letters.
   */
  function flatten(paper, kind = 'ALL') {
    const out = [];
    const wantSBA = kind === 'SBA' || kind === 'ALL';
    const wantEMQ = kind === 'EMQ' || kind === 'ALL';

    if (wantSBA) {
      (paper.sba || paper.questions || []).forEach((q, i) => {
        out.push({
          kind: 'SBA',
          number: out.length + 1,
          stem: q.stem,
          lead: q.lead || '',
          options: q.options,
          preLettered: looksLettered(q.options),
          answer: q.answer,
          rationale: q.rationale || q.explanation || '',
          hook: q.hook || '',
          reference: q.reference || paper.source || ''
        });
      });
    }
    if (wantEMQ) {
      (paper.emq || paper.themes || []).forEach(block => {
        (block.stems || []).forEach(s => {
          out.push({
            kind: 'EMQ',
            number: out.length + 1,
            theme: block.theme || '',
            instruction: block.instruction || block.instructions || '',
            stem: s.stem,
            lead: '',
            options: block.options,
            preLettered: looksLettered(block.options),
            answer: s.answer,
            rationale: s.rationale || s.explanation || '',
            hook: s.hook || '',
            reference: s.reference || paper.source || ''
          });
        });
      });
    }
    return out;
  }

  function looksLettered(options) {
    if (!Array.isArray(options) || !options.length) return false;
    // e.g. "A. ..." or "A) ..." or "A - ..."
    return /^[A-Ta-t][.)\-]\s/.test(String(options[0]).trim());
  }

  /** Load a published paper by manifest id. Returns { meta, paper, path }. */
  async function loadPaper(paperId) {
    await Promise.all([loadSyllabus(), loadManifest()]);
    const papers = await publishedPapers();
    const meta = papers.find(p => p.id === paperId);
    if (!meta) throw new Error(`Unknown paper "${paperId}" — it may have been unpublished.`);

    const cacheKey = meta.file || ('backend:' + meta.id);
    if (!fileCache.has(cacheKey)) {
      let raw;
      if (meta.content) {
        raw = meta.content;                       // backend-published inline content
      } else {
        raw = await fetchJSON('data/' + meta.file);
      }
      const errors = validatePaper(raw);
      if (errors.length) throw new Error('This paper is invalid:\n' + errors.join('\n'));
      fileCache.set(cacheKey, raw);
    }
    const paper = fileCache.get(cacheKey);
    const path = topicPath(meta.categoryId, meta.sectionId, meta.topicId);
    return { meta, paper, path };
  }

  return {
    loadSyllabus, loadManifest, publishedPapers, bustPapers,
    categoryById, topicPath, classifyByTag,
    countSBA, countEMQ, validatePaper, flatten, looksLettered, loadPaper
  };
})();
