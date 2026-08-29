/* ============================================================
   created.js — the Created OSCE bank.

   WHAT THIS IS FOR

   Four of us meet to practise. Each person writes a station beforehand;
   on the day, whoever wrote it examines and the rest sit it. Until now
   that station existed only on the author's laptop — as a PDF, or a
   Word file, or a Claude conversation — and everything the site can do
   with a station (speak it, mark it, tick it by hand, print it, put it
   in a circuit) was unavailable to precisely the stations we actually
   practise on.

   So this is a bank anyone may write into.

   THE ONE DECISION THAT MATTERS

   Created OSCE is A COLLECTION, not a second OSCE system.

   It would have been quicker to build a parallel page with its own
   cards, its own runner and its own marking. It would also have been
   wrong: every feature already in the bank would have had to be built
   twice, and every feature added later would have to be remembered
   twice — and the one that was forgotten would be forgotten silently.

   A created station is an ordinary station whose `collection` happens
   to be `created`. That single fact is what makes the spoken runner,
   the live examiner, AI marking, marking by hand with the tick-sheet,
   the exam simulator, the blueprint, progress, study documents, the
   printed PDF and everything shipped after this work on it on the day
   it is imported, with no code here at all. Nothing in this file
   touches how a station RUNS. It only puts stations into the bank.

   WHAT IS ACTUALLY HERE

     · the instructions — one markdown file, downloadable, editable by
       the owner in the developer tab, so the JSON everyone hands to
       Claude comes from one shared source of truth rather than eight
       forwarded copies drifting apart
     · import from a file, or from pasted text, one station or many
     · validation that refuses a file rather than importing a broken
       one, and says which rule failed and where
     · attribution — a station carries who wrote it, and the round can
       see whose it is
     · withdrawal — the author may take their own station back out

   VALIDATION IS A GATE, NOT A WARNING

   A station with marks that do not add up is worse than no station:
   it is discovered at the moment somebody is sitting it, out loud, on
   the clock. So a file that fails any rule in the instructions is not
   imported at all — not imported-with-a-warning. And a batch is
   checked WHOLE before a single row is written, because half a circuit
   is not a circuit.
   ============================================================ */

const Created = (() => {
  'use strict';

  const cfg = () => window.AUREUM_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const COLL = () => cfg().osce?.createdCollection || 'created';
  const GUIDE_FILE = 'docs/osce-json-guide.md';
  const GUIDE_NAME = 'Aureum_OSCE_JSON_Creation_Instructions.md';

  /* ---------------- the instructions ----------------

     Two copies exist and the precedence between them is the whole
     design: the one shipped in docs/ is what a fresh deployment has,
     and the one saved in app_config is what the owner has edited. The
     saved one wins whenever it exists.

     app_config is public-read / developer-write, which is exactly the
     rule wanted: everybody may take a copy, only the owner may change
     the copy everybody takes. No new table, no new policy.

     The shipped file is fetched, not inlined, because a 13 KB string
     baked into a script is 13 KB every visitor downloads whether or
     not they ever press the button. */

  let _guide = null;                 // { md, updated_at, by, source }

  async function shipped() {
    const r = await fetch(GUIDE_FILE + '?v=84', { cache: 'no-cache' });
    if (!r.ok) throw new Error('The shipped instructions could not be read (' + r.status + ').');
    return await r.text();
  }

  async function guide(force) {
    if (_guide && !force) return _guide;
    let saved = null;
    try { saved = await Backend.getOsceGuide(); } catch { /* fall through to shipped */ }
    if (saved && saved.md) {
      _guide = { md: saved.md, updated_at: saved.updated_at || null, by: saved.by || '', source: 'saved' };
      return _guide;
    }
    _guide = { md: await shipped(), updated_at: null, by: '', source: 'shipped' };
    return _guide;
  }

  /** Developer only — the RLS on app_config is what actually enforces that. */
  async function saveGuide(md, who) {
    const rec = { md: String(md || ''), updated_at: Date.now(), by: who || '' };
    await Backend.saveOsceGuide(rec);
    _guide = { md: rec.md, updated_at: rec.updated_at, by: rec.by, source: 'saved' };
    return _guide;
  }
  function bustGuide() { _guide = null; }

  /* A download, not a new tab. Safari on iPad will happily render markdown
     as unstyled text in a tab and call it a day, which is not what the
     button says it does. */
  function download(md) {
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = GUIDE_NAME;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------------- validation ----------------

     §5 of the instructions states three rules with zero exceptions. They
     are re-stated here rather than trusted, because the file arriving
     here was written by a model in somebody else's conversation and
     nothing guarantees it read §5.

     Every message names the question it is about. "marks must be a
     positive number" sends somebody scrolling through 300 lines of JSON;
     "Q4 (“How would you manage the haemorrhage?”): marks is 0" does not. */

  const num = v => (v == null || v === '' ? NaN : Number(v));

  function validate(d) {
    const e = [];
    if (!d || typeof d !== 'object' || Array.isArray(d)) return ['That is not a station object.'];
    if (!String(d.topic || '').trim()) e.push('Missing "topic" — the station needs a name.');
    if (!String(d.scenario || '').trim()) e.push('Missing "scenario" — the candidate is read this before the questions start.');

    const qs = Array.isArray(d.questions) ? d.questions : [];
    if (!qs.length) e.push('Missing "questions" — a station needs at least one.');

    let sum = 0;
    qs.forEach((q, i) => {
      const who = 'Q' + (i + 1) + (q.prompt ? ' (“' + String(q.prompt).slice(0, 48) + (String(q.prompt).length > 48 ? '…' : '') + '”)' : '');
      if (!String(q?.prompt || '').trim()) e.push(who + ': no "prompt" — this is the sentence the examiner says out loud.');
      const pts = Array.isArray(q?.marking_points) ? q.marking_points.filter(p => String(p || '').trim()) : [];
      if (!pts.length) e.push(who + ': no "marking_points" — there is nothing to mark the answer against.');
      const m = num(q?.marks);
      if (!Number.isFinite(m)) e.push(who + ': "marks" is missing or is not a number.');
      else if (m <= 0) e.push(who + ': "marks" is ' + m + ' — every question must be worth more than nothing.');
      else sum += m;
    });

    const total = num(d.total_marks);
    if (!Number.isFinite(total)) e.push('"total_marks" is missing or is not a number.');
    else if (total <= 0) e.push('"total_marks" is ' + total + ' — it must be greater than 0.');
    else if (qs.length && Math.abs(sum - total) > 0.01)
      e.push('The questions add up to ' + sum + ', but "total_marks" says ' + total + '. §5 rule 3: they must match exactly.');

    const pass = num(d.pass_mark);
    if (Number.isFinite(pass) && pass <= 0) e.push('"pass_mark" is ' + pass + ' — leave it out rather than setting it to 0.');
    return e;
  }

  /* One station, several stations, or a whole file of either. The
     instructions say one station per file (§6) but people paste what they
     have, and rejecting a valid array on a technicality helps nobody. */
  function unpack(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.stations)) return raw.stations;
    return [raw];
  }

  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  /* ---------------- what gets written ----------------

     The author's own fields are kept exactly as they were — including
     source_meta, which is the whole audit trail of what was invented and
     what came from the source, and would be worse than useless if this
     rewrote it. Only the four fields the bank itself owns are set. */
  function normalise(d, user) {
    const rec = Object.assign({}, d);
    rec.id = String(d.id || '').trim() || 'osce-made-' + slug(d.topic || d.source_file || 'station');
    rec.collection = COLL();
    rec.station_time_min = num(d.station_time_min) > 0 ? num(d.station_time_min) : 15;
    rec.reading_time_min = Number.isFinite(num(d.reading_time_min)) ? num(d.reading_time_min) : 1;
    if (!Number.isFinite(num(rec.pass_mark_percent))) rec.pass_mark_percent = 70;
    if (!Number.isFinite(num(rec.pass_mark)))
      rec.pass_mark = Math.round(num(rec.total_marks) * (num(rec.pass_mark_percent) / 100));
    rec.created_by = user?.id || '';
    rec.created_by_name = user?.name || user?.user_metadata?.name || user?.email || 'A candidate';
    rec.created_on = Date.now();   // not created_at: the table already has a column by that name
    return rec;
  }

  const nameOf = st => st?.created_by_name || '';

  /* ---------------- importing ----------------

     Whole batch or nothing. Every file is parsed and validated before the
     first row is written, so a bad third file cannot leave you with two
     stations imported and no idea which. */
  async function importAll(items, user) {
    const bad = [], good = [];
    items.forEach(it => {
      let raw;
      try { raw = JSON.parse(it.text); }
      catch (err) { bad.push({ name: it.name, errs: ['That is not valid JSON: ' + (err.message || err)] }); return; }
      unpack(raw).forEach((d, i, all) => {
        const label = it.name + (all.length > 1 ? ' — station ' + (i + 1) : '');
        const errs = validate(d);
        if (errs.length) bad.push({ name: label, errs });
        else good.push({ name: label, rec: normalise(d, user) });
      });
    });
    if (bad.length) return { ok: false, bad, good: good.map(g => g.name) };

    /* Two stations in one batch with the same topic would collide on id and
       the second would silently replace the first. Catch it here, where it
       can still be explained, rather than after the write. */
    const seen = new Set();
    for (const g of good) {
      if (seen.has(g.rec.id)) return { ok: false, bad: [{ name: g.name, errs: ['Two stations in this batch have the same topic, so they would overwrite each other. Rename one.'] }], good: [] };
      seen.add(g.rec.id);
    }

    const done = [], failed = [];
    for (const g of good) {
      try { await Backend.publishOsceStation(g.rec); done.push(g.rec); }
      catch (err) { failed.push({ name: g.name, errs: [err.message || String(err)] }); }
    }
    if (typeof OSCE !== 'undefined') OSCE.bustStations();
    return { ok: !failed.length, done, bad: failed, good: done.map(d => d.topic) };
  }

  /* ---------------- the panel ----------------

     Drawn under the chips while the Created OSCE bin is the one being
     looked at, and taken down again the moment it is not. */

  function panel(host, user, onDone) {
    if (!host || host.dataset.made === '1') return;
    host.dataset.made = '1';
    host.innerHTML = `
      <div class="card os-made" data-animate>
        <h3 class="card-title">✍️ Created OSCE — the stations we write for each other</h3>
        <p class="muted">Stations written by candidates, for the rounds we run face to face. Everything the rest of
          the bank does works here: the spoken runner with the live examiner, marking by AI, marking by hand on the
          tick-sheet, the exam simulator, progress and the printed report.</p>

        <div class="os-made-steps">
          <div class="os-made-step">
            <span class="os-made-n">1</span>
            <div>
              <b>Take the instructions</b>
              <p class="muted tiny">One markdown file. Give it to Claude with your PDF, Word file or past paper and
                ask for the station JSON.</p>
              <button class="btn btn-sm" id="md-get">⬇ Download the instructions</button>
              <span class="os-made-ver muted tiny" id="md-ver"></span>
            </div>
          </div>
          <div class="os-made-step">
            <span class="os-made-n">2</span>
            <div>
              <b>Bring the JSON back here</b>
              <p class="muted tiny">A file from your device, or pasted text. One station or several — every one is
                checked before anything is saved.</p>
              <div class="os-made-acts">
                <button class="btn btn-gold btn-sm" id="md-file">📄 Import a file</button>
                <button class="btn btn-sm" id="md-paste-t">📋 Paste JSON</button>
                <input type="file" id="md-input" accept=".json,application/json" multiple hidden>
              </div>
            </div>
          </div>
          <div class="os-made-step">
            <span class="os-made-n">3</span>
            <div>
              <b>Run it like any other station</b>
              <p class="muted tiny">It appears in the grid below with your name on it. Whoever examines can open the
                tick-sheet; whoever sits it can be marked by the AI.</p>
            </div>
          </div>
        </div>

        <div class="os-made-paste" id="md-paste" hidden>
          <textarea id="md-text" rows="8" spellcheck="false"
            placeholder='Paste the station JSON here — { "topic": … } or [ { … }, { … } ]'></textarea>
          <div class="os-made-acts">
            <button class="btn btn-gold btn-sm" id="md-add">Check and add</button>
            <button class="btn btn-sm" id="md-paste-x">Cancel</button>
          </div>
        </div>

        <div id="md-out" class="os-made-out"></div>
        <div id="md-mine"></div>
      </div>`;

    const out = host.querySelector('#md-out');
    const say = html => { out.innerHTML = html; };

    /* The version line is the point of the editable guide: somebody who
       downloaded it a month ago needs to be able to tell that it moved. */
    guide().then(g => {
      const v = host.querySelector('#md-ver'); if (!v) return;
      v.textContent = '.md · ' + (g.source === 'saved' && g.updated_at
        ? 'updated ' + new Date(g.updated_at).toLocaleDateString()
        : 'the version shipped with the site');
    }).catch(() => {});

    host.querySelector('#md-get').addEventListener('click', async e => {
      const b = e.currentTarget; const was = b.textContent;
      b.disabled = true; b.textContent = 'Fetching…';
      try { download((await guide(true)).md); b.textContent = '✓ Downloaded'; }
      catch (err) { b.textContent = was; say(`<p class="bad">${esc(err.message || err)}</p>`); return; }
      finally { b.disabled = false; }
      setTimeout(() => { b.textContent = was; }, 2500);
    });

    const gate = () => {
      if (user) return true;
      say(`<p class="bad">Sign in first — a created station carries its author's name, so it needs one.</p>`);
      return false;
    };

    const input = host.querySelector('#md-input');
    host.querySelector('#md-file').addEventListener('click', () => { if (gate()) input.click(); });
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []); input.value = '';
      if (!files.length) return;
      say(`<p class="muted">Reading ${files.length} file${files.length === 1 ? '' : 's'}…</p>`);
      const items = [];
      for (const f of files) { try { items.push({ name: f.name, text: await f.text() }); }
        catch (err) { items.push({ name: f.name, text: ' ' }); } }
      await run(items);
    });

    const pasteBox = host.querySelector('#md-paste');
    host.querySelector('#md-paste-t').addEventListener('click', () => {
      if (!gate()) return;
      pasteBox.hidden = !pasteBox.hidden;
      if (!pasteBox.hidden) host.querySelector('#md-text').focus();
    });
    host.querySelector('#md-paste-x').addEventListener('click', () => { pasteBox.hidden = true; });
    host.querySelector('#md-add').addEventListener('click', async () => {
      const ta = host.querySelector('#md-text');
      if (!ta.value.trim()) { say(`<p class="bad">Nothing pasted yet.</p>`); return; }
      const r = await run([{ name: 'Pasted JSON', text: ta.value }]);
      if (r && r.ok) { ta.value = ''; pasteBox.hidden = true; }
    });

    async function run(items) {
      say(`<p class="muted">Checking…</p>`);
      let r;
      try { r = await importAll(items, user); }
      catch (err) { say(`<p class="bad">${esc(err.message || err)}</p>`); return null; }

      if (!r.ok) {
        say(`<div class="os-made-bad">
          <p class="bad"><b>Nothing was imported.</b> ${r.good.length
            ? esc(r.good.length + ' station' + (r.good.length === 1 ? '' : 's') + ' passed, but a batch goes in whole or not at all — fix the rest and try again.')
            : ''}</p>
          ${r.bad.map(b => `<div class="os-made-err"><b>${esc(b.name)}</b><ul>${
            b.errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}
        </div>`);
        return r;
      }
      say(`<p class="good">✓ ${r.done.length} station${r.done.length === 1 ? '' : 's'} added to Created OSCE — ${
        esc(r.done.map(d => d.topic).join(', '))}.</p>`);
      setTimeout(() => { try { onDone && onDone(); } catch {} }, 900);
      return r;
    }

    paintMine(host.querySelector('#md-mine'), user, onDone);
  }

  function closePanel(host) { if (host) host.dataset.made = ''; }

  /* ---------------- your own stations ----------------

     Withdrawal exists because the first version of a station is usually
     wrong and its author is the person who finds out. The delete is
     scoped by RLS to rows this user created inside this bin — the curated
     banks are untouched by it. */

  async function mine(user) {
    if (!user) return [];
    const list = await (typeof OSCE !== 'undefined' ? OSCE.stations() : Promise.resolve([]));
    return (list || []).filter(s => s.collection === COLL() && s.created_by && s.created_by === user.id);
  }

  async function paintMine(host, user, onDone) {
    if (!host || !user) return;
    let rows = [];
    try { rows = await mine(user); } catch { return; }
    if (!rows.length) return;
    host.innerHTML = `
      <details class="os-made-mine">
        <summary>Stations you wrote <i>${rows.length}</i></summary>
        <div class="os-made-rows">${rows.map(s => `
          <div class="os-made-row" data-mine="${esc(s.id)}">
            <span class="os-made-rt">${esc(s.topic || s.id)}</span>
            <span class="muted tiny">${s.q_count || 0} q · ${s.total_marks || 0} marks</span>
            <a class="btn btn-sm" href="#/osce/edit/${encodeURIComponent(s.id)}">Edit</a>
            <button class="btn btn-sm os-made-x" data-drop="${esc(s.id)}">Withdraw</button>
          </div>`).join('')}</div>
        <p class="muted tiny">Withdrawing takes the station out of the bank for everyone. Attempts already sat on it
          are kept — they are yours and the marks stay in your record.</p>
      </details>`;
    host.addEventListener('click', async e => {
      const b = e.target.closest('[data-drop]'); if (!b) return;
      const row = b.closest('.os-made-row');
      if (b.dataset.sure !== '1') {
        b.dataset.sure = '1'; b.textContent = 'Sure? Tap again';
        setTimeout(() => { if (b.dataset.sure === '1') { b.dataset.sure = ''; b.textContent = 'Withdraw'; } }, 4000);
        return;
      }
      b.disabled = true; b.textContent = 'Withdrawing…';
      try {
        await Backend.unpublishOsceStation(b.dataset.drop);
        if (typeof OSCE !== 'undefined') OSCE.bustStations();
        row.remove();
        setTimeout(() => { try { onDone && onDone(); } catch {} }, 400);
      } catch (err) {
        b.disabled = false; b.textContent = 'Withdraw';
        row.insertAdjacentHTML('beforeend', `<span class="bad tiny">${esc(err.message || err)}</span>`);
      }
    });
  }

  return {
    panel, closePanel, validate, normalise, importAll, unpack,
    guide, saveGuide, bustGuide, shipped, download, mine, nameOf,
    collection: COLL, GUIDE_NAME
  };
})();
