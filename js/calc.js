/* ============================================================
   calc.js — the arithmetic, done by arithmetic.

   WHY THESE ARE NOT AI

   A gestational age is a subtraction. A Bishop score is a sum of five
   numbers. A shock index is one division. Handing any of them to a
   language model would be slower, would cost money, would need a
   network, and — the part that matters — could be WRONG. v99 exists
   because a frontier model wrote 20/20 over a scheme it had itself
   marked as 8/20. That is the same failure a drug dose would take.

   So nothing in this file asks anything of anything. It is pure
   functions over numbers, and it works on a bus with no signal.

   SHOW THE WORKING, NOT THE ANSWER

   This is a revision tool, not a ward tool. Somebody sitting MD Part II
   has to be able to do these on paper in a viva, so every result carries
   the line it came from — "280 − 96 = 184 days" — and the named regimen
   or formula behind it. A calculator that gives a number and hides the
   method teaches nothing and is trusted more than it should be.

   AND SAY WHERE A NUMBER COMES FROM

   Every drug regimen here is a NAMED, published one, reproduced as it is
   taught, with its name attached. None of them is weight-calculated by
   this file: the arithmetic it does for MgSO4 is the volume of a 50%
   solution, which is the bit people get wrong under pressure, not the
   dose, which is fixed. Every result says to check it against the local
   protocol, because a revision aid is not a prescription.
   ============================================================ */

const Calc = (() => {

  const DAY = 86400000;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const round = (n, p = 1) => { const m = Math.pow(10, p); return Math.round(n * m) / m; };

  /* A date input gives 'YYYY-MM-DD'. Parsed at UTC noon so that no
     timezone can move it across midnight and change a gestational age by
     a day — which is a real failure, not a theoretical one. */
  const parseDate = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return isNaN(d.getTime()) ? null : d;
  };
  const iso = d => d ? new Date(d).toISOString().slice(0, 10) : '';
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const today = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), 12)); };
  const days = (a, b) => Math.round((b - a) / DAY);
  /** 187 → "26+5". The way it is written on every chart in the unit. */
  const wd = n => n == null ? '—' : `${Math.floor(n / 7)}+${n % 7}`;

  /* ================= dates =================

     Three ways in, one way out. Whichever is known — the period, a scan,
     or an EDD somebody else worked out — the answer is the same object,
     so the page does not have three shapes to draw. */

  const TERM = 280;                       // 40 weeks, by convention

  /**
   * From the last menstrual period. Naegele's rule, with the cycle
   * correction that most people are taught and few apply: the 280 days
   * assume ovulation on day 14, so a 35-day cycle puts the EDD a week
   * later, and a 21-day cycle a week earlier.
   */
  function fromLmp(lmpStr, cycle, onStr) {
    const lmp = parseDate(lmpStr); if (!lmp) return null;
    const c = num(cycle);
    const adj = (c && c >= 20 && c <= 45) ? Math.round(c - 28) : 0;
    const edd = new Date(lmp.getTime() + (TERM + adj) * DAY);
    return withGa({ edd, lmp, adj, cycle: c || 28, basis: 'lmp' }, onStr);
  }

  /**
   * From a dating scan: the gestation the scan gave, on the day it was
   * done. This is what actually decides the EDD in practice when it
   * differs from the period by more than the accepted window.
   */
  function fromScan(scanStr, weeks, dys, onStr) {
    const scan = parseDate(scanStr); if (!scan) return null;
    const w = num(weeks), d = num(dys) || 0;
    if (w == null || w < 0 || w > 44) return null;
    const gaAtScan = w * 7 + d;
    const edd = new Date(scan.getTime() + (TERM - gaAtScan) * DAY);
    return withGa({ edd, scan, gaAtScan, basis: 'scan' }, onStr);
  }

  /** From an EDD that is already settled. */
  function fromEdd(eddStr, onStr) {
    const edd = parseDate(eddStr); if (!edd) return null;
    return withGa({ edd, lmp: new Date(edd.getTime() - TERM * DAY), basis: 'edd' }, onStr);
  }

  /** Everything that follows from an EDD, on a given day. */
  function withGa(o, onStr) {
    const on = parseDate(onStr) || today();
    const gaDays = TERM - days(on, o.edd);
    const toGo = days(on, o.edd);
    return Object.assign(o, {
      on, gaDays, ga: wd(gaDays), toGo,
      trimester: gaDays < 0 ? null : gaDays < 14 * 7 ? 1 : gaDays < 28 * 7 ? 2 : 3,
      /* The dates a candidate is asked about, all of which are just this
         arithmetic done at a different number of days. */
      milestones: [
        ['Viability (24+0)', 24 * 7], ['Late preterm (34+0)', 34 * 7],
        ['Early term (37+0)', 37 * 7], ['Due date (40+0)', TERM], ['41+0', 41 * 7], ['42+0', 42 * 7]
      ].map(([label, d]) => ({ label, date: new Date(o.edd.getTime() - (TERM - d) * DAY), days: d })),
      term: gaDays >= 37 * 7 && gaDays < 42 * 7,
      post: gaDays >= 42 * 7,
      preterm: gaDays >= 0 && gaDays < 37 * 7
    });
  }

  /**
   * Does the scan re-date the pregnancy? The rule that is examined, and
   * the one people forget the thresholds of: a first-trimester scan wins
   * if it differs by more than 5 days, a scan up to 21+6 if it differs by
   * more than 10 days, and later than that by more than 14.
   */
  function redate(lmpEdd, scanEdd, gaAtScanDays) {
    if (!lmpEdd || !scanEdd) return null;
    const diff = Math.abs(days(lmpEdd, scanEdd));
    const limit = gaAtScanDays < 14 * 7 ? 5 : gaAtScanDays < 22 * 7 ? 10 : 14;
    return { diff, limit, redate: diff > limit,
      window: gaAtScanDays < 14 * 7 ? 'before 14+0' : gaAtScanDays < 22 * 7 ? '14+0 to 21+6' : '22+0 or later' };
  }

  /* ================= Bishop score ================= */

  const BISHOP = {
    dilatation: { label: 'Dilatation', opts: [['Closed', 0], ['1–2 cm', 1], ['3–4 cm', 2], ['5 cm or more', 3]] },
    effacement: { label: 'Effacement', opts: [['0–30%', 0], ['40–50%', 1], ['60–70%', 2], ['80% or more', 3]] },
    station:    { label: 'Station', opts: [['−3', 0], ['−2', 1], ['−1 or 0', 2], ['+1 or +2', 3]] },
    consistency:{ label: 'Consistency', opts: [['Firm', 0], ['Medium', 1], ['Soft', 2]] },
    position:   { label: 'Position', opts: [['Posterior', 0], ['Mid', 1], ['Anterior', 2]] }
  };

  function bishop(pick) {
    const keys = Object.keys(BISHOP);
    const parts = keys.map(k => ({ key: k, label: BISHOP[k].label, value: num(pick?.[k]) }));
    const missing = parts.filter(p => p.value == null);
    const score = parts.reduce((n, p) => n + (p.value || 0), 0);
    /* The interpretation is the point of the score, and the numbers are
       the ones the exam asks for: 8 or more behaves like spontaneous
       labour, 6 or less wants ripening first. */
    const verdict = missing.length ? 'Incomplete'
      : score >= 8 ? 'Favourable — induction is likely to behave like spontaneous labour'
      : score <= 6 ? 'Unfavourable — cervical ripening before induction'
      : 'Intermediate — between the two; judgement and the reason for induction decide';
    return { score, max: 13, parts, missing: missing.map(m => m.label), verdict,
      favourable: missing.length ? null : score >= 8 };
  }

  /* ================= blood loss ================= */

  /**
   * Shock index — heart rate over systolic pressure. It earns its place
   * in obstetrics because a young, fit, pregnant woman holds her blood
   * pressure until she is very unwell indeed, and the index moves before
   * the pressure does.
   */
  function shockIndex(hr, sbp) {
    const h = num(hr), s = num(sbp);
    if (h == null || s == null || s <= 0) return null;
    const si = h / s;
    const band = si < 0.9 ? { tone: 'ok', say: 'Within the usual range (about 0.5–0.9).' }
      : si < 1.0 ? { tone: 'warn', say: 'Raised. 0.9 is a widely used trigger to escalate in obstetric haemorrhage.' }
      : si < 1.7 ? { tone: 'bad', say: 'Significantly raised — treat as major haemorrhage until proved otherwise.' }
      : { tone: 'bad', say: 'Extremely raised. Massive haemorrhage.' };
    return { si: round(si, 2), hr: h, sbp: s, ...band };
  }

  /**
   * Blood loss as a proportion of THIS woman's circulating volume.
   * 500 mL means something quite different at 45 kg and at 95 kg, and the
   * percentage is what the classification of haemorrhage is actually
   * written in.
   */
  function bloodLoss(weightKg, lossMl, pregnant) {
    const w = num(weightKg), l = num(lossMl);
    if (w == null || w <= 0 || l == null || l < 0) return null;
    /* About 100 mL/kg at term against about 70 mL/kg outside pregnancy —
       the plasma volume expansion that is itself an exam favourite. */
    const perKg = pregnant === false ? 70 : 100;
    const ebv = w * perKg;
    const pct = (l / ebv) * 100;
    const cls = pct < 15 ? 'Class I — usually compensated'
      : pct < 30 ? 'Class II — tachycardia, narrowed pulse pressure'
      : pct < 40 ? 'Class III — hypotension, altered mental state'
      : 'Class IV — immediately life-threatening';
    return { ebv: Math.round(ebv), perKg, pct: round(pct, 1), loss: l, weight: w, cls,
      major: l >= 1000, massive: l >= 2000 };
  }

  /* ================= magnesium sulphate =================

     THE DOSE IS NOT CALCULATED. IT IS FIXED, AND IT IS QUOTED.

     Both regimens are named, published and taught as fixed amounts —
     nothing here works a dose out from a weight, because neither regimen
     does. What IS worked out is the VOLUME, because that is where the
     mistake gets made at three in the morning: 50% magnesium sulphate is
     0.5 g per mL, so 4 g is 8 mL and 1 g/hour is 2 mL/hour. */

  const MGSO4 = {
    pritchard: {
      name: 'Pritchard',
      loading: [{ what: '4 g IV over 5–20 minutes', g: 4, route: 'IV' },
                { what: '10 g IM — 5 g into each buttock', g: 10, route: 'IM' }],
      maintenance: { what: '5 g IM every 4 hours, alternate buttocks', g: 5, everyH: 4, route: 'IM' },
      note: 'No infusion pump needed, which is why it remains the regimen of choice where one may not be available.'
    },
    zuspan: {
      name: 'Zuspan',
      loading: [{ what: '4 g IV over 5–20 minutes', g: 4, route: 'IV' }],
      maintenance: { what: '1 g per hour by IV infusion', g: 1, everyH: 1, route: 'IV' },
      note: 'Needs a controlled infusion. Continue for 24 hours after delivery or after the last fit, whichever is later.'
    }
  };

  /** g → mL of a solution of the given strength (50% = 0.5 g/mL). */
  const gToMl = (g, pct) => {
    const p = num(pct) || 50;
    const gPerMl = p / 100;                       // 50% w/v = 0.5 g/mL
    return { ml: round(g / gPerMl, 1), gPerMl, pct: p };
  };

  function mgso4(which, pct) {
    const r = MGSO4[which] || MGSO4.pritchard;
    const conv = g => gToMl(g, pct);
    return {
      name: r.name, note: r.note, pct: num(pct) || 50,
      loading: r.loading.map(x => Object.assign({}, x, conv(x.g))),
      maintenance: Object.assign({}, r.maintenance, conv(r.maintenance.g),
        { perHourMl: r.maintenance.everyH ? round(conv(r.maintenance.g).ml / r.maintenance.everyH, 2) : null }),
      recurrent: Object.assign({ what: 'A further 2 g IV over 5 minutes if she fits again', g: 2 }, conv(2)),
      monitoring: ['Respiratory rate above 12 a minute', 'Patellar reflexes present',
        'Urine output above 30 mL an hour (100 mL over 4 hours)',
        'Antidote: 1 g calcium gluconate IV (10 mL of 10%) over 10 minutes'],
      /* Toxicity thresholds, since the monitoring above is a proxy for
         exactly these and the viva asks for the numbers. */
      levels: [['Therapeutic', '2–4 mmol/L'], ['Reflexes lost', 'about 5 mmol/L'],
        ['Respiratory depression', 'about 6 mmol/L'], ['Cardiac arrest', 'above 12 mmol/L']]
    };
  }

  /* ================= iron deficit ================= */

  /**
   * Ganzoni. The 2.4 is not arbitrary: it is 0.0034 (iron content of
   * haemoglobin) × 0.07 (blood volume as a fraction of body weight) ×
   * 1000, and a candidate who can say that has understood the formula
   * rather than memorised it.
   */
  function ganzoni(weightKg, hb, targetHb, stores) {
    const w = num(weightKg), h = num(hb), t = num(targetHb) || 11;
    if (w == null || w <= 0 || h == null || h < 0) return null;
    const st = stores == null ? (w > 35 ? 500 : 15 * w) : num(stores);
    const deficit = w * (t - h) * 2.4 + st;
    return { deficit: Math.max(0, Math.round(deficit)), weight: w, hb: h, target: t, stores: st,
      working: `${w} × (${t} − ${h}) × 2.4 + ${st} = ${Math.round(deficit)} mg`,
      note: w > 35 ? 'Iron stores taken as 500 mg (weight over 35 kg).' : 'Iron stores taken as 15 mg/kg (weight 35 kg or under).' };
  }

  /* ================= the small ones ================= */

  function bmi(weightKg, heightCm) {
    const w = num(weightKg), h = num(heightCm);
    if (w == null || h == null || h <= 0) return null;
    const m = h / 100;
    const v = w / (m * m);
    const band = v < 18.5 ? 'Underweight' : v < 25 ? 'Normal' : v < 30 ? 'Overweight'
      : v < 35 ? 'Obese class I' : v < 40 ? 'Obese class II' : 'Obese class III';
    return { bmi: round(v, 1), band, weight: w, height: h,
      working: `${w} ÷ ${round(m * m, 4)} = ${round(v, 1)} kg/m²`,
      note: 'In pregnancy this is calculated from the BOOKING weight, not a later one.' };
  }

  const APGAR = {
    colour:     { label: 'Colour', opts: [['Blue or pale', 0], ['Body pink, limbs blue', 1], ['Completely pink', 2]] },
    heart:      { label: 'Heart rate', opts: [['Absent', 0], ['Below 100', 1], ['100 or above', 2]] },
    grimace:    { label: 'Reflex irritability', opts: [['No response', 0], ['Grimace', 1], ['Cry or cough', 2]] },
    tone:       { label: 'Muscle tone', opts: [['Limp', 0], ['Some flexion', 1], ['Active movement', 2]] },
    respiration:{ label: 'Respiration', opts: [['Absent', 0], ['Slow or irregular', 1], ['Good, crying', 2]] }
  };

  function apgar(pick) {
    const keys = Object.keys(APGAR);
    const parts = keys.map(k => ({ key: k, label: APGAR[k].label, value: num(pick?.[k]) }));
    const missing = parts.filter(p => p.value == null);
    const score = parts.reduce((n, p) => n + (p.value || 0), 0);
    const verdict = missing.length ? 'Incomplete'
      : score >= 7 ? 'Reassuring' : score >= 4 ? 'Moderately depressed' : 'Severely depressed';
    return { score, max: 10, parts, missing: missing.map(m => m.label), verdict };
  }

  /* ================= the panel =================

     ONE PANEL, DRAWN WHEREVER IT IS ASKED FOR — in the assistant's popup
     and on its own page. Not two layouts to keep in step: the popup is
     narrow and the page is wide, and that is a matter of CSS rather than
     of two copies of the same form drifting apart.

     Everything recalculates on input. There is no Calculate button,
     because there is nothing to wait for — and a button implies there
     is. */

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const TOOLS = [
    { id: 'ga',     icon: '\u{1F4C5}', name: 'Dates', full: 'Gestational age & EDD',
      words: 'edd gestational age ga lmp due date scan dating weeks pregnant naegele redate trimester' },
    { id: 'bishop', icon: '\u{1F9EE}', name: 'Bishop', full: 'Bishop score',
      words: 'bishop score cervix favourable induction ripening dilatation effacement station' },
    { id: 'blood',  icon: '\u{1FA78}', name: 'Blood loss', full: 'Shock index & blood loss',
      words: 'blood loss pph haemorrhage shock index estimated volume ebl class' },
    { id: 'mgso4',  icon: '\u26A1', name: 'MgSO\u2084', full: 'Magnesium sulphate',
      words: 'magnesium sulphate mgso4 eclampsia pritchard zuspan fit seizure loading maintenance toxicity' },
    { id: 'iron',   icon: '\u{1F9B4}', name: 'Iron', full: 'Iron deficit (Ganzoni)',
      words: 'iron deficit ganzoni anaemia anemia haemoglobin hb ferric parenteral' },
    { id: 'bmi',    icon: '\u2696\uFE0F', name: 'BMI', full: 'Body mass index',
      words: 'bmi body mass index weight height booking obese' },
    { id: 'apgar',  icon: '\u{1F476}', name: 'Apgar', full: 'Apgar score',
      words: 'apgar newborn baby score colour heart grimace tone respiration' }
  ];

  /** Which tool a phrase is asking for, or '' — used by the assistant. */
  function toolFor(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return '';
    let best = '', score = 0;
    TOOLS.forEach(tool => {
      const hits = tool.words.split(/\s+/).filter(w => w.length > 2 && new RegExp('\\b' + w, 'i').test(t)).length;
      if (hits > score) { score = hits; best = tool.id; }
    });
    return best;
  }

  const field = (id, label, attrs, hint) => `<label class="cl-f">
    <span>${esc(label)}</span><input id="${id}" ${attrs}>${hint ? `<em>${esc(hint)}</em>` : ''}</label>`;
  const picker = (group, key, def) => `<div class="cl-pick" data-pick="${key}">
    ${def[key].opts.map(([label, v], i) => `<button type="button" data-v="${v}" class="${i === 0 ? 'is-on' : ''}">${esc(label)}</button>`).join('')}
  </div>`;
  const scoreRows = def => Object.keys(def).map(k => `<div class="cl-row">
    <span class="cl-row-l">${esc(def[k].label)}</span>${picker(null, k, def)}</div>`).join('');

  /**
   * Draw the calculators into `host`.
   * `opts.only` opens straight onto one tool (the assistant does this).
   * `opts.compact` is the popup: same content, tighter chrome.
   */
  function panel(host, opts = {}) {
    if (!host) return;
    let open = TOOLS.some(t => t.id === opts.only) ? opts.only : 'ga';
    host.innerHTML = `
      <div class="cl-wrap ${opts.compact ? 'is-compact' : ''}">
        <div class="cl-tabs" role="tablist">
          ${TOOLS.map(t => `<button class="cl-tab" data-tool="${t.id}" role="tab">
            <span class="cl-tab-i" aria-hidden="true">${t.icon}</span><span>${esc(t.name)}</span></button>`).join('')}
        </div>
        <div class="cl-body" id="cl-body"></div>
        <p class="cl-foot">Worked out on this device — nothing is sent anywhere, nothing is charged, and it all works
          with no signal. Doses are the named published regimens, quoted as taught; check them against your unit's
          own protocol before anybody is treated.</p>
      </div>`;
    const body = host.querySelector('#cl-body');

    const paintTabs = () => host.querySelectorAll('.cl-tab')
      .forEach(b => b.classList.toggle('is-on', b.dataset.tool === open));

    host.querySelector('.cl-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tool]'); if (!b) return;
      open = b.dataset.tool; paintTabs(); draw();
    });

    /* A score picker is a row of buttons rather than a select: on a phone
       a select is two taps and a scroll wheel, and there are five of them
       in a Bishop score. */
    function wirePicks(root, def, onChange) {
      root.querySelectorAll('.cl-pick').forEach(p => {
        p.addEventListener('click', e => {
          const b = e.target.closest('button[data-v]'); if (!b) return;
          p.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b));
          onChange();
        });
      });
      onChange();
    }
    const picked = root => {
      const out = {};
      root.querySelectorAll('.cl-pick').forEach(p => {
        const on = p.querySelector('button.is-on');
        out[p.dataset.pick] = on ? Number(on.dataset.v) : null;
      });
      return out;
    };
    const live = (root, sel, fn) => root.querySelectorAll(sel).forEach(i => i.addEventListener('input', fn));

    function draw() {
      if (open === 'ga') return drawGa();
      if (open === 'bishop') return drawScore(BISHOP, bishop, 'Bishop score', 13,
        'Five findings, each worth 0–3 (or 0–2). The number matters less than what it tells you to do next.');
      if (open === 'blood') return drawBlood();
      if (open === 'mgso4') return drawMg();
      if (open === 'iron') return drawIron();
      if (open === 'bmi') return drawBmi();
      if (open === 'apgar') return drawScore(APGAR, apgar, 'Apgar score', 10,
        'At 1 and 5 minutes, and every 5 minutes after that while it stays under 7.');
    }

    /* ---- dates ---- */
    function drawGa() {
      body.innerHTML = `
        <h3 class="cl-h">Gestational age &amp; expected date of delivery</h3>
        <div class="cl-seg" id="cl-ga-mode">
          <button class="is-on" data-m="lmp">From the period</button>
          <button data-m="scan">From a scan</button>
          <button data-m="edd">From a known EDD</button>
        </div>
        <div class="cl-fields" id="cl-ga-f"></div>
        ${field('cl-ga-on', 'Work it out for this date', `type="date" value="${iso(today())}"`, 'today unless you change it')}
        <div id="cl-ga-out"></div>`;
      const fh = body.querySelector('#cl-ga-f');
      let mode = 'lmp';
      const fields = () => {
        fh.innerHTML = mode === 'lmp'
          ? field('cl-lmp', 'First day of the last period', 'type="date"')
            + field('cl-cyc', 'Usual cycle length (days)', 'type="number" value="28" min="20" max="45"',
              'Naegele assumes 28; a longer cycle moves the EDD later')
          : mode === 'scan'
            ? field('cl-sdate', 'Date of the scan', 'type="date"')
              + `<div class="cl-pair">${field('cl-sw', 'Weeks at the scan', 'type="number" min="0" max="44" placeholder="12"')}
                 ${field('cl-sd', 'and days', 'type="number" min="0" max="6" placeholder="3"')}</div>`
            : field('cl-edd', 'Expected date of delivery', 'type="date"');
        live(fh, 'input', calc);
      };
      const out = body.querySelector('#cl-ga-out');
      function calc() {
        const on = body.querySelector('#cl-ga-on').value;
        const g = mode === 'lmp'
          ? fromLmp(body.querySelector('#cl-lmp')?.value, body.querySelector('#cl-cyc')?.value, on)
          : mode === 'scan'
            ? fromScan(body.querySelector('#cl-sdate')?.value, body.querySelector('#cl-sw')?.value,
                body.querySelector('#cl-sd')?.value, on)
            : fromEdd(body.querySelector('#cl-edd')?.value, on);
        if (!g) { out.innerHTML = `<p class="cl-wait">Fill the dates in and it works itself out.</p>`; return; }
        const cyc = mode === 'lmp' && g.adj
          ? `<p class="cl-note">Cycle ${g.cycle} days, so the due date moves ${g.adj > 0 ? 'back' : 'forward'}
             ${Math.abs(g.adj)} day${Math.abs(g.adj) === 1 ? '' : 's'}: 280 ${g.adj > 0 ? '+' : '−'} ${Math.abs(g.adj)}
             = ${TERM + g.adj} days from the period.</p>` : '';
        out.innerHTML = `
          <div class="cl-out">
            <div class="cl-big"><strong>${g.gaDays < 0 ? '—' : g.ga}</strong><span>weeks + days</span></div>
            <div class="cl-big"><strong>${fmtDate(g.edd)}</strong><span>due date</span></div>
            <div class="cl-big"><strong>${g.toGo >= 0 ? g.toGo : '—'}</strong><span>days to go</span></div>
          </div>
          <p class="cl-work">${mode === 'lmp'
            ? `${fmtDate(g.lmp)} + ${TERM + (g.adj || 0)} days = ${fmtDate(g.edd)}`
            : mode === 'scan'
              ? `${wd(g.gaAtScan)} on ${fmtDate(g.scan)}, so ${TERM} − ${g.gaAtScan} = ${TERM - g.gaAtScan} days more to the due date`
              : `${fmtDate(g.edd)} − ${TERM} days = a period on ${fmtDate(g.lmp)}`}</p>
          ${cyc}
          ${g.trimester ? `<p class="cl-tag">Trimester ${g.trimester}${
            g.post ? ' · post-dates' : g.term ? ' · term' : g.preterm && g.gaDays >= 24 * 7 ? ' · preterm, viable'
            : g.preterm ? ' · previable' : ''}</p>` : ''}
          <table class="cl-tbl"><tbody>${g.milestones.map(m => `<tr class="${
            g.gaDays >= m.days ? 'is-past' : ''}"><td>${esc(m.label)}</td><td>${fmtDate(m.date)}</td>
            <td>${g.gaDays >= m.days ? 'passed' : days(g.on, m.date) + ' days'}</td></tr>`).join('')}</tbody></table>`;
      }
      body.querySelector('#cl-ga-mode').addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        mode = b.dataset.m;
        body.querySelectorAll('#cl-ga-mode button').forEach(x => x.classList.toggle('is-on', x === b));
        fields(); calc();
      });
      body.querySelector('#cl-ga-on').addEventListener('input', calc);
      fields(); calc();
    }

    /* ---- a score out of a fixed set of findings ---- */
    function drawScore(def, fn, title, max, blurb) {
      body.innerHTML = `<h3 class="cl-h">${esc(title)}</h3>
        <p class="cl-blurb">${esc(blurb)}</p>
        <div class="cl-rows">${scoreRows(def)}</div>
        <div id="cl-sc-out"></div>`;
      const out = body.querySelector('#cl-sc-out');
      wirePicks(body, def, () => {
        const r = fn(picked(body));
        out.innerHTML = `<div class="cl-out">
            <div class="cl-big"><strong>${r.score}</strong><span>out of ${max}</span></div>
          </div>
          <p class="cl-verdict ${r.favourable === true ? 'is-good' : r.favourable === false ? 'is-warn' : ''}">${esc(r.verdict)}</p>
          <p class="cl-work">${r.parts.map(p => `${esc(p.label)} ${p.value}`).join(' + ')} = ${r.score}</p>`;
      });
    }

    /* ---- blood ---- */
    function drawBlood() {
      body.innerHTML = `<h3 class="cl-h">Shock index &amp; blood loss</h3>
        <p class="cl-blurb">A young woman holds her blood pressure until she is very unwell. The index moves first.</p>
        <div class="cl-pair">${field('cl-hr', 'Heart rate', 'type="number" placeholder="110"')}
          ${field('cl-sbp', 'Systolic BP', 'type="number" placeholder="100"')}</div>
        <div class="cl-pair">${field('cl-wt', 'Booking weight (kg)', 'type="number" placeholder="60"')}
          ${field('cl-ebl', 'Estimated loss (mL)', 'type="number" placeholder="1000"')}</div>
        <div id="cl-bl-out"></div>`;
      const out = body.querySelector('#cl-bl-out');
      const calc = () => {
        const si = shockIndex(body.querySelector('#cl-hr').value, body.querySelector('#cl-sbp').value);
        const bl = bloodLoss(body.querySelector('#cl-wt').value, body.querySelector('#cl-ebl').value);
        if (!si && !bl) { out.innerHTML = `<p class="cl-wait">Fill in either pair.</p>`; return; }
        out.innerHTML = `
          ${si ? `<div class="cl-out"><div class="cl-big is-${si.tone}"><strong>${si.si}</strong><span>shock index</span></div></div>
            <p class="cl-work">${si.hr} ÷ ${si.sbp} = ${si.si}</p>
            <p class="cl-verdict ${si.tone === 'ok' ? 'is-good' : si.tone === 'warn' ? 'is-warn' : 'is-bad'}">${esc(si.say)}</p>` : ''}
          ${bl ? `<div class="cl-out">
              <div class="cl-big"><strong>${bl.pct}%</strong><span>of her volume</span></div>
              <div class="cl-big"><strong>${bl.ebv}</strong><span>mL circulating</span></div>
            </div>
            <p class="cl-work">${bl.weight} kg × ${bl.perKg} mL/kg = ${bl.ebv} mL; ${bl.loss} ÷ ${bl.ebv} = ${bl.pct}%</p>
            <p class="cl-verdict ${bl.pct < 15 ? 'is-good' : bl.pct < 30 ? 'is-warn' : 'is-bad'}">${esc(bl.cls)}</p>
            ${bl.major ? `<p class="cl-tag">${bl.massive ? 'Massive' : 'Major'} obstetric haemorrhage by volume alone (${bl.loss} mL).</p>` : ''}
            <p class="cl-note">Circulating volume in pregnancy is taken as about 100 mL/kg — the plasma expansion is
              why she compensates for so long, and why the percentage matters more than the millilitres.</p>` : ''}`;
      };
      live(body, 'input', calc); calc();
    }

    /* ---- magnesium ---- */
    function drawMg() {
      body.innerHTML = `<h3 class="cl-h">Magnesium sulphate</h3>
        <p class="cl-blurb">The doses are fixed and named. What is worked out here is the volume, which is the part
          that goes wrong at three in the morning.</p>
        <div class="cl-seg" id="cl-mg-mode">
          <button class="is-on" data-m="pritchard">Pritchard</button>
          <button data-m="zuspan">Zuspan</button>
        </div>
        ${field('cl-mg-pct', 'Strength of the ampoule (%)', 'type="number" value="50" min="1" max="100"',
          '50% is 0.5 g per mL')}
        <div id="cl-mg-out"></div>`;
      let which = 'pritchard';
      const out = body.querySelector('#cl-mg-out');
      const calc = () => {
        const r = mgso4(which, body.querySelector('#cl-mg-pct').value);
        out.innerHTML = `
          <div class="cl-dose">
            <h4>Loading</h4>
            ${r.loading.map(l => `<p><strong>${esc(l.what)}</strong><em>${l.ml} mL of ${r.pct}%</em></p>`).join('')}
            <h4>Maintenance</h4>
            <p><strong>${esc(r.maintenance.what)}</strong><em>${r.maintenance.ml} mL${
              r.maintenance.route === 'IV' ? ` per hour` : ' each time'}</em></p>
            <h4>If she fits again</h4>
            <p><strong>${esc(r.recurrent.what)}</strong><em>${r.recurrent.ml} mL of ${r.pct}%</em></p>
          </div>
          <p class="cl-work">${r.pct}% = ${r.pct / 100} g/mL, so 1 g = ${round(1 / (r.pct / 100), 1)} mL</p>
          <p class="cl-note">${esc(r.note)}</p>
          <h4 class="cl-h2">Before every dose</h4>
          <ul class="cl-list">${r.monitoring.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
          <h4 class="cl-h2">Serum levels</h4>
          <table class="cl-tbl"><tbody>${r.levels.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`;
      };
      body.querySelector('#cl-mg-mode').addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        which = b.dataset.m;
        body.querySelectorAll('#cl-mg-mode button').forEach(x => x.classList.toggle('is-on', x === b));
        calc();
      });
      body.querySelector('#cl-mg-pct').addEventListener('input', calc);
      calc();
    }

    /* ---- iron ---- */
    function drawIron() {
      body.innerHTML = `<h3 class="cl-h">Iron deficit — Ganzoni</h3>
        <p class="cl-blurb">The 2.4 is 0.0034 (iron in haemoglobin) × 0.07 (blood volume as a fraction of weight)
          × 1000. Worth being able to say in a viva.</p>
        <div class="cl-pair">${field('cl-ir-wt', 'Weight (kg)', 'type="number" placeholder="60"')}
          ${field('cl-ir-hb', 'Haemoglobin now (g/dL)', 'type="number" step="0.1" placeholder="8"')}</div>
        ${field('cl-ir-t', 'Target haemoglobin (g/dL)', 'type="number" step="0.1" value="11"', 'usually 11 in pregnancy')}
        <div id="cl-ir-out"></div>`;
      const out = body.querySelector('#cl-ir-out');
      const calc = () => {
        const r = ganzoni(body.querySelector('#cl-ir-wt').value, body.querySelector('#cl-ir-hb').value,
          body.querySelector('#cl-ir-t').value);
        out.innerHTML = r
          ? `<div class="cl-out"><div class="cl-big"><strong>${r.deficit}</strong><span>mg of iron</span></div></div>
             <p class="cl-work">${esc(r.working)}</p><p class="cl-note">${esc(r.note)}</p>`
          : `<p class="cl-wait">Weight and haemoglobin, and it works itself out.</p>`;
      };
      live(body, 'input', calc); calc();
    }

    /* ---- BMI ---- */
    function drawBmi() {
      body.innerHTML = `<h3 class="cl-h">Body mass index</h3>
        <div class="cl-pair">${field('cl-bmi-w', 'Weight (kg)', 'type="number" placeholder="70"')}
          ${field('cl-bmi-h', 'Height (cm)', 'type="number" placeholder="160"')}</div>
        <div id="cl-bmi-out"></div>`;
      const out = body.querySelector('#cl-bmi-out');
      const calc = () => {
        const r = bmi(body.querySelector('#cl-bmi-w').value, body.querySelector('#cl-bmi-h').value);
        out.innerHTML = r
          ? `<div class="cl-out"><div class="cl-big"><strong>${r.bmi}</strong><span>kg/m²</span></div></div>
             <p class="cl-verdict ${r.bmi < 25 ? 'is-good' : r.bmi < 30 ? 'is-warn' : 'is-bad'}">${esc(r.band)}</p>
             <p class="cl-work">${esc(r.working)}</p><p class="cl-note">${esc(r.note)}</p>`
          : `<p class="cl-wait">Weight and height.</p>`;
      };
      live(body, 'input', calc); calc();
    }

    paintTabs(); draw();
    return { open: id => { if (TOOLS.some(t => t.id === id)) { open = id; paintTabs(); draw(); } } };
  }

  return {
    /* the panel and what the assistant needs to route to it */
    panel, TOOLS, toolFor,
    /* dates */
    fromLmp, fromScan, fromEdd, redate, wd, parseDate, iso, fmtDate, today, days, TERM,
    /* scores */
    BISHOP, bishop, APGAR, apgar,
    /* blood */
    shockIndex, bloodLoss,
    /* drugs and doses */
    MGSO4, mgso4, gToMl, ganzoni,
    /* body */
    bmi,
    _round: round
  };
})();
