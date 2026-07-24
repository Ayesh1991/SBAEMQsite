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
   * Entry point. section = 'hub' | 'papers' | 'cards' | 'users' | 'blueprint'
   * | 'review' (flagged-question workshop) | 'ai' (AI systems panel).
   * The hub is a card launcher; each section is its own page with a back link.
   */
  async function render(view, context, section = 'hub') {
    ctx = context;
    syllabus = await ctx.Data.loadSyllabus();
    if (section === 'papers') return renderPapersSection(view);
    if (section === 'cards') return renderCardsSection(view);
    if (section === 'users') return renderUsersSection(view);
    if (section === 'blueprint') return renderBlueprintSection(view);
    if (section === 'review') return renderReviewSection(view);
    if (section === 'ai') return renderAiSection(view);
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
          <a class="dev-hub-card" href="#/dev/review" style="--hub-accent:linear-gradient(135deg,#e05263,#e8a33d)">
            <span class="dev-hub-ico">🚩</span>
            <h3>Question review</h3>
            <p>Every question any user flagged as wrong, with their reasoning. Edit, correct or delete — flagged questions stay out of mocks until resolved.</p>
            <span class="dev-hub-count" id="hub-flags">…</span>
          </a>
          <a class="dev-hub-card" href="#/dev/ai" style="--hub-accent:linear-gradient(135deg,#7dd3fc,#a78bfa)">
            <span class="dev-hub-ico">🤖</span>
            <h3>AI systems</h3>
            <p>Every AI engine on the platform: enable, pick the model, choose how the cost is split, and watch the monthly spend per system.</p>
            <span class="dev-hub-count" id="hub-ai">…</span>
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
    let flagN = '—';
    try { const fl = (await ctx.Backend.listAllFlags()) || []; const open = new Set(fl.filter(f => !f.resolved).map(f => f.questionKey)).size; flagN = open ? `${open} awaiting review` : 'all clear'; } catch { flagN = 'run schema.sql'; }
    let aiN = '—';
    try { const fc = (await ctx.Backend.getAiFeatures()) || {}; const live = AI_FEATURES.filter(f => f.status === 'live' && (fc[f.id]?.enabled ?? f.defaults.enabled)).length; aiN = `${live}/${AI_FEATURES.length} systems on`; } catch { aiN = '—'; }
    const put = (id, v) => { const el = view.querySelector(id); if (el) el.textContent = v; };
    put('#hub-papers', paperN); put('#hub-decks', deckN); put('#hub-users', userN); put('#hub-bp', bpN);
    put('#hub-flags', flagN); put('#hub-ai', aiN);
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
    let declined = [];
    try { declined = (await ctx.Backend.getDeclinedPapers()) || []; } catch { declined = []; }
    const declinedSet = new Set(declined);

    const newFiles = driveFiles.filter(f => !publishedKeys.has(f.key) && !publishedTitles.has((f.title || '').toLowerCase()) && !declinedSet.has(f.key));
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
          <button class="btn btn-ghost btn-sm qr-danger" data-role="decline" data-i="${i}">Decline & remove</button>
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
    row.querySelector('[data-role="decline"]')?.addEventListener('click', async () => {
      if (!confirm(`Decline "${f.title}"?\n\nIt will NOT be published and will NEVER appear in future Drive scans. This cannot be undone from the console.`)) return;
      try {
        await ctx.Backend.declinePaper(f.key);
        row.classList.add('dev-done');
        row.innerHTML = `<p class="muted">🚫 Declined — this file won't appear in future scans.</p>`;
      } catch (e) { alert('Could not decline: ' + (e.message || e)); }
    });
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
      tagPaperQuestions(meta);                 // AI-tag the new questions in the background
      msg.textContent = '✓ Published to the library — AI tagging runs in the background.'; msg.className = 'dev-row-msg good';
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

  // Developer-granted flags (server/trigger-protected — users cannot
  // self-grant). Simulator/Flashcards use TWO keys: your grant here makes
  // the toggle appear in the user's Profile; they still activate it per
  // session there (and it self-expires after 5 idle minutes).
  const FEATURES = [
    // master switch: without it a user has NO AI at all
    { id: 'gemini',          label: 'Gemini' },
    // unlocks the Gemini model picker
    { id: 'gemini_advanced', label: 'Gemini+' },
    // AI flashcard generation from wrong answers
    { id: 'ai_flashcards',   label: 'AI cards' },
    // approval for the two opt-in tabs (toggle visibility in their Profile)
    { id: 'simulator',       label: 'Simulator' },
    { id: 'flashcards',      label: 'Flashcards' }
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
    // true token meter → dollar costs (needs the updated schema.sql once)
    let tokenRows = [], tokensLive = true;
    try { tokenRows = (await ctx.Backend.listAiTokenUsage?.()) || []; } catch { tokensLive = false; }
    const costs = Billing.userTotals(tokenRows);
    // shared platform pools (tagging, insights…) split per the AI panel
    let sharedCtx = null;
    try {
      const [sharedRows, features] = await Promise.all([ctx.Backend.listSharedUsage?.(), ctx.Backend.getAiFeatures?.()]);
      sharedCtx = { rows: sharedRows || [], features: features || {}, users: list };
      const extra = Billing.sharedTotals(sharedCtx);
      for (const uid in extra) {
        const c = costs[uid] || (costs[uid] = { thisMonth: 0, allTime: 0 });
        c.thisMonth += extra[uid].thisMonth; c.allTime += extra[uid].allTime;
      }
    } catch { sharedCtx = null; }
    const devMail = (ctx.cfg.developer.email || '').toLowerCase();
    const totalAi = Object.values(usage).reduce((s, u) => s + (u.total || 0), 0);
    const monthTotal = Object.values(costs).reduce((s, c) => s + c.thisMonth, 0);
    let regOpen = true;
    try { regOpen = await ctx.Backend.getRegistrationOpen(); } catch { regOpen = true; }
    const pendingN = list.filter(u => u.status === 'pending').length;
    host.innerHTML = `
      <div class="dev-reg">
        <label class="dev-flag"><input type="checkbox" id="reg-open" ${regOpen ? 'checked' : ''}><span></span></label>
        <span>New registrations are <strong id="reg-state">${regOpen ? 'OPEN' : 'CLOSED'}</strong>
          <span class="muted tiny">— when closed, the sign-up form is hidden. Every new account still needs your approval.</span></span>
        ${pendingN ? `<span class="chip pr-st-pending">${pendingN} awaiting approval</span>` : ''}
      </div>
      <div class="dev-users-stats">
        <div><strong>${list.length}</strong><span>Accounts</span></div>
        <div><strong>${list.filter(u => u.featureFlags?.paid).length}</strong><span>Paid</span></div>
        <div><strong>${totalAi}</strong><span>AI calls (all time)</span></div>
        <div><strong>${Billing.usd(monthTotal)}</strong><span>AI cost this month</span></div>
      </div>
      <p class="tiny muted">Click a user to open their full control panel. <strong>Paid</strong> is the master key: an unpaid account has
        NO AI, no Simulator, no Flashcards, and a 30-question daily practice cap — one toggle activates everything they've been granted.</p>
      <div class="dev-ulist">
        ${list.map((u, i) => {
          const isDev = (u.email || '').toLowerCase() === devMail;
          const c = costs[u.id] || { thisMonth: 0, allTime: 0 };
          const ai = usage[u.id] || { total: 0, today: 0 };
          const paid = isDev || !!u.featureFlags?.paid;
          const stChip = isDev ? '<span class="qedit-tag">developer</span>'
            : u.status === 'pending' ? '<span class="chip pr-st-pending">Awaiting approval</span>'
            : u.status === 'denied' ? '<span class="chip pr-st-rejected">Access denied</span>'
            : '<span class="chip pr-st-approved">Approved</span>';
          return `
          <div class="dev-user ${isDev ? 'dev-users-me' : ''}" data-ui="${i}">
            <button class="dev-user-head" data-utoggle="${i}" aria-expanded="false">
              <span class="dev-user-id"><strong>${ctx.esc(u.name || '')}</strong><span class="muted tiny">${ctx.esc(u.email || '')}</span></span>
              ${stChip}
              <span class="chip ${paid ? 'pr-st-approved' : 'pr-st-rejected'}">${paid ? '💳 Paid' : 'Unpaid'}</span>
              <span class="dev-cost">${Billing.usd(c.thisMonth)}<span class="muted tiny">/mo</span></span>
              <span class="dc-caret">▸</span>
            </button>
            <div class="dev-user-panel" hidden>
              ${isDev ? '<p class="muted tiny">This is you — every feature is always on for the developer.</p>' : `
              <div class="dev-up-grid">
                <div class="dev-up-block dev-up-pay">
                  <h4>💳 Payment</h4>
                  <label class="dev-flag"><input type="checkbox" data-uflag="paid" data-uid="${ctx.esc(u.id)}" ${u.featureFlags?.paid ? 'checked' : ''}><span></span></label>
                  <p class="tiny muted">${u.featureFlags?.paid ? 'Paid — all granted features active.' : 'Unpaid — AI, Simulator and Flashcards disabled; 30 questions/day cap.'}</p>
                </div>
                <div class="dev-up-block">
                  <h4>Account status</h4>
                  ${u.status === 'pending' ? `<button class="btn btn-gold btn-sm" data-approve="${ctx.esc(u.id)}">✓ Approve</button>
                    <button class="btn btn-ghost btn-sm qr-danger" data-deny="${ctx.esc(u.id)}">Deny</button>`
                  : u.status === 'denied' ? `<button class="btn btn-gold btn-sm" data-approve="${ctx.esc(u.id)}">✓ Approve</button>`
                  : `<button class="btn btn-ghost btn-sm qr-danger" data-deny="${ctx.esc(u.id)}">Revoke access</button>`}
                </div>
                <div class="dev-up-block">
                  <h4>AI grants</h4>
                  ${[['gemini', 'Gemini (master AI switch)'], ['gemini_advanced', 'Gemini+ model picker'], ['ai_flashcards', 'AI flashcards']].map(([f, lbl]) => `
                    <label class="dev-up-flag"><label class="dev-flag"><input type="checkbox" data-uflag="${f}" data-uid="${ctx.esc(u.id)}" ${u.featureFlags?.[f] ? 'checked' : ''}><span></span></label> ${lbl}</label>`).join('')}
                </div>
                <div class="dev-up-block">
                  <h4>Tool approvals</h4>
                  ${[['simulator', 'Simulator'], ['flashcards', 'Flashcards']].map(([f, lbl]) => `
                    <label class="dev-up-flag"><label class="dev-flag"><input type="checkbox" data-uflag="${f}" data-uid="${ctx.esc(u.id)}" ${u.featureFlags?.[f] ? 'checked' : ''}><span></span></label> ${lbl}
                      <span class="tiny muted">${u.prefs?.[f] ? '· user has it ON' : '· not activated by user'}</span></label>`).join('')}
                </div>
                <div class="dev-up-block">
                  <h4>Usage &amp; billing</h4>
                  <p class="tiny muted">XP ${u.xp || 0} · AI today ${ai.today} · AI total ${ai.total}<br>
                    Cost this month <strong class="dev-cost">${Billing.usd(c.thisMonth)}</strong> · all time ${Billing.usd(c.allTime)}</p>
                  <button class="btn btn-ghost btn-sm" data-bill="${ctx.esc(u.id)}">🧾 Generate bill</button>
                </div>
              </div>`}
            </div>
          </div>`;
        }).join('')}
      </div>
      <p class="dev-row-msg" id="dev-users-msg"></p>`;

    const msgEl = host.querySelector('#dev-users-msg');
    host.querySelectorAll('[data-utoggle]').forEach(b => b.addEventListener('click', () => {
      const panel = b.parentElement.querySelector('.dev-user-panel');
      const open = panel.hidden;
      panel.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      b.parentElement.classList.toggle('is-open', open);
    }));
    host.querySelectorAll('input[data-uflag]').forEach(cb => cb.addEventListener('change', async () => {
      cb.disabled = true;
      try {
        await ctx.Backend.setUserFeature(cb.dataset.uid, cb.dataset.uflag, cb.checked);
        msgEl.textContent = `✓ ${cb.dataset.uflag} ${cb.checked ? 'enabled' : 'disabled'} — takes effect on their next page load.`;
        msgEl.className = 'dev-row-msg good';
        if (cb.dataset.uflag === 'paid') await refreshUsers(view);
      } catch (e) {
        cb.checked = !cb.checked;
        msgEl.textContent = 'Could not save: ' + (e.message || e); msgEl.className = 'dev-row-msg bad';
      }
      cb.disabled = false;
    }));
    host.querySelectorAll('[data-bill]').forEach(b => b.addEventListener('click', () => {
      const u = list.find(x => x.id === b.dataset.bill);
      if (u) Billing.openBillModal(u, tokenRows, sharedCtx);
    }));
    host.querySelector('#reg-open')?.addEventListener('change', async e => {
      try { await ctx.Backend.setRegistrationOpen(e.target.checked);
        host.querySelector('#reg-state').textContent = e.target.checked ? 'OPEN' : 'CLOSED'; }
      catch (e2) { e.target.checked = !e.target.checked; alert('Could not save: ' + (e2.message || e2)); }
    });
    host.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
      await ctx.Backend.setUserStatus(b.dataset.approve, 'approved'); await refreshUsers(view);
    }));
    host.querySelectorAll('[data-deny]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Deny this account access to the platform?')) return;
      await ctx.Backend.setUserStatus(b.dataset.deny, 'denied'); await refreshUsers(view);
    }));
  }

  /* ================================================================
     QUESTION REVIEW WORKSHOP — every user flag lands here.
     Flagged questions are held out of new mocks until resolved.
     ================================================================ */

  function parseQkey(qkey) {
    const parts = String(qkey).split(':');
    return { paperId: parts[0], kind: parts[1], num: Number(parts[2]) };
  }
  // locate the editable source object behind a flattened question number
  function locateQuestion(paper, kind, num) {
    if (kind === 'SBA') {
      const arr = paper.sba || paper.questions || [];
      return arr[num - 1] ? { type: 'sba', arr, i: num - 1, q: arr[num - 1] } : null;
    }
    let n = 0;
    for (const b of (paper.emq || paper.themes || [])) {
      for (let si = 0; si < (b.stems || []).length; si++) {
        n++;
        if (n === num) return { type: 'emq', block: b, si, q: b.stems[si] };
      }
    }
    return null;
  }
  const md = s => {
    let h = ctx.esc(s);
    h = h.replace(/^###?\s+(.+)$/gm, '<h4>$1</h4>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(?:^|\n)\s*[-•]\s+(.+)/g, '\n<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>');
    return '<p>' + h.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  };
  async function aiCall(action, payload) {
    const token = await ctx.Backend.getAccessToken();
    if (!token) throw new Error('Sign in (cloud mode) to use AI systems.');
    const res = await fetch(ctx.cfg.ai?.apiBase || '/api/explain', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `AI request failed (HTTP ${res.status}).`);
    return data;
  }

  async function renderReviewSection(view) {
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · QUESTION REVIEW</p>
          <h1 class="page-title">Flagged questions</h1>
          <p class="muted">Everything any user flagged as wrong, wherever they were practising. A flagged question is
            <strong>kept out of new mocks</strong> until you fix it here and mark it resolved.</p>
        </header>
        <div id="qr-props" data-animate></div>
        <div id="qr-list" data-animate><p class="muted">Loading flags…</p></div>
      </section>`;
    ctx.FX.viewIn(view);
    await refreshProposals(view);
    await refreshFlags(view);
  }

  /* ---- community proposals: peer-reviewed fixes awaiting the owner ---- */

  async function refreshProposals(view) {
    const host = view.querySelector('#qr-props');
    if (!host) return;
    let props = [];
    try { props = ((await ctx.Backend.listProposals()) || []).filter(p => p.status === 'pending'); }
    catch { host.innerHTML = ''; return; }
    if (!props.length) { host.innerHTML = ''; return; }
    let flags = [];
    try { flags = (await ctx.Backend.listAllFlags()) || []; } catch { flags = []; }
    const flaggersOf = qk => flags.filter(f => f.questionKey === qk)
      .map(f => `${f.userName || f.userEmail} <span class="muted tiny">${ctx.esc(f.userEmail)}</span>`);
    const papers = await ctx.Data.publishedPapers();
    const titleOf = pid => papers.find(p => p.id === pid)?.title || pid;

    host.innerHTML = `
      <div class="card">
        <h3 class="card-title">🤝 Community proposals awaiting your approval (${props.length})</h3>
        <p class="muted">Peer-reviewed fixes. Nothing has changed yet — approving publishes the proposed version to everyone
          and resolves the flags; rejecting discards it.</p>
        ${props.map((pr, i) => {
          const { paperId, kind, num } = parseQkey(pr.questionKey);
          const pd = pr.proposed || {};
          return `
          <div class="dev-row qr-card" data-prop="${i}">
            <div class="dev-row-head">
              <div>
                <p class="dev-file">✎ ${ctx.esc(titleOf(paperId))} · <span class="chip chip-${(kind || 'sba').toLowerCase()}">${ctx.esc(kind)}</span> Q${num}</p>
                <p class="muted tiny">Reviewed by <strong>${ctx.esc(pr.reviewerName || pr.reviewerEmail)}</strong> <span class="muted">${ctx.esc(pr.reviewerEmail)}</span> · ${new Date(pr.created).toLocaleDateString()}</p>
                <p class="muted tiny">Flagged by: ${flaggersOf(pr.questionKey).join(' · ') || '<span class="muted">(flag records resolved/unavailable)</span>'}</p>
              </div>
              <div class="qr-actions">
                <button class="btn btn-gold btn-sm" data-prop-ok="${i}">✓ Approve &amp; publish</button>
                <button class="btn btn-ghost btn-sm qr-danger" data-prop-no="${i}">Reject</button>
              </div>
            </div>
            <div class="qr-prop-body">
              <p class="qr-prop-note">💬 <em>${ctx.esc(pr.note || '(no reasoning given)')}</em></p>
              ${pd.theme ? `<p class="tiny"><strong>Theme:</strong> ${ctx.esc(pd.theme)}</p>` : ''}
              <p class="tiny"><strong>Stem:</strong> ${ctx.esc(pd.stem || '')}</p>
              <p class="tiny"><strong>Options:</strong> ${(pd.options || []).map((o, oi) => `${oi === pd.answer ? '<strong class="good">' : ''}${ctx.esc(o)}${oi === pd.answer ? ' ✓</strong>' : ''}`).join(' · ')}</p>
              ${pd.rationale ? `<p class="tiny"><strong>Rationale:</strong> ${ctx.esc(pd.rationale)}</p>` : ''}
            </div>
            <p class="dev-row-msg" data-prop-msg="${i}"></p>
          </div>`;
        }).join('')}
      </div>`;

    props.forEach((pr, i) => {
      const msg = host.querySelector(`[data-prop-msg="${i}"]`);
      host.querySelector(`[data-prop-ok="${i}"]`).addEventListener('click', async e => {
        if (!confirm('Approve this proposal? The corrected question publishes to EVERYONE and the flags resolve.')) return;
        e.target.disabled = true;
        try {
          await applyProposal(pr);
          await ctx.Backend.setProposalStatus(pr.id, 'approved');
          await ctx.Backend.resolveFlags(pr.questionKey);
          msg.textContent = '✓ Published and resolved.'; msg.className = 'dev-row-msg good';
          await refreshProposals(view); await refreshFlags(view);
        } catch (err) { msg.textContent = err.message || String(err); msg.className = 'dev-row-msg bad'; e.target.disabled = false; }
      });
      host.querySelector(`[data-prop-no="${i}"]`).addEventListener('click', async () => {
        if (!confirm('Reject this proposal? The reviewer will see it as rejected; the flag stays open.')) return;
        await ctx.Backend.setProposalStatus(pr.id, 'rejected');
        await refreshProposals(view);
      });
    });
  }

  async function applyProposal(pr) {
    const { paperId, kind, num } = parseQkey(pr.questionKey);
    const loaded = await ctx.Data.loadPaper(paperId);
    const loc = locateQuestion(loaded.paper, kind, num);
    if (!loc) throw new Error('Question not found in the paper (was it deleted?).');
    const pd = pr.proposed || {};
    const q = loc.q;
    if (pd.stem) q.stem = pd.stem;
    q.rationale = pd.rationale || q.rationale || '';
    if (Array.isArray(pd.options) && pd.options.length >= 2) {
      if (loc.type === 'sba') q.options = pd.options; else loc.block.options = pd.options;
      q.answer = Math.min(Number(pd.answer) || 0, pd.options.length - 1);
    } else if (Number.isInteger(pd.answer)) q.answer = pd.answer;
    if (loc.type === 'sba' && pd.lead != null) q.lead = pd.lead;
    if (loc.type === 'emq' && pd.theme) loc.block.theme = pd.theme;
    const meta = { ...loaded.meta, content: loaded.paper, sba: ctx.Data.countSBA(loaded.paper), emq: ctx.Data.countEMQ(loaded.paper) };
    delete meta.file;
    await ctx.Backend.publishPaper(meta);
    ctx.Data.bustPapers?.();
    if (typeof Cache !== 'undefined') Cache.bust('sim-qindex');
  }

  async function refreshFlags(view) {
    const host = view.querySelector('#qr-list');
    let flags = [];
    try { flags = (await ctx.Backend.listAllFlags()) || []; }
    catch (e) { host.innerHTML = `<p class="bad">Could not load flags — ${ctx.esc(e.message || e)}<br><span class="muted tiny">Run the updated supabase/schema.sql once (uqe dev read policy).</span></p>`; return; }
    // group by question
    const groups = {};
    flags.forEach(f => {
      const g = groups[f.questionKey] || (groups[f.questionKey] = { qkey: f.questionKey, reports: [], open: false });
      g.reports.push(f);
      if (!f.resolved) g.open = true;
    });
    const openGroups = Object.values(groups).filter(g => g.open);
    const doneCount = Object.values(groups).length - openGroups.length;
    if (!openGroups.length) {
      host.innerHTML = `<p class="muted card" style="padding:20px">🎉 No open flags — the bank is clean.${doneCount ? ` (${doneCount} previously resolved.)` : ''}</p>`;
      return;
    }
    const papers = await ctx.Data.publishedPapers();
    const titleOf = pid => papers.find(p => p.id === pid)?.title || pid;
    host.innerHTML = openGroups.map((g, i) => {
      const { paperId, kind, num } = parseQkey(g.qkey);
      return `
      <div class="dev-row card qr-card" data-qr="${i}">
        <div class="dev-row-head">
          <div>
            <p class="dev-file">🚩 ${ctx.esc(titleOf(paperId))} · <span class="chip chip-${(kind || 'sba').toLowerCase()}">${ctx.esc(kind)}</span> Q${num}</p>
            <p class="muted tiny">${g.reports.length} report${g.reports.length > 1 ? 's' : ''} · latest ${new Date(g.reports[0].updated || Date.now()).toLocaleDateString()}</p>
          </div>
          <div class="qr-actions">
            <button class="btn btn-ghost btn-sm" data-qr-edit="${i}">✎ Open editor</button>
            <button class="btn btn-ghost btn-sm" data-qr-audit="${i}">🤖 AI audit</button>
            <button class="btn btn-gold btn-sm" data-qr-resolve="${i}">✓ Resolve</button>
          </div>
        </div>
        <div class="qr-reports">${g.reports.map(r => `
          <div class="qr-report ${r.resolved ? 'qr-done' : ''}">
            <span class="qr-who">${ctx.esc(r.userName || r.userEmail)} <span class="muted tiny">${ctx.esc(r.userEmail)}</span></span>
            <span class="qr-note">${r.flagNote ? ctx.esc(r.flagNote) : '<span class="muted">(no reason given)</span>'}</span>
          </div>`).join('')}</div>
        <div class="qr-editor" data-qr-host="${i}"></div>
        <p class="dev-row-msg" data-qr-msg="${i}"></p>
      </div>`;
    }).join('') + (doneCount ? `<p class="muted tiny">${doneCount} previously resolved flag${doneCount > 1 ? 's' : ''} hidden.</p>` : '');

    openGroups.forEach((g, i) => {
      const msg = host.querySelector(`[data-qr-msg="${i}"]`);
      host.querySelector(`[data-qr-edit="${i}"]`).addEventListener('click', () => openQuestionEditor(view, g, i, msg));
      host.querySelector(`[data-qr-audit="${i}"]`).addEventListener('click', () => runAudit(host, g, i, msg));
      host.querySelector(`[data-qr-resolve="${i}"]`).addEventListener('click', async () => {
        if (!confirm('Mark every report on this question as resolved? It becomes eligible for mocks again.')) return;
        try { await ctx.Backend.resolveFlags(g.qkey); msg.textContent = '✓ Resolved.'; msg.className = 'dev-row-msg good'; await refreshFlags(view); }
        catch (e) { msg.textContent = 'Could not resolve: ' + (e.message || e); msg.className = 'dev-row-msg bad'; }
      });
    });
  }

  async function openQuestionEditor(view, g, i, msg) {
    const hostEl = view.querySelector(`[data-qr-host="${i}"]`);
    if (hostEl.dataset.open === '1') { hostEl.dataset.open = '0'; hostEl.innerHTML = ''; return; }
    hostEl.dataset.open = '1';
    hostEl.innerHTML = `<p class="muted">Loading question…</p>`;
    const { paperId, kind, num } = parseQkey(g.qkey);
    let loaded;
    try { loaded = await ctx.Data.loadPaper(paperId); }
    catch (e) { hostEl.innerHTML = `<p class="bad">${ctx.esc(e.message || e)}</p>`; return; }
    const loc = locateQuestion(loaded.paper, kind, num);
    if (!loc) { hostEl.innerHTML = `<p class="bad">Question ${num} not found in this paper (was it deleted already?).</p>`; return; }
    const q = loc.q;
    const options = loc.type === 'sba' ? (q.options || []) : (loc.block.options || []);
    hostEl.innerHTML = `
      <div class="qr-form">
        ${loc.type === 'emq' ? `<label>Theme<input type="text" data-f="theme" value="${ctx.esc(loc.block.theme || '')}"></label>` : ''}
        <label>Stem<textarea data-f="stem">${ctx.esc(q.stem || '')}</textarea></label>
        ${loc.type === 'sba' ? `<label>Lead-in<input type="text" data-f="lead" value="${ctx.esc(q.lead || '')}"></label>` : ''}
        <label>Options — one per line${loc.type === 'emq' ? ' <span class="tiny muted">(shared by every question in this EMQ theme)</span>' : ''}
          <textarea data-f="options" class="qr-options">${ctx.esc(options.join('\n'))}</textarea></label>
        <label>Correct answer
          <select data-f="answer">${options.map((o, oi) => `<option value="${oi}" ${oi === q.answer ? 'selected' : ''}>${ctx.esc(String(o).slice(0, 80))}</option>`).join('')}</select>
        </label>
        <label>Rationale<textarea data-f="rationale">${ctx.esc(q.rationale || q.explanation || '')}</textarea></label>
        <div class="qedit-btns">
          <button class="btn btn-gold btn-sm" data-f="save">💾 Save &amp; resolve flags</button>
          <button class="btn btn-ghost btn-sm" data-f="saveonly">Save only</button>
          <button class="btn btn-ghost btn-sm qr-danger" data-f="delete">🗑 Delete question</button>
        </div>
        <p class="tiny muted">Deleting renumbers later questions in this paper — their notes/stats keys shift. Prefer editing.</p>
      </div>`;
    const val = f => hostEl.querySelector(`[data-f="${f}"]`)?.value;
    async function republish(reason) {
      const meta = { ...loaded.meta, content: loaded.paper, sba: ctx.Data.countSBA(loaded.paper), emq: ctx.Data.countEMQ(loaded.paper) };
      delete meta.file;                              // backend copy overrides any bundled file
      await ctx.Backend.publishPaper(meta);
      ctx.Data.bustPapers?.();
      if (typeof Cache !== 'undefined') { Cache.bust('sim-qindex'); }
      msg.textContent = reason; msg.className = 'dev-row-msg good';
    }
    hostEl.querySelector('[data-f="save"]').addEventListener('click', () => saveEdit(true));
    hostEl.querySelector('[data-f="saveonly"]').addEventListener('click', () => saveEdit(false));
    async function saveEdit(resolve) {
      try {
        const opts = String(val('options') || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (opts.length < 2) throw new Error('Need at least 2 options.');
        const ans = Math.min(Number(val('answer')) || 0, opts.length - 1);
        q.stem = val('stem') || q.stem;
        q.rationale = val('rationale') || '';
        q.answer = ans;
        if (loc.type === 'sba') { q.options = opts; q.lead = val('lead') || ''; }
        else { loc.block.options = opts; if (val('theme')) loc.block.theme = val('theme'); }
        await republish(resolve ? '✓ Question corrected, published to everyone, flags resolved.' : '✓ Question corrected and published.');
        if (resolve) { await ctx.Backend.resolveFlags(g.qkey); await refreshFlags(view); }
      } catch (e) { msg.textContent = e.message || String(e); msg.className = 'dev-row-msg bad'; }
    }
    hostEl.querySelector('[data-f="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this question from the paper for EVERYONE? This cannot be undone.')) return;
      try {
        if (loc.type === 'sba') loc.arr.splice(loc.i, 1);
        else { loc.block.stems.splice(loc.si, 1); if (!loc.block.stems.length) { const blocks = loaded.paper.emq || loaded.paper.themes; blocks.splice(blocks.indexOf(loc.block), 1); } }
        await republish('✓ Question deleted from the paper.');
        await ctx.Backend.resolveFlags(g.qkey);
        await refreshFlags(view);
      } catch (e) { msg.textContent = e.message || String(e); msg.className = 'dev-row-msg bad'; }
    });
  }

  async function runAudit(host, g, i, msg) {
    const hostEl = host.querySelector(`[data-qr-host="${i}"]`);
    msg.textContent = 'Auditing against current guidance…'; msg.className = 'dev-row-msg muted';
    try {
      const { paperId, kind, num } = parseQkey(g.qkey);
      const loaded = await ctx.Data.loadPaper(paperId);
      const flat = ctx.Data.flatten(loaded.paper, kind).find(q => q.number === num);
      if (!flat) throw new Error('Question not found.');
      let stats = 'n/a';
      try {
        const st = ((await ctx.Backend.listQuestionStats()) || []).find(s => s.questionKey === g.qkey);
        if (st) stats = `${st.correct}/${st.attempts} candidates correct (${Math.round(st.correct / st.attempts * 100)}%)`;
      } catch {}
      const data = await aiCall('audit', {
        question: { kind, theme: flat.theme || '', stem: flat.stem, lead: flat.lead || '', options: flat.options, answer: flat.answer, rationale: flat.rationale, preLettered: flat.preLettered },
        complaints: g.reports.map(r => `${r.userName || r.userEmail}: ${r.flagNote || '(no reason)'}`),
        stats
      });
      msg.textContent = '';
      hostEl.dataset.open = '1';
      hostEl.innerHTML = `<div class="qr-audit"><h4>🤖 Examiner audit <span class="tiny muted">${ctx.esc(data.model || '')}</span></h4>${md(data.text)}</div>` + hostEl.innerHTML;
    } catch (e) { msg.textContent = e.message || String(e); msg.className = 'dev-row-msg bad'; }
  }

  /* ================================================================
     AI SYSTEMS PANEL — every AI engine: on/off, model, cost split,
     monthly spend. The registry below is the platform's AI roadmap.
     ================================================================ */

  // labels carry the $/1M in-out rates so model choices are informed ones
  const MODEL_OPTIONS = [
    { id: 'gemini|gemini-3.1-flash-lite',     label: 'Gemini 3.1 Flash-Lite · $0.25/$1.50' },
    { id: 'gemini|gemini-3.5-flash',          label: 'Gemini 3.5 Flash · $1.50/$9.00' },
    { id: 'gemini|gemini-3.1-pro',            label: 'Gemini 3.1 Pro · $2.00/$12.00' },
    { id: 'claude|claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 · $1.00/$5.00' },
    { id: 'claude|claude-sonnet-4-5',         label: 'Claude Sonnet 4.5 · $3.00/$15.00' }
  ];
  const SPLIT_OPTIONS = [
    { id: 'simulator', label: 'Split across simulator users' },
    { id: 'all',       label: 'Split across all users' },
    { id: 'dev',       label: 'Developer absorbs the cost' }
  ];
  const AI_FEATURES = [
    { id: 'ai_tutor', name: '✨ AI tutor', status: 'live', billing: 'per-user',
      desc: 'Explore-with-AI explanations and follow-up chat on every question. Each user pays for their own tokens.',
      defaults: { enabled: true, provider: 'gemini', model: 'gemini-3.1-flash-lite', split: 'per-user' } },
    { id: 'ai_coach', name: '🎯 Mock coach', status: 'live', billing: 'per-user',
      desc: 'Post-mock study plan built from per-topic scores + the blueprint\'s examiner tendencies.',
      defaults: { enabled: true, provider: 'gemini', model: 'gemini-3.1-flash-lite', split: 'per-user' } },
    { id: 'auto_flashcards', name: '🃏 AI flashcards from mistakes', status: 'live', billing: 'per-user',
      desc: 'Wrong answers become spaced-repetition cards in a personal deck. Grant per user with the AI cards flag in Users & access.',
      defaults: { enabled: true, provider: 'gemini', model: 'gemini-3.1-flash-lite', split: 'per-user' } },
    { id: 'question_tagger', name: '🏷 Question tagger', status: 'live', billing: 'shared',
      desc: 'AI classifies every bank question onto the blueprint\'s topics (+ guideline + difficulty estimate) so mock selection is exact, not keyword-guessed. Runs once per question — never re-tags.',
      defaults: { enabled: true, provider: 'gemini', model: 'gemini-3.1-flash-lite', split: 'simulator' } },
    { id: 'behaviour_insights', name: '🔬 Behaviour insights', status: 'live', billing: 'shared',
      desc: 'Analyses the tracked interaction data — dwell times, answer changes, what users literally ask the tutor — and reports what the cohort finds hard and why.',
      defaults: { enabled: true, provider: 'claude', model: 'claude-haiku-4-5-20251001', split: 'simulator' } },
    { id: 'question_auditor', name: '⚖️ Question auditor', status: 'live', billing: 'shared',
      desc: 'Chief-examiner audit of flagged questions: verdict against current NICE/RCOG/SLCOG guidance + a paste-ready correction.',
      defaults: { enabled: true, provider: 'claude', model: 'claude-haiku-4-5-20251001', split: 'dev' } },
    { id: 'viva_examiner', name: '🎓 Viva examiner', status: 'planned', billing: 'per-user',
      desc: 'Structured AI viva: presents a case, questions stepwise, pushes back on vague answers, scores against a rubric. The one thing candidates cannot practise alone.',
      defaults: { enabled: false, provider: 'claude', model: 'claude-haiku-4-5-20251001', split: 'per-user' } },
    { id: 'readiness_forecaster', name: '📈 Readiness forecaster', status: 'planned', billing: 'shared',
      desc: 'Ability-model (Elo/Rasch) pass-probability with a confidence band, narrated weekly: "66% ± 4 — borderline; close it in 3 weeks at current pace."',
      defaults: { enabled: false, provider: 'gemini', model: 'gemini-3.1-flash-lite', split: 'simulator' } },
    { id: 'weekly_digest', name: '📬 Weekly digest', status: 'planned', billing: 'shared',
      desc: 'Sunday summary per user: readiness trend, 3 weakest topics, due flashcards, next week\'s plan.',
      defaults: { enabled: false, provider: 'gemini', model: 'gemini-3.1-flash-lite', split: 'all' } },
    { id: 'rationale_enhancer', name: '📚 Rationale enhancer', status: 'planned', billing: 'shared',
      desc: 'Upgrades thin rationales across the bank with guideline-cited explanations (batch, one-off per question).',
      defaults: { enabled: false, provider: 'claude', model: 'claude-haiku-4-5-20251001', split: 'simulator' } }
  ];

  async function renderAiSection(view) {
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · AI SYSTEMS</p>
          <h1 class="page-title">AI mission control</h1>
          <p class="muted">Every AI engine on the platform. You decide: on or off, which model runs it, and who the
            tokens are billed to. Shared jobs run <strong>once per unit of work</strong> — nothing re-analyses the same data twice.</p>
        </header>
        <div class="card" data-animate>
          <h3 class="card-title">🏷 Question tagger</h3>
          <p class="muted" id="tag-status">Checking bank…</p>
          <div class="dev-toolbar">
            <button class="btn btn-gold" id="tag-run" disabled>Tag remaining questions</button>
            <button class="btn btn-ghost" id="tag-stop" hidden>⏸ Stop</button>
            <span class="dev-status" id="tag-progress"></span>
          </div>
        </div>
        <div class="card" data-animate>
          <h3 class="card-title">🔬 Behaviour insights</h3>
          <p class="muted">One click analyses the latest tracked behaviour (dwell, answer changes, tutor questions). Run it weekly, not daily — the data needs time to accumulate.</p>
          <div class="dev-toolbar">
            <button class="btn btn-gold" id="ins-run">Analyse behaviour data</button>
            <span class="dev-status" id="ins-status"></span>
          </div>
          <div id="ins-out"></div>
        </div>
        <div class="card" data-animate>
          <h3 class="card-title">Systems registry</h3>
          <p class="muted">Changes save instantly and take effect on users' next page load. “Split” decides whose invoice carries a shared job's tokens.</p>
          <div id="ai-feats"><p class="muted">Loading…</p></div>
          <p class="dev-row-msg" id="ai-msg"></p>
        </div>
      </section>`;
    ctx.FX.viewIn(view);
    await refreshAiPanel(view);
    wireTagger(view);
    view.querySelector('#ins-run').addEventListener('click', () => runInsights(view));
  }

  async function refreshAiPanel(view) {
    const host = view.querySelector('#ai-feats');
    let saved = {}, shared = [];
    try { saved = (await ctx.Backend.getAiFeatures()) || {}; } catch { saved = {}; }
    try { shared = (await ctx.Backend.listSharedUsage()) || []; } catch { shared = []; }
    const month = new Date().toISOString().slice(0, 7);
    const usageOf = fid => {
      const rows = shared.filter(r => r.feature === fid && String(r.day).slice(0, 7) === month);
      const tok = rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
      const cost = rows.reduce((s, r) => s + (r.inputTokens / 1e6) * Billing.rateFor(r.model).in + (r.outputTokens / 1e6) * Billing.rateFor(r.model).out, 0);
      return { tok, cost, calls: rows.reduce((s, r) => s + r.calls, 0) };
    };
    // Google retired 1.x/2.x and gemini-3-flash for new keys — a stale saved
    // choice migrates to the feature default (the server does the same).
    const retired = m => /^gemini-(1|2)[.\-]/.test(m || '') || m === 'gemini-3-flash';
    host.innerHTML = AI_FEATURES.map(f => {
      const c = Object.assign({}, f.defaults, saved[f.id] || {});
      if (c.provider === 'gemini' && retired(c.model)) c.model = f.defaults.model;
      const u = usageOf(f.id);
      const modelId = `${c.provider}|${c.model}`;
      const planned = f.status === 'planned';
      return `
        <div class="ai-feat ${planned ? 'ai-feat-planned' : ''}" data-feat="${f.id}">
          <div class="ai-feat-main">
            <div class="ai-feat-name">${f.name}
              ${planned ? '<span class="qedit-tag">in development</span>' : '<span class="qedit-tag" style="background:rgba(52,211,153,.15);color:#34d399">live</span>'}
              <span class="tiny muted">${f.billing === 'per-user' ? 'billed per user' : 'shared pool'}</span>
            </div>
            <p class="muted tiny">${f.desc}</p>
          </div>
          <div class="ai-feat-controls">
            <label class="dev-flag" title="${planned ? 'Coming soon' : 'Enable / disable'}"><input type="checkbox" data-fc="enabled" ${c.enabled ? 'checked' : ''} ${planned ? 'disabled' : ''}><span></span></label>
            <select data-fc="model" ${planned ? 'disabled' : ''}>${MODEL_OPTIONS.map(m => `<option value="${m.id}" ${m.id === modelId ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
            <select data-fc="split" ${planned || f.billing === 'per-user' ? 'disabled' : ''} title="${f.billing === 'per-user' ? 'Each user pays their own tokens' : 'Who carries this pool'}">
              ${f.billing === 'per-user' ? '<option>Each user pays own use</option>' : SPLIT_OPTIONS.map(s => `<option value="${s.id}" ${s.id === c.split ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
            <span class="ai-feat-usage" title="This month">${f.billing === 'per-user'
              ? '<span class="tiny muted">see Users &amp; access</span>'
              : `${u.calls} calls · ${(u.tok / 1000).toFixed(1)}k tok · <strong>${Billing.usd(u.cost)}</strong>`}</span>
          </div>
        </div>`;
    }).join('');
    const msg = view.querySelector('#ai-msg');
    host.querySelectorAll('[data-fc]').forEach(el => el.addEventListener('change', async () => {
      const row = el.closest('[data-feat]');
      const fid = row.dataset.feat;
      const def = AI_FEATURES.find(f => f.id === fid);
      const [provider, model] = String(row.querySelector('[data-fc="model"]').value).split('|');
      const rec = {
        enabled: row.querySelector('[data-fc="enabled"]').checked,
        provider, model,
        split: def.billing === 'per-user' ? 'per-user' : row.querySelector('[data-fc="split"]').value
      };
      try {
        const all = Object.assign({}, (await ctx.Backend.getAiFeatures()) || {});
        all[fid] = rec;
        await ctx.Backend.saveAiFeatures(all);
        if (typeof Cache !== 'undefined') Cache.bust('ai-features');
        msg.textContent = `✓ ${def.name.replace(/^\S+\s/, '')} saved.`; msg.className = 'dev-row-msg good';
      } catch (e) { msg.textContent = 'Could not save: ' + (e.message || e); msg.className = 'dev-row-msg bad'; }
    }));
  }

  /* ---------------- the tagger engine ---------------- */

  async function untaggedRecords() {
    const index = await Simulator.buildIndex();
    let tagged = new Set();
    try { tagged = new Set(((await ctx.Backend.listQuestionTags()) || []).map(t => t.questionKey)); } catch {}
    return { index, todo: index.filter(r => !tagged.has(r.qkey)), taggedCount: tagged.size };
  }
  // resolve records → compact question payloads for the tag prompt
  async function resolveForTagging(records) {
    const byPaper = {};
    records.forEach(r => (byPaper[r.paperId] || (byPaper[r.paperId] = [])).push(r));
    const out = [];
    for (const pid of Object.keys(byPaper)) {
      let loaded; try { loaded = await ctx.Data.loadPaper(pid); } catch { continue; }
      const flat = {};
      ['SBA', 'EMQ'].forEach(kind => ctx.Data.flatten(loaded.paper, kind).forEach(q => flat[`${pid}:${kind}:${q.number}`] = q));
      byPaper[pid].forEach(r => { const q = flat[r.qkey]; if (q) out.push({ key: r.qkey, kind: q.kind, theme: q.theme || '', stem: q.stem, lead: q.lead || '', options: q.options, rationale: q.rationale || '' }); });
    }
    return out;
  }
  async function tagRecords(records) {
    const bp = await Blueprint.load();
    const topics = [...(bp.sba || []).map(b => b.subcategory || b.category), ...(bp.emq || []).map(b => b.theme)].filter(Boolean);
    const questions = await resolveForTagging(records);
    if (!questions.length) return { n: 0, tokIn: 0, tokOut: 0, model: '' };
    const data = await aiCall('tag', { topics, questions });
    // Robust JSON extraction: strip fences, then fall back to the outermost
    // [...] block (models sometimes add prose), then salvage complete
    // objects from a truncated array rather than losing the whole batch.
    const stripped = String(data.text || '').replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
    let rows = null;
    try { rows = JSON.parse(stripped); } catch {
      const m = stripped.match(/\[[\s\S]*\]/);
      if (m) { try { rows = JSON.parse(m[0]); } catch { rows = null; } }
      if (!rows) {
        const objs = stripped.match(/\{[^{}]*\}/g) || [];
        rows = objs.map(o => { try { return JSON.parse(o); } catch { return null; } }).filter(Boolean);
      }
    }
    if (!Array.isArray(rows) || !rows.length) {
      // show what actually came back — a blind "unparseable" hides the cause
      const peek = stripped.slice(0, 140).replace(/\s+/g, ' ');
      throw new Error(`Tagger output was not parseable JSON. The model returned: "${peek || '(empty response)'}…"`);
    }
    const valid = (Array.isArray(rows) ? rows : []).filter(r => r.key && r.topic)
      .map(r => ({ questionKey: r.key, topic: r.topic, category: r.category || '', guideline: r.guideline || '', tags: r.tags || [], difficulty: typeof r.difficulty === 'number' ? r.difficulty : null, taggedBy: data.model || '' }));
    if (valid.length) await ctx.Backend.saveQuestionTags(valid);
    const u = data.usage || {};
    return { n: valid.length, tokIn: u.in || 0, tokOut: u.out || 0, model: data.model || '' };
  }
  function wireTagger(view) {
    const status = view.querySelector('#tag-status');
    const progress = view.querySelector('#tag-progress');
    const btn = view.querySelector('#tag-run');
    const stopBtn = view.querySelector('#tag-stop');
    let stopReq = false;
    stopBtn.addEventListener('click', () => { stopReq = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping after this batch…'; });
    (async () => {
      try {
        const { index, todo, taggedCount } = await untaggedRecords();
        status.innerHTML = `<strong>${taggedCount}</strong> of ${index.length} bank questions tagged · <strong>${todo.length}</strong> remaining. Tagging runs in batches of 10 and each question is only ever tagged once.`;
        btn.disabled = !todo.length;
        btn.onclick = async () => {
          btn.disabled = true; stopReq = false;
          stopBtn.hidden = false; stopBtn.disabled = false; stopBtn.textContent = '⏸ Stop';
          // the model the panel has configured — anything else serving is an alarm
          let selModel = 'gemini-3.1-flash-lite';
          try {
            const saved = (await ctx.Backend.getAiFeatures())?.question_tagger?.model;
            if (saved && !(/^gemini-(1|2)[.\-]/.test(saved) || saved === 'gemini-3-flash')) selModel = saved;
          } catch {}
          // live meter: exact provider-reported tokens per batch → dollars,
          // plus WHICH model actually answered (red if not the selected one)
          let done = 0, failedBatches = 0, tokIn = 0, tokOut = 0, costUsd = 0, served = '';
          let lastErr = '', consecFails = 0;   // circuit breaker: 3 identical fails in a row = stop
          const fmtTok = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : (n / 1e3).toFixed(1) + 'k';
          const meter = () => {
            const ok = !served || served.startsWith(selModel);
            return `<strong>${fmtTok(tokIn + tokOut)}</strong> tokens · <strong class="dev-cost">${Billing.usd(costUsd, costUsd < 1 ? 3 : 2)}</strong>` +
              (served ? ` · <span class="${ok ? 'muted' : 'bad'}">${ok ? '' : '⚠ served by '}${ctx.esc(served)}</span>` : '');
          };
          try {
            for (let i = 0; i < todo.length; i += 10) {
              if (stopReq) break;
              progress.innerHTML = `Tagging ${Math.min(i + 10, todo.length)}/${todo.length}… · ${meter()}${failedBatches ? ` · <span class="bad">${failedBatches} to retry</span>` : ''}`;
              try {
                const r = await tagRecords(todo.slice(i, i + 10));
                done += r.n; tokIn += r.tokIn; tokOut += r.tokOut;
                if (r.model) served = r.model;
                const rate = Billing.rateFor(r.model);
                costUsd += (r.tokIn / 1e6) * rate.in + (r.tokOut / 1e6) * rate.out;
                consecFails = 0;
              } catch (e) {
                // fatal errors (auth, config, quota, unavailable model) stop
                // the run; a flaky batch (truncated output) is skipped and
                // stays untagged — the next run picks it up. But 3 failures
                // IN A ROW means something systematic: stop and say why
                // instead of spinning through hundreds of doomed batches.
                lastErr = String(e.message || e);
                if (/sign in|Developer only|HTTP 4|quota|API_KEY|configured|not found|not supported|Could not save/i.test(lastErr)) throw e;
                failedBatches++; consecFails++;
                if (consecFails >= 3) throw new Error(`${consecFails} batches in a row failed with: ${lastErr}`);
              }
            }
            if (typeof Cache !== 'undefined') Cache.bust('sim-qtags');
            progress.innerHTML = (stopReq
              ? `<span class="muted">⏸ Stopped — ${done} tagged this run, progress saved. Click “Tag remaining questions” to resume.</span>`
              : failedBatches
                ? `<span class="good">✓ ${done} questions tagged.</span> <span class="bad">${failedBatches} batch${failedBatches > 1 ? 'es' : ''} failed${lastErr ? ` (last error: ${ctx.esc(lastErr)})` : ''} — click again to tag the remainder.</span>`
                : `<span class="good">✓ ${done} questions tagged — mock selection is now tag-precise.</span>`) + ` · ${meter()}`;
            if (!failedBatches && !stopReq) status.textContent = 'Bank fully tagged.';
            btn.disabled = !failedBatches && !stopReq && true;
            if (stopReq || failedBatches) btn.disabled = false;
          } catch (e) {
            progress.innerHTML = `<span class="bad">${ctx.esc(e.message || e)} — progress is saved; run again to continue.</span> · ${meter()}`;
            btn.disabled = false;
          }
          stopBtn.hidden = true;
        };
      } catch (e) { status.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; }
    })();
  }
  // fire-and-forget: tag a paper's questions right after it is published,
  // so new papers enter the bank already classified
  async function tagPaperQuestions(meta) {
    try {
      const recs = [];
      const paper = meta.content;
      ctx.Data.flatten(paper, 'SBA').forEach(q => recs.push({ paperId: meta.id, qkey: `${meta.id}:SBA:${q.number}` }));
      ctx.Data.flatten(paper, 'EMQ').forEach(q => recs.push({ paperId: meta.id, qkey: `${meta.id}:EMQ:${q.number}` }));
      for (let i = 0; i < recs.length; i += 10) { try { await tagRecords(recs.slice(i, i + 10)); } catch { /* runner catches up */ } }
      if (typeof Cache !== 'undefined') Cache.bust('sim-qtags');
    } catch { /* tagging failures never block publishing; the runner catches up */ }
  }

  /* ---------------- behaviour insights runner ---------------- */

  async function runInsights(view) {
    const status = view.querySelector('#ins-status'), out = view.querySelector('#ins-out');
    status.textContent = 'Collecting behaviour data…';
    try {
      const events = (await ctx.Backend.listRecentEvents?.(1500)) || [];
      if (events.length < 30) throw new Error(`Only ${events.length} tracked events so far — let the cohort practise a few days first.`);
      // aggregate client-side so ONE compact payload goes to the model
      const agg = {};
      events.forEach(e => {
        if (!e.question_key) return;
        const a = agg[e.question_key] || (agg[e.question_key] = { dwell: 0, dwellN: 0, changes: 0, strikes: 0, asks: [] });
        if (e.event === 'dwell') { a.dwell += e.data?.t || 0; a.dwellN++; }
        if (e.event === 'change') a.changes++;
        if (e.event === 'strike') a.strikes++;
        if (e.event === 'ai_ask' && e.data?.q && a.asks.length < 4) a.asks.push(e.data.q);
      });
      const lines = Object.entries(agg)
        .map(([k, a]) => ({ k, score: a.changes * 3 + a.strikes + (a.dwellN ? a.dwell / a.dwellN / 30 : 0) + a.asks.length * 2, a }))
        .sort((x, y) => y.score - x.score).slice(0, 30)
        .map(({ k, a }) => `${k} · avg dwell ${a.dwellN ? Math.round(a.dwell / a.dwellN) : '?'}s · ${a.changes} answer changes · ${a.strikes} strikes${a.asks.length ? ' · tutor asked: "' + a.asks.join('" | "') + '"' : ''}`);
      status.textContent = 'Analysing with AI…';
      const data = await aiCall('insights', { data: lines.join('\n') });
      status.innerHTML = `<span class="good">✓ Analysis of ${events.length} events (${data.model || ''})</span>`;
      out.innerHTML = `<div class="ai-body qr-audit">${md(data.text)}</div>`;
    } catch (e) { status.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; out.innerHTML = ''; }
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
