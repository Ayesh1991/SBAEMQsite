/* t109 — the hand beside the column, and pinching the type.

   THE REPORT: "Still problem is there. Enable zoom in out with
   gestures." — with a video of the Documents app catching every stroke.

   WHAT WAS STILL WRONG, AND IT WAS NOT SUBTLE.

   Palm rejection had been built, and it worked — inside the annotation
   layer. That layer covers `.rd-doc`, which is a 680px column centred in
   a pane nearly twice as wide on an iPad. The hand writing on that
   column rests to the RIGHT of it: on ordinary, scrollable page, where
   the browser was free to read the palm as a scroll — and a scroll
   beginning anywhere cancels the pen stroke in progress. Every care
   taken inside the column could not have helped, because the hand was
   never inside the column.

   So the surface is the whole pane now. The layers are paint; the pane
   takes every pointer in it.

   And the second thing the videos showed: a stroke of fewer than two
   points was thrown away as "the pencil being put down". That is the dot
   on every i, every full stop, every tick and every short crossbar.
   Words came back with pieces missing because the pieces were being
   deleted on purpose.

   ZOOM. Pinching a PDF magnifies the page. This is not a page, it is a
   document, so pinching makes the TYPE bigger and the column re-wraps —
   nothing ever leaves the screen sideways and there is nothing to pan.
   It is also why the marks survive it: they are anchored to words and to
   blocks, and are simply re-measured at the new size. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
/* Wide, like an iPad in landscape — which is the whole point: the
   column is 680px and the pane is not. */
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
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

await page.evaluate(async () => {
  const qs = [];
  for (let i = 1; i <= 6; i++) {
    qs.push({ id: i, prompt: 'Question ' + i + ' — what would you do and why?', marks: 10,
      marking_points: ['Empty upper uterine cavity assessed first before anything else (2)',
        'Cease desiccation once vapour is no longer visualised and the tissue turns white (2)',
        'Practise short intermittent activation rather than one long continuous burn (2)'] });
  }
  await Backend.publishOsceStation({ id: 'PAN', topic: 'The hand beside the column',
    scenario: 'A 32-year-old woman is listed for a laparoscopic cystectomy.',
    station_time_min: 15, total_marks: 100, pass_mark_percent: 70, questions: qs });
  OSCE.bustStations?.();
});

await page.evaluate(() => { location.hash = '#/osce/station/PAN'; });
await page.waitForTimeout(1400);
await page.click('#os-read');
await page.waitForTimeout(1000);

/* ---------------------------------------------------------------- */
sec('1. THE COLUMN IS NOT THE SURFACE');

const geom = await page.evaluate(() => {
  const pane = document.querySelector('.rd-scroll').getBoundingClientRect();
  const col = document.querySelector('.rd-doc').getBoundingClientRect();
  return { pane: Math.round(pane.width), col: Math.round(col.width),
    margin: Math.round(pane.right - col.right) };
});
say('the pane is much wider than the column the text is set in',
  geom.margin > 150, geom.col + 'px column in a ' + geom.pane + 'px pane');
say('  so there is a margin beside it, which is where the hand goes',
  geom.margin > 150, geom.margin + ' px of it');

await page.click('[data-an-t="pen"]'); await page.waitForTimeout(250);
const owns = await page.evaluate(() => {
  const pane = document.querySelector('.rd-scroll');
  return { marking: pane.classList.contains('is-marking'),
    touch: getComputedStyle(pane).touchAction,
    layer: getComputedStyle(document.querySelector('.an-ink-layer')).pointerEvents };
});
say('picking up the pen hands the WHOLE PANE over', owns.marking && owns.touch === 'none', owns.touch);
say('  and the layer over the words is only paint now', owns.layer === 'none', owns.layer);

/* ---------------------------------------------------------------- */
sec('2. THE HAND RESTS BESIDE THE COLUMN, NOT ON IT');

/* THE FAULT. Everything here is dispatched at a point OUTSIDE the text
   column — which is exactly where a right hand rests when writing on a
   680px column in a 1400px pane, and exactly where the old code had no
   say at all. */
const beside = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  const col = document.querySelector('.rd-doc').getBoundingClientRect();
  const outside = col.right + 60;                 // the margin, beyond the layer
  const pen = (t, x, y, p) => new PointerEvent(t, { pointerType: 'pen', pointerId: 101,
    bubbles: true, clientX: x, clientY: y, pressure: p == null ? 0.5 : p, isPrimary: true });
  const touch = (t, x, y) => new PointerEvent(t, { pointerType: 'touch', pointerId: 102,
    bubbles: true, clientX: x, clientY: y, isPrimary: true });
  const wait = ms => new Promise(r => setTimeout(r, ms));

  pane.scrollTop = 0; await wait(900);
  const s0 = pane.scrollTop, n0 = Annotate.count();

  /* The heel of the hand lands in the margin first, as it does. */
  pane.dispatchEvent(touch('pointerdown', outside, 700));
  await wait(30);
  pane.dispatchEvent(pen('pointerdown', col.left + 60, 500, 0.35));
  for (let i = 1; i <= 24; i++) {
    pane.dispatchEvent(pen('pointermove', col.left + 60 + i * 9, 500 + Math.sin(i / 3) * 10, 0.5));
    pane.dispatchEvent(touch('pointermove', outside, 700 - i * 6));    // and creeps
    await wait(12);
  }
  pane.dispatchEvent(pen('pointerup', col.left + 276, 500, 0.3));
  pane.dispatchEvent(touch('pointerup', outside, 556));
  await wait(350);

  const m = Annotate._marks().filter(x => x.kind === 'ink').slice(-1)[0];
  return { moved: pane.scrollTop - s0, made: Annotate.count() - n0,
    pts: (m?.pts || []).length, paths: document.querySelectorAll('.an-ink path').length };
});
say('a hand resting BESIDE the column does not move the page', beside.moved === 0, beside.moved + ' px');
say('  the stroke survives whole, in one piece', beside.made === 1 && beside.pts > 15,
  beside.made + ' stroke · ' + beside.pts + ' points');

/* And a finger there, with no pencil in play, must still scroll — the
   margin is most of the screen and the page has to be readable. */
const scrolls = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  const col = document.querySelector('.rd-doc').getBoundingClientRect();
  const outside = col.right + 60;
  const touch = (t, y) => new PointerEvent(t, { pointerType: 'touch', pointerId: 103,
    bubbles: true, clientX: outside, clientY: y, isPrimary: true });
  await new Promise(r => setTimeout(r, 900));
  const s = pane.scrollTop;
  pane.dispatchEvent(touch('pointerdown', 800));
  for (let i = 1; i <= 12; i++) { pane.dispatchEvent(touch('pointermove', 800 - i * 22)); await new Promise(r => setTimeout(r, 16)); }
  pane.dispatchEvent(touch('pointerup', 536));
  await new Promise(r => setTimeout(r, 450));
  return pane.scrollTop - s;
});
say('  but a finger there, alone, still scrolls the page', scrolls > 150, scrolls + ' px');

/* ---------------------------------------------------------------- */
sec('3. A DOT IS A MARK');

/* It threw away any stroke of fewer than two points as "the pencil
   being put down". That is the dot on every i and every full stop. */
const dot = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  const col = document.querySelector('.rd-doc').getBoundingClientRect();
  await new Promise(r => setTimeout(r, 900));
  const before = Annotate.count();
  const ev = (t) => new PointerEvent(t, { pointerType: 'pen', pointerId: 104, bubbles: true,
    clientX: col.left + 120, clientY: 470, pressure: 0.6, isPrimary: true });
  pane.dispatchEvent(ev('pointerdown'));
  pane.dispatchEvent(ev('pointerup'));
  await new Promise(r => setTimeout(r, 120));
  const m = Annotate._marks().slice(before)[0];
  const node = m && document.querySelector(`.an-ink path[data-mark="${m.id}"]`);
  const box = node?.getBBox();
  return { grew: Annotate.count() - before, pts: (m?.pts || []).length,
    w: box ? Math.round(box.width * 10) / 10 : 0 };
});
say('tapping the nib once leaves a dot', dot.grew === 1, dot.grew + ' mark · ' + dot.pts + ' point');
say('  and it is drawn, not an empty shape', dot.w > 1, dot.w + ' px across');

/* ---------------------------------------------------------------- */
sec('4. PINCHING MAKES THE TYPE BIGGER');

const zoom = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  const doc = document.querySelector('.rd-doc');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(900);

  const before = { z: Annotate.getZoom(), font: getComputedStyle(doc).fontSize };
  const f = (t, id, x, y) => new PointerEvent(t, { pointerType: 'touch', pointerId: id,
    bubbles: true, clientX: x, clientY: y, isPrimary: id === 201 });
  /* Two fingers, 120px apart, opening to 200px. */
  pane.dispatchEvent(f('pointerdown', 201, 600, 500));
  pane.dispatchEvent(f('pointerdown', 202, 720, 500));
  let during = null;
  for (let i = 1; i <= 8; i++) {
    pane.dispatchEvent(f('pointermove', 201, 600 - i * 5, 500));
    pane.dispatchEvent(f('pointermove', 202, 720 + i * 5, 500));
    await wait(16);
    if (i === 4) during = { z: Annotate.getZoom(), hidden: doc.classList.contains('is-zooming') };
  }
  pane.dispatchEvent(f('pointerup', 201, 560, 500));
  pane.dispatchEvent(f('pointerup', 202, 760, 500));
  await wait(250);
  return { before, during, after: { z: Annotate.getZoom(), font: getComputedStyle(doc).fontSize,
    hidden: doc.classList.contains('is-zooming'), scrollW: pane.scrollWidth, clientW: pane.clientWidth } };
});
say('two fingers opening make the type bigger',
  zoom.after.z > zoom.before.z * 1.3, (zoom.before.z * 100).toFixed(0) + '% → ' + (zoom.after.z * 100).toFixed(0) + '%');
say('  which is a real change of size, not a transform',
  parseFloat(zoom.after.font) > parseFloat(zoom.before.font) * 1.3,
  zoom.before.font + ' → ' + zoom.after.font);
/* The marks were measured against the old type. A stale highlight
   sliding out from under its own words looks broken, so they are hidden
   while the fingers move and re-measured once, at the end. */
say('  the marks are hidden while the fingers move', zoom.during?.hidden === true);
say('  and shown again when they lift', zoom.after.hidden === false);
/* AND THIS IS WHY THE TYPE AND NOT THE PICTURE: the column re-wraps, so
   nothing ever goes off the side and there is nothing to pan. */
say('nothing overflows sideways — the column re-wraps instead',
  zoom.after.scrollW <= zoom.after.clientW + 1, zoom.after.scrollW + ' ≤ ' + zoom.after.clientW);

/* ---------------------------------------------------------------- */
sec('5. AND THE MARKS ARE STILL ON THEIR WORDS');

const survives = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  Annotate.setZoom(1); await wait(250);
  /* A highlight over known words, at the normal size. */
  const el = document.querySelector('[data-an="q0.p0"]');
  el.scrollIntoView({ block: 'center' }); await wait(250);
  const r = document.createRange(); r.selectNodeContents(el);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  Annotate.markSelection('hl');
  const m = Annotate._marks().filter(x => x.kind === 'hl').slice(-1)[0];
  const at = () => {
    const n = document.querySelector(`.an-hl[data-mark="${m.id}"]`);
    return n ? n.getBoundingClientRect().height : 0;
  };
  const h0 = at();
  Annotate.setZoom(1.6); await wait(300);
  const h1 = at();
  const after = Annotate._marks().filter(x => x.id === m.id)[0];
  Annotate.setZoom(1); await wait(250);
  return { h0: Math.round(h0), h1: Math.round(h1), quote: after?.quote,
    range: after ? after.start + '–' + after.end : '', same: after?.quote === m.quote };
});
say('a highlight is re-measured at the new size, not left behind',
  survives.h1 > survives.h0 * 1.2, survives.h0 + ' px tall → ' + survives.h1 + ' px');
say('  and it still marks the same words', survives.same, '“' + (survives.quote || '') + '” at ' + survives.range);

/* ---------------------------------------------------------------- */
sec('6. THE BUTTONS, FOR EVERYTHING WITHOUT TWO FINGERS');

const buttons = await page.evaluate(() => ({
  has: document.querySelectorAll('[data-rd-zoom]').length,
  named: [...document.querySelectorAll('[data-rd-zoom]')]
    .every(b => (b.getAttribute('aria-label') || '').length > 3)
}));
say('there is a smaller, a larger, and the size itself', buttons.has === 3);
say('  each one named', buttons.named);

await page.click('[data-rd-zoom="1"]'); await page.waitForTimeout(200);
await page.click('[data-rd-zoom="1"]'); await page.waitForTimeout(200);
const up = await page.evaluate(() => ({ z: Annotate.getZoom(),
  label: document.querySelector('[data-rd-zoom="0"]').textContent }));
say('the larger button steps up', up.z > 1.1, up.label);
say('  and the reading bar says what size it is', up.label === Math.round(up.z * 100) + '%', up.label);

await page.click('[data-rd-zoom="0"]'); await page.waitForTimeout(250);
const reset = await page.evaluate(() => ({ z: Annotate.getZoom(),
  label: document.querySelector('[data-rd-zoom="0"]').textContent }));
say('tapping the size puts it back to normal', reset.z === 1 && reset.label === '100%', reset.label);

const bounds = await page.evaluate(async () => {
  Annotate.setZoom(99); const hi = Annotate.getZoom();
  Annotate.setZoom(0.01); const lo = Annotate.getZoom();
  Annotate.setZoom(1);
  return { hi, lo };
});
say('  and it cannot be pinched into uselessness', bounds.hi <= 2.2 && bounds.lo >= 0.8,
  Math.round(bounds.lo * 100) + '% – ' + Math.round(bounds.hi * 100) + '%');

/* ---------------------------------------------------------------- */
sec('7. STAMPS');
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v109/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '109', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
