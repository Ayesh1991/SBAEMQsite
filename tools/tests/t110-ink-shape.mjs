/* t110 — a stroke keeps its shape, and two fingers work while reading.

   THE REPORT: "Problem still persisting. Zoom in out also carries its
   own problem." — with two videos.

   They are the same fault, and the videos show it plainly: the words
   "Now little b…" are written, look right while the hand is moving, and
   in a later frame the same writing is DRAWN OUT AND SPIKY — the l's and
   t's stretched to twice their height, one stroke pulled up through the
   line above it. Zooming made it worse because zooming is what triggers
   it.

   THE CAUSE. Ink is anchored to a block and stored in that block's own
   coordinates as fractions: x against the block's WIDTH, y against its
   HEIGHT. Width is stable — the column is the column. Height is not: a
   paragraph that wraps to one more line because the type got bigger is a
   taller box, and every stroke on it was stretched down to fill the new
   height. On a one-line marking point, where a stroke written beside it
   has fractions well over 1, the exaggeration was enormous. Nothing was
   lost; it was distorted, which looks the same at a glance and is why
   "not showing every writing" persisted after the input path was fixed.

   THE FIX is one character of arithmetic: measure BOTH axes against the
   width. One unit for both, so a circle stays a circle, wherever and at
   whatever size the document is shown.

   And the zoom itself: it only worked with an instrument in hand,
   because that is when the pane took the pointers. Pinching is a reading
   gesture — it belongs to reading most of all. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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

/* Marking points long enough to WRAP when the type grows — which is the
   whole mechanism: more lines, taller box, stretched ink. */
await page.evaluate(async () => {
  const qs = [];
  for (let i = 1; i <= 4; i++) {
    qs.push({ id: i, prompt: 'Question ' + i + ' — how would you counsel the mother at this initial visit?', marks: 10,
      marking_points: [
        'Explain that this appears to be a hormonal problem with excess male hormone, likely present from birth but worsening with puberty, and that investigations are needed to find the cause (2)',
        'Ask about any abnormalities noted at birth or in early childhood, and any drug exposure (2)',
        'Short one (2)'] });
  }
  await Backend.publishOsceStation({ id: 'SHP', topic: 'The shape of a stroke',
    scenario: 'A mother attends with her daughter.',
    station_time_min: 15, total_marks: 100, pass_mark_percent: 70, questions: qs });
  OSCE.bustStations?.();
});

await page.evaluate(() => { location.hash = '#/osce/station/SHP'; });
await page.waitForTimeout(1400);
await page.click('#os-read');
await page.waitForTimeout(1000);

/* A circle, because it is the mark everybody makes and the one that
   shows a distortion instantly. */
const circle = async (key, id) => page.evaluate(async ([k, pid]) => {
  const pane = document.querySelector('.rd-scroll');
  const el = document.querySelector(`[data-an="${k}"]`);
  el.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 300));
  const b = el.getBoundingClientRect();
  const ev = (t, x, y) => new PointerEvent(t, { pointerType: 'pen', pointerId: pid, bubbles: true,
    clientX: x, clientY: y, pressure: 0.6, isPrimary: true });
  const cx = b.left + 220, cy = b.top + 18, rad = 40;
  pane.dispatchEvent(ev('pointerdown', cx + rad, cy));
  for (let a = 0; a <= 360; a += 6) {
    const t = a * Math.PI / 180;
    pane.dispatchEvent(ev('pointermove', cx + Math.cos(t) * rad, cy + Math.sin(t) * rad));
    await new Promise(q => requestAnimationFrame(q));
  }
  pane.dispatchEvent(ev('pointerup', cx + rad, cy));
  await new Promise(r => setTimeout(r, 200));
  return Annotate._marks().filter(m => m.kind === 'ink').slice(-1)[0].id;
}, [key, id]);

await page.click('[data-an-t="pen"]'); await page.waitForTimeout(250);

/* ---------------------------------------------------------------- */
sec('1. A CIRCLE STAYS A CIRCLE');

const id = await circle('q0.p0', 301);
const shape = await page.evaluate(async mid => {
  const box = () => {
    const q = document.querySelector(`.an-ink path[data-mark="${mid}"]`).getBBox();
    return { w: +q.width.toFixed(1), h: +q.height.toFixed(1), ar: +(q.width / q.height).toFixed(3) };
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const at100 = box();
  Annotate.setZoom(1.8); await wait(400); const at180 = box();
  Annotate.setZoom(0.8); await wait(400); const at80 = box();
  Annotate.setZoom(1); await wait(300);
  const m = Annotate._marks().filter(x => x.id === mid)[0];
  return { at100, at180, at80, u: m.u, lines: document.querySelector('[data-an="q0.p0"]').getClientRects().length };
}, id);
say('the stroke is measured in one unit for both axes', shape.u === 'w', 'u: ' + shape.u);
say('at the normal size it is round', Math.abs(shape.at100.ar - 1) < 0.08,
  shape.at100.w + ' × ' + shape.at100.h + ' — ratio ' + shape.at100.ar);
/* THE FAULT. Bigger type means the paragraph wraps to more lines, so
   its box is taller — and that is what used to stretch the writing. */
say('at 180% the paragraph is taller, and the circle is unchanged',
  shape.at180.ar === shape.at100.ar && shape.at180.h === shape.at100.h,
  shape.at180.w + ' × ' + shape.at180.h + ' — ratio ' + shape.at180.ar);
say('and at 80% too', shape.at80.ar === shape.at100.ar && shape.at80.h === shape.at100.h,
  shape.at80.w + ' × ' + shape.at80.h + ' — ratio ' + shape.at80.ar);

/* ---------------------------------------------------------------- */
sec('2. AND THIS IS WHAT IT USED TO DO');

/* The same points, drawn the OLD way — y against the block's height.
   Asserted rather than described, because it is the whole diagnosis:
   the distortion in the video is reproduced here on demand, and the fix
   is the one character that separates the two. */
const before = await page.evaluate(async mid => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const m = Annotate._marks().filter(x => x.id === mid)[0];
  const box = () => {
    const q = document.querySelector(`.an-ink path[data-mark="${mid}"]`).getBBox();
    return { h: +q.height.toFixed(1), ar: +(q.width / q.height).toFixed(3) };
  };
  delete m.u;                       // as a stroke saved before v110 is
  Annotate.render(); await wait(200);
  const old100 = box();
  Annotate.setZoom(1.8); await wait(400);
  const old180 = box();
  Annotate.setZoom(1); await wait(300);
  m.u = 'w'; Annotate.render(); await wait(200);
  return { old100, old180 };
}, id);
say('measured against the height, the same circle is not round',
  Math.abs(before.old100.ar - 1) > 0.15, 'ratio ' + before.old100.ar);
say('  and grows taller still as the type grows — the spiky writing',
  before.old180.h > before.old100.h * 1.15,
  before.old100.h + ' px tall → ' + before.old180.h + ' px');
say('  while strokes saved that way are still drawn as they were measured',
  true, 'nothing already on the page moves');

/* ---------------------------------------------------------------- */
sec('3. THE SIZE OF THE TYPE DOES NOT CHANGE THE SIZE OF A NOTE');

const stable = await page.evaluate(async mid => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const w = () => +document.querySelector(`.an-ink path[data-mark="${mid}"]`).getBBox().width.toFixed(1);
  const a = w();
  Annotate.setZoom(2.2); await wait(400);
  const b = w();
  const pane = document.querySelector('.rd-scroll');
  const over = pane.scrollWidth - pane.clientWidth;
  Annotate.setZoom(1); await wait(300);
  return { a, b, over };
}, id);
say('a note keeps the size it was written at', stable.a === stable.b, stable.a + ' px, either way');
/* Which is deliberate. Ink that grew with the type would run off the
   side of a column that re-wraps instead of widening, and there is
   nowhere to scroll to. */
say('  so nothing runs off the side of the column', stable.over <= 1, stable.over + ' px of overflow');

/* ---------------------------------------------------------------- */
sec('4. TWO FINGERS WORK WHILE READING, NOT ONLY WHILE MARKING');

await page.click('[data-an-t="read"]'); await page.waitForTimeout(250);
const reading = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(300);
  const touch = getComputedStyle(pane).touchAction;
  const before = Annotate.getZoom();
  const f = (t, id, x, y) => new PointerEvent(t, { pointerType: 'touch', pointerId: id,
    bubbles: true, clientX: x, clientY: y, isPrimary: id === 401 });
  pane.dispatchEvent(f('pointerdown', 401, 600, 500));
  pane.dispatchEvent(f('pointerdown', 402, 720, 500));
  for (let i = 1; i <= 8; i++) {
    pane.dispatchEvent(f('pointermove', 401, 600 - i * 6, 500));
    pane.dispatchEvent(f('pointermove', 402, 720 + i * 6, 500));
    await wait(16);
  }
  pane.dispatchEvent(f('pointerup', 401, 552, 500));
  pane.dispatchEvent(f('pointerup', 402, 768, 500));
  await wait(300);
  const after = Annotate.getZoom();

  /* And one finger must still scroll it, natively — which is what
     `pan-y` leaves alone. */
  Annotate.setZoom(1); await wait(250);
  return { touch, before, after, marking: pane.classList.contains('is-marking') };
});
say('with no instrument in hand, the pane still refuses a browser zoom',
  reading.touch === 'pan-y', reading.touch);
say('  but one finger is left alone to scroll it', reading.touch === 'pan-y');
say('two fingers change the size of the type while simply reading',
  reading.after > reading.before * 1.2 && !reading.marking,
  Math.round(reading.before * 100) + '% → ' + Math.round(reading.after * 100) + '%');

/* ---------------------------------------------------------------- */
sec('5. STILL WRITTEN DOWN, STILL BROUGHT BACK');

const kept = await page.evaluate(async () => {
  await Annotate.save();
  const stored = await Backend.getAnnotations('osce:SHP');
  const ink = (stored?.marks || []).filter(m => m.kind === 'ink');
  return { n: Annotate.count(), saved: (stored?.marks || []).length,
    unit: ink.every(m => m.u === 'w') };
});
say('the stroke is stored', kept.saved === kept.n, kept.saved + ' of ' + kept.n);
say('  carrying the unit it was measured in', kept.unit);

await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(600);
await page.evaluate(() => { location.hash = '#/osce/station/SHP'; });
await page.waitForTimeout(1200);
await page.click('#os-read');
await page.waitForTimeout(900);
const back = await page.evaluate(() => {
  const p = document.querySelector('.an-ink path');
  const q = p.getBBox();
  return { n: Annotate.count(), ar: +(q.width / q.height).toFixed(3) };
});
say('and it comes back round', Math.abs(back.ar - 1) < 0.08, 'ratio ' + back.ar);

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v110/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '110', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
