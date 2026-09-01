/* ============================================================
   realstation.js — a live OSCE between two people, on two devices.

   WHAT IT IS

   One of you holds the scheme and marks. The other sits the station on
   their own screen. The examiner sends the scenario, then each question,
   each reveal and each picture as they reach it. The candidate gets
   exactly what a candidate gets in the real thing, and nothing else.

   THE ONE THING IT MUST NEVER DO

   Send the marking points. That is the entire reason this is a push
   rather than "here, open the station on your iPad" — a station page
   shows the scheme, and a candidate who can read the scheme is not
   sitting an examination. So the payload is built from a whitelist of
   fields, never by copying a question and deleting things: a question
   gains a field one day and a delete-list quietly leaks it, whereas a
   copy-list quietly omits it.

   ONE ROW, POLLED

   The whole session is one jsonb row. Not a row per message: a candidate
   who reloads mid-station has to get back everything already sent, and
   one row read gives that in a single round trip. Realtime is subscribed
   where the project has it, but the poll is what it actually runs on —
   so a deployment without realtime loses immediacy and nothing else.

   ROTATION IS THE POINT, AGAIN

   The same reason the marksheet has "next candidate": you examine four
   people on one station. Finishing hands the session back to an invite
   box with the station still loaded, and the candidate who has just
   finished is released to accept somebody else's invitation.
   ============================================================ */

const RealStation = (() => {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rid = () => 'ls-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const POLL_MS = 2500;

  /* invited → accepted → running → finished, plus `left` if the candidate
     stands down before it starts. Written out rather than implied by which
     fields happen to be set, because "is this running" is asked from four
     places and must have one answer. */
  const S = { INVITED: 'invited', ACCEPTED: 'accepted', RUNNING: 'running', FINISHED: 'finished', LEFT: 'left' };
  const live = st => st === S.INVITED || st === S.ACCEPTED || st === S.RUNNING;

  /* ---------------- what a candidate is allowed to see ----------------
     A whitelist, deliberately. See the header. */
  function sendable(kind, q, extra) {
    const base = { at: Date.now(), kind };
    if (kind === 'scenario') return Object.assign(base, { text: extra?.text || '' });
    if (kind === 'question') return Object.assign(base, {
      qid: String(q?.id ?? ''), n: extra?.n || 0,
      text: q?.prompt || '', marks: Number(q?.marks) || 0
    });
    if (kind === 'reveal') return Object.assign(base, {
      qid: String(q?.id ?? ''), n: extra?.n || 0, text: q?.reveal_before || ''
    });
    if (kind === 'image') return Object.assign(base, {
      qid: String(q?.id ?? ''), n: extra?.n || 0,
      url: extra?.url || '', caption: extra?.caption || ''
    });

    /* AFTERWARDS, THE SCHEME IS THE POINT.

       During the station the marking points must never cross. Once it is
       over the opposite is true: the candidate cannot learn anything from
       "you scored 62" and learns everything from seeing which points were
       covered, half-said and never reached, while the examiner talks
       through them. So the same information that was withheld for fifteen
       minutes is handed over deliberately at the end.

       Read-only on their side. Not because a candidate re-ticking their
       own sheet would corrupt anything — the marks live in the examiner's
       device and in the attempt — but because a sheet you can change is a
       sheet you argue with rather than read. */
    if (kind === 'marksheet') return Object.assign(base, {
      total: extra?.total ?? 0, max: extra?.max ?? 0, percent: extra?.percent ?? 0,
      pass: !!extra?.pass, comment: extra?.comment || '',
      questions: extra?.questions || []
    });
    /* The finished attempt, for them to keep. Sent whole because that is
       what My attempts stores — the same object the chat carries today. */
    if (kind === 'result') return Object.assign(base, { attempt: extra?.attempt || null });

    /* AN UNKNOWN KIND SENDS NOTHING.

       This used to `return base`, which quietly turned the whitelist into
       a list of known shapes with a permissive default — the exact thing
       the header says this is not. Nothing leaked, because nothing was
       ever sent under an unlisted kind; but the guarantee was only true
       by accident, and the next feature to add a kind and forget to add a
       case would have found out the hard way. A station now carries a
       role-player brief, which is the answer sheet for the conversation,
       so "unlisted means nothing" has to be true by construction. */
    return null;
  }

  /* ================= the examiner's side ================= */

  async function open({ station, user, candidate }) {
    const row = await Backend.createLiveStation({
      id: rid(), candidate_id: candidate.id, station_id: station.id,
      state: {
        status: S.INVITED,
        topic: station.topic || station.id,
        minutes: OSCE.minsOf(station),
        examinerName: user?.name || 'An examiner',
        candidateName: candidate.name || '',
        candidateNo: candidate.user_no || '',
        sent: [], startedAt: null
      }
    });
    return row;
  }

  const patchState = (row, patch) =>
    Backend.saveLiveStation(row.id, { state: Object.assign({}, row.state, patch) });

  const start = row => patchState(row, { status: S.RUNNING, startedAt: Date.now() });
  const finish = row => patchState(row, { status: S.FINISHED });

  async function send(row, item) {
    /* `sendable` answers null for anything not on the whitelist. Refusing
       here rather than pushing a null keeps the refusal at the one place
       every caller goes through, instead of asking each of them to
       remember to check. */
    if (!item || !item.kind) return row;
    const sent = (row.state?.sent || []).concat([item]);
    return patchState(row, { sent });
  }

  /* Seconds left, from the START TIME rather than from a counter.
     Two devices counting independently drift apart, and an examiner
     whose clock says 40 seconds while the candidate's says 10 has a
     disagreement in the middle of an examination. One number, derived
     on both sides from the same instant. */
  function secondsLeft(state) {
    if (!state?.startedAt) return (state?.minutes || 15) * 60;
    return Math.round((state.minutes || 15) * 60 - (Date.now() - state.startedAt) / 1000);
  }
  const clock = n => {
    const neg = n < 0, a = Math.abs(n);
    return (neg ? '+' : '') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  };

  /* ---------------- following a row ----------------
     Poll, and subscribe as well where realtime exists. Both call the same
     handler, and the handler is idempotent, so a doubled update costs a
     redraw and nothing else. */
  function follow(id, onRow) {
    let stopped = false, last = '';
    const hand = row => {
      if (stopped || !row) return;
      const key = JSON.stringify(row.state || {});
      if (key === last) return;              // nothing moved; do not redraw
      last = key;
      onRow(row);
    };
    const tick = async () => { try { hand(await Backend.getLiveStation(id)); } catch {} };
    tick();
    const t = setInterval(tick, POLL_MS);
    let off = () => {};
    try { off = Backend.watchLiveStation(id, hand) || (() => {}); } catch {}
    return () => { stopped = true; clearInterval(t); try { off(); } catch {} };
  }

  /* ================= the candidate's side (#/osce/real) ================= */

  async function render(view, user) {
    if (!user) {
      view.innerHTML = OSCE.shell('real', `<div class="card" data-animate><h3 class="card-title">Sign in first</h3>
        <p class="muted">A real station is between two named people.</p></div>`);
      FX.viewIn(view); return;
    }
    view.innerHTML = OSCE.shell('real', `<div id="rs-body"><p class="muted">Looking for stations…</p></div>`);
    FX.viewIn(view);
    const body = view.querySelector('#rs-body');

    let rows = [];
    try { rows = await Backend.myLiveStations(); }
    catch (e) { body.innerHTML = `<p class="bad">${esc(e.message || e)}</p>`; return; }

    const mine = rows.filter(r => r.candidate_id === user.id && live(r.state?.status));
    const examining = rows.filter(r => r.examiner_id === user.id && live(r.state?.status));
    const active = mine.find(r => r.state?.status === S.RUNNING || r.state?.status === S.ACCEPTED);

    if (active) { return sitting(view, body, active, user); }

    /* THE INVITATION HAS TO ARRIVE ON ITS OWN.

       The first version drew this list once. So an invitation sent while
       the candidate was already looking at the page never appeared, and
       the only way to see it was to reload — which nobody thinks to do,
       because the page is already open and showing "nothing waiting".

       The station itself polls once it is running; the LIST has to poll
       too, for the same reason and with the same cheapness: it is a
       handful of small rows, and only while this tab is open. */
    watchInbox(view, user, rows);

    body.innerHTML = `
      <header data-animate>
        <p class="kicker">SAT WITH SOMEBODY ELSE EXAMINING</p>
        <h1 class="page-title">Real station</h1>
        <p class="muted">One of you holds the scheme and marks; the other sits the station here. The examiner sends the
          scenario and then each question as they reach it — you see exactly what a candidate sees, and never the
          marking points.</p>
      </header>

      ${mine.length ? `<div class="card" data-animate>
        <h3 class="card-title">📨 Waiting for you</h3>
        <div class="rs-invites">${mine.map(r => `
          <div class="rs-invite" data-inv="${esc(r.id)}">
            <div>
              <b>OSCE by ${esc(r.state?.examinerName || 'an examiner')}</b>
              <p class="muted tiny">${esc(r.state?.topic || '')} · ${r.state?.minutes || 15} minutes</p>
            </div>
            <div class="rs-invite-acts">
              <button class="btn btn-gold btn-sm" data-accept="${esc(r.id)}">Accept</button>
              <button class="btn btn-ghost btn-sm" data-decline="${esc(r.id)}">Decline</button>
            </div>
          </div>`).join('')}</div>
      </div>` : `<div class="card" data-animate>
        <h3 class="card-title">Nothing waiting</h3>
        <p class="muted">When somebody invites you to sit a station, it appears here as a card with their name on it.
          Give them your user number — <strong>${esc(user.userNo || '—')}</strong> — and they can send it.</p>
      </div>`}

      ${examining.length ? `<div class="card" data-animate>
        <h3 class="card-title">✍️ Stations you are examining</h3>
        <div class="rs-invites">${examining.map(r => `
          <div class="rs-invite">
            <div><b>${esc(r.state?.topic || '')}</b>
              <p class="muted tiny">${esc(r.state?.candidateName || 'a candidate')} · ${esc(r.state?.status || '')}</p></div>
            <a class="btn btn-ghost btn-sm" href="#/osce/mark/${encodeURIComponent(r.station_id)}">Open the marking sheet</a>
          </div>`).join('')}</div>
      </div>` : ''}`;

    body.addEventListener('click', async e => {
      const acc = e.target.closest('[data-accept]');
      const dec = e.target.closest('[data-decline]');
      if (!acc && !dec) return;
      const id = (acc || dec).dataset.accept || (acc || dec).dataset.decline;
      (acc || dec).disabled = true;
      try {
        const row = await Backend.getLiveStation(id);
        if (!row) throw new Error('That station is no longer there.');
        await patchState(row, acc
          ? { status: S.ACCEPTED, acceptedAt: Date.now() }
          : { status: S.LEFT, leftAt: Date.now() });
        render(view, user);
      } catch (err) { body.insertAdjacentHTML('beforeend', `<p class="bad">${esc(err.message || err)}</p>`); }
    });
  }

  /* Watching for an invitation while the page is open. Redraws only when
     the set of live sessions actually changes, so a candidate reading the
     page is not fighting a redraw every few seconds. */
  let inboxTimer = null;
  function watchInbox(view, user, rows) {
    clearInterval(inboxTimer);
    const key = list => JSON.stringify((list || [])
      .filter(r => live(r.state?.status))
      .map(r => r.id + ':' + r.state?.status).sort());
    let last = key(rows);
    inboxTimer = setInterval(async () => {
      /* Stop the moment this is no longer the page being looked at —
         a timer that outlives its view is a redraw into somebody else's. */
      if (!document.body.contains(view) || !location.hash.startsWith('#/osce/real')) {
        clearInterval(inboxTimer); inboxTimer = null; return;
      }
      let fresh = [];
      try { fresh = await Backend.myLiveStations(); } catch { return; }
      const k = key(fresh);
      if (k === last) return;
      last = k;
      clearInterval(inboxTimer); inboxTimer = null;
      render(view, user);
      try { navigator.vibrate?.(120); } catch {}
    }, POLL_MS);
  }

  /* ---------------- the candidate, mid-station ----------------
     Deliberately bare: a clock, and what has been sent, newest last so it
     reads downwards like a conversation. Nothing to press except Leave,
     because a candidate with buttons is a candidate not thinking about
     the answer. */
  function sitting(view, body, row, user) {
    let cur = row, timer = null, off = null;

    /* ---------------- recording, on THIS device ----------------

       WHY HERE AND NOT ON THE EXAMINER'S SHEET.

       The candidate is the one speaking, the one holding a phone at
       arm's length, and the one both markings are about. Recording from
       their device is better audio and, more importantly, better
       ownership: the tape is theirs, the AI marking that comes out of it
       is their attempt on their balance, and it lands in their My
       attempts beside the hand marking with nothing to forward.

       Recording it on the examiner's device instead would put somebody
       else's performance into the examiner's account — their mean, their
       coverage map, their revision deck — and every one of those would
       then need an exception. There is no exception here; it is simply
       the candidate's own station, recorded.

       Never automatic. A round nobody pressed record on is a round
       nobody agreed to record. */
    let mic = null, tape = null, recPhase = 'idle', recT0 = 0, kept = false;
    const recSecs = () => recPhase === 'live' ? Math.round((Date.now() - recT0) / 1000) : (tape?.secs || 0);
    const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

    const recHtml = () => {
      if (typeof OSCE === 'undefined') return '';
      if (recPhase === 'live') return `<div class="rs-rec is-live">
        <strong><i class="rs-rec-dot"></i> Recording you</strong>
        <span class="muted tiny" id="rs-rec-t">${mmss(recSecs())}</span>
        <button class="btn btn-ghost btn-sm" id="rs-rec-stop">■ Stop</button>
        <div id="rs-rec-mic" class="rs-rec-mic"></div>
      </div>`;
      if (recPhase === 'done') return `<div class="rs-rec is-done">
        <strong>✓ ${mmss(tape?.secs || 0)} recorded</strong>
        <span class="muted tiny">${kept
          ? `Kept on this device. Send it to AUREUM's marker from <strong>My attempts → Recorded, not yet
             marked</strong> whenever you like — it is safe there even if you close this page.`
          : 'Kept in this page only. Send it for marking before you navigate away.'}</span>
        ${kept ? `<a class="btn btn-ghost btn-sm" href="#/osce/mine">Open My attempts →</a>` : ''}
      </div>`;
      return `<div class="rs-rec">
        <strong>🎙 Record yourself</strong>
        <span class="muted tiny">Optional, and on this device only. Afterwards AUREUM can mark the same answers
          against the same scheme — so you get the examiner's verdict and a second one on the identical
          fifteen minutes.</span>
        <button class="btn btn-ghost btn-sm" id="rs-rec-go">● Start recording</button>
        <p class="rs-rec-msg" id="rs-rec-msg"></p>
        <div id="rs-rec-mic" class="rs-rec-mic"></div>
      </div>`;
    };

    const wireRec = () => {
      body.querySelector('#rs-rec-go')?.addEventListener('click', async e => {
        e.currentTarget.disabled = true;
        mic = OSCE.makeCapture(body.querySelector('#rs-rec-mic'), false);
        let ok = false;
        try { ok = await mic.start(); } catch { ok = false; }
        if (!ok) {
          mic = null;
          const m = body.querySelector('#rs-rec-msg');
          if (m) m.innerHTML = `<span class="bad">The microphone would not open. The station is unaffected —
            the examiner is marking you either way.</span>`;
          const b = body.querySelector('#rs-rec-go'); if (b) b.disabled = false;
          return;
        }
        recPhase = 'live'; recT0 = Date.now();
        paint();
      });
      body.querySelector('#rs-rec-stop')?.addEventListener('click', () => stopRec());
    };

    /**
     * Stop, and WRITE THE TAPE DOWN BEFORE ANYTHING ELSE.
     *
     * THE BUG THIS FIXES, AND IT COST A REAL STATION.
     *
     * The recording lived in a variable on this page and nowhere else.
     * The candidate recorded fifteen minutes, the examiner sent the
     * marking, the candidate tapped "open it" to read it — and that
     * navigation destroyed the only copy. When the examiner then closed
     * the station there was nothing left to offer, and My attempts said
     * there was no recording, because there wasn't one anywhere.
     *
     * A recording that exists only in a variable the next navigation
     * throws away is not a recording. So it goes into the same
     * IndexedDB queue a failed marking uses: it survives navigation, a
     * locked phone, a discarded tab and a reload, and it appears in
     * My attempts under "Recorded, not yet marked" with a Send for
     * marking button — which is the SAME button, the same markCore and
     * the same attempt shape as every other route.
     *
     * The wrap-up screen is now a convenience for somebody who happens
     * to still be on the page, not the only way through.
     */
    async function stopRec() {
      let r = null;
      try { r = await mic?.stop(); } catch {}
      mic = null;
      tape = r?.blob ? r : null;
      recPhase = tape ? 'done' : 'idle';
      paint();
      if (!tape || typeof Pending === 'undefined') return;
      try {
        Pending.setOwner(user?.email || '');
        await Pending.put({
          kind: 'osce', id: 'rs-' + cur.id, title: cur.state?.topic || cur.station_id,
          blob: tape.blob, mime: tape.mime, secs: tape.secs,
          payload: {
            station_id: cur.station_id, answers: {}, choiceKey: '',
            /* Merged onto the attempt when it is finally marked, from
               whichever route marks it. It is what tells the
               side-by-side that this and the examiner's marking are one
               performance. */
            stamp: { sitting: cur.id, examiner: { name: cur.state?.examinerName || '', email: '' } }
          },
          reason: 'Recorded in a live station. Not sent for marking yet.'
        });
        kept = true;
        paint();
      } catch { /* the wrap-up can still offer it from memory */ }
    }

    const paint = () => {
      const s = cur.state || {};
      const running = s.status === S.RUNNING;
      const left = secondsLeft(s);
      const sent = (s.sent || []);
      body.innerHTML = `
        <header data-animate>
          <p class="kicker">REAL STATION · EXAMINED BY ${esc((s.examinerName || '').toUpperCase())}</p>
          <h1 class="page-title">${esc(s.topic || '')}</h1>
        </header>

        <div class="card rs-live" data-animate>
          ${running
            ? `<div class="rs-clock ${left <= 0 ? 'is-out' : left <= 60 ? 'is-low' : ''}">${clock(left)}</div>
               <p class="muted tiny">${left <= 0 ? 'Time is up — the examiner will close the station.' : 'Answer out loud. The examiner is marking as you speak.'}</p>`
            : `<div class="rs-wait"><i></i><i></i><i></i></div>
               <p class="muted">Accepted. Waiting for ${esc(s.examinerName || 'the examiner')} to start the clock.</p>`}
          <button class="btn btn-ghost btn-sm" id="rs-leave">Leave this station</button>
        </div>

        ${recHtml()}

        <div class="card" data-animate>
          <h3 class="card-title">What the examiner has sent</h3>
          ${sent.length ? `<div class="rs-feed">${sent.map(it => item(it)).join('')}</div>`
            : `<p class="muted">Nothing yet. The scenario arrives first.</p>`}
        </div>`;

      wireRec();

      /* Keeping the result. It becomes an ordinary manual attempt through
         the same importer the chat uses, so nothing downstream learns that
         a second delivery route exists. */
      body.querySelectorAll('[data-keep]').forEach(b => b.addEventListener('click', async e => {
        const at = e.currentTarget.dataset.keep;
        const msg = body.querySelector(`[data-keepmsg="${CSS.escape(at)}"]`);
        const it = (cur.state?.sent || []).find(x => String(x.at) === String(at));
        if (!it?.attempt) { msg.innerHTML = '<span class="bad">Nothing to keep.</span>'; return; }
        e.currentTarget.disabled = true; msg.textContent = 'Keeping…';
        try {
          const a = await Marksheet.importAttempt(it.attempt);
          msg.innerHTML = `<span class="good">✓ In your attempts —
            <a class="link" href="#/osce/result/${encodeURIComponent(a.id)}">open it</a></span>`;
        } catch (err) {
          e.currentTarget.disabled = false;
          msg.innerHTML = `<span class="bad">${esc(err.message || err)}</span>`;
        }
      }));

      body.querySelector('#rs-leave').addEventListener('click', async e => {
        const b = e.currentTarget;
        if (b.dataset.sure !== '1') {
          b.dataset.sure = '1'; b.textContent = 'Leave? Tap again';
          setTimeout(() => { if (b.dataset.sure === '1') { b.dataset.sure = ''; b.textContent = 'Leave this station'; } }, 4000);
          return;
        }
        b.disabled = true;
        stop();
        try { await patchState(cur, { status: S.LEFT, leftAt: Date.now() }); } catch {}
        render(view, user);
      });
    };

    const item = it => {
      if (it.kind === 'scenario') return `<div class="rs-it is-scen"><b>The scenario</b><p>${esc(it.text || '')}</p></div>`;
      if (it.kind === 'reveal') return `<div class="rs-it is-rev"><b>New information</b><p>${esc(it.text || '')}</p></div>`;
      if (it.kind === 'image') return `<div class="rs-it is-img"><b>Look at this</b>
        <img src="${esc(it.url)}" alt="${esc(it.caption || 'Image sent by the examiner')}" loading="lazy">
        ${it.caption ? `<p class="muted tiny">${esc(it.caption)}</p>` : ''}</div>`;
      if (it.kind === 'marksheet') return sheetHtml(it);
      if (it.kind === 'result') return `<div class="rs-it is-res">
        <b>Your marks</b>
        <p class="rs-res-score"><strong>${it.attempt?.result?.total ?? '—'}</strong> of
          ${it.attempt?.result?.max ?? '—'} · ${it.attempt?.result?.percent ?? '—'}%</p>
        <p class="muted tiny">Keep it and it joins <strong>Marked in person</strong> under My attempts, with the
          scheme point by point and the printout.</p>
        <button class="btn btn-gold btn-sm" data-keep="${esc(String(it.at))}">Keep it in my attempts</button>
        <span class="rs-keep-msg" data-keepmsg="${esc(String(it.at))}"></span>
      </div>`;
      return `<div class="rs-it is-q"><b>Question ${it.n || ''}${it.marks ? ` · ${it.marks} marks` : ''}</b>
        <p>${esc(it.text || '')}</p></div>`;
    };

    clearInterval(inboxTimer); inboxTimer = null;    // the station supersedes the inbox
    /* The marksheet, as they see it: every point with what it earned, and
       nothing to press. `data-*` attributes and click handlers are simply
       absent rather than disabled — a control that exists and refuses is a
       control somebody keeps pressing. */
    const MARK = { covered: '✓', partial: '~', missed: '✗' };
    const sheetHtml = it => `<div class="rs-it is-sheet">
      <b>The marking sheet</b>
      <p class="rs-sheet-top"><strong>${it.total}</strong> of ${it.max} · ${it.percent}%
        <span class="${it.pass ? 'good' : 'bad'}">${it.pass ? 'Pass' : 'Below the pass mark'}</span></p>
      <p class="muted tiny">Read it while they talk it through. It cannot be changed here — the marks are theirs.</p>
      ${(it.questions || []).map((q, i) => `
        <div class="rs-sq">
          <div class="rs-sq-h"><span>Q${i + 1}</span><p>${esc(q.prompt || '')}</p>
            <b>${q.awarded}/${q.max}</b></div>
          <ul>${(q.points || []).map(p => `
            <li class="is-${esc(p.status || 'missed')}"><i>${MARK[p.status] || '○'}</i>
              <span>${esc(p.point || '')}</span></li>`).join('')}</ul>
          ${q.comment ? `<p class="rs-sq-c">${esc(q.comment)}</p>` : ''}
        </div>`).join('')}
      ${it.comment ? `<div class="rs-sq-c is-final"><b>The examiner's comment</b>${esc(it.comment)}</div>` : ''}
    </div>`;

    const stop = () => {
      clearInterval(timer); timer = null; try { off?.(); } catch {} off = null;
    };

    /* LEAVING THE PAGE STOPS THE RECORDING AND KEEPS IT.

       Not just "stop the microphone". The candidate taps the examiner's
       marking to read it, or checks something in another tab — and if
       leaving merely killed the recorder, the fifteen minutes went with
       it. Stopping THROUGH stopRec() writes the tape to the queue on the
       way out, so the same navigation that used to destroy it now files
       it. */
    window.addEventListener('hashchange', function micOff() {
      window.removeEventListener('hashchange', micOff);
      if (recPhase === 'live') { stopRec(); return; }
      try { mic?.stop(); } catch {}
      mic = null;
    });

    paint();
    /* The clock is redrawn every second from the shared start time; the ROW
       is only re-read on the poll. Redrawing the whole feed once a second
       would fight with the reader scrolling it. */
    timer = setInterval(() => {
      const rt = body.querySelector('#rs-rec-t');
      if (rt) rt.textContent = mmss(recSecs());
      const el = body.querySelector('.rs-clock');
      if (!el || cur.state?.status !== S.RUNNING) return;
      const left = secondsLeft(cur.state);
      el.textContent = clock(left);
      el.classList.toggle('is-low', left > 0 && left <= 60);
      el.classList.toggle('is-out', left <= 0);
    }, 1000);
    off = follow(cur.id, r => {
      const was = cur.state?.status;
      cur = r;
      if (!live(r.state?.status)) {
        stop();
        /* THE STATION IS OVER AND THIS DEVICE HOLDS A TAPE.
           Bouncing back to the inbox would throw it away — the blob only
           exists in this page. So a recorded sitting ends on its own
           wrap-up screen instead, where the recording can be marked. */
        if (recPhase === 'live') {
          /* Through stopRec, so the tape is filed before anything else
             happens to this page. */
          stopRec().then(() => {
            if (tape) wrapUp(view, body, cur, user, tape, kept); else render(view, user);
          });
          return;
        }
        if (tape) { wrapUp(view, body, cur, user, tape, kept); return; }
        render(view, user);
        return;
      }
      /* A new item, or the clock starting, both mean a redraw. */
      paint();
      if (was !== S.RUNNING && r.state?.status === S.RUNNING) { try { navigator.vibrate?.(200); } catch {} }
    });
    window.addEventListener('hashchange', function goodbye() {
      window.removeEventListener('hashchange', goodbye); stop();
    });
  }

  /* ================= after a recorded sitting =================

     The examiner has closed the station and this device is holding the
     only copy of the fifteen minutes. Three things belong here and
     nothing else:

       1. The tape, playable and downloadable, before anything is sent.
       2. AUREUM's marker, against the same scheme, at a price shown
          first — the SAME marking path every other station uses, so
          there is one upload, one queue, one retry and one attempt
          shape in the whole app.
       3. The examiner's marking, if it arrived, and a way to see the
          two side by side.

     The sitting id is the live row's own id. Both devices already have
     it, so nothing has to be negotiated, and it is what lets the
     comparison say "one performance, two markers" rather than leaving
     the reader to assume something that is usually untrue. */

  async function wrapUp(view, body, row, user, tape, kept) {
    const sitting = row.id;
    let st = null;
    try { st = await Backend.getOsceStation(row.station_id); } catch {}

    /* The examiner's verdict, if it came down the wire before the close. */
    const res = (row.state?.sent || []).slice().reverse().find(x => x.kind === 'result' && x.attempt);

    body.innerHTML = `
      <header data-animate>
        <p class="kicker">REAL STATION · FINISHED</p>
        <h1 class="page-title">${esc(row.state?.topic || st?.topic || '')}</h1>
        <p class="muted">Examined by ${esc(row.state?.examinerName || 'your examiner')}. You recorded it, so the
          same fifteen minutes can be marked a second way.</p>
      </header>

      <div class="card rs-wrap-tape" data-animate>
        <h3 class="card-title">🎧 Your recording</h3>
        <audio controls src="${esc(tape.url)}" class="rs-wrap-audio"></audio>
        <p class="muted tiny">${kept
          ? `Saved on this device. Nothing has been uploaded — and if you leave this page it is still there, under
             <strong>My attempts → Recorded, not yet marked</strong>.`
          : `This page holds the only copy — the browser would not keep it. Mark it or download it before you
             navigate away.`}</p>
        <a class="btn btn-ghost btn-sm" href="${esc(tape.url)}"
          download="${esc(String(row.state?.topic || 'station').replace(/[^\w -]/g, ''))}.${esc(tape.ext || 'webm')}">⬇ Download it</a>
      </div>

      ${res ? `<div class="card rs-wrap-hand" data-animate>
        <h3 class="card-title">✍️ ${esc(row.state?.examinerName || 'The examiner')} gave you
          ${res.attempt.result?.percent ?? '—'}%</h3>
        <p class="muted">Keep it first — then AUREUM's marking of the same tape sits beside it instead of
          replacing it.</p>
        <button class="btn btn-gold btn-sm" id="rs-wrap-keep">Keep the examiner's marking</button>
        <span class="rs-keep-msg" id="rs-wrap-keep-msg"></span>
      </div>` : `<div class="card" data-animate>
        <p class="muted">${esc(row.state?.examinerName || 'Your examiner')} has not sent their marking yet. It will
          arrive in the chat — keep it when it does, and it lands beside this one.</p>
      </div>`}

      ${st ? `<div class="card os-markbox" data-animate>
        <h3 class="card-title">✨ Have AUREUM mark the same fifteen minutes</h3>
        <p class="muted">A person marked you in the room. This sends your recording of the <em>same</em> answers to
          AUREUM's marker against the <em>same</em> scheme, so the two verdicts differ only in who was marking —
          and every point they disagree on is one where somebody is being generous.</p>
        <p class="muted tiny">It lands in <strong>Marked by AI</strong> as your own attempt, and is charged to your
          balance. The examiner's marking is untouched.</p>
        <div class="os-src" id="os-src"></div>
        <div id="os-coach-box"></div>
        <div class="os-mark-acts">
          <div class="os-prov" id="os-prov"></div>
          <button class="btn btn-gold btn-lg" id="os-mark">Mark my recording</button>
        </div>
        <p class="os-est" id="os-est"></p>
        <div id="os-mark-out"></div>
        <div id="rs-wrap-done"></div>
      </div>` : `<div class="card"><p class="muted">That station is no longer published, so it cannot be marked
        against its scheme. The recording above is still yours to download.</p></div>`}

      <div class="card" data-animate>
        <a class="btn btn-ghost" href="#/osce/real">← Back to Real station</a>
      </div>`;
    FX.viewIn(view);

    body.querySelector('#rs-wrap-keep')?.addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      const msg = body.querySelector('#rs-wrap-keep-msg');
      msg.textContent = 'Keeping…';
      try {
        const a = await Marksheet.importAttempt(Object.assign({}, res.attempt, { sitting }));
        msg.innerHTML = `<span class="good">✓ In your attempts —
          <a class="link" href="#/osce/result/${encodeURIComponent(a.id)}">open it</a></span>`;
      } catch (err) {
        e.currentTarget.disabled = false;
        msg.innerHTML = `<span class="bad">${esc(err.message || err)}</span>`;
      }
    });

    if (st && body.querySelector('#os-mark')) {
      const rec = Object.assign({}, tape, { secs: tape.secs || Math.round((tape.size || 0) / 3000) });
      /* `ans` is empty and that is correct: this is one unbroken fifteen
         minutes with no per-question segmentation, which is exactly what
         the audio marking path already handles. */
      OSCE.wireMarkControls(body, st, {}, [], rec, { elapsed: tape.secs || null }, null, {
        /* The id the recording was queued under, so marking it here
           clears it from "Recorded, not yet marked" instead of leaving a
           second copy waiting for a marking it has already had. */
        attemptId: kept ? 'rs-' + row.id : null,
        meta: { sitting, examiner: { name: row.state?.examinerName || '', email: '' } },
        onDone: (a) => {
          const done = body.querySelector('#rs-wrap-done');
          if (!done) return;
          const mine = a.result?.percent ?? 0;
          const theirs = res?.attempt?.result?.percent;
          const gap = theirs == null ? null : mine - theirs;
          done.innerHTML = `<div class="rs-wrap-out">
            <p><strong>AUREUM gave ${mine}%.</strong>${theirs == null
              ? ' Keep the examiner\'s marking when it arrives and the two can be compared.'
              : ` ${esc(row.state?.examinerName || 'Your examiner')} gave ${theirs}%${Math.abs(gap) < 1
                  ? ' — the same.'
                  : ` — ${Math.abs(gap)} point${Math.abs(gap) === 1 ? '' : 's'} ${gap > 0 ? 'more generous' : 'harsher'}.`}`}</p>
            <div class="rs-wrap-acts">
              <a class="btn btn-gold btn-sm" href="#/osce/compare/${encodeURIComponent(row.station_id)}">⚡ Put them side by side →</a>
              <a class="btn btn-ghost btn-sm" href="#/osce/result/${encodeURIComponent(a.id)}">Open its report</a>
            </div>
          </div>`;
        }
      });
    }
  }

  return { S, live, open, start, finish, send, sendable, patchState, follow,
    secondsLeft, clock, render };
})();
