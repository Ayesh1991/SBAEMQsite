/* ============================================================
   wallet.js — the prepaid balance, in Sri Lankan rupees.

   How the money works
     You pay into the account and upload the slip. The slip is read
     once by a vision model — the cheapest call in the app — which
     pulls out the amount, the reference you typed in the remark and
     the bank's own transaction number. That becomes a TOP-UP REQUEST,
     which the site owner approves. An AI reading a screenshot is not
     proof of payment, so nothing is credited automatically; approval
     is one click against the slip and the extracted fields.

   The balance is DERIVED, never a running total
     balance = approved top-ups − everything the AI has cost you.
     The spend side comes from ai_token_usage — the same metered rows
     the invoices are built from — priced by the live rate card and
     converted at the dollar rate the developer sets. Nothing to keep
     in sync, nothing that can drift, and the reading of your own slip
     appears in it as a handling fee like any other AI call.

   When it runs out
     Every AI surface asks canSpend() first. At zero the AI stops and
     says so; everything else in AUREUM keeps working.
   ============================================================ */

const Wallet = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cfg = () => window.AUREUM_CONFIG || {};

  const DEFAULT_RATE = 340;          // LKR per USD, until the developer sets one
  const RATE_KEY = 'wallet-rate';
  let _rate = null, _state = null;

  const lkr = n => 'LKR ' + Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rate = () => _rate == null ? DEFAULT_RATE : _rate;

  async function loadRate() {
    if (_rate != null) return _rate;
    try {
      const loader = () => Backend.getWalletConfig();
      const c = (typeof Cache !== 'undefined') ? await Cache.wrap(RATE_KEY, 10 * 60 * 1000, loader) : await loader();
      _rate = Number(c?.usdRate) > 0 ? Number(c.usdRate) : DEFAULT_RATE;
      _state = Object.assign({ minTopUp: 300, packs: [300, 500, 1000, 2000] }, c || {});
    } catch { _rate = DEFAULT_RATE; }
    return _rate;
  }
  const settings = () => _state || { minTopUp: 300, packs: [300, 500, 1000, 2000] };
  function bustRate() { _rate = null; _state = null; if (typeof Cache !== 'undefined') Cache.bust(RATE_KEY); }

  /* ---------------- the balance ---------------- */

  let _cached = null, _at = 0;
  async function summary(force) {
    if (!force && _cached && Date.now() - _at < 30000) return _cached;
    await loadRate();
    try { if (typeof Billing !== 'undefined') await Billing.loadRates(); } catch {}
    const [tops, rows] = await Promise.all([
      Backend.listMyTopUps().catch(() => []),
      Backend.listMyTokenUsage().catch(() => [])
    ]);
    const creditedLkr = tops.filter(t => t.status === 'approved')
      .reduce((n, t) => n + (Number(t.amount_lkr) || 0), 0);
    const spentUsd = (typeof Billing !== 'undefined')
      ? rows.reduce((n, r) => n + Billing.lineCost(r), 0) : 0;
    const spentLkr = spentUsd * rate();
    const byFeature = (typeof Billing !== 'undefined') ? Billing.personalByFeature(rows) : [];
    _cached = {
      creditedLkr, spentUsd, spentLkr, balanceLkr: creditedLkr - spentLkr,
      rate: rate(), topUps: tops, byFeature,
      pending: tops.filter(t => t.status === 'pending').length
    };
    _at = Date.now();
    return _cached;
  }
  function bust() { _cached = null; _at = 0; }

  /** Every AI surface asks this before spending. */
  async function canSpend() {
    try {
      const u = await Backend.currentUser();
      if (u && u.isDeveloper) return true;                 // the owner is never gated
      if (!cfg().wallet?.enforce) return true;             // prepaid off = nothing changes
      const s = await summary();
      return s.balanceLkr > 0;
    } catch { return true; }                               // never block on a read failure
  }
  const blockedMessage = () =>
    'Your AUREUM balance has run out, so the AI features are paused. Top up in Profile → Billing & balance and they come straight back.';

  /** Charge is a no-op by design — spend is metered server-side and derived. */
  async function charge() { bust(); }

  /* ---------------- reading a payment slip ---------------- */

  async function readSlip(file) {
    const token = await Backend.getAccessToken();
    if (!token) throw new Error('Sign in first.');
    const img = await shrink(file);
    const res = await fetch(cfg().ai.apiBase, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'slip', provider: 'gemini', image: { mime: img.mime, data: img.b64 } })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not read the slip (HTTP ${res.status}).`);
    let d = null;
    const raw = String(data.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { d = JSON.parse(raw); } catch {
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
      if (a >= 0 && b > a) { try { d = JSON.parse(raw.slice(a, b + 1)); } catch {} }
    }
    if (!d) throw new Error('The slip could not be read. Try a clearer screenshot, or enter the details by hand.');
    return { fields: d, usage: data.usage || {}, preview: img.dataUrl };
  }

  /* A slip only has to be legible, so it is shrunk hard before it is sent:
     fewer pixels is fewer image tokens, and the whole point of this call is
     that it costs almost nothing. */
  function shrink(file, max = 1100) {
    return new Promise((resolve, reject) => {
      if (/pdf/i.test(file.type)) {
        // a PDF cannot be resized in the browser; send it as-is if it is small
        if (file.size > 4 * 1024 * 1024) return reject(new Error('That PDF is too large — please send a screenshot instead.'));
        const fr = new FileReader();
        fr.onload = () => { const s = String(fr.result); resolve({ mime: file.type, b64: s.split(',')[1], dataUrl: s }); };
        fr.onerror = () => reject(new Error('Could not read that file.'));
        return fr.readAsDataURL(file);
      }
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          const scale = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * scale); c.height = Math.round(im.height * scale);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          const dataUrl = c.toDataURL('image/jpeg', 0.72);
          resolve({ mime: 'image/jpeg', b64: dataUrl.split(',')[1], dataUrl });
        };
        im.onerror = () => reject(new Error('That file is not an image the browser can open.'));
        im.src = String(fr.result);
      };
      fr.onerror = () => reject(new Error('Could not read that file.'));
      fr.readAsDataURL(file);
    });
  }

  /* ================= Profile → Billing & balance ================= */

  async function renderBilling(view, user) {
    view.innerHTML = `<section class="page narrow"><p class="muted">Loading your balance…</p></section>`;
    const s = await summary(true);
    const low = s.balanceLkr <= 0 ? 'is-empty' : s.balanceLkr < 100 ? 'is-low' : '';
    const packs = settings().packs || [300, 500, 1000, 2000];

    view.innerHTML = `
      <section class="page narrow">
        <a class="link muted dev-back" href="#/profile">← Profile</a>
        <header data-animate>
          <p class="kicker">PREPAID · SRI LANKAN RUPEES</p>
          <h1 class="page-title">Billing &amp; balance</h1>
        </header>

        <div class="card wl-balance ${low}" data-animate>
          <div class="wl-bal-main">
            <span class="wl-bal-label">Your balance</span>
            <strong class="wl-bal-n">${lkr(s.balanceLkr)}</strong>
            <span class="muted tiny">Topped up ${lkr(s.creditedLkr)} · used ${lkr(s.spentLkr)}
              ($${s.spentUsd.toFixed(4)} at LKR ${s.rate}/USD)</span>
          </div>
          <div class="wl-bal-side">
            ${s.balanceLkr <= 0
              ? `<span class="wl-chip bad">AI paused — top up to resume</span>`
              : `<span class="wl-chip good">AI active</span>`}
            ${s.pending ? `<span class="wl-chip">${s.pending} top-up awaiting approval</span>` : ''}
          </div>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Top up</h3>
          <ol class="wl-steps">
            <li><strong>Pay into the account</strong> shown by the site owner. Put your user number
              <code class="wl-uno">${esc(userNo(user))}</code> in the <strong>remark / reference</strong> field —
              that is how the payment is matched to you.</li>
            <li><strong>Upload the slip</strong> below — the bank's PDF, a screenshot, or a photo.</li>
            <li>It is read automatically and sent for approval. Once approved the balance appears here.</li>
          </ol>
          <div class="wl-packs">${packs.map(p => `<span class="wl-pack">${lkr(p)}</span>`).join('')}
            <span class="muted tiny">common amounts — any amount works</span></div>

          <label class="btn btn-gold" style="cursor:pointer;margin-top:14px">⬆ Upload a payment slip
            <input type="file" id="wl-file" accept="image/*,application/pdf" hidden></label>
          <div id="wl-slip"></div>
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Where the money went</h3>
          ${s.byFeature.length ? `
          <div class="table-scroll"><table class="table">
            <thead><tr><th>Feature</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr></thead>
            <tbody>${s.byFeature.map(f => `<tr>
              <td>${f.icon} ${esc(f.label)}</td><td class="muted">${f.calls}</td>
              <td class="muted">${(f.inputTokens + f.outputTokens).toLocaleString('en-US')}</td>
              <td><strong>${lkr(f.cost * s.rate)}</strong> <span class="muted tiny">$${f.cost.toFixed(4)}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>` : `<p class="muted">Nothing spent yet.</p>`}
        </div>

        <div class="card" data-animate>
          <h3 class="card-title">Top-up history</h3>
          ${s.topUps.length ? `
          <div class="table-scroll"><table class="table">
            <thead><tr><th>When</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead>
            <tbody>${s.topUps.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(t => `
              <tr><td class="muted">${esc(new Date(t.created_at || Date.now()).toLocaleDateString('en-GB', { dateStyle: 'medium' }))}</td>
                <td><strong>${lkr(t.amount_lkr)}</strong></td>
                <td class="muted">${esc(t.reference || '—')}</td>
                <td>${t.status === 'approved' ? '<span class="good">Approved</span>'
                   : t.status === 'declined' ? `<span class="bad">Declined</span>${t.note ? ` <span class="muted tiny">${esc(t.note)}</span>` : ''}`
                   : '<span class="gold">Awaiting approval</span>'}</td></tr>`).join('')}</tbody>
          </table></div>` : `<p class="muted">No top-ups yet.</p>`}
        </div>
      </section>`;
    FX.viewIn(view);

    view.querySelector('#wl-file').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const host = view.querySelector('#wl-slip');
      host.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>
        <p class="muted tiny">Reading the slip…</p>`;
      try {
        const { fields, usage, preview } = await readSlip(f);
        showSlip(host, fields, preview, usage, user, view);
      } catch (err) {
        host.innerHTML = `<p class="ai-error">${esc(err.message || err)}</p>`;
      }
    });
  }

  const userNo = u => String(u?.userNo || u?.user_no || (u?.id || '').replace(/\D/g, '').slice(-5) || '00001').padStart(5, '0');

  function showSlip(host, f, preview, usage, user, view) {
    const amt = Number(f.amount) || 0;
    const cur = String(f.currency || 'LKR').toUpperCase();
    const warn = [];
    if (cur !== 'LKR') warn.push(`The slip says <strong>${esc(cur)}</strong>, not rupees — check the amount before submitting.`);
    if (!amt) warn.push('No amount could be read — type it in.');
    if ((f.confidence || 0) < 0.5) warn.push('This does not look like a completed payment slip.');
    host.innerHTML = `
      <div class="wl-slip" data-animate>
        <div class="wl-slip-img">${/^data:image/.test(preview) ? `<img src="${preview}" alt="The slip you uploaded">` : '<span>PDF</span>'}</div>
        <div class="wl-slip-fields">
          <h4>What was read from the slip</h4>
          <label class="wl-f"><span>Amount (LKR)</span><input type="number" id="wl-amt" value="${amt || ''}" min="1" step="0.01"></label>
          <label class="wl-f"><span>Your reference / remark</span><input type="text" id="wl-ref" value="${esc(f.reference || '')}" placeholder="${esc(userNo(user))}"></label>
          <div class="wl-read">
            ${[['Paid to', f.payee], ['Date', f.date], ['Bank', f.bank], ['Transaction', f.txnId], ['Status', f.status]]
              .filter(x => x[1]).map(([k, v]) => `<span><b>${k}</b> ${esc(v)}</span>`).join('')}
          </div>
          ${warn.length ? `<p class="wl-warn">⚠ ${warn.join(' ')}</p>` : ''}
          <p class="muted tiny">Reading this slip cost ${((usage.in || 0) + (usage.out || 0)).toLocaleString('en-US')} tokens
            — added to your usage as a handling fee.</p>
          <button class="btn btn-gold" id="wl-submit">Send for approval</button>
          <p class="dev-row-msg" id="wl-msg"></p>
        </div>
      </div>`;
    host.querySelector('#wl-submit').addEventListener('click', async e => {
      const amount = Number(host.querySelector('#wl-amt').value);
      const reference = host.querySelector('#wl-ref').value.trim();
      const msg = host.querySelector('#wl-msg');
      if (!(amount > 0)) { msg.textContent = 'Enter the amount you paid.'; msg.className = 'dev-row-msg bad'; return; }
      e.target.disabled = true; msg.textContent = 'Sending…'; msg.className = 'dev-row-msg muted';
      try {
        await Backend.createTopUp({
          amount_lkr: amount, reference: reference || userNo(user),
          slip: preview.length < 700000 ? preview : null,   // keep small slips for the approver to see
          extracted: f, status: 'pending'
        });
        bust();
        msg.textContent = '✓ Sent. You will see the balance once it is approved.';
        msg.className = 'dev-row-msg good';
        setTimeout(() => renderBilling(view, user), 1200);
      } catch (err) { msg.textContent = err.message || String(err); msg.className = 'dev-row-msg bad'; e.target.disabled = false; }
    });
  }

  /* A compact balance strip for the Profile page. */
  async function badge() {
    try {
      const s = await summary();
      return { balanceLkr: s.balanceLkr, text: lkr(s.balanceLkr), empty: s.balanceLkr <= 0 };
    } catch { return null; }
  }

  return { rate, loadRate, bustRate, settings, summary, bust, canSpend, blockedMessage, charge,
    readSlip, renderBilling, badge, lkr, userNo, DEFAULT_RATE };
})();
