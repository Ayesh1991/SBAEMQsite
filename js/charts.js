/* ============================================================
   charts.js — hand-rolled SVG charts (no chart library).

   Palette validated for the dark surface #12152b:
     series blue #3987e5 · status good #0ca30c · critical #d03b3b
   Marks: 2px lines, ≥8px hover targets, 4px rounded bar ends,
   2px surface gaps between fills, recessive grid, text in ink
   tokens (never the series colour). Single-series charts carry
   no legend — the title names the series.
   ============================================================ */

const Charts = (() => {
  const INK = {
    primary: '#f4f5fb',
    secondary: '#a7abc4',
    muted: '#7c8099',
    grid: '#262a45',
    baseline: '#343956',
    series: '#3987e5',
    seriesSoft: 'rgba(57,135,229,0.16)',
    good: '#0ca30c',
    critical: '#d03b3b'
  };

  const svgNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs = {}) {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  /* ---------------- score trend (line) ---------------- */

  /**
   * points: [{date, percent, title, mode}] oldest → newest.
   * Renders a single-series line with per-point hover tooltip.
   */
  function scoreTrend(container, points) {
    container.innerHTML = '';
    if (points.length < 2) {
      container.innerHTML = '<p class="chart-empty">Complete two sets and your score trend appears here.</p>';
      return;
    }

    const W = 640, H = 220, pad = { t: 16, r: 16, b: 28, l: 40 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
      'aria-label': 'Score trend across recent attempts' });

    const x = i => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = p => pad.t + ih - (p / 100) * ih;

    // recessive horizontal grid at 0/25/50/75/100
    for (const g of [0, 25, 50, 75, 100]) {
      svg.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: y(g), y2: y(g),
        stroke: g === 0 ? INK.baseline : INK.grid, 'stroke-width': 1 }));
      const label = el('text', { x: pad.l - 8, y: y(g) + 4, 'text-anchor': 'end',
        fill: INK.muted, 'font-size': 11 });
      label.textContent = g;
      svg.appendChild(label);
    }

    // area wash + 2px line
    const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.percent).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', {
      d: `${linePath} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`,
      fill: INK.seriesSoft, stroke: 'none'
    }));
    svg.appendChild(el('path', { d: linePath, fill: 'none', stroke: INK.series,
      'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // hover layer: visible dot + generous invisible hit target per point
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);

    points.forEach((p, i) => {
      svg.appendChild(el('circle', { cx: x(i), cy: y(p.percent), r: 3.5,
        fill: INK.series, stroke: '#12152b', 'stroke-width': 2 }));
      const hit = el('circle', { cx: x(i), cy: y(p.percent), r: 14, fill: 'transparent', class: 'chart-hit' });
      hit.addEventListener('pointerenter', () => {
        tip.innerHTML = `<strong>${p.percent}%</strong> · ${escapeHTML(p.title || '')}<br><span>${p.mode || ''} · ${fmtDate(p.date)}</span>`;
        tip.hidden = false;
        const rect = container.getBoundingClientRect();
        const px = (x(i) / W) * rect.width;
        tip.style.left = Math.min(Math.max(px, 70), rect.width - 70) + 'px';
        tip.style.top = ((y(p.percent) / H) * rect.height - 12) + 'px';
      });
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
      svg.appendChild(hit);
    });

    container.appendChild(svg);
  }

  /* ---------------- section accuracy (bars) ---------------- */

  /**
   * rows: [{label, percent, correct, total}] — horizontal bars,
   * single hue, value labelled directly at the bar end.
   */
  function sectionBars(container, rows) {
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<p class="chart-empty">Section accuracy appears once you finish a set.</p>';
      return;
    }
    rows = rows.slice(0, 8);

    const rowH = 40, W = 640, pad = { l: 8, r: 52 };
    const H = rows.length * rowH + 8;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
      'aria-label': 'Accuracy by curriculum section' });
    const iw = W - pad.l - pad.r;

    rows.forEach((r, i) => {
      const cy = i * rowH + 8;
      const label = el('text', { x: pad.l, y: cy + 11, fill: INK.secondary, 'font-size': 12 });
      label.textContent = r.label;
      svg.appendChild(label);

      // track + thin bar with 4px rounded data-end (baseline end square via overdraw)
      svg.appendChild(el('rect', { x: pad.l, y: cy + 18, width: iw, height: 8, rx: 4, fill: INK.grid }));
      const w = Math.max(8, (r.percent / 100) * iw);
      svg.appendChild(el('rect', { x: pad.l, y: cy + 18, width: w, height: 8, rx: 4, fill: INK.series }));

      const val = el('text', { x: pad.l + iw + 8, y: cy + 26, fill: INK.primary,
        'font-size': 12, 'font-weight': 600 });
      val.textContent = r.percent + '%';
      svg.appendChild(val);

      const title = el('title');
      title.textContent = `${r.label}: ${r.correct}/${r.total} correct (${r.percent}%)`;
      svg.appendChild(title);
    });

    container.appendChild(svg);
  }

  /* ---------------- accuracy ring ---------------- */

  /** A single-value donut: percent in centre, arc in series blue. */
  function ring(container, percent, caption) {
    container.innerHTML = '';
    const size = 132, r = 54, c = 2 * Math.PI * r;
    const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'ring-svg', role: 'img',
      'aria-label': `${caption}: ${percent === null ? 'no data yet' : percent + ' percent'}` });

    svg.appendChild(el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none',
      stroke: INK.grid, 'stroke-width': 10 }));
    if (percent !== null) {
      const arc = el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none',
        stroke: INK.series, 'stroke-width': 10, 'stroke-linecap': 'round',
        'stroke-dasharray': `${(percent / 100) * c} ${c}`,
        transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring-arc' });
      svg.appendChild(arc);
    }
    const num = el('text', { x: size / 2, y: size / 2 + 2, 'text-anchor': 'middle',
      fill: INK.primary, 'font-size': 26, 'font-weight': 700 });
    num.textContent = percent === null ? '—' : percent + '%';
    svg.appendChild(num);
    const cap = el('text', { x: size / 2, y: size / 2 + 22, 'text-anchor': 'middle',
      fill: INK.muted, 'font-size': 10, 'letter-spacing': '0.08em' });
    cap.textContent = caption.toUpperCase();
    svg.appendChild(cap);

    container.appendChild(svg);
  }

  /* ---------------- helpers ---------------- */

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    } catch { return ''; }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }


  /** el() sets attributes only; this one also carries a text child. */
  function txt(tag, attrs, text) { const n = el(tag, attrs); n.textContent = String(text); return n; }

  /* ---------------- OSCE progress ----------------
     Two pictures, because they answer different questions. The histogram
     answers "where do my station scores sit, and how many clear the pass
     mark"; the trend answers "am I getting better". Both are drawn as plain
     SVG so they print and theme like everything else. */
  function histogram(container, values, opts = {}) {
    if (!container) return;
    const bins = opts.bins || [[0,39],[40,49],[50,59],[60,69],[70,79],[80,89],[90,100]];
    const counts = bins.map(([lo, hi]) => values.filter(v => v >= lo && v <= hi).length);
    const max = Math.max(1, ...counts);
    const W = 520, H = 180, PAD = 28, bw = (W - PAD * 2) / bins.length;
    const pass = opts.passMark == null ? 70 : opts.passMark;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch-svg ch-hist', role: 'img',
      'aria-label': `${values.length} station scores by band` });
    bins.forEach(([lo, hi], i) => {
      const h = (counts[i] / max) * (H - PAD * 2);
      const x = PAD + i * bw + 4, y = H - PAD - h;
      svg.appendChild(el('rect', { x, y, width: bw - 8, height: Math.max(h, counts[i] ? 3 : 0), rx: 4,
        class: 'ch-bar ' + (lo >= pass ? 'is-pass' : lo >= pass - 20 ? 'is-near' : 'is-fail') }));
      if (counts[i]) svg.appendChild(txt('text', { x: x + (bw - 8) / 2, y: y - 5, class: 'ch-n', 'text-anchor': 'middle' }, String(counts[i])));
      svg.appendChild(txt('text', { x: x + (bw - 8) / 2, y: H - PAD + 14, class: 'ch-ax', 'text-anchor': 'middle' },
        lo === 0 ? '<40' : hi === 100 ? '90+' : `${lo}s`));
    });
    // the pass mark, where it actually falls
    const pi = bins.findIndex(([lo]) => lo >= pass);
    if (pi >= 0) {
      const px = PAD + pi * bw;
      svg.appendChild(el('line', { x1: px, y1: PAD - 6, x2: px, y2: H - PAD, class: 'ch-pass' }));
      svg.appendChild(txt('text', { x: px + 4, y: PAD - 10, class: 'ch-ax is-pass' }, `pass ${pass}%`));
    }
    container.innerHTML = ''; container.appendChild(svg);
  }

  /** Station-by-station line with the pass mark drawn across it. */
  function osceTrend(container, points, passPct = 70) {
    if (!container) return;
    const W = 520, H = 180, PAD = 30;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch-svg', role: 'img',
      'aria-label': `${points.length} OSCE attempts over time` });
    const y = p => H - PAD - (p / 100) * (H - PAD * 2);
    const x = i => points.length < 2 ? W / 2 : PAD + (i / (points.length - 1)) * (W - PAD * 2);
    [0, 50, 100].forEach(v => {
      svg.appendChild(el('line', { x1: PAD, y1: y(v), x2: W - PAD, y2: y(v), class: 'ch-grid' }));
      svg.appendChild(txt('text', { x: 6, y: y(v) + 4, class: 'ch-ax' }, v + '%'));
    });
    svg.appendChild(el('line', { x1: PAD, y1: y(passPct), x2: W - PAD, y2: y(passPct), class: 'ch-pass' }));
    svg.appendChild(txt('text', { x: W - PAD - 2, y: y(passPct) - 6, class: 'ch-ax is-pass', 'text-anchor': 'end' }, `pass ${passPct}%`));
    if (points.length > 1) {
      svg.appendChild(el('polyline', { class: 'ch-line',
        points: points.map((p, i) => `${x(i)},${y(p.percent)}`).join(' ') }));
    }
    points.forEach((p, i) => {
      const c = el('circle', { cx: x(i), cy: y(p.percent), r: 5, class: 'ch-dot ' + (p.pass ? 'is-pass' : 'is-fail') });
      c.appendChild(txt('title', {}, `${p.station} — ${p.percent}% (${p.total}/${p.max})`));
      svg.appendChild(c);
    });
    container.innerHTML = ''; container.appendChild(svg);
  }

  return { scoreTrend, sectionBars, ring, histogram, osceTrend };
})();
