/* ============================================================
   discussions.js — cases you have already discussed, elsewhere.

   WHY THIS IS A SEPARATE THING FROM THE CASES TAB

   The Cases tab holds cases to SIT: you present, the site examines you and
   marks the recording. This holds cases that have already HAPPENED — a
   conversation had with a good examiner somewhere else, exported as JSON,
   brought here to be kept, revised from, printed, and re-sat against.

   They are two different objects and the difference matters. A case_file
   is published material every candidate sits; a discussion is one
   person's own record, including where they went wrong and how they
   mispronounced Vicryl. Mixing them would make "which of these have I
   actually done" unanswerable, and would publish somebody's bad afternoon
   to the whole group.

   So: a separate Drive folder, a separate importer, a separate store, and
   RLS that keeps each one private to the person who imported it.

   WHAT IT IS FOR, IN ORDER OF VALUE

   1. The terminology table. Nothing else in the system produces "you said
      'people biopsy', it is 'pipelle', say pip-ELL". It is per-session,
      it is specific, and it is the fastest marks on the day.
   2. The revision note, printable, without paying a model to rewrite what
      has already been written.
   3. Re-sitting. A discussion carries phases and questions in the same
      shape as a case file, so it can be handed straight to the live
      examiner and sat again — which is the only way to find out whether
      the feedback stuck.
   4. A recording of the discussion itself, kept locally, so a conversation
      had on another device can still be listened back to.
   ============================================================ */

const Discussions = (() => {
  const cfg = () => window.AUREUM_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  const SCHEMA = 'aureum-case-v2';

  /* ---------------- validating an imported file ----------------
     Softer than the case-file validator on purpose. A case FILE that
     cannot be marked is dangerous — it would score zero out of zero and
     look like a pass. A discussion is a record; a thin one is merely thin.
     So the only hard requirements are the things without which there is
     nothing to show at all. */
  function validate(d) {
    const e = [];
    if (!d || typeof d !== 'object') return ['That is not a JSON object.'];
    if (!d.topic) e.push('No "topic".');
    if (!d.id) e.push('No "id".');
    const hasAnything = (d.phases || []).length || (d.questions || []).length
      || (d.revision && Object.keys(d.revision).length) || (d.session && Object.keys(d.session).length);
    if (!hasAnything) e.push('Nothing in it — no phases, no questions, no revision note and no session record.');
    return e;
  }

  /** What is thin rather than wrong — worth saying, never worth refusing. */
  function warnings(d) {
    const w = [];
    if (!d.session || !Object.keys(d.session).length) {
      w.push('No "session" block, so there is no record of how this discussion actually went — no slips, no verdict.');
    } else if (!(d.session.language || []).length) {
      w.push('No terminology table. If nothing was mispronounced that is fine; if it simply was not asked for, it is the most useful part to have.');
    }
    if (!d.revision || !Object.keys(d.revision).length) w.push('No revision note, so there is nothing to print.');
    if (!(d.questions || []).length) w.push('No viva questions, so this one cannot be re-sat.');
    if (d.schema && d.schema !== SCHEMA) w.push(`Schema says "${d.schema}"; this expects "${SCHEMA}". It has been imported anyway.`);
    return w;
  }

  const idOf = d => String(d.id || d.topic || 'discussion').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

  /* ---------------- the list ---------------- */

  async function render(view, user) {
    if (!Cases.allowed(user)) return Cases.renderBank(view, user);   // it does its own refusal
    view.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;
    let rows = [];
    try { rows = (await Backend.listCaseNotes()) || []; } catch (e) {
      view.innerHTML = `<section class="page"><p class="qr-danger">${esc(e.message)}</p></section>`; return;
    }

    view.innerHTML = `
      <section class="page dc-page">
        ${Cases.tabsHtml('mine-disc')}
        <header class="cs-head">
          <p class="kicker">MY CASE DISCUSSIONS</p>
          <h1>Cases you have already talked through.</h1>
          <p class="muted">Discussions had elsewhere, brought here to keep. Import the JSON and you get the
            revision note, the terminology table from that session, and — where the file carries questions — the
            option to sit the same case again against the live examiner.</p>
        </header>

        <div class="card dc-import" data-animate>
          <h3 class="card-title">📥 Import</h3>
          <p class="muted tiny">From your own <strong>My case discussions</strong> Drive folder, or a file, or
            pasted. This is a different folder from the one the published cases come from — one holds cases to sit,
            the other holds discussions that happened.</p>
          <div class="dev-inline">
            <button class="btn btn-gold" id="dc-scan">🔍 Scan the Drive folder</button>
            <label class="btn btn-ghost" style="cursor:pointer">📄 Choose files
              <input type="file" id="dc-files" accept="application/json,.json" multiple hidden></label>
            <a class="btn btn-ghost" href="docs/case-json-spec.md" target="_blank" rel="noopener">📋 The JSON spec</a>
          </div>
          <details class="dev-collapse" style="margin-top:12px">
            <summary><span class="card-title">Or paste it</span><span class="dc-caret">▸</span></summary>
            <textarea id="dc-paste" rows="7" class="dev-json" placeholder='{ "schema": "aureum-case-v2", … }'></textarea>
            <button class="btn btn-ghost btn-sm" id="dc-paste-go">Import it</button>
          </details>
          <p class="dc-msg" id="dc-msg"></p>
          <div id="dc-staged"></div>
        </div>

        ${rows.length ? `
          <div class="dc-search">
            <input type="search" id="dc-q" placeholder="Search your discussions" autocomplete="off">
            <span class="muted tiny">${rows.length} discussion${rows.length === 1 ? '' : 's'}</span>
          </div>
          <div class="dc-grid" id="dc-grid"></div>`
        : `<p class="muted dc-none">Nothing imported yet. Have a case discussion, ask for the AUREUM case JSON at
            the end of it, drop the file in the Drive folder, and scan.</p>`}
      </section>`;
    FX.viewIn(view);

    const msg = view.querySelector('#dc-msg');
    const say = h => { if (msg) msg.innerHTML = h; };

    view.querySelector('#dc-scan').addEventListener('click', () => scan(view, user, say));
    view.querySelector('#dc-files').addEventListener('change', async e => {
      const out = [];
      for (const f of [...e.target.files]) {
        try { out.push(...asArray(JSON.parse(await f.text()))); }
        catch { say(`<span class="qr-danger">${esc(f.name)} is not valid JSON.</span>`); }
      }
      stage(view, user, out, say);
      e.target.value = '';
    });
    view.querySelector('#dc-paste-go').addEventListener('click', () => {
      const raw = view.querySelector('#dc-paste').value.trim();
      if (!raw) return;
      try { stage(view, user, asArray(JSON.parse(raw)), say); }
      catch (err) { say(`<span class="qr-danger">That is not valid JSON — ${esc(err.message)}</span>`); }
    });

    if (rows.length) {
      const grid = view.querySelector('#dc-grid');
      const box = view.querySelector('#dc-q');
      const paint = () => {
        const q = box.value.trim().toLowerCase();
        const hits = !q ? rows : rows.filter(r => (r.search || r.topic.toLowerCase()).includes(q));
        grid.innerHTML = hits.map(card).join('') || '<p class="muted">Nothing matches that.</p>';
      };
      box.addEventListener('input', paint);
      paint();
    }
  }

  const card = r => `
    <a class="dc-card" href="#/cases/discussion/${encodeURIComponent(r.id)}">
      <strong>${esc(r.topic || r.id)}</strong>
      ${r.verdict ? `<span class="dc-card-v">${esc(r.verdict)}</span>` : ''}
      <span class="dc-card-f">
        ${r.discussedOn ? esc(r.discussedOn) + ' · ' : ''}
        ${r.q_count ? r.q_count + ' viva questions · ' : ''}
        ${r.slips ? `<b class="dc-slip">${r.slips} slip${r.slips === 1 ? '' : 's'}</b> · ` : ''}
        ${r.hasRevision ? 'revision note' : 'no revision note'}
      </span>
    </a>`;

  const asArray = d => Array.isArray(d) ? d : (Array.isArray(d?.discussions) ? d.discussions : [d]);

  async function scan(view, user, say) {
    say('<span class="muted">Scanning…</span>');
    let files = [];
    try {
      const fid = cfg().drive?.myCaseFolderId;
      if (!fid) throw new Error('No myCaseFolderId is set in js/config.js.');
      const res = await fetch(`${cfg().drive.apiBase}?action=list&folderId=${encodeURIComponent(fid)}`, { cache: 'no-cache' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      files = data.files || [];
    } catch (e) { say(`<span class="qr-danger">${esc(e.message || e)}</span>`); return; }

    const out = [];
    for (const f of files) {
      let doc = f.paper || f.deck || f.case || null;
      if (!doc && f.id) {
        try { const r = await fetch(`${cfg().drive.apiBase}?action=file&id=${encodeURIComponent(f.id)}`); doc = await r.json(); }
        catch { doc = null; }
      }
      if (doc) out.push(...asArray(doc));
    }
    say(`<span class="muted">${files.length} file${files.length === 1 ? '' : 's'} in the folder.</span>`);
    stage(view, user, out, say);
  }

  async function stage(view, user, docs, say) {
    const host = view.querySelector('#dc-staged');
    let have = new Set();
    try { have = new Set(((await Backend.listCaseNotes()) || []).map(r => r.id)); } catch {}

    const good = [], bad = [];
    for (const d of docs) {
      if (!d || typeof d !== 'object') continue;
      const errs = validate(d);
      if (errs.length) bad.push({ d, errs }); else { d.id = idOf(d); good.push(d); }
    }
    if (!good.length && !bad.length) { host.innerHTML = '<p class="muted tiny">Nothing to import.</p>'; return; }

    host.innerHTML = `
      ${good.map((d, i) => {
        const w = warnings(d);
        return `<div class="dc-stage">
          <div class="dc-stage-h">
            <div>
              <strong>🩺 ${esc(d.topic)}</strong>${have.has(d.id) ? ' <span class="muted tiny">· replaces the one you have</span>' : ''}
              <span class="muted tiny">${(d.phases || []).length} phases · ${(d.questions || []).length} questions ·
                ${(d.session?.language || []).length} terminology slips ·
                ${d.revision ? 'revision note' : 'no revision note'}</span>
            </div>
            <button class="btn btn-gold btn-sm" data-dc-add="${i}">${have.has(d.id) ? 'Replace' : 'Import'}</button>
          </div>
          ${w.length ? `<ul class="dc-warn">${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <p class="dev-row-msg" data-dc-msg="${i}"></p>
        </div>`;
      }).join('')}
      ${bad.map(b => `<div class="dc-stage is-bad">
        <div class="dc-stage-h"><div><strong>⚠️ ${esc(b.d.topic || '(no topic)')}</strong>
          <span class="muted tiny">Not imported.</span></div></div>
        <ul class="dc-warn">${b.errs.map(x => `<li class="qr-danger">${esc(x)}</li>`).join('')}</ul>
      </div>`).join('')}`;

    good.forEach((d, i) => host.querySelector(`[data-dc-add="${i}"]`).addEventListener('click', async e => {
      const m = host.querySelector(`[data-dc-msg="${i}"]`);
      e.target.disabled = true; m.textContent = 'Importing…'; m.className = 'dev-row-msg muted';
      try {
        await Backend.saveCaseNote(Object.assign({ schema: SCHEMA }, d, { imported: Date.now() }));
        m.textContent = '✓ Imported.'; m.className = 'dev-row-msg good';
        setTimeout(() => render(view, user), 700);
      } catch (err) { m.textContent = err.message || String(err); m.className = 'dev-row-msg bad'; e.target.disabled = false; }
    }));
  }

  /* ================= one discussion ================= */

  async function renderOne(view, id, user) {
    if (!Cases.allowed(user)) return Cases.renderBank(view, user);
    view.innerHTML = `<section class="page"><p class="muted">Loading…</p></section>`;
    let d;
    try { d = await Backend.getCaseNote(id); } catch (e) {
      view.innerHTML = `<section class="page"><p class="qr-danger">${esc(e.message)}</p></section>`; return;
    }
    if (!d) { view.innerHTML = `<section class="page"><p class="muted">That discussion is not here.</p></section>`; return; }

    const S = d.session || {}, R = d.revision || {};
    view.innerHTML = `
      <section class="page dc-one">
        <a class="link tiny" href="#/cases/mine-disc">← My case discussions</a>
        <header class="dc-one-h">
          <div>
            <p class="kicker">CASE DISCUSSION${d.discussedOn ? ' · ' + esc(d.discussedOn) : ''}</p>
            <h1>${esc(d.topic || '')}</h1>
          </div>
          ${S.score ? `<div class="cs-pct ${(S.score.awarded / (S.score.max || 100)) >= 0.5 ? 'is-pass' : 'is-fail'}">
            <b>${Math.round((S.score.awarded / (S.score.max || 100)) * 100)}%</b><span>that session</span></div>` : ''}
        </header>

        ${d.vignette ? `<div class="cs-vignette"><h3>The patient</h3><p>${esc(d.vignette)}</p></div>` : ''}
        ${S.verdict ? `<div class="cs-verdict"><h3>The verdict that session</h3><p>${esc(S.verdict)}</p></div>` : ''}

        ${(S.language || []).length ? `
        <div class="cs-lang dc-lang">
          <h3>What you said, and what to say</h3>
          <p class="muted tiny">From this discussion. Drill these aloud — they are the cheapest marks on the day.</p>
          <table class="cs-lang-t">
            <thead><tr><th>You said</th><th>Say</th><th>How / why</th></tr></thead>
            <tbody>${S.language.map(l => `<tr>
              <td class="cs-said-cell">${esc(l.said || '')}</td>
              <td><strong>${esc(l.correct || '')}</strong>${l.say ? `<br><em class="dc-say">${esc(l.say)}</em>` : ''}</td>
              <td class="muted tiny">${esc(l.why || '')}</td></tr>`).join('')}</tbody>
          </table>
        </div>` : ''}

        ${(S.missed || []).length || (S.saidWell || []).length ? `
        <div class="cs-two">
          ${(S.saidWell || []).length ? `<div><h3>What was good</h3>
            <ul>${S.saidWell.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          ${(S.missed || []).length ? `<div><h3>What was missed</h3>
            <ul>${S.missed.map(x => `<li><strong>${esc(x.point || x)}</strong>${
              x.why ? `<br><em class="muted tiny">${esc(x.why)}</em>` : ''}</li>`).join('')}</ul></div>` : ''}
        </div>` : ''}

        ${(S.technique || []).length ? `<div class="cs-key"><h3>Presentation technique</h3>
          <ul>${S.technique.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}

        ${revisionHtml(R)}

        ${(d.questions || []).length ? `
        <div class="cs-res-viva">
          <h3>The viva, with model answers</h3>
          ${(d.questions || []).map((q, i) => `
            <details class="cs-res-q">
              <summary><span class="cs-res-mark">Q${i + 1}</span> ${esc(q.q || '')}</summary>
              ${q.model ? `<div class="cs-model-box"><strong>The model answer</strong><p>${esc(q.model)}</p></div>` : ''}
              ${(q.mustHit || []).length ? `<ul class="cs-must-list">${q.mustHit.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
              ${q.followUp ? `<p class="cs-follow"><strong>Then asked:</strong> ${esc(q.followUp)}</p>` : ''}
            </details>`).join('')}
          ${(S.extraQuestions || []).map(q => `
            <details class="cs-res-q">
              <summary><span class="cs-res-mark">extra</span> ${esc(q.q || '')}</summary>
              ${q.answered ? `<p class="cs-said">You answered: ${esc(q.answered)}</p>` : ''}
              ${q.model ? `<div class="cs-model-box"><strong>The model answer</strong><p>${esc(q.model)}</p></div>` : ''}
            </details>`).join('')}
        </div>` : ''}

        <div class="dc-rec" id="dc-rec"></div>

        <div class="cs-res-acts">
          <button class="btn btn-ghost" id="dc-print">🖨 Print / Save as PDF</button>
          ${(d.phases || []).length ? `<button class="btn btn-gold" id="dc-resit">🎙 Sit this case again</button>` : ''}
          <button class="btn btn-ghost btn-sm qr-danger" id="dc-del">🗑 Remove</button>
        </div>
      </section>`;
    FX.viewIn(view);

    wireRecorder(view.querySelector('#dc-rec'), d, user);

    view.querySelector('#dc-print').addEventListener('click', () => print(d));
    view.querySelector('#dc-del').addEventListener('click', async () => {
      if (!confirm('Remove this discussion? The JSON in your Drive folder is untouched — you can import it again.')) return;
      await Backend.deleteCaseNote(d.id);
      location.hash = '#/cases/mine-disc';
    });
    /* Re-sitting is the whole point of keeping the phases: a discussion you
       cannot sit again is a document, and you already had one of those. */
    view.querySelector('#dc-resit')?.addEventListener('click', async () => {
      try {
        await Backend.publishCase(Object.assign({}, d, { id: 'redo-' + d.id, topic: d.topic + ' (re-sit)' }));
        Cases.bustCases();
        location.hash = '#/cases/case/' + encodeURIComponent('redo-' + d.id);
      } catch (e) { alert(e.message || String(e)); }
    });
  }

  function revisionHtml(R) {
    if (!R || !Object.keys(R).length) return '';
    const list = (a, f) => (a || []).map(f).join('');
    return `
      <div class="dc-rev">
        <h2>Revision note</h2>
        ${(R.quickBox || []).length ? `<div class="dc-quick">
          <h3>Quick revision</h3>
          <ul>${list(R.quickBox, x => `<li>${esc(x)}</li>`)}</ul></div>` : ''}
        ${R.definition ? `<h3>Definition</h3><p>${esc(R.definition)}</p>` : ''}
        ${(R.pathophysiology || []).length ? `<h3>Pathophysiology</h3>
          <ul>${list(R.pathophysiology, x => `<li>${esc(x)}</li>`)}</ul>` : ''}
        ${(R.differentials || []).length ? `<h3>Differential diagnosis</h3>
          <table class="dc-t"><thead><tr><th></th><th>Cause</th><th>Distinguishing features</th></tr></thead>
          <tbody>${list(R.differentials, x => `<tr><td class="dc-t-g">${esc(x.group || '')}</td>
            <td><strong>${esc(x.name || '')}</strong></td><td>${esc(x.features || '')}</td></tr>`)}</tbody></table>` : ''}
        ${(R.investigations || []).length ? `<h3>Investigations</h3>
          <table class="dc-t"><thead><tr><th>Test</th><th>Why</th></tr></thead>
          <tbody>${list(R.investigations, x => `<tr><td><strong>${esc(x.test || '')}</strong></td>
            <td>${esc(x.why || '')}</td></tr>`)}</tbody></table>` : ''}
        ${(R.classification || []).length ? `<h3>Classification and severity</h3>
          <ul>${list(R.classification, x => `<li>${esc(x)}</li>`)}</ul>` : ''}
        ${(R.management || []).length ? `<h3>Management</h3>
          ${list(R.management, m => `<h4>${esc(m.heading || '')}</h4>
            <ul>${list(m.points, p => `<li>${esc(p)}</li>`)}</ul>`)}` : ''}
        ${(R.traps || []).length ? `<div class="dc-traps"><h3>Traps</h3>
          <ul>${list(R.traps, x => `<li>${esc(x)}</li>`)}</ul></div>` : ''}
        ${(R.references || []).length ? `<p class="cs-src muted tiny">References: ${(R.references || []).map(esc).join(' · ')}</p>` : ''}
      </div>`;
  }

  /* ---------------- recording a discussion ----------------

     For the case where the conversation is happening RIGHT NOW on another
     device — a phone with a chatbot, or a colleague across the table. The
     site is not part of that conversation and cannot be; what it can do is
     hold the microphone open and keep the tape.

     It stays LOCAL. Uploading half an hour of audio nobody asked to have
     marked would spend the candidate's storage and their bandwidth for a
     file they may only ever want to hear once. It goes in the same
     device-local store the unmarked queue uses, and it can be downloaded,
     sent to Drive, or — where the discussion carries phases — sent to be
     marked like any other case. */
  function wireRecorder(host, d, user) {
    if (!host) return;
    let cap = null, timer = null, secs = 0, tape = null;

    const paint = () => {
      host.innerHTML = `
        <div class="dc-recbox">
          <h3>Record a discussion of this case</h3>
          <p class="muted tiny">For when you are talking it through with someone — or with a chatbot on another
            device. The microphone is held open here and the recording stays on this device until you do something
            with it. Nothing is uploaded and nothing is charged.</p>
          <div class="dc-rec-row">
            ${cap ? `<button class="btn btn-gold" id="dc-stop">⏹ Stop</button>
                     <span class="dc-rec-live"><i></i>Recording · ${fmt(secs)}</span>`
                  : `<button class="btn btn-ghost" id="dc-go">🎙 Start recording</button>`}
            ${tape ? `<span class="muted tiny">${fmt(tape.secs)} · ${(tape.bytes / 1048576).toFixed(1)} MB</span>` : ''}
          </div>
          <div class="os-mic" id="dc-mic"></div>
          ${tape ? `<div class="cs-audio">
            <audio controls src="${tape.url}"></audio>
            <a class="btn btn-ghost btn-sm" download="DISCUSSION-${esc((d.topic || 'case').replace(/[^a-z0-9]+/gi, '-'))}.${tape.ext}" href="${tape.url}">⬇ Download</a>
            <button class="btn btn-ghost btn-sm" id="dc-keep">💾 Keep it on this device</button>
            ${typeof Drive !== 'undefined' && Drive.on() ? `<button class="btn btn-ghost btn-sm" id="dc-drive">☁ Send to Drive</button>` : ''}
          </div>
          <p class="dc-rec-msg" id="dc-rec-msg"></p>` : ''}
        </div>`;

      host.querySelector('#dc-go')?.addEventListener('click', async () => {
        cap = OSCE.makeCapture(host.querySelector('#dc-mic'), false);
        const ok = await cap.start();
        if (!ok && cap.state?.().failed) { cap = null; paint(); return; }
        secs = 0;
        timer = setInterval(() => { secs++; const el = host.querySelector('.dc-rec-live'); if (el) el.innerHTML = `<i></i>Recording · ${fmt(secs)}`; }, 1000);
        paint();
      });
      host.querySelector('#dc-stop')?.addEventListener('click', async () => {
        clearInterval(timer); timer = null;
        const r = await cap.stop().catch(() => null);
        try { cap.kill(); } catch {}
        cap = null;
        tape = r;
        paint();
      });
      host.querySelector('#dc-keep')?.addEventListener('click', async e => {
        const m = host.querySelector('#dc-rec-msg');
        e.target.disabled = true;
        try {
          Pending.setOwner(user?.email || '');
          await Pending.put({ kind: 'discussion', id: 'dr-' + d.id + '-' + Date.now().toString(36),
            title: d.topic || d.id, blob: tape.blob, mime: tape.mime, secs: tape.secs,
            payload: { discussion_id: d.id },
            reason: 'Kept deliberately — not waiting to be marked.' });
          m.innerHTML = '<span class="good">Kept on this device. It is in the queue list under the OSCE tab.</span>';
        } catch (err) { m.innerHTML = `<span class="qr-danger">${esc(err.message || err)}</span>`; e.target.disabled = false; }
      });
      host.querySelector('#dc-drive')?.addEventListener('click', async e => {
        const m = host.querySelector('#dc-rec-msg');
        e.target.disabled = true; m.textContent = 'Uploading…';
        try {
          const up = await Drive.upload(tape.blob, Drive.nameFor('DISCUSSION — ' + (d.topic || ''), Date.now(), tape.ext),
            { description: 'AUREUM case discussion recording' });
          m.innerHTML = up ? '<span class="good">In your Drive folder.</span>'
            : '<span class="qr-danger">Drive would not take it — check the connection in Profile.</span>';
        } catch (err) { m.innerHTML = `<span class="qr-danger">${esc(err.message || err)}</span>`; }
        e.target.disabled = false;
      });
    };
    paint();
  }

  /* ---------------- print ---------------- */
  function print(d) {
    const S = d.session || {}, R = d.revision || {};
    const P = '.dc-print';
    const styles = `
@page { size: A4 portrait; margin: 16mm 15mm 14mm; }
${P} { color:#111; background:#fff; font-family:"Helvetica Neue",Arial,sans-serif; font-size:10pt; line-height:1.5; }
${P} h1{font-family:Georgia,serif;font-size:20pt;margin:0 0 4px}
${P} h2{font-size:13pt;margin:16px 0 6px;border-left:4px solid #0d8f7d;padding-left:9px}
${P} h3{font-size:10.5pt;margin:12px 0 4px}
${P} h4{font-size:9.5pt;margin:9px 0 3px;color:#444}
${P} .brand{font-size:7.5pt;letter-spacing:.22em;text-transform:uppercase;color:#7a5a10;margin:0 0 2px}
${P} ul{margin:4px 0 8px 16px;padding:0}
${P} li{margin:2px 0}
${P} table{width:100%;border-collapse:collapse;font-size:9pt;margin:6px 0}
${P} th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
${P} .box{background:#f6f6f2;border-left:3px solid #7a5a10;padding:8px 11px;margin:8px 0}
${P} .said{color:#a33;font-style:italic}
${P} .foot{margin-top:16px;padding-top:6px;border-top:1px solid #ddd;font-size:7.5pt;color:#888}`;

    const L = (a, f) => (a || []).map(f).join('');
    const body = `<div class="dc-print">
      <p class="brand">AUREUM · Pathway to MD</p>
      <h1>${esc(d.topic || '')}</h1>
      <p>Case discussion${d.discussedOn ? ' · ' + esc(d.discussedOn) : ''}</p>
      ${d.vignette ? `<p>${esc(d.vignette)}</p>` : ''}
      ${(R.quickBox || []).length ? `<div class="box"><h3>Quick revision</h3>
        <ul>${L(R.quickBox, x => `<li>${esc(x)}</li>`)}</ul></div>` : ''}
      ${S.verdict ? `<h2>The verdict that session</h2><p>${esc(S.verdict)}</p>` : ''}
      ${(S.language || []).length ? `<h2>What you said, and what to say</h2>
        <table><tr><th>You said</th><th>Say</th><th>How / why</th></tr>
        ${L(S.language, l => `<tr><td class="said">${esc(l.said || '')}</td>
          <td><b>${esc(l.correct || '')}</b>${l.say ? ` — ${esc(l.say)}` : ''}</td>
          <td>${esc(l.why || '')}</td></tr>`)}</table>` : ''}
      ${(S.missed || []).length ? `<h2>What was missed</h2>
        <ul>${L(S.missed, x => `<li><b>${esc(x.point || x)}</b>${x.why ? ` — ${esc(x.why)}` : ''}</li>`)}</ul>` : ''}
      ${(S.technique || []).length ? `<h2>Presentation technique</h2>
        <ul>${L(S.technique, x => `<li>${esc(x)}</li>`)}</ul>` : ''}
      ${R.definition ? `<h2>Definition</h2><p>${esc(R.definition)}</p>` : ''}
      ${(R.pathophysiology || []).length ? `<h2>Pathophysiology</h2>
        <ul>${L(R.pathophysiology, x => `<li>${esc(x)}</li>`)}</ul>` : ''}
      ${(R.differentials || []).length ? `<h2>Differential diagnosis</h2>
        <table><tr><th></th><th>Cause</th><th>Distinguishing features</th></tr>
        ${L(R.differentials, x => `<tr><td>${esc(x.group || '')}</td><td><b>${esc(x.name || '')}</b></td>
          <td>${esc(x.features || '')}</td></tr>`)}</table>` : ''}
      ${(R.investigations || []).length ? `<h2>Investigations</h2>
        <table><tr><th>Test</th><th>Why</th></tr>
        ${L(R.investigations, x => `<tr><td><b>${esc(x.test || '')}</b></td><td>${esc(x.why || '')}</td></tr>`)}</table>` : ''}
      ${(R.classification || []).length ? `<h2>Classification and severity</h2>
        <ul>${L(R.classification, x => `<li>${esc(x)}</li>`)}</ul>` : ''}
      ${(R.management || []).length ? `<h2>Management</h2>
        ${L(R.management, m => `<h4>${esc(m.heading || '')}</h4><ul>${L(m.points, p => `<li>${esc(p)}</li>`)}</ul>`)}` : ''}
      ${(d.questions || []).length ? `<h2>Viva, with model answers</h2>
        ${L(d.questions, (q, i) => `<h3>Q${i + 1}. ${esc(q.q || '')}</h3>
          ${q.model ? `<p>${esc(q.model)}</p>` : ''}
          ${(q.mustHit || []).length ? `<ul>${L(q.mustHit, m => `<li>${esc(m)}</li>`)}</ul>` : ''}`)}` : ''}
      ${(R.traps || []).length ? `<h2>Traps</h2><ul>${L(R.traps, x => `<li>${esc(x)}</li>`)}</ul></p>` : ''}
      ${(R.references || []).length ? `<p><b>References.</b> ${(R.references || []).map(esc).join(' · ')}</p>` : ''}
      <p class="foot">AUREUM · Pathway to MD — case discussion note, ${new Date().toLocaleDateString('en-GB')}</p>
    </div>`;

    if (typeof OSCE?.openPrintSheet === 'function') return OSCE.openPrintSheet(styles, body);
    const w = document.createElement('div');
    w.innerHTML = `<style>${styles}</style>${body}`;
    document.body.appendChild(w);
    setTimeout(() => { window.print(); setTimeout(() => w.remove(), 800); }, 60);
  }

  return { render, renderOne, validate, warnings, SCHEMA, print, idOf };
})();
