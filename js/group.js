/* group.js — ONE PLACE FOR A GROUP.
 *
 * Until v128 a group was spread over three unrelated surfaces: its chat was
 * in a dock you opened from a button, its wall was a strip on the Studio
 * wall that only the POPPED-OUT copy ever drew, and its papers were at
 * #/group/<id>. Three places, none of which mentioned the other two, and
 * the one most people looked at — the full-page Studio wall — had no way
 * to reach a group at all.
 *
 * So a group now has a page. The same wall, the same chat, the same files
 * and the same papers, addressed to the group and reached from one set of
 * tabs. Nothing here is a new store: every tab mounts the surface that
 * already owned that job, because a second implementation of the wall is a
 * second thing to keep in step with the first.
 *
 * `Group`, not `GroupPaper` — that is the module that sits a paper, and it
 * is mounted by the Papers tab below.
 */
const Group = (() => {
  'use strict';

  const TABS = [
    { id: 'wall', label: '🧱 Wall' },
    { id: 'chat', label: '💬 Chat' },
    { id: 'files', label: '📎 Files' },
    { id: 'papers', label: '📝 Papers' },
    { id: 'members', label: '👥 Members' }
  ];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* The group list and the group page both need this, and asking the
     backend is the only honest answer: a group you are not in does not
     come back, which is the membership rule rather than a check. */
  async function mine() {
    try { return (await Backend.listChatRooms?.()) || []; } catch { return []; }
  }
  async function find(roomId) {
    return (await mine()).find(r => r.id === roomId) || null;
  }

  /* ---------------- the index: every group you are in ---------------- */

  async function renderIndex(view) {
    const rooms = (await mine()).filter(r => r.kind === 'group' || (r.title || '').trim());
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">STUDY GROUPS</p>
          <h1 class="page-title">Your groups</h1>
          <p class="muted">A group is private: its wall, its chat, its files and its papers are
            readable only by the people in it. An admin adds members by name or user number.</p>
        </header>
        <div class="card" data-animate>
          <div class="bp-sec-head">
            <h4>${rooms.length} group${rooms.length === 1 ? '' : 's'}</h4>
            <button class="btn btn-gold btn-sm" id="g-new">＋ New group</button>
          </div>
          ${rooms.length ? `<div class="g-grid">${rooms.map(r => `
            <a class="g-card" href="#/group/${encodeURIComponent(r.id)}">
              <span class="g-card-av">👥</span>
              <span class="g-card-n">${esc(r.title || 'Group')}</span>
              <span class="g-card-sub muted">${(r.members || []).length || '—'} member${(r.members || []).length === 1 ? '' : 's'}</span>
            </a>`).join('')}</div>`
          : `<p class="muted">You are not in a group yet. Make one and add the people you revise with —
             you will be its admin.</p>`}
        </div>
      </section>`;
    view.querySelector('#g-new').addEventListener('click', async () => {
      await TeaRoom.newGroup();
      /* The new group should be on screen, not behind a reload — a group
         that only appears after refreshing reads as one that was not made. */
      renderIndex(view);
    });
    if (window.FX) FX.viewIn(view);
  }

  /* ---------------- one group ---------------- */

  async function render(view, roomId, tab, user) {
    const room = await find(roomId);
    if (!room) {
      view.innerHTML = `<section class="page narrow" data-animate>
        <header><p class="kicker">GROUP</p><h1 class="page-title">Not one of your groups</h1></header>
        <div class="card"><p class="muted">Either this group does not exist, or you are not in it. A group's
          wall, chat, files and papers are readable only by its members.</p>
          <a class="btn btn-gold" href="#/groups">← Your groups</a></div></section>`;
      if (window.FX) FX.viewIn(view);
      return;
    }
    const now = TABS.some(t => t.id === tab) ? tab : 'wall';
    view.innerHTML = `
      <section class="page">
        <header data-animate>
          <p class="kicker">STUDY GROUP</p>
          <h1 class="page-title">${esc(room.title || 'Group')}</h1>
          <p class="muted">Everything here is private to the people in this group.</p>
        </header>
        <nav class="g-tabs" data-animate>
          ${TABS.map(t => `<a class="g-tab${t.id === now ? ' is-on' : ''}"
            href="#/group/${encodeURIComponent(roomId)}/${t.id}">${t.label}</a>`).join('')}
        </nav>
        <div id="g-panel"></div>
      </section>`;
    const panel = view.querySelector('#g-panel');
    /* Each tab hands the panel to whoever already owns that job. The one
       thing this page must do itself is PUT THE PREVIOUS ONE DOWN: a wall
       panel left registered while the chat is on screen keeps being
       repainted into an element that is no longer in the document. */
    TeaRoom.releasePanel?.();
    TeaRoom.releaseChatPanel?.();

    if (now === 'wall') return TeaRoom.renderPanel(panel, roomId);
    if (now === 'chat') return TeaRoom.renderChatPanel(panel, roomId);
    if (now === 'papers') return GroupPaper.renderList(panel, roomId, user, room.title, true);
    if (now === 'members') return renderMembers(panel, roomId, view);
    return renderFiles(panel, roomId);
  }

  /* ---------------- files ---------------- */

  async function renderFiles(panel, roomId) {
    panel.innerHTML = `<div class="card"><p class="muted">Looking…</p></div>`;
    const files = await TeaRoom.groupFiles(roomId);
    const isImg = f => /^image\//.test(f.type || '') || /\.(png|jpe?g|gif|webp|avif)$/i.test(f.url || '');
    panel.innerHTML = `
      <div class="card">
        <div class="bp-sec-head"><h4>${files.length} file${files.length === 1 ? '' : 's'} shared in this group</h4></div>
        ${files.length ? `<div class="g-files">${files.map(f => `
          <a class="g-file" href="${esc(f.url)}" target="_blank" rel="noopener">
            ${isImg(f) ? `<img src="${esc(f.url)}" alt="" loading="lazy">`
                       : `<span class="g-file-ico">📄</span>`}
            <span class="g-file-n">${esc(f.name)}</span>
            <span class="g-file-sub muted">${esc(f.who || '')} · ${f.when ? new Date(f.when).toLocaleDateString() : ''} · ${esc(f.where)}</span>
          </a>`).join('')}</div>`
        /* Said plainly, with where to put one — an empty panel that does not
           say how to fill it reads as a feature that is broken. */
        : `<p class="muted">Nothing shared yet. Anything attached to a post on this group's
           wall, or sent in its chat, appears here.</p>`}
      </div>`;
  }

  /* ---------------- members ---------------- */

  async function renderMembers(panel, roomId, view) {
    panel.innerHTML = `<div class="card"><p class="muted">Looking…</p></div>`;
    let list = [];
    try { list = await Backend.listRoomMembers(roomId); }
    catch (e) {
      panel.innerHTML = `<div class="card"><p class="bad">Could not read the members: ${esc(e.message || e)}</p></div>`;
      return;
    }
    const iAmAdmin = list.some(p => p.me && p.role === 'admin');
    panel.innerHTML = `
      <div class="card">
        <div class="bp-sec-head">
          <h4>${list.length} member${list.length === 1 ? '' : 's'}</h4>
          <button class="btn btn-gold btn-sm" id="g-manage">${iAmAdmin ? 'Manage members' : 'Group settings'}</button>
        </div>
        <div class="gm-list">${list.map(p => `
          <div class="gm-row">
            <span class="gm-n">${esc(p.name)}${p.me ? ' <i>(you)</i>' : ''}${p.userNo ? ` <span class="nc-hit-no">#${esc(p.userNo)}</span>` : ''}</span>
            <span class="gm-role ${p.role === 'admin' ? 'is-admin' : ''}">${p.role === 'admin' ? 'Admin' : 'Member'}</span>
          </div>`).join('')}</div>
        ${iAmAdmin ? '' : '<p class="muted tiny" style="margin-top:12px">Only an admin can add or remove people.</p>'}
      </div>`;
    panel.querySelector('#g-manage').addEventListener('click', async () => {
      await TeaRoom.openMembers(roomId, null);
      /* The sheet writes through the backend; repainting on close is how
         the list behind it stops being the list from before. */
      const again = () => { if (location.hash.includes(roomId)) renderMembers(panel, roomId, view); };
      const t = setInterval(() => { if (!document.querySelector('#gm-body')) { clearInterval(t); again(); } }, 400);
    });
  }

  return { render, renderIndex, mine, find };
})();
