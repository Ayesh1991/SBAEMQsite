/* ============================================================
   billing.js — true token-metered billing.

   Source of truth: the ai_token_usage table, filled server-side with
   the EXACT token counts each provider reported (Gemini usageMetadata,
   Anthropic usage) per user × day × provider × model. This module turns
   those rows into dollar costs (rates from AUREUM_CONFIG.ai.pricing,
   USD per 1M tokens) and renders a commercial invoice that downloads
   as JPEG / PNG / SVG or prints to PDF.

   Used by dev-console.js (Users & access → cost columns + 🧾 Bill).
   ============================================================ */

const Billing = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- pricing ---------------- */

  const table = () => (window.AUREUM_CONFIG?.ai?.pricing) || {};

  // Longest-prefix match so 'gemini-2.5-flash-lite-001' → the lite rate,
  // 'claude-haiku-4-5-20251001' → the Haiku rate, and anything unknown
  // still lands on a provider-level fallback instead of $0.
  function rateFor(model) {
    const t = table();
    const m = String(model || '').toLowerCase();
    let best = null;
    for (const prefix of Object.keys(t)) {
      if (m.startsWith(prefix.toLowerCase()) && (!best || prefix.length > best.length)) best = prefix;
    }
    if (best) return Object.assign({ id: best }, t[best]);
    return { id: m, in: 0, out: 0, label: model + ' (no rate set)' };
  }
  const lineCost = r => (r.inputTokens / 1e6) * rateFor(r.model).in + (r.outputTokens / 1e6) * rateFor(r.model).out;

  /* ---------------- aggregation ---------------- */

  const monthKey = d => String(d).slice(0, 7);                    // 'YYYY-MM'
  const thisMonth = () => new Date().toISOString().slice(0, 7);

  function rowsFor(all, userId, month) {
    return (all || []).filter(r => r.userId === userId && (!month || monthKey(r.day) === month));
  }

  // one line per provider+model with rates and cost attached
  function summarise(rows) {
    const map = {};
    (rows || []).forEach(r => {
      const k = r.provider + '|' + r.model;
      const l = map[k] || (map[k] = { provider: r.provider, model: r.model, calls: 0, inputTokens: 0, outputTokens: 0 });
      l.calls += r.calls; l.inputTokens += r.inputTokens; l.outputTokens += r.outputTokens;
    });
    const lines = Object.values(map).map(l => {
      const rate = rateFor(l.model);
      return Object.assign(l, { label: rate.label || l.model, rateIn: rate.in, rateOut: rate.out, cost: lineCost(l) });
    }).sort((a, b) => a.provider.localeCompare(b.provider) || b.cost - a.cost);
    const byProvider = {};
    lines.forEach(l => byProvider[l.provider] = (byProvider[l.provider] || 0) + l.cost);
    return { lines, byProvider,
      total: lines.reduce((s, l) => s + l.cost, 0),
      calls: lines.reduce((s, l) => s + l.calls, 0),
      inputTokens: lines.reduce((s, l) => s + l.inputTokens, 0),
      outputTokens: lines.reduce((s, l) => s + l.outputTokens, 0) };
  }

  /* ---------------- shared pools (platform AI jobs) ---------------- */

  const FEATURE_LABELS = {
    // shared pools
    question_tagger: 'Question tagger', behaviour_insights: 'Behaviour insights',
    question_auditor: 'Question auditor', readiness_forecaster: 'Readiness forecaster',
    weekly_digest: 'Weekly digest', rationale_enhancer: 'Rationale enhancer',
    // personal mechanisms (what a user spends their own tokens on)
    tutor: 'AI tutor', coach: 'Mock coach', flashcards: 'AI flashcards', study_aids: 'Study aids'
  };
  const FEATURE_ICON = { tutor: '✨', coach: '🎯', flashcards: '🃏', study_aids: '📄',
    question_tagger: '🏷', behaviour_insights: '🔬', question_auditor: '⚖️' };
  const featureLabel = f => FEATURE_LABELS[f] || String(f).replace(/_/g, ' ');
  const featureIcon = f => FEATURE_ICON[f] || '•';

  /**
   * This user's share of each shared pool for a month (null = all time).
   *
   * Two modes:
   *  • DEVELOPER (full roster): sharedCtx = { rows, features, users } —
   *    eligibility is derived by filtering the user list.
   *  • SELF (a user viewing their own bill): sharedCtx = { rows, features,
   *    counts, selfUser } — the user can't read other profiles, so the
   *    server returns just the eligible COUNTS per split policy, and the
   *    viewer's own eligibility is decided from their own flags/prefs.
   * Split per feature: 'all' | 'simulator' (simulator users + dev) | 'dev'.
   */
  function sharedLines(user, sharedCtx, month) {
    if (!sharedCtx?.rows?.length) return [];
    const devMail = (window.AUREUM_CONFIG?.developer?.email || '').toLowerCase();
    const isDev = u => (u.email || '').toLowerCase() === devMail;
    const pools = {};
    sharedCtx.rows.filter(r => !month || monthKey(r.day) === month).forEach(r => {
      pools[r.feature] = (pools[r.feature] || 0) + lineCost({ model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
    });
    const selfMode = !!sharedCtx.counts;
    const meEligible = split => selfMode
      ? (split === 'dev' ? isDev(user) : split === 'all' ? true
          : (isDev(user) || user.featureFlags?.simulator || user.prefs?.simulator))
      : null;
    const out = [];
    for (const [feature, cost] of Object.entries(pools)) {
      if (cost <= 0) continue;
      const split = sharedCtx.features?.[feature]?.split || 'simulator';
      if (selfMode) {
        if (!meEligible(split)) continue;
        const n = Math.max(1, sharedCtx.counts[split] || 1);
        out.push({ feature, label: featureLabel(feature), n, cost: cost / n });
        continue;
      }
      if (!sharedCtx.users?.length) continue;
      let eligible = split === 'dev' ? sharedCtx.users.filter(isDev)
        : split === 'all' ? sharedCtx.users
        : sharedCtx.users.filter(u => isDev(u) || u.featureFlags?.simulator || u.prefs?.simulator);
      if (!eligible.length) eligible = sharedCtx.users.filter(isDev);
      if (!eligible.some(u => u.id === user.id)) continue;
      out.push({ feature, label: featureLabel(feature), n: eligible.length, cost: cost / eligible.length });
    }
    return out.sort((a, b) => b.cost - a.cost);
  }
  /** { userId: {thisMonth, allTime} } from the shared pools. */
  function sharedTotals(sharedCtx) {
    const cur = thisMonth();
    const out = {};
    (sharedCtx?.users || []).forEach(u => {
      const m = sharedLines(u, sharedCtx, cur).reduce((s, l) => s + l.cost, 0);
      const a = sharedLines(u, sharedCtx, null).reduce((s, l) => s + l.cost, 0);
      if (m || a) out[u.id] = { thisMonth: m, allTime: a };
    });
    return out;
  }

  /* ---------------- a single user's own view ---------------- */

  // Personal spend grouped by MECHANISM (tutor / coach / flashcards …).
  // rows are this user's ai_token_usage rows (each carries a `feature`).
  function personalByFeature(rows, month) {
    const map = {};
    (rows || []).filter(r => !month || monthKey(r.day) === month).forEach(r => {
      const k = r.feature || 'tutor';
      const l = map[k] || (map[k] = { feature: k, label: featureLabel(k), icon: featureIcon(k), calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 });
      l.calls += r.calls; l.inputTokens += r.inputTokens; l.outputTokens += r.outputTokens;
      l.cost += lineCost(r);
    });
    return Object.values(map).sort((a, b) => b.cost - a.cost);
  }

  // Last `days` of daily total cost (personal only) for a sparkline.
  function dailyCost(rows, days = 30) {
    const byDay = {};
    (rows || []).forEach(r => { byDay[r.day] = (byDay[r.day] || 0) + lineCost(r); });
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      out.push({ day: d, cost: byDay[d] || 0 });
    }
    return out;
  }

  // A full self-summary: personal mechanisms + shared-pool shares + totals,
  // for a month (null = all-time). sharedCtx uses the counts (self) mode.
  function mySummary(user, myRows, sharedCtx, month) {
    const personal = personalByFeature(myRows, month);
    const shared = sharedLines(user, sharedCtx, month || null);
    const personalTotal = personal.reduce((s, l) => s + l.cost, 0);
    const sharedTotal = shared.reduce((s, l) => s + l.cost, 0);
    return {
      personal, shared,
      personalTotal, sharedTotal, total: personalTotal + sharedTotal,
      calls: personal.reduce((s, l) => s + l.calls, 0),
      tokens: personal.reduce((s, l) => s + l.inputTokens + l.outputTokens, 0)
    };
  }

  // per-user totals for the Users table: { userId: {thisMonth, allTime} }
  function userTotals(all) {
    const cur = thisMonth();
    const out = {};
    (all || []).forEach(r => {
      const u = out[r.userId] || (out[r.userId] = { thisMonth: 0, allTime: 0 });
      const c = lineCost(r);
      u.allTime += c;
      if (monthKey(r.day) === cur) u.thisMonth += c;
    });
    return out;
  }

  /* ---------------- formatting ---------------- */

  const fmtInt = n => Number(n || 0).toLocaleString('en-US');
  const usd = (n, dp) => '$' + Number(n || 0).toFixed(dp == null ? 2 : dp);
  const monthLabel = m => m
    ? new Date(m + '-15').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : 'All activity to date';

  /* ---------------- invoice data ---------------- */

  function invoice(user, allRows, month, sharedCtx) {
    const rows = rowsFor(allRows, user.id, month || null);
    const sum = summarise(rows);
    const shared = sharedLines(user, sharedCtx, month || null);
    const stamp = (month || thisMonth()).replace('-', '');
    return {
      number: `AUR-${stamp}-${String(user.id || '').replace(/-/g, '').slice(0, 6).toUpperCase() || 'LOCAL'}`,
      issued: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      period: monthLabel(month),
      user, month: month || null, sum, shared,
      grandTotal: sum.total + shared.reduce((s, l) => s + l.cost, 0)
    };
  }

  /* ---------------- invoice rendering (SVG, print-white) ---------------- */

  const PROVIDER_NAMES = { gemini: 'Google Gemini', claude: 'Anthropic Claude' };
  const NAVY = '#101a36', GOLD = '#b8860b', LIGHT = '#5b6478', RULE = '#d9dde8';
  const SERIF = "Georgia,'Times New Roman',serif", SANS = 'Arial,Helvetica,sans-serif';
  const W = 900, PAD = 56;

  function invoiceSVG(inv) {
    const { user, sum } = inv;
    const providers = [...new Set(sum.lines.map(l => l.provider))];
    const shared = inv.shared || [];
    // header/bill-to/table-head ≈ 290px, each provider block 52px + 34px per
    // line, then the total band and footer — sized to fit with no dead space.
    const bodySpan = (sum.lines.length ? providers.length * 52 + sum.lines.length * 34 : 44)
      + (shared.length ? 52 + shared.length * 26 : 0);
    const H = Math.max(640, 290 + bodySpan + 204);
    let y = 0;
    const parts = [];
    const t = (x, yy, text, size, fill, opts = {}) =>
      `<text x="${x}" y="${yy}" font-family="${opts.serif ? SERIF : SANS}" font-size="${size}" fill="${fill}"` +
      `${opts.bold ? ' font-weight="bold"' : ''}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}` +
      `${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ''}${opts.italic ? ' font-style="italic"' : ''}>${esc(text)}</text>`;
    const line = (x1, yy, x2, stroke, w2) => `<line x1="${x1}" y1="${yy}" x2="${x2}" y2="${yy}" stroke="${stroke}" stroke-width="${w2 || 1}"/>`;

    parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
    parts.push(`<rect width="${W}" height="10" fill="${GOLD}"/>`);

    // header
    y = 78;
    parts.push(t(PAD, y, 'AUREUM', 34, NAVY, { serif: true, bold: true, spacing: 4 }));
    parts.push(t(PAD, y + 22, 'Pathway to MD · SBA & EMQ Mastery', 12, LIGHT, { spacing: 1 }));
    parts.push(t(PAD, y + 40, 'ayeshmantha@gmail.com', 11, LIGHT));
    parts.push(t(W - PAD, y - 8, 'INVOICE', 30, GOLD, { anchor: 'end', spacing: 6 }));
    parts.push(t(W - PAD, y + 16, `No. ${inv.number}`, 12, NAVY, { anchor: 'end', bold: true }));
    parts.push(t(W - PAD, y + 34, `Issued ${inv.issued}`, 11, LIGHT, { anchor: 'end' }));
    y = 150; parts.push(line(PAD, y, W - PAD, RULE));

    // billed to + period
    y += 30;
    parts.push(t(PAD, y, 'BILLED TO', 10, GOLD, { bold: true, spacing: 2 }));
    parts.push(t(PAD, y + 22, user.name || user.email || 'Account holder', 15, NAVY, { bold: true }));
    parts.push(t(PAD, y + 40, user.email || '', 11, LIGHT));
    if (user.position) parts.push(t(PAD, y + 56, user.position, 11, LIGHT));
    parts.push(t(W - PAD, y, 'BILLING PERIOD', 10, GOLD, { bold: true, spacing: 2, anchor: 'end' }));
    parts.push(t(W - PAD, y + 22, inv.period, 14, NAVY, { anchor: 'end', bold: true }));
    parts.push(t(W - PAD, y + 40, `${fmtInt(sum.calls)} AI calls · ${fmtInt(sum.inputTokens + sum.outputTokens)} tokens metered`, 11, LIGHT, { anchor: 'end' }));

    // table header
    y += 90;
    const cols = { model: PAD, calls: 430, tin: 520, tout: 630, rate: 720, amt: W - PAD };
    parts.push(`<rect x="${PAD - 12}" y="${y - 20}" width="${W - 2 * PAD + 24}" height="30" fill="#f2f4fa"/>`);
    parts.push(t(cols.model, y, 'SERVICE / MODEL', 10, NAVY, { bold: true, spacing: 1 }));
    parts.push(t(cols.calls, y, 'CALLS', 10, NAVY, { bold: true, anchor: 'end' }));
    parts.push(t(cols.tin, y, 'TOKENS IN', 10, NAVY, { bold: true, anchor: 'end' }));
    parts.push(t(cols.tout, y, 'TOKENS OUT', 10, NAVY, { bold: true, anchor: 'end' }));
    parts.push(t(cols.rate, y, 'RATE /1M', 10, NAVY, { bold: true, anchor: 'end' }));
    parts.push(t(cols.amt, y, 'AMOUNT (USD)', 10, NAVY, { bold: true, anchor: 'end' }));
    y += 20;

    if (!sum.lines.length) {
      y += 24;
      parts.push(t(PAD, y, 'No metered AI usage in this period.', 12, LIGHT, { italic: true }));
      y += 10;
    }
    providers.forEach(p => {
      y += 26;
      parts.push(t(PAD, y, PROVIDER_NAMES[p] || p, 12, GOLD, { bold: true, spacing: 1 }));
      sum.lines.filter(l => l.provider === p).forEach(l => {
        y += 26;
        parts.push(t(PAD + 14, y, l.label, 12, NAVY));
        parts.push(t(PAD + 14, y + 13, l.model, 9, LIGHT));
        parts.push(t(cols.calls, y, fmtInt(l.calls), 11, NAVY, { anchor: 'end' }));
        parts.push(t(cols.tin, y, fmtInt(l.inputTokens), 11, NAVY, { anchor: 'end' }));
        parts.push(t(cols.tout, y, fmtInt(l.outputTokens), 11, NAVY, { anchor: 'end' }));
        parts.push(t(cols.rate, y, `${usd(l.rateIn, 2)}/${usd(l.rateOut, 2)}`, 10, LIGHT, { anchor: 'end' }));
        parts.push(t(cols.amt, y, usd(l.cost, 4), 11, NAVY, { anchor: 'end', bold: true }));
        y += 8;
      });
      y += 18;
      parts.push(line(430, y - 12, W - PAD, RULE));
      parts.push(t(cols.rate, y + 2, `${PROVIDER_NAMES[p] || p} subtotal`, 10, LIGHT, { anchor: 'end' }));
      parts.push(t(cols.amt, y + 2, usd(sum.byProvider[p], 4), 11, NAVY, { anchor: 'end', bold: true }));
      y += 8;
    });

    // shared platform services (this user's split of pooled AI jobs)
    if (shared.length) {
      y += 26;
      parts.push(t(PAD, y, 'Platform AI services (shared pool)', 12, GOLD, { bold: true, spacing: 1 }));
      shared.forEach(l => {
        y += 24;
        parts.push(t(PAD + 14, y, l.label, 12, NAVY));
        parts.push(t(cols.rate, y, `1/${l.n} share of pool`, 10, LIGHT, { anchor: 'end' }));
        parts.push(t(cols.amt, y, usd(l.cost, 4), 11, NAVY, { anchor: 'end', bold: true }));
      });
      y += 10;
    }

    // total band
    y += 34;
    const totalDue = inv.grandTotal != null ? inv.grandTotal : sum.total;
    parts.push(`<rect x="${W - PAD - 320}" y="${y - 24}" width="320" height="44" fill="${NAVY}"/>`);
    parts.push(t(W - PAD - 304, y + 4, 'TOTAL DUE', 12, '#f4c95d', { bold: true, spacing: 2 }));
    parts.push(t(W - PAD - 14, y + 5, usd(totalDue, 2), 19, '#ffffff', { anchor: 'end', bold: true }));

    // footer
    const fy = H - 74;
    parts.push(line(PAD, fy - 26, W - PAD, RULE));
    parts.push(t(PAD, fy, 'Metered from provider-reported token counts (Google usageMetadata / Anthropic usage) — billing-grade accuracy.', 10, LIGHT));
    parts.push(t(PAD, fy + 16, 'Rates are USD per 1,000,000 tokens. Line amounts shown to 4 decimals; the total due is rounded to the cent.', 10, LIGHT));
    parts.push(t(PAD, fy + 38, 'Thank you — AUREUM · Pathway to MD', 11, NAVY, { serif: true, italic: true }));
    parts.push(`<rect y="${H - 10}" width="${W}" height="10" fill="${GOLD}"/>`);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
  }

  /* ---------------- downloads ---------------- */

  function download(blob, filename) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(u); }, 1500);
  }
  function svgToRaster(svg, filename, type) {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const w = img.naturalWidth || W, h = img.naturalHeight || 1200;
      const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
      const g = c.getContext('2d'); g.scale(2, 2);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);   // JPEG has no alpha — force white
      g.drawImage(img, 0, 0, w, h);
      c.toBlob(b => { if (b) download(b, filename); URL.revokeObjectURL(url); }, type, 0.95);
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Could not rasterise the invoice — use the SVG download.'); };
    img.src = url;
  }

  function printInvoice(svg, title) {
    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups for this site to print / save as PDF.'); return; }
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<style>body{margin:0;display:flex;justify-content:center}svg{max-width:100%;height:auto}@media print{body{margin:0}}</style></head>` +
      `<body>${svg}<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
    w.document.close();
  }

  /* ---------------- bill modal (Users & access) ---------------- */

  function monthsPresent(all, userId) {
    const set = new Set(rowsFor(all, userId, null).map(r => monthKey(r.day)));
    set.add(thisMonth());
    return [...set].sort().reverse();
  }

  function openBillModal(user, allRows, sharedCtx) {
    document.querySelector('.bill-overlay')?.remove();
    const months = monthsPresent(allRows, user.id);
    const overlay = document.createElement('div');
    overlay.className = 'bill-overlay';
    overlay.innerHTML = `
      <div class="bill-modal" role="dialog" aria-label="Invoice">
        <div class="bill-modal-head">
          <strong>🧾 Invoice — ${esc(user.name || user.email)}</strong>
          <select id="bill-month" title="Billing period">
            ${months.map(m => `<option value="${m}">${esc(monthLabel(m))}</option>`).join('')}
            <option value="">All activity to date</option>
          </select>
          <button class="ai-x" data-bill-close aria-label="Close">✕</button>
        </div>
        <div class="bill-preview" id="bill-preview"></div>
        <div class="bill-actions">
          <button class="btn btn-gold btn-sm" data-dl="jpeg">⬇ JPEG</button>
          <button class="btn btn-ghost btn-sm" data-dl="png">⬇ PNG</button>
          <button class="btn btn-ghost btn-sm" data-dl="svg">⬇ SVG</button>
          <button class="btn btn-ghost btn-sm" data-dl="print">🖨 Print / PDF</button>
          <span class="bill-total" id="bill-total"></span>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    let currentSVG = '', currentInv = null;
    const draw = () => {
      const m = overlay.querySelector('#bill-month').value || null;
      currentInv = invoice(user, allRows, m, sharedCtx);
      currentSVG = invoiceSVG(currentInv);
      overlay.querySelector('#bill-preview').innerHTML = currentSVG;
      overlay.querySelector('#bill-total').textContent = `Total due: ${usd(currentInv.grandTotal, 2)}`;
    };
    const base = () => `${currentInv.number}-${(user.name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    overlay.querySelector('#bill-month').addEventListener('change', draw);
    overlay.querySelector('[data-bill-close]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('[data-dl="jpeg"]').addEventListener('click', () => svgToRaster(currentSVG, base() + '.jpg', 'image/jpeg'));
    overlay.querySelector('[data-dl="png"]').addEventListener('click', () => svgToRaster(currentSVG, base() + '.png', 'image/png'));
    overlay.querySelector('[data-dl="svg"]').addEventListener('click', () => download(new Blob([currentSVG], { type: 'image/svg+xml' }), base() + '.svg'));
    overlay.querySelector('[data-dl="print"]').addEventListener('click', () => printInvoice(currentSVG, 'Invoice ' + currentInv.number));
    draw();
  }

  return { rateFor, summarise, userTotals, sharedLines, sharedTotals,
    personalByFeature, dailyCost, mySummary, featureLabel, featureIcon,
    rowsFor, invoice, invoiceSVG, openBillModal, usd, fmtInt, monthLabel };
})();
