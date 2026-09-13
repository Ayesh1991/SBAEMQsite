/* t108 — writing with an Apple Pencil.

   THE REPORT: "It does not show every writing, and the highlighted area
   gives disturbances."

   Both were visible in the recording, and they are one fault and one
   omission:

     · THE DISTURBANCE. `user-select: none` had been applied to the two
       marking tools and the PEN was left out. So iOS went on offering
       its text interaction under the nib: writing across a line raised
       the grey selection bands, the blue handles and the Copy / Look Up
       callout in the middle of a word — and cancelled the stroke while
       doing it.

     · THE MISSING WRITING. "A finger scrolls" is not palm rejection.
       Writing means the hand RESTS on the glass, and the heel of it is
       a touch: it started a scroll, the page crept under the nib, and
       the stroke in progress was cut. That is why the writing came back
       as fragments of letters rather than words.

   And two things the recording showed that nobody had asked about: the
   line was the same thickness from end to end however hard the pencil
   was pressed — because a path has ONE stroke-width, and the code set
   it from the latest sample, so pressing harder at the end of a word
   thickened the whole word — and every sample between two frames was
   being thrown away. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

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

/* Long enough that there is somewhere to scroll to. */
await page.evaluate(async () => {
  const qs = [];
  for (let i = 1; i <= 6; i++) {
    qs.push({ id: i, prompt: 'Question ' + i + ' — what would you do and why?', marks: 10,
      marking_points: ['Empty upper uterine cavity assessed first (2)',
        'Cease desiccation once vapour is no longer visualised and the tissue turns white (2)',
        'Practise short intermittent activation rather than one long burn (2)'] });
  }
  await Backend.publishOsceStation({ id: 'WRT', topic: 'Writing on the scheme',
    scenario: 'A 32-year-old woman is listed for a laparoscopic cystectomy.',
    station_time_min: 15, total_marks: 100, pass_mark_percent: 70, questions: qs });
  OSCE.bustStations?.();
});

await page.evaluate(() => { location.hash = '#/osce/station/WRT'; });
await page.waitForTimeout(1400);
await page.click('#os-read');
await page.waitForTimeout(1000);

/* ---------------------------------------------------------------- */
sec('1. NOTHING IS SELECTABLE UNDER A NIB');

const sel = await page.evaluate(async () => {
  const doc = document.querySelector('.rd-doc');
  const read = getComputedStyle(doc).userSelect;
  const out = {};
  for (const t of ['hl', 'ul', 'pen', 'erase']) {
    Annotate.setTool(t);
    await new Promise(r => setTimeout(r, 30));
    const cs = getComputedStyle(doc);
    out[t] = cs.userSelect + '/' + (cs.webkitTouchCallout || 'none');
  }
  Annotate.setTool('read');
  await new Promise(r => setTimeout(r, 30));
  return { read, out, back: getComputedStyle(doc).userSelect };
});
say('in reading mode the text is text — selectable, copyable', sel.read !== 'none', sel.read);
/* THE FAULT IN THE RECORDING. The pen was the one left out. */
say('the pen makes it unselectable, exactly as the highlighter does',
  sel.out.pen === 'none/none', 'pen ' + sel.out.pen);
say('  and so does the eraser', sel.out.erase === 'none/none', 'erase ' + sel.out.erase);
say('  the marking tools unchanged', sel.out.hl === 'none/none' && sel.out.ul === 'none/none');
say('  and putting the pencil down gives the text back', sel.back !== 'none', sel.back);

/* ---------------------------------------------------------------- */
sec('2. PALM REJECTION');

await page.click('[data-an-t="pen"]'); await page.waitForTimeout(250);

const palm = await page.evaluate(async () => {
  const scroller = document.querySelector('.rd-scroll');
  const layer = document.querySelector('.an-ink-layer');
  const pen = (t, x, y, p) => new PointerEvent(t, { pointerType: 'pen', pointerId: 81,
    bubbles: true, clientX: x, clientY: y, pressure: p == null ? 0.5 : p, isPrimary: true });
  const touch = (t, id, x, y) => new PointerEvent(t, { pointerType: 'touch', pointerId: id,
    bubbles: true, clientX: x, clientY: y, isPrimary: true });
  const wait = ms => new Promise(r => setTimeout(r, ms));

  scroller.scrollTop = 0;
  await wait(900);                       // out of any previous grace period

  /* (a) THE HAND RESTS WHILE THE PENCIL WRITES. */
  const s0 = scroller.scrollTop, n0 = Annotate.count();
  layer.dispatchEvent(pen('pointerdown', 500, 500, 0.4));
  layer.dispatchEvent(touch('pointerdown', 91, 300, 700));      // the heel of the hand
  for (let i = 1; i <= 10; i++) {
    layer.dispatchEvent(pen('pointermove', 500 + i * 14, 500 + Math.sin(i) * 6, 0.5));
    layer.dispatchEvent(touch('pointermove', 91, 300, 700 - i * 18));   // and it drags
    await wait(16);
  }
  layer.dispatchEvent(pen('pointerup', 640, 500, 0.4));
  layer.dispatchEvent(touch('pointerup', 91, 300, 520));
  await wait(300);
  const writing = { moved: scroller.scrollTop - s0, made: Annotate.count() - n0,
    pts: (Annotate._marks().filter(m => m.kind === 'ink').slice(-1)[0]?.pts || []).length };

  /* (b) THE HAND LIFTS AFTER THE NIB DOES. */
  const s1 = scroller.scrollTop;
  layer.dispatchEvent(touch('pointerdown', 92, 300, 700));
  for (let i = 1; i <= 10; i++) { layer.dispatchEvent(touch('pointermove', 92, 300, 700 - i * 20)); await wait(16); }
  layer.dispatchEvent(touch('pointerup', 92, 300, 500));
  await wait(300);
  const after = { moved: scroller.scrollTop - s1 };

  /* (c) AND WHEN THE PENCIL HAS BEEN DOWN A WHILE, A FINGER IS A
     FINGER AGAIN — the page still has to be readable. */
  await wait(900);
  const s2 = scroller.scrollTop;
  layer.dispatchEvent(touch('pointerdown', 93, 300, 700));
  for (let i = 1; i <= 10; i++) { layer.dispatchEvent(touch('pointermove', 93, 300, 700 - i * 20)); await wait(16); }
  layer.dispatchEvent(touch('pointerup', 93, 300, 500));
  await wait(420);
  const later = { moved: scroller.scrollTop - s2 };

  /* (d) THE PALM LANDS FIRST AND IS ALREADY SCROLLING WHEN THE PENCIL
     ARRIVES — which is the usual order: you put your hand down, then
     you write. */
  await wait(900);
  scroller.scrollTop = 200;
  await wait(100);
  const s3 = scroller.scrollTop;
  layer.dispatchEvent(touch('pointerdown', 94, 300, 700));
  for (let i = 1; i <= 6; i++) { layer.dispatchEvent(touch('pointermove', 94, 300, 700 - i * 20)); await wait(16); }
  const mid = scroller.scrollTop;
  layer.dispatchEvent(pen('pointerdown', 500, 400, 0.5));       // the pencil arrives
  for (let i = 1; i <= 8; i++) {
    layer.dispatchEvent(touch('pointermove', 94, 300, 560 - i * 20));
    layer.dispatchEvent(pen('pointermove', 500 + i * 12, 400, 0.5));
    await wait(16);
  }
  layer.dispatchEvent(pen('pointerup', 600, 400, 0.5));
  layer.dispatchEvent(touch('pointerup', 94, 300, 400));
  await wait(300);
  const takeover = { before: mid - s3, after: scroller.scrollTop - mid };

  return { writing, after, later, takeover, room: scroller.scrollHeight - scroller.clientHeight };
});

say('the page has somewhere to scroll to', palm.room > 200, palm.room + ' px');
/* THE WHOLE OF WHY THE WRITING CAME BACK IN PIECES. */
say('a hand resting on the glass does not move the page while the pencil writes',
  palm.writing.moved === 0, palm.writing.moved + ' px');
say('  so the stroke survives whole', palm.writing.made === 1 && palm.writing.pts > 8,
  palm.writing.made + ' stroke · ' + palm.writing.pts + ' points');
say('  and the hand draws nothing of its own', palm.writing.made === 1);
say('a hand lifting just after the nib does not flick the page away',
  palm.after.moved === 0, palm.after.moved + ' px');
say('but a finger, a moment later, still scrolls — the page must stay readable',
  palm.later.moved > 100, palm.later.moved + ' px');
say('and a pencil arriving mid-scroll stops the page dead',
  palm.takeover.before > 60 && palm.takeover.after === 0,
  palm.takeover.before + ' px, then ' + palm.takeover.after + ' px');

/* ---------------------------------------------------------------- */
sec('3. EVERY SAMPLE, NOT EVERY FRAME');

/* An Apple Pencil is read at up to 240 Hz and `pointermove` is
   delivered at the refresh rate. The rest are not lost, they are HELD —
   and asking for them is the difference between a written line and a
   run of chords through it. */
const coalesced = await page.evaluate(async () => {
  const layer = document.querySelector('.an-ink-layer');
  await new Promise(r => setTimeout(r, 900));
  const pen = (t, x, y) => new PointerEvent(t, { pointerType: 'pen', pointerId: 82,
    bubbles: true, clientX: x, clientY: y, pressure: 0.5, isPrimary: true });
  layer.dispatchEvent(pen('pointerdown', 400, 450));
  /* ONE move event carrying four samples, as a real one does. */
  const e = pen('pointermove', 460, 450);
  const held = [pen('pointermove', 415, 450), pen('pointermove', 430, 450),
    pen('pointermove', 445, 450), pen('pointermove', 460, 450)];
  Object.defineProperty(e, 'getCoalescedEvents', { value: () => held });
  layer.dispatchEvent(e);
  const m = Annotate._marks().filter(x => x.kind === 'ink').slice(-1)[0];
  const n = m.pts.length;
  layer.dispatchEvent(pen('pointerup', 460, 450));
  return { n };
});
say('one move carrying four samples records four points, not one',
  coalesced.n === 5, coalesced.n - 1 + ' points from one event');

/* ---------------------------------------------------------------- */
sec('4. THE LINE THICKENS WHERE THE HAND PRESSED');

const width = await page.evaluate(async () => {
  const layer = document.querySelector('.an-ink-layer');
  await new Promise(r => setTimeout(r, 900));
  Annotate.setPenWidth(6);
  const draw = async (y, press, id) => {
    const pen = (t, x, p) => new PointerEvent(t, { pointerType: 'pen', pointerId: id,
      bubbles: true, clientX: x, clientY: y, pressure: p, isPrimary: true });
    layer.dispatchEvent(pen('pointerdown', 350, press(0)));
    for (let i = 1; i <= 20; i++) { layer.dispatchEvent(pen('pointermove', 350 + i * 9, press(i / 20))); await new Promise(r => setTimeout(r, 8)); }
    layer.dispatchEvent(pen('pointerup', 530, press(1)));
    await new Promise(r => setTimeout(r, 60));
    const m = Annotate._marks().filter(x => x.kind === 'ink').slice(-1)[0];
    const node = document.querySelector(`.an-ink path[data-mark="${m.id}"]`);
    return { w: m.w, press: m.pts.map(q => q[2]), box: node.getBBox().height,
      d: node.getAttribute('d'), fill: node.getAttribute('fill') };
  };
  const light = await draw(420, () => 0.12, 83);
  await new Promise(r => setTimeout(r, 900));
  const heavy = await draw(470, () => 0.98, 84);
  await new Promise(r => setTimeout(r, 900));
  const ramp = await draw(520, t => 0.1 + 0.88 * t, 85);
  return { light, heavy, ramp, nominal: Annotate.colours().w };
});
say('a stroke is a filled shape, not a line of one thickness',
  /Z$/.test(width.heavy.d) && width.heavy.fill === '#12110f', width.heavy.fill);
say('pressing harder draws a thicker line',
  width.heavy.box > width.light.box * 1.6,
  width.light.box.toFixed(1) + ' px light · ' + width.heavy.box.toFixed(1) + ' px heavy');
/* THE OLD BUG, WHICH NOBODY REPORTED BUT THE RECORDING SHOWS: one
   stroke-width for the whole path, set from the LATEST sample, so
   pressing harder at the end of a word thickened the word. */
say('  and pressing harder at the END does not thicken the beginning',
  width.ramp.w === width.nominal && width.light.w === width.nominal,
  'nominal width kept at ' + width.ramp.w);
say('  because pressure is carried by every point',
  width.ramp.press[0] < 0.2 && width.ramp.press[width.ramp.press.length - 1] > 0.9,
  width.ramp.press[0] + ' → ' + width.ramp.press[width.ramp.press.length - 1]);

/* ---------------------------------------------------------------- */
sec('5. WRITING DOES NOT GET SLOWER AS THE PAGE FILLS');

/* The old code rebuilt every stroke on the page for every sample. That
   is work which grows with the length of the notes, and it is paid at
   exactly the moment the hand is moving fastest. */
const incremental = await page.evaluate(async () => {
  const layer = document.querySelector('.an-ink-layer');
  await new Promise(r => setTimeout(r, 900));
  const before = [...document.querySelectorAll('.an-ink path')];
  const pen = (t, x, y) => new PointerEvent(t, { pointerType: 'pen', pointerId: 86,
    bubbles: true, clientX: x, clientY: y, pressure: 0.5, isPrimary: true });
  layer.dispatchEvent(pen('pointerdown', 380, 560));
  for (let i = 1; i <= 12; i++) { layer.dispatchEvent(pen('pointermove', 380 + i * 10, 560)); await new Promise(r => setTimeout(r, 8)); }
  const during = [...document.querySelectorAll('.an-ink path')];
  layer.dispatchEvent(pen('pointerup', 500, 560));
  return { kept: before.every(n => during.includes(n)), grew: during.length === before.length + 1,
    n: before.length + ' → ' + during.length };
});
say('a stroke in progress leaves every other stroke’s node untouched',
  incremental.kept && incremental.grew, incremental.n + ' paths');

/* ---------------------------------------------------------------- */
sec('6. AND IT IS ALL STILL KEPT');

const kept = await page.evaluate(async () => {
  const n = Annotate.count();
  await Annotate.save();
  const stored = await Backend.getAnnotations('osce:WRT');
  const ink = (stored?.marks || []).filter(m => m.kind === 'ink');
  return { n, saved: (stored?.marks || []).length,
    pressure: ink.every(m => m.pts.every(q => q.length === 3)) };
});
say('every stroke is stored', kept.saved === kept.n, kept.saved + ' of ' + kept.n);
say('  with the pressure at each point', kept.pressure);

await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(600);
await page.evaluate(() => { location.hash = '#/osce/station/WRT'; });
await page.waitForTimeout(1200);
await page.click('#os-read');
await page.waitForTimeout(900);
const back = await page.evaluate(() => ({
  n: Annotate.count(), paths: document.querySelectorAll('.an-ink path').length,
  closed: [...document.querySelectorAll('.an-ink path')].every(p => /Z$/.test(p.getAttribute('d') || ''))
}));
say('closing and reopening brings the writing back', back.n === kept.n, back.n + ' marks');
say('  redrawn as the same shapes', back.paths >= 5 && back.closed, back.paths + ' strokes');

/* ---------------------------------------------------------------- */
sec('7. STAMPS');
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  /* The literal belongs to the newest release file only — see the
     README. An older one that names its own number fails on every
     release after it. */
  return { vs, sw: vs.length === 1 && sw.includes("'aureum-v" + vs[0] + "'") };
});
say('one version across every asset', stamp.vs.length === 1, stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
