/* ============================================================
   qedit.js — question corrections.

   Two things live here, both keyed by questionKey (paperId:kind:number):

   • A "flag this answer as wrong" control + an editable explanation
     override, available to the DEVELOPER only.
   • The resulting banner + editor's correction, shown to EVERYONE
     (so candidates see when the developer has flagged/annotated a
     question against the guidelines).

   Persistence goes through Backend.getQuestionEdit / saveQuestionEdit.
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
    let edit = null;
    try { edit = await Backend.getQuestionEdit(ctx.questionKey); } catch { edit = null; }

    function paint() {
      slot.innerHTML = `
        ${edit && edit.flagged ? `<div class="qedit-flag">⚑ <strong>Flagged for review</strong>${edit.flag_note ? ' — ' + esc(edit.flag_note) : ' — this answer may not match current guidance.'}</div>` : ''}
        ${edit && edit.explanation ? `<div class="qedit-correction">✎ <strong>Editor's correction:</strong> ${esc(edit.explanation)}</div>` : ''}
        ${dev ? `
          <div class="qedit-actions">
            <button class="btn btn-ghost btn-sm" data-qe="flag">${edit && edit.flagged ? '⚑ Edit flag' : '⚑ Flag answer as wrong'}</button>
            <button class="btn btn-ghost btn-sm" data-qe="expl">${edit && edit.explanation ? '✎ Edit explanation' : '✎ Edit / add explanation'}</button>
            <span class="qedit-tag">developer</span>
          </div>
          <div class="qedit-editor" id="qedit-editor"></div>` : ''}`;
      if (dev) wire();
    }

    function wire() {
      slot.querySelector('[data-qe="flag"]').addEventListener('click', () => openFlag());
      slot.querySelector('[data-qe="expl"]').addEventListener('click', () => openExpl());
    }

    function openFlag() {
      const host = slot.querySelector('#qedit-editor');
      if (host.dataset.open === 'flag') { host.dataset.open = ''; host.innerHTML = ''; return; }
      host.dataset.open = 'flag';
      host.innerHTML = `
        <div class="qedit-box">
          <label class="qedit-check"><input type="checkbox" id="qe-flag-on" ${edit && edit.flagged ? 'checked' : ''}> Mark this question's answer as wrong / disputed</label>
          <textarea id="qe-flag-note" placeholder="Why is it wrong? Cite the guideline, e.g. 'NICE NG133 says labetalol is first-line'.">${esc(edit && edit.flag_note || '')}</textarea>
          <div class="qedit-btns">
            <button class="btn btn-gold btn-sm" id="qe-flag-save">Save flag</button>
            <button class="btn btn-ghost btn-sm" id="qe-flag-cancel">Cancel</button>
          </div>
        </div>`;
      host.querySelector('#qe-flag-save').addEventListener('click', async () => {
        const flagged = host.querySelector('#qe-flag-on').checked;
        const flag_note = host.querySelector('#qe-flag-note').value.trim();
        try { edit = await Backend.saveQuestionEdit(ctx.questionKey, { flagged, flag_note }); } catch (e) { alert('Could not save: ' + (e.message || e)); return; }
        host.dataset.open = ''; paint();
      });
      host.querySelector('#qe-flag-cancel').addEventListener('click', () => { host.dataset.open = ''; host.innerHTML = ''; });
    }

    function openExpl() {
      const host = slot.querySelector('#qedit-editor');
      if (host.dataset.open === 'expl') { host.dataset.open = ''; host.innerHTML = ''; return; }
      host.dataset.open = 'expl';
      const current = (edit && edit.explanation) || ctx.rationale || '';
      host.innerHTML = `
        <div class="qedit-box">
          <label class="qedit-label">Corrected / improved explanation (shown to everyone under the answer)</label>
          <textarea id="qe-expl" class="qedit-expl" placeholder="Write the correct explanation…">${esc(current)}</textarea>
          <div class="qedit-btns">
            <button class="btn btn-gold btn-sm" id="qe-expl-save">Save explanation</button>
            ${edit && edit.explanation ? '<button class="btn btn-ghost btn-sm" id="qe-expl-clear">Remove</button>' : ''}
            <button class="btn btn-ghost btn-sm" id="qe-expl-cancel">Cancel</button>
          </div>
        </div>`;
      host.querySelector('#qe-expl-save').addEventListener('click', async () => {
        const explanation = host.querySelector('#qe-expl').value.trim();
        try { edit = await Backend.saveQuestionEdit(ctx.questionKey, { explanation }); } catch (e) { alert('Could not save: ' + (e.message || e)); return; }
        host.dataset.open = ''; paint();
      });
      host.querySelector('#qe-expl-clear')?.addEventListener('click', async () => {
        try { edit = await Backend.saveQuestionEdit(ctx.questionKey, { explanation: '' }); } catch {}
        host.dataset.open = ''; paint();
      });
      host.querySelector('#qe-expl-cancel').addEventListener('click', () => { host.dataset.open = ''; host.innerHTML = ''; });
    }

    paint();
  }

  return { mount };
})();
