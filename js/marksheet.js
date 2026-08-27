/* ============================================================
   marksheet.js — marking a real person, sitting in front of you.

   WHAT THIS IS FOR

   Four candidates in a room, one station, taking turns. One of you holds
   the iPad and examines; the others speak. The scheme is already in the
   app — until now you could only LOOK at it. You had to keep the ticks on
   paper, add them up by hand, and the candidate went home with nothing.

   So: the same scheme, tickable, with the arithmetic done for you and a
   report at the end that the candidate can keep, study from, and compare
   with the AI-marked ones.

   THE DESIGN CONSTRAINT THAT SHAPED EVERYTHING

   You are marking WHILE SOMEBODY IS TALKING. You have one thumb and no
   attention to spare. That rules out a lot:

     · no confirm dialogs, no undo prompts, no "are you sure"
     · one tap per point, cycling covered → partly → missed → unmarked,
       so the common case is a single tap and a mistake is three more
     · the total updates itself; you never do arithmetic
     · nothing is ever lost — the sheet writes itself to this device on
       every tap, so a locked screen or a dropped tab costs nothing
     · and the sheet does NOT scroll away from you: each question is a
       block you can collapse once it is done

   THE ROTATION IS THE POINT

   You examine Nimal, then Kasun, then Dilani. So "Finish & share" ends by
   offering the next candidate on the SAME station with the sheet wiped —
   because in practice the alternative is you navigating back through three
   screens between every candidate while they wait.

   TWO WAYS OUT, AND WHY BOTH

     · Into the chat, to one named person. It arrives as a real attempt
       they can import, so it sits in their own My attempts beside the AI
       ones and prints with the same machinery.
     · As a PDF. For the friend who is not on AUREUM, or the one who wants
       it on paper. With the branding removable, because a study group is
       not an advertisement and a printout doing the rounds of a hospital
       should not have to carry a website address.
   ============================================================ */

const Marksheet = (() => {
  const cfg = () => window.AUREUM_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  /* The three states a point can be in, plus unmarked. Ordered as the tap
     cycles them: the commonest verdict first, so most points take one tap. */
  const STATES = ['covered', 'partial', 'missed', ''];
  const MARK = { covered: '✓', partial: '~', missed: '✗', '': '' };
  const LABEL = { covered: 'Covered', partial: 'Partly said', missed: 'Missed', '': 'Not marked' };
  const CREDIT = { covered: 1, partial: 0.5, missed: 0, '': 0 };
  const next = s => STATES[(STATES.indexOf(s || '') + 1) % STATES.length];

  /* ---------------- the sheet in progress ----------------
     localStorage, not the cloud: it must survive the screen locking
     mid-station, and it must not need a network in a seminar room. One
     sheet per station at a time — you cannot examine two people at once. */
  const KEY = s => 'aureum.marksheet:' + s;
  const load = sid => { try { return JSON.parse(localStorage.getItem(KEY(sid)) || 'null'); } catch { return null; } };
  const save = sh => { try { localStorage.setItem(KEY(sh.station_id), JSON.stringify(sh)); } catch {} };
  const wipe = sid => { try { localStorage.removeItem(KEY(sid)); } catch {} };

  /** Every open sheet, so the OSCE tab can offer to resume one. */
  function openSheets() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('aureum.marksheet:')) {
          const s = load(k.slice('aureum.marksheet:'.length));
          if (s) out.push(s);
        }
      }
    } catch {}
    return out.sort((a, b) => (b.started || 0) - (a.started || 0));
  }

  /* ---------------- the arithmetic ----------------
     The same rule the AI marker is told to use, so a hand-marked station
     and a machine-marked one are on the same scale and can sit in one
     list without a footnote: each point is an equal share of its
     question's marks, covered earns the share, partly earns half, and the
     result is rounded to the nearest half mark. */
  function scoreQuestion(q, marks) {
    const pts = q.marking_points || [];
    if (!pts.length) return { awarded: 0, max: Number(q.marks) || 0, share: 0 };
    const max = Number(q.marks) || 0;
    const share = max / pts.length;
    const got = pts.reduce((n, _, i) => n + share * CREDIT[(marks[String(q.id)] || [])[i] || ''], 0);
    return { awarded: Math.round(got * 2) / 2, max, share };
  }
  function scoreAll(qs, marks) {
    let total = 0, max = 0;
    qs.forEach(q => { const s = scoreQuestion(q, marks); total += s.awarded; max += s.max; });
    total = Math.round(total * 2) / 2;
    return { total, max, percent: max ? Math.round((total / max) * 100) : 0 };
  }
  /** How much of the scheme has been looked at — not how well it went. */
  function progress(qs, marks) {
    let done = 0, all = 0;
    qs.forEach(q => (q.marking_points || []).forEach((_, i) => {
      all++; if (((marks[String(q.id)] || [])[i] || '')) done++;
    }));
    return { done, all };
  }

  /* ================= the sheet ================= */

  async function render(view, stationId, user) {
    view.innerHTML = `<section class="page"><p class="muted">Loading the station…</p></section>`;
    let st;
    try { st = await Backend.getOsceStation(stationId); }
    catch (e) { view.innerHTML = `<section class="page"><p class="bad">${esc(e.message)}</p></section>`; return; }
    if (!st) { view.innerHTML = `<section class="page"><p class="muted">That station is not here.</p></section>`; return; }

    const qs = OSCE.qsOf(st);
    const passMark = OSCE.passOf(st);

    let sheet = load(stationId);
    if (!sheet || sheet.station_id !== stationId) {
      sheet = { station_id: stationId, topic: st.topic, candidate: '', candidateNo: '',
        marks: {}, notes: {}, comment: '', started: Date.now() };
      save(sheet);
    }

    view.innerHTML = `
      <section class="page ms-page">
        <div class="ms-bar">
          <div class="ms-bar-id">
            <span class="ms-kicker">MARKING IN PERSON</span>
            <span class="ms-topic">${esc(st.topic || stationId)}</span>
          </div>
          <div class="ms-score" id="ms-score"></div>
          <div class="ms-bar-acts">
            <button class="btn btn-ghost btn-sm" id="ms-collapse">⇕ Collapse all</button>
            <a class="btn btn-ghost btn-sm" href="#/osce/station/${encodeURIComponent(stationId)}">Leave</a>
          </div>
        </div>

        <div class="ms-who">
          <label class="wl-f"><span>Who are you marking?</span>
            <input type="text" id="ms-name" placeholder="Their name" value="${esc(sheet.candidate)}" autocomplete="off"></label>
          <label class="wl-f"><span>Their user number <em class="muted tiny">(only if you will send it in the chat)</em></span>
            <input type="text" id="ms-no" placeholder="e.g. 10042" value="${esc(sheet.candidateNo)}" inputmode="numeric" autocomplete="off"></label>
        </div>

        <p class="ms-hint">Tap a point to cycle it: <b class="is-covered">✓ covered</b> →
          <b class="is-partial">~ partly</b> → <b class="is-missed">✗ missed</b> → unmarked.
          The total does itself. Everything is saved on this device as you go.</p>

        <div id="ms-qs"></div>

        <div class="ms-foot">
          <label class="wl-f"><span>A comment for the candidate (optional)</span>
            <textarea id="ms-comment" rows="3" placeholder="What to work on before the next one.">${esc(sheet.comment)}</textarea></label>
          <button class="btn btn-gold btn-lg" id="ms-finish">Finish &amp; share →</button>
        </div>
      </section>`;
    FX.viewIn(view);

    const qsHost = view.querySelector('#ms-qs');
    const scoreEl = view.querySelector('#ms-score');

    const nameEl = view.querySelector('#ms-name');
    const noEl = view.querySelector('#ms-no');
    const cmtEl = view.querySelector('#ms-comment');
    nameEl.addEventListener('input', () => { sheet.candidate = nameEl.value; save(sheet); });
    noEl.addEventListener('input', () => { sheet.candidateNo = noEl.value.replace(/\D/g, ''); noEl.value = sheet.candidateNo; save(sheet); });
    cmtEl.addEventListener('input', () => { sheet.comment = cmtEl.value; save(sheet); });

    function paintScore() {
      const s = scoreAll(qs, sheet.marks);
      const p = progress(qs, sheet.marks);
      const pass = s.total >= passMark;
      scoreEl.className = 'ms-score ' + (p.done === 0 ? '' : pass ? 'is-pass' : 'is-fail');
      scoreEl.innerHTML = `<b>${s.total}</b><span>of ${s.max}</span>
        <em>${s.percent}%${p.done < p.all ? ` · ${p.done}/${p.all} points marked` : ''}</em>`;
    }

    /* Each question is its own block, collapsible once it is done, because
       a scheme with sixty points is unusable as one long scroll while
       somebody is speaking. */
    function paintQs() {
      qsHost.innerHTML = qs.map((q, qi) => {
        const s = scoreQuestion(q, sheet.marks);
        const pts = q.marking_points || [];
        const mine = sheet.marks[String(q.id)] || [];
        const done = pts.length && pts.every((_, i) => mine[i]);
        return `
          <div class="ms-q ${done ? 'is-done' : ''}" data-q="${esc(String(q.id))}">
            <button class="ms-q-h" data-fold="${esc(String(q.id))}">
              <span class="ms-q-n">Q${qi + 1}</span>
              <span class="ms-q-p">${esc(q.prompt || '')}</span>
              <span class="ms-q-m"><b>${s.awarded}</b>/${s.max}</span>
              <span class="ms-q-c">${done ? '✓' : '▾'}</span>
            </button>
            <div class="ms-q-body">
              <p class="ms-share muted tiny">${pts.length} point${pts.length === 1 ? '' : 's'} ·
                each worth ${Math.round(s.share * 100) / 100} mark${s.share === 1 ? '' : 's'} ·
                half for partly said</p>
              <ul class="ms-pts">
                ${pts.map((p, i) => {
                  const stt = mine[i] || '';
                  return `<li class="ms-pt is-${stt || 'none'}" data-pt="${esc(String(q.id))}|${i}">
                    <span class="ms-pt-b">${MARK[stt] || '○'}</span>
                    <span class="ms-pt-t">${esc(p)}</span>
                    <span class="ms-pt-s">${LABEL[stt]}</span>
                  </li>`;
                }).join('')}
              </ul>
              <div class="ms-q-all">
                <button class="btn btn-ghost btn-sm" data-all="${esc(String(q.id))}|covered">All covered</button>
                <button class="btn btn-ghost btn-sm" data-all="${esc(String(q.id))}|missed">All missed</button>
                <button class="btn btn-ghost btn-sm" data-all="${esc(String(q.id))}|">Clear</button>
              </div>
              <label class="wl-f"><span>Note on this question (optional)</span>
                <input type="text" data-note="${esc(String(q.id))}" value="${esc(sheet.notes[String(q.id)] || '')}"
                  placeholder="e.g. knew the drug, not the dose"></label>
            </div>
          </div>`;
      }).join('');
      paintScore();
    }

    /* One delegated listener for the whole sheet. With a scheme of sixty
       points, sixty listeners is sixty things to rebuild on every tap. */
    qsHost.addEventListener('click', e => {
      const pt = e.target.closest('[data-pt]');
      if (pt) {
        const [qid, idx] = pt.dataset.pt.split('|');
        const row = sheet.marks[qid] || (sheet.marks[qid] = []);
        row[Number(idx)] = next(row[Number(idx)]);
        save(sheet);
        // repaint just this row and the totals — never the whole sheet,
        // which would scroll away from what the examiner is looking at
        const stt = row[Number(idx)] || '';
        pt.className = 'ms-pt is-' + (stt || 'none');
        pt.querySelector('.ms-pt-b').textContent = MARK[stt] || '○';
        pt.querySelector('.ms-pt-s').textContent = LABEL[stt];
        refreshQ(qid);
        paintScore();
        return;
      }
      const all = e.target.closest('[data-all]');
      if (all) {
        const [qid, want] = all.dataset.all.split('|');
        const q = qs.find(x => String(x.id) === qid);
        sheet.marks[qid] = (q.marking_points || []).map(() => want);
        save(sheet);
        paintQs();
        return;
      }
      const fold = e.target.closest('[data-fold]');
      if (fold) fold.closest('.ms-q').classList.toggle('is-folded');
    });
    qsHost.addEventListener('input', e => {
      const n = e.target.closest('[data-note]');
      if (!n) return;
      sheet.notes[n.dataset.note] = n.value;
      save(sheet);
    });

    function refreshQ(qid) {
      const el = qsHost.querySelector(`.ms-q[data-q="${CSS.escape(qid)}"]`);
      if (!el) return;
      const q = qs.find(x => String(x.id) === qid);
      const s = scoreQuestion(q, sheet.marks);
      el.querySelector('.ms-q-m').innerHTML = `<b>${s.awarded}</b>/${s.max}`;
      const mine = sheet.marks[qid] || [];
      const done = (q.marking_points || []).length && (q.marking_points || []).every((_, i) => mine[i]);
      el.classList.toggle('is-done', !!done);
      el.querySelector('.ms-q-c').textContent = done ? '✓' : '▾';
    }

    view.querySelector('#ms-collapse').addEventListener('click', e => {
      const any = qsHost.querySelector('.ms-q:not(.is-folded)');
      qsHost.querySelectorAll('.ms-q').forEach(x => x.classList.toggle('is-folded', !!any));
      e.target.textContent = any ? '⇕ Open all' : '⇕ Collapse all';
    });

    view.querySelector('#ms-finish').addEventListener('click', () => {
      const p = progress(qs, sheet.marks);
      if (!p.done) { alert('Nothing has been marked yet.'); return; }
      finishModal({ st, qs, sheet, user, view, passMark });
    });

    paintQs();
  }

  /* ================= turning a sheet into an attempt =================
     The SAME shape the AI marker produces, so the existing report page,
     the print sheet and My attempts all work on it without knowing where
     it came from. `source: 'manual'` is the only thing that differs, and
     it exists so the list can say so honestly. */
  function toAttempt({ st, qs, sheet, user, passMark }) {
    const s = scoreAll(qs, sheet.marks);
    return {
      id: rid('om'),
      station_id: st.id,
      station: { topic: st.topic, scenario: st.scenario,
        total_marks: OSCE.marksOf(st), pass_mark: passMark },
      bp: (typeof OsceBlueprint !== 'undefined') ? (OsceBlueprint.tagOf(st) || null) : null,
      questions: qs,
      answers: qs.map(q => ({ id: q.id, transcript: '' })),
      created: Date.now(),
      /* No model, no cost, no recording. A manual attempt that pretended to
         have those would corrupt the billing figures and the averages. */
      source: 'manual',
      examiner: { name: user?.name || '', email: user?.email || '' },
      candidate: { name: sheet.candidate || '', userNo: sheet.candidateNo || '' },
      result: {
        total: s.total, max: s.max, percent: s.percent, pass: s.total >= passMark,
        examinerComment: sheet.comment || '',
        questions: qs.map(q => {
          const sc = scoreQuestion(q, sheet.marks);
          const mine = sheet.marks[String(q.id)] || [];
          return {
            id: q.id, awarded: sc.awarded, max: sc.max, share: sc.share,
            transcript: '',
            comment: sheet.notes[String(q.id)] || '',
            points: (q.marking_points || []).map((p, i) => ({
              point: p, status: mine[i] || 'missed', credit: CREDIT[mine[i] || ''] * sc.share, note: ''
            }))
          };
        }),
        strengths: [], improvements: [], keyLearning: []
      }
    };
  }

  /* ================= finish & share ================= */

  function finishModal({ st, qs, sheet, user, view, passMark }) {
    const attempt = toAttempt({ st, qs, sheet, user, passMark });
    const r = attempt.result;
    document.querySelectorAll('.ms-modal').forEach(m => m.remove());

    const wrap = document.createElement('div');
    wrap.className = 'ms-modal';
    wrap.innerHTML = `
      <div class="ms-modal-back" data-close></div>
      <div class="ms-modal-box" role="dialog" aria-modal="true" aria-label="Finish and share">
        <div class="ms-modal-head">
          <div>
            <p class="kicker">FINISHED</p>
            <h3>${esc(sheet.candidate || 'This candidate')} — ${esc(st.topic || '')}</h3>
          </div>
          <div class="ms-modal-score ${r.pass ? 'is-pass' : 'is-fail'}">
            <b>${r.total}</b><span>of ${r.max} · ${r.percent}%</span>
          </div>
        </div>

        <p class="muted">Send it to them so it lands in their own <strong>My attempts</strong>, or make a PDF for
          somebody who is not on AUREUM. You can do both.</p>

        <div class="ms-share">
          <div class="ms-share-opt">
            <h4>💬 Send it in the chat</h4>
            <p class="muted tiny">Goes to one person as a private message. They import it in one tap and it sits in
              their attempts beside the AI-marked ones.</p>
            <div id="ms-people"><p class="muted tiny">Loading the list…</p></div>
            <p class="ms-msg" id="ms-chat-msg"></p>
          </div>

          <div class="ms-share-opt">
            <h4>🖨 Print or save a PDF</h4>
            <p class="muted tiny">White A4, every point marked covered, partly or missed. From the print sheet you
              can send it to WhatsApp, save it, or open it in another app.</p>
            <label class="ms-plain">
              <input type="checkbox" id="ms-plain"${plainWanted() ? ' checked' : ''}>
              <span>Leave AUREUM off it
                <em class="muted tiny">— no name, no logo, no web address. Just the station and the marks.</em></span>
            </label>
            <button class="btn btn-ghost" id="ms-print">🖨 Print / Save as PDF</button>
          </div>
        </div>

        <div class="ms-modal-foot">
          <button class="btn btn-ghost btn-sm" data-close>Keep marking</button>
          <button class="btn btn-gold" id="ms-next">➡ Next candidate, same station</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const shut = () => { wrap.remove(); window.removeEventListener('hashchange', shut); };
    window.addEventListener('hashchange', shut);
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', shut));

    /* ---- print ---- */
    const plainBox = wrap.querySelector('#ms-plain');
    plainBox.addEventListener('change', () => setPlainWanted(plainBox.checked));
    wrap.querySelector('#ms-print').addEventListener('click', () => printSheet(attempt, plainBox.checked));

    /* ---- the chat ---- */
    (async () => {
      const host = wrap.querySelector('#ms-people');
      const msg = wrap.querySelector('#ms-chat-msg');
      let people = [];
      try { people = (await Backend.listChatPeople?.()) || []; } catch {}
      const me = String(user?.email || '').toLowerCase();
      people = people.filter(p => String(p.id || '').toLowerCase() !== me);
      if (!people.length) {
        host.innerHTML = '<p class="muted tiny">No one else is on this deployment yet, so there is nobody to send it to. The PDF works regardless.</p>';
        return;
      }
      host.innerHTML = `
        <select class="sel" id="ms-to">
          <option value="">— choose who sat it —</option>
          ${people.map(p => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('')}
        </select>
        <button class="btn btn-gold btn-sm" id="ms-send" disabled>Send it</button>`;
      const sel = host.querySelector('#ms-to'), btn = host.querySelector('#ms-send');
      /* Pre-select by name if the examiner typed one — a small thing that
         removes a step from every single candidate in the rotation. */
      if (sheet.candidate) {
        const hit = people.find(p => String(p.name || '').toLowerCase().includes(sheet.candidate.trim().toLowerCase()));
        if (hit) sel.value = hit.id;
      }
      btn.disabled = !sel.value;
      sel.addEventListener('change', () => { btn.disabled = !sel.value; });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        msg.innerHTML = '<span class="muted">Sending…</span>';
        try {
          await sendToChat(attempt, sel.value, people.find(p => p.id === sel.value), user);
          msg.innerHTML = '<span class="good">✓ Sent. They will see it in the chat and can import it in one tap.</span>';
          sel.disabled = true;
        } catch (e) {
          msg.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`;
          btn.disabled = false;
        }
      });
    })();

    /* ---- the rotation ---- */
    wrap.querySelector('#ms-next').addEventListener('click', () => {
      if (!confirm(`Clear the sheet and start on the next candidate?\n\n${sheet.candidate || 'This one'} scored ${r.total}/${r.max}. Make sure you have sent or printed it — it is not kept once cleared.`)) return;
      wipe(st.id);
      shut();
      /* Straight back into a fresh sheet on the same station. The whole
         point of the rotation is that the next person is already waiting. */
      Marksheet.render(view, st.id, user);
      window.scrollTo({ top: 0 });
    });
  }

  const PLAIN_KEY = 'aureum.marksheet.plain';
  const plainWanted = () => { try { return localStorage.getItem(PLAIN_KEY) === '1'; } catch { return false; } };
  const setPlainWanted = v => { try { localStorage.setItem(PLAIN_KEY, v ? '1' : '0'); } catch {} };

  /* ---------------- sending it ----------------
     The attempt travels as a media attachment on an ordinary chat message,
     so it survives the existing chat unchanged: an old client shows the
     message text and ignores the attachment, a current one offers to
     import it. The body is written to be readable on its own, because a
     notification preview is all some people will ever see. */
  async function sendToChat(attempt, toId, person, user) {
    const r = attempt.result;
    let rooms = [];
    try { rooms = (await Backend.listChatRooms?.()) || []; } catch {}
    /* Reuse the direct room if there is one — a new room per station would
       bury the conversation under a pile of one-message threads. */
    let room = rooms.find(x => x.kind === 'direct'
      && (x.member_ids || x.members || []).some(m => String(m.id ?? m) === String(toId)));
    if (!room) {
      room = await Backend.createChatRoom({ title: '', kind: 'direct', memberIds: [toId], myName: user?.name });
    }
    const body = `📋 ${attempt.station.topic} — marked in person.\n`
      + `${r.total} of ${r.max} (${r.percent}%) — ${r.pass ? 'pass' : 'below the pass mark'}.`
      + (r.examinerComment ? `\n\n"${r.examinerComment}"` : '')
      + `\n\nOpen it in AUREUM to import it into your attempts.`;
    await Backend.sendChatMessage(room.id, body, [{
      kind: 'osce-marksheet',
      name: `${attempt.station.topic} — ${r.total}/${r.max}`,
      attempt
    }]);
    return room;
  }

  /* ---------------- importing one ----------------
     Called from the chat when the recipient taps Import. It is THEIR
     attempt from that moment: their id, their store, their report. */
  async function importAttempt(raw) {
    if (!raw || !raw.station || !raw.result) throw new Error('That message does not carry a marksheet.');
    const a = Object.assign({}, raw, {
      id: rid('om'),                     // a fresh id in the receiver's own store
      imported: Date.now(),
      source: 'manual'
    });
    await Backend.saveOsceAttempt(a);
    if (typeof OSCE !== 'undefined') OSCE.bustStations?.();
    return a;
  }

  /* ---------------- the printed sheet ----------------
     White A4. The candidate's copy, and often the only thing they keep. */
  function printSheet(a, plain) {
    const r = a.result || {};
    const P = '.ms-print';
    const styles = `
@page { size: A4 portrait; margin: 15mm 14mm 13mm; }
${P} { color:#111; background:#fff; font-family:"Helvetica Neue",Arial,sans-serif; font-size:10pt; line-height:1.45; }
${P} h1{font-family:Georgia,serif;font-size:19pt;margin:0 0 3px}
${P} h2{font-size:12pt;margin:14px 0 5px;border-left:4px solid #333;padding-left:8px}
${P} .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
  border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}
${P} .who{font-size:10pt;margin:2px 0 0}
${P} .who b{font-size:12pt}
${P} .tot{text-align:right;white-space:nowrap}
${P} .tot b{display:block;font-family:Georgia,serif;font-size:30pt;line-height:1}
${P} .tot span{font-size:9pt}
${P} .verdict{display:inline-block;margin-top:3px;padding:2px 10px;border:1.5px solid #111;
  border-radius:3px;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
${P} .key{display:flex;gap:18px;font-size:8.5pt;margin:0 0 12px;padding:6px 0;
  border-top:1px solid #ccc;border-bottom:1px solid #ccc}
${P} .qh{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin:14px 0 4px}
${P} .qh .qm{font-family:Georgia,serif;white-space:nowrap}
${P} ul{list-style:none;margin:3px 0 0;padding:0}
${P} li{display:flex;gap:8px;padding:2.5px 0;border-bottom:1px dotted #e0e0e0}
${P} li .m{flex:0 0 15px;font-weight:700;text-align:center}
${P} li.miss{color:#555}
${P} li.miss .m{color:#b00}
${P} li.part .m{color:#a06000}
${P} .note{margin:4px 0 0;font-size:9pt;font-style:italic;color:#444}
${P} .cmt{margin:14px 0 0;padding:9px 12px;border:1px solid #bbb;background:#fafafa}
${P} .foot{margin-top:18px;padding-top:6px;border-top:1px solid #ccc;
  display:flex;justify-content:space-between;font-size:7.5pt;color:#777}
${P} .sig{margin-top:20px;display:flex;gap:40px;font-size:9pt}
${P} .sig div{flex:1;border-top:1px solid #999;padding-top:3px}`;

    const when = new Date(a.created || Date.now()).toLocaleDateString('en-GB', { dateStyle: 'medium' });
    const body = `<div class="ms-print">
      <div class="top">
        <div>
          ${plain ? '' : '<p style="font-size:7.5pt;letter-spacing:.2em;text-transform:uppercase;color:#7a5a10;margin:0 0 2px">AUREUM · Pathway to MD</p>'}
          <h1>${esc(a.station?.topic || '')}</h1>
          <p class="who">${a.candidate?.name ? `<b>${esc(a.candidate.name)}</b> · ` : ''}${esc(when)}${
            a.examiner?.name && !plain ? ` · examined by ${esc(a.examiner.name)}` : ''}</p>
        </div>
        <div class="tot">
          <b>${r.total}</b><span>out of ${r.max}${r.max ? ` · ${r.percent}%` : ''}</span>
          <span class="verdict">${r.pass ? 'Pass' : 'Below the pass mark'}</span>
          ${a.station?.pass_mark ? `<span style="display:block;margin-top:3px;font-size:8pt">pass mark ${a.station.pass_mark}</span>` : ''}
        </div>
      </div>

      <div class="key"><span><b>✓</b> covered</span><span><b>~</b> partly said</span>
        <span><b>✗</b> not said</span><span>half credit for a point partly said</span></div>

      ${(r.questions || []).map((qr, i) => {
        const q = (a.questions || []).find(x => String(x.id) === String(qr.id)) || {};
        return `
        <div class="qh"><h2 style="border:0;padding:0;margin:0;font-size:11pt">Q${i + 1}. ${esc(q.prompt || '')}</h2>
          <span class="qm"><b>${qr.awarded}</b> / ${qr.max}</span></div>
        <ul>${(qr.points || []).map(p => {
          const cls = /cover/i.test(p.status) ? '' : /part/i.test(p.status) ? 'part' : 'miss';
          return `<li class="${cls}"><span class="m">${MARK[/cover/i.test(p.status) ? 'covered'
            : /part/i.test(p.status) ? 'partial' : 'missed']}</span><span>${esc(p.point)}</span></li>`;
        }).join('')}</ul>
        ${qr.comment ? `<p class="note">${esc(qr.comment)}</p>` : ''}`;
      }).join('')}

      ${r.examinerComment ? `<div class="cmt"><b>Examiner's comment.</b> ${esc(r.examinerComment)}</div>` : ''}

      <div class="sig"><div>Examiner's signature</div><div>Candidate's signature</div></div>

      <div class="foot">
        <span>${plain ? '' : 'AUREUM · Pathway to MD'}</span>
        <span>Marked in person · ${esc(when)}</span>
      </div>
    </div>`;

    if (typeof OSCE?.openPrintSheet === 'function') return OSCE.openPrintSheet(styles, body);
    const w = document.createElement('div');
    w.innerHTML = `<style>${styles}</style>${body}`;
    document.body.appendChild(w);
    setTimeout(() => { window.print(); setTimeout(() => w.remove(), 800); }, 60);
  }

  return { render, openSheets, wipe, toAttempt, importAttempt, printSheet,
    scoreQuestion, scoreAll, progress, STATES, CREDIT, MARK, next };
})();
