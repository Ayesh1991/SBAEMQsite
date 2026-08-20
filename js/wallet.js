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

  /* ---------------- checking a slip against the account ----------------

     A slip credits the balance on the spot only if it says all four things:
     the right account, an amount, a date, and the payer's own user number.
     Anything missing and it goes for approval the way it always did.

     Account numbers are compared as DIGITS with leading zeros stripped,
     because the same account is printed both ways: 0087612781 on one bank's
     receipt and 87612781 on another's. Nothing else about the number is
     normalised — a different account is a different account.

     This is a provisional credit, not a verification. The developer still
     confirms it against the bank; until then it is flagged as unconfirmed
     and carries the deadline by which it will be looked at. */
  const digits = s => String(s == null ? '' : s).replace(/\D/g, '');
  const bare = s => digits(s).replace(/^0+/, '');
  function sameAccount(a, b) {
    const x = bare(a), y = bare(b);
    return !!x && !!y && x === y;
  }
  const beneficiary = () => {
    const w = settings();
    const c = cfg().wallet || {};
    return Object.assign({ account: '', bank: '', name: '' }, c.beneficiary || {}, w.beneficiary || {});
  };
  const instantOn = () => {
    const w = settings(), c = cfg().wallet || {};
    const v = w.instantActivation != null ? w.instantActivation : c.instantActivation;
    return v !== false && !!beneficiary().account;
  };
  const instantHours = () => Number(settings().instantHours || (cfg().wallet || {}).instantHours) || 24;

  /** Everything the slip has to show, and whether it showed it. */
  function slipCheck(fields, userRef) {
    const acct = beneficiary().account;
    // the receiving side only — a slip whose sender is this account is money
    // going the other way (mirrors maybeCreditSlip on the server)
    const onSlip = [fields.accountTo, fields.payee, ...(fields.accounts || [])];
    const fromIsUs = sameAccount(fields.accountFrom, acct);
    const ref = digits(fields.reference);
    const want = digits(userRef);
    return {
      account: { ok: !!acct && !fromIsUs && onSlip.some(v => sameAccount(v, acct)), label: 'Paid into ' + (acct || '—') },
      amount:  { ok: Number(fields.amount) > 0, label: 'Amount' },
      date:    { ok: !!String(fields.date || '').trim(), label: 'Transfer date' },
      reference: { ok: !!want && ref === want, label: 'Your reference (' + userRef + ')' }
    };
  }
  const slipComplete = c => Object.values(c).every(x => x.ok);

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
      usage: rows,                 // the metered rows themselves, for the statement
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
    /* Whether this slip credited itself was decided by the server, off the
       image, before this line ran — the browser is told the verdict, it does
       not reach it. See maybeCreditSlip in functions/api/explain.js. */
    return { fields: d, usage: data.usage || {}, preview: img.dataUrl,
      verdict: { credited: !!data.credited, match: data.match || null, reason: data.reason || '',
        confirmBy: data.confirmBy || 0, beneficiary: data.beneficiary || '', id: data.topUpId,
        flags: data.flags || [], risk: data.risk || '' } };
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
    const ben = beneficiary();

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
          ${ben.account ? `<div class="wl-acct">
            <span class="wl-acct-k">Pay into</span>
            <strong class="wl-acct-n">${esc(ben.account)}</strong>
            <button class="btn btn-ghost btn-sm" id="wl-bd">🏦 Billing details</button>
          </div>` : ''}
          <ol class="wl-steps">
            <li><strong>Pay into the account${ben.account ? ` above` : ` shown by the site owner`}.</strong> Put your user number
              <code class="wl-uno">${esc(userNo(user))}</code> in the <strong>remark / reference</strong> field —
              that is how the payment is matched to you.</li>
            <li><strong>Upload the slip</strong> below — the bank's PDF, a screenshot, or a photo.</li>
            ${instantOn() ? `<li><strong>It is credited straight away</strong> if the slip shows the account, the amount,
              the date and your reference. Otherwise it goes to the site owner for approval.</li>`
              : `<li>It is read automatically and sent for approval. Once approved the balance appears here.</li>`}
          </ol>
          <div class="wl-packs">${packs.map(p => `<span class="wl-pack">${lkr(p)}</span>`).join('')}
            <span class="muted tiny">common amounts — any amount works</span></div>

          <label class="btn btn-gold" style="cursor:pointer;margin-top:14px">⬆ Upload a payment slip
            <input type="file" id="wl-file" accept="image/*,application/pdf" hidden></label>
          <div id="wl-slip"></div>
        </div>

        <div class="card" data-animate>
          <div class="es-inbox-head">
            <h3 class="card-title">Where the money went</h3>
            <button class="btn btn-ghost btn-sm" id="wl-pb">📗 Full statement</button>
          </div>
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

    view.querySelector('#wl-bd')?.addEventListener('click', () => billingDetails(ben));
    view.querySelector('#wl-pb').addEventListener('click', () => passbook(s));

    view.querySelector('#wl-file').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const host = view.querySelector('#wl-slip');
      host.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>
        <p class="muted tiny">Reading the slip…</p>`;
      try {
        const { fields, usage, preview, verdict } = await readSlip(f);
        showSlip(host, fields, preview, usage, user, view, verdict);
      } catch (err) {
        host.innerHTML = `<p class="ai-error">${esc(err.message || err)}</p>`;
      }
    });
  }

  const userNo = u => String(u?.userNo || u?.user_no || (u?.id || '').replace(/\D/g, '').slice(-5) || '00001').padStart(5, '0');

  /* ---------------- dialogs ---------------- */

  function modal(label, inner, cls) {
    document.querySelector('.wl-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'os-modal wl-modal ' + (cls || '');
    wrap.innerHTML = `<div class="os-modal-back" data-close></div>
      <div class="os-modal-box" role="dialog" aria-modal="true" aria-label="${esc(label)}">${inner}</div>`;
    document.body.appendChild(wrap);
    const shut = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', onKey);
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', shut));
    return { wrap, shut };
  }

  /** Who to pay, in full — the thing you actually type into a banking app. */
  function billingDetails(ben) {
    const rows = [['Account number', ben.account], ['Account name', ben.name], ['Bank', ben.bank]]
      .filter(r => r[1]);
    const { wrap } = modal('Billing details', `
      <div class="os-modal-head">
        <div><p class="kicker">PAY INTO</p><h3>Billing details</h3></div>
        <button class="os-modal-x" data-close aria-label="Close">✕</button>
      </div>
      <div class="os-modal-body">
        <dl class="wl-bd">${rows.map(([k, v]) => `
          <div class="wl-bd-row">
            <dt>${esc(k)}</dt>
            <dd><span class="wl-bd-v">${esc(v)}</span>
              <button class="link-btn" data-copy="${esc(v)}">copy</button></dd>
          </div>`).join('')}</dl>
        <p class="muted tiny">Put your user number in the <strong>remark / reference</strong> field of the transfer —
          without it the payment cannot be matched to your account, and it will wait for the site owner instead of
          crediting straight away.</p>
      </div>
      <div class="os-modal-foot"><button class="btn btn-ghost btn-sm" data-close>Close</button></div>`);
    wrap.addEventListener('click', async e => {
      const b = e.target.closest('[data-copy]'); if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = '✓ copied';
        setTimeout(() => b.textContent = t, 1400); } catch { /* clipboard refused; the number is on screen anyway */ }
    });
  }

  /* Every credit and debit, newest first, with a running balance — the same
     shape as a bank passbook.

     One honest limitation is written on the page rather than papered over:
     top-ups carry a real timestamp, but AI spend is metered per day × model ×
     feature, not per call, so a debit line is that day's total for one
     mechanism and has a date without a time. Inventing a time would make the
     statement look more precise than the meter behind it. */
  function passbook(s) {
    const entries = [];
    (s.topUps || []).forEach(t => {
      if (t.status === 'declined') return;
      const when = new Date(t.created_at || Date.now());
      entries.push({ at: when.getTime(), timed: true, credit: Number(t.amount_lkr) || 0, debit: 0,
        title: t.extracted?.manual ? 'Credit added by the site owner' : 'Top-up',
        detail: [t.reference && t.reference !== 'manual' ? 'ref ' + t.reference : '',
                 t.extracted?.bank || '', t.extracted?.txnId ? 'txn ' + t.extracted.txnId : '',
                 t.note || ''].filter(Boolean).join(' · '),
        state: t.status === 'pending' ? 'pending'
             : (t.extracted?.provisional && !t.extracted?.confirmed) ? 'provisional' : '' });
    });
    (s.usage || []).forEach(r => {
      const cost = (typeof Billing !== 'undefined' ? Billing.lineCost(r) : 0) * s.rate;
      if (!(cost > 0)) return;
      entries.push({ at: new Date(r.day + 'T23:59:59').getTime(), timed: false, credit: 0, debit: cost,
        title: (typeof Billing !== 'undefined' ? Billing.featureIcon(r.feature) + ' ' + Billing.featureLabel(r.feature) : r.feature),
        detail: `${r.calls} call${r.calls === 1 ? '' : 's'} · ${(r.inputTokens + r.outputTokens).toLocaleString('en-US')} tokens · ${r.model}` });
    });
    entries.sort((a, b) => a.at - b.at);

    // a running balance only makes sense forwards; the table then reads newest first
    let bal = 0;
    entries.forEach(e => { if (e.state !== 'pending') bal += e.credit - e.debit; e.balance = bal; });
    const rows = entries.slice().reverse();
    const fmt = e => {
      const d = new Date(e.at);
      return e.timed
        ? d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
        : d.toLocaleDateString('en-GB', { dateStyle: 'medium' });
    };

    modal('Statement', `
      <div class="os-modal-head">
        <div><p class="kicker">EVERY CREDIT AND DEBIT</p><h3>Statement</h3>
          <p class="muted tiny">${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} ·
            topped up ${lkr(s.creditedLkr)} · used ${lkr(s.spentLkr)} · balance ${lkr(s.balanceLkr)}</p></div>
        <button class="os-modal-x" data-close aria-label="Close">✕</button>
      </div>
      <div class="os-modal-body">
        ${rows.length ? `<div class="table-scroll"><table class="table wl-pb">
          <thead><tr><th>Date</th><th>Detail</th><th class="num">Credit</th><th class="num">Debit</th><th class="num">Balance</th></tr></thead>
          <tbody>${rows.map(e => `
            <tr class="${e.state || ''}">
              <td class="muted nowrap">${esc(fmt(e))}${e.timed ? '' : '<span class="wl-pb-day">day total</span>'}</td>
              <td><strong>${esc(e.title)}</strong>${e.detail ? `<span class="wl-pb-d">${esc(e.detail)}</span>` : ''}
                ${e.state === 'pending' ? '<span class="wl-pb-tag">awaiting approval — not in the balance</span>' : ''}
                ${e.state === 'provisional' ? '<span class="wl-pb-tag gold">credited, owner still to confirm</span>' : ''}</td>
              <td class="num good">${e.credit ? lkr(e.credit) : ''}</td>
              <td class="num bad">${e.debit ? lkr(e.debit) : ''}</td>
              <td class="num"><strong>${lkr(e.balance)}</strong></td>
            </tr>`).join('')}</tbody>
        </table></div>` : `<p class="muted">Nothing has gone in or out yet.</p>`}
        <p class="muted tiny">AI usage is metered per day for each mechanism, so a debit line is that day's total for
          it and carries a date rather than a time. Top-ups carry the exact moment they arrived.</p>
      </div>
      <div class="os-modal-foot"><button class="btn btn-ghost btn-sm" data-close>Close</button></div>`, 'wl-pb-modal');
  }

  function showSlip(host, f, preview, usage, user, view, verdict) {
    const amt = Number(f.amount) || 0;
    const cur = String(f.currency || 'LKR').toUpperCase();
    const myRef = userNo(user);
    const v = verdict || {};
    const cost = `<p class="muted tiny">Reading this slip cost ${((usage.in || 0) + (usage.out || 0)).toLocaleString('en-US')} tokens
      — added to your usage as a handling fee.</p>`;

    /* Credited already. Nothing to submit, nothing to correct — the server
       read the account, the amount, the date and the reference off the image
       itself and wrote the credit before this page was drawn. */
    if (v.credited) {
      const by = v.confirmBy ? new Date(v.confirmBy) : null;
      host.innerHTML = `
        <div class="wl-slip wl-slip-done" data-animate>
          <div class="wl-slip-img">${/^data:image/.test(preview) ? `<img src="${preview}" alt="The slip you uploaded">` : '<span>PDF</span>'}</div>
          <div class="wl-slip-fields">
            <p class="wl-instant">⚡ Topped up ${lkr(amt)} — your balance is live now</p>
            <p class="muted">This slip named the account, the amount, the date and your reference
              <code>${esc(myRef)}</code>, so it was credited without waiting.
              ${by ? `The site owner confirms it against the bank statement by
                <strong>${esc(by.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</strong>.` : ''}</p>
            <div class="wl-read">
              ${[['Paid to', f.payee], ['Account', f.accountTo], ['Date', f.date], ['Bank', f.bank], ['Transaction', f.txnId]]
                .filter(x => x[1]).map(([k, val]) => `<span><b>${k}</b> ${esc(val)}</span>`).join('')}
            </div>
            ${cost}
          </div>
        </div>`;
      bust();
      setTimeout(() => renderBilling(view, user), 2400);
      return;
    }

    /* Not credited: say exactly which of the four things was missing, then
       fall back to the approval queue that has always been there. */
    const m = v.match || null;
    const rows = m
      ? [['Paid into ' + (v.beneficiary || 'the right account'), m.account],
         ['An amount', m.amount], ['A transfer date', m.date],
         [`Your reference (${myRef})`, m.reference]]
      : [];
    const why = { off: 'Instant top-up is switched off at the moment.',
      'no-account': 'The site owner has not set the account number yet.',
      'not-configured': 'Instant top-up is not finished being set up on the server.',
      duplicate: 'This slip has already been used — the same transfer cannot be credited twice.',
      'day-limit': 'You have reached the limit for top-ups credited without a check today. This one still goes through once the site owner approves it.',
      screened: '' }[v.reason];
    // when the screening stopped it, the reasons ARE the explanation
    const blockers = (v.flags || []).filter(x => x.level === 'block');

    const warn = [];
    if (cur !== 'LKR') warn.push(`The slip says <strong>${esc(cur)}</strong>, not rupees — check the amount before submitting.`);
    if (!amt) warn.push('No amount could be read — type it in.');
    if ((f.confidence || 0) < 0.5) warn.push('This does not look like a completed payment slip.');

    /* The amount is whatever the SLIP says, and is not editable. Letting it
       be typed meant a 100-rupee transfer could be submitted as 10,000 and
       the approver had to catch it by eye. If nothing could be read it has to
       be typed, and that is recorded so the developer's queue can say so. */
    host.innerHTML = `
      <div class="wl-slip" data-animate>
        <div class="wl-slip-img">${/^data:image/.test(preview) ? `<img src="${preview}" alt="The slip you uploaded">` : '<span>PDF</span>'}</div>
        <div class="wl-slip-fields">
          <h4>What was read from the slip</h4>
          ${amt ? `<div class="wl-f wl-fixed"><span>Amount</span>
            <strong class="wl-amt-n">${lkr(amt)}</strong>
            <span class="muted tiny">read from the slip — it cannot be changed here. If it is wrong, upload the right slip.</span>
          </div><input type="hidden" id="wl-amt" value="${amt}">`
          : `<label class="wl-f"><span>Amount (LKR) — none could be read from this slip</span>
              <input type="number" id="wl-amt" value="" min="1" step="0.01"></label>
             <p class="muted tiny">Type what you actually paid. The site owner checks it against the slip before it is
               credited, so an amount that does not match will be declined.</p>`}
          <label class="wl-f"><span>Your reference / remark</span><input type="text" id="wl-ref" value="${esc(f.reference || '')}" placeholder="${esc(myRef)}"></label>
          <div class="wl-read">
            ${[['Paid to', f.payee], ['Account', f.accountTo], ['Date', f.date], ['Bank', f.bank],
               ['Transaction', f.txnId], ['Status', f.status]]
              .filter(x => x[1]).map(([k, val]) => `<span><b>${k}</b> ${esc(val)}</span>`).join('')}
          </div>
          ${rows.length || why || blockers.length ? `<div class="wl-check">
            <p class="wl-check-h">This one needs the owner's approval</p>
            ${rows.length ? `<ul class="wl-check-list">${rows.map(([label, ok]) =>
              `<li class="${ok ? 'ok' : 'no'}"><span>${ok ? '✓' : '○'}</span>${esc(label)}</li>`).join('')}</ul>` : ''}
            ${blockers.length ? `<ul class="wl-check-list wl-blockers">${blockers.map(b =>
              `<li class="no"><span>!</span>${esc(b.text)}</li>`).join('')}</ul>` : ''}
            <p class="muted tiny">${why ? esc(why)
              : blockers.length ? 'Nothing is lost — the site owner checks it against the bank statement and credits it by hand.'
              : `A slip showing all four is topped up the moment you upload it. Correcting a field here does not change that —
                 the check is made on the image itself, not on what is typed.`}</p>
          </div>` : ''}
          ${warn.length ? `<p class="wl-warn">⚠ ${warn.join(' ')}</p>` : ''}
          ${cost}
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
          amount_lkr: amount, reference: reference || myRef,
          slip: preview.length < 700000 ? preview : null,   // keep small slips for the approver to see
          extracted: Object.assign({}, f, m ? { matched: m, beneficiary: v.beneficiary } : null,
            // the screening the server already did travels with the row, so
            // the approver sees why this one did not credit itself
            { risk: v.risk || '', flags: v.flags || [], autoReason: v.reason || '' },
            // an amount the reader could not find, and the payer typed, is the
            // one number on the row that nothing has checked — say so
            amt ? null : { amountTyped: amount }),
          status: 'pending'
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
    readSlip, renderBilling, badge, lkr, userNo, DEFAULT_RATE,
    beneficiary, instantOn, instantHours, slipCheck, slipComplete, sameAccount };
})();
