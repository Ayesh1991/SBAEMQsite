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

  return { scoreTrend, sectionBars, ring };
})();
