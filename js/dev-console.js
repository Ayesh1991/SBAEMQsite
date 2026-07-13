/* ============================================================
   dev-console.js — the owner-only content pipeline.

   Flow:
     1. Fetch the list of JSON papers in the Drive folder (and its
        subfolders) from the Cloudflare function at
        AUREUM_CONFIG.drive.apiBase. If that is unreachable, fall
        back to the bundled data/drive-index.json snapshot.
     2. Show only files that are NOT already published (diffed by a
        stable key derived from the Drive file id / title).
     3. For each new file, auto-suggest Category → Section → Topic
        from its folderTag (via the syllabus). The owner can change
        any of these, then Approve to publish.
     4. Publishing stores the paper (with its content) through the
        backend, so it appears in the library for everyone.

   Nothing here can write to Google Drive — it only reads.
   ============================================================ */

const DevConsole = (() => {
  let ctx = null;
  let driveFiles = [];      // [{key,id,name,folder,paper?,meta?}]
  let published = [];
  let syllabus = null;

  async function render(view, context) {
    ctx = context;
    const { esc } = ctx;
    syllabus = await ctx.Data.loadSyllabus();

    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">DEVELOPER · CONTENT PIPELINE</p>
          <h1 class="page-title">Import papers from Google Drive</h1>
          <p class="muted">Source folder: <code>${esc(ctx.cfg.drive.folderId)}</code> ·
            Backend: <strong>${ctx.Backend.mode === 'cloud' ? 'Supabase (shared)' : 'local (this browser)'}</strong></p>
        </header>

        <div class="dev-toolbar" data-animate>
          <button class="btn btn-gold" id="dev-scan">Scan Drive for new papers</button>
          <span class="dev-status" id="dev-status"></span>
        </div>

        <div id="dev-list" data-animate></div>

        <div class="card" data-animate>
          <h3 class="card-title">Manage curriculum</h3>
          <p class="muted">Add a new category, a section inside a category, or a topic inside a section
            (including <strong>Mock Paper 1, 2, 3…</strong>). New entries appear as targets when you index papers.</p>
          <div class="curr-mgr">
            <div class="curr-row">
              <label>New category
                <input type="text" id="curr-cat-title" placeholder="e.g. Rapid Revision">
              </label>
              <button class="btn btn-ghost btn-sm" id="curr-add-cat">Add category</button>
            </div>
            <div class="curr-row">
              <label>Add section to
                <select id="curr-sec-cat"></select>
              </label>
              <label>Section title
                <input type="text" id="curr-sec-title" placeholder="e.g. Full Mock Papers">
              </label>
              <button class="btn btn-ghost btn-sm" id="curr-add-sec">Add section</button>
            </div>
            <div class="curr-row">
              <label>Add topic to
                <select id="curr-top-cat"></select>
              </label>
              <label>Section
                <select id="curr-top-sec"></select>
              </label>
              <label>Topic title
                <input type="text" id="curr-top-title" placeholder="e.g. Mock Paper 4">
              </label>
              <button class="btn btn-ghost btn-sm" id="curr-add-top">Add topic</button>
            </div>
            <p class="curr-msg" id="curr-msg"></p>
          </div>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Manual import</h3>
          <p class="muted">Paste a single paper's JSON (ogr-paper-v1) to validate and publish it directly.</p>
          <textarea id="dev-paste" class="dev-textarea" placeholder='{ "schema": "ogr-paper-v1", "topic": "…", "sba": [...], "emq": [...] }'></textarea>
          <button class="btn btn-primary" id="dev-paste-btn" style="margin-top:12px">Validate & stage</button>
          <div id="dev-paste-result"></div>
        </div>

        <div class="card danger-zone" data-animate>
          <h3 class="card-title">Published papers (${'{count}'})</h3>
          <div id="dev-published"></div>
        </div>
      </section>`;

    view.querySelector('#dev-scan').addEventListener('click', scan);
    view.querySelector('#dev-paste-btn').addEventListener('click', stagePasted);
    wireCurriculumManager(view);
    await refreshPublished(view);
    ctx.FX.viewIn(view);
  }

  /* ---------------- curriculum manager ---------------- */

  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

  function wireCurriculumManager(view) {
    const catSel = view.querySelector('#curr-sec-cat');
    const tCatSel = view.querySelector('#curr-top-cat');
    const tSecSel = view.querySelector('#curr-top-sec');
    const msg = view.querySelector('#curr-msg');
    const say = (t, ok) => { msg.textContent = t; msg.className = 'curr-msg ' + (ok ? 'good' : 'bad'); };

    function refillCategories() {
      const opts = syllabus.categories.map(c => `<option value="${c.id}">${ctx.esc(c.title)}</option>`).join('');
      catSel.innerHTML = opts; tCatSel.innerHTML = opts; refillTopicSections();
    }
    function refillTopicSections() {
      const cat = syllabus.categories.find(c => c.id === tCatSel.value);
      tSecSel.innerHTML = (cat?.sections || []).map(s => `<option value="${s.id}">${ctx.esc(s.title)}</option>`).join('');
    }
    tCatSel.addEventListener('change', refillTopicSections);
    refillCategories();

    // custom curriculum accumulator (persisted via backend)
    async function loadCustom() { try { return await ctx.Backend.getCustomCurriculum(); } catch { return { categories: [] }; } }
    function findOrAddCat(custom, id, title) {
      let c = custom.categories.find(x => x.id === id);
      if (!c) { c = { id, title, sections: [] }; custom.categories.push(c); }
      return c;
    }
    function findOrAddSec(cat, id, title) {
      let s = (cat.sections = cat.sections || []).find(x => x.id === id);
      if (!s) { s = { id, title, topics: [] }; cat.sections.push(s); }
      return s;
    }

    view.querySelector('#curr-add-cat').addEventListener('click', async () => {
      const title = view.querySelector('#curr-cat-title').value.trim();
      if (!title) return say('Enter a category title.', false);
      const id = 'cat-' + slugify(title);
      const custom = await loadCustom();
      findOrAddCat(custom, id, title);
      await ctx.Backend.saveCustomCurriculum(custom);
      await ctx.Data.loadSyllabus(true); syllabus = await ctx.Data.loadSyllabus();
      view.querySelector('#curr-cat-title').value = '';
      refillCategories(); say(`Added category “${title}”.`, true);
    });

    view.querySelector('#curr-add-sec').addEventListener('click', async () => {
      const catId = catSel.value; const title = view.querySelector('#curr-sec-title').value.trim();
      if (!title) return say('Enter a section title.', false);
      const cat = syllabus.categories.find(c => c.id === catId);
      const id = 'sec-' + slugify(title);
      const custom = await loadCustom();
      const cCat = findOrAddCat(custom, cat.id, cat.title);
      findOrAddSec(cCat, id, title);
      await ctx.Backend.saveCustomCurriculum(custom);
      await ctx.Data.loadSyllabus(true); syllabus = await ctx.Data.loadSyllabus();
      view.querySelector('#curr-sec-title').value = '';
      refillCategories(); say(`Added section “${title}” to ${cat.title}.`, true);
    });

    view.querySelector('#curr-add-top').addEventListener('click', async () => {
      const catId = tCatSel.value, secId = tSecSel.value, title = view.querySelector('#curr-top-title').value.trim();
      if (!title) return say('Enter a topic title.', false);
      const cat = syllabus.categories.find(c => c.id === catId);
      const sec = cat.sections.find(s => s.id === secId);
      const id = 'top-' + slugify(title);
      const custom = await loadCustom();
      const cCat = findOrAddCat(custom, cat.id, cat.title);
      const cSec = findOrAddSec(cCat, sec.id, sec.title);
      if (!(cSec.topics = cSec.topics || []).find(t => t.id === id)) cSec.topics.push({ id, title, tags: [title] });
      await ctx.Backend.saveCustomCurriculum(custom);
      await ctx.Data.loadSyllabus(true); syllabus = await ctx.Data.loadSyllabus();
      view.querySelector('#curr-top-title').value = '';
      refillTopicSections(); say(`Added topic “${title}” to ${sec.title}.`, true);
    });
  }

  async function refreshPublished(view) {
    published = await ctx.Data.publishedPapers();
    const host = view.querySelector('#dev-published');
    const card = host.closest('.card').querySelector('.card-title');
    if (card) card.textContent = `Published papers (${published.length})`;
    host.innerHTML = published.length ? `
      <div class="table-scroll"><table class="table">
        <thead><tr><th>Paper</th><th>Category</th><th>Topic</th><th>SBA/EMQ</th><th></th></tr></thead>
        <tbody>${published.map(p => {
          const path = ctx.Data.topicPath(p.categoryId, p.sectionId, p.topicId);
          return `<tr>
            <td>${ctx.esc(p.title)}</td>
            <td class="muted">${ctx.esc(path.category?.title || p.categoryId || '')}</td>
            <td class="muted">${ctx.esc(path.topic?.title || p.topicId || '')}</td>
            <td class="muted">${p.sba || 0}/${p.emq || 0}</td>
            <td>${p.file ? '<span class="tiny muted">bundled</span>' : `<button class="link-btn" data-unpub="${ctx.esc(p.id)}">unpublish</button>`}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : `<p class="muted">Nothing published through the console yet.</p>`;
    host.querySelectorAll('[data-unpub]').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Unpublish this paper? Candidate history is kept but the paper leaves the library.')) {
        await ctx.Backend.unpublishPaper(b.dataset.unpub);
        await refreshPublished(view);
      }
    }));
  }

  /* ---------------- scan ---------------- */

  async function scan() {
    const status = document.getElementById('dev-status');
    const list = document.getElementById('dev-list');
    status.textContent = 'Scanning…'; list.innerHTML = '';
    try {
      driveFiles = await fetchDriveIndex();
    } catch (e) {
      status.innerHTML = `<span class="bad">${ctx.esc(e.message)}</span>`;
      return;
    }
    published = await ctx.Data.publishedPapers();
    const publishedKeys = new Set(published.map(p => p.driveKey).filter(Boolean));
    const publishedTitles = new Set(published.map(p => (p.title || '').toLowerCase()));

    const newFiles = driveFiles.filter(f => !publishedKeys.has(f.key) && !publishedTitles.has((f.title || '').toLowerCase()));
    status.innerHTML = `${driveFiles.length} JSON file${driveFiles.length !== 1 ? 's' : ''} in Drive · <strong>${newFiles.length} new</strong> to index`;

    if (!newFiles.length) { list.innerHTML = `<p class="muted card" style="padding:20px">All Drive papers are already indexed. 🎉</p>`; return; }
    list.innerHTML = newFiles.map((f, i) => newFileRow(f, i)).join('');
    newFiles.forEach((f, i) => wireRow(f, i, list));
    stagedNew = newFiles;
  }
  let stagedNew = [];

  function newFileRow(f, i) {
    const suggest = f.classification || (f.paper ? ctx.Data.classifyByTag(f.paper.folderTag || f.paper.topic) : null);
    const badges = f.counts ? `<span class="chip chip-sba">SBA ${f.counts.sba}</span> ${f.counts.emq ? `<span class="chip chip-emq">EMQ ${f.counts.emq}</span>` : ''}` : '';
    return `
      <div class="dev-row card" data-i="${i}">
        <div class="dev-row-head">
          <div>
            <p class="dev-file">${ctx.esc(f.title)}</p>
            <p class="muted tiny">${ctx.esc(f.folder || 'root')} · ${badges || 'metadata pending'}</p>
          </div>
          <span class="dev-owner muted tiny">${ctx.esc(f.owner || '')}</span>
        </div>
        <div class="dev-classify">
          <label>Category
            <select data-role="cat" data-i="${i}">
              ${syllabus.categories.map(c => `<option value="${c.id}" ${suggest?.categoryId === c.id ? 'selected' : ''}>${ctx.esc(c.title)}</option>`).join('')}
            </select>
          </label>
          <label>Section <select data-role="sec" data-i="${i}"></select></label>
          <label>Topic <select data-role="top" data-i="${i}"></select></label>
          <button class="btn btn-gold btn-sm" data-role="approve" data-i="${i}">Approve & publish</button>
        </div>
        <p class="dev-row-msg" data-role="msg" data-i="${i}"></p>
      </div>`;
  }

  function wireRow(f, i, list) {
    const row = list.querySelector(`.dev-row[data-i="${i}"]`);
    const catSel = row.querySelector('[data-role="cat"]');
    const secSel = row.querySelector('[data-role="sec"]');
    const topSel = row.querySelector('[data-role="top"]');
    const suggest = f.classification || (f.paper ? ctx.Data.classifyByTag(f.paper.folderTag || f.paper.topic) : null);

    function fillSections(selCat) {
      const cat = syllabus.categories.find(c => c.id === selCat);
      secSel.innerHTML = cat.sections.map(s => `<option value="${s.id}" ${suggest?.sectionId === s.id ? 'selected' : ''}>${ctx.esc(s.title)}</option>`).join('');
      fillTopics(secSel.value);
    }
    function fillTopics(selSec) {
      const cat = syllabus.categories.find(c => c.id === catSel.value);
      const sec = cat.sections.find(s => s.id === selSec);
      topSel.innerHTML = sec.topics.map(t => `<option value="${t.id}" ${suggest?.topicId === t.id ? 'selected' : ''}>${ctx.esc(t.title)}</option>`).join('');
    }
    catSel.addEventListener('change', () => fillSections(catSel.value));
    secSel.addEventListener('change', () => fillTopics(secSel.value));
    fillSections(catSel.value);

    row.querySelector('[data-role="approve"]').addEventListener('click', () => approve(f, i, { catSel, secSel, topSel, row }));
  }

  async function approve(f, i, els) {
    const msg = els.row.querySelector('[data-role="msg"]');
    msg.textContent = 'Publishing…'; msg.className = 'dev-row-msg muted';
    try {
      let paper = f.paper;
      if (!paper && f.id) paper = await fetchDriveFile(f.id);   // fetch content on demand
      if (!paper) throw new Error('Could not load this file\'s content.');
      const errors = ctx.Data.validatePaper(paper);
      if (errors.length) throw new Error(errors.join(' '));

      const meta = buildMeta(f, paper, els);
      await ctx.Backend.publishPaper(meta);
      msg.textContent = '✓ Published to the library.'; msg.className = 'dev-row-msg good';
      els.row.classList.add('dev-done');
      els.row.querySelector('[data-role="approve"]').disabled = true;
      await refreshPublished(document.getElementById('view'));
    } catch (e) {
      msg.textContent = e.message; msg.className = 'dev-row-msg bad';
    }
  }

  function buildMeta(f, paper, els) {
    const id = 'drv-' + (f.key || slug(paper.topic || f.title));
    return {
      id,
      driveKey: f.key || null,
      title: paper.topic || f.title.replace(/\.json$/i, ''),
      source: paper.source || '',
      categoryId: els.catSel.value,
      sectionId: els.secSel.value,
      topicId: els.topSel.value,
      sba: ctx.Data.countSBA(paper),
      emq: ctx.Data.countEMQ(paper),
      content: paper                          // inline content (no file on disk)
    };
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }

  /* ---------------- manual paste ---------------- */

  async function stagePasted() {
    const ta = document.getElementById('dev-paste');
    const out = document.getElementById('dev-paste-result');
    let paper;
    try { paper = JSON.parse(ta.value); }
    catch (e) { out.innerHTML = `<p class="bad">Invalid JSON: ${ctx.esc(e.message)}</p>`; return; }
    const errors = ctx.Data.validatePaper(paper);
    if (errors.length) { out.innerHTML = `<p class="bad">${errors.map(ctx.esc).join('<br>')}</p>`; return; }
    const f = { key: 'paste-' + slug(paper.topic || 'paper'), title: (paper.topic || 'Pasted paper') + '.json', folder: 'manual', paper, counts: { sba: ctx.Data.countSBA(paper), emq: ctx.Data.countEMQ(paper) } };
    stagedNew = [f];
    const list = document.getElementById('dev-list');
    list.innerHTML = newFileRow(f, 0);
    wireRow(f, 0, list);
    out.innerHTML = `<p class="good">Valid ogr-paper-v1 · ${f.counts.sba} SBA / ${f.counts.emq} EMQ — classify and publish above.</p>`;
    list.scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------------- Drive access ---------------- */

  async function fetchDriveIndex() {
    const base = ctx.cfg.drive.apiBase;
    // Try the live Cloudflare function first.
    try {
      const res = await fetch(`${base}?action=list&folderId=${encodeURIComponent(ctx.cfg.drive.folderId)}`, { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        return (data.files || []).map(normaliseDriveFile);
      }
    } catch { /* fall through to snapshot */ }
    // Fallback: bundled snapshot generated at build time.
    const snap = await fetch('data/drive-index.json', { cache: 'no-cache' });
    if (!snap.ok) throw new Error('Live Drive API unavailable and no bundled snapshot found. Deploy functions/api/drive.js (see docs/SETUP.md).');
    const data = await snap.json();
    return (data.files || []).map(normaliseDriveFile);
  }

  async function fetchDriveFile(id) {
    const base = ctx.cfg.drive.apiBase;
    const res = await fetch(`${base}?action=file&id=${encodeURIComponent(id)}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not fetch file content from the Drive function.');
    return res.json();
  }

  function normaliseDriveFile(f) {
    return {
      key: f.key || f.id,
      id: f.id,
      title: f.title || f.name,
      folder: f.folder || '',
      owner: f.owner || '',
      paper: f.paper || null,                       // present in snapshot / if function inlines content
      counts: f.counts || (f.paper ? { sba: ctx.Data.countSBA(f.paper), emq: ctx.Data.countEMQ(f.paper) } : null),
      classification: f.classification || null
    };
  }

  return { render };
})();
