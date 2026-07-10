/* ============================================================
   data.js — loads the curriculum manifest and question files.

   Content is injected by the site owner only: JSON files are
   uploaded to /data on the server and registered in
   /data/manifest.json. The app is strictly a reader — there is
   no client-side upload path for candidates.
   ============================================================ */

const Data = (() => {
  let manifest = null;
  const fileCache = new Map();

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
    return res.json();
  }

  async function loadManifest() {
    if (!manifest) {
      manifest = await fetchJSON('data/manifest.json');
    }
    return manifest;
  }

  /** Flat topic lookup: id -> {topic, section, curriculum} */
  function topicIndex() {
    const index = {};
    if (!manifest) return index;
    for (const cur of manifest.curricula) {
      for (const sec of cur.sections) {
        for (const topic of sec.topics) {
          index[topic.id] = { topic, section: sec, curriculum: cur };
        }
      }
    }
    return index;
  }

  function findTopic(topicId) {
    return topicIndex()[topicId] || null;
  }

  /* ---------- question set loading + validation ---------- */

  function validateSet(set) {
    const errors = [];
    if (!set || typeof set !== 'object') return ['File is not a JSON object.'];
    if (set.mode !== 'SBA' && set.mode !== 'EMQ') errors.push('"mode" must be "SBA" or "EMQ".');
    if (!set.title) errors.push('Missing "title".');

    if (set.mode === 'SBA') {
      if (!Array.isArray(set.questions) || set.questions.length === 0) {
        errors.push('SBA sets need a non-empty "questions" array.');
      } else {
        set.questions.forEach((q, i) => {
          if (!q.stem) errors.push(`Question ${i + 1}: missing "stem".`);
          if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`Question ${i + 1}: needs at least 2 "options".`);
          if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) {
            errors.push(`Question ${i + 1}: "answer" must be a valid option index (0-based).`);
          }
        });
      }
    }

    if (set.mode === 'EMQ') {
      if (!Array.isArray(set.themes) || set.themes.length === 0) {
        errors.push('EMQ sets need a non-empty "themes" array.');
      } else {
        set.themes.forEach((t, ti) => {
          if (!t.theme) errors.push(`Theme ${ti + 1}: missing "theme" title.`);
          if (!Array.isArray(t.options) || t.options.length < 3) errors.push(`Theme ${ti + 1}: needs an option list (3+ items).`);
          if (!Array.isArray(t.stems) || t.stems.length === 0) {
            errors.push(`Theme ${ti + 1}: needs a non-empty "stems" array.`);
          } else {
            t.stems.forEach((s, si) => {
              if (!s.stem) errors.push(`Theme ${ti + 1}, stem ${si + 1}: missing "stem".`);
              if (!Number.isInteger(s.answer) || s.answer < 0 || s.answer >= (t.options || []).length) {
                errors.push(`Theme ${ti + 1}, stem ${si + 1}: "answer" must be a valid option index (0-based).`);
              }
            });
          }
        });
      }
    }
    return errors;
  }

  /**
   * Normalise a set into a flat list of renderable questions.
   * EMQ stems become individual questions carrying their theme's
   * option list, so the quiz engine treats SBA and EMQ uniformly.
   */
  function flatten(set) {
    if (set.mode === 'SBA') {
      return set.questions.map((q, i) => ({
        kind: 'SBA',
        number: i + 1,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation || '',
        reference: q.reference || ''
      }));
    }
    const out = [];
    let n = 0;
    for (const theme of set.themes) {
      for (const s of theme.stems) {
        n += 1;
        out.push({
          kind: 'EMQ',
          number: n,
          theme: theme.theme,
          instructions: theme.instructions || '',
          stem: s.stem,
          options: theme.options,
          answer: s.answer,
          explanation: s.explanation || '',
          reference: s.reference || ''
        });
      }
    }
    return out;
  }

  async function loadSet(topicId) {
    const found = findTopic(topicId);
    if (!found) throw new Error(`Unknown topic "${topicId}" — it may have been removed from the manifest.`);
    const url = 'data/' + found.topic.file;
    if (!fileCache.has(url)) {
      const raw = await fetchJSON(url);
      const errors = validateSet(raw);
      if (errors.length) throw new Error('This question file is invalid:\n' + errors.join('\n'));
      fileCache.set(url, { raw, questions: flatten(raw) });
    }
    const cached = fileCache.get(url);
    return { ...found, set: cached.raw, questions: cached.questions };
  }

  function countQuestions(set) {
    if (set.mode === 'SBA') return (set.questions || []).length;
    return (set.themes || []).reduce((n, t) => n + (t.stems || []).length, 0);
  }

  return { loadManifest, topicIndex, findTopic, loadSet, validateSet, flatten, countQuestions };
})();
