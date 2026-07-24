/* ============================================================
   ai.js — the "Explore with AI" panel.

   Talks ONLY to the Cloudflare function at AUREUM_CONFIG.ai.apiBase
   (functions/api/explain.js) — API keys never touch the browser.

   Everyone: Gemini Flash explanation + follow-up chat.
   Developer: a Claude toggle and downloadable study aids
   (summary as Word/PDF/text, chart & tree as SVG/PNG, infographic).
   ============================================================ */

const AI = (() => {
  const cfg = () => window.AUREUM_CONFIG?.ai || {};
  let userKnown;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LOADING = `<div class="ai-loading"><span></span><span></span><span></span></div>`;

  async function getUser() {
    if (userKnown !== undefined) return userKnown;
    try { userKnown = await Backend.currentUser(); } catch { userKnown = null; }
    return userKnown;
  }

  // AI-systems panel switch (app_config 'ai_features'). Default = on, so a
  // missing/failed config never disables the tutor. Cached 10 min on-device.
  async function featureOn(id) {
    try {
      const feats = (typeof Cache !== 'undefined')
        ? await Cache.wrap('ai-features', 10 * 60 * 1000, () => Backend.getAiFeatures())
        : await Backend.getAiFeatures();
      return (feats?.[id]?.enabled) !== false;
    } catch { return true; }
  }

  async function attach(slot, ctx) {
    if (!slot || !cfg().enabled) return;
    if (Backend.mode !== 'cloud') {
      slot.innerHTML = `<p class="ai-note">✨ Explore with AI activates on the deployed site (needs the cloud backend).</p>`;
      return;
    }
    if (!(await featureOn('ai_tutor'))) return;      // switched off in AI systems
    // Gemini access is developer-granted per user (server-enforced too) —
    // without it, show why instead of a button that would only error.
    const u0 = await getUser();
    if (u0 && !u0.isDeveloper && !u0.featureFlags?.paid) {
      slot.innerHTML = `<p class="ai-note">✨ The AI tutor is part of the paid plan — ask the site owner to activate your access.</p>`;
      return;
    }
    if (u0 && !u0.isDeveloper && !u0.featureFlags?.gemini) {
      slot.innerHTML = `<p class="ai-note">✨ The AI tutor is enabled per user — ask the site owner for Gemini access.</p>`;
      return;
    }
    slot.innerHTML = `<button class="btn btn-ai" data-ai-open>✨ Explore with AI</button>`;
    slot.querySelector('[data-ai-open]').addEventListener('click', () => openPanel(slot, ctx));
  }

  async function openPanel(slot, ctx) {
    const u = await getUser();
    const dev = !!u?.isDeveloper;
    // Gemini+ users (flag granted in Users & access) can pick their Gemini
    // model; the server re-checks the flag, so this is UX, not the gate.
    const advanced = dev || !!u?.featureFlags?.gemini_advanced;
    const modelPicker = `<select class="ai-model" id="ai-model" title="Gemini model">
            ${(cfg().geminiModels || [{ id: cfg().geminiModel || 'gemini-3.1-flash-lite', label: 'Gemini Flash' }]).map(m => `<option value="${m.id}" ${m.id === (cfg().geminiModel) ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>`;
    slot.innerHTML = `
      <div class="ai-panel" data-animate>
        <div class="ai-head">
          <span class="ai-title">✨ AI tutor</span>
          ${dev ? `<div class="ai-providers">
            <button class="ai-prov" data-prov="gemini">Gemini Flash</button>
            <button class="ai-prov active" data-prov="claude">Claude</button>
          </div>
          ${modelPicker}` : (advanced ? modelPicker : `<span class="ai-badge">Gemini Flash</span>`)}
          <button class="ai-x" data-ai-close aria-label="Close">✕</button>
        </div>
        <div class="ai-tools">
          <button class="btn btn-ghost btn-sm" id="ai-hist" title="Reopen everything you saved for this question">↺ My saved work</button>
        </div>
        <div class="ai-history" id="ai-history" hidden></div>
        <div class="ai-body" id="ai-body">${LOADING}</div>
        <div class="ai-chat" id="ai-chat">
          <div class="ai-chat-labelrow">
            <p class="ai-chat-label">💬 Chat to elaborate on this topic</p>
            <button class="btn btn-ghost btn-sm ai-save-chat" id="ai-save-chat" title="Save this whole conversation to your Studio">💾 Save chat to Studio</button>
          </div>
          <div class="ai-messages" id="ai-messages"></div>
          <form class="ai-ask" id="ai-ask">
            <input type="text" id="ai-input" placeholder="Ask a follow-up… e.g. why not option D? / explain the physiology" autocomplete="off">
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
          <button class="btn btn-ghost btn-sm" data-aid="mindmap">🧠 Mind map</button>
          <div class="ai-aid-out" id="ai-aid-out"></div>
        </div>` : ''}
        <p class="ai-disclaimer">AI-generated — verify against NICE / RCOG / SLCOG guidance.</p>
      </div>`;

    const panel = slot.querySelector('.ai-panel');
    const st = { provider: dev ? 'claude' : 'gemini', geminiModel: cfg().geminiModel || 'gemini-3.1-flash-lite', messages: [], follow: 0, dev };

    panel.querySelector('[data-ai-close]').addEventListener('click', () => attach(slot, ctx));
    panel.querySelectorAll('.ai-prov').forEach(b => b.addEventListener('click', () => {
      panel.querySelectorAll('.ai-prov').forEach(x => x.classList.toggle('active', x === b));
      st.provider = b.dataset.prov;
      updateFollowCount(panel, st);                   // per-provider follow-up cap
      runExplain();                                   // regenerate with the chosen provider
    }));
    panel.querySelector('#ai-model')?.addEventListener('change', e => {
      st.geminiModel = e.target.value;
      if (st.provider === 'gemini') runExplain();     // re-run with the chosen Gemini model
    });
    panel.querySelector('#ai-ask').addEventListener('submit', e => { e.preventDefault(); ask(panel, ctx, st); });
    panel.querySelector('#ai-save-chat').addEventListener('click', () => saveChatToStudio(panel, ctx, st));
    panel.querySelector('#ai-hist').addEventListener('click', () => toggleHistory(panel, ctx, st));
    panel.querySelectorAll('[data-aid]').forEach(b => b.addEventListener('click', () => genAid(panel, ctx, st, b.dataset.aid)));

    FX.viewIn(panel);
    updateFollowCount(panel, st);                     // chat is always available
    await runExplain();

    async function runExplain() {
      const body = panel.querySelector('#ai-body');
      body.innerHTML = LOADING;
      try {
        const { text } = await call({ action: 'explain', provider: st.provider, geminiModel: st.geminiModel, questionKey: ctx.questionKey, question: ctx });
        body.innerHTML = renderMarkdown(text);
      } catch (err) {
        body.innerHTML = `<p class="ai-error">${esc(err.message)}</p>
          <p class="ai-hint">${st.dev ? 'Try the other provider above, or ' : 'You can still '}ask a question in the chat below.</p>`;
      }
    }
  }

  async function ask(panel, ctx, st) {
    const input = panel.querySelector('#ai-input');
    const q = input.value.trim();
    if (!q) return;
    const max = maxFollowups(st);
    if (st.follow >= max) return;
    input.value = '';
    try { if (typeof Track !== 'undefined') Track.log('ai_ask', ctx.questionKey, 'ai', { q: q.slice(0, 300) }); } catch {}
    const msgs = panel.querySelector('#ai-messages');
    st.messages.push({ role: 'user', content: q });
    msgs.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-user">${esc(q)}</div>`);
    const holder = document.createElement('div');
    holder.className = 'ai-msg ai-msg-ai';
    holder.innerHTML = `<div class="ai-loading sm"><span></span><span></span><span></span></div>`;
    msgs.appendChild(holder);
    msgs.scrollTop = msgs.scrollHeight;
    try {
      const { text } = await call({ action: 'chat', provider: st.provider, geminiModel: st.geminiModel, questionKey: ctx.questionKey, question: ctx, messages: st.messages });
      st.messages.push({ role: 'assistant', content: text });
      holder.innerHTML = renderMarkdown(text);
      st.follow += 1;
      updateFollowCount(panel, st);
      try { Backend.saveAiChat(ctx.questionKey, st.messages, ctx.paperTitle).catch(() => {}); } catch {}
    } catch (err) {
      holder.innerHTML = `<p class="ai-error">${esc(err.message)}</p>`;
      st.messages.pop();
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  function maxFollowups(st) {
    return st.provider === 'gemini'
      ? (cfg().geminiFollowUpLimit || cfg().followUpLimit || 6)
      : (cfg().followUpLimit || 6);
  }
  async function saveChatToStudio(panel, ctx, st) {
    const btn = panel.querySelector('#ai-save-chat');
    if (!st.messages.length) { flash(btn, 'Ask a question first'); return; }
    const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await Backend.saveAiChat(ctx.questionKey, st.messages, ctx.paperTitle);
      btn.textContent = '✓ Saved to Studio';
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1800);
    } catch (e) {
      btn.textContent = prev; btn.disabled = false; flash(btn, 'Could not save');
    }
  }
  function flash(btn, msg) { const p = btn.textContent; btn.textContent = msg; setTimeout(() => btn.textContent = p, 1600); }

  function updateFollowCount(panel, st) {
    const max = maxFollowups(st);
    const left = Math.max(0, max - st.follow);
    const el = panel.querySelector('#ai-followcount');
    const form = panel.querySelector('#ai-ask');
    if (el) el.textContent = left > 0 ? `${left} follow-up${left > 1 ? 's' : ''} left for this question` : 'Follow-up limit reached for this question';
    if (form) form.querySelectorAll('input,button').forEach(x => x.disabled = left <= 0);
  }

  /* ---------------- developer study aids ---------------- */

  async function genAid(panel, ctx, st, kind) {
    const out = panel.querySelector('#ai-aid-out');
    out.innerHTML = LOADING;
    try {
      const { artifact } = await call({ action: 'artifact', artifact: kind, provider: st.provider, geminiModel: st.geminiModel, questionKey: ctx.questionKey, question: ctx });
      try { Backend.saveAiItem({ questionKey: ctx.questionKey, paperTitle: ctx.paperTitle, kind, title: kindLabel(kind) + ' — ' + (ctx.paperTitle || ''), content: artifact.content, mime: artifact.mime }).catch(() => {}); } catch {}
      if (kind === 'summary') renderSummaryAid(out, artifact, ctx);
      else renderMediaAid(out, artifact, kind);
    } catch (err) {
      out.innerHTML = `<p class="ai-error">${esc(err.message)}</p>`;
    }
  }

  /* ---------------- saved-work history ---------------- */

  const kindIcon = k => ({ chat: '💬', chart: '📊', infographic: '🖼', tree: '🌳', mindmap: '🧠', summary: '📄' }[k] || '✨');
  const kindLabel = k => ({ chat: 'Conversation', chart: 'Chart', infographic: 'Infographic', tree: 'Decision tree', mindmap: 'Mind map', summary: 'Summary' }[k] || k);
  const extFor = m => { m = m || ''; if (/svg/.test(m)) return 'svg'; if (/html/.test(m)) return 'html'; if (/markdown/.test(m)) return 'md'; return 'txt'; };
  const safeParse = s => { try { return JSON.parse(s); } catch { return []; } };
  function chatInner(msgs) {
    return (msgs || []).map(m =>
      `<div class="ai-msg ai-msg-${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? esc(m.content) : renderMarkdown(m.content)}</div>`).join('');
  }
  function chatHTML(msgs) { return `<div class="ai-messages ai-hist-msgs">${chatInner(msgs)}</div>`; }
  function renderSavedMedia(el, item) {
    const artifact = { type: item.kind, mime: item.mime || 'text/plain', content: item.content || '', filename: slug(item.paperTitle || 'aureum') + '-' + item.kind + '.' + extFor(item.mime) };
    if (item.kind === 'summary' || /markdown/.test(item.mime || '')) renderSummaryAid(el, artifact, { paperTitle: item.paperTitle });
    else renderMediaAid(el, artifact, item.kind);
  }
  // public: used by the Studio tab (app.js) to render a saved item read-only
  function renderSavedItem(el, item) {
    if (!el) return;
    if (item.kind === 'chat') { el.innerHTML = transcriptHTML(safeParse(item.content)); return; }
    renderSavedMedia(el, item);
  }
  function transcriptHTML(msgs) {
    return `<div class="ai-transcript">
      <div class="ai-transcript-meta">💬 ${msgs.length} message${msgs.length !== 1 ? 's' : ''}</div>
      <div class="ai-transcript-body">
        ${msgs.map(m => `
          <div class="ai-turn ai-turn-${m.role === 'user' ? 'you' : 'ai'}">
            <span class="ai-turn-who">${m.role === 'user' ? 'You' : '✦ AI tutor'}</span>
            <div class="ai-turn-bubble">${m.role === 'user' ? esc(m.content) : renderMarkdown(m.content)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  }
  function loadChat(panel, st, msgs) {
    st.messages = (msgs || []).slice();
    const box = panel.querySelector('#ai-messages');
    if (box) { box.innerHTML = chatInner(st.messages); box.scrollTop = box.scrollHeight; }
  }
  async function toggleHistory(panel, ctx, st) {
    const box = panel.querySelector('#ai-history');
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false; box.innerHTML = LOADING;
    let items = [];
    try { items = await Backend.listAiItems(ctx.questionKey); } catch {}
    if (!items.length) { box.innerHTML = `<p class="ai-note">Nothing saved for this question yet. Your chats and any charts, mind maps, or summaries you generate are saved here automatically — come back any day and reopen them.</p>`; return; }
    box.innerHTML = `<div class="ai-hist-list"></div>`;
    const list = box.querySelector('.ai-hist-list');
    items.forEach(item => {
      const card = document.createElement('div'); card.className = 'ai-hist-card';
      const when = item.created ? new Date(item.created).toLocaleString() : '';
      card.innerHTML = `
        <div class="ai-hist-head">
          <span class="ai-hist-kind">${kindIcon(item.kind)} ${esc(kindLabel(item.kind))}</span>
          <span class="ai-hist-when">${esc(when)}</span>
          <button class="ai-hist-del" title="Delete">🗑</button>
        </div>
        <div class="ai-hist-body"></div>`;
      const body = card.querySelector('.ai-hist-body');
      if (item.kind === 'chat') {
        const msgs = safeParse(item.content);
        body.innerHTML = transcriptHTML(msgs) + `<button class="btn btn-ghost btn-sm ai-hist-load">↥ Load into chat</button>`;
        body.querySelector('.ai-hist-load').addEventListener('click', () => loadChat(panel, st, msgs));
      } else {
        renderSavedMedia(body, item);
      }
      card.querySelector('.ai-hist-del').addEventListener('click', async () => {
        if (!confirm('Delete this saved item?')) return;
        try { await Backend.deleteAiItem(item.id); } catch {}
        card.remove();
        if (!list.children.length) box.innerHTML = `<p class="ai-note">Nothing saved for this question yet.</p>`;
      });
      list.appendChild(card);
    });
  }

  function renderSummaryAid(out, artifact, ctx) {
    const md = artifact.content;
    const html = renderMarkdown(md);
    const title = ctx.paperTitle || 'Summary';
    out.innerHTML = `
      <div class="ai-summary">
        <div class="ai-summary-doc">${html}</div>
        <div class="ai-aid-actions">
          <button class="btn btn-gold btn-sm" data-dl="doc">⬇ Word (.doc)</button>
          <button class="btn btn-ghost btn-sm" data-dl="pdf">🖨 Print / Save as PDF</button>
          <button class="btn btn-ghost btn-sm" data-dl="txt">⬇ Text (.txt)</button>
        </div>
      </div>`;
    out.querySelector('[data-dl="doc"]').addEventListener('click', () => download(wordBlob(html, title), slug(title) + '-summary.doc'));
    out.querySelector('[data-dl="txt"]').addEventListener('click', () => download(new Blob([mdToText(md)], { type: 'text/plain' }), slug(title) + '-summary.txt'));
    out.querySelector('[data-dl="pdf"]').addEventListener('click', () => printHtml(printableDoc(title + ' — revision summary', html)));
  }

  function renderMediaAid(out, artifact, kind) {
    const blob = new Blob([artifact.content], { type: artifact.mime });
    const url = URL.createObjectURL(blob);
    const isSvg = artifact.mime.includes('svg');
    const isHtml = artifact.mime.includes('html');
    out.innerHTML = `
      ${isSvg ? `<div class="ai-aid-preview">${artifact.content}</div>` : ''}
      ${isHtml ? `<iframe class="ai-aid-frame" sandbox></iframe>` : ''}
      <div class="ai-aid-actions">
        <a class="btn btn-gold btn-sm" download="${esc(artifact.filename)}" href="${url}">⬇ Download ${esc(kind)}</a>
        ${isSvg ? `<button class="btn btn-ghost btn-sm" data-png>⬇ PNG</button>` : ''}
        ${isHtml ? `<button class="btn btn-ghost btn-sm" data-print>🖨 Print / PDF</button>` : ''}
      </div>`;
    const frame = out.querySelector('iframe'); if (frame) frame.srcdoc = artifact.content;
    out.querySelector('[data-png]')?.addEventListener('click', () => svgToPng(artifact.content, artifact.filename.replace(/\.svg$/, '.png')));
    out.querySelector('[data-print]')?.addEventListener('click', () => printHtml(artifact.content));
  }

  /* ---------------- download helpers ---------------- */

  function download(blob, filename) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(u); }, 1500);
  }
  function wordBlob(bodyHtml, title) {
    const doc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${esc(title)}</title></head>` +
      `<body style="font-family:Calibri,Arial,sans-serif;font-size:12pt;color:#111;line-height:1.5"><h1 style="font-size:18pt">${esc(title)} — revision summary</h1>${bodyHtml}</body></html>`;
    return new Blob(['﻿' + doc], { type: 'application/msword' });
  }
  function mdToText(md) { return String(md).replace(/[*_`>#]/g, '').replace(/\n{3,}/g, '\n\n').trim(); }
  function printableDoc(title, bodyHtml) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<style>body{font-family:Georgia,'Times New Roman',serif;max-width:720px;margin:40px auto;padding:0 20px;color:#111;line-height:1.65}` +
      `h1{font-size:20pt;margin-bottom:10px}h2,h3,strong{color:#0a1a3a}ul{margin:8px 0 14px 22px}li{margin-bottom:4px}` +
      `@media print{body{margin:0}}</style></head><body><h1>${esc(title)}</h1>${bodyHtml}` +
      `<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
  }
  function printHtml(html) {
    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups for this site to print / save as PDF.'); return; }
    w.document.open();
    w.document.write(/<html/i.test(html) ? html : printableDoc('AUREUM study aid', html));
    w.document.close();
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'aureum'; }
  function svgToPng(svg, filename) {
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const w = img.naturalWidth || 800, h = img.naturalHeight || 600;
      const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
      const g = c.getContext('2d'); g.scale(2, 2);
      g.fillStyle = '#12152b'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      c.toBlob(b => { if (b) download(b, filename); URL.revokeObjectURL(url); }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Could not convert this diagram to PNG — use the SVG download.'); };
    img.src = url;
  }

  /* ---------------- transport ---------------- */

  async function call(payload) {
    const token = await Backend.getAccessToken();
    if (!token) throw new Error('Please sign in to use the AI tutor.');
    const res = await fetch(cfg().apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ ...payload, model: payload.provider === 'claude' ? cfg().claudeModel : (payload.geminiModel || cfg().geminiModel), dailyLimit: cfg().dailyLimit })
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
    h = h.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>').replace(/^##\s+(.+)$/gm, '<h3>$1</h3>').replace(/^#\s+(.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');
    h = h.replace(/`(.+?)`/g, '<code>$1</code>');
    h = h.replace(/(?:^|\n)\s*[-•]\s+(.+)/g, '\n<li>$1</li>');
    h = h.replace(/(<li>[\s\S]*?<\/li>)/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>');
    h = h.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    return '<p>' + h + '</p>';
  }

  return { attach, renderSavedItem, kindIcon, kindLabel, featureOn };
})();
