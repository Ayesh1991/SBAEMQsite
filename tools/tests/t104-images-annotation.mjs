/* t104 — the pictures, and marking the document up.

   §1 is a bug: reading mode printed "On the table: an image; an image"
   on a station whose first question is "interpret these scans". A scheme
   you revise from has to show the thing you are asked to look at.

   §2–4 are highlights and ink. Two faults were found building this and
   both are asserted here so they cannot come back:

     · a selection whose container is an ELEMENT gives a CHILD INDEX,
       not a character offset — every highlight made by double-tapping a
       word or selecting a whole line came out empty and was dropped;

     · one annotation layer cannot be both under the words (so a
       highlight is readable through) and over them (so a pen can draw).
       With one layer behind the text, the pointer never reached it and
       nothing could be drawn at all.

   §5 is what makes the marks worth making: they are the person's, they
   are stored, and they are there on the next device. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300"><rect width="420" height="300" fill="#111"/>
   <ellipse cx="210" cy="160" rx="120" ry="80" fill="#333"/></svg>`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1100 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });

const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.click('#auth-toggle'); await page.waitForTimeout(250);
await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1600);

await page.evaluate(async img => {
  await Backend.publishOsceStation({
    id: 'CSP', topic: 'Caesarean Scar Ectopic Pregnancy',
    scenario: 'A 32-year-old Gravida 3 Para 1 presented with bleeding per vaginum at 7 weeks.',
    station_time_min: 15, total_marks: 100, pass_mark_percent: 70,
    questions: [
      { id: 1, prompt: 'Interpret these USS images.', marks: 16,
        images: [{ url: img, caption: 'Transvaginal sonogram with Doppler' }, { url: img, caption: 'Sagittal section' }],
        marking_points: ['Sagittal longitudinal sections of transvaginal sonograms (2)',
          'Empty upper uterine cavity (2)', 'Empty and closed endocervical canal (2)'] },
      { id: 2, prompt: 'What is the most likely diagnosis?', marks: 8,
        marking_points: ['Caesarean scar pregnancy, Type 1'] },
      { id: 3, prompt: 'What other investigations?', marks: 10,
        marking_points: ['Serum beta-hCG (2)', '3D ultrasound (2)'] }
    ] });
  OSCE.bustStations?.();
}, IMG);

const open = async () => {
  await page.evaluate(() => { location.hash = '#/osce/station/CSP'; });
  await page.waitForTimeout(1400);
  await page.click('#os-read');
  await page.waitForTimeout(1000);
};
await open();

/* ---------------------------------------------------------------- */
sec('1. THE PICTURES ARE IN THE ARTICLE');

const imgs = await page.evaluate(() => ({
  n: document.querySelectorAll('.rd-img img').length,
  caps: [...document.querySelectorAll('.rd-img figcaption')].map(f => f.textContent.trim()),
  placeholder: /On the table:\s*an image/.test(document.querySelector('.rd-doc').textContent),
  zoomable: document.querySelectorAll('.rd-img-b[data-zoom]').length
}));
say('both scans are shown, not described', imgs.n === 2, imgs.n + ' images');
say('  with their captions', imgs.caps.join(' · ') === 'Transvaginal sonogram with Doppler · Sagittal section', imgs.caps.join(' · '));
say('  and the words "an image" appear nowhere', !imgs.placeholder);
say('  each opens in the viewer the rest of AUREUM uses', imgs.zoomable === 2);

/* ---------------------------------------------------------------- */
sec('2. HIGHLIGHTING');

const tools = await page.evaluate(() => ({
  bar: !!document.querySelector('#an-bar'),
  ts: [...document.querySelectorAll('[data-an-t]')].map(b => b.dataset.anT),
  hlSwatches: document.querySelectorAll('.an-hl-set [data-an-c]').length,
  well: document.querySelectorAll('[data-an-well]').length,
  widths: document.querySelectorAll('[data-an-w]').length,
  named: [...document.querySelectorAll('[data-an-t],[data-an-c],[data-an-w]')]
    .every(b => (b.getAttribute('aria-label') || b.getAttribute('title') || '').length > 1)
}));
say('there is a pencil case', tools.bar);
say('  read, highlight, underline, pen, erase',
  tools.ts.join() === 'read,hl,ul,pen,erase', tools.ts.join(', '));
say('  four highlighters, and a colour well on each of the three instruments',
  tools.hlSwatches === 4 && tools.well === 3, tools.hlSwatches + ' swatches · ' + tools.well + ' wells');
say('  and three pen widths', tools.widths === 3);
say('  every control named', tools.named);

await page.click('[data-an-t="hl"]'); await page.waitForTimeout(200);

/* Selecting a whole line — which is what a double-tap gives you, and
   which is the case that used to produce nothing at all. */
const hl = await page.evaluate(() => {
  const li = document.querySelector('[data-an="q0.p1"]');
  const r = document.createRange(); r.selectNodeContents(li);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  const ok = Annotate.highlightSelection();
  const m = Annotate._marks().find(x => x.kind === 'hl');
  return { ok, n: Annotate.count(), quote: m?.quote || '', start: m?.start, end: m?.end,
    drawn: document.querySelectorAll('.an-hl').length };
});
say('selecting a whole line highlights it', hl.ok && hl.n === 1, hl.n + ' mark');
say('  anchored to a real range, not to 0–0', hl.end > hl.start && hl.start === 0, hl.start + '–' + hl.end);
say('  with the words it marked kept alongside', /Empty upper uterine cavity/.test(hl.quote), hl.quote);
say('  and painted on the page', hl.drawn >= 1, hl.drawn + ' rectangles');

/* Under the words, not over them — a highlight that hides its own text
   is a redaction. */
const layers = await page.evaluate(() => {
  const hlLayer = document.querySelector('.an-layer');
  const inkLayer = document.querySelector('.an-ink-layer');
  /* The stacking is set on the article's own children — the sections —
     and a marking point inside one inherits that context rather than
     carrying a z-index of its own. So the section is what to measure;
     asking the <li> would report 0 and say nothing. */
  const section = document.querySelector('.rd-doc > .rd-q');
  const z = el => Number(getComputedStyle(el).zIndex) || 0;
  return { hl: z(hlLayer), text: z(section), ink: z(inkLayer),
    blend: getComputedStyle(document.querySelector('.an-hl')).mixBlendMode };
});
say('the highlighter is UNDER the words', layers.hl < layers.text, layers.hl + ' < ' + layers.text);
say('  the ink is OVER them', layers.ink > layers.text, layers.ink + ' > ' + layers.text);
say('  and it multiplies, so the text reads through it', layers.blend === 'multiply', layers.blend);

/* A selection across three blocks becomes three marks, each its own. */
const multi = await page.evaluate(() => {
  const a = document.querySelector('[data-an="q2.p0"]');
  const b = document.querySelector('[data-an="q2.p1"]');
  const r = document.createRange(); r.setStart(a.firstChild, 0); r.setEnd(b.firstChild, 6);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  Annotate.highlightSelection();
  return Annotate._marks().filter(m => m.kind === 'hl').map(m => m.key);
});
say('a selection across blocks becomes one mark per block',
  multi.length === 3 && multi.includes('q2.p0') && multi.includes('q2.p1'), multi.join(', '));

/* ---------------------------------------------------------------- */
sec('2b. IT HAPPENS AS THE FINGER MOVES, NOT AFTER IT STOPS');

/* The complaint was a lag between letting go and the colour appearing.
   Two causes: a timer, and a full re-measure of every mark on the page.
   The timer is gone; this is the other half. */
const live = await page.evaluate(() => {
  const styleOf = () => document.querySelector('.rd-doc style')?.textContent || '';
  const first = styleOf();
  document.querySelectorAll('.an-hl-set [data-an-c]')[1].click();     // green
  return { yellow: first, green: styleOf() };
});
say('the browser’s own selection wears the highlighter’s colour',
  /::selection\{background:#ffe066/.test(live.yellow), live.yellow.slice(0, 46));
say('  so changing the swatch changes what the drag looks like',
  /::selection\{background:#8ce99a/.test(live.green), live.green.slice(0, 46));

/* And the commit does not re-render the page. Proved by identity, not by
   a stopwatch: the DOM nodes of the marks already on the page must be
   the SAME nodes afterwards. Re-rendering would replace every one. */
const incremental = await page.evaluate(() => {
  const nodes = () => [...document.querySelectorAll('.an-hl')];
  const before = nodes();
  const el = document.querySelector('[data-an="q2.p1"]');
  const r = document.createRange(); r.selectNodeContents(el);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  Annotate.markSelection('hl');
  const after = nodes();
  return { kept: before.every(n => after.includes(n)), grew: after.length > before.length,
    n: before.length + ' → ' + after.length };
});
say('committing a new mark leaves every existing one untouched',
  incremental.kept && incremental.grew, incremental.n + ' rectangles');

/* ---------------------------------------------------------------- */
sec('2c. UNDERLINES');

await page.click('[data-an-t="ul"]'); await page.waitForTimeout(200);
const ul = await page.evaluate(() => {
  const sets = {
    hl: document.querySelector('.an-hl-set').hidden,
    ul: document.querySelector('.an-ul-set').hidden,
    pen: document.querySelector('.an-pen-set').hidden
  };
  const swatches = document.querySelectorAll('.an-ul-set [data-an-c]').length;
  const sel = document.querySelector('.rd-doc style')?.textContent || '';
  const el = document.querySelector('[data-an="q1.prompt"]');
  const r = document.createRange(); r.selectNodeContents(el);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  Annotate.markSelection('ul');
  const box = document.querySelector('.an-ul');
  const m = Annotate._marks().find(x => x.kind === 'ul');
  return { sets, swatches, sel, drawn: document.querySelectorAll('.an-ul').length,
    h: box?.style.height, colour: box?.style.background, kind: m?.kind, key: m?.key };
});
say('the underline has its own colours, and only its own are shown',
  ul.swatches === 4 && ul.sets.ul === false && ul.sets.hl === true && ul.sets.pen === true,
  ul.swatches + ' swatches');
say('  the selection previews it as a wash of the same colour, not a highlight',
  /::selection\{background:#e0313133/.test(ul.sel), ul.sel.slice(0, 46));
say('underlining rules a line under the words', ul.drawn >= 1 && ul.kind === 'ul', ul.drawn + ' rules');
say('  two pixels, on the baseline, in the chosen colour',
  ul.h === '2px' && /224, 49, 49/.test(ul.colour || ''), ul.h + ' · ' + ul.colour);
say('  anchored to the text like a highlight is', ul.key === 'q1.prompt', ul.key);

/* ---------------------------------------------------------------- */
sec('3. INK — THE PENCIL DRAWS, THE FINGER SCROLLS');

await page.click('[data-an-t="pen"]'); await page.waitForTimeout(250);
const swap = await page.evaluate(() => ({
  hlHidden: document.querySelector('.an-hl-set').hidden,
  penShown: document.querySelector('.an-pen-set').hidden === false,
  touch: getComputedStyle(document.querySelector('.an-ink-layer')).touchAction,
  takes: getComputedStyle(document.querySelector('.an-ink-layer')).pointerEvents
}));
say('choosing the pen shows the pen colours and puts the highlighters away',
  swap.hlHidden && swap.penShown);
say('  the ink layer takes the pointer only now', swap.takes === 'auto');
/* THE BUG THIS REPLACED. `touch-action: pan-y` looked like the way to
   let a finger scroll a surface the pen draws on. The browser applies it
   to the PEN as well, so a downward stroke was read as a scroll: the
   page moved under the nib and the stroke was cancelled mid-line. Every
   attempt at a circle came out as three broken arcs. */
say('  and the pen owns the whole gesture, so nothing can scroll under the nib',
  swap.touch === 'none', swap.touch);

/* Scrolled into view first: a mouse cannot be moved to a point outside
   the window, so drawing "on" a block below the fold draws nothing. */
await page.evaluate(() => document.querySelector('[data-an="q1.prompt"]').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(350);
const spot = await page.evaluate(() => {
  const r = document.querySelector('[data-an="q1.prompt"]').getBoundingClientRect();
  return { x: r.left + 24, y: r.bottom + 8 };
});
await page.mouse.move(spot.x, spot.y);
await page.mouse.down();
for (let i = 0; i < 24; i++) await page.mouse.move(spot.x + i * 10, spot.y + Math.sin(i / 3) * 8);
await page.mouse.up();
await page.waitForTimeout(400);
const inked = await page.evaluate(() => {
  const m = Annotate._marks().find(x => x.kind === 'ink');
  return { n: Annotate.count(), key: m?.key, pts: (m?.pts || []).length,
    frac: (m?.pts || []).every(([x, y]) => x >= -2 && x <= 3 && y >= -2 && y <= 3),
    paths: document.querySelectorAll('.an-ink path').length };
});
say('a stroke is recorded', inked.paths === 1 && inked.pts > 5, inked.pts + ' points');
/* The other half of the broken arcs: `pointerleave` fires whenever the
   nib crosses out of the layer's box — over an image, past the edge of
   the column — and ending the stroke there cut it into pieces. */
say('  and a nib crossing an edge does not end it',
  !/pointerleave/.test((await (await fetch(B + '/js/annotate.js')).text())
    .replace(/\/\*[\s\S]*?\*\//g, '')));
say('  anchored to the block it was drawn on', !!inked.key, inked.key);
say('  and stored as fractions of that block, so it moves with the text', inked.frac);

/* A CIRCLE. The mark people actually make, the one that was impossible,
   and the one that fails if anything at all interrupts a stroke. */
const circle = await page.evaluate(async () => {
  const scroller = document.querySelector('.rd-scroll');
  const before = scroller.scrollTop;
  const el = document.querySelector('[data-an="q0.p2"]');
  el.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 250));
  const b = el.getBoundingClientRect();
  const cx = b.left + 260, cy = b.top + 8, rad = 55;
  const layer = document.querySelector('.an-ink-layer');
  const ev = (t, x, y) => new PointerEvent(t, { pointerType: 'pen', pointerId: 21, bubbles: true,
    clientX: x, clientY: y, pressure: 0.6, isPrimary: true });
  const start = scroller.scrollTop;
  layer.dispatchEvent(ev('pointerdown', cx + rad, cy));
  for (let a = 0; a <= 360; a += 6) {
    const t = a * Math.PI / 180;
    layer.dispatchEvent(ev('pointermove', cx + Math.cos(t) * rad, cy + Math.sin(t) * rad));
    await new Promise(r => requestAnimationFrame(r));
  }
  layer.dispatchEvent(ev('pointerup', cx + rad, cy));
  const m = Annotate._marks().filter(x => x.kind === 'ink').pop();
  return { moved: scroller.scrollTop - start, pts: (m?.pts || []).length,
    strokes: document.querySelectorAll('.an-ink path').length,
    smooth: (document.querySelector('.an-ink path')?.getAttribute('d') || '').includes('Q') };
});
say('a circle drawn in one go stays ONE stroke', circle.pts > 40, circle.pts + ' points');
say('  and the page does not move under it', circle.moved === 0, circle.moved + ' px of scroll');
say('  the line is smoothed, not a polygon', circle.smooth);

/* A touch is a finger: it must not draw — and it must still scroll,
   which the layer now does itself because the browser no longer may. */
const scrolled = await page.evaluate(async () => {
  const scroller = document.querySelector('.rd-scroll');
  /* Back to the top first: the circle above scrolled the article down
     near its end, and a drag that asks for more scroll than is left
     measures the clamp rather than the scrolling. */
  scroller.scrollTop = 0;
  await new Promise(r => setTimeout(r, 200));
  const before = scroller.scrollTop;
  const marksBefore = Annotate.count();
  const layer = document.querySelector('.an-ink-layer');
  const ev = (t, y) => new PointerEvent(t, { pointerType: 'touch', pointerId: 31, bubbles: true,
    clientX: 520, clientY: y, isPrimary: true });
  layer.dispatchEvent(ev('pointerdown', 760));
  for (let i = 1; i <= 10; i++) { layer.dispatchEvent(ev('pointermove', 760 - i * 22)); await new Promise(r => setTimeout(r, 16)); }
  layer.dispatchEvent(ev('pointerup', 540));
  await new Promise(r => setTimeout(r, 420));
  return { by: scroller.scrollTop - before, drew: Annotate.count() - marksBefore,
    room: scroller.scrollHeight - scroller.clientHeight };
});
say('a finger scrolls the article, in pen mode, by the layer doing it itself',
  scrolled.room > 0 && scrolled.by > 150, scrolled.by + ' px');
say('  and draws nothing', scrolled.drew === 0);

/* A touch is a finger: it must not draw. */
const touched = await page.evaluate(spot => {
  const before = Annotate.count();
  const layer = document.querySelector('.an-ink-layer');
  const ev = o => new PointerEvent(o.t, { pointerType: 'touch', pointerId: 99, bubbles: true,
    clientX: o.x, clientY: o.y, isPrimary: true });
  layer.dispatchEvent(ev({ t: 'pointerdown', x: spot.x, y: spot.y }));
  layer.dispatchEvent(ev({ t: 'pointermove', x: spot.x + 60, y: spot.y + 20 }));
  layer.dispatchEvent(ev({ t: 'pointerup', x: spot.x + 60, y: spot.y + 20 }));
  return { before, after: Annotate.count() };
}, spot);
say('a FINGER does not draw — the palm resting on the glass is a finger',
  touched.after === touched.before, touched.before + ' → ' + touched.after);

/* A pen does, and reports pressure. */
const penned = await page.evaluate(spot => {
  const before = Annotate.count();
  const layer = document.querySelector('.an-ink-layer');
  const ev = (t, x, y, p) => new PointerEvent(t, { pointerType: 'pen', pointerId: 7, bubbles: true,
    clientX: x, clientY: y, pressure: p, isPrimary: true });
  layer.dispatchEvent(ev('pointerdown', spot.x, spot.y + 40, 0.4));
  for (let i = 1; i < 12; i++) layer.dispatchEvent(ev('pointermove', spot.x + i * 12, spot.y + 40, 0.9));
  layer.dispatchEvent(ev('pointerup', spot.x + 140, spot.y + 40, 0.9));
  const m = Annotate._marks().filter(x => x.kind === 'ink').pop();
  return { before, after: Annotate.count(), w: m?.w };
}, spot);
say('an Apple Pencil does', penned.after === penned.before + 1);
say('  and pressing harder gives a thicker line', penned.w > 3, 'width ' + (penned.w || 0).toFixed(2));

/* ---------------------------------------------------------------- */
sec('4. UNDO, ERASE AND CLEAR');

const n0 = await page.evaluate(() => Annotate.count());
await page.click('[data-an-undo]'); await page.waitForTimeout(300);
const n1 = await page.evaluate(() => Annotate.count());
say('undo takes the last mark back', n1 === n0 - 1, n0 + ' → ' + n1);
await page.click('[data-an-redo]'); await page.waitForTimeout(300);
say('  and redo puts it back', await page.evaluate(() => Annotate.count()) === n0);

/* Clear asks twice, because it is the one control that throws work away. */
await page.click('[data-an-clear]'); await page.waitForTimeout(200);
const asked = await page.evaluate(() => ({
  label: document.querySelector('[data-an-clear]').textContent.trim(),
  still: Annotate.count()
}));
say('clear asks before it empties the page', /Sure/.test(asked.label) && asked.still === n0, asked.label);

/* ---------------------------------------------------------------- */
sec('5. THE MARKS ARE THE PERSON’S, AND THEY ARE KEPT');

const saved = await page.evaluate(async () => {
  await Annotate.save();
  const d = await Backend.getAnnotations('osce:CSP');
  return { n: (d?.marks || []).length, kinds: [...new Set((d?.marks || []).map(m => m.kind))].sort() };
});
say('they are written to the backend', saved.n === n0, saved.n + ' marks stored');
say('  highlights, underlines and ink together, as one document',
  saved.kinds.join() === 'hl,ink,ul', saved.kinds.join(', '));

await page.click('[data-rd-close]'); await page.waitForTimeout(600);
await open();
const back = await page.evaluate(() => ({
  n: Annotate.count(),
  hl: document.querySelectorAll('.an-hl').length,
  ul: document.querySelectorAll('.an-ul').length,
  ink: document.querySelectorAll('.an-ink path').length
}));
say('closing and reopening brings every mark back', back.n === n0, back.n + ' marks');
say('  redrawn on the page — all three kinds', back.hl >= 1 && back.ul >= 1 && back.ink >= 1,
  back.hl + ' highlights · ' + back.ul + ' underlines · ' + back.ink + ' strokes');

/* Another person on the same device sees a clean page — which is the
   whole claim of "per user". */
const other = await page.evaluate(async () => {
  await Backend.signOut();
  await Backend.signUp({ name: 'Dr Other', email: 'other2@example.com', password: 'password123' });
  const d = await Backend.getAnnotations('osce:CSP');
  const n = (d?.marks || []).length;
  await Backend.signOut();
  await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  const mine = await Backend.getAnnotations('osce:CSP');
  return { theirs: n, mine: (mine?.marks || []).length };
});
say('another person sees none of them', other.theirs === 0, other.theirs + ' marks');
say('  and mine are still mine', other.mine === n0, other.mine + ' marks');

/* Nothing is kept in this browser — the marks follow the account, which
   is the reason they are worth making on an iPad and reading on a
   phone. (In local mode the backend IS storage, so this is asserted of
   the module's own code.) */
const src = await (await fetch(B + '/js/annotate.js')).text();
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
say('the module keeps nothing in this browser', !/localStorage|sessionStorage/.test(code));

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamps = await page.evaluate(() => {
  const v = [...document.scripts].map(s => (s.src.match(/\?v=(\d+)/) || [])[1]).filter(Boolean);
  return { set: [...new Set(v)], mod: [...document.scripts].some(s => /annotate\.js/.test(s.src)) };
});
say('one version across every asset', stamps.set.length === 1, stamps.set.join(', '));
const sw = await (await fetch(B + '/sw.js')).text();
say('  the service worker agrees', sw.includes("'aureum-v" + stamps.set[0] + "'"));
say('  and the annotation module is on the page', stamps.mod);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
