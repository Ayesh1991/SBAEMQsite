/* ============================================================
   ai.js — the "Explore with AI" panel.

   Renders under a question's explanation (study mode + results
   review). Talks ONLY to the Cloudflare function at
   AUREUM_CONFIG.ai.apiBase (functions/api/explain.js) — the API
   keys never touch the browser.

   Everyone: Gemini Flash explanation + a short follow-up chat.
   Developer only: a Claude toggle and downloadable study aids
   (summary, chart, infographic, tree diagram).
   ============================================================ */

const AI = (() => {
  const cfg = () => window.AUREUM_CONFIG?.ai || {};
  let devKnown = null;                       // cache: is current user the developer?

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function isDev() {
    if (devKnown !== null) return devKnown;
    try { devKnown = !!(await Backend.currentUser())?.isDeveloper; } catch { devKnown = false; }
    return devKnown;
  }

  /** Render the launcher button into `slot`, wired for question `ctx`. */
  async function attach(slot, ctx) {
    if (!slot || !cfg().enabled) return;
    if (Backend.mode !== 'cloud') {
      slot.innerHTML = `<p class="ai-note">✨ Explore with AI activates on the deployed site (needs the cloud backend).</p>`;
      return;
    }
    slot.innerHTML = `<button class="btn btn-ai" data-ai-open>✨ Explore with AI</button>`;
    slot.querySelector('[data-ai-open]').addEventListener('click', () => openPanel(slot, ctx));
  }

  async function openPanel(slot, ctx) {
    const dev = await isDev();
    slot.innerHTML = `
      <div class="ai-panel" data-animate>
        <div class="ai-head">
          <span class="ai-title">✨ AI tutor</span>
          ${dev ? `<div class="ai-providers">
            <button class="ai-prov active" data-prov="gemini">Gemini Flash</button>
            <button class="ai-prov" data-prov="claude">Claude</button>
          </div>` : `<span class="ai-badge">Gemini Flash</span>`}
          <button class="ai-x" data-ai-close aria-label="Close">✕</button>
        </div>
        <div class="ai-body" id="ai-body"><div class="ai-loading"><span></span><span></span><span></span></div></div>
        <div class="ai-chat" id="ai-chat" hidden>
          <div class="ai-messages" id="ai-messages"></div>
          <form class="ai-ask" id="ai-ask">
            <input type="text" id="ai-input" placeholder="Ask a follow-up… e.g. why not option D?" autocomplete="off">
            <button class="btn btn-primary btn-sm" type="submit">Ask</button>
          </form>
          <p class="ai-followcount" id="ai-followcount"></p>
        </div>
        ${dev ? `<div class="ai-aids">
          <span class="ai-aids-label">Study aids (developer):</span>
          <button class="btn btn-ghost btn-sm" data-aid="summary">📄 Summary</button>
          <button class="btn btn-ghost btn-sm" data-aid="chart">📊 Chart</button>
          <button class="btn btn-ghost btn-sm" data-aid="infographic">🖼 Infographic</button>
          <button class="btn btn-ghost btn-sm" data-aid="tree">🌳 Tree</button>
          <div class="ai-aid-out" id="ai-aid-out"></div>
        </div>` : ''}
        <p class="ai-disclaimer">AI-generated — verify against NICE / RCOG / SLCOG guidance.</p>
      </div>`;

    const panel = slot.querySelector('.ai-panel');
    const st = { provider: 'gemini', messages: [], follow: 0, dev };

    panel.querySelector('[data-ai-close]').addEventListener('click', () => attach(slot, ctx));
    panel.querySelectorAll('.ai-prov').forEach(b => b.addEventListener('click', () => {
      panel.querySelectorAll('.ai-prov').forEach(x => x.classList.toggle('active', x === b));
      st.provider = b.dataset.prov;
    }));
    panel.querySelector('#ai-ask').addEventListener('submit', e => { e.preventDefault(); ask(panel, ctx, st); });
    panel.querySelectorAll('[data-aid]').forEach(b => b.addEventListener('click', () => genAid(panel, ctx, st, b.dataset.aid)));

    FX.viewIn(panel);
    // first: the one-shot explanation
    const body = panel.querySelector('#ai-body');
    try {
      const { text } = await call({ action: 'explain', provider: st.provider, questionKey: ctx.questionKey, question: ctx });
      body.innerHTML = renderMarkdown(text);
      panel.querySelector('#ai-chat').hidden = false;
      updateFollowCount(panel, st);
    } catch (err) {
      body.innerHTML = `<p class="ai-error">${esc(err.message)}</p>`;
    }
  }

  async function ask(panel, ctx, st) {
    const input = panel.querySelector('#ai-input');
    const q = input.value.trim();
    if (!q) return;
    const max = cfg().followUpLimit || 6;
    if (st.follow >= max) return;
    input.value = '';
    const msgs = panel.querySelector('#ai-messages');
    st.messages.push({ role: 'user', content: q });
    msgs.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-user">${esc(q)}</div>`);
    const holder = document.createElement('div');
    holder.className = 'ai-msg ai-msg-ai';
    holder.innerHTML = `<div class="ai-loading sm"><span></span><span></span><span></span></div>`;
    msgs.appendChild(holder);
    msgs.scrollTop = msgs.scrollHeight;
    try {
      const { text } = await call({ action: 'chat', provider: st.provider, questionKey: ctx.questionKey, question: ctx, messages: st.messages });
      st.messages.push({ role: 'assistant', content: text });
      holder.innerHTML = renderMarkdown(text);
      st.follow += 1;
      updateFollowCount(panel, st);
    } catch (err) {
      holder.innerHTML = `<p class="ai-error">${esc(err.message)}</p>`;
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  function updateFollowCount(panel, st) {
    const max = cfg().followUpLimit || 6;
    const left = Math.max(0, max - st.follow);
    const el = panel.querySelector('#ai-followcount');
    const form = panel.querySelector('#ai-ask');
    if (el) el.textContent = left > 0 ? `${left} follow-up${left > 1 ? 's' : ''} left for this question` : 'Follow-up limit reached for this question';
    if (form) form.querySelector('input,button').disabled = left <= 0 ? true : false;
    if (left <= 0 && form) form.querySelectorAll('input,button').forEach(x => x.disabled = true);
  }

  /* ---------------- developer study aids ---------------- */

  async function genAid(panel, ctx, st, kind) {
    const out = panel.querySelector('#ai-aid-out');
    out.innerHTML = `<div class="ai-loading sm"><span></span><span></span><span></span></div>`;
    try {
      const { artifact } = await call({ action: 'artifact', artifact: kind, provider: st.provider, questionKey: ctx.questionKey, question: ctx });
      const blob = new Blob([artifact.content], { type: artifact.mime });
      const url = URL.createObjectURL(blob);
      let preview = '';
      if (artifact.mime.includes('svg')) preview = `<div class="ai-aid-preview">${artifact.content}</div>`;
      else if (artifact.mime.includes('html')) preview = `<iframe class="ai-aid-frame" sandbox></iframe>`;
      out.innerHTML = `${preview}<a class="btn btn-gold btn-sm" download="${esc(artifact.filename)}" href="${url}">⬇ Download ${esc(kind)}</a>`;
      const frame = out.querySelector('iframe');
      if (frame) frame.srcdoc = artifact.content;
    } catch (err) {
      out.innerHTML = `<p class="ai-error">${esc(err.message)}</p>`;
    }
  }

  /* ---------------- transport ---------------- */

  async function call(payload) {
    const token = await Backend.getAccessToken();
    if (!token) throw new Error('Please sign in to use the AI tutor.');
    const res = await fetch(cfg().apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ ...payload, model: payload.provider === 'claude' ? cfg().claudeModel : cfg().geminiModel, dailyLimit: cfg().dailyLimit })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429) throw new Error(data.error || 'Daily AI limit reached — try again tomorrow.');
      if (res.status === 403) throw new Error(data.error || 'This option is available to the developer only.');
      throw new Error(data.error || `AI request failed (HTTP ${res.status}).`);
    }
    return data;
  }

  /* ---------------- tiny markdown ---------------- */

  function renderMarkdown(md) {
    let h = esc(md);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/`(.+?)`/g, '<code>$1</code>');
    // bullet lists
    h = h.replace(/(?:^|\n)[-•]\s+(.+)/g, '\n<li>$1</li>');
    h = h.replace(/(<li>[\s\S]*?<\/li>)/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>');
    h = h.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    return '<p>' + h + '</p>';
  }

  return { attach };
})();
