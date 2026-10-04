/* ============================================================
   grouppaper.js — a paper the group sits together.

   One person sets it from the blueprint, names a time, and everybody sits
   the SAME questions at that time, alone. Afterwards the group sees
   everyone's marks beside each other, which is the whole reason for doing
   it together rather than each on their own.

   THE WHOLE DIFFICULTY IS FAIRNESS, and it is one sentence: a paper that
   can be opened early is not an assessment. So the question list is not
   held on the row the group can read. It is a separate table behind a
   policy that compares the clock to the start time, and asking early does
   not return an empty list to be filtered — the rows never leave the
   database. A countdown in the browser is a countdown anybody can skip
   with a console open.

   WHAT THIS DOES NOT DO is mark anything itself. The questions are the
   bank's, the sitting is quiz.js, the marking is quiz.js. This module sets
   the paper, opens it at the right moment, and puts the marks side by
   side.
   ============================================================ */

const GroupPaper = (() => {

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* A paper has three states and they are not a detail: each one is a
     different page with a different button on it. */
  const stateOf = g => {
    const start = new Date(g.starts_at).getTime();
    const end = start + (Number(g.minutes) || 60) * 60000;
    const now = Date.now();
    if (now < start) return 'upcoming';
    if (now < end) return 'open';
    return 'closed';
  };
  const whenText = g => {
    const d = new Date(g.starts_at);
    return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit' });
  };
  /* "In 3 days" is what somebody actually wants to know; the date is for
     writing in a diary. Both are shown. */
  function countdown(g) {
    const ms = new Date(g.starts_at).getTime() - Date.now();
    if (ms <= 0) return '';
    const m = Math.round(ms / 60000);
    if (m < 60) return `in ${m} minute${m === 1 ? '' : 's'}`;
    const h = Math.round(m / 60);
    if (h < 48) return `in ${h} hour${h === 1 ? '' : 's'}`;
    return `in ${Math.round(h / 24)} days`;
  }

  /**
   * Turn the stored question keys back into questions.
   *
   * The plan is a list of `paperId:KIND:number` and nothing else — it has
   * to be, or the plan itself would be a copy of the questions sitting in
   * a table the group can read the moment it exists.
   */
  async function resolve(qkeys) {
    const byPaper = {};
    qkeys.forEach(k => {
      const [pid, kind, num] = String(k).split(':');
      (byPaper[pid] || (byPaper[pid] = [])).push({ k, kind, num: Number(num) });
    });
    const found = {};
    for (const pid of Object.keys(byPaper)) {
      let loaded; try { loaded = await Data.loadPaper(pid); } catch { continue; }
      ['SBA', 'EMQ', 'TF'].forEach(kind => Data.flatten(loaded.paper, kind)
        .forEach(q => { found[`${pid}:${kind}:${q.number}`] = q; }));
    }
    /* Kept in the plan's order, so everyone sits the same paper in the
       same order and a question missing from the bank simply drops out
       rather than shifting everything after it. */
    return qkeys.map(k => found[k]).filter(Boolean);
  }

  /** Build a plan from the blueprint — the same engine the daily mock uses. */
  async function planFromBlueprint(count) {
    const bp = await Blueprint.load();
    if (!((bp?.sba || []).length || (bp?.emq || []).length)) {
      throw new Error('This course has no blueprint yet, so there is nothing to sample from.');
    }
    const index = await Simulator.buildIndex();
    if (!index.length) throw new Error('There are no questions in this course’s bank yet.');
    const hist = await Simulator.loadHistory().catch(() => ({ seen: [], bucketAgg: {} }));
    /* The paper shape is scaled to the asked-for length, so "a 20-question
       paper" is 20 and not whatever the blueprint says a real one is. */
    const want = Math.max(5, Math.min(100, Number(count) || 20));
    const scale = want / Math.max(1, (bp.paper.sbaCount || 30) + (bp.paper.emqCount || 30));
    const shaped = { ...bp, paper: { ...bp.paper,
      sbaCount: Math.max(1, Math.round((bp.paper.sbaCount || 30) * scale)),
      emqCount: Math.max(0, Math.round((bp.paper.emqCount || 30) * scale)) } };
    const plan = Simulator.select(shaped, index, hist, null);
    return [...plan.sbaRecs, ...plan.emqRecs].map(r => r.qkey).slice(0, want);
  }

  /* ---------------- the group's papers ---------------- */

  /* `embedded` since v128: mounted as a TAB on the group's page, which has
     already named the group in its own <h1>. A second page-title inside it
     is two headings claiming to be the heading. */
  async function renderList(view, roomId, user, roomTitle, embedded) {
    view.innerHTML = `<section class="page narrow"><p class="muted">Loading…</p></section>`;
    let papers = [];
    try { papers = (await Backend.listGroupPapers(roomId)) || []; }
    catch (e) {
      view.innerHTML = `<section class="page narrow"><p class="bad">${esc(e.message || e)}</p></section>`;
      return;
    }
    view.innerHTML = `
      <section class="${embedded ? 'gp-embed' : 'page narrow'}" data-animate>
        <header>
          ${embedded ? '' : `<p class="kicker">GROUP · ${esc(roomTitle || 'Your group')}</p>`}
          <${embedded ? 'h2' : 'h1'} class="${embedded ? 'gp-head-title' : 'page-title'}">Papers you sit together</${embedded ? 'h2' : 'h1'}>
          <p class="muted">One person sets a paper from the blueprint and names a time. Everybody sits the same
            questions at that time, on their own — and then the marks go side by side.</p>
        </header>
        <div class="gp-new card">
          <h3 class="card-title">Set a paper</h3>
          <div class="gp-form">
            <label class="field"><span>What to call it</span>
              <input type="text" class="sel" id="gp-title" placeholder="Saturday mock"></label>
            <label class="field"><span>How many questions</span>
              <input type="number" class="sel" id="gp-n" value="20" min="5" max="100"></label>
            <label class="field"><span>Starts</span>
              <input type="datetime-local" class="sel" id="gp-when"></label>
            <label class="field"><span>Minutes allowed</span>
              <input type="number" class="sel" id="gp-min" value="30" min="5" max="240"></label>
          </div>
          <p class="muted tiny">The questions are drawn from this course's blueprint when you set it, and stay
            sealed until the clock reaches the start time — for you as well as for everybody else.</p>
          <button class="btn btn-gold" id="gp-go">Set the paper</button>
          <p class="dev-row-msg" id="gp-msg"></p>
        </div>
        <div id="gp-list"></div>
      </section>`;
    FX.viewIn(view);

    /* Default to an hour from now, rounded — the common case is "later
       today" and nobody should have to type a date for that. */
    const soon = new Date(Date.now() + 3600000);
    soon.setMinutes(0, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    view.querySelector('#gp-when').value =
      `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;

    view.querySelector('#gp-go').addEventListener('click', async e => {
      const msg = view.querySelector('#gp-msg');
      const title = view.querySelector('#gp-title').value.trim();
      const when = view.querySelector('#gp-when').value;
      if (!title) { msg.textContent = 'Give it a name so people know what they are turning up for.'; msg.className = 'dev-row-msg bad'; return; }
      if (!when) { msg.textContent = 'Say when it starts.'; msg.className = 'dev-row-msg bad'; return; }
      e.currentTarget.disabled = true;
      msg.textContent = 'Drawing the questions…'; msg.className = 'dev-row-msg muted';
      try {
        const qkeys = await planFromBlueprint(view.querySelector('#gp-n').value);
        await Backend.createGroupPaper({ roomId, title, startsAt: new Date(when).toISOString(),
          minutes: Number(view.querySelector('#gp-min').value) || 30, qkeys });
        msg.textContent = `✓ Set — ${qkeys.length} questions, sealed until ${whenText({ starts_at: when })}.`;
        msg.className = 'dev-row-msg good';
        setTimeout(() => renderList(view, roomId, user, roomTitle), 800);
      } catch (err) {
        msg.textContent = err.message || String(err); msg.className = 'dev-row-msg bad';
        e.currentTarget.disabled = false;
      }
    });

    const host = view.querySelector('#gp-list');
    if (!papers.length) {
      host.innerHTML = `<p class="muted" style="margin-top:22px">No papers yet. Set the first one above.</p>`;
      return;
    }
    host.innerHTML = papers.map(g => {
      const st = stateOf(g);
      return `
      <div class="card gp-card" data-gp="${esc(g.id)}">
        <div class="gp-card-top">
          <span class="gp-state is-${st}">${st === 'upcoming' ? 'Not open yet' : st === 'open' ? 'Open now' : 'Closed'}</span>
          <span class="muted tiny">${esc(whenText(g))} · ${g.minutes} min</span>
        </div>
        <h3>${esc(g.title)}</h3>
        ${st === 'upcoming' ? `<p class="muted tiny">Starts ${esc(countdown(g))}. The questions are sealed until then.</p>`
          : `<a class="btn ${st === 'open' ? 'btn-gold' : 'btn-ghost'} btn-sm" href="#/group/${encodeURIComponent(roomId)}/paper/${encodeURIComponent(g.id)}">${
              st === 'open' ? 'Sit it now →' : 'See the marks →'}</a>`}
        <div class="gp-board" data-board="${esc(g.id)}"></div>
      </div>`;
    }).join('');

    /* The board under each paper. Loaded after the cards so a slow read
       never delays the list itself. */
    for (const g of papers) {
      const board = host.querySelector(`[data-board="${CSS.escape(g.id)}"]`);
      if (!board || stateOf(g) === 'upcoming') continue;
      try {
        const rows = (await Backend.listGroupAttempts(g.id)) || [];
        board.innerHTML = rows.length ? `
          <table class="gp-table"><tbody>
            ${rows.map((r, i) => `<tr${r.user_id === user.id ? ' class="is-me"' : ''}>
              <td class="gp-rank">${i + 1}</td>
              <td>${esc(r.name)}</td>
              <td class="gp-pc"><strong>${Math.round(r.percent)}%</strong> <span class="muted tiny">${r.score}/${r.total}</span></td>
            </tr>`).join('')}
          </tbody></table>` : `<p class="muted tiny">Nobody has sat it yet.</p>`;
      } catch { board.innerHTML = ''; }
    }
  }

  /* ---------------- sitting it ---------------- */

  async function renderSit(view, roomId, paperId, user) {
    view.innerHTML = `<section class="page narrow"><p class="muted">Opening the paper…</p></section>`;
    let papers = [], g = null;
    try { papers = (await Backend.listGroupPapers(roomId)) || []; } catch {}
    g = papers.find(p => p.id === paperId);
    if (!g) {
      view.innerHTML = `<section class="page narrow"><p class="bad">That paper is not in this group.</p>
        <a class="btn btn-ghost" href="#/group/${encodeURIComponent(roomId)}">← Back</a></section>`;
      return;
    }
    const st = stateOf(g);
    const mine = ((await Backend.listGroupAttempts(paperId).catch(() => [])) || [])
      .find(a => a.user_id === user.id);

    /* ALREADY SAT, OR CLOSED, OR NOT OPEN — three endings, and each one
       says which it is rather than showing a disabled button. */
    if (st === 'upcoming') {
      view.innerHTML = `<section class="page narrow" data-animate>
        <header><p class="kicker">GROUP PAPER</p><h1 class="page-title">${esc(g.title)}</h1></header>
        <div class="card"><p class="muted">This paper opens ${esc(countdown(g))}, at ${esc(whenText(g))}.
          The questions are sealed until then — nobody in the group can see them, including whoever set it.</p>
        <a class="btn btn-ghost" href="#/group/${encodeURIComponent(roomId)}">← Back to the group</a></div>
      </section>`;
      FX.viewIn(view); return;
    }
    if (mine || st === 'closed') {
      return renderMarks(view, roomId, g, user, mine);
    }

    let questions = [];
    try {
      const qkeys = await Backend.getGroupPaperPlan(paperId);
      questions = await resolve(qkeys);
    } catch (e) {
      view.innerHTML = `<section class="page narrow"><p class="bad">${esc(e.message || e)}</p>
        <a class="btn btn-ghost" href="#/group/${encodeURIComponent(roomId)}">← Back</a></section>`;
      return;
    }
    if (!questions.length) {
      view.innerHTML = `<section class="page narrow"><div class="card">
        <p class="muted">None of this paper's questions could be loaded — they may have been unpublished
          since it was set.</p></div>
        <a class="btn btn-ghost" href="#/group/${encodeURIComponent(roomId)}">← Back</a></section>`;
      return;
    }

    const loaded = {
      meta: { id: 'group-' + paperId, title: g.title, categoryId: null, topicId: null },
      paper: { topic: g.title },
      path: { category: { title: 'Group paper' }, topic: null }
    };
    view.innerHTML = '';
    Quiz.start(view, loaded, questions.map((q, i) => ({ ...q, number: i + 1 })), {
      mode: 'exam', kind: 'MIX', sessionKey: null, simulator: true,
      timeLimitMinutes: Number(g.minutes) || 30,
      onFinish: async attempt => {
        const total = attempt.detail.filter(d => !d.excluded).length;
        const score = attempt.detail.filter(d => !d.excluded && d.isCorrect).length;
        try {
          await Backend.saveGroupAttempt(paperId, { score, total,
            percent: total ? Math.round(score / total * 10000) / 100 : 0, detail: attempt.detail });
        } catch { /* the mark is shown either way; losing it is not worth losing the page */ }
        location.hash = `#/group/${encodeURIComponent(roomId)}/paper/${encodeURIComponent(paperId)}`;
      },
      onQuit: () => { location.hash = `#/group/${encodeURIComponent(roomId)}`; }
    });
  }

  async function renderMarks(view, roomId, g, user, mine) {
    let rows = [];
    try { rows = (await Backend.listGroupAttempts(g.id)) || []; } catch {}
    const me = rows.findIndex(r => r.user_id === user.id);
    view.innerHTML = `
      <section class="page narrow" data-animate>
        <header>
          <p class="kicker">GROUP PAPER · ${stateOf(g) === 'closed' ? 'CLOSED' : 'OPEN'}</p>
          <h1 class="page-title">${esc(g.title)}</h1>
          ${mine ? `<p class="muted">You scored <strong>${Math.round(mine.percent)}%</strong>
            (${mine.score}/${mine.total})${me >= 0 ? ` · ${me + 1} of ${rows.length}` : ''}.</p>`
            : `<p class="muted">You did not sit this one.</p>`}
        </header>
        <div class="card">
          <h3 class="card-title">The group</h3>
          ${rows.length ? `<table class="gp-table"><tbody>
            ${rows.map((r, i) => `<tr${r.user_id === user.id ? ' class="is-me"' : ''}>
              <td class="gp-rank">${i + 1}</td><td>${esc(r.name)}</td>
              <td class="gp-pc"><strong>${Math.round(r.percent)}%</strong>
                <span class="muted tiny">${r.score}/${r.total}</span></td></tr>`).join('')}
          </tbody></table>` : `<p class="muted">Nobody has sat it yet.</p>`}
        </div>
        <a class="btn btn-ghost" href="#/group/${encodeURIComponent(roomId)}">← Back to the group</a>
      </section>`;
    FX.viewIn(view);
  }

  return { renderList, renderSit, stateOf, resolve, planFromBlueprint };
})();
