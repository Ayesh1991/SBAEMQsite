/* t107 — the highlighter is a marker, not a text selection.

   THE COMPLAINT, AND WHAT IT REALLY WAS.

   "A bit of lag for the highlight effect." The lag was a symptom. The
   cause was that the highlighter was not a highlighter at all: it was
   the browser's own text selection with a colour applied once the
   finger let go. On an iPad that means dragging a pencil over a line
   starts iOS's selection — the grey band, two round handles planted at
   the ends, a magnifier, and on release the Copy / Define callout — and
   only after every one of those does any colour appear.

   Side by side with the Documents app the difference is not speed, it
   is kind. There the colour is simply behind the nib as it moves.

   So the text is no longer selected. The layer above the words takes
   the whole gesture, the word under the nib is found from a map of
   where the words are, and the band is painted every frame. This file
   asserts that, in the terms the difference was described in:

     · the colour is there while the hand is still moving;
     · nothing is ever selected, so no handles and no callout;
     · it snaps to whole words, so a pencil at an angle marks the
       phrase you meant;
     · the commit changes nothing on the screen;
     · and a finger can still both mark and scroll. */
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

await page.evaluate(async () => {
  await Backend.publishOsceStation({
    id: 'MRK', topic: 'Monopolar and bipolar diathermy',
    scenario: 'A 32-year-old woman is listed for a laparoscopic cystectomy.',
    station_time_min: 15, total_marks: 100, pass_mark_percent: 70,
    questions: [
      { id: 1, prompt: 'What safety measures will you take with bipolar diathermy?', marks: 12,
        marking_points: ['Empty upper uterine cavity assessed first (2)',
          'Cease desiccation once vapour is no longer visualised (2)',
          'Practise short intermittent activation (2)'] },
      { id: 2, prompt: 'Differences between cutting and coagulation mode?', marks: 10,
        marking_points: ['Low voltage current with one hundred per cent duty cycle (2)',
          'A higher voltage current with an interrupted duty cycle (2)'] }
    ] });
  OSCE.bustStations?.();
});

await page.evaluate(() => { location.hash = '#/osce/station/MRK'; });
await page.waitForTimeout(1400);
await page.click('#os-read');
await page.waitForTimeout(1000);

/* Where a word is, on the screen, right now. The module measures these
   for its own use; the test asks it rather than guessing, so a drag can
   be aimed at the MIDDLE of a word — which is the case that tells you
   whether it snaps. */
const aim = (key, i) => page.evaluate(([k, n]) => {
  const base = document.querySelector('.rd-doc').getBoundingClientRect();
  const w = Annotate._wordsOf(k)[n];
  if (!w) return null;
  return { x: base.left + w.x + w.w / 2, y: base.top + w.y + w.h / 2, t: w.t };
}, [key, i]);

const centre = key => page.evaluate(k => {
  document.querySelector(`[data-an="${k}"]`).scrollIntoView({ block: 'center' });
}, key).then(() => page.waitForTimeout(320));

/* ---------------------------------------------------------------- */
sec('1. THE MARKER OWNS THE GESTURE');

await page.click('[data-an-t="hl"]'); await page.waitForTimeout(250);
const owns = await page.evaluate(() => {
  const pane = document.querySelector('.rd-scroll');
  const cs = getComputedStyle(pane);
  const doc = getComputedStyle(document.querySelector('.rd-doc'));
  return { cls: pane.className, takes: pane.classList.contains('is-marking'),
    touch: cs.touchAction, select: doc.userSelect || doc.webkitUserSelect };
});
say('choosing the highlighter hands the whole pane over to the marker',
  owns.takes, owns.cls);
/* THE WHOLE POINT. If the browser may interpret the drag, it makes a
   text selection out of it — handles, magnifier, callout, and the
   colour only afterwards. It may not. */
say('  and it owns the whole gesture, so the browser cannot select under the nib',
  owns.touch === 'none', owns.touch);
say('  the words are not selectable while it is chosen', owns.select === 'none', owns.select);

/* ---------------------------------------------------------------- */
sec('2. THE COLOUR IS THERE WHILE THE HAND IS STILL MOVING');

await centre('q0.p0');
const w1 = await aim('q0.p0', 1);      // "upper"
const w3 = await aim('q0.p0', 4);      // "assessed"
const words = await page.evaluate(() => Annotate._wordsOf('q0.p0').map(w => w.t));

await page.mouse.move(w1.x, w1.y);
await page.mouse.down();
const onPress = await page.evaluate(() => ({
  live: document.querySelectorAll('.an-live').length,
  marks: Annotate.count()
}));
say('the colour appears on the press itself, before any movement',
  onPress.live >= 1, onPress.live + ' band · ' + onPress.marks + ' marks committed');

await page.mouse.move((w1.x + w3.x) / 2, w1.y);
await page.mouse.move(w3.x, w3.y);
const mid = await page.evaluate(() => {
  const n = document.querySelector('.an-live');
  return {
    live: document.querySelectorAll('.an-live').length,
    colour: n && getComputedStyle(n).backgroundColor,
    width: n ? Math.round(parseFloat(n.style.width)) : 0,
    sel: window.getSelection().toString(),
    loupe: document.querySelector('.an-loupe')?.hidden === false,
    word: document.querySelector('.an-loupe')?.textContent || '',
    marks: Annotate.count(),
    css: [...document.querySelectorAll('.an-live')].map(x => x.style.cssText)
  };
});
say('  and grows behind the nib as it goes', mid.width > 40, mid.width + ' px wide');
say('  in the highlighter’s own colour', /255, 224, 102/.test(mid.colour || ''), mid.colour);
/* No selection means no handles, no magnifier and no Copy callout —
   which is the whole of what made it feel like something other than a
   highlighter. */
say('nothing at all is selected', mid.sel === '', JSON.stringify(mid.sel));
say('  the word under the nib is shown, because the hand covers the line',
  mid.loupe && /assess/i.test(mid.word), mid.word);
say('  and nothing is committed until the hand lifts', mid.marks === onPress.marks);

await page.mouse.up();
await page.waitForTimeout(150);
const done = await page.evaluate(prev => {
  const m = Annotate._marks().filter(x => x.kind === 'hl').pop();
  const painted = [...document.querySelectorAll('.an-hl:not(.an-live)')].map(x => x.style.cssText);
  return { live: document.querySelectorAll('.an-live').length, quote: m?.quote || '',
    key: m?.key, n: Annotate.count(), painted, prev };
}, mid.css);
say('letting go leaves the mark exactly where the band was',
  done.live === 0 && done.painted.some(c => c === done.prev[0]),
  done.painted[done.painted.length - 1]?.slice(0, 48));
/* The drag began in the middle of one word and ended in the middle of
   another. A pencil held at a natural angle never lands on a letter
   boundary, so a marker that does not snap marks half a word at each
   end and reads as a mistake. */
say('it snaps to whole words at both ends', done.quote === 'upper uterine cavity assessed',
  '“' + done.quote + '” of ' + words.join(' '));
say('  anchored to the block it was drawn on', done.key === 'q0.p0', done.key);

/* ---------------------------------------------------------------- */
sec('3. A DRAG ACROSS LINES, AND ACROSS BLOCKS');

await centre('q0.p1');
const a1 = await aim('q0.p1', 0);
const b2 = await page.evaluate(() => {
  const base = document.querySelector('.rd-doc').getBoundingClientRect();
  const ws = Annotate._wordsOf('q0.p2');
  const w = ws[2];
  return { x: base.left + w.x + w.w / 2, y: base.top + w.y + w.h / 2 };
});
const before = await page.evaluate(() => Annotate.count());
await page.mouse.move(a1.x, a1.y);
await page.mouse.down();
await page.mouse.move(b2.x, b2.y, { steps: 8 });
const spanning = await page.evaluate(() => document.querySelectorAll('.an-live').length);
await page.mouse.up();
await page.waitForTimeout(150);
const across = await page.evaluate(n => Annotate._marks().slice(n).map(m => m.key), before);
say('a drag through two blocks previews both', spanning >= 2, spanning + ' bands');
say('  and becomes one mark per block, each removable on its own',
  across.length === 2 && across[0] === 'q0.p1' && across[1] === 'q0.p2', across.join(', '));

/* ---------------------------------------------------------------- */
sec('4. THE UNDERLINE IS THE SAME INSTRUMENT');

await page.click('[data-an-t="ul"]'); await page.waitForTimeout(200);
await page.click('.an-ul-set [data-an-c]'); await page.waitForTimeout(120);
await centre('q1.p0');
const u0 = await aim('q1.p0', 0);
const u2 = await aim('q1.p0', 2);
await page.mouse.move(u0.x, u0.y);
await page.mouse.down();
await page.mouse.move(u2.x, u2.y, { steps: 6 });
const ulLive = await page.evaluate(() => {
  const n = document.querySelector('.an-live');
  return { n: document.querySelectorAll('.an-live').length, h: n?.style.height,
    cls: n?.className, colour: n && getComputedStyle(n).backgroundColor };
});
await page.mouse.up();
await page.waitForTimeout(150);
const ruled = await page.evaluate(() => {
  const m = Annotate._marks().filter(x => x.kind === 'ul').pop();
  return { quote: m?.quote, kind: m?.kind, rules: document.querySelectorAll('.an-ul:not(.an-live)').length };
});
say('the underline previews as a rule on the baseline, not a band',
  ulLive.h === '2px' && /an-ul/.test(ulLive.cls || ''), ulLive.h + ' · ' + ulLive.cls);
say('  in its own ink', /224, 49, 49/.test(ulLive.colour || ''), ulLive.colour);
say('and it commits the same way', ruled.kind === 'ul' && ruled.rules >= 1,
  '“' + (ruled.quote || '') + '”');

/* ---------------------------------------------------------------- */
sec('4b. AND IT CAN BE RUBBED OUT AGAIN');

/* FOUND WHILE BUILDING THIS, AND IT HAD BEEN TRUE ALL ALONG. Every mark
   is `pointer-events: none` so it never gets in the way of reading, and
   `elementsFromPoint` — which is how the eraser finds what is under the
   nib — skips such elements entirely. Ink could be erased; a highlight
   could not, and undo only reaches the last thing done. A marker that
   is easy to use makes that worse, not better. */
const rubbed = await page.evaluate(async () => {
  const box = document.querySelector('.an-hl:not(.an-live)');
  box.scrollIntoView({ block: 'center' });
  await new Promise(q => setTimeout(q, 250));
  const b = box.getBoundingClientRect();
  const before = Annotate.count();
  Annotate.setTool('erase');
  const layer = document.querySelector('.an-ink-layer');
  layer.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', pointerId: 61,
    bubbles: true, clientX: b.left + 10, clientY: b.top + b.height / 2, isPrimary: true }));
  await new Promise(q => setTimeout(q, 150));
  return { before, after: Annotate.count() };
});
say('the eraser takes a highlight off the page', rubbed.after === rubbed.before - 1,
  rubbed.before + ' → ' + rubbed.after);

/* ---------------------------------------------------------------- */
sec('5. A PENCIL MARKS ANYWHERE; A FINGER DECIDES BY THE GESTURE');

await page.click('[data-an-t="hl"]'); await page.waitForTimeout(200);

/* A pencil is precise but it is held at an angle, and people aim at the
   line rather than at a letter. Starting in the margin beside a line
   must still mark that line. */
await centre('q1.p1');
const penned = await page.evaluate(async () => {
  const el = document.querySelector('[data-an="q1.p1"]');
  const r = el.getBoundingClientRect();
  const layer = document.querySelector('.an-ink-layer');
  const before = Annotate.count();
  const ev = (t, x, y) => new PointerEvent(t, { pointerType: 'pen', pointerId: 41, bubbles: true,
    clientX: x, clientY: y, pressure: 0.5, isPrimary: true });
  layer.dispatchEvent(ev('pointerdown', r.left - 40, r.top + 10));
  const live = [];
  for (let i = 0; i <= 10; i++) {
    layer.dispatchEvent(ev('pointermove', r.left + 20 + i * 24, r.top + 10));
    live.push(document.querySelectorAll('.an-live').length);
    await new Promise(q => requestAnimationFrame(q));
  }
  layer.dispatchEvent(ev('pointerup', r.left + 260, r.top + 10));
  /* `_marks()` hands back the module's own array — reading the last
     entry with `pop()` would REMOVE the mark being asserted about. */
  const made = Annotate._marks().slice(before);
  return { grew: Annotate.count() - before, quote: made[0]?.quote || '',
    livePeak: Math.max(...live), keys: made.map(x => x.key) };
});
say('a pencil starting in the margin marks the line beside it',
  penned.grew === 1 && penned.quote.length > 4,
  penned.keys.join(', ') + ' · “' + penned.quote.slice(0, 40) + '”');
say('  painting all the way through the stroke', penned.livePeak >= 1);

/* THE HARD CASE. On a phone the finger is both the marking tool and the
   scrolling tool, and the highlighter cannot simply take every touch or
   the page could not be read. The first movement decides: along the
   line it marks, down the page it scrolls. That is the gesture each one
   already is. */
const finger = await page.evaluate(async () => {
  const scroller = document.querySelector('.rd-scroll');
  const layer = document.querySelector('.an-ink-layer');
  /* After the pencil, the hand is ignored for a moment — it lifts last,
     and a palm flicking the page away as it goes is the thing that
     ruins writing. So wait it out before asking what a finger does. */
  await new Promise(q => setTimeout(q, 900));
  const ev = (t, id, x, y) => new PointerEvent(t, { pointerType: 'touch', pointerId: id,
    bubbles: true, clientX: x, clientY: y, isPrimary: true });
  const wait = () => new Promise(q => setTimeout(q, 16));

  /* Along a line. */
  const el = document.querySelector('[data-an="q1.p0"]');
  el.scrollIntoView({ block: 'center' });
  await new Promise(q => setTimeout(q, 250));
  const r = el.getBoundingClientRect();
  const n0 = Annotate.count(), s0 = scroller.scrollTop;
  layer.dispatchEvent(ev('pointerdown', 51, r.left + 30, r.top + 10));
  for (let i = 1; i <= 10; i++) { layer.dispatchEvent(ev('pointermove', 51, r.left + 30 + i * 22, r.top + 10)); await wait(); }
  layer.dispatchEvent(ev('pointerup', 51, r.left + 250, r.top + 10));
  const along = { marks: Annotate.count() - n0, moved: scroller.scrollTop - s0 };

  /* Down the page, from a word — the same starting point, the other
     gesture. */
  scroller.scrollTop = 0;
  await new Promise(q => setTimeout(q, 200));
  const el2 = document.querySelector('[data-an="q0.p0"]');
  const r2 = el2.getBoundingClientRect();
  const n1 = Annotate.count(), s1 = scroller.scrollTop;
  layer.dispatchEvent(ev('pointerdown', 52, r2.left + 30, r2.top + 10));
  for (let i = 1; i <= 12; i++) { layer.dispatchEvent(ev('pointermove', 52, r2.left + 30, r2.top + 10 - i * 26)); await wait(); }
  layer.dispatchEvent(ev('pointerup', 52, r2.left + 30, r2.top - 300));
  await new Promise(q => setTimeout(q, 400));
  const down = { marks: Annotate.count() - n1, moved: scroller.scrollTop - s1 };
  return { along, down, room: scroller.scrollHeight - scroller.clientHeight };
});
say('a finger drawn along a line marks it', finger.along.marks === 1, finger.along.marks + ' mark');
say('  without scrolling the page away under it', finger.along.moved === 0, finger.along.moved + ' px');
say('a finger drawn down the page scrolls, and marks nothing',
  finger.down.marks === 0 && finger.down.moved > 120, finger.down.moved + ' px · ' + finger.down.marks + ' marks');

/* ---------------------------------------------------------------- */
sec('6. IT IS STILL THE SAME DOCUMENT AFTERWARDS');

const kept = await page.evaluate(async () => {
  const n = Annotate.count();
  await Annotate.save();
  const stored = await Backend.getAnnotations('osce:MRK');
  return { n, saved: (stored?.marks || []).length,
    kinds: [...new Set((stored?.marks || []).map(m => m.kind))].sort().join(', ') };
});
say('every mark made with the marker is stored', kept.saved === kept.n, kept.saved + ' of ' + kept.n);
say('  highlights and underlines alike', kept.kinds === 'hl, ul', kept.kinds);

await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(600);
await page.evaluate(() => { location.hash = '#/osce/station/MRK'; });
await page.waitForTimeout(1200);
await page.click('#os-read');
await page.waitForTimeout(900);
const back = await page.evaluate(() => ({
  n: Annotate.count(),
  hl: document.querySelectorAll('.an-hl:not(.an-live)').length,
  ul: document.querySelectorAll('.an-ul:not(.an-live)').length
}));
say('closing and reopening brings them back', back.n === kept.n, back.n + ' marks');
say('  redrawn on the page', back.hl >= 1 && back.ul >= 1, back.hl + ' highlights · ' + back.ul + ' underlines');

/* ---------------------------------------------------------------- */
sec('7. STAMPS');
/* The literal belongs to the NEWEST release file only. An older one
   that names its own number fails on every release after it, which
   teaches you to ignore it. */
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: vs.length === 1 && sw.includes("'aureum-v" + vs[0] + "'") };
});
say('one version across every asset', stamp.vs.length === 1, stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
