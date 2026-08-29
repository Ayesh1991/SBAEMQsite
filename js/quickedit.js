/* ============================================================
   quickedit.js — fixing a marking point where you are reading it.

   THE PROBLEM

   You are mid-revision, looking at an OSCE scheme or a case's expected
   items, and you see a typo, a dose that has changed, a point that says
   "MgSO4" where it should say the loading dose. Until now that meant:
   remember it, leave the page, find the station in the editor, find the
   question, find the point, fix it, come back, lose your place. Most of
   the time you simply did not bother — which is how a bank of two hundred
   stations slowly fills with small wrongnesses that everyone has noticed
   and nobody has fixed.

   So: a pencil beside every marking point, wherever it is shown. Click it,
   the line becomes an input. Press Enter and you are asked, once, whether
   to save. Escape abandons it. Nothing is written without that yes.

   WHY A CONFIRM RATHER THAN A SILENT SAVE

   These are SHARED documents. One person's slip of the finger changes the
   scheme every other candidate is marked against, and the marking is not
   re-run — a station sat tomorrow is marked against whatever is there
   tomorrow. An edit to shared marking material should take one deliberate
   extra press, and it does.

   WHY IT DOES NOT REPLACE THE EDITOR

   The full editor still exists and is still where you add questions,
   reorder points, attach images or change the marks. This is for the small
   correction that would otherwise never get made.

   HOW A HOST WIRES IT UP

     QuickEdit.attach(container, {
       load:  async () => the whole document,
       save:  async doc => persist it,
       find:  (doc, ref) => ({ get(), set(v) })   // where this text lives
     })

   Every element carrying `data-qe` inside `container` becomes editable.
   The `data-qe` value is the ref handed back to `find`. The host owns the
   document shape; this file owns the interaction and nothing else.
   ============================================================ */

const QuickEdit = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** The pencil. Put this inside anything that should become editable. */
  const pencil = (ref, title) =>
    `<button class="qe-pen" data-qe="${esc(ref)}" title="${esc(title || 'Edit this line')}"
       aria-label="${esc(title || 'Edit this line')}">✎</button>`;

  let openOne = null;          // only ever one line in edit at a time

  /**
   * Make every `[data-qe]` inside `host` editable.
   * @param {Element} host
   * @param {{load:Function, save:Function, find:Function, onSaved?:Function, can?:Function}} api
   */
  function attach(host, api) {
    if (!host || !api?.load || !api?.save || !api?.find) return () => {};
    const onClick = async e => {
      const pen = e.target.closest('[data-qe]');
      if (!pen || !host.contains(pen)) return;
      e.preventDefault(); e.stopPropagation();
      if (api.can && !api.can()) return;
      begin(pen, api);
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  }

  /* The line being edited is whatever the pencil sits inside. Taking the
     pencil's parent rather than a named class keeps this usable in the
     scheme modal, the report, the case page and the examiner's copy
     without four different selectors to keep in step. */
  function lineOf(pen) {
    return pen.closest('[data-qe-line]') || pen.parentElement;
  }

  async function begin(pen, api) {
    if (openOne) cancel(openOne);
    const line = lineOf(pen);
    if (!line || line.querySelector('.qe-input')) return;

    const ref = pen.dataset.qe;
    let doc, slot;
    try {
      doc = await api.load();
      slot = api.find(doc, ref);
      if (!slot) throw new Error('That line could not be found in the document.');
    } catch (err) { flash(line, err.message || String(err), true); return; }

    const before = slot.get();
    const held = line.innerHTML;
    const state = { line, held, pen, api, ref, before };
    openOne = state;

    line.classList.add('qe-editing');
    line.innerHTML = `<textarea class="qe-input" rows="2" spellcheck="false"></textarea>
      <span class="qe-hint">Enter to save · Shift+Enter for a new line · Esc to leave it alone</span>`;
    const box = line.querySelector('.qe-input');
    box.value = before;
    autoGrow(box);
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);

    box.addEventListener('input', () => autoGrow(box));
    /* stopPropagation as well as preventDefault, and it matters: the scheme
       dialog this usually sits inside has its own document-level Escape
       handler, so without it one Escape cancelled the edit AND closed the
       whole scheme behind it — you lost your place to undo a typo. Escape
       belongs to the innermost thing that is open. */
    box.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(state); return; }
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); confirmSave(state, box.value); }
    });
    /* Clicking away is NOT a save and NOT a discard — it keeps the box
       open. Losing an edit to a stray tap on the page behind would be the
       worst of the three outcomes. */
  }

  function autoGrow(box) {
    box.style.height = 'auto';
    box.style.height = Math.min(260, box.scrollHeight + 2) + 'px';
  }

  function cancel(state) {
    if (!state) return;
    state.line.classList.remove('qe-editing');
    state.line.innerHTML = state.held;
    if (openOne === state) openOne = null;
  }

  /** The one deliberate extra press. */
  async function confirmSave(state, next) {
    const clean = String(next == null ? '' : next).replace(/\s+/g, ' ').trim();
    if (!clean) { flash(state.line, 'A marking point cannot be blank. Escape to leave it as it was.', true); return; }
    if (clean === String(state.before).trim()) { cancel(state); return; }

    const yes = await ask(clean, state.before);
    if (!yes) return;                       // the box stays open, nothing written

    const line = state.line;
    line.innerHTML = `<span class="qe-saving">Saving…</span>`;
    try {
      const doc = await state.api.load();
      const slot = state.api.find(doc, state.ref);
      if (!slot) throw new Error('That line has moved — reload and try again.');
      slot.set(clean);
      await state.api.save(doc);
      openOne = null;
      line.classList.remove('qe-editing');
      line.innerHTML = `<span class="qe-text">${esc(clean)}</span>${pencil(state.ref)}`;
      flash(line, 'Saved', false);
      try { state.api.onSaved?.(clean, state.ref, doc); } catch {}
    } catch (err) {
      line.classList.remove('qe-editing');
      line.innerHTML = state.held;
      openOne = null;
      flash(line, err.message || String(err), true);
    }
  }

  /* A real dialog rather than window.confirm: the point of asking is that
     you can SEE what you are about to change, and confirm() cannot show
     two lines of text side by side. */
  function ask(next, before) {
    return new Promise(res => {
      const w = document.createElement('div');
      w.className = 'qe-ask';
      w.innerHTML = `
        <div class="qe-ask-box" role="dialog" aria-modal="true" aria-label="Save this change?">
          <h3>Do you want to save the changes?</h3>
          <p class="qe-ask-l">Now</p><p class="qe-ask-was">${esc(before)}</p>
          <p class="qe-ask-l">After</p><p class="qe-ask-new">${esc(next)}</p>
          <p class="qe-ask-note">This scheme is shared. Everyone marked against it from now on gets this wording.</p>
          <div class="qe-ask-acts">
            <button class="btn btn-ghost btn-sm" data-no>No</button>
            <button class="btn btn-gold btn-sm" data-yes>Yes, save it</button>
          </div>
        </div>`;
      document.body.appendChild(w);
      const done = v => { try { w.remove(); } catch {} document.removeEventListener('keydown', key, true); res(v); };
      /* Capture phase, and swallowed: the confirm sits on top of everything,
         so nothing underneath may see its Escape or its Enter. */
      const key = e => {
        if (e.key !== 'Escape' && e.key !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        done(e.key === 'Enter');
      };
      w.querySelector('[data-yes]').addEventListener('click', () => done(true));
      w.querySelector('[data-no]').addEventListener('click', () => done(false));
      w.addEventListener('click', e => { if (e.target === w) done(false); });
      document.addEventListener('keydown', key, true);
      w.querySelector('[data-yes]').focus();
    });
  }

  function flash(line, msg, isBad) {
    const el = document.createElement('span');
    el.className = 'qe-flash ' + (isBad ? 'is-bad' : 'is-good');
    el.textContent = msg;
    line.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch {} }, isBad ? 5200 : 1700);
  }

  /* ---------------- the two documents this is used on ----------------
     Kept here rather than in each caller so the ref format has exactly one
     definition. An OSCE point is "q:<questionId>:<index>"; a case's
     expected item is "p:<phaseId>:<index>", and a viva must-hit is
     "m:<questionIndex>:<index>". */

  const osceRef = (qid, i) => `q:${qid}:${i}`;
  const caseRef = (phaseId, i) => `p:${phaseId}:${i}`;
  const mustRef = (qi, i) => `m:${qi}:${i}`;

  /** Where an OSCE marking point lives inside a station. */
  function osceFind(station, ref) {
    const [kind, qid, idx] = String(ref).split(':');
    if (kind !== 'q') return null;
    const q = (station.questions || []).find(x => String(x.id) === String(qid));
    const i = Number(idx);
    if (!q || !Array.isArray(q.marking_points) || !(i >= 0 && i < q.marking_points.length)) return null;
    return { get: () => q.marking_points[i], set: v => { q.marking_points[i] = v; } };
  }

  /** Where a case's expected item or must-hit lives. */
  function caseFind(doc, ref) {
    const [kind, a, b] = String(ref).split(':');
    const i = Number(b);
    if (kind === 'p') {
      const p = (doc.phases || []).find(x => String(x.id) === String(a));
      if (!p || !Array.isArray(p.expect) || !(i >= 0 && i < p.expect.length)) return null;
      return { get: () => p.expect[i], set: v => { p.expect[i] = v; } };
    }
    if (kind === 'm') {
      const q = (doc.questions || [])[Number(a)];
      if (!q || !Array.isArray(q.mustHit) || !(i >= 0 && i < q.mustHit.length)) return null;
      return { get: () => q.mustHit[i], set: v => { q.mustHit[i] = v; } };
    }
    return null;
  }

  /* ================================================================
     STRUCTURE — adding, removing and moving points.

     `attach` above rewrites the TEXT of a line that already exists. That
     was the whole of the inline editor, and it stopped exactly where an
     examiner actually needs it: a scheme with a point missing, or with
     sixty points and no sections, could only be fixed by leaving for the
     full editor and losing your place.

     These operate on the ARRAY rather than on one slot, so they need a
     different hook from `find` — `list`, which hands back the array and
     the index the ref points at.

     Every one of them re-reads the document, changes it, saves it, and
     asks the caller to REDRAW. None of them patches the DOM: adding or
     removing a point renumbers every point after it, and every pencil on
     screen carries its number. Patching in place is how you end up
     editing point five and saving point six.
     ================================================================ */

  function attachOps(host, api, opts) {
    if (!host || !api?.load || !api?.save) return () => {};
    const list = api.list || defaultList;
    const redraw = opts?.redraw || (() => {});

    const onClick = async e => {
      const add = e.target.closest('[data-qe-add]');
      const del = e.target.closest('[data-qe-del]');
      const mov = e.target.closest('[data-qe-move]');
      const btn = add || del || mov;
      if (!btn || !host.contains(btn)) return;
      e.preventDefault(); e.stopPropagation();
      if (api.can && !api.can()) return;
      if (btn.disabled) return;

      /* Removing is the only one that cannot be undone by doing it again,
         so it is the only one that asks. Adding and moving are their own
         undo. */
      if (del && btn.dataset.sure !== '1') {
        btn.dataset.sure = '1'; btn.classList.add('is-sure'); btn.textContent = '✕?';
        btn.title = 'Tap again to remove this point';
        setTimeout(() => { if (btn.dataset.sure === '1') {
          btn.dataset.sure = ''; btn.classList.remove('is-sure'); btn.textContent = '✕';
          btn.title = 'Remove'; } }, 4000);
        return;
      }

      const was = btn.textContent;
      btn.disabled = true; btn.textContent = '…';
      try {
        const doc = await api.load();
        if (add) {
          const [qid, kind] = String(add.dataset.qeAdd).split('|');
          const slot = list(doc, 'q:' + qid + ':0');
          if (!slot) throw new Error('That question could not be found.');
          slot.arr.push(kind === 'head' ? '# New section' : 'New marking point');
        } else if (del) {
          const [dq, di] = String(del.dataset.qeDel).split('|');
          const slot = list(doc, 'q:' + dq + ':' + di);
          if (!slot) throw new Error('That point could not be found.');
          if (slot.arr.length <= 1) throw new Error('A question needs at least one marking point.');
          slot.arr.splice(slot.i, 1);
        } else {
          const [qid, idx, dir] = String(mov.dataset.qeMove).split('|');
          const slot = list(doc, 'q:' + qid + ':' + idx);
          if (!slot) throw new Error('That point could not be found.');
          const to = slot.i + Number(dir);
          if (to < 0 || to >= slot.arr.length) { btn.disabled = false; btn.textContent = was; return; }
          const [x] = slot.arr.splice(slot.i, 1);
          slot.arr.splice(to, 0, x);
        }
        await api.save(doc);
        try { api.onSaved?.(); } catch {}
        await redraw();
      } catch (err) {
        btn.disabled = false; btn.textContent = was;
        flash(btn.closest('li') || btn.parentElement || btn, err.message || String(err), true);
      }
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  }

  /** The array a `q:<id>:<i>` ref lives in, and where in it. */
  function defaultList(station, ref) {
    const [kind, qid, idx] = String(ref).split(':');
    if (kind !== 'q') return null;
    const q = (station.questions || []).find(x => String(x.id) === String(qid));
    if (!q) return null;
    if (!Array.isArray(q.marking_points)) q.marking_points = [];
    return { arr: q.marking_points, i: Number(idx), q };
  }

  return { attach, attachOps, pencil, osceRef, caseRef, mustRef, osceFind, caseFind, defaultList };
})();
