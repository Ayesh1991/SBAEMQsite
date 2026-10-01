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
  let syllabus = null;      // { categories: [...] } — the CURRENT course's
  let loadedFor = null;     // which course `syllabus` belongs to
  const fileCache = new Map();

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
    return res.json();
  }

  /* ---------- A SYLLABUS BELONGS TO ONE EXAM ----------

     Until v119 there was one tree for the platform, and it was the O&G
     Part 2 tree. That is the one thing that cannot be shared between
     exams: a final MBBS paper classified against Obstetrics and
     Gynaecology is misfiled, and a Part 1 tree with Anatomy and Physiology
     in it would have shown those to every Part 2 candidate as two more
     categories beside the ten they actually sit.

     THE BUNDLED FILE IS NOT THE PLATFORM'S TREE, it is one course's, and
     data/syllabus.json now says which with a `track` field. It is the base
     for that course and for nobody else; every other course is built from
     its own row in the database, which starts empty — an empty tree is the
     honest state of a course nobody has written a syllabus for yet, and it
     is visibly empty rather than quietly full of the wrong subjects.

     Cached per course, because switching course has to change the tree and
     one cached tree is how the old behaviour would survive the change. */
  const trees = new Map();
  let bundled = null;

  /* THE COURSE HAS TO BE KNOWN BEFORE THE TREE CAN BE CHOSEN, and on a
     fresh page load it is not: Course reads the enrolments asynchronously,
     and asking it first would get '' — which falls back to the bundled O&G
     base and draws the wrong library for everybody. Resolving it here
     rather than at each of the six call sites is the difference between
     fixing it and fixing it five times. */
  const currentTrack = async () => {
    try {
      if (typeof Course === 'undefined') return '';
      await Course.load();
      return Course.currentId() || '';
    } catch { return ''; }
  };

  /**
   * One course's tree. Does NOT become the current one — the developer
   * console reads another course's tree while importing into it, and that
   * must not repoint the library the owner is also looking at.
   */
  async function syllabusFor(trackId, force) {
    const key = trackId || '';
    if (!force && trees.has(key)) return trees.get(key);
    if (!bundled) bundled = await fetchJSON('data/syllabus.json');
    /* The bundled tree is the base only for the course it names. With no
       course resolved at all — signed out, or a deployment that has not run
       the schema — it is still the base, so nothing that worked before
       courses existed starts showing an empty library. */
    const base = (!key || key === (bundled.track || 'pgim-og-2'))
      ? JSON.parse(JSON.stringify(bundled))
      : { version: bundled.version, track: key, categories: [] };
    let custom = null;
    try { custom = await Backend.getCustomCurriculum(trackId); } catch { /* optional */ }
    if (custom && Array.isArray(custom.categories)) mergeCurriculum(base, custom);
    trees.set(key, base);
    return base;
  }

  /** The tree for the course this candidate is on. */
  async function loadSyllabus(force) {
    const key = await currentTrack();
    if (syllabus && !force && loadedFor === key) return syllabus;
    syllabus = await syllabusFor(key, force);
    loadedFor = key;
    return syllabus;
  }
  /** Drop every cached tree — after a course switch, or an edit to one. */
  function bustSyllabus() { trees.clear(); syllabus = null; loadedFor = null; }

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

  /* Why the bank once looked deleted: this function used to swallow every
     backend failure and quietly return only the five papers bundled in
     data/manifest.json. From the outside that is indistinguishable from
     someone having emptied the table — and because the failure never
     surfaced, the empty result was also cached for 15 minutes.

     Now a failure is RECORDED. Callers can ask papersProblem() and say so on
     screen instead of showing a bank that has silently shrunk. */
  let problem = null;                  // { message, kind, atCount } | null
  function papersProblem() { return problem; }

  async function publishedPapers() {
    await loadManifest();
    const fromManifest = manifest.papers || [];
    let fromBackend = [];
    problem = null;
    try {
      const loader = () => Backend.getPublishedPapers().then(r => r || []);
      fromBackend = (typeof Cache !== 'undefined'
        ? await Cache.wrap(PAPERS_KEY, PAPERS_TTL, loader, {
            keepIfEmptied: true,
            onSuspect: had => { problem = { kind: 'emptied', atCount: had,
              message: `The question bank came back empty, but this device has seen ${had} papers before now. That is a failed read, not a deletion — nothing has been removed from the database.` }; },
            onStale: err => { problem = { kind: 'stale',
              message: `Could not refresh the question bank (${err.message || err}), so the last copy saved on this device is being used.` }; }
          })
        : await loader()) || [];
    } catch (e) {
      problem = { kind: 'failed', message: `Could not load the question bank: ${e.message || e}` };
    }
    const byId = new Map();
    for (const p of fromManifest) byId.set(p.id, p);
    for (const p of fromBackend) byId.set(p.id, p);      // backend overrides/extends
    return [...byId.values()];
  }
  /** Call after publishing/unpublishing so the next read re-fetches from Supabase. */
  function bustPapers() { if (typeof Cache !== 'undefined') Cache.bust(PAPERS_KEY); }
  /** Throw away every cached copy and re-read the bank from Supabase. */
  async function reloadPapers() {
    bustPapers();
    if (typeof Cache !== 'undefined') Cache.bust('coverage-index');
    return publishedPapers();
  }

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

  /* ---------- TRUE / FALSE ----------

     A final MBBS paper is true/false AND single-best-answer in one sitting,
     marked together. The engine for true/false already existed in cpd.js —
     `qtype`, the T/F keys, the reasoning and the memory hook — but it lived
     inside the CPD section, with its own volumes table and its own progress
     store, so a true/false question could not be part of a PAPER: not in
     the library, not in a mock, not in the simulator.

     IT IS MODELLED AS ITS OWN ARRAY FOR AUTHORING AND FLATTENED INTO THE
     ORDINARY QUESTION SHAPE FOR EVERYTHING ELSE — `options: ['True',
     'False']` with a 0/1 answer. That is not a trick: a true/false item IS
     a single-best-answer with two options, so marking, elimination,
     flagging, notes, the review queue and the progress store all keep
     working untouched, and the only thing that changes is how two buttons
     are drawn. Writing a parallel T/F path through all of that would have
     been the same behaviour implemented twice, and the second copy is the
     one that gets the bug.

     A BLOCK IS A LEAD-IN WITH STATEMENTS, which is how the paper reads:
     "Regarding pre-eclampsia:" followed by five statements each marked
     true or false. A bare statement with no lead-in is accepted too,
     because that is also how papers get typed. */
  const tfBlocks = paper => (paper.tf || paper.truefalse || []);
  const tfStatements = block => Array.isArray(block.statements) ? block.statements
    : Array.isArray(block.stems) ? block.stems
    : [block];
  function countTF(paper) {
    return tfBlocks(paper).reduce((n, b) => n + tfStatements(b).length, 0);
  }
  /**
   * The index of the correct option for a true/false statement.
   *
   * A NUMBER IS REFUSED, deliberately and loudly — see validatePaper. `0`
   * could mean "the first option, True" or "the value false", and the two
   * readings are opposites. Guessing would invert the mark on every
   * statement in the file and look exactly like a candidate getting them
   * all wrong.
   */
  function tfAnswerIndex(v) {
    if (v === true) return 0;
    if (v === false) return 1;
    const s = String(v).trim().toLowerCase();
    if (s === 'true' || s === 't' || s === 'yes' || s === 'y') return 0;
    if (s === 'false' || s === 'f' || s === 'no' || s === 'n') return 1;
    return -1;
  }

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
    const tf = tfBlocks(paper);
    if (!Array.isArray(sba) && !Array.isArray(emq) && !Array.isArray(tf)) {
      errors.push('Needs an "sba", "emq" and/or "tf" array.');
    }
    if ((sba.length + emq.length + tf.length) === 0) errors.push('Paper has no SBA, EMQ or true/false content.');

    sba.forEach((q, i) => {
      if (!q.stem) errors.push(`SBA ${i + 1}: missing "stem".`);
      if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`SBA ${i + 1}: needs at least 2 options.`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) {
        errors.push(`SBA ${i + 1}: "answer" must be a valid 0-based option index.`);
      }
    });
    /* TRUE/FALSE. The one rule worth spelling out is the answer: it must be
       a boolean (or the words), never a number. `0` reads as both "the
       first option, True" and "the value false", and the two are
       opposites — accepting it would invert the mark on every statement in
       the file and look exactly like a candidate who got them all wrong.
       Refusing at import is the only place this is cheap to fix. */
    tf.forEach((block, bi) => {
      const stmts = tfStatements(block);
      if (!stmts.length) errors.push(`True/false block ${bi + 1}: has no statements.`);
      stmts.forEach((st, si) => {
        const where = `True/false ${bi + 1}.${si + 1}`;
        if (!st.stem) errors.push(`${where}: missing "stem".`);
        if (typeof st.answer === 'number') {
          errors.push(`${where}: "answer" must be true or false, not a number — ` +
            `a number is ambiguous (is 0 the first option, or the value false?) and guessing would invert the mark.`);
        } else if (tfAnswerIndex(st.answer) < 0) {
          errors.push(`${where}: "answer" must be true or false (got ${JSON.stringify(st.answer)}).`);
        }
      });
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
   * kind = 'SBA' | 'EMQ' | 'TF' | 'ALL'
   * SBA options get lettered by the UI. EMQ options in ogr-paper-v1 already
   * carry their "A. " prefix, so we flag preLettered to avoid double letters.
   */
  function flatten(paper, kind = 'ALL') {
    const out = [];
    const wantSBA = kind === 'SBA' || kind === 'ALL';
    const wantEMQ = kind === 'EMQ' || kind === 'ALL';
    const wantTF = kind === 'TF' || kind === 'ALL';

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
    /* TF LAST, AND THAT MATTERS. `number` counts up through `out`, so a
       kind inserted earlier would renumber every EMQ after it — and the
       number is half of the question key (`paper:EMQ:7`) that every mark,
       note, flag and review item is filed under. Every caller passes an
       explicit kind, so each kind numbers from 1 and none of this can
       reach the others; appending is belt and braces for the unused
       'ALL'. */
    if (wantTF) {
      tfBlocks(paper).forEach(block => {
        tfStatements(block).forEach(st => {
          out.push({
            kind: 'TF',
            number: out.length + 1,
            lead: block.lead || block.theme || st.lead || '',
            stem: st.stem,
            options: ['True', 'False'],
            // two named options need no A/B in front of them
            preLettered: true,
            answer: tfAnswerIndex(st.answer),
            rationale: st.rationale || st.explanation || '',
            hook: st.hook || '',
            reference: st.reference || paper.source || ''
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

  /* The whole bank in one read, poured into the per-paper cache.
     Only the features that genuinely need every question — the simulator's
     index, the hook library — call this, and only when they are used. Every
     other screen lists papers from the light catalogue and never downloads a
     question it is not going to show. */
  let primed = false;
  async function primeContent(force) {
    if (primed && !force) return;
    try {
      const rows = (await Backend.getPaperContents?.()) || [];
      rows.forEach(r => { if (r && r.content) fileCache.set('backend:' + r.id, r.content); });
      primed = true;
    } catch (e) { /* fall back to per-paper fetches */ }
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
        raw = meta.content;                       // already in hand (just published)
      } else if (meta.file) {
        raw = await fetchJSON('data/' + meta.file);
      } else {
        // published to the backend: the catalogue carries no questions, so
        // fetch this one paper's content now that it is actually being opened
        raw = await Backend.getPaperContent(meta.id);
        if (!raw) throw new Error(`Paper "${meta.id}" has no content.`);
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
    loadSyllabus, syllabusFor, bustSyllabus, loadManifest, publishedPapers, bustPapers, reloadPapers, papersProblem,
    categoryById, topicPath, classifyByTag,
    countSBA, countEMQ, countTF, validatePaper, flatten, looksLettered, loadPaper, primeContent
  };
})();
