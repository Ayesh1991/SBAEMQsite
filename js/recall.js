/* ============================================================
   recall.js — the points you did not reach, brought back.

   THE IDEA

   Every OSCE attempt already records, in the marking scheme's own
   wording, which points were covered, half-said and never reached. That
   is a list of exactly what this candidate does not know, written by an
   examiner, in the language the real exam marks in. It is the most
   valuable study material in the app and until now it was read once, on
   the report page, and never again.

   Recall turns it into a queue. A point you missed comes back tomorrow,
   then in three days, then in a week, then in a fortnight — and stops
   coming back when you have it. Nothing is authored, nothing is
   generated, nothing costs a token: it is a query over data that is
   already there.

   WHY IT IS NOT FLASHCARDS

   A flashcard is a fact with a hole in it. This is a real question from
   a real station with one marking point you did not reach, and the ask
   is the same ask the exam makes: say it out loud. The card shows the
   scenario and the question first. Only after you have answered does it
   show the point you missed. That ordering is the whole difference
   between recall practice and re-reading.

   THE SCHEDULE IS EVIDENCE-LED, NOT SELF-REPORTED

   Two things can promote a card, and they are not equal:

     • You grade yourself "I had it" — cheap, and people are generous.
     • You SAT THE STATION AGAIN and the marker recorded that point as
       covered — expensive, and it is proof.

   The second retires a card outright, without asking. A self-grade only
   moves it along one box. So the deck drains fastest by going back and
   re-sitting the station, which is also the thing that actually helps.

   BUILT ONCE, TOPPED UP AFTER

   Reading every attempt in full on every visit would be tens of
   requests on a phone. So the deck is built once, kept, and topped up
   from attempts newer than the last scan. The review state lives with
   the card, so a rebuild never loses a schedule.
   ============================================================ */

const Recall = (() => {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400e3;

  /* Leitner intervals in days. Box 0 is "today, again"; box 5 is a month
     out, which is about as far ahead as an exam course makes sense over.
     A card that survives box 5 is retired rather than pushed to a year. */
  const BOXES = [0, 1, 3, 7, 16, 35];
  const LAST_BOX = BOXES.length - 1;

  const keyFor = user => 'aureum.recall.' + String(user?.email || user?.id || 'anon').toLowerCase();
  /* WHO THE LAST DECK BELONGED TO.
     The OSCE tab strip wants a due-count and is built synchronously, but
     `Backend.currentUser()` is a promise — awaiting it would make every
     OSCE page wait on a badge. So the owner of the deck is written down
     whenever one is read or written, and the badge reads that. It is a
     cache of an identity, never an authority on one: nothing is shown
     from it but a number, and a stale pointer shows a stale number for
     one page load and is then corrected. */
  const WHO = 'aureum.recall.who';
  const readState = user => {
    try {
      const k = keyFor(user);
      localStorage.setItem(WHO, k);
      return JSON.parse(localStorage.getItem(k) || '{}');
    } catch { return {}; }
  };
  const writeState = (user, s) => {
    try { localStorage.setItem(keyFor(user), JSON.stringify(s)); localStorage.setItem(WHO, keyFor(user)); } catch {}
  };
  /** The number for the tab badge. Synchronous, and never throws. */
  function dueNow() {
    try {
      const k = localStorage.getItem(WHO);
      if (!k) return 0;
      return counts(JSON.parse(localStorage.getItem(k) || '{}')).due;
    } catch { return 0; }
  }

  /* The identity of a card. A point is the same point across every
     attempt at that station, so the wording is normalised — an editor
     fixing a typo in a marking point must not fork the card and lose its
     history. */
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cardKey = (stationId, point) => String(stationId || '') + '|' + norm(point).slice(0, 120);

  /* ---------------- building the deck ----------------

     One pass over the attempts that have appeared since the last scan.
     Every marking point in every marked question is looked at, and the
     card is moved by the LATEST evidence about it — which is why the
     attempts are walked oldest first. */

  async function build(user, opts = {}) {
    const state = readState(user);
    const cards = state.cards || {};
    let list = [];
    try { list = (await Backend.listOsceAttempts()) || []; } catch { return state; }

    const since = opts.full ? 0 : (state.scanned || 0);
    const fresh = list
      .filter(a => (a.created || 0) > since)
      .sort((a, b) => (a.created || 0) - (b.created || 0));
    if (!fresh.length) return state;

    for (const row of fresh) {
      let a = null;
      try { a = await Backend.getOsceAttempt(row.id); } catch { continue; }
      if (!a) continue;
      absorb(cards, a);
    }
    state.cards = cards;
    state.scanned = Math.max(state.scanned || 0, ...fresh.map(a => a.created || 0));
    state.built = Date.now();
    writeState(user, state);
    return state;
  }

  /**
   * Fold one attempt into the deck.
   *
   * Exported because the report page calls it the moment a station is
   * marked: waiting for the next visit to Recall would mean the card you
   * most want tomorrow is the one card that is not there.
   */
  function absorb(cards, a) {
    const stationId = a.station_id || a.station?.id || '';
    const topic = a.station?.topic || '';
    const when = a.created || Date.now();
    const bp = a.bp || null;
    const qs = a.questions || [];
    (a.result?.questions || []).forEach((mq, qi) => {
      const q = (typeof OSCE !== 'undefined' ? OSCE.questionFor(qs, mq.id, qi) : (qs[qi] || {})) || {};
      const prompt = String(mq.prompt || q.prompt || '').trim();
      (mq.points || []).forEach(p => {
        const text = String(p?.point || '').trim();
        if (!text) return;
        // a heading is never a marking point and is never worth revising
        if (typeof OSCE !== 'undefined' && OSCE.isHeading(text)) return;
        const status = String(p?.status || '').toLowerCase();
        const k = cardKey(stationId, text);
        const c = cards[k] || {
          key: k, station: stationId, topic, bp, qid: String(mq.id ?? q.id ?? ''), prompt,
          point: text, first: when, box: 0, due: when, seen: 0, missed: 0, covered: 0
        };
        // the newest attempt owns the wording and the question it hangs off
        c.topic = topic || c.topic;
        c.bp = bp || c.bp;
        if (prompt) c.prompt = prompt;
        c.point = text;
        c.last = when;

        if (/^cover/.test(status)) {
          c.covered = (c.covered || 0) + 1;
          /* PROOF, NOT A CLAIM.
             Covering it in a real marked attempt is the evidence a
             self-grade only approximates, so it retires the card
             outright rather than nudging it one box. */
          c.retired = when;
          c.box = LAST_BOX;
          c.due = when + BOXES[LAST_BOX] * DAY;
        } else {
          c.missed = (c.missed || 0) + 1;
          c.partial = /^part/.test(status);
          /* Missing it again undoes whatever the self-grading had
             claimed. This is the only place a retired card comes back,
             and it should: the evidence changed. */
          delete c.retired;
          c.box = 0;
          c.due = when;
        }
        cards[k] = c;
      });
    });
    return cards;
  }

  /* ---------------- the queue ---------------- */

  const alive = c => !c.retired;
  function due(state, now = Date.now()) {
    return Object.values(state.cards || {})
      .filter(c => alive(c) && (c.due || 0) <= now)
      /* Oldest debt first, then the ones missed most often — a point you
         have now failed three times is the one worth the next minute. */
      .sort((a, b) => (b.missed || 0) - (a.missed || 0) || (a.due || 0) - (b.due || 0));
  }
  function counts(state, now = Date.now()) {
    const all = Object.values(state.cards || {});
    const live = all.filter(alive);
    return {
      total: all.length,
      live: live.length,
      due: live.filter(c => (c.due || 0) <= now).length,
      retired: all.length - live.length,
      soon: live.filter(c => (c.due || 0) > now && (c.due || 0) <= now + 3 * DAY).length
    };
  }

  /** Which modules the debt is concentrated in — feeds the Progress tab. */
  function byModule(state) {
    const out = {};
    Object.values(state.cards || {}).filter(alive).forEach(c => {
      const k = c.bp || 'untagged';
      (out[k] = out[k] || { id: k, due: 0, live: 0 }).live++;
      if ((c.due || 0) <= Date.now()) out[k].due++;
    });
    return Object.values(out).sort((a, b) => b.due - a.due || b.live - a.live);
  }

  /**
   * Record a self-grade. `how` is 'had' | 'half' | 'no', which are the
   * same three the marking scheme uses, deliberately — a candidate who
   * has to translate their own answer into a different vocabulary grades
   * it worse.
   */
  function grade(user, key, how) {
    const state = readState(user);
    const c = (state.cards || {})[key];
    if (!c) return state;
    const now = Date.now();
    c.seen = (c.seen || 0) + 1;
    c.graded = now;
    if (how === 'had') {
      c.box = Math.min(LAST_BOX, (c.box || 0) + 1);
      /* A self-grade never retires a card. Only re-sitting the station
         does, because only that has an examiner behind it. The most a
         run of honest "I had it"s can do is push it a month out. */
      if (c.box >= LAST_BOX) c.rested = now;
    } else if (how === 'half') {
      c.box = Math.max(0, Math.min(LAST_BOX, (c.box || 0)));
    } else {
      c.box = 0;
    }
    c.due = now + BOXES[c.box] * DAY + (how === 'had' ? 0 : 60e3);
    writeState(user, state);
    return state;
  }

  /** Put a card back in circulation by hand. */
  function revive(user, key) {
    const state = readState(user);
    const c = (state.cards || {})[key];
    if (!c) return state;
    delete c.retired; delete c.rested;
    c.box = 0; c.due = Date.now();
    writeState(user, state);
    return state;
  }

  function forget(user, key) {
    const state = readState(user);
    if (state.cards) delete state.cards[key];
    writeState(user, state);
    return state;
  }

  /* Called from the report the moment a station is marked, so tomorrow's
     deck already knows about today's station. */
  function noteAttempt(user, attempt) {
    if (!user || !attempt) return;
    const state = readState(user);
    state.cards = absorb(state.cards || {}, attempt);
    state.scanned = Math.max(state.scanned || 0, attempt.created || 0);
    writeState(user, state);
  }

  /* ================= the page ================= */

  async function render(view, user) {
    view.innerHTML = OSCE.shell('recall', `
      <header class="page-head" data-animate>
        <p class="kicker">RECALL</p>
        <h1 class="page-title">The points you did not reach</h1>
        <p class="muted">Every marking point an examiner recorded as missed, in the scheme's own words, brought back on
          a widening schedule until you have it. Nothing here was written for you — it is what you have already been
          marked down for.</p>
      </header>
      <div class="card" data-animate><p class="muted">Reading your attempts…</p></div>`);
    FX.viewIn(view);

    let state = readState(user);
    const first = !state.built;
    if (first) {
      view.querySelector('.card').innerHTML =
        `<p class="muted">Building the deck from every station you have sat. This happens once.</p>`;
    }
    state = await build(user, { full: first });
    paint(view, user, state);
  }

  function paint(view, user, state) {
    const c = counts(state);
    const list = due(state);
    const host = view.querySelector('.page');
    const body = document.createElement('div');

    if (!c.total) {
      body.innerHTML = `<div class="card rc-empty" data-animate>
        <h3 class="card-title">Nothing to bring back yet</h3>
        <p class="muted">This fills itself from your marked attempts. Sit a station, have it marked, and every point
          the examiner recorded as missed appears here the same day — with the question it came from, so you answer
          it out loud rather than reading it.</p>
        <a class="btn btn-gold" href="#/osce">Open the station bank →</a>
      </div>`;
    } else if (!list.length) {
      const next = Object.values(state.cards).filter(x => !x.retired).sort((a, b) => (a.due || 0) - (b.due || 0))[0];
      body.innerHTML = `<div class="card rc-clear" data-animate>
        <h3 class="card-title">✓ Nothing due</h3>
        <p class="muted">${c.live
          ? `${c.live} point${c.live === 1 ? '' : 's'} still in circulation${next
              ? `, the next on ${esc(new Date(next.due).toLocaleDateString('en-GB', { dateStyle: 'medium' }))}` : ''}.`
          : 'Every point you have missed has come back covered in a later attempt.'}</p>
        ${statsHtml(c)}
        <p class="muted tiny">A deck with nothing due is not a deck with nothing left. Sitting the station again is
          what actually retires a point — a self-grade only pushes it further out.</p>
      </div>`;
    } else {
      body.innerHTML = `
        <div class="card rc-run" data-animate>
          <div class="rc-head">
            <div><strong id="rc-left">${list.length}</strong><span>due now</span></div>
            <div><strong>${c.live}</strong><span>in circulation</span></div>
            <div><strong>${c.retired}</strong><span>retired by a later attempt</span></div>
          </div>
          <div class="rc-bar"><i id="rc-bar" style="width:0%"></i></div>
          <div id="rc-card"></div>
        </div>
        ${statsHtml(c)}`;
    }
    host.querySelectorAll('.rc-run, .rc-empty, .rc-clear, .rc-stats').forEach(n => n.remove());
    host.append(...body.childNodes);
    FX.viewIn(view);
    if (list.length) runDeck(view, user, list.slice(), list.length);
  }

  const statsHtml = c => `<div class="card rc-stats" data-animate>
    <h3 class="card-title">Where the deck stands</h3>
    <p class="muted tiny">A point retires when a later marked attempt records it as covered. That is the only thing
      that retires one, because it is the only evidence with an examiner behind it.</p>
    <div class="rc-stat-grid">
      <div><strong>${c.total}</strong><span>points ever missed</span></div>
      <div><strong>${c.live}</strong><span>still to get</span></div>
      <div><strong>${c.due}</strong><span>due now</span></div>
      <div><strong>${c.soon}</strong><span>due within 3 days</span></div>
    </div>
  </div>`;

  /* ---------------- one card at a time ----------------
     The question first, alone. The point is hidden behind a press,
     because a point on screen while you are still thinking is a point
     you have read rather than recalled — which is the entire difference
     between this working and not. */
  function runDeck(view, user, queue, total) {
    const host = view.querySelector('#rc-card');
    const bar = view.querySelector('#rc-bar');
    const left = view.querySelector('#rc-left');
    if (!host) return;

    const step = () => {
      const done = total - queue.length;
      if (bar) bar.style.width = Math.round((done / total) * 100) + '%';
      if (left) left.textContent = String(queue.length);
      const c = queue.shift();
      if (!c) {
        host.innerHTML = `<div class="rc-done">
          <p><strong>✓ That is the queue.</strong> ${total} point${total === 1 ? '' : 's'} back through.</p>
          <p class="muted tiny">The ones you did not have are back tomorrow. The ones you did are a few days out.
            Re-sit the station and they go for good.</p>
          <a class="btn btn-ghost btn-sm" href="#/osce/recall">Check again</a>
        </div>`;
        return;
      }
      host.innerHTML = `
        <div class="rc-q">
          <div class="rc-meta">
            <a class="rc-topic" href="#/osce/station/${encodeURIComponent(c.station)}">${esc(c.topic || 'A station')}</a>
            ${c.missed > 1 ? `<span class="rc-miss">missed ${c.missed}×</span>` : ''}
            ${c.partial ? `<span class="rc-part">half-said last time</span>` : ''}
          </div>
          <p class="rc-prompt">${esc(c.prompt || 'This question was not recorded — the point is below.')}</p>
          <p class="muted tiny">Answer it out loud, as you would in the room. Then see the point you missed.</p>
          <button class="btn btn-gold" id="rc-show">Show the point I missed</button>
          <div id="rc-answer" hidden>
            <div class="rc-point"><span>✗</span><p>${esc(c.point)}</p></div>
            <p class="muted tiny">Did you say it?</p>
            <div class="rc-grades">
              <button class="btn btn-ghost btn-sm" data-g="no">✗ No</button>
              <button class="btn btn-ghost btn-sm" data-g="half">~ Half of it</button>
              <button class="btn btn-ghost btn-sm" data-g="had">✓ I had it</button>
            </div>
            <div class="rc-side">
              <a class="link tiny" href="#/osce/station/${encodeURIComponent(c.station)}">Sit this station again — that is what retires it →</a>
              <button class="link tiny" id="rc-drop" type="button">Stop showing me this point</button>
            </div>
          </div>
        </div>`;
      host.querySelector('#rc-show').addEventListener('click', e => {
        e.target.hidden = true;
        host.querySelector('#rc-answer').hidden = false;
      });
      host.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
        grade(user, c.key, b.dataset.g);
        step();
      }));
      host.querySelector('#rc-drop').addEventListener('click', () => {
        forget(user, c.key);
        step();
      });
    };
    step();
  }

  return { render, build, absorb, due, counts, byModule, grade, revive, forget,
    noteAttempt, dueNow, cardKey, BOXES, __read: readState, __write: writeState };
})();
