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
  let bpEdit = null;        // Blueprint Studio working copy (deep clone of the loaded doc)
  let bpCoverage = null;    // last computed { sba:{name:{matched,pool,areas}}, emq:{...} }

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
    if (section === 'tearoom') return renderTeaSection(view);
    if (section === 'essays') return renderEssaysSection(view);
    if (section === 'osce') return renderOsceSection(view);
    if (section === 'settings') return renderSettingsSection(view);
    if (section === 'cpd') return renderCpdSection(view);
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
          <a class="dev-hub-card" href="#/dev/tearoom" style="--hub-accent:linear-gradient(135deg,#e879b9,#7dd3fc)">
            <span class="dev-hub-ico">☕</span>
            <h3>Tea room</h3>
            <p>Wall, chat, refresh cadence and moderation.</p>
            <span class="dev-hub-count" id="hub-tea">…</span>
          </a>
          <a class="dev-hub-card" href="#/dev/essays" style="--hub-accent:linear-gradient(135deg,#f4c95d,#a78bfa)">
            <span class="dev-hub-ico">📝</span>
            <h3>Essay importer</h3>
            <p>Scan Drive for structured-essay mock papers (SAQ/SEQ), validate and publish to the Essay section.</p>
            <span class="dev-hub-count" id="hub-essays">…</span>
          </a>
          <a class="dev-hub-card" href="#/dev/osce" style="--hub-accent:linear-gradient(135deg,#5eead4,#3987e5)">
            <span class="dev-hub-ico">🎙</span>
            <h3>OSCE stations</h3>
            <p>Import spoken OSCE stations (scenario, questions, marking scheme) and publish them to the OSCE tab.</p>
            <span class="dev-hub-count" id="hub-osce">…</span>
          </a>
          <a class="dev-hub-card" href="#/dev/settings" style="--hub-accent:linear-gradient(135deg,#f4c95d,#34d399)">
            <span class="dev-hub-ico">⚙</span>
            <h3>Rates &amp; settings</h3>
            <p>The dollar rate, the prepaid wallet, and the top-up requests waiting for your approval.</p>
            <span class="dev-hub-count" id="hub-wallet">…</span>
          </a>
          <a class="dev-hub-card" href="#/dev/cpd" style="--hub-accent:linear-gradient(135deg,#5eead4,#818cf8)">
            <span class="dev-hub-ico">📖</span>
            <h3>CPD importer</h3>
            <p>Scan Drive for TOG CPD volumes (ogr-cpd-v1/v2, true/false + SBA), validate and publish to Library → CPD.</p>
            <span class="dev-hub-count" id="hub-cpd">…</span>
          </a>
        </div>
      </section>`;
    ctx.FX.viewIn(view);
    // decorate counts asynchronously (all reads are device-cached)
    try { paperN = (await ctx.Data.publishedPapers()).length + ' published'; } catch { paperN = '—'; }
    try { deckN = ((await ctx.Backend.getFlashcardDecks()) || []).length + ' decks live'; } catch { deckN = '—'; }
    let cpdN = '—';
    try { const cv = (await ctx.Backend.getCpdVolumes()) || [];
      const qn = cv.reduce((n, v) => n + (v.sections || []).reduce((m, x) => m + (x.questions || []).length, 0), 0);
      cpdN = cv.length ? `${cv.length} volume${cv.length !== 1 ? 's' : ''} · ${qn} questions` : 'none yet';
    } catch { cpdN = 'run schema.sql'; }
    try { userN = ((await ctx.Backend.listAllUsers()) || []).length + ' accounts'; } catch { userN = 'run schema.sql'; }
    let bpN = 'bundled default';
    try { const bp = await Blueprint.load(); if (bp?.sba?.length) bpN = `v${bp.version} · ${bp.sba.length}+${bp.emq.length} topics`; } catch { /* keep default */ }
    let flagN = '—';
    try { const fl = (await ctx.Backend.listAllFlags()) || []; const open = new Set(fl.filter(f => !f.resolved).map(f => f.questionKey)).size; flagN = open ? `${open} awaiting review` : 'all clear'; } catch { flagN = 'run schema.sql'; }
    let aiN = '—';
    try { const fc = (await ctx.Backend.getAiFeatures()) || {}; const live = AI_FEATURES.filter(f => f.status === 'live' && (fc[f.id]?.enabled ?? f.defaults.enabled)).length; aiN = `${live}/${AI_FEATURES.length} systems on`; } catch { aiN = '—'; }
    let essayN = '—';
    try { essayN = ((await ctx.Backend.getEssayPapers()) || []).length + ' papers'; } catch { essayN = 'run schema.sql'; }
    const put = (id, v) => { const el = view.querySelector(id); if (el) el.textContent = v; };
    put('#hub-papers', paperN); put('#hub-decks', deckN); put('#hub-users', userN); put('#hub-bp', bpN);
    let osceN = '—', walN = '—';
    try { osceN = ((await ctx.Backend.getOsceStations()) || []).length + ' stations'; } catch { osceN = 'run schema.sql'; }
    try { const t = (await ctx.Backend.listAllTopUps()) || []; const p = t.filter(x => x.status === 'pending').length;
      walN = p ? p + ' awaiting approval' : t.length + ' top-ups'; } catch { walN = 'run schema.sql'; }
    put('#hub-flags', flagN); put('#hub-ai', aiN); put('#hub-essays', essayN);
    put('#hub-osce', osceN); put('#hub-wallet', walN);
    put('#hub-cpd', cpdN);
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
            <label class="btn btn-ghost" style="cursor:pointer">⬆ Upload file
              <input type="file" id="bp-file" accept=".md,.markdown,.json,.txt" hidden>
            </label>
            <button class="btn btn-gold" id="bp-edit">✎ Edit in Studio</button>
            <button class="btn btn-ghost" id="bp-coverage">🎯 Check coverage</button>
            <span class="dev-status" id="bp-status"></span>
          </div>
          <div id="bp-summary"></div>
        </div>
        <div id="bp-studio"></div>
      </section>`;

    view.querySelector('#bp-file').addEventListener('change', uploadBlueprint);
    view.querySelector('#bp-edit').addEventListener('click', () => openBlueprintStudio(view));
    view.querySelector('#bp-coverage').addEventListener('click', () => runCoverage(view));
    bpEdit = null;
    await refreshBlueprint(view);
    ctx.FX.viewIn(view);
  }

  /* ---------------- blueprint coverage analysis ----------------
     For every bucket and every specific_area, how many questions in the LIVE
     bank actually match — using the SAME signals the selector uses (category
     gate for SBA, AI-tag topic, and keyword affinity against question text).
     Turns "I edited an area" into "…and 7 real questions back it" (or zero). */
  const bpNorm = s => Blueprint.normStr(s);
  const bpSameCat = (a, b) => { a = bpNorm(a); b = bpNorm(b); return a && b && (a === b || a.includes(b) || b.includes(a)); };
  /* Significant words of an area. Long words discriminate best, but short
     acronyms (HIV, DSD, GTD, LSCS) ARE the topic — falling back to them stops
     those areas being reported as "no match" when the bank is full of them. */
  function areaWords(a) {
    const all = bpNorm(a).split(' ').filter(Boolean);
    const long = all.filter(w => w.length > 4);
    return long.length ? long : all.filter(w => w.length >= 3);
  }

  async function buildCoverageIndex() {
    const index = await Simulator.buildIndex();          // [{qkey,kind,category,group,text}]
    let tags = {};
    try { (await ctx.Backend.listQuestionTags?.() || []).forEach(t => tags[t.questionKey] = t); } catch { /* untagged bank still works */ }
    // Pre-tokenise once. Token-set lookups are O(1), so a 9k-question bank
    // scans instantly instead of running tens of thousands of substring scans.
    return index.map(r => {
      const tg = tags[r.qkey];
      const text = bpNorm(tg ? [tg.topic, tg.category, ...(tg.tags || [])].filter(Boolean).join(' ') + ' ' + r.text : r.text);
      return { kind: r.kind, category: r.category, text, tokens: new Set(text.split(' ')), tagTopic: tg?.topic || '' };
    });
  }
  function coverBuckets(enriched, buckets, kind, keyOf, catGate) {
    const byKind = enriched.filter(r => r.kind === kind);
    return buckets.map(b => {
      const name = keyOf(b), nName = bpNorm(name);
      const pool = byKind.filter(r => !catGate || !b.category || bpSameCat(r.category, b.category));
      const areaTokens = (b.areas || []).map(a => ({ area: a, words: areaWords(a) }));
      const areaCounts = areaTokens.map(() => 0);
      let matched = 0;
      for (const r of pool) {
        let hit = (nName && r.text.includes(nName)) || (r.tagTopic && bpSameCat(r.tagTopic, name));
        areaTokens.forEach((at, i) => {
          if (at.words.length && at.words.some(w => r.tokens.has(w))) { areaCounts[i]++; hit = true; }
        });
        if (hit) matched++;
      }
      return { name, weight: b.weight, pool: pool.length, matched, areas: areaTokens.map((at, i) => ({ area: at.area, count: areaCounts[i] })) };
    });
  }
  async function computeCoverage(doc) {
    const enriched = await buildCoverageIndex();
    return {
      sba: coverBuckets(enriched, doc.sba || [], 'SBA', b => b.subcategory || b.category, true),
      emq: coverBuckets(enriched, doc.emq || [], 'EMQ', b => b.theme, false),
      total: enriched.length
    };
  }
  const covClass = c => c.matched === 0 ? 'cov-none' : c.matched < Math.max(3, c.weight) ? 'cov-low' : 'cov-ok';
  const areaClass = n => n === 0 ? 'cov-none' : n < 3 ? 'cov-low' : 'cov-ok';

  async function runCoverage(view) {
    const status = view.querySelector('#bp-status');
    status.textContent = 'Scanning the bank…'; status.className = 'dev-status';
    let doc; try { doc = bpEdit || await Blueprint.load(); } catch { doc = null; }
    if (!doc) { status.innerHTML = '<span class="bad">No blueprint loaded.</span>'; return; }
    try {
      bpCoverage = await computeCoverage(doc);
      status.innerHTML = `<span class="good">✓ Scanned ${bpCoverage.total} bank questions.</span>`;
      if (bpEdit) drawStudio(view); else drawCoverageReport(view, doc, bpCoverage);
    } catch (e) { status.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; }
  }
  function coverageRowsHTML(cov) {
    const row = c => `<tr class="${covClass(c)}">
      <td>${ctx.esc(c.name)}</td><td class="num">w${c.weight}</td>
      <td class="num"><strong>${c.matched}</strong><span class="muted">/${c.pool}</span></td>
      <td>${c.areas.length ? `<div class="cov-areas">${c.areas.map(a => `<span class="cov-chip ${areaClass(a.count)}" title="${ctx.esc(a.area)}">${a.count} · ${ctx.esc(a.area.length > 42 ? a.area.slice(0, 40) + '…' : a.area)}</span>`).join('')}</div>` : '<span class="muted tiny">no specific areas</span>'}</td></tr>`;
    return c => row(c);
  }
  function drawCoverageReport(view, doc, cov) {
    const host = view.querySelector('#bp-studio');
    const rows = coverageRowsHTML(cov);
    const legend = `<p class="cov-legend"><span class="cov-chip cov-ok">backed</span> <span class="cov-chip cov-low">thin (&lt;3)</span> <span class="cov-chip cov-none">no match — nothing in the bank</span></p>`;
    const tbl = (title, arr) => `<div class="card" data-animate><h4>${title}</h4>${legend}
      <div class="table-scroll"><table class="table bp-cov-table"><thead><tr><th>Bucket</th><th>Weight</th><th>Matched</th><th>Specific areas (matches each)</th></tr></thead>
      <tbody>${arr.map(rows).join('')}</tbody></table></div></div>`;
    host.innerHTML = tbl(`SBA coverage · ${cov.sba.length} buckets`, cov.sba) + tbl(`EMQ coverage · ${cov.emq.length} themes`, cov.emq);
  }

  /* ---------------- section: tea room controller ---------------- */

  const TEA_DEFAULTS = { intervalOpen: 20, intervalIdle: 75, maxUploadMb: 8, desktopNotif: true, wallEnabled: true, chatEnabled: true, retentionDays: 0 };
  let teaCfg = { ...TEA_DEFAULTS };

  async function renderTeaSection(view) {
    try { teaCfg = { ...TEA_DEFAULTS, ...((await ctx.Backend.getTeaConfig?.()) || {}) }; } catch { teaCfg = { ...TEA_DEFAULTS }; }
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · TEA ROOM</p>
          <h1 class="page-title">Tea room controller</h1>
          <p class="muted">The wall and the chat are live by polling. Everything below takes effect on each
            member's next page load.</p>
        </header>

        <div class="card" data-animate>
          <h3 class="card-title">⏱ Refresh cadence</h3>
          <p class="muted">How often a member's browser asks for new posts and messages. Lower feels instant and
            costs more egress; the poll is incremental, so an idle board returns almost nothing either way.</p>
          <div class="tea-rows">
            <label class="tea-row">
              <span class="tea-row-lbl">While the wall or chat is open</span>
              <input type="range" min="1" max="60" step="1" id="tea-open" value="${teaCfg.intervalOpen}">
              <output id="tea-open-out">${teaCfg.intervalOpen}s</output>
            </label>
            <label class="tea-row">
              <span class="tea-row-lbl">In the background (badge only)</span>
              <input type="range" min="10" max="300" step="5" id="tea-idle" value="${teaCfg.intervalIdle}">
              <output id="tea-idle-out">${teaCfg.intervalIdle}s</output>
            </label>
          </div>
          <p class="tea-est" id="tea-est"></p>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">🎛 Features &amp; limits</h3>
          <div class="tea-toggles">
            <label class="dev-up-flag"><label class="dev-flag"><input type="checkbox" id="tea-wall" ${teaCfg.wallEnabled !== false ? 'checked' : ''}><span></span></label> Wall (posts &amp; comments)</label>
            <label class="dev-up-flag"><label class="dev-flag"><input type="checkbox" id="tea-chat" ${teaCfg.chatEnabled !== false ? 'checked' : ''}><span></span></label> Chat (direct &amp; group)</label>
            <label class="dev-up-flag"><label class="dev-flag"><input type="checkbox" id="tea-notif" ${teaCfg.desktopNotif !== false ? 'checked' : ''}><span></span></label> Desktop notifications</label>
          </div>
          <label class="tea-row">
            <span class="tea-row-lbl">Max upload size</span>
            <input type="range" min="1" max="50" step="1" id="tea-mb" value="${teaCfg.maxUploadMb}">
            <output id="tea-mb-out">${teaCfg.maxUploadMb} MB</output>
          </label>
          <div class="dev-toolbar">
            <button class="btn btn-gold" id="tea-save">💾 Save settings</button>
            <button class="btn btn-ghost" id="tea-reset">↺ Defaults</button>
            <span class="dev-status" id="tea-status"></span>
          </div>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">🧹 Moderation</h3>
          <p class="muted">Every post on the wall, newest first. As the owner you can remove anything.</p>
          <div class="dev-toolbar"><button class="btn btn-ghost btn-sm" id="tea-reload">↻ Reload</button>
            <span class="dev-status" id="tea-mod-status"></span></div>
          <div id="tea-posts"><p class="muted">Loading…</p></div>
        </div>
      </section>`;
    ctx.FX.viewIn(view);
    wireTea(view);
    await refreshTeaPosts(view);
  }

  function teaEstimate(view) {
    const open = Number(view.querySelector('#tea-open').value);
    const idle = Number(view.querySelector('#tea-idle').value);
    // two small requests per poll; ~0.7 KB each round with headers
    const perDay = (3600 / open) * 1 + (3600 / idle) * 7;      // ~1h active + 7h idle
    const mb = (perDay * 0.7) / 1024;
    view.querySelector('#tea-est').innerHTML =
      `≈ <strong>${Math.round(perDay)}</strong> polls per member per day · about <strong>${mb.toFixed(1)} MB</strong> egress each,
       <strong>${(mb * 30).toFixed(0)} MB</strong> a month. For 20 members that is roughly
       <strong>${((mb * 30 * 20) / 1024).toFixed(2)} GB</strong> of your monthly allowance.`;
  }

  function wireTea(view) {
    const sync = () => {
      view.querySelector('#tea-open-out').textContent = view.querySelector('#tea-open').value + 's';
      view.querySelector('#tea-idle-out').textContent = view.querySelector('#tea-idle').value + 's';
      view.querySelector('#tea-mb-out').textContent = view.querySelector('#tea-mb').value + ' MB';
      teaEstimate(view);
    };
    ['#tea-open', '#tea-idle', '#tea-mb'].forEach(sel => view.querySelector(sel).addEventListener('input', sync));
    sync();
    view.querySelector('#tea-reset').addEventListener('click', () => {
      Object.assign(teaCfg, TEA_DEFAULTS);
      view.querySelector('#tea-open').value = TEA_DEFAULTS.intervalOpen;
      view.querySelector('#tea-idle').value = TEA_DEFAULTS.intervalIdle;
      view.querySelector('#tea-mb').value = TEA_DEFAULTS.maxUploadMb;
      view.querySelector('#tea-wall').checked = true;
      view.querySelector('#tea-chat').checked = true;
      view.querySelector('#tea-notif').checked = true;
      sync();
    });
    view.querySelector('#tea-save').addEventListener('click', async e => {
      const status = view.querySelector('#tea-status');
      e.target.disabled = true; status.textContent = 'Saving…'; status.className = 'dev-status';
      const next = {
        intervalOpen: Number(view.querySelector('#tea-open').value),
        intervalIdle: Number(view.querySelector('#tea-idle').value),
        maxUploadMb: Number(view.querySelector('#tea-mb').value),
        wallEnabled: view.querySelector('#tea-wall').checked,
        chatEnabled: view.querySelector('#tea-chat').checked,
        desktopNotif: view.querySelector('#tea-notif').checked
      };
      try {
        await ctx.Backend.saveTeaConfig(next);
        if (typeof Cache !== 'undefined') Cache.bust('tearoom-cfg');
        try { await TeaRoom.loadCfg(); } catch {}
        teaCfg = next;
        status.innerHTML = '<span class="good">✓ Saved — members pick this up on their next load.</span>';
      } catch (err) { status.innerHTML = `<span class="bad">${ctx.esc(err.message || err)}</span>`; }
      e.target.disabled = false;
    });
    view.querySelector('#tea-reload').addEventListener('click', () => refreshTeaPosts(view));
  }

  async function refreshTeaPosts(view) {
    const host = view.querySelector('#tea-posts');
    let list = [];
    try { list = (await ctx.Backend.listDiscussions?.({ limit: 60 })) || []; } catch { list = []; }
    if (!list.length) { host.innerHTML = `<p class="muted">No posts yet.</p>`; return; }
    host.innerHTML = `<div class="table-scroll"><table class="table">
      <thead><tr><th>Author</th><th>Post</th><th class="num">💬</th><th class="num">👍</th><th>When</th><th></th></tr></thead>
      <tbody>${list.map(p => `<tr>
        <td>${ctx.esc(p.author_name || '')}</td>
        <td>${ctx.esc(String(p.topic || '').slice(0, 90))}${p.kind === 'question' ? ' <span class="chip chip-sba">Q</span>' : ''}</td>
        <td class="num">${p.reply_count || 0}</td><td class="num">${p.reaction_count || 0}</td>
        <td class="muted">${p.created_at ? ctx.esc(new Date(p.created_at).toLocaleDateString()) : ''}</td>
        <td><button class="link-btn" data-del-post="${ctx.esc(p.id)}">remove</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    host.querySelectorAll('[data-del-post]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remove this post and its comments?')) return;
      try { await ctx.Backend.deleteDiscussion(b.dataset.delPost); } catch (e) { alert(e.message || e); }
      refreshTeaPosts(view);
    }));
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
      bpEdit = null; bpCoverage = null;
      const v = document.getElementById('view'); v.querySelector('#bp-studio').innerHTML = '';
      await refreshBlueprint(v);
    } catch (err) { status.innerHTML = `<span class="bad">${ctx.esc(err.message || err)}</span>`; }
    e.target.value = '';
  }
  async function refreshBlueprint(view) {
    const host = view.querySelector('#bp-summary');
    let doc; try { doc = await Blueprint.load(); } catch { doc = null; }
    if (!doc || (!(doc.sba || []).length && !(doc.emq || []).length)) { host.innerHTML = `<p class="muted">No blueprint loaded yet — the bundled default is used until you upload one, or press <strong>Edit in Studio</strong> to build one.</p>`; return; }
    const sbaW = doc.sba.reduce((s, b) => s + b.weight, 0), emqW = doc.emq.reduce((s, b) => s + b.weight, 0);
    host.innerHTML = `<div class="bp-summary">
      <p class="good">Blueprint v${doc.version || 1}${doc.updated ? ' · ' + ctx.esc(doc.updated) : ''} loaded.</p>
      <div class="bp-cols">
        <div><h5>SBA · ${doc.sba.length} topics · Σ${sbaW}</h5><ul>${doc.sba.map(b => `<li>${ctx.esc(b.subcategory || b.category)} <span class="muted">w${b.weight}</span></li>`).join('')}</ul></div>
        <div><h5>EMQ · ${doc.emq.length} themes · Σ${emqW}</h5><ul>${doc.emq.map(b => `<li>${ctx.esc(b.theme)} <span class="muted">w${b.weight}</span></li>`).join('')}</ul></div>
      </div></div>`;
  }

  /* ---------------- Blueprint Studio — visual, coverage-aware editor ----------
     Edits a deep-cloned working copy so nothing is committed until Save. Every
     bucket, weight, specific area and priority boost is editable inline; the
     weight sums show live with one-click normalise-to-100; coverage badges show
     how many real questions back each bucket/area; Export round-trips to the
     exact Markdown you'd paste back into the Claude project. */
  const bpSum = arr => (arr || []).reduce((s, b) => s + (Number(b.weight) || 0), 0);

  async function openBlueprintStudio(view) {
    let doc; try { doc = await Blueprint.load(); } catch { doc = null; }
    doc = doc || {};
    // Repair legacy rows: areas saved as objects by the old parser are
    // flattened back to readable strings instead of showing [object Object].
    const fixAreas = list => (list || []).map(a => typeof a === 'string' ? a.trim()
      : (a && typeof a === 'object' ? Object.keys(a).map(k => a[k] == null || a[k] === '' ? k : `${k}: ${a[k]}`).join(' ') : String(a || ''))).filter(Boolean);
    bpEdit = JSON.parse(JSON.stringify({
      id: doc.id || 'blueprint', version: Number(doc.version) || 1, updated: doc.updated || '',
      paper: doc.paper || { sbaCount: 30, emqCount: 30, durationMin: 180, sbaMark: 3, emqMark: 3, negativeMarking: false },
      sba: (doc.sba || []).map(b => ({ ...b, areas: fixAreas(b.areas) })),
      emq: (doc.emq || []).map(b => ({ ...b, areas: fixAreas(b.areas) })),
      priority: doc.priority || [], notes: doc.notes || ''
    }));
    bpCoverage = null;
    view.querySelector('#bp-studio').innerHTML = '';    // force a fresh panel + one wiring pass
    drawStudio(view);
  }

  function normalizeTo100(arr) {
    const sum = bpSum(arr); if (!sum) return;
    const exact = arr.map(b => (Number(b.weight) || 0) / sum * 100);
    const floor = exact.map(x => Math.floor(x));
    let used = floor.reduce((a, c) => a + c, 0);
    const rema = exact.map((x, i) => ({ i, frac: x - floor[i] })).sort((a, b) => b.frac - a.frac);
    let k = 0; while (used < 100 && k < rema.length * 4) { floor[rema[k % rema.length].i]++; used++; k++; }
    arr.forEach((b, i) => b.weight = floor[i]);
  }

  function bucketCardHTML(sec, b, i, q = '') {
    const isSba = sec === 'sba';
    const name = isSba ? (b.subcategory || b.category) : b.theme;
    const cov = bpCoverage && (bpCoverage[sec] || []).find(c => c.name === name);
    // Chips are click-to-edit: the label itself is an input, so a typo can be
    // corrected in place instead of deleting the area and retyping it whole.
    const areaChip = (a) => {
      const ac = cov && cov.areas.find(x => x.area === a);
      const isHit = q && String(a).toLowerCase().includes(q);
      return `<span class="bp-area ${ac ? areaClass(ac.count) : ''} ${isHit ? 'is-hit' : ''}">${ac ? `<b>${ac.count}</b> ` : ''}<input class="bp-area-in" value="${ctx.esc(a)}" size="${Math.min(46, Math.max(8, String(a).length))}" title="Click to edit this specific area">
        <button class="bp-area-ai" data-act="ai-area" title="Match this wording against the AI tag vocabulary">✨</button>
        <button class="bp-area-x" data-act="del-area" title="Remove area">×</button></span>`;
    };
    return `<div class="bp-bucket" data-sec="${sec}" data-i="${i}">
      <div class="bp-bucket-top">
        ${isSba ? `<input class="bp-in bp-cat" data-field="category" placeholder="Category" value="${ctx.esc(b.category || '')}">` : ''}
        <input class="bp-in bp-name" data-field="${isSba ? 'subcategory' : 'theme'}" placeholder="${isSba ? 'Subcategory' : 'Theme'}" value="${ctx.esc(name || '')}">
        ${cov ? `<span class="bp-cov ${covClass(cov)}" title="questions in the bank matching this bucket">${cov.matched}/${cov.pool}</span>` : ''}
        <button class="bp-x" data-act="del-bucket" title="Remove bucket">✕</button>
      </div>
      <div class="bp-weight-row">
        <input type="range" min="0" max="20" step="1" class="bp-range" data-field="weight" value="${b.weight || 0}">
        <input type="number" min="0" class="bp-in bp-wnum" data-field="weight" value="${b.weight || 0}">
        <span class="bp-wlabel muted tiny">weight</span>
      </div>
      <div class="bp-areas">
        ${(b.areas || []).map(areaChip).join('')}
        <span class="bp-area-newwrap">
          <input class="bp-in bp-area-add" data-act="add-area" placeholder="+ specific area, then Enter">
          <button class="bp-area-ai" data-act="ai-new-area" title="Check this wording against the AI tag vocabulary before adding">✨</button>
        </span>
      </div>
    </div>`;
  }

  function drawStudio(view) {
    const host = view.querySelector('#bp-studio');
    // Listeners live on the STABLE host and are attached exactly once. Redraws
    // only ever replace the inner panel, so handlers can never stack up — the
    // bug that made one Save click fire N times and run the version away.
    let panel = host.querySelector('#bp-panel');
    if (!panel) {
      host.innerHTML = `<div id="bp-panel"></div>`;
      panel = host.querySelector('#bp-panel');
      wireStudio(view, host);
    }
    const d = bpEdit;
    const sbaSum = bpSum(d.sba), emqSum = bpSum(d.emq);
    const scrollY = window.scrollY;
    // Search narrows to matching buckets (by name) or buckets holding a
    // matching area — the index is kept so edits still write to the right row.
    const q = bpFilter.trim().toLowerCase();
    const hit = (b, name) => !q || name.toLowerCase().includes(q) || (b.areas || []).some(a => String(a).toLowerCase().includes(q));
    const idxSba = d.sba.map((b, i) => i).filter(i => hit(d.sba[i], d.sba[i].subcategory || d.sba[i].category || ''));
    const idxEmq = d.emq.map((b, i) => i).filter(i => hit(d.emq[i], d.emq[i].theme || ''));
    panel.innerHTML = `
      <div class="card bp-studio-head">
        <div class="bp-sums">
          <label class="bp-vlabel">v<input type="number" min="1" class="bp-in bp-vnum" id="bp-version" value="${Number(d.version) || 1}" title="Blueprint version — edit freely"></label>
          <span class="bp-sum ${sbaSum === 100 ? 'ok' : 'off'}">SBA Σ <strong id="bp-sum-sba">${sbaSum}</strong></span>
          <button class="btn btn-ghost btn-sm" data-act="norm-sba">→100</button>
          <span class="bp-sum ${emqSum === 100 ? 'ok' : 'off'}">EMQ Σ <strong id="bp-sum-emq">${emqSum}</strong></span>
          <button class="btn btn-ghost btn-sm" data-act="norm-emq">→100</button>
        </div>
        <div class="bp-search">
          <span class="bp-search-ico">⌕</span>
          <input type="search" id="bp-find" placeholder="Find a bucket or specific area…" value="${ctx.esc(bpFilter)}" autocomplete="off">
          ${bpFilter ? '<button class="bp-search-x" data-act="clear-find" title="Clear">✕</button>' : ''}
        </div>
        <div class="bp-studio-actions">
          <button class="btn btn-ghost btn-sm" data-act="cover">🎯 Coverage</button>
          <button class="btn btn-gold btn-sm" data-act="save">💾 Save &amp; apply</button>
          <button class="btn btn-ghost btn-sm" data-act="export">⬇ Export .md</button>
          <button class="btn btn-ghost btn-sm" data-act="revert">↺ Revert</button>
          <button class="btn btn-ghost btn-sm" data-act="close">Close</button>
        </div>
        <span class="dev-status" id="bp-studio-status"></span>
      </div>
      <div class="card">
        <div class="bp-sec-head"><h4>SBA buckets · ${q ? `${idxSba.length} of ${d.sba.length}` : d.sba.length}</h4><button class="btn btn-ghost btn-sm" data-act="add-sba">+ Add bucket</button></div>
        <div class="bp-buckets">${idxSba.map(i => bucketCardHTML('sba', d.sba[i], i, q)).join('') || `<p class="muted">${q ? 'No SBA bucket or area matches that search.' : 'No SBA buckets — add one.'}</p>`}</div>
      </div>
      <div class="card">
        <div class="bp-sec-head"><h4>EMQ themes · ${q ? `${idxEmq.length} of ${d.emq.length}` : d.emq.length}</h4><button class="btn btn-ghost btn-sm" data-act="add-emq">+ Add theme</button></div>
        <div class="bp-buckets">${idxEmq.map(i => bucketCardHTML('emq', d.emq[i], i, q)).join('') || `<p class="muted">${q ? 'No EMQ theme or area matches that search.' : 'No EMQ themes — add one.'}</p>`}</div>
      </div>
      <div class="card">
        <div class="bp-sec-head"><h4>Priority boosts · ${d.priority.length}</h4><button class="btn btn-ghost btn-sm" data-act="add-pri">+ Add boost</button></div>
        <div class="bp-pri">${d.priority.map((p, i) => `<div class="bp-pri-row" data-i="${i}">
          <input class="bp-in bp-pri-match" data-pri="match" placeholder="match phrase (appears in question text)" value="${ctx.esc(p.match || '')}">
          <input type="number" step="0.05" min="1" class="bp-in bp-pri-boost" data-pri="boost" value="${p.boost || 1}">
          <button class="bp-x" data-act="del-pri" title="Remove">✕</button></div>`).join('') || '<p class="muted">No priority boosts.</p>'}</div>
      </div>`;
    window.scrollTo(0, scrollY);      // redraws must not throw you back to the top
  }

  function updateSums(host) {
    const s = bpSum(bpEdit.sba), e = bpSum(bpEdit.emq);
    const ss = host.querySelector('#bp-sum-sba'), es = host.querySelector('#bp-sum-emq');
    if (ss) { ss.textContent = s; ss.parentElement.className = 'bp-sum ' + (s === 100 ? 'ok' : 'off'); }
    if (es) { es.textContent = e; es.parentElement.className = 'bp-sum ' + (e === 100 ? 'ok' : 'off'); }
  }
  const bucketOf = el => { const n = el.closest('.bp-bucket'); return n ? bpEdit[n.dataset.sec][Number(n.dataset.i)] : null; };

  /** Append one area chip in place — no full redraw, so focus stays in the box
      and you can type area after area without the page jumping. */
  function appendAreaChip(input, value) {
    const chip = document.createElement('span');
    chip.className = 'bp-area';
    chip.innerHTML = `${ctx.esc(value)}<button class="bp-area-x" data-act="del-area" title="Remove area">×</button>`;
    input.parentNode.insertBefore(chip, input);
    input.value = '';
    input.focus();
  }

  function wireStudio(view, host) {
    // live field edits — never re-render, so the caret never moves
    host.addEventListener('input', e => {
      const t = e.target;
      if (t.classList.contains('bp-area-in')) {          // live edit of an existing area
        const b = bucketOf(t); if (!b) return;
        const chip = t.closest('.bp-area');
        const idx = [...chip.parentNode.querySelectorAll('.bp-area')].indexOf(chip);
        if (idx >= 0) b.areas[idx] = t.value;
        t.size = Math.min(46, Math.max(8, t.value.length));
        return;
      }
      if (t.id === 'bp-find') {
        bpFilter = t.value;
        clearTimeout(host._findT);
        host._findT = setTimeout(() => {
          drawStudio(view);
          const el = view.querySelector('#bp-find');
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }, 220);
        return;
      }
      if (t.id === 'bp-version') { bpEdit.version = Math.max(1, Number(t.value) || 1); return; }
      const node = t.closest('.bp-bucket');
      if (node && t.dataset.field) {
        const b = bpEdit[node.dataset.sec][Number(node.dataset.i)];
        if (t.dataset.field === 'weight') {
          b.weight = Math.max(0, Number(t.value) || 0);
          node.querySelectorAll('[data-field="weight"]').forEach(el => { if (el !== t) el.value = b.weight; });
          updateSums(host);
        } else b[t.dataset.field] = t.value;
        return;
      }
      const pri = t.closest('.bp-pri-row');
      if (pri && t.dataset.pri) {
        const p = bpEdit.priority[Number(pri.dataset.i)];
        p[t.dataset.pri] = t.dataset.pri === 'boost' ? (Number(t.value) || 1) : t.value;
      }
    });
    // add a specific area on Enter (or on blur, so a typed-but-unconfirmed
    // area is never silently lost when you click away)
    const commitArea = input => {
      const val = input.value.trim(); if (!val) return;
      const b = bucketOf(input); if (!b) return;
      b.areas.push(val);
      appendAreaChip(input, val);
    };
    host.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.classList.contains('bp-area-add')) { e.preventDefault(); commitArea(e.target); }
    });
    host.addEventListener('focusout', e => { if (e.target.classList.contains('bp-area-add')) commitArea(e.target); });
    // structural + command buttons
    host.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const act = btn.dataset.act;
      const node = btn.closest('.bp-bucket');
      if (act === 'del-area') {              // remove the chip in place, no redraw
        const chip = btn.closest('.bp-area'), b = bucketOf(btn);
        if (b && chip) { const idx = [...chip.parentNode.querySelectorAll('.bp-area')].indexOf(chip); if (idx >= 0) b.areas.splice(idx, 1); chip.remove(); }
        return;
      }
      if (act === 'clear-find') { bpFilter = ''; return drawStudio(view); }
      if (act === 'ai-area') {                 // reconcile this area with the AI tag vocabulary
        const input = btn.closest('.bp-area')?.querySelector('.bp-area-in');
        if (input) openAreaMatcher(view, input, bucketOf(btn));
        return;
      }
      if (act === 'ai-new-area') {
        const input = btn.closest('.bp-areas')?.querySelector('.bp-area-add');
        if (input && input.value.trim()) openAreaMatcher(view, input, bucketOf(btn));
        else if (input) input.focus();
        return;
      }
      if (act === 'del-bucket') { bpEdit[node.dataset.sec].splice(Number(node.dataset.i), 1); return drawStudio(view); }
      if (act === 'add-sba') { bpEdit.sba.push({ category: '', subcategory: '', weight: 5, areas: [] }); return drawStudio(view); }
      if (act === 'add-emq') { bpEdit.emq.push({ theme: '', weight: 5, areas: [] }); return drawStudio(view); }
      if (act === 'add-pri') { bpEdit.priority.push({ match: '', boost: 1.2 }); return drawStudio(view); }
      if (act === 'del-pri') { bpEdit.priority.splice(Number(btn.closest('.bp-pri-row').dataset.i), 1); return drawStudio(view); }
      if (act === 'norm-sba') { normalizeTo100(bpEdit.sba); return drawStudio(view); }
      if (act === 'norm-emq') { normalizeTo100(bpEdit.emq); return drawStudio(view); }
      if (act === 'cover') return runCoverage(view);
      if (act === 'revert') { if (confirm('Discard your unsaved changes and reload the saved blueprint?')) openBlueprintStudio(view); return; }
      if (act === 'close') { bpEdit = null; bpCoverage = null; host.innerHTML = ''; return refreshBlueprint(view); }
      if (act === 'export') return exportBlueprint();
      if (act === 'save') return saveStudio(view, btn);
    });
  }

  /* ---------------- AI area matcher ----------------
     A hand-typed specific_area only works if its words actually occur in the
     bank. Spelling, British/US variants and loose phrasing silently break
     that. This asks the model to reconcile the typed text against the tag
     vocabulary, shows what it costs before and after, and bills the tokens
     to the question_auditor shared pool. */

  async function openAreaMatcher(view, input, bucket) {
    const typed = input.value.trim();
    if (!typed) { input.focus(); return; }
    const bucketName = bucket ? (bucket.subcategory || bucket.category || bucket.theme || '') : '';

    const wrap = document.createElement('div');
    wrap.className = 'cov-modal is-open am-modal';
    wrap.innerHTML = `<div class="cov-sheet am-sheet" role="dialog" aria-modal="true">
        <header class="cov-sheet-head">
          <div><p class="kicker">BLUEPRINT · AI TAG MATCH</p><h3>Align this area with the bank</h3></div>
          <button class="cov-x" aria-label="Close">✕</button>
        </header>
        <div class="cov-sheet-body">
          <p class="am-typed">You typed: <strong>${ctx.esc(typed)}</strong>${bucketName ? ` <span class="muted">in ${ctx.esc(bucketName)}</span>` : ''}</p>
          <div id="am-body"><p class="muted">Reading the bank's tag vocabulary…</p></div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('.cov-x').addEventListener('click', close);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    const body = wrap.querySelector('#am-body');

    // vocabulary = every distinct AI topic/tag already on the bank
    let vocab = [];
    try {
      const rows = (await ctx.Backend.listQuestionTags?.()) || [];
      vocab = [...new Set(rows.flatMap(r => [r.topic, ...(r.tags || [])]).filter(Boolean).map(x => String(x).trim()))].sort();
    } catch {}
    if (!vocab.length) {
      body.innerHTML = `<p class="bad">The bank has no AI tags yet — run the Question tagger first, then this can align your wording to it.</p>`;
      return;
    }

    // local (free) match first, so the obvious cases never cost a token
    const near = localMatches(typed, vocab);
    const est = Math.ceil((typed.length + vocab.join(' ').length) / 4) + 260;   // ~4 chars/token + reply
    const rate = Billing.rateFor((window.AUREUM_CONFIG?.ai?.geminiModel) || 'gemini');
    const estCost = (est / 1e6) * (rate.in || 0) + (300 / 1e6) * (rate.out || 0);

    body.innerHTML = `
      ${near.length ? `<div class="am-block"><h4>Already close in the bank <span class="muted tiny">· free, matched on-device</span></h4>
        <div class="am-list">${near.map(m => `<button class="am-opt" data-pick="${ctx.esc(m.tag)}">
          <span class="am-opt-name">${ctx.esc(m.tag)}</span><span class="am-opt-n">${m.n} question${m.n === 1 ? '' : 's'}</span></button>`).join('')}</div></div>`
        : `<p class="muted">No close match on-device — the AI can look harder.</p>`}
      <div class="am-run">
        <button class="btn btn-ai" id="am-go">✨ Ask the AI to reconcile it</button>
        <span class="am-cost">~${est.toLocaleString()} tokens in · est. ${Billing.usd(estCost, 5)}
          <i>billed to the question-auditor shared pool</i></span>
      </div>
      <div id="am-out"></div>`;

    body.addEventListener('click', async e => {
      const pick = e.target.closest('[data-pick]');
      if (pick) { applyArea(input, pick.dataset.pick); close(); return; }
      if (e.target.id !== 'am-go') return;
      const btn = e.target; btn.disabled = true;
      const out = body.querySelector('#am-out');
      out.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>`;
      try {
        const token = await ctx.Backend.getAccessToken();
        if (!token) throw new Error('Sign in again to use AI.');
        const res = await fetch(ctx.cfg.ai.apiBase, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ action: 'areamatch', text: typed, bucket: bucketName, tags: vocab, dailyLimit: ctx.cfg.ai.dailyLimit })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Failed (HTTP ${res.status})`);
        const parsed = safeJson(data.text);
        const used = data.usage || { in: 0, out: 0 };
        const r2 = Billing.rateFor(data.model || 'gemini');
        const cost = (used.in / 1e6) * (r2.in || 0) + (used.out / 1e6) * (r2.out || 0);
        if (!parsed) { out.innerHTML = `<p class="bad">The model didn't return usable JSON.</p>`; btn.disabled = false; return; }
        const counts = {}; vocab.forEach(v => counts[v] = 0);
        out.innerHTML = `
          ${parsed.corrected && parsed.corrected !== typed ? `<div class="am-block"><h4>Corrected wording</h4>
            <button class="am-opt is-primary" data-pick="${ctx.esc(parsed.corrected)}"><span class="am-opt-name">${ctx.esc(parsed.corrected)}</span><span class="am-opt-n">use this</span></button></div>` : ''}
          ${(parsed.matches || []).length ? `<div class="am-block"><h4>Matching tags in the bank</h4>
            <div class="am-list">${parsed.matches.map(m => `<button class="am-opt" data-pick="${ctx.esc(m.tag)}">
              <span class="am-opt-name">${ctx.esc(m.tag)}</span>
              <span class="am-opt-why muted">${ctx.esc(m.why || '')}</span>
              <span class="am-opt-n">${Math.round((m.confidence || 0) * 100)}%</span></button>`).join('')}</div></div>` : ''}
          ${parsed.suggested ? `<div class="am-block"><h4>Recommended</h4>
            <button class="am-opt is-primary" data-pick="${ctx.esc(parsed.suggested)}"><span class="am-opt-name">${ctx.esc(parsed.suggested)}</span><span class="am-opt-n">store this</span></button></div>` : ''}
          ${parsed.note ? `<p class="am-note muted">${ctx.esc(parsed.note)}</p>` : ''}
          <p class="am-cost done">Used <b>${(used.in || 0).toLocaleString()}</b> in / <b>${(used.out || 0).toLocaleString()}</b> out tokens
            · <b>${Billing.usd(cost, 5)}</b> · ${ctx.esc(data.model || '')} · charged to the question-auditor shared pool</p>`;
      } catch (err) { out.innerHTML = `<p class="bad">${ctx.esc(err.message || err)}</p>`; }
      btn.disabled = false;
    });
  }

  /** Free on-device pass: how many bank tags share significant words. */
  function localMatches(typed, vocab) {
    const w = areaWords(typed);
    if (!w.length) return [];
    return vocab.map(tag => {
      const tw = new Set(bpNorm(tag).split(' '));
      const hits = w.filter(x => tw.has(x)).length;
      return { tag, hits, n: hits };
    }).filter(m => m.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 6);
  }
  function safeJson(text) {
    if (!text) return null;
    const m = String(text).match(/\{[\s\S]*\}/);
    try { return JSON.parse(m ? m[0] : text); } catch { return null; }
  }
  /** Write a chosen wording back into the chip or the add-box. */
  function applyArea(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (input.classList.contains('bp-area-add')) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    input.focus();
  }

  let bpFilter = '';
  let bpSaving = false;
  async function saveStudio(view, btn) {
    if (bpSaving) return;                      // re-entrancy guard
    const status = view.querySelector('#bp-studio-status');
    // guardrails: drop unnamed / zero-weight buckets before persisting
    bpEdit.sba = bpEdit.sba.filter(b => (b.subcategory || b.category) && b.weight > 0);
    bpEdit.emq = bpEdit.emq.filter(b => b.theme && b.weight > 0);
    bpEdit.priority = bpEdit.priority.filter(p => p.match);
    if (!bpEdit.sba.length && !bpEdit.emq.length) { status.innerHTML = '<span class="bad">Add at least one weighted bucket.</span>'; return; }
    bpSaving = true; if (btn) btn.disabled = true;
    // The version is whatever the (editable) version box says — it is NOT
    // auto-incremented, so repeated saves can never run it away.
    bpEdit.version = Math.max(1, Number(view.querySelector('#bp-version')?.value) || Number(bpEdit.version) || 1);
    bpEdit.updated = new Date().toISOString().slice(0, 10);
    status.textContent = 'Saving…'; status.className = 'dev-status';
    try {
      await Blueprint.save(JSON.parse(JSON.stringify(bpEdit)));   // persists + busts cache → next mock uses it
      status.innerHTML = `<span class="good">✓ Saved v${bpEdit.version} — the next mock uses it.</span>`;
      await refreshBlueprint(view);
    } catch (e) { status.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; }
    bpSaving = false; if (btn) btn.disabled = false;
  }

  function exportBlueprint() {
    const md = Blueprint.toMarkdown(bpEdit);
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `blueprint-v${bpEdit.version || 1}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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
    { id: 'flashcards',      label: 'Flashcards' },
    // OpenAI GPT — off until you approve it here, per user
    { id: 'gpt',             label: 'GPT' }
  ];

  // named from config so the grant row tracks whatever GPT model is configured
  const gptGrantLabel = () => (window.AUREUM_CONFIG?.ai?.gptModels?.[0]?.label || 'GPT');

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
    try { await Billing.loadRates(); } catch {}      // price from the saved rate card
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
                  ${[['gemini', 'Gemini (master AI switch)'], ['gemini_advanced', 'Gemini+ model picker'], ['gpt', gptGrantLabel()], ['ai_flashcards', 'AI flashcards']].map(([f, lbl]) => `
                    <label class="dev-up-flag"><label class="dev-flag"><input type="checkbox" data-uflag="${f}" data-uid="${ctx.esc(u.id)}" ${u.featureFlags?.[f] ? 'checked' : ''}><span></span></label> ${lbl}</label>`).join('')}
                </div>
                <div class="dev-up-block">
                  <h4>Tool approvals</h4>
                  ${[['simulator', 'Simulator'], ['flashcards', 'Flashcards'], ['cpd', 'CPD (TOG true/false)']].map(([f, lbl]) => `
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
  /* The registry's model menu is DERIVED from config + the live rate card, so
     adding a model (or re-pricing one) shows up here automatically instead of
     needing this list edited — which is exactly how GPT went missing. */
  function modelOptions() {
    const ai = window.AUREUM_CONFIG?.ai || {};
    const price = m => { const r = Billing.rateFor(m); return ` · $${(r.in || 0).toFixed(2)}/$${(r.out || 0).toFixed(2)}`; };
    const out = [];
    (ai.geminiModels || [{ id: ai.geminiModel, label: 'Gemini Flash' }]).forEach(m =>
      out.push({ id: 'gemini|' + m.id, label: m.label + price(m.id) }));
    (ai.gptModels || (ai.gptModel ? [{ id: ai.gptModel, label: 'GPT' }] : [])).forEach(m =>
      out.push({ id: 'gpt|' + m.id, label: m.label + price(m.id) }));
    [{ id: ai.claudeModel || 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
     { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }].forEach(m =>
      out.push({ id: 'claude|' + m.id, label: m.label + price(m.id) }));
    return out;
  }
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
    { id: 'osce_marker', name: '🎙 OSCE examiner & marker', status: 'live', billing: 'per-user',
      desc: 'Spoken 15-minute stations. The candidate answers out loud; the model listens to the recording, ' +
        'transcribes it and marks every point of the station\'s scheme, then writes the examiner\'s verdict. ' +
        'Audio is ~32 tokens a second, so a whole station is about 29k input tokens — pennies on Flash-Lite. ' +
        'The station itself reads its questions aloud and probes thin answers with no model call at all.',
      defaults: { enabled: true, provider: 'gemini', model: 'gemini-3.1-flash-lite', split: 'per-user' } },
    { id: 'topup_reader', name: '🧾 Payment slip reader', status: 'live', billing: 'per-user',
      desc: 'Reads an uploaded bank slip and pulls out the amount, the payer\'s reference and the transaction ' +
        'number so a top-up can be approved in one click. Deliberately the cheapest call in the app: the image is ' +
        'shrunk client-side, the prompt is JSON-only and capped at 400 tokens. Billed to the payer as a handling fee.',
      defaults: { enabled: true, provider: 'gemini', model: 'gemini-3.1-flash-lite', split: 'per-user' } },
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
          <h3 class="card-title">💲 Model pricing</h3>
          <p class="muted">No AI provider returns a dollar figure — Gemini, Anthropic and OpenAI all report
            <strong>token counts only</strong>. Costs are therefore computed here, so these rates are the single
            source of truth for every invoice and for what users see in their Profile. USD per 1,000,000 tokens.</p>
          <div id="price-table"></div>
          <div class="dev-toolbar">
            <button class="btn btn-ghost btn-sm" id="price-add">+ Add model</button>
            <button class="btn btn-gold btn-sm" id="price-save">💾 Save rates</button>
            <button class="btn btn-ghost btn-sm" id="price-reset" title="Revert to the rates shipped in config.js">↺ Defaults</button>
            <span class="dev-status" id="price-status"></span>
          </div>
        </div>
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
    try { await Billing.loadRates(); } catch {}   // registry labels quote the live rates
    await refreshAiPanel(view);
    wireTagger(view);
    view.querySelector('#ins-run').addEventListener('click', () => runInsights(view));
    await renderPricing(view);
  }

  /* ---------------- model pricing (dev-editable) ----------------
     Providers meter TOKENS, never money — Gemini returns usageMetadata,
     Anthropic returns usage.input_tokens/output_tokens, OpenAI returns
     usage.prompt_tokens/completion_tokens. None returns a cost. So the
     rate card lives here, is stored in app_config, and Billing reads it
     (falling back to the defaults compiled into config.js). */

  let priceDraft = null;
  const defaultPricing = () => (window.AUREUM_CONFIG?.ai?.pricing) || {};

  async function loadPricing() {
    let saved = null;
    try { saved = await ctx.Backend.getModelPricing?.(); } catch { saved = null; }
    return (saved && Object.keys(saved).length) ? saved : defaultPricing();
  }

  async function renderPricing(view) {
    priceDraft = JSON.parse(JSON.stringify(await loadPricing()));
    paintPricing(view);
    view.querySelector('#price-add').addEventListener('click', () => {
      const id = prompt('Model id prefix (e.g. gpt-5.6-luna, gemini-3.1-pro, claude-haiku-4-5):');
      if (!id || !id.trim()) return;
      priceDraft[id.trim()] = { in: 0, out: 0, label: id.trim() };
      paintPricing(view);
    });
    view.querySelector('#price-reset').addEventListener('click', () => {
      if (!confirm('Discard the saved rates and reload the defaults from config.js?')) return;
      priceDraft = JSON.parse(JSON.stringify(defaultPricing()));
      paintPricing(view);
    });
    view.querySelector('#price-save').addEventListener('click', async e => {
      const status = view.querySelector('#price-status');
      e.target.disabled = true; status.textContent = 'Saving…'; status.className = 'dev-status';
      try {
        await ctx.Backend.saveModelPricing(priceDraft);
        if (typeof Cache !== 'undefined') Cache.bust('model-pricing');
        status.innerHTML = '<span class="good">✓ Rates saved — invoices and user Profiles use them immediately.</span>';
      } catch (err) { status.innerHTML = `<span class="bad">${ctx.esc(err.message || err)}</span>`; }
      e.target.disabled = false;
    });
  }

  function paintPricing(view) {
    const host = view.querySelector('#price-table');
    const ids = Object.keys(priceDraft).sort();
    host.innerHTML = `<div class="table-scroll"><table class="table price-table">
      <thead><tr><th>Model id (prefix match)</th><th>Label</th><th class="num">Input $/1M</th><th class="num">Output $/1M</th><th></th></tr></thead>
      <tbody>${ids.map(id => `<tr data-pid="${ctx.esc(id)}">
        <td><code>${ctx.esc(id)}</code></td>
        <td><input class="bp-in price-label" value="${ctx.esc(priceDraft[id].label || id)}"></td>
        <td class="num"><input type="number" step="0.01" min="0" class="bp-in price-in" value="${Number(priceDraft[id].in) || 0}"></td>
        <td class="num"><input type="number" step="0.01" min="0" class="bp-in price-out" value="${Number(priceDraft[id].out) || 0}"></td>
        <td><button class="bp-x" data-price-del title="Remove">✕</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    // delegated ONCE on the persistent host — repaints must not stack handlers
    if (host.dataset.wired !== '1') {
      host.dataset.wired = '1';
      host.addEventListener('input', e => {
        const row = e.target.closest('[data-pid]'); if (!row) return;
        const p = priceDraft[row.dataset.pid]; if (!p) return;
        if (e.target.classList.contains('price-label')) p.label = e.target.value;
        if (e.target.classList.contains('price-in')) p.in = Number(e.target.value) || 0;
        if (e.target.classList.contains('price-out')) p.out = Number(e.target.value) || 0;
      });
      host.addEventListener('click', e => {
        const del = e.target.closest('[data-price-del]'); if (!del) return;
        delete priceDraft[del.closest('[data-pid]').dataset.pid];
        paintPricing(view);
      });
    }
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
            <select data-fc="model" ${planned ? 'disabled' : ''}>${modelOptions().map(m => `<option value="${m.id}" ${m.id === modelId ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
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

  /* ================================================================
     ESSAY IMPORTER — publish structured-essay mock papers (SAQ/SEQ)
     ================================================================ */

  function validateEssayPaper(d) {
    const e = [];
    if (!d || typeof d !== 'object') return ['File is not a JSON object.'];
    if (!Array.isArray(d.sections) || !d.sections.length) e.push('Missing "sections" array.');
    const qs = (d.sections || []).flatMap(s => s.questions || []);
    if (!qs.length) e.push('No questions found in any section.');
    qs.forEach((q, i) => { if (!q.code) e.push(`Question ${i + 1}: missing "code".`); if (!q.stem) e.push(`Question ${i + 1}: missing "stem".`); });
    return e;
  }
  /* Real PGIM past papers have no paper number, so they would all have
     collided on a slug of their label. They get their own id space keyed on
     the sitting, which is what actually identifies them. */
  const isPgimPaper = d => /official_past_paper|past_paper|pgim/i.test(String(d.paperType || ''))
    || (d.paperNumber == null && !!d.year);
  function essayId(d) {
    if (isPgimPaper(d)) return 'essay-pgim-' + (d.year || 'x') + '-' + slug(d.sittingMonth || d.paperLabel || 'sitting');
    return 'essay-' + (d.paperNumber != null ? 'p' + d.paperNumber : slug(d.paperLabel || 'paper'));
  }

  async function renderEssaysSection(view) {
    const { esc } = ctx;
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · ESSAY IMPORTER</p>
          <h1 class="page-title">Essay mock papers</h1>
          <p class="muted">Structured-essay papers (SAQ/SEQ) in <code>ogr-essay-paper-v1</code> JSON. Source folder:
            <code>${esc(ctx.cfg.drive.essayFolderId || '(set drive.essayFolderId)')}</code>. Published papers appear in
            <strong>Library → Essay</strong>. A paper carrying <code>"paperType": "official_past_paper"</code> (or a
            <code>year</code> with no <code>paperNumber</code>) is treated as a <strong>real PGIM past paper</strong>: it
            goes into its own list and is marked in its own colour everywhere it appears.</p>
        </header>
        <div class="dev-toolbar" data-animate>
          <button class="btn btn-gold" id="es-scan">Scan Drive for essay papers</button>
          <span class="dev-status" id="es-status"></span>
        </div>
        <div id="es-list" data-animate></div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Published essay papers (<span id="es-pub-count">…</span>)</span><span class="dc-caret">▸</span></summary>
            <div id="es-published"></div>
          </details>
        </div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Paste a paper manually</span><span class="dc-caret">▸</span></summary>
            <textarea id="es-paste" class="dev-textarea" placeholder='{ "paperNumber": 1, "paperLabel": "Mock Paper 1", "sections": [ … ] }'></textarea>
            <button class="btn btn-primary" id="es-paste-btn" style="margin-top:12px">Validate &amp; publish</button>
            <div id="es-paste-result"></div>
          </details>
        </div>
      </section>`;
    view.querySelector('#es-scan').addEventListener('click', scanEssays);
    view.querySelector('#es-paste-btn').addEventListener('click', pasteEssay);
    await refreshEssayPublished(view);
    ctx.FX.viewIn(view);
  }

  async function refreshEssayPublished(view) {
    const list = (await ctx.Backend.getEssayPapers().catch(() => [])) || [];
    const host = view.querySelector('#es-published'), count = view.querySelector('#es-pub-count');
    if (count) count.textContent = list.length;
    host.innerHTML = list.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th>#</th><th>Label</th><th>Questions</th><th></th></tr></thead>
      <tbody>${list.sort((a, b) => (a.paperNumber || 0) - (b.paperNumber || 0)).map(p => `<tr>
        <td>${p.paperNumber || ''}</td><td>${ctx.esc(p.paperLabel || '')}</td>
        <td class="muted">${(p.sections || []).reduce((n, s) => n + (s.questions || []).length, 0)}</td>
        <td><button class="link-btn" data-unpub-essay="${ctx.esc(p.id)}">unpublish</button></td></tr>`).join('')}</tbody>
    </table></div>` : `<p class="muted">No essay papers published yet.</p>`;
    host.querySelectorAll('[data-unpub-essay]').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Unpublish this essay paper?')) { await ctx.Backend.unpublishEssayPaper(b.dataset.unpubEssay); if (typeof Essay !== 'undefined') Essay.bustPapers(); await refreshEssayPublished(view); }
    }));
  }

  async function scanEssays() {
    const status = document.getElementById('es-status'), list = document.getElementById('es-list');
    status.textContent = 'Scanning…'; list.innerHTML = '';
    let files = [];
    try {
      const base = ctx.cfg.drive.apiBase, fid = ctx.cfg.drive.essayFolderId;
      const res = await fetch(`${base}?action=list&folderId=${encodeURIComponent(fid)}`, { cache: 'no-cache' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      files = data.files || [];
    } catch (e) { status.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; return; }

    const published = (await ctx.Backend.getEssayPapers().catch(() => [])) || [];
    const pubIds = new Set(published.map(p => p.id));
    const staged = [];
    for (const f of files) {
      let doc = f.paper || f.deck || null;
      if (!doc && f.id) { try { const r = await fetch(`${ctx.cfg.drive.apiBase}?action=file&id=${encodeURIComponent(f.id)}`); doc = await r.json(); } catch { doc = null; } }
      // route by content: only essay PAPERS here (feedback JSONs are skipped)
      if (doc && Array.isArray(doc.sections) && validateEssayPaper(doc).length === 0) {
        doc.id = essayId(doc);
        if (!pubIds.has(doc.id)) staged.push(doc);
      }
    }
    status.innerHTML = `${files.length} file${files.length !== 1 ? 's' : ''} · <strong>${staged.length} new essay paper${staged.length !== 1 ? 's' : ''}</strong>`;
    if (!staged.length) { list.innerHTML = `<p class="muted">No new essay papers found (already published, or the folder holds only feedback JSONs).</p>`; return; }
    list.innerHTML = staged.map((d, i) => `
      <div class="dev-row card" data-ei="${i}">
        <div class="dev-row-head">
          <div><p class="dev-file">${isPgimPaper(d) ? '★' : '📝'} ${ctx.esc(d.paperLabel || ('Paper ' + d.paperNumber))}
            <span class="dev-kind ${isPgimPaper(d) ? 'is-pgim' : ''}">${isPgimPaper(d) ? 'PGIM PAST PAPER' : 'MOCK'}</span></p>
            <p class="muted tiny">${(d.sections || []).reduce((n, s) => n + (s.questions || []).length, 0)} questions · ${d.durationHours || 3} h${
              isPgimPaper(d) && d.year ? ' · ' + ctx.esc(String(d.sittingMonth || '')) + ' ' + d.year : ''}</p></div>
          <button class="btn btn-gold btn-sm" data-es-approve="${i}">Publish</button>
        </div><p class="dev-row-msg" data-es-msg="${i}"></p>
      </div>`).join('');
    staged.forEach((d, i) => document.querySelector(`[data-es-approve="${i}"]`).addEventListener('click', async e => {
      const msg = document.querySelector(`[data-es-msg="${i}"]`);
      e.target.disabled = true; msg.textContent = 'Publishing…'; msg.className = 'dev-row-msg muted';
      try { await ctx.Backend.publishEssayPaper(d); if (typeof Essay !== 'undefined') Essay.bustPapers();
        msg.textContent = '✓ Published to Library → Essay.'; msg.className = 'dev-row-msg good';
        await refreshEssayPublished(document.getElementById('view'));
      } catch (err) { msg.textContent = err.message || String(err); msg.className = 'dev-row-msg bad'; e.target.disabled = false; }
    }));
  }

  async function pasteEssay() {
    const ta = document.getElementById('es-paste'), out = document.getElementById('es-paste-result');
    let d; try { d = JSON.parse(ta.value); } catch (e) { out.innerHTML = `<p class="bad">Invalid JSON: ${ctx.esc(e.message)}</p>`; return; }
    const errs = validateEssayPaper(d); if (errs.length) { out.innerHTML = `<p class="bad">${errs.map(ctx.esc).join('<br>')}</p>`; return; }
    d.id = essayId(d);
    try { await ctx.Backend.publishEssayPaper(d); if (typeof Essay !== 'undefined') Essay.bustPapers();
      out.innerHTML = `<p class="good">✓ Published “${ctx.esc(d.paperLabel || d.id)}”.</p>`; await refreshEssayPublished(document.getElementById('view'));
    } catch (e) { out.innerHTML = `<p class="bad">${ctx.esc(e.message || e)}</p>`; }
  }


  /* ================================================================
     OSCE IMPORTER — publish spoken stations (ogr-osce-v1)
     ================================================================ */

  function validateOsce(d) {
    const e = [];
    if (!d || typeof d !== 'object') return ['File is not a JSON object.'];
    if (!d.topic) e.push('Missing "topic".');
    if (!d.scenario) e.push('Missing "scenario".');
    if (!Array.isArray(d.questions) || !d.questions.length) e.push('Missing "questions" array.');
    let marks = 0;
    (d.questions || []).forEach((q, i) => {
      if (!q.prompt) e.push(`Question ${i + 1}: missing "prompt".`);
      if (!Array.isArray(q.marking_points) || !q.marking_points.length) e.push(`Question ${i + 1}: no "marking_points".`);
      if (!(Number(q.marks) > 0)) e.push(`Question ${i + 1}: "marks" must be a positive number.`);
      marks += Number(q.marks) || 0;
    });
    if (d.total_marks && marks && Math.abs(marks - d.total_marks) > 0.01)
      e.push(`The question marks add up to ${marks}, but "total_marks" says ${d.total_marks}.`);
    return e;
  }
  const osceId = d => 'osce-' + slug(d.topic || d.source_file || 'station');

  /* ---- collections: the bins a station is filed into ----
     The list lives in app_config so it can be changed without a deploy;
     config.js only supplies the ones a fresh deployment starts with. */
  let _osceColls = null;
  async function osceCollections(force) {
    if (_osceColls && !force) return _osceColls;
    let saved = null;
    try { saved = await ctx.Backend.getOsceCollections(); } catch {}
    _osceColls = (saved && saved.length) ? saved : (ctx.cfg.osce?.collections || []).slice();
    return _osceColls;
  }
  async function saveOsceCollections(list) {
    await ctx.Backend.saveOsceCollections(list);
    _osceColls = list;
    if (typeof OSCE !== 'undefined') { OSCE.bustCollections?.(); OSCE.bustStations(); }
    return list;
  }
  const collSlug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

  async function renderOsceSection(view) {
    const { esc } = ctx;
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · OSCE IMPORTER</p>
          <h1 class="page-title">OSCE stations</h1>
          <p class="muted">Spoken stations in <code>ogr-osce-v1</code> JSON — a scenario, questions, marks and the
            marking points behind each. Published stations appear in the <strong>OSCE</strong> tab and in the exam
            simulator. Source folder: <code>${esc(ctx.cfg.drive.osceFolderId || '(set drive.osceFolderId)')}</code>.</p>
        </header>
        <div class="card" data-animate>
          <h3 class="card-title">🗂 Collections</h3>
          <p class="muted">The bins a station can be filed into. They appear as filters at the top of the station bank,
            in the editor, and when a station is imported. Renaming one keeps everything filed in it; removing one
            leaves its stations unfiled rather than deleting them.</p>
          <div id="os-colls"></div>
          <div class="dev-inline" style="margin-top:12px">
            <label class="wl-f"><span>Add a collection</span>
              <input type="text" id="os-coll-new" placeholder="e.g. Kandy OSCE" maxlength="40"></label>
            <button class="btn btn-ghost" id="os-coll-add" style="align-self:end">＋ Add</button>
          </div>
          <span class="dev-status" id="os-coll-msg"></span>

          <details class="dev-collapse" style="margin-top:16px">
            <summary><span class="card-title">Move stations in bulk</span><span class="dc-caret">▸</span></summary>
            <p class="muted">Use this once to file the stations that were published before collections existed — pick
              <em>Unfiled</em> as the source and <em>Common bank</em> as the destination.</p>
            <div class="dev-inline">
              <label class="wl-f"><span>Move from</span><select class="sel" id="os-move-from"></select></label>
              <label class="wl-f"><span>Into</span><select class="sel" id="os-move-to"></select></label>
              <button class="btn btn-gold" id="os-move-go" style="align-self:end">Move them</button>
            </div>
            <span class="dev-status" id="os-move-msg"></span>
          </details>
        </div>

        <div class="dev-toolbar" data-animate>
          <button class="btn btn-gold" id="os-scan">Scan Drive for OSCE stations</button>
          <label class="wl-f" style="max-width:220px"><span>Import into</span>
            <select class="sel" id="os-import-coll"></select></label>
          <span class="dev-status" id="os-status"></span>
        </div>
        <div id="os-list" data-animate></div>
        <div id="os-editor"></div>
        <div class="card" data-animate>
          <details class="dev-collapse" open>
            <summary><span class="card-title">Published stations (<span id="os-pub-count">…</span>) — click <em>edit</em> to change a scheme</span><span class="dc-caret">▸</span></summary>
            <div id="os-published"></div>
          </details>
        </div>
        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Paste a station manually</span><span class="dc-caret">▸</span></summary>
            <textarea id="os-paste" class="dev-textarea" placeholder='{ "topic": "HELLP Syndrome", "scenario": "…", "questions": [ … ] }'></textarea>
            <button class="btn btn-primary" id="os-paste-btn" style="margin-top:12px">Validate &amp; publish</button>
            <div id="os-paste-result"></div>
          </details>
        </div>
      </section>`;
    view.querySelector('#os-scan').addEventListener('click', scanOsce);
    view.querySelector('#os-paste-btn').addEventListener('click', pasteOsce);
    await wireOsceCollections(view);
    await refreshOscePublished(view);
  }

  async function wireOsceCollections(view) {
    const { esc } = ctx;
    const host = view.querySelector('#os-colls');
    const msg = view.querySelector('#os-coll-msg');
    const counts = {};
    try {
      ((await ctx.Backend.getOsceStations()) || []).forEach(s => {
        const c = s.collection || ''; counts[c] = (counts[c] || 0) + 1;
      });
    } catch {}

    const paint = async () => {
      const list = await osceCollections();
      host.innerHTML = `<div class="os-coll-rows">${list.map((c, i) => `
        <div class="os-coll-row" data-ci="${i}">
          <input type="text" class="os-coll-name" value="${esc(c.label)}" data-ci="${i}" maxlength="40">
          <span class="muted tiny">${counts[c.id] || 0} station${(counts[c.id] || 0) === 1 ? '' : 's'} · <code>${esc(c.id)}</code></span>
          <button class="link-btn" data-cmove="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="link-btn" data-cmove="${i}" data-dir="1" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="link-btn qr-danger" data-cdel="${i}">✕</button>
        </div>`).join('')}</div>
        ${counts[''] ? `<p class="muted tiny">${counts['']} station${counts[''] === 1 ? '' : 's'} not filed into any collection yet.</p>` : ''}`;

      const opts = (withAll, withUnfiled) =>
        (withAll ? `<option value="*">Every station</option>` : '') +
        (withUnfiled ? `<option value="">Unfiled (${counts[''] || 0})</option>` : '') +
        list.map(c => `<option value="${esc(c.id)}">${esc(c.label)}${counts[c.id] ? ` (${counts[c.id]})` : ''}</option>`).join('');
      const from = view.querySelector('#os-move-from'), to = view.querySelector('#os-move-to');
      const imp = view.querySelector('#os-import-coll');
      if (from) from.innerHTML = opts(true, true);
      if (to) to.innerHTML = opts(false, true);
      if (imp) {
        const def = ctx.cfg.osce?.defaultCollection || '';
        imp.innerHTML = `<option value="">Unfiled</option>` + list.map(c =>
          `<option value="${esc(c.id)}" ${c.id === def ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
      }

      host.querySelectorAll('.os-coll-name').forEach(el => el.addEventListener('change', async () => {
        const l = await osceCollections(); l[Number(el.dataset.ci)].label = el.value.trim() || l[Number(el.dataset.ci)].id;
        await saveOsceCollections(l); msg.innerHTML = '<span class="good">✓ Saved.</span>'; paint();
      }));
      host.querySelectorAll('[data-cmove]').forEach(b => b.addEventListener('click', async () => {
        const i = Number(b.dataset.cmove), d = Number(b.dataset.dir);
        const l = await osceCollections();
        if (i + d < 0 || i + d >= l.length) return;
        [l[i], l[i + d]] = [l[i + d], l[i]];
        await saveOsceCollections(l); paint();
      }));
      host.querySelectorAll('[data-cdel]').forEach(b => b.addEventListener('click', async () => {
        const l = await osceCollections(); const c = l[Number(b.dataset.cdel)];
        const n = counts[c.id] || 0;
        if (!confirm(`Remove the "${c.label}" collection?` + (n ? `\n\nIts ${n} station${n === 1 ? '' : 's'} stay in the bank — they simply become unfiled.` : ''))) return;
        l.splice(Number(b.dataset.cdel), 1);
        await saveOsceCollections(l); msg.innerHTML = '<span class="good">✓ Removed.</span>'; paint();
      }));
    };
    await paint();

    view.querySelector('#os-coll-add').addEventListener('click', async () => {
      const input = view.querySelector('#os-coll-new');
      const label = input.value.trim();
      if (!label) return;
      const id = collSlug(label);
      const l = await osceCollections();
      if (!id) { msg.innerHTML = '<span class="bad">Give it a name with some letters in it.</span>'; return; }
      if (l.some(c => c.id === id)) { msg.innerHTML = '<span class="bad">There is already a collection with that name.</span>'; return; }
      l.push({ id, label });
      await saveOsceCollections(l);
      input.value = '';
      msg.innerHTML = `<span class="good">✓ Added “${ctx.esc(label)}”.</span>`;
      await paint();
    });

    view.querySelector('#os-move-go').addEventListener('click', async e => {
      const from = view.querySelector('#os-move-from').value;
      const to = view.querySelector('#os-move-to').value;
      const mm = view.querySelector('#os-move-msg');
      const list = (await ctx.Backend.getOsceStations().catch(() => [])) || [];
      const ids = from === '*' ? null : list.filter(s => (s.collection || '') === from).map(s => s.id);
      const n = from === '*' ? list.length : ids.length;
      if (!n) { mm.innerHTML = '<span class="bad">Nothing is in that collection.</span>'; return; }
      const l = await osceCollections();
      const toName = to ? (l.find(c => c.id === to)?.label || to) : 'Unfiled';
      if (!confirm(`Move ${n} station${n === 1 ? '' : 's'} into “${toName}”?`)) return;
      e.target.disabled = true; mm.textContent = `Moving ${n}…`;
      try {
        const moved = await ctx.Backend.moveOsceStations(ids, to);
        if (typeof OSCE !== 'undefined') OSCE.bustStations();
        mm.innerHTML = `<span class="good">✓ ${moved || n} station${(moved || n) === 1 ? '' : 's'} now in “${ctx.esc(toName)}”.</span>`;
        await wireOsceCollections(view);
      } catch (err) { mm.innerHTML = `<span class="bad">${ctx.esc(err.message || err)}</span>`; }
      e.target.disabled = false;
    });
  }

  async function refreshOscePublished(view) {
    const list = (await ctx.Backend.getOsceStations().catch(() => [])) || [];
    const host = view.querySelector('#os-published'); if (!host) return;
    const cnt = view.querySelector('#os-pub-count'); if (cnt) cnt.textContent = list.length;
    const colls = await osceCollections();
    const cname = id => id ? (colls.find(c => c.id === id)?.label || id) : '—';
    host.innerHTML = list.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th>Station</th><th>Collection</th><th>Questions</th><th>Marks</th><th>Pass</th><th></th></tr></thead>
      <tbody>${list.map(v => `<tr><td>${ctx.esc(v.topic || v.id)}</td>
        <td class="muted">${ctx.esc(cname(v.collection || ''))}</td>
        <td class="muted">${v.q_count != null ? v.q_count : (v.questions || []).length}</td>
        <td class="muted">${v.total_marks || ''}</td>
        <td class="muted">${v.pass_mark || ''} (${v.pass_mark_percent || 70}%)</td>
        <td><button class="link-btn" data-edit-osce="${ctx.esc(v.id)}">edit</button>
            <button class="link-btn qr-danger" data-unpub-osce="${ctx.esc(v.id)}">unpublish</button></td></tr>`).join('')}</tbody>
    </table></div>` : `<p class="muted">No OSCE stations published yet.</p>`;
    /* The published list is CARDS — no questions, so the bank loads in a few
       KB. The editor needs the whole station, so it is fetched here. */
    host.querySelectorAll('[data-edit-osce]').forEach(b => b.addEventListener('click', async () => {
      const eh = view.querySelector('#os-editor');
      eh.innerHTML = '<p class="muted">Loading the station…</p>';
      eh.scrollIntoView({ behavior: 'smooth', block: 'start' });
      let st = null;
      try { st = await ctx.Backend.getOsceStation(b.dataset.editOsce); } catch {}
      if (!st) { eh.innerHTML = '<p class="bad">Could not load that station.</p>'; return; }
      osceEditor(eh, st, await osceCollections(), () => refreshOscePublished(view));
    }));
    host.querySelectorAll('[data-unpub-osce]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Unpublish this station?')) return;
      await ctx.Backend.unpublishOsceStation(b.dataset.unpubOsce);
      if (typeof OSCE !== 'undefined') OSCE.bustStations();
      await refreshOscePublished(view);
    }));
  }

  async function scanOsce() {
    const status = document.getElementById('os-status'), list = document.getElementById('os-list');
    status.textContent = 'Scanning…'; list.innerHTML = '';
    let files = [];
    try {
      const base = ctx.cfg.drive.apiBase, fid = ctx.cfg.drive.osceFolderId || ctx.cfg.drive.essayFolderId;
      const res = await fetch(`${base}?action=list&folderId=${encodeURIComponent(fid)}`, { cache: 'no-cache' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      files = data.files || [];
    } catch (e) { status.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; return; }

    const published = (await ctx.Backend.getOsceStations().catch(() => [])) || [];
    const have = new Set(published.map(p => p.id));
    const staged = [];
    for (const f of files) {
      let doc = f.paper || f.deck || null;
      if (!doc && f.id) { try { const r = await fetch(`${ctx.cfg.drive.apiBase}?action=file&id=${encodeURIComponent(f.id)}`); doc = await r.json(); } catch { doc = null; } }
      if (doc && Array.isArray(doc.questions) && doc.scenario && validateOsce(doc).length === 0) {
        doc.id = osceId(doc);
        if (!have.has(doc.id)) staged.push(doc);
      }
    }
    status.innerHTML = `${files.length} file${files.length !== 1 ? 's' : ''} · <strong>${staged.length} new station${staged.length !== 1 ? 's' : ''}</strong>`;
    if (!staged.length) { list.innerHTML = `<p class="muted">No new OSCE stations found in that folder.</p>`; return; }
    list.innerHTML = staged.map((d, i) => `
      <div class="dev-row card">
        <div class="dev-row-head">
          <div><p class="dev-file">🎙 ${ctx.esc(d.topic)}</p>
            <p class="muted tiny">${d.questions.length} questions · ${d.total_marks || ''} marks · ${d.station_time_min || 15} min</p></div>
          <button class="btn btn-gold btn-sm" data-os-approve="${i}">Publish</button>
        </div><p class="dev-row-msg" data-os-msg="${i}"></p>
      </div>`).join('');
    staged.forEach((d, i) => document.querySelector(`[data-os-approve="${i}"]`).addEventListener('click', async e => {
      const msg = document.querySelector(`[data-os-msg="${i}"]`);
      e.target.disabled = true; msg.textContent = 'Publishing…'; msg.className = 'dev-row-msg muted';
      try {
        // whatever the "Import into" picker says at the moment Publish is
        // pressed — so a scan can be filed row by row into different bins
        d.collection = document.getElementById('os-import-coll')?.value || '';
        await ctx.Backend.publishOsceStation(d);
        if (typeof OSCE !== 'undefined') { OSCE.bustStations(); OSCE.bustCollections?.(); }
        msg.textContent = '✓ Published to the OSCE tab.'; msg.className = 'dev-row-msg good';
        await refreshOscePublished(document.getElementById('view'));
      } catch (err) { msg.textContent = err.message || String(err); msg.className = 'dev-row-msg bad'; e.target.disabled = false; }
    }));
  }

  async function pasteOsce() {
    const ta = document.getElementById('os-paste'), out = document.getElementById('os-paste-result');
    let d; try { d = JSON.parse(ta.value); } catch (e) { out.innerHTML = `<p class="bad">Invalid JSON: ${ctx.esc(e.message)}</p>`; return; }
    const errs = validateOsce(d); if (errs.length) { out.innerHTML = `<p class="bad">${errs.map(ctx.esc).join('<br>')}</p>`; return; }
    d.id = osceId(d);
    if (d.collection == null) d.collection = document.getElementById('os-import-coll')?.value || '';
    try { await ctx.Backend.publishOsceStation(d); if (typeof OSCE !== 'undefined') OSCE.bustStations();
      out.innerHTML = `<p class="good">✓ Published “${ctx.esc(d.topic)}”.</p>`;
      await refreshOscePublished(document.getElementById('view'));
    } catch (e) { out.innerHTML = `<p class="bad">${ctx.esc(e.message || e)}</p>`; }
  }

  /* ================================================================
     OSCE EDITOR — change a published station in place

     Everything about a station is editable here: the scenario, the times,
     the pass mark, and every question with its marks and its marking
     points. Points can be added, edited, removed and reordered, and
     questions can be added or deleted outright. The marks total is
     recalculated as you type, because a scheme whose parts do not add up to
     its total marks a candidate wrongly.
     ================================================================ */

  let edit = null;                  // the station being edited, as a working copy
  let editColls = [];               // the bins it can be filed into

  let autoTotal = true;             // does total_marks track the questions?
  function osceEditor(host, station, colls, onSaved) {
    // called as (host, station, onSaved) from the older call sites
    if (typeof colls === 'function') { onSaved = colls; colls = null; }
    edit = JSON.parse(JSON.stringify(station));
    editColls = colls || (ctx.cfg.osce?.collections || []);
    autoTotal = !edit.total_marks || Number(edit.total_marks) === editorSums().marks;
    paintEditor(host, onSaved);
  }

  function editorSums() {
    const qs = edit.questions || [];
    const marks = qs.reduce((n, q) => n + (Number(q.marks) || 0), 0);
    const pts = qs.reduce((n, q) => n + (q.marking_points || []).length, 0);
    return { marks, pts, qs: qs.length };
  }

  function paintEditor(host, onSaved) {
    const { esc } = ctx;
    const sum = editorSums();
    const declared = Number(edit.total_marks) || 0;
    const mismatch = declared && sum.marks !== declared;
    host.innerHTML = `
      <div class="oe" data-animate>
        <div class="oe-head">
          <div>
            <p class="kicker">EDITING</p>
            <h3>${esc(edit.topic || edit.id)}</h3>
          </div>
          <div class="oe-sums ${mismatch ? 'is-bad' : ''}">
            <span><strong>${sum.qs}</strong> questions</span>
            <span><strong>${sum.marks}</strong> marks in the questions</span>
            <span><strong>${sum.pts}</strong> marking points</span>
            ${mismatch ? `<span class="bad">total_marks says ${declared}</span>
              <button class="link-btn" id="oe-fixtotal">set it to ${sum.marks}</button>` : ''}
          </div>
        </div>

        <div class="oe-grid">
          <label class="wl-f"><span>Topic</span><input type="text" data-f="topic" value="${esc(edit.topic || '')}"></label>
          <label class="wl-f"><span>Station time (minutes)</span><input type="number" data-f="station_time_min" value="${edit.station_time_min || 15}" min="1"></label>
          <label class="wl-f"><span>Reading time (minutes)</span><input type="number" data-f="reading_time_min" value="${edit.reading_time_min || 1}" min="0"></label>
          <label class="wl-f"><span>Total marks</span><input type="number" data-f="total_marks" value="${edit.total_marks || sum.marks}" min="1"></label>
          <label class="wl-f"><span>Pass mark (%)</span><input type="number" data-f="pass_mark_percent" value="${edit.pass_mark_percent || 70}" min="1" max="100"></label>
          <label class="wl-f"><span>Pass mark (marks)</span><input type="number" data-f="pass_mark" value="${edit.pass_mark || Math.round((edit.total_marks || sum.marks) * ((edit.pass_mark_percent || 70) / 100))}" min="0"></label>
          <label class="wl-f"><span>Collection</span>
            <select class="sel" data-f="collection">
              <option value="">Unfiled</option>
              ${editColls.map(c => `<option value="${esc(c.id)}" ${c.id === (edit.collection || '') ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
            </select></label>
        </div>
        ${edit.edited_by ? `<p class="muted tiny">Last edited by <strong>${esc(edit.edited_by)}</strong>${
          edit.edited_at ? ' on ' + esc(new Date(edit.edited_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })) : ''}.</p>` : ''}
        <label class="wl-f"><span>Scenario — what the candidate reads before the clock starts</span>
          <textarea class="dev-textarea oe-scenario" data-f="scenario" rows="4">${esc(edit.scenario || '')}</textarea></label>

        <h4 class="oe-h">Questions &amp; marking scheme</h4>
        <div class="oe-qs">
          ${(edit.questions || []).map((q, qi) => `
            <div class="oe-q" data-q="${qi}">
              <div class="oe-q-head">
                <span class="oe-q-n">Q${qi + 1}</span>
                <label class="oe-q-marks">marks
                  <input type="number" data-qf="marks" data-qi="${qi}" value="${q.marks || 0}" min="0" step="0.5"></label>
                <span class="oe-q-pts">${(q.marking_points || []).length} point${(q.marking_points || []).length === 1 ? '' : 's'}</span>
                <span class="oe-q-acts">
                  <button class="link-btn" data-qmove="${qi}" data-dir="-1" ${qi === 0 ? 'disabled' : ''} title="Move up">↑</button>
                  <button class="link-btn" data-qmove="${qi}" data-dir="1" ${qi === (edit.questions.length - 1) ? 'disabled' : ''} title="Move down">↓</button>
                  <button class="link-btn qr-danger" data-qdel="${qi}" title="Delete this question">✕</button>
                </span>
              </div>
              <label class="wl-f"><span>What the examiner asks</span>
                <textarea class="dev-textarea oe-prompt" data-qf="prompt" data-qi="${qi}" rows="2">${esc(q.prompt || '')}</textarea></label>
              <label class="wl-f"><span>Information revealed before this question (optional — results, a new finding)</span>
                <textarea class="dev-textarea oe-reveal" data-qf="reveal_before" data-qi="${qi}" rows="2">${esc(q.reveal_before || '')}</textarea></label>
              <span class="oe-pts-k">Marking points — one mark-worthy idea per line</span>
              <div class="oe-pts">
                ${(q.marking_points || []).map((pt, pi) => `
                  <div class="oe-pt">
                    <span class="oe-pt-n">${pi + 1}</span>
                    <textarea class="oe-pt-t" data-pt="${qi}:${pi}" rows="1">${esc(pt)}</textarea>
                    <button class="link-btn" data-ptmove="${qi}:${pi}" data-dir="-1" ${pi === 0 ? 'disabled' : ''}>↑</button>
                    <button class="link-btn" data-ptmove="${qi}:${pi}" data-dir="1" ${pi === (q.marking_points.length - 1) ? 'disabled' : ''}>↓</button>
                    <button class="link-btn qr-danger" data-ptdel="${qi}:${pi}">✕</button>
                  </div>`).join('')}
              </div>
              <button class="btn btn-ghost btn-sm" data-ptadd="${qi}">＋ Add a marking point</button>
            </div>`).join('')}
        </div>
        <button class="btn btn-ghost" id="oe-qadd">＋ Add a question</button>

        <div class="oe-foot">
          <span class="dev-status" id="oe-msg"></span>
          <button class="btn btn-ghost" id="oe-cancel">Cancel</button>
          <button class="btn btn-ghost" id="oe-json">⇩ Export JSON</button>
          <button class="btn btn-gold" id="oe-save">Save to the database</button>
        </div>
      </div>`;

    host.querySelector('#oe-fixtotal')?.addEventListener('click', () => {
      syncTotal(); autoTotal = true;
      const t = host.querySelector('[data-f="total_marks"]'); if (t) t.value = edit.total_marks;
      const pm = host.querySelector('[data-f="pass_mark"]'); if (pm) pm.value = edit.pass_mark;
      refreshSums(host);
    });
    host.querySelector('[data-f="total_marks"]')?.addEventListener('input', () => { autoTotal = false; });

    /* every field writes straight into the working copy */
    host.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', () => {
      const k = el.dataset.f;
      edit[k] = el.type === 'number' ? (Number(el.value) || 0) : el.value;
      if (k === 'total_marks' || k === 'pass_mark_percent') {
        edit.pass_mark = Math.round((Number(edit.total_marks) || 0) * ((Number(edit.pass_mark_percent) || 70) / 100));
      }
      refreshSums(host);
    }));
    host.querySelectorAll('[data-qf]').forEach(el => el.addEventListener('input', () => {
      const q = edit.questions[Number(el.dataset.qi)]; if (!q) return;
      const before = editorSums().marks;
      q[el.dataset.qf] = el.type === 'number' ? (Number(el.value) || 0) : el.value;
      // a total that was in step with the questions stays in step; one the
      // developer has deliberately set to something else is left alone
      if (el.dataset.qf === 'marks' && Number(edit.total_marks) === before) syncTotal();
      refreshSums(host);
    }));
    host.querySelectorAll('[data-pt]').forEach(el => el.addEventListener('input', () => {
      const [qi, pi] = el.dataset.pt.split(':').map(Number);
      edit.questions[qi].marking_points[pi] = el.value;
    }));

    const redraw = () => paintEditor(host, onSaved);
    host.querySelectorAll('[data-ptadd]').forEach(b => b.addEventListener('click', () => {
      const q = edit.questions[Number(b.dataset.ptadd)];
      (q.marking_points = q.marking_points || []).push(''); redraw();
    }));
    host.querySelectorAll('[data-ptdel]').forEach(b => b.addEventListener('click', () => {
      const [qi, pi] = b.dataset.ptdel.split(':').map(Number);
      edit.questions[qi].marking_points.splice(pi, 1); redraw();
    }));
    host.querySelectorAll('[data-ptmove]').forEach(b => b.addEventListener('click', () => {
      const [qi, pi] = b.dataset.ptmove.split(':').map(Number);
      const d = Number(b.dataset.dir), arr = edit.questions[qi].marking_points;
      if (pi + d < 0 || pi + d >= arr.length) return;
      [arr[pi], arr[pi + d]] = [arr[pi + d], arr[pi]]; redraw();
    }));
    host.querySelectorAll('[data-qdel]').forEach(b => b.addEventListener('click', () => {
      if (!confirm('Delete this question and its marking points?')) return;
      edit.questions.splice(Number(b.dataset.qdel), 1);
      edit.questions.forEach((q, i) => q.id = i + 1);
      if (autoTotal) syncTotal();
      redraw();
    }));
    host.querySelectorAll('[data-qmove]').forEach(b => b.addEventListener('click', () => {
      const qi = Number(b.dataset.qmove), d = Number(b.dataset.dir);
      if (qi + d < 0 || qi + d >= edit.questions.length) return;
      [edit.questions[qi], edit.questions[qi + d]] = [edit.questions[qi + d], edit.questions[qi]];
      edit.questions.forEach((q, i) => q.id = i + 1);
      redraw();
    }));
    host.querySelector('#oe-qadd').addEventListener('click', () => {
      (edit.questions = edit.questions || []).push({ id: edit.questions.length + 1, prompt: '', marks: 5, marking_points: [''] });
      if (autoTotal) syncTotal();
      redraw();
    });
    host.querySelector('#oe-cancel').addEventListener('click', () => { edit = null; host.innerHTML = ''; onSaved?.(); });
    host.querySelector('#oe-json').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(edit, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = (edit.id || 'osce') + '.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    host.querySelector('#oe-save').addEventListener('click', async e => {
      const msg = host.querySelector('#oe-msg');
      // drop empty marking points and empty questions before anything is stored
      edit.questions = (edit.questions || []).filter(q => (q.prompt || '').trim());
      edit.questions.forEach((q, i) => { q.id = i + 1; q.marking_points = (q.marking_points || []).map(x => x.trim()).filter(Boolean); });
      const errs = validateOsce(edit);
      if (errs.length) { msg.innerHTML = `<span class="bad">${errs.map(ctx.esc).join('<br>')}</span>`; return; }
      e.target.disabled = true; msg.textContent = 'Saving…';
      try {
        await ctx.Backend.publishOsceStation(edit);
        if (typeof OSCE !== 'undefined') OSCE.bustStations();
        msg.innerHTML = '<span class="good">✓ Saved — live in the OSCE tab.</span>';
        setTimeout(() => { edit = null; host.innerHTML = ''; onSaved?.(); }, 900);
      } catch (err) { msg.innerHTML = `<span class="bad">${ctx.esc(err.message || err)}</span>`; e.target.disabled = false; }
    });
  }

  /** Follow the questions, and keep the pass mark with them. */
  function syncTotal() {
    edit.total_marks = editorSums().marks;
    edit.pass_mark = Math.round(edit.total_marks * ((Number(edit.pass_mark_percent) || 70) / 100));
  }

  function refreshSums(host) {
    const sum = editorSums();
    const declared = Number(edit.total_marks) || 0;
    const el = host.querySelector('.oe-sums'); if (!el) return;
    el.classList.toggle('is-bad', !!(declared && sum.marks !== declared));
    el.innerHTML = `<span><strong>${sum.qs}</strong> questions</span>
      <span><strong>${sum.marks}</strong> marks in the questions</span>
      <span><strong>${sum.pts}</strong> marking points</span>
      ${declared && sum.marks !== declared
        ? `<span class="bad">total_marks says ${declared}</span>
           <button class="link-btn" id="oe-fixtotal">set it to ${sum.marks}</button>` : ''}`;
    el.querySelector('#oe-fixtotal')?.addEventListener('click', () => {
      syncTotal(); autoTotal = true;
      const t = host.querySelector('[data-f="total_marks"]'); if (t) t.value = edit.total_marks;
      const pm = host.querySelector('[data-f="pass_mark"]'); if (pm) pm.value = edit.pass_mark;
      refreshSums(host);
    });
  }

  /* ================================================================
     RATES & SETTINGS — the dollar rate and the prepaid top-ups
     ================================================================ */

  async function renderSettingsSection(view) {
    const { esc } = ctx;
    const cfgw = (await ctx.Backend.getWalletConfig().catch(() => ({}))) || {};
    const rate = Number(cfgw.usdRate) > 0 ? Number(cfgw.usdRate) : 340;
    const wcfg = ctx.cfg.wallet || {};
    const ben = Object.assign({ account: '', name: '', bank: '' }, wcfg.beneficiary || {}, cfgw.beneficiary || {});
    const instantOn = (cfgw.instantActivation != null ? cfgw.instantActivation : wcfg.instantActivation) !== false;
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · RATES &amp; SETTINGS</p>
          <h1 class="page-title">Rates &amp; settings</h1>
          <p class="muted">Everything the prepaid system needs from you: what a dollar costs in rupees, what a top-up
            typically is, and which payments to credit.</p>
        </header>

        <div class="card" data-animate>
          <h3 class="card-title">💱 Exchange rate</h3>
          <p class="muted">Every AI call is priced by the providers in US dollars. This is the rate used to turn that
            into rupees on a user's balance. Change it whenever the real rate moves — it applies to the whole balance
            calculation immediately, for everyone.</p>
          <div class="dev-inline">
            <label class="wl-f"><span>Sri Lankan rupees per US dollar</span>
              <input type="number" id="st-rate" value="${rate}" min="1" step="0.5"></label>
            <label class="wl-f"><span>Suggested top-up amounts (LKR, comma separated)</span>
              <input type="text" id="st-packs" value="${esc((cfgw.packs || [300, 500, 1000, 2000]).join(', '))}"></label>
          </div>
          <label class="pref-toggle" style="margin-top:12px">
            <span><strong>Enforce the prepaid balance</strong><br><span class="muted tiny">When on, a user whose balance
              reaches zero cannot use the AI features until they top up. You are never gated.</span></span>
            <label class="dev-flag"><input type="checkbox" id="st-enforce" ${cfgw.enforce ? 'checked' : ''}><span></span></label>
          </label>
          <button class="btn btn-gold" id="st-save" style="margin-top:14px">Save</button>
          <span class="dev-status" id="st-msg"></span>
          <p class="muted tiny" style="margin-top:10px">At LKR ${rate}/USD, a typical OSCE marking (~4,500 tokens) costs
            about <strong id="st-eg">—</strong>, and reading a payment slip about <strong id="st-eg2">—</strong>.</p>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">🏦 Your account &amp; instant top-ups</h3>
          <p class="muted">This is the account users are told to pay into, and the number a slip has to name before it
            credits itself. Banks print the same account with and without its leading zeros —
            <code>${esc(ben.account || '0087612781')}</code> and <code>${esc(String(ben.account || '0087612781').replace(/^0+/, ''))}</code> —
            and both are accepted.</p>
          <div class="dev-inline">
            <label class="wl-f"><span>Account number</span>
              <input type="text" id="st-acct" value="${esc(ben.account || '')}" placeholder="0087612781" inputmode="numeric"></label>
            <label class="wl-f"><span>Account name (optional)</span>
              <input type="text" id="st-acct-name" value="${esc(ben.name || '')}"></label>
            <label class="wl-f"><span>Bank (optional)</span>
              <input type="text" id="st-acct-bank" value="${esc(ben.bank || '')}" placeholder="Bank of Ceylon"></label>
          </div>
          <label class="pref-toggle" style="margin-top:12px">
            <span><strong>Credit a matching slip immediately</strong><br><span class="muted tiny">A slip showing this
              account, an amount, a transfer date and the user's own reference number is credited on upload and marked
              <em>awaiting confirmation</em>. You confirm it against your bank statement when you have time; until then
              it appears at the top of the list below.</span></span>
            <label class="dev-flag"><input type="checkbox" id="st-instant" ${instantOn ? 'checked' : ''}><span></span></label>
          </label>
          <div class="dev-inline" style="margin-top:10px">
            <label class="wl-f"><span>Hours you have to confirm it</span>
              <input type="number" id="st-instant-h" value="${Number(cfgw.instantHours) || 24}" min="1" max="168"></label>
            <label class="wl-f"><span>Largest amount credited without you (LKR)</span>
              <input type="number" id="st-auto-max" value="${Number(cfgw.autoMax) || 5000}" min="0" step="100"></label>
            <label class="wl-f"><span>Most a user can auto-credit in a day (LKR)</span>
              <input type="number" id="st-day-max" value="${Number(cfgw.autoDayMax) || 10000}" min="0" step="500"></label>
            <label class="wl-f"><span>Slips must be no older than (days)</span>
              <input type="number" id="st-max-age" value="${Number(cfgw.maxAgeDays) || 7}" min="1" max="90"></label>
          </div>
          <p class="muted tiny">The amount ceiling is the control that matters: whatever else a forged slip gets past, it
            can never be worth more than this before a human looks at it. Anything larger waits for you, exactly as it
            did before.</p>
          <label class="wl-f" style="max-width:420px;margin-top:10px"><span>Expected PDF producer (optional)</span>
            <input type="text" id="st-pdf-producer" value="${esc(cfgw.pdfProducer || '')}" placeholder="e.g. iText"></label>
          <p class="muted tiny">Your bank's slips are all generated by the same library — the BOC PDF you sent says
            <code>iText® Core 8.0.5</code>. Put a distinctive part of that here and any PDF not produced by it stops
            being auto-credited. Leave it empty to skip that check.</p>
          <p class="wl-warn" style="margin-top:12px">The match is made on the server, from the image itself — a browser
            cannot claim a slip matched when it did not. It needs <code>SUPABASE_SERVICE_KEY</code> set in Cloudflare →
            Settings → Variables and secrets. Without it every slip simply waits for approval, which is the old
            behaviour, so nothing breaks while it is missing.</p>
          <button class="btn btn-gold" id="st-acct-save" style="margin-top:6px">Save the account</button>
          <span class="dev-status" id="st-acct-msg"></span>
        </div>

        <div class="card" data-animate>
          <details class="dev-collapse" id="st-manual-wrap">
            <summary><span class="card-title">➕ Add credit by hand</span><span class="dc-caret">▸</span></summary>
            <p class="muted">For a payment you have verified some other way — the slip was unreadable, the user never
              got one, or you took the money in person. It is credited straight away and recorded as a manual entry
              with your note, so the balance always says where it came from.</p>
            <div class="dev-inline">
              <label class="wl-f"><span>User</span><select class="sel" id="st-man-user"><option>Loading…</option></select></label>
              <label class="wl-f"><span>Amount (LKR)</span><input type="number" id="st-man-amt" min="1" step="0.01" placeholder="500"></label>
            </div>
            <label class="wl-f"><span>How you verified it — kept with the entry</span>
              <input type="text" id="st-man-note" placeholder="e.g. BOC statement 19 Aug, txn 674858322438559"></label>
            <button class="btn btn-gold" id="st-man-add" style="margin-top:12px">Add the credit</button>
            <span class="dev-status" id="st-man-msg"></span>
            <div id="st-man-recent"></div>
          </details>
        </div>

        <div class="card" data-animate>
          <div class="es-inbox-head">
            <h3 class="card-title">🧾 Top-up requests</h3>
            <button class="btn btn-ghost btn-sm" id="st-refresh">↻ Refresh</button>
          </div>
          <p class="muted">Each one is a payment slip a user uploaded. Check the amount and the reference against your
            bank statement, then approve — the balance is credited the moment you do.</p>
          <div id="st-tops"><p class="muted">Loading…</p></div>
        </div>
      </section>`;

    const egs = () => {
      try {
        const r = (typeof Billing !== 'undefined') ? Billing.rateFor(ctx.cfg.ai.geminiModel) : { in: 0, out: 0 };
        const rt = Number(view.querySelector('#st-rate').value) || rate;
        const osce = ((3500 / 1e6) * (r.in || 0) + (1500 / 1e6) * (r.out || 0)) * rt;
        const slip = ((900 / 1e6) * (r.in || 0) + (120 / 1e6) * (r.out || 0)) * rt;
        view.querySelector('#st-eg').textContent = 'LKR ' + osce.toFixed(2);
        view.querySelector('#st-eg2').textContent = 'LKR ' + slip.toFixed(2);
      } catch {}
    };
    try { if (typeof Billing !== 'undefined') await Billing.loadRates(); } catch {}
    egs();
    view.querySelector('#st-rate').addEventListener('input', egs);

    view.querySelector('#st-save').addEventListener('click', async () => {
      const msg = view.querySelector('#st-msg');
      const packs = view.querySelector('#st-packs').value.split(',').map(x => Number(x.trim())).filter(x => x > 0);
      const next = Object.assign({}, cfgw, {
        usdRate: Number(view.querySelector('#st-rate').value) || 340,
        packs: packs.length ? packs : [300, 500, 1000, 2000],
        enforce: view.querySelector('#st-enforce').checked
      });
      msg.textContent = 'Saving…';
      try { await ctx.Backend.saveWalletConfig(next); if (typeof Wallet !== 'undefined') { Wallet.bustRate(); Wallet.bust(); }
        msg.innerHTML = '<span class="good">✓ Saved.</span>'; }
      catch (e) { msg.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; }
    });
    view.querySelector('#st-acct-save').addEventListener('click', async () => {
      const msg = view.querySelector('#st-acct-msg');
      const account = view.querySelector('#st-acct').value.replace(/[^\d]/g, '');
      if (account && account.length < 6) {
        msg.innerHTML = '<span class="bad">That does not look like an account number.</span>'; return;
      }
      const next = Object.assign({}, cfgw, {
        beneficiary: { account, name: view.querySelector('#st-acct-name').value.trim(),
                       bank: view.querySelector('#st-acct-bank').value.trim() },
        instantActivation: view.querySelector('#st-instant').checked,
        instantHours: Number(view.querySelector('#st-instant-h').value) || 24,
        autoMax: Number(view.querySelector('#st-auto-max').value) || 5000,
        autoDayMax: Number(view.querySelector('#st-day-max').value) || 10000,
        maxAgeDays: Number(view.querySelector('#st-max-age').value) || 7,
        pdfProducer: view.querySelector('#st-pdf-producer').value.trim()
      });
      msg.textContent = 'Saving…';
      try {
        await ctx.Backend.saveWalletConfig(next);
        if (typeof Wallet !== 'undefined') { Wallet.bustRate(); Wallet.bust(); }
        Object.assign(cfgw, next);
        msg.innerHTML = '<span class="good">✓ Saved — users see this account immediately.</span>';
      } catch (e) { msg.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; }
    });

    await wireManualCredit(view);
    view.querySelector('#st-refresh').addEventListener('click', () => paintTopUps(view));
    await paintTopUps(view);
  }

  /* Crediting somebody by hand. The list of users is only loaded when the
     section is actually opened — it is a rare action and there is no reason
     to read every profile on the way past. */
  async function wireManualCredit(view) {
    const wrap = view.querySelector('#st-manual-wrap');
    const sel = view.querySelector('#st-man-user');
    const msg = view.querySelector('#st-man-msg');
    let loaded = false;
    const load = async () => {
      if (loaded) return; loaded = true;
      try {
        const users = (await ctx.Backend.listAllUsers()) || [];
        sel.innerHTML = `<option value="">Choose a user…</option>` + users
          .slice().sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)))
          .map(u => `<option value="${ctx.esc(u.id)}">${ctx.esc(u.name || u.email || u.id)}${u.name && u.email ? ` — ${ctx.esc(u.email)}` : ''}</option>`).join('');
      } catch (e) {
        loaded = false;
        sel.innerHTML = `<option value="">Could not load the users</option>`;
        msg.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`;
      }
    };
    wrap.addEventListener('toggle', () => { if (wrap.open) load(); });
    if (wrap.open) await load();

    view.querySelector('#st-man-add').addEventListener('click', async e => {
      const userId = sel.value;
      const amount = Number(view.querySelector('#st-man-amt').value);
      const note = view.querySelector('#st-man-note').value.trim();
      if (!userId) { msg.innerHTML = '<span class="bad">Choose which user this is for.</span>'; return; }
      if (!(amount > 0)) { msg.innerHTML = '<span class="bad">Enter the amount to credit.</span>'; return; }
      if (!note) { msg.innerHTML = '<span class="bad">Say how you verified it — the entry is meaningless without it.</span>'; return; }
      const who = sel.options[sel.selectedIndex].textContent;
      if (!confirm(`Credit LKR ${amount.toLocaleString('en-LK')} to ${who}?\n\nThis is live money — it is spendable immediately.`)) return;
      e.target.disabled = true; msg.textContent = 'Adding…';
      try {
        await ctx.Backend.createTopUpFor(userId, { amount_lkr: amount, reference: 'manual', note });
        if (typeof Wallet !== 'undefined') Wallet.bust();
        msg.innerHTML = `<span class="good">✓ LKR ${amount.toLocaleString('en-LK')} credited to ${ctx.esc(who)}.</span>`;
        view.querySelector('#st-man-amt').value = '';
        view.querySelector('#st-man-note').value = '';
        await paintTopUps(view);
      } catch (err) { msg.innerHTML = `<span class="bad">${ctx.esc(err.message || err)}</span>`; }
      e.target.disabled = false;
    });
  }

  /* A slip may be a photo, a screenshot or the bank's own PDF. Images render
     inline; a PDF gets an embedded viewer (with a link out, because iOS will
     not render a PDF in an object tag); anything else at least downloads. */
  function slipView(src, id) {
    const kind = String(src || '').slice(5, 40);
    const dl = `<a class="btn btn-ghost btn-sm" href="${src}" download="slip-${ctx.esc(String(id))}${/pdf/i.test(kind) ? '.pdf' : /png/i.test(kind) ? '.png' : '.jpg'}" target="_blank" rel="noopener">⬇ Download / open in a new tab</a>`;
    if (/^data:image/.test(src)) return `<img src="${src}" alt="payment slip">${dl}`;
    if (/^data:application\/pdf/.test(src)) {
      return `<object data="${src}" type="application/pdf" class="st-pdf">
          <p class="muted">This browser will not display the PDF inline.</p>
        </object>${dl}`;
    }
    return `<p class="muted">A ${ctx.esc(kind.split(';')[0] || 'file')} was uploaded.</p>${dl}`;
  }

  /* What the screening saw. Shown on every row, credited or not, because the
     point of an auto-credit is that you can check it afterwards — and the
     PDF's own metadata is the strongest thing here: a bank writes a slip once
     with a server library, so an editing tool in /Producer, a second %%EOF or
     a ModDate after the CreationDate all mean somebody opened it. */
  function forensicsView(x) {
    if (!x) return '';
    const e = ctx.esc;
    const bits = [];
    if (x.risk) bits.push(`<span class="st-risk is-${e(x.risk)}">${x.risk === 'low' ? '✓ nothing suspicious'
      : x.risk === 'medium' ? '! worth a look' : '⚠ did not pass screening'}</span>`);
    if (x.docType) bits.push(`<span class="muted tiny">${e(String(x.docType).replace(/_/g, ' '))}</span>`);
    if (x.hash) bits.push(`<span class="muted tiny" title="SHA-256 of the uploaded file — the same file cannot be used twice">file ${e(x.hash.slice(0, 12))}…</span>`);
    const flags = (x.flags || []).map(f => `<li class="${f.level === 'block' ? 'no' : ''}">${e(f.text)}</li>`).join('');
    const p = x.pdf;
    const pdfRows = p ? [
      ['Produced by', p.producer || '(none)', p.editorHit],
      ['Created', p.created || '—', false],
      ['Modified', p.modified || '—', !!p.resaved],
      ['Times saved', String(p.eofCount ?? '—'), (p.eofCount || 0) > 1]
    ] : [];
    if (!bits.length && !flags && !pdfRows.length) return '';
    return `<div class="st-forensics">
      ${bits.length ? `<div class="st-fx-head">${bits.join('')}</div>` : ''}
      ${flags ? `<ul class="st-fx-flags">${flags}</ul>` : ''}
      ${pdfRows.length ? `<table class="st-fx-pdf"><tbody>${pdfRows.map(([k, v, bad]) =>
        `<tr class="${bad ? 'bad' : ''}"><th>${e(k)}</th><td>${e(v)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${x.tamper?.length ? `<p class="muted tiny">Reader noted: ${e(x.tamper.join('; '))}</p>` : ''}
      <p class="muted tiny">None of this proves a payment happened — only your bank statement does. It is here so a
        forged slip has to get past more than a glance.</p>
    </div>`;
  }

  async function paintTopUps(view) {
    const host = view.querySelector('#st-tops'); if (!host) return;
    let list = [];
    try { list = (await ctx.Backend.listAllTopUps()) || []; }
    catch (e) { host.innerHTML = `<p class="bad">${ctx.esc(e.message || e)}</p>`; return; }
    if (!list.length) { host.innerHTML = `<p class="muted">No top-ups yet.</p>`; return; }
    const pending = list.filter(t => t.status === 'pending');
    /* A slip that credited itself is approved already, but nobody has looked
       at a bank statement yet. Those come first and stay visibly unfinished
       until they are confirmed — an auto-credit that is never checked is the
       whole risk of instant activation. */
    const provisional = t => t.status === 'approved' && t.extracted?.provisional && !t.extracted?.confirmed;
    const order = list.slice().sort((a, b) => (provisional(b) ? 1 : 0) - (provisional(a) ? 1 : 0));
    const nProv = list.filter(provisional).length;
    const matchRow = m => !m ? '' : `<span class="st-match">${
      [['account', 'account'], ['amount', 'amount'], ['date', 'date'], ['reference', 'reference']]
        .map(([k, label]) => `<i class="${m[k] ? 'ok' : 'no'}">${m[k] ? '✓' : '○'} ${label}</i>`).join('')}</span>`;
    host.innerHTML = `
      ${nProv ? `<p class="wl-warn">⚡ <strong>${nProv}</strong> auto-credited top-up${nProv > 1 ? 's' : ''} still to be
        checked against your bank statement. The money is already spendable — confirm or reverse each one.</p>` : ''}
      ${pending.length ? '' : '<p class="muted">Nothing is waiting for approval.</p>'}
      ${order.map(t => `
      <div class="dev-row card st-top ${t.status}${provisional(t) ? ' is-provisional' : ''}">
        <div class="dev-row-head">
          <div>
            <p class="dev-file">${provisional(t) ? '⚡' : t.status === 'approved' ? '✓' : t.status === 'declined' ? '✗' : '⏳'}
              LKR ${Number(t.amount_lkr).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              <span class="dev-kind">${ctx.esc(t.reference || 'no reference')}</span>
              ${t.extracted?.manual ? '<span class="dev-kind">added by hand</span>' : ''}
              ${t.extracted?.amountTyped ? '<span class="dev-kind st-prov">amount typed, not read from the slip</span>' : ''}
              ${provisional(t) ? '<span class="dev-kind st-prov">awaiting your confirmation</span>' : ''}</p>
            <p class="muted tiny">${ctx.esc(new Date(t.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}
              ${t.extracted?.date ? ' · paid ' + ctx.esc(t.extracted.date) : ''}
              ${t.extracted?.txnId ? ' · txn ' + ctx.esc(t.extracted.txnId) : ''}
              ${t.extracted?.bank ? ' · ' + ctx.esc(t.extracted.bank) : ''}
              ${t.extracted?.confidence != null ? ' · read confidence ' + Math.round(t.extracted.confidence * 100) + '%' : ''}</p>
            ${matchRow(t.extracted?.matched)}
          </div>
          ${t.status === 'pending' ? `<div class="dev-inline">
            <button class="btn btn-gold btn-sm" data-approve="${t.id}">Approve</button>
            <button class="btn btn-ghost btn-sm" data-decline="${t.id}">Decline</button></div>`
            : provisional(t) ? `<div class="dev-inline">
            <button class="btn btn-gold btn-sm" data-confirm="${t.id}">✓ Confirmed at the bank</button>
            <button class="btn btn-ghost btn-sm qr-danger" data-decline="${t.id}">Reverse it</button></div>`
            : `<span class="muted tiny">${ctx.esc(t.status)}${t.note ? ' — ' + ctx.esc(t.note) : ''}</span>`}
        </div>
        ${t.slip
          ? `<details class="dev-collapse" ${provisional(t) ? 'open' : ''}>
              <summary><span>View the slip${provisional(t) ? ' — check this against your statement' : ''}</span><span class="dc-caret">▸</span></summary>
              <div class="st-slip">${slipView(t.slip, t.id)}</div>
              ${forensicsView(t.extracted)}
            </details>`
          : `<details class="dev-collapse"><summary><span>No slip image was kept</span><span class="dc-caret">▸</span></summary>
              <p class="muted tiny">${t.extracted?.manual ? 'Added by hand, so there was never a slip.'
                : t.extracted?.slipTooLarge ? 'The file was too large to store. The details read off it are below.'
                : 'This top-up was created before slips were stored, or the upload carried no image.'}</p>
              ${forensicsView(t.extracted)}
            </details>`}
      </div>`).join('')}`;
    host.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      const row = list.find(x => String(x.id) === String(b.dataset.confirm));
      try {
        await ctx.Backend.setTopUpStatus(b.dataset.confirm, 'approved',
          'Confirmed against the bank statement ' + new Date().toLocaleDateString('en-GB'),
          Object.assign({}, row?.extracted, { confirmed: true, confirmedAt: Date.now() }));
        await paintTopUps(view);
      } catch (e) { alert(e.message || e); b.disabled = false; }
    }));
    host.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await ctx.Backend.setTopUpStatus(b.dataset.approve, 'approved', ''); if (typeof Wallet !== 'undefined') Wallet.bust(); await paintTopUps(view); }
      catch (e) { alert(e.message || e); b.disabled = false; }
    }));
    host.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', async () => {
      const note = prompt('Why is it declined? (shown to the user)') || 'Could not be matched to a payment.';
      b.disabled = true;
      try { await ctx.Backend.setTopUpStatus(b.dataset.decline, 'declined', note); await paintTopUps(view); }
      catch (e) { alert(e.message || e); b.disabled = false; }
    }));
  }

  /* ================================================================
     CPD IMPORTER — publish TOG true/false volumes (ogr-cpd-v1)
     ================================================================ */

  const CPD_SCHEMAS = ['ogr-cpd-v1', 'ogr-cpd-v2'];
  function validateCpdVolume(d) {
    const e = [];
    if (!d || typeof d !== 'object') return ['File is not a JSON object.'];
    if (d.schema && !CPD_SCHEMAS.includes(d.schema))
      e.push(`Unexpected schema "${d.schema}" — expected ${CPD_SCHEMAS.join(' or ')}.`);
    if (!d.volume) e.push('Missing "volume" (e.g. "Volume 23, Issue 1").');
    if (!Array.isArray(d.sections) || !d.sections.length) e.push('Missing "sections" array.');
    let n = 0;
    (d.sections || []).forEach((sec, si) => {
      if (!sec.id) e.push(`Section ${si + 1}: missing "id".`);
      if (!sec.topic) e.push(`Section ${si + 1}: missing "topic".`);
      const qs = sec.questions || [];
      if (!qs.length) e.push(`Section ${si + 1} ("${sec.topic || sec.id}"): no questions.`);
      qs.forEach((q, qi) => {
        n++;
        const where = `Section ${si + 1} Q${qi + 1}`;
        if (!q.id) e.push(`${where}: missing "id".`);
        if (!q.stem) e.push(`${where}: missing "stem".`);
        if (!q.rationale) e.push(`${where}: missing "rationale".`);
        // v2 tags the type; an untagged question is true/false, as in v1
        const type = String(q.qtype || 'TF').toUpperCase();
        if (type !== 'TF' && type !== 'SBA') {
          e.push(`${where}: "qtype" must be TF or SBA (found "${q.qtype}").`);
          return;
        }
        if (type === 'SBA') {
          const opts = q.options;
          if (!Array.isArray(opts) || opts.length < 2) {
            e.push(`${where}: an SBA question needs an "options" array of at least 2.`);
            return;
          }
          const keys = [];
          opts.forEach((o, oi) => {
            if (typeof o === 'string') { keys.push(String.fromCharCode(65 + oi)); return; }
            if (!o || !o.key) e.push(`${where} option ${oi + 1}: missing "key".`);
            if (!o || !o.text) e.push(`${where} option ${oi + 1}: missing "text".`);
            if (o && o.key) keys.push(String(o.key).toUpperCase());
          });
          const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
          if (dupes.length) e.push(`${where}: duplicate option key${dupes.length > 1 ? 's' : ''} ${[...new Set(dupes)].join(', ')}.`);
          // an answer key that is not one of the options makes the question unmarkable
          if (typeof q.answer !== 'string' || !q.answer.trim()) {
            e.push(`${where}: an SBA "answer" must be the key of the correct option, e.g. "C".`);
          } else if (keys.length && !keys.includes(q.answer.trim().toUpperCase())) {
            e.push(`${where}: answer "${q.answer}" is not one of the options (${keys.join(', ')}).`);
          }
        } else if (typeof q.answer !== 'boolean') {
          // a true/false item is meaningless without a real boolean
          e.push(`${where}: a true/false "answer" must be true or false.`);
        }
      });
    });
    if (!n) e.push('No questions found in any section.');
    return e;
  }
  function cpdId(d) {
    const m = String(d.volume || '').match(/(\d+)\D+(\d+)/);
    return 'cpd-' + (m ? `v${m[1]}i${m[2]}` : slug(d.volume || 'volume'));
  }
  const cpdCounts = d => {
    const secs = (d.sections || []).length;
    const all = (d.sections || []).flatMap(x => x.questions || []);
    const sba = all.filter(q => String(q.qtype || 'TF').toUpperCase() === 'SBA').length;
    return { secs, qs: all.length, sba };
  };

  async function renderCpdSection(view) {
    const { esc } = ctx;
    view.innerHTML = `
      <section class="page">
        ${backLink}
        <header data-animate>
          <p class="kicker">DEVELOPER · CPD IMPORTER</p>
          <h1 class="page-title">CPD volumes</h1>
          <p class="muted">TOG self-assessment sets in <code>ogr-cpd-v1</code> (true/false) or <code>ogr-cpd-v2</code>
            (true/false + SBA) JSON. Source folder:
            <code>${esc(ctx.cfg.drive.cpdFolderId || '(set drive.cpdFolderId)')}</code>. Published volumes appear in
            <strong>Library → CPD</strong>, for users you have granted the <strong>CPD</strong> flag in
            <a class="link" href="#/dev/users">Users &amp; access</a> and who have switched it on in their Profile.</p>
        </header>
        <div class="dev-toolbar" data-animate>
          <button class="btn btn-gold" id="cp-scan">Scan Drive for CPD volumes</button>
          <span class="dev-status" id="cp-status"></span>
        </div>
        <div id="cp-list" data-animate></div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Published volumes (<span id="cp-pub-count">…</span>)</span><span class="dc-caret">▸</span></summary>
            <div id="cp-published"></div>
          </details>
        </div>

        <div class="card" data-animate>
          <details class="dev-collapse">
            <summary><span class="card-title">Paste a volume manually</span><span class="dc-caret">▸</span></summary>
            <textarea id="cp-paste" class="dev-textarea" placeholder='{ "schema": "ogr-cpd-v1", "volume": "Volume 23, Issue 1", "sections": [ … ] }'></textarea>
            <button class="btn btn-primary" id="cp-paste-btn" style="margin-top:12px">Validate &amp; publish</button>
            <div id="cp-paste-result"></div>
          </details>
        </div>
      </section>`;
    view.querySelector('#cp-scan').addEventListener('click', scanCpd);
    view.querySelector('#cp-paste-btn').addEventListener('click', pasteCpd);
    await refreshCpdPublished(view);
    ctx.FX.viewIn(view);
  }

  async function refreshCpdPublished(view) {
    const list = (await ctx.Backend.getCpdVolumes().catch(() => [])) || [];
    const host = view.querySelector('#cp-published'), count = view.querySelector('#cp-pub-count');
    if (count) count.textContent = list.length;
    if (!host) return;
    host.innerHTML = list.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th>Volume</th><th>Topics</th><th>Questions</th><th>SBA</th><th></th></tr></thead>
      <tbody>${list.map(v => { const c = cpdCounts(v); return `<tr>
        <td>${ctx.esc(v.volume || v.id)}</td><td class="muted">${c.secs}</td><td class="muted">${c.qs}</td><td class="muted">${c.sba || '—'}</td>
        <td><button class="link-btn" data-unpub-cpd="${ctx.esc(v.id)}">unpublish</button></td></tr>`; }).join('')}</tbody>
    </table></div>` : `<p class="muted">No CPD volumes published yet.</p>`;
    host.querySelectorAll('[data-unpub-cpd]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Unpublish this CPD volume? Answers already given are kept.')) return;
      await ctx.Backend.unpublishCpdVolume(b.dataset.unpubCpd);
      if (typeof CPD !== 'undefined') CPD.bustVolumes();
      await refreshCpdPublished(view);
    }));
  }

  async function scanCpd() {
    const status = document.getElementById('cp-status'), list = document.getElementById('cp-list');
    status.textContent = 'Scanning…'; list.innerHTML = '';
    let files = [];
    try {
      const base = ctx.cfg.drive.apiBase;
      const fid = ctx.cfg.drive.cpdFolderId;
      if (!fid) throw new Error('drive.cpdFolderId is not set in config.js.');
      const res = await fetch(`${base}?action=list&folderId=${encodeURIComponent(fid)}`, { cache: 'no-cache' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      files = data.files || [];
    } catch (e) { status.innerHTML = `<span class="bad">${ctx.esc(e.message || e)}</span>`; return; }

    const published = (await ctx.Backend.getCpdVolumes().catch(() => [])) || [];
    const pubIds = new Set(published.map(v => v.id));
    const staged = [], rejected = [];
    for (const f of files) {
      let doc = f.volume && typeof f.volume === 'object' ? f.volume : (f.paper || f.deck || null);
      if (!doc && f.id) { try { const r = await fetch(`${ctx.cfg.drive.apiBase}?action=file&id=${encodeURIComponent(f.id)}`); doc = await r.json(); } catch { doc = null; } }
      if (!doc || !Array.isArray(doc.sections)) continue;                 // not a CPD file at all
      if (doc.schema && !CPD_SCHEMAS.includes(doc.schema)) continue;      // someone else's schema
      const errs = validateCpdVolume(doc);
      if (errs.length) { rejected.push({ name: f.name || doc.volume || 'file', errs }); continue; }
      doc.id = cpdId(doc);
      if (!pubIds.has(doc.id)) staged.push(doc);
    }
    status.innerHTML = `${files.length} file${files.length !== 1 ? 's' : ''} · <strong>${staged.length} new volume${staged.length !== 1 ? 's' : ''}</strong>` +
      (rejected.length ? ` · <span class="bad">${rejected.length} rejected</span>` : '');
    list.innerHTML = '';
    if (rejected.length) {
      list.innerHTML += rejected.map(r => `<div class="dev-row card">
        <p class="dev-file">⚠ ${ctx.esc(r.name)}</p>
        <p class="dev-row-msg bad">${r.errs.slice(0, 6).map(ctx.esc).join('<br>')}</p></div>`).join('');
    }
    if (!staged.length) {
      list.innerHTML += `<p class="muted">No new CPD volumes found (already published, or the folder holds other schemas).</p>`;
      return;
    }
    list.innerHTML += staged.map((d, i) => { const c = cpdCounts(d); return `
      <div class="dev-row card" data-ci="${i}">
        <div class="dev-row-head">
          <div><p class="dev-file">📖 ${ctx.esc(d.volume || d.id)}</p>
            <p class="muted tiny">${c.secs} topics · ${c.qs} questions${c.sba ? ` (${c.qs - c.sba} true/false · ${c.sba} SBA)` : ''}${d.doi ? ' · DOI ' + ctx.esc(d.doi) : ''}</p>
            <p class="muted tiny">${(d.sections || []).map(x => ctx.esc(x.topic || x.id)).join(' · ')}</p></div>
          <button class="btn btn-gold btn-sm" data-cp-approve="${i}">Publish</button>
        </div><p class="dev-row-msg" data-cp-msg="${i}"></p>
      </div>`; }).join('');
    staged.forEach((d, i) => document.querySelector(`[data-cp-approve="${i}"]`).addEventListener('click', async e => {
      const msg = document.querySelector(`[data-cp-msg="${i}"]`);
      e.target.disabled = true; msg.textContent = 'Publishing…'; msg.className = 'dev-row-msg muted';
      try {
        await ctx.Backend.publishCpdVolume(d);
        if (typeof CPD !== 'undefined') CPD.bustVolumes();
        msg.textContent = '✓ Published to Library → CPD.'; msg.className = 'dev-row-msg good';
        await refreshCpdPublished(document.getElementById('view'));
      } catch (err) { msg.textContent = err.message || String(err); msg.className = 'dev-row-msg bad'; e.target.disabled = false; }
    }));
  }

  async function pasteCpd() {
    const ta = document.getElementById('cp-paste'), out = document.getElementById('cp-paste-result');
    let d; try { d = JSON.parse(ta.value); } catch (e) { out.innerHTML = `<p class="bad">Invalid JSON: ${ctx.esc(e.message)}</p>`; return; }
    const errs = validateCpdVolume(d);
    if (errs.length) { out.innerHTML = `<p class="bad">${errs.slice(0, 10).map(ctx.esc).join('<br>')}</p>`; return; }
    d.id = cpdId(d);
    try {
      await ctx.Backend.publishCpdVolume(d);
      if (typeof CPD !== 'undefined') CPD.bustVolumes();
      const c = cpdCounts(d);
      out.innerHTML = `<p class="good">✓ Published “${ctx.esc(d.volume || d.id)}” — ${c.secs} topics, ${c.qs} statements.</p>`;
      await refreshCpdPublished(document.getElementById('view'));
    } catch (e) { out.innerHTML = `<p class="bad">${ctx.esc(e.message || e)}</p>`; }
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

  /* The station editor is used from two places now: this console, and the
     Station editor tab in the OSCE section, which candidates can reach. That
     second caller has never gone through render(), so `ctx` is empty — fill
     it in from the globals rather than requiring the console to have been
     opened first. */
  function openOsceEditor(host, station, colls, onSaved) {
    if (!ctx) ctx = { cfg: window.AUREUM_CONFIG || {}, Data: typeof Data !== 'undefined' ? Data : null,
      Backend, esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      FX: typeof FX !== 'undefined' ? FX : { viewIn() {} } };
    return osceEditor(host, station, colls, onSaved);
  }

  return { render, osceEditor: openOsceEditor, validateOsce };
})();
