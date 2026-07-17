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

  /**
   * Entry point. section = 'hub' | 'papers' | 'cards' | 'users' | 'blueprint'.
   * The hub is a card launcher; each section is its own page with a back link.
   */
  async function render(view, context, section = 'hub') {
    ctx = context;
    syllabus = await ctx.Data.loadSyllabus();
    if (section === 'papers') return renderPapersSection(view);
    if (section === 'cards') return renderCardsSection(view);
    if (section === 'users') return renderUsersSection(view);
    if (section === 'blueprint') return renderBlueprintSection(view);
    return renderHub(view);
  }

  /* ---------------- hub ---------------- */

  async function renderHub(view) {
    const { esc } = ctx;
    let paperN = '…', deckN = '…', userN = '…';
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">DEVELOPER CONSOLE</p>
          <h1 class="page-title">Mission control</h1>
          <p class="muted">Backend: <strong>${ctx.Backend.mode === 'cloud' ? 'Supabase (shared)' : 'local (this browser)'}</strong> — pick a workspace.</p>
        </header>
        <div class="dev-hub" data-animate>
          <a class="dev-hub-card" href="#/dev/papers" style="--hub-accent:linear-gradient(135deg,#5eead4,#3987e5)">
            <span class="dev-hub-ico">📄</span>
            <h3>SBA / EMQ importer</h3>
            <p>Scan Drive for question papers, classify against the curriculum, publish to the library.</p>
            <span class="dev-hub-count" id="hub-papers">…</span>
          </a>
          <a class="dev-hub-card" href="#/dev/cards" style="--hub-accent:linear-gradient(135deg,#a78bfa,#e879b9)">
            <span class="dev-hub-ico">🃏</span>
            <h3>Flashcard importer</h3>
            <p>Scan the flashcard folder, validate decks by content, publish to the Flashcards tab.</p>
            <span class="dev-hub-count" id="hub-decks">…</span>
          </a>
          <a class="dev-hub-card" href="#/dev/users" style="--hub-accent:linear-gradient(135deg,#f4c95d,#e8a33d)">
            <span class="dev-hub-ico">👥</span>
            <h3>User management</h3>
            <p>Registered accounts, AI usage per user, and selective feature unlock.</p>
            <span class="dev-hub-count" id="hub-users">…</span>
          </a>
          <a class="dev-hub-card" href="#/dev/blueprint" style="--hub-accent:linear-gradient(135deg,#34d399,#5eead4)">
            <span class="dev-hub-ico">🧭</span>
            <h3>Exam blueprint</h3>
            <p>The weights behind the adaptive simulator's daily mock. Upload a new version any time.</p>
            <span class="dev-hub-count" id="hub-bp">…</span>
          </a>
        </div>
      </section>`;
    ctx.FX.viewIn(view);
    // decorate counts asynchronously (all reads are device-cached)
    try { paperN = (await ctx.Data.publishedPapers()).length + ' published'; } catch { paperN = '—'; }
    try { deckN = ((await ctx.Backend.getFlashcardDecks()) || []).length + ' decks live'; } catch { deckN = '—'; }
    try { userN = ((await ctx.Backend.listAllUsers()) || []).length + ' accounts'; } catch { userN = 'run schema.sql'; }
    let bpN = 'bundled default';
    try { const bp = await Blueprint.load(); if (bp?.sba?.length) bpN = `v${bp.version} · ${bp.sba.length}+${bp.emq.length} topics`; } catch { /* keep default */ }
    const put = (id, v) => { const el = view.querySelector(id); if (el) el.textContent = v; };
    put('#hub-papers', paperN); put('#hub-decks', deckN); put('#hub-users', userN); put('#hub-bp', bpN);
  }

  const backLink = `<a class="link muted dev-back" href="#/dev">← Developer</a>`;

  /* ---------------- section: SBA/EMQ papers ---------------- */

  async function renderPapersSection(view) {
    const { esc } = ctx;
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · SBA / EMQ IMPORTER</p>
          <h1 class="page-title">Question papers</h1>
          <p class="muted">Source folder: <code>${esc(ctx.cfg.drive.folderId)}</code> ·
            Backend: <strong>${ctx.Backend.mode === 'cloud' ? 'Supabase (shared)' : 'local (this browser)'}</strong></p>
        </header>

        <div class="dev-toolbar" data-animate>
          <button class="btn btn-gold" id="dev-scan">Scan Drive for new papers</button>
          <span class="dev-status" id="dev-status"></span>
        </div>

        <div id="dev-list" data-animate></div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Published papers (…)</span><span class="dc-caret">▸</span></summary>
            <div id="dev-published"></div>
          </details>
        </div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Manual import (paste JSON)</span><span class="dc-caret">▸</span></summary>
            <p class="muted">Paste a single paper's JSON (ogr-paper-v1) to validate and publish it directly.</p>
            <textarea id="dev-paste" class="dev-textarea" placeholder='{ "schema": "ogr-paper-v1", "topic": "…", "sba": [...], "emq": [...] }'></textarea>
            <button class="btn btn-primary" id="dev-paste-btn" style="margin-top:12px">Validate &amp; stage</button>
            <div id="dev-paste-result"></div>
          </details>
        </div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Manage curriculum</span><span class="dc-caret">▸</span></summary>
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
          </details>
        </div>
      </section>`;

    view.querySelector('#dev-scan').addEventListener('click', scan);
    view.querySelector('#dev-paste-btn').addEventListener('click', stagePasted);
    wireCurriculumManager(view);
    await refreshPublished(view);
    ctx.FX.viewIn(view);
  }

  /* ---------------- section: flashcard decks ---------------- */

  async function renderCardsSection(view) {
    const { esc } = ctx;
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · FLASHCARD IMPORTER</p>
          <h1 class="page-title">Flashcard decks</h1>
          <p class="muted">A <strong>separate</strong> pipeline from question papers. Decks are recognised by their
            content (<code>{ "topic": "…", "cards": [ … ] }</code>), whatever the filename. Published decks
            appear in the Flashcards tab.</p>
        </header>

        <div class="dev-toolbar" data-animate>
          <button class="btn btn-gold" id="fc-scan">Scan flashcard Drive</button>
          <span class="dev-status" id="fc-status"></span>
        </div>
        <div id="fc-list" data-animate></div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Published decks (<span id="fc-pub-count">…</span>)</span><span class="dc-caret">▸</span></summary>
            <div id="fc-published"></div>
          </details>
        </div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Paste a deck manually</span><span class="dc-caret">▸</span></summary>
            <textarea id="fc-paste" class="dev-textarea" placeholder='{ "topic": "Breech Presentation", "cards": [ { "question": "…", "answer": "…", "keyPoint": "" } ] }'></textarea>
            <button class="btn btn-primary" id="fc-paste-btn" style="margin-top:12px">Validate &amp; stage</button>
            <div id="fc-paste-result"></div>
          </details>
        </div>
      </section>`;

    view.querySelector('#fc-scan').addEventListener('click', scanCards);
    view.querySelector('#fc-paste-btn').addEventListener('click', stagePastedDeck);
    await refreshDecks(view);
    ctx.FX.viewIn(view);
  }

  /* ---------------- section: exam blueprint ---------------- */

  async function renderBlueprintSection(view) {
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · ADAPTIVE SIMULATOR</p>
          <h1 class="page-title">Exam blueprint</h1>
          <p class="muted">Drives which topics the daily mock samples. Upload the blueprint Markdown
            (YAML front-matter) or JSON. Stored on the server and used across devices; the bundled
            <code>data/blueprint.md</code> is the fallback.</p>
        </header>
        <div class="card" data-animate>
          <div class="dev-toolbar">
            <label class="btn btn-gold" style="cursor:pointer">Upload blueprint file
              <input type="file" id="bp-file" accept=".md,.markdown,.json,.txt" hidden>
            </label>
            <span class="dev-status" id="bp-status"></span>
          </div>
          <div id="bp-summary"></div>
        </div>
      </section>`;

    view.querySelector('#bp-file').addEventListener('change', uploadBlueprint);
    await refreshBlueprint(view);
    ctx.FX.viewIn(view);
  }

  /* ---------------- section: users ---------------- */

  async function renderUsersSection(view) {
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · USER MANAGEMENT</p>
          <h1 class="page-title">Users &amp; access</h1>
          <p class="muted">Everyone registered on the site — activity, AI usage, and selective unlock of the
            advanced features. (Cloud mode needs the updated schema.sql run once.)</p>
        </header>
        <div class="card" data-animate>
          <div id="dev-users"><p class="muted">Loading users…</p></div>
        </div>
      </section>`;
    await refreshUsers(view);
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
        ctx.Data.bustPapers?.();
        if (typeof Cache !== 'undefined') Cache.bust('sim-qindex');
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
    const suggest = f.classification || ctx.Data.classifyByTag(f.paper ? (f.paper.folderTag || f.paper.topic) : ((f.folder || '').split(' / ').pop() || String(f.title || '').replace(/\.json$/i, '')));
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
    const suggest = f.classification || ctx.Data.classifyByTag(f.paper ? (f.paper.folderTag || f.paper.topic) : ((f.folder || '').split(' / ').pop() || String(f.title || '').replace(/\.json$/i, '')));

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
      ctx.Data.bustPapers?.();                 // new paper is instantly eligible everywhere (incl. mocks)
      if (typeof Cache !== 'undefined') Cache.bust('sim-qindex');
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

  /* ---------------- flashcard decks (separate pipeline) ---------------- */

  let stagedDecks = [];

  function validateDeck(d) {
    const e = [];
    if (!d || typeof d !== 'object') return ['File is not a JSON object.'];
    if (!d.topic && !d.title) e.push('Missing "topic".');
    if (!Array.isArray(d.cards) || !d.cards.length) e.push('Needs a non-empty "cards" array.');
    (d.cards || []).forEach((c, i) => { if (!c.question) e.push(`Card ${i + 1}: missing "question".`); if (!c.answer) e.push(`Card ${i + 1}: missing "answer".`); });
    return e;
  }
  function buildDeckMeta(f, deck) {
    const cards = deck.cards.map((c, i) => ({ id: String(c.id != null ? c.id : i + 1), question: c.question, answer: c.answer, keyPoint: c.keyPoint || '' }));
    const key = f.key || slug(deck.topic || f.title);
    return { id: 'deck-' + key, driveKey: f.key || null, title: deck.topic || (f.title || '').replace(/\.json$/i, ''), source: deck.source || '', cardCount: cards.length, content: { topic: deck.topic || f.title, cards } };
  }
  let lastDeckScanMeta = {};
  async function fetchDeckIndex() {
    const base = ctx.cfg.drive.apiBase, fid = ctx.cfg.drive.flashcardFolderId;
    lastDeckScanMeta = {};
    let liveError = null;
    try {
      const res = await fetch(`${base}?action=list&folderId=${encodeURIComponent(fid)}`, { cache: 'no-cache' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Accept ALL .json files — decks are identified by their CONTENT
        // (topic + cards), not their name, so old cards without a
        // "flashcards__" prefix import too. Non-deck JSONs are validated
        // out at scan time (see scanCards).
        lastDeckScanMeta = { truncated: data.truncated, skipped: data.skipped };
        return (data.files || []).map(f => ({ key: f.key || f.id, id: f.id, title: f.title || f.name, folder: f.folder || '', deck: f.deck || f.paper || null }));
      }
      liveError = data.error || `HTTP ${res.status}`;
    } catch (e) { liveError = 'network: ' + (e.message || e); }
    try { const snap = await fetch('data/flashcard-index.json', { cache: 'no-cache' }); if (snap.ok) { const data = await snap.json(); return (data.files || []).map(f => ({ key: f.key || f.id, id: f.id, title: f.title || f.name, folder: f.folder || '', deck: f.deck || null })); } } catch { /* ignore */ }
    throw new Error('Flashcard Drive scan failed — ' + liveError);
  }
  function deckRow(f, i) {
    return `<div class="dev-row card" data-di="${i}"><div class="dev-row-head">
      <div><p class="dev-file">🃏 ${ctx.esc(f.title)}</p><p class="muted tiny">${ctx.esc(f.folder || 'root')}${f.deck ? ' · ' + (f.deck.cards || []).length + ' cards' : ''}</p></div>
      <button class="btn btn-gold btn-sm" data-role="deck-approve" data-i="${i}">Publish deck</button>
    </div><p class="dev-row-msg" data-role="deck-msg" data-i="${i}"></p></div>`;
  }
  async function scanCards() {
    const status = document.getElementById('fc-status'), list = document.getElementById('fc-list');
    status.textContent = 'Scanning…'; list.innerHTML = '';
    let files;
    try { files = await fetchDeckIndex(); } catch (e) { status.innerHTML = `<span class="bad">${ctx.esc(e.message)}</span>`; return; }
    const pub = await ctx.Backend.getFlashcardDecks().catch(() => []);
    const pubKeys = new Set(pub.map(d => d.driveKey).filter(Boolean));
    const pubTitles = new Set(pub.map(d => (d.title || '').toLowerCase()));
    const candidates = files.filter(f => !pubKeys.has(f.key) && !pubTitles.has((f.title || '').replace(/\.json$/i, '').toLowerCase()));
    const envWarn = (lastDeckScanMeta.skipped ? ` · <span class="bad">${lastDeckScanMeta.skipped} subfolder${lastDeckScanMeta.skipped > 1 ? 's' : ''} skipped (Restricted sharing)</span>` : '') +
      (lastDeckScanMeta.truncated ? ` · <span class="bad">list truncated (very large folder) — rescan after publishing for the rest</span>` : '');
    if (!candidates.length) {
      status.innerHTML = `${files.length} JSON file${files.length !== 1 ? 's' : ''} · <strong>all already published</strong>${envWarn}`;
      list.innerHTML = `<p class="muted">All flashcard decks are already published. 🎉</p>`; return;
    }
    // Identify decks by CONTENT (topic + cards), not filename — imports old
    // decks regardless of name and quietly skips non-deck JSONs.
    const { valid, invalid } = await validateNewDecks(candidates, status);
    const warn = (invalid ? ` · <span class="muted">${invalid} non-deck JSON${invalid > 1 ? 's' : ''} skipped</span>` : '') + envWarn;
    status.innerHTML = `${files.length} JSON file${files.length !== 1 ? 's' : ''} · <strong>${valid.length} new deck${valid.length !== 1 ? 's' : ''}</strong>${warn}`;
    if (!valid.length) { list.innerHTML = `<p class="muted">No new valid decks found (the JSON files here aren't in <code>{ topic, cards[] }</code> flashcard format).</p>`; return; }
    stagedDecks = valid;
    list.innerHTML = valid.map((f, i) => deckRow(f, i)).join('');
    valid.forEach((f, i) => document.querySelector(`#fc-list [data-role="deck-approve"][data-i="${i}"]`).addEventListener('click', () => approveDeck(f, i)));
  }
  // Fetch + validate new candidates' content with bounded concurrency.
  // A file is a deck if it parses to { topic/title, cards:[…] }. Attaches
  // the fetched content onto f.deck so publishing needs no second fetch.
  async function validateNewDecks(candidates, status) {
    const valid = [], queue = candidates.slice();
    let invalid = 0, done = 0;
    const total = candidates.length;
    async function worker() {
      while (queue.length) {
        const f = queue.shift();
        let deck = f.deck;
        if (!deck && f.id) { try { deck = await fetchDriveFile(f.id); } catch { deck = null; } }
        if (deck && validateDeck(deck).length === 0) { f.deck = deck; valid.push(f); } else invalid++;
        done++;
        if (status && (done % 4 === 0 || done === total)) status.innerHTML = `Checking ${done}/${total} files for flashcard decks…`;
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, total) }, worker));
    // preserve original folder order for a stable list
    valid.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
    return { valid, invalid };
  }

  async function approveDeck(f, i) {
    const msg = document.querySelector(`#fc-list [data-role="deck-msg"][data-i="${i}"]`);
    msg.textContent = 'Publishing…'; msg.className = 'dev-row-msg muted';
    try {
      let deck = f.deck; if (!deck && f.id) deck = await fetchDriveFile(f.id);
      if (!deck) throw new Error('Could not load this deck\'s content.');
      const errs = validateDeck(deck); if (errs.length) throw new Error(errs.join(' '));
      const meta = buildDeckMeta(f, deck);
      await ctx.Backend.publishFlashcardDeck(meta);
      if (typeof Cache !== 'undefined') Cache.bust('flashcard-decks');
      msg.textContent = `✓ Published · ${meta.cardCount} cards.`; msg.className = 'dev-row-msg good';
      document.querySelector(`.dev-row[data-di="${i}"]`)?.classList.add('dev-done');
      await refreshDecks(document.getElementById('view'));
    } catch (e) { msg.textContent = e.message; msg.className = 'dev-row-msg bad'; }
  }
  async function stagePastedDeck() {
    const ta = document.getElementById('fc-paste'), out = document.getElementById('fc-paste-result');
    let deck; try { deck = JSON.parse(ta.value); } catch (e) { out.innerHTML = `<p class="bad">Invalid JSON: ${ctx.esc(e.message)}</p>`; return; }
    const errs = validateDeck(deck); if (errs.length) { out.innerHTML = `<p class="bad">${errs.map(ctx.esc).join('<br>')}</p>`; return; }
    const f = { key: 'paste-' + slug(deck.topic || 'deck'), title: (deck.topic || 'Pasted deck') + '.json', folder: 'manual', deck };
    stagedDecks = [f];
    const list = document.getElementById('fc-list'); list.innerHTML = deckRow(f, 0);
    document.querySelector('#fc-list [data-role="deck-approve"][data-i="0"]').addEventListener('click', () => approveDeck(f, 0));
    out.innerHTML = `<p class="good">Valid · ${deck.cards.length} cards — publish above.</p>`;
  }
  async function refreshDecks(view) {
    const decks = await ctx.Backend.getFlashcardDecks().catch(() => []);
    const host = view.querySelector('#fc-published'), count = view.querySelector('#fc-pub-count');
    if (count) count.textContent = decks.length;
    host.innerHTML = decks.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th>Deck</th><th>Cards</th><th>Source</th><th></th></tr></thead>
      <tbody>${decks.map(d => `<tr><td>${ctx.esc(d.title)}</td><td class="muted">${d.cardCount || d.content?.cards?.length || 0}</td><td class="muted">${ctx.esc(d.source || '')}</td><td><button class="link-btn" data-unpub-deck="${ctx.esc(d.id)}">unpublish</button></td></tr>`).join('')}</tbody>
    </table></div>` : `<p class="muted">No decks published yet.</p>`;
    host.querySelectorAll('[data-unpub-deck]').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Unpublish this deck? Card progress is kept.')) { await ctx.Backend.unpublishFlashcardDeck(b.dataset.unpubDeck); if (typeof Cache !== 'undefined') Cache.bust('flashcard-decks'); await refreshDecks(view); }
    }));
  }

  /* ---------------- exam blueprint ---------------- */

  async function uploadBlueprint(e) {
    const file = e.target.files[0]; if (!file) return;
    const status = document.getElementById('bp-status'); status.textContent = 'Parsing…'; status.className = 'dev-status';
    try {
      const text = await file.text();
      let doc;
      if (/\.json$/i.test(file.name)) { const raw = JSON.parse(text); doc = raw.sba ? raw : Blueprint.normalise(raw); }
      else doc = Blueprint.parseFrontMatter(text);
      if (!(doc.sba || []).length && !(doc.emq || []).length) throw new Error('No blueprint_sba / blueprint_emq buckets found in the file.');
      await Blueprint.save(doc);
      status.innerHTML = `<span class="good">✓ Saved — ${doc.sba.length} SBA topics, ${doc.emq.length} EMQ themes.</span>`;
      await refreshBlueprint(document.getElementById('view'));
    } catch (err) { status.innerHTML = `<span class="bad">${ctx.esc(err.message || err)}</span>`; }
    e.target.value = '';
  }
  async function refreshBlueprint(view) {
    const host = view.querySelector('#bp-summary');
    let doc; try { doc = await Blueprint.load(); } catch { doc = null; }
    if (!doc || (!(doc.sba || []).length && !(doc.emq || []).length)) { host.innerHTML = `<p class="muted">No blueprint loaded yet — the bundled default is used until you upload one.</p>`; return; }
    const sbaW = doc.sba.reduce((s, b) => s + b.weight, 0), emqW = doc.emq.reduce((s, b) => s + b.weight, 0);
    host.innerHTML = `<div class="bp-summary">
      <p class="good">Blueprint v${doc.version || 1}${doc.updated ? ' · ' + ctx.esc(doc.updated) : ''} loaded.</p>
      <div class="bp-cols">
        <div><h5>SBA · ${doc.sba.length} topics · Σ${sbaW}</h5><ul>${doc.sba.map(b => `<li>${ctx.esc(b.subcategory || b.category)} <span class="muted">w${b.weight}</span></li>`).join('')}</ul></div>
        <div><h5>EMQ · ${doc.emq.length} themes · Σ${emqW}</h5><ul>${doc.emq.map(b => `<li>${ctx.esc(b.theme)} <span class="muted">w${b.weight}</span></li>`).join('')}</ul></div>
      </div></div>`;
  }

  /* ---------------- users & feature flags ---------------- */

  const FEATURES = [
    { id: 'simulator',  label: 'Simulator' },
    { id: 'flashcards', label: 'Flashcards' }
  ];

  async function refreshUsers(view) {
    const host = view.querySelector('#dev-users');
    if (!host) return;
    let list = [];
    try { list = await ctx.Backend.listAllUsers(); } catch (e) {
      host.innerHTML = `<p class="bad">Could not load users — ${ctx.esc(e.message || e)}.<br>
        <span class="muted tiny">In cloud mode this needs the new "profiles dev read" policy: run the updated supabase/schema.sql once.</span></p>`;
      return;
    }
    if (!list.length) { host.innerHTML = `<p class="muted">No registered users found.</p>`; return; }
    let usage = {};
    try { usage = (await ctx.Backend.listAiUsage?.()) || {}; } catch { usage = {}; }
    const devMail = (ctx.cfg.developer.email || '').toLowerCase();
    const totalAi = Object.values(usage).reduce((s, u) => s + (u.total || 0), 0);
    host.innerHTML = `
      <div class="dev-users-stats">
        <div><strong>${list.length}</strong><span>Accounts</span></div>
        <div><strong>${list.reduce((s, u) => s + (u.xp || 0), 0)}</strong><span>Total XP</span></div>
        <div><strong>${totalAi}</strong><span>AI calls (all time)</span></div>
      </div>
      <div class="table-scroll"><table class="table dev-users-table">
        <thead><tr><th>Name</th><th>Email</th><th>Position</th><th>XP</th><th>AI today</th><th>AI total</th><th>Joined</th>${FEATURES.map(f => `<th>${f.label}</th>`).join('')}</tr></thead>
        <tbody>${list.map(u => {
          const isDev = (u.email || '').toLowerCase() === devMail;
          const ai = usage[u.id] || { total: 0, today: 0 };
          return `<tr class="${isDev ? 'dev-users-me' : ''}">
            <td>${ctx.esc(u.name || '')}${isDev ? ' <span class="qedit-tag">developer</span>' : ''}</td>
            <td class="muted">${ctx.esc(u.email || '')}</td>
            <td class="muted">${ctx.esc(u.position || '')}</td>
            <td class="muted">${u.xp || 0}</td>
            <td class="muted">${ai.today}</td>
            <td class="muted">${ai.total}</td>
            <td class="muted">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ''}</td>
            ${FEATURES.map(f => `<td>${isDev
              ? '<span class="tiny muted">always</span>'
              : `<label class="dev-flag"><input type="checkbox" data-uid="${ctx.esc(u.id)}" data-flag="${f.id}" ${u.featureFlags?.[f.id] ? 'checked' : ''}><span></span></label>`}</td>`).join('')}
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="tiny muted">AI counts are calls to the tutor/coach (the site's rate-limit counters), not raw tokens — the closest per-user cost signal the backend records.</p>
      <p class="dev-row-msg" id="dev-users-msg"></p>`;
    host.querySelectorAll('input[data-flag]').forEach(cb => cb.addEventListener('change', async () => {
      const msg = host.querySelector('#dev-users-msg');
      cb.disabled = true;
      try {
        await ctx.Backend.setUserFeature(cb.dataset.uid, cb.dataset.flag, cb.checked);
        msg.textContent = `✓ ${cb.dataset.flag} ${cb.checked ? 'enabled' : 'disabled'} — takes effect on their next page load.`;
        msg.className = 'dev-row-msg good';
      } catch (e) {
        cb.checked = !cb.checked;
        msg.textContent = 'Could not save: ' + (e.message || e); msg.className = 'dev-row-msg bad';
      }
      cb.disabled = false;
    }));
  }

  /* ---------------- Drive access ---------------- */

  async function fetchDriveIndex() {
    const base = ctx.cfg.drive.apiBase;
    // Try the live Cloudflare function first. If the SERVER answers with an
    // error, surface its real message (e.g. "GOOGLE_API_KEY is not
    // configured") — hiding it behind a generic fallback made this
    // impossible to diagnose.
    let liveError = null;
    try {
      const res = await fetch(`${base}?action=list&folderId=${encodeURIComponent(ctx.cfg.drive.folderId)}`, { cache: 'no-cache' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return (data.files || []).map(normaliseDriveFile);
      liveError = data.error || `HTTP ${res.status}`;
    } catch (e) { liveError = 'network: ' + (e.message || e); }
    // Fallback: bundled snapshot generated at build time.
    try {
      const snap = await fetch('data/drive-index.json', { cache: 'no-cache' });
      if (snap.ok) { const data = await snap.json(); return (data.files || []).map(normaliseDriveFile); }
    } catch { /* no snapshot either */ }
    throw new Error('Drive scan failed — ' + liveError);
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
