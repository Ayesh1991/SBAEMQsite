/* ============================================================
   qedit.js — question corrections, two layers.

   Keyed by questionKey (paperId:kind:number):

   • GLOBAL layer (developer): a flag + explanation override stored in
     `question_edits`, shown to EVERYONE. The developer's word is the
     authoritative correction against the guidelines.
   • PERSONAL layer (every signed-in user): each user's own flag + note
     stored in `user_question_edits`, shown only to that user. Lets any
     candidate mark an answer they think is wrong and jot why, without
     touching anyone else's view.

   So on any question a user sees: the editor's global correction (if
   any) + their own personal one (if any), and gets buttons to manage
   the layer they're allowed to write. The developer writes global; a
   normal user writes personal.

   Mounted by quiz.js (study feedback) and app.js (results review).
   ============================================================ */

const QEdit = (() => {
  let devKnown = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function isDev() {
    if (devKnown !== null) return devKnown;
    try { devKnown = !!(await Backend.currentUser())?.isDeveloper; } catch { devKnown = false; }
    return devKnown;
  }

  async function mount(slot, ctx) {
    if (!slot || !Backend.getQuestionEdit) return;
    const dev = await isDev();

    let glob = null, mine = null;
    try { glob = await Backend.getQuestionEdit(ctx.questionKey); } catch { glob = null; }
    if (!dev) { try { mine = await Backend.getUserQuestionEdit?.(ctx.questionKey); } catch { mine = null; } }

    // The layer the current user edits: developer → global, everyone else → personal.
    const save = dev
      ? (patch => Backend.saveQuestionEdit(ctx.questionKey, patch))
      : (patch => Backend.saveUserQuestionEdit(ctx.questionKey, patch));
    const current = () => dev ? glob : mine;

    function banners() {
      let h = '';
      if (glob && glob.flagged) h += `<div class="qedit-flag">⚑ <strong>Flagged for review</strong>${glob.flag_note ? ' — ' + esc(glob.flag_note) : ' — this answer may not match current guidance.'}</div>`;
      if (glob && glob.explanation) h += `<div class="qedit-correction">✎ <strong>Editor's correction:</strong> ${esc(glob.explanation)}</div>`;
      if (!dev && mine && mine.flagged) h += `<div class="qedit-flag qedit-mine">⚑ <strong>You flagged this</strong>${mine.flag_note ? ' — ' + esc(mine.flag_note) : '.'}</div>`;
      if (!dev && mine && mine.explanation) h += `<div class="qedit-correction qedit-mine">✎ <strong>Your note:</strong> ${esc(mine.explanation)}</div>`;
      return h;
    }

    function paint() {
      const c = current();
      slot.innerHTML = `
        ${banners()}
        <div class="qedit-actions">
          <button class="btn btn-ghost btn-sm" data-qe="flag">${c && c.flagged ? '⚑ Edit flag' : '⚑ Flag this question as wrong'}</button>
          <button class="btn btn-ghost btn-sm" data-qe="expl">${c && c.explanation ? '✎ Edit explanation' : '✎ Add explanation'}</button>
          <span class="qedit-tag ${dev ? '' : 'qedit-tag-me'}">${dev ? 'developer · everyone sees this' : 'flags go to the editor for review — scrutiny keeps the bank sharp'}</span>
        </div>
        <div class="qedit-editor" id="qedit-editor"></div>`;
      wire();
    }

    function wire() {
      slot.querySelector('[data-qe="flag"]').addEventListener('click', openFlag);
      slot.querySelector('[data-qe="expl"]').addEventListener('click', openExpl);
    }

    function refresh(rec) { if (dev) glob = rec; else mine = rec; }

    function openFlag() {
      const host = slot.querySelector('#qedit-editor');
      if (host.dataset.open === 'flag') { host.dataset.open = ''; host.innerHTML = ''; return; }
      host.dataset.open = 'flag';
      const c = current();
      host.innerHTML = `
        <div class="qedit-box">
          <label class="qedit-check"><input type="checkbox" id="qe-flag-on" ${c && c.flagged ? 'checked' : ''}> Mark this question's answer as wrong / disputed</label>
          <textarea id="qe-flag-note" placeholder="Why is it wrong? Cite the guideline, e.g. 'NICE NG133 says labetalol is first-line'. Your flag goes straight to the question editor — and the question is held out of mocks until it's fixed.">${esc(c && c.flag_note || '')}</textarea>
          <div class="qedit-btns">
            <button class="btn btn-gold btn-sm" id="qe-flag-save">Save flag</button>
            <button class="btn btn-ghost btn-sm" id="qe-flag-cancel">Cancel</button>
          </div>
        </div>`;
      host.querySelector('#qe-flag-save').addEventListener('click', async () => {
        const flagged = host.querySelector('#qe-flag-on').checked;
        const flag_note = host.querySelector('#qe-flag-note').value.trim();
        try { refresh(await save({ flagged, flag_note })); } catch (e) { alert('Could not save: ' + (e.message || e)); return; }
        host.dataset.open = ''; paint();
      });
      host.querySelector('#qe-flag-cancel').addEventListener('click', () => { host.dataset.open = ''; host.innerHTML = ''; });
    }

    function openExpl() {
      const host = slot.querySelector('#qedit-editor');
      if (host.dataset.open === 'expl') { host.dataset.open = ''; host.innerHTML = ''; return; }
      host.dataset.open = 'expl';
      const c = current();
      const seed = (c && c.explanation) || ctx.rationale || '';
      host.innerHTML = `
        <div class="qedit-box">
          <label class="qedit-label">${dev ? 'Corrected / improved explanation (shown to everyone)' : 'Your explanation / note (private to you)'}</label>
          <textarea id="qe-expl" class="qedit-expl" placeholder="Write the explanation…">${esc(seed)}</textarea>
          <div class="qedit-btns">
            <button class="btn btn-gold btn-sm" id="qe-expl-save">Save explanation</button>
            ${c && c.explanation ? '<button class="btn btn-ghost btn-sm" id="qe-expl-clear">Remove</button>' : ''}
            <button class="btn btn-ghost btn-sm" id="qe-expl-cancel">Cancel</button>
          </div>
        </div>`;
      host.querySelector('#qe-expl-save').addEventListener('click', async () => {
        const explanation = host.querySelector('#qe-expl').value.trim();
        try { refresh(await save({ explanation })); } catch (e) { alert('Could not save: ' + (e.message || e)); return; }
        host.dataset.open = ''; paint();
      });
      host.querySelector('#qe-expl-clear')?.addEventListener('click', async () => {
        try { refresh(await save({ explanation: '' })); } catch {}
        host.dataset.open = ''; paint();
      });
      host.querySelector('#qe-expl-cancel').addEventListener('click', () => { host.dataset.open = ''; host.innerHTML = ''; });
    }

    paint();
  }

  return { mount };
})();
