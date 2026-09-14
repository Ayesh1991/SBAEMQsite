/* t112 — sticky notes, and a selection that cannot survive.

   TWO THINGS, FROM ONE REPORT.

   "Call out is middle right corner. You can see it at the end of the
   video." — and it is: Copy / Look Up / Translate / Search Web, with a
   selection handle beside it, over the document's own text at the end of
   a line. Not the reading bar this time. So iPadOS is making a selection
   inside a document that says, in three places, that it may not be
   selected.

   Naming the elements to protect is a game that can only be lost,
   because the answer is always "and that one too". This release stops
   playing it:

     · the ROOT element is unselectable while an instrument is held, so
       there is nothing left to name;
     · `selectstart` and `contextmenu` are refused at the document, in
       the capture phase, before anything else sees them;
     · and — the one that cannot be evaded — `selectionchange` empties
       any selection the moment it appears, however it was made. The
       callout goes with it, because a callout with nothing selected has
       nothing to show.

   The first two are still worth having: preventing a thing is better
   than undoing it. The third is what makes the outcome certain.

   AND THE NOTES. Asked for as a way round the writing when it goes
   wrong, which is exactly right: a note depends on none of the hardware
   behaving. You tap where you want it and type. It is anchored like ink,
   to a block and in that block's own width, and it holds as much text as
   you care to write. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
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
  await Backend.publishOsceStation({ id: 'NOT', topic: 'Holding the uterus',
    scenario: 'A 32-year-old woman is listed for a laparoscopic cystectomy.',
    station_time_min: 15, total_marks: 100, pass_mark_percent: 70,
    questions: [
      { id: 1, prompt: 'Which instruments would you use to hold the uterus and why?', marks: 12,
        marking_points: ['Vulsellum with teeth applied to both sides of the uterus for traction (2)',
          'Longitudinal ridges for the pedicles to prevent slippage (2)'] },
      { id: 2, prompt: 'How would you identify and avoid injuring the ureter?', marks: 10,
        marking_points: ['Push the bladder down before proceeding to the cervix (2)',
          'Identify it visually by its fasciculation, or peristalsis (2)'] }
    ] });
  OSCE.bustStations?.();
});

await page.evaluate(() => { location.hash = '#/osce/station/NOT'; });
await page.waitForTimeout(1400);
await page.click('#os-read');
await page.waitForTimeout(1000);

/* ---------------------------------------------------------------- */
sec('1. THERE IS NOTHING LEFT TO NAME');

const root = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const html = document.documentElement;
  const read = getComputedStyle(html).userSelect;
  Annotate.setTool('pen'); await wait(40);
  const pen = { root: getComputedStyle(html).userSelect,
    callout: getComputedStyle(html).webkitTouchCallout || 'none' };
  Annotate.setTool('read'); await wait(40);
  const back = getComputedStyle(html).userSelect;
  Annotate.setTool('pen'); await wait(40);
  return { read, pen, back };
});
/* The last two releases named `.rd-doc`, then `.rd-bar` and the pane.
   The callout came from somewhere else both times. */
say('with an instrument in hand, the ROOT element refuses a selection',
  root.pen.root === 'none', root.pen.root);
say('  and offers no long-press menu', root.pen.callout === 'none', root.pen.callout);
say('  while reading, the whole page is selectable again — as every other page is',
  root.read !== 'none' && root.back !== 'none', root.read + ' / ' + root.back);

/* ---------------------------------------------------------------- */
sec('2. AND A SELECTION CANNOT SURVIVE ONE BEING HELD');

/* THE ONE THAT CANNOT BE EVADED. Made here by script — which is
   precisely the case the CSS cannot prevent, and stands in for whatever
   iPadOS is doing that it also cannot prevent. */
const killed = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const el = document.querySelector('[data-an="q0.p0"]');
  const select = () => {
    const r = document.createRange(); r.selectNodeContents(el);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  };
  Annotate.setTool('pen'); await wait(40);
  select(); await wait(120);
  const withPen = window.getSelection().toString().length;
  Annotate.setTool('read'); await wait(40);
  select(); await wait(120);
  const withoutPen = window.getSelection().toString().length;
  window.getSelection().removeAllRanges();
  Annotate.setTool('pen'); await wait(40);
  return { withPen, withoutPen };
});
say('a selection made while the pen is held is emptied at once',
  killed.withPen === 0, killed.withPen + ' characters survived');
say('  and one made while reading is left alone — it is wanted there',
  killed.withoutPen > 10, killed.withoutPen + ' characters');

/* ---------------------------------------------------------------- */
sec('3. THE NOTE ITSELF');

const tools = await page.evaluate(() => ({
  ts: [...document.querySelectorAll('[data-an-t]')].map(b => b.dataset.anT),
  swatches: document.querySelectorAll('.an-note-set [data-an-c]').length,
  well: document.querySelectorAll('[data-an-well="note"]').length
}));
say('the pencil case has a note in it', tools.ts.includes('note'), tools.ts.join(', '));
say('  with four papers and a colour well', tools.swatches === 4 && tools.well === 1,
  tools.swatches + ' colours');

await page.click('[data-an-t="note"]'); await page.waitForTimeout(250);
const sets = await page.evaluate(() => ({
  note: document.querySelector('.an-note-set').hidden,
  pen: document.querySelector('.an-pen-set').hidden,
  hl: document.querySelector('.an-hl-set').hidden
}));
say('  and choosing it shows its colours and puts the others away',
  sets.note === false && sets.pen === true && sets.hl === true);

/* Tap the page: a note is put there, open and ready to be typed into —
   the keyboard is what a note is for. */
const spot = await page.evaluate(() => {
  const r = document.querySelector('[data-an="q0.p0"]').getBoundingClientRect();
  return { x: r.left + 420, y: r.top + 6 };
});
await page.mouse.move(spot.x, spot.y);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(400);
const placed = await page.evaluate(() => ({
  n: Annotate.noteCount(), markers: document.querySelectorAll('.an-note').length,
  card: !!document.querySelector('.an-card'),
  focused: document.activeElement === document.querySelector('.an-card-t'),
  m: (() => { const x = Annotate._marks().find(k => k.kind === 'note'); return { key: x?.key, u: x?.u }; })()
}));
say('tapping the page leaves a note there', placed.n === 1 && placed.markers === 1);
say('  anchored to the paragraph it was put beside, in that block’s own width',
  placed.m.key === 'q0.p0' && placed.m.u === 'w', placed.m.key + ' · ' + placed.m.u);
say('  open, with the cursor already in it', placed.card && placed.focused);

await page.keyboard.type('Vulsellum — ask about the ridges. Traction, not avulsion.');
await page.waitForTimeout(300);
const typed = await page.evaluate(() => {
  const m = Annotate._marks().find(k => k.kind === 'note');
  return { text: m?.text || '', marker: document.querySelector('.an-note')?.className || '',
    label: document.querySelector('.an-note')?.getAttribute('aria-label') || '' };
});
say('what is typed is what is kept', /ridges/.test(typed.text), '“' + typed.text.slice(0, 40) + '…”');
/* A page of notes should be readable without opening every one. */
say('  a full note looks different from an empty one', /has-text/.test(typed.marker));
say('  and says what is in it, for a screen reader and a hover',
  /ridges/.test(typed.label));

/* ---------------------------------------------------------------- */
sec('4. IT OPENS AGAIN, IN ANY MODE');

await page.click('[data-note-done]'); await page.waitForTimeout(250);
const shut = await page.evaluate(() => !!document.querySelector('.an-card'));
say('it closes', !shut);

await page.click('[data-an-t="read"]'); await page.waitForTimeout(200);
await page.click('.an-note'); await page.waitForTimeout(350);
const reopened = await page.evaluate(() => ({
  card: !!document.querySelector('.an-card'),
  val: document.querySelector('.an-card-t')?.value || ''
}));
/* Reading mode is where a note is READ, so it has to open there — with
   no instrument in hand at all. */
say('and opens again from the page, while simply reading',
  reopened.card && /ridges/.test(reopened.val), '“' + reopened.val.slice(0, 30) + '…”');

/* The paper it is written on can be changed, and the marker follows. */
const recoloured = await page.evaluate(async () => {
  document.querySelector('[data-note-c="#cfe6ff"]').click();
  await new Promise(r => setTimeout(r, 150));
  const m = Annotate._marks().find(k => k.kind === 'note');
  return { c: m.c, marker: document.querySelector('.an-note').style.background };
});
say('  the paper can be changed', recoloured.c === '#cfe6ff' && /207, 230, 255/.test(recoloured.marker),
  recoloured.marker);

/* ---------------------------------------------------------------- */
sec('5. KEPT, LIKE EVERY OTHER MARK');

const kept = await page.evaluate(async () => {
  await Annotate.save();
  const stored = await Backend.getAnnotations('osce:NOT');
  const note = (stored?.marks || []).find(m => m.kind === 'note');
  return { saved: (stored?.marks || []).length, text: note?.text || '', c: note?.c };
});
say('the note is stored with the rest', kept.saved >= 1 && /ridges/.test(kept.text));

await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(600);
await page.evaluate(() => { location.hash = '#/osce/station/NOT'; });
await page.waitForTimeout(1200);
await page.click('#os-read');
await page.waitForTimeout(900);
const back = await page.evaluate(() => ({
  n: Annotate.noteCount(), markers: document.querySelectorAll('.an-note').length,
  text: Annotate._marks().find(m => m.kind === 'note')?.text || ''
}));
say('closing and reopening brings it back', back.n === 1 && back.markers === 1);
say('  with what was written on it', /ridges/.test(back.text));

/* ---------------------------------------------------------------- */
sec('6. AND IT CAN BE THROWN AWAY');

const binned = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  document.querySelector('.an-note').click();
  await wait(250);
  document.querySelector('[data-note-del]').click();
  await wait(250);
  return { n: Annotate.noteCount(), markers: document.querySelectorAll('.an-note').length,
    card: !!document.querySelector('.an-card') };
});
say('the bin empties it off the page', binned.n === 0 && binned.markers === 0 && !binned.card);

/* An empty note is a tap in the wrong place, not a note. */
const litter = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  Annotate.setTool('note'); await wait(40);
  const r = document.querySelector('[data-an="q0.p1"]').getBoundingClientRect();
  const pane = document.querySelector('.rd-scroll');
  const ev = t => new PointerEvent(t, { pointerType: 'touch', pointerId: 501, bubbles: true,
    clientX: r.left + 60, clientY: r.top + 4, isPrimary: true });
  pane.dispatchEvent(ev('pointerdown'));
  pane.dispatchEvent(ev('pointerup'));
  await wait(250);
  const made = Annotate.noteCount();
  Annotate.closeNote();
  await wait(150);
  return { made, after: Annotate.noteCount() };
});
say('a note tapped out by accident and never written in does not litter the page',
  litter.made === 1 && litter.after === 0, litter.made + ' → ' + litter.after);

/* ---------------------------------------------------------------- */
sec('7. STAMPS');
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v112/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '112', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
