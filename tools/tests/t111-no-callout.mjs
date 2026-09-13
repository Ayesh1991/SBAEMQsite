/* t111 — nothing in the reading overlay is selectable under a nib.

   THE REPORT: "when I'm writing that 'copy, find ……' appearing and
   distorting my writing."

   WHERE I HAD BEEN LOOKING, AND WHY IT WAS THE WRONG PLACE.

   In the video the Copy / Find Selection / Look Up / Translate callout
   sits at the TOP of the screen, level with the reading bar, while the
   pencil is writing in the middle of the page. That position is the
   whole answer: iOS puts the callout beside the text it belongs to, so
   the selected text was never in the document at all.

   `user-select: none` had been applied to `.rd-doc` — the 680px column —
   and to nothing else. The hand resting in the MARGIN beside that column
   is on `.rd-scroll`, which was still selectable, and a long press there
   is a text interaction that WebKit resolves against the nearest
   selectable text it can find: the bar at the top, with the words
   "Reading mode" and "Print / Save as PDF" in it.

   And the callout is not merely ugly. Starting a text interaction
   cancels the pen's pointer stream, so the stroke in progress is cut —
   which is why it "distorts the writing" rather than just appearing.

   Said three ways here, deliberately: the rule (`user-select: none` on
   the pane AND the bar), the refusal (`selectstart` and `contextmenu`
   prevented while an instrument is held), and the cleanup (a callout
   already on screen is dismissed by the nib landing). The rule is a hint
   about what MAY be selected; iPadOS has reached round it more than
   once. */
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

await page.evaluate(async () => {
  const qs = [];
  for (let i = 1; i <= 4; i++) {
    qs.push({ id: i, prompt: 'Question ' + i + ' — would you continue rearing the child as female?', marks: 10,
      marking_points: ['Explain the need for gonadectomy because of malignancy risk in the retained testes (2)',
        'Oestrogen replacement until around age 50 for feminisation, breast development and bone health (2)'] });
  }
  await Backend.publishOsceStation({ id: 'CAL', topic: 'Disorders of sex development',
    scenario: 'A child is referred with ambiguous genitalia.',
    station_time_min: 15, total_marks: 100, pass_mark_percent: 70, questions: qs });
  OSCE.bustStations?.();
});

await page.evaluate(() => { location.hash = '#/osce/station/CAL'; });
await page.waitForTimeout(1400);
await page.click('#os-read');
await page.waitForTimeout(1000);

/* ---------------------------------------------------------------- */
sec('1. THE BAR IS NOT TEXT TO BE SELECTED, EVER');

/* Where the callout in the video was pointing. Nobody has ever wanted
   to select a toolbar, and while a pencil is on the glass it is the
   only selectable thing left near the top of the screen. */
const bar = await page.evaluate(() => {
  const b = document.querySelector('.rd-bar');
  const btn = document.querySelector('[data-rd-print]');
  const cs = getComputedStyle(b), cb = getComputedStyle(btn);
  return { bar: cs.userSelect, btn: cb.userSelect, callout: cs.webkitTouchCallout || 'none',
    words: /Reading mode/.test(b.textContent) };
});
say('the reading bar has words in it, which is why this mattered', bar.words);
say('  and none of them can be selected', bar.bar === 'none', bar.bar);
say('  nor the text of its buttons', bar.btn === 'none', bar.btn);
say('  and it offers no long-press menu', bar.callout === 'none', bar.callout);

/* ---------------------------------------------------------------- */
sec('2. NOR ANYTHING ELSE IN THE PANE, WITH AN INSTRUMENT IN HAND');

const modes = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  const doc = document.querySelector('.rd-doc');
  const out = {};
  for (const t of ['read', 'hl', 'ul', 'pen', 'erase']) {
    Annotate.setTool(t);
    await new Promise(r => setTimeout(r, 30));
    out[t] = { pane: getComputedStyle(pane).userSelect, doc: getComputedStyle(doc).userSelect };
  }
  Annotate.setTool('pen');
  await new Promise(r => setTimeout(r, 30));
  return out;
});
/* THE HOLE. The margin beside the column is the pane, not the document,
   and it is exactly where a right hand rests. */
say('with the pen, the whole pane refuses a selection — margins included',
  modes.pen.pane === 'none', 'pane ' + modes.pen.pane);
say('  and so it does for every other instrument',
  ['hl', 'ul', 'erase'].every(t => modes[t].pane === 'none'));
say('  while reading, the document is text again — selectable, copyable',
  modes.read.pane !== 'none' && modes.read.doc !== 'none',
  'pane ' + modes.read.pane + ' · doc ' + modes.read.doc);

/* ---------------------------------------------------------------- */
sec('3. AND A SELECTION IS REFUSED AS IT STARTS');

/* `user-select` is a hint about what MAY be selected. This is the
   statement that it may not. */
const refused = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  const fire = () => {
    const e = new Event('selectstart', { bubbles: true, cancelable: true });
    pane.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const menu = () => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    pane.dispatchEvent(e);
    return e.defaultPrevented;
  };
  Annotate.setTool('pen'); await new Promise(r => setTimeout(r, 30));
  const pen = { sel: fire(), menu: menu() };
  Annotate.setTool('read'); await new Promise(r => setTimeout(r, 30));
  const read = { sel: fire(), menu: menu() };
  Annotate.setTool('pen'); await new Promise(r => setTimeout(r, 30));
  return { pen, read };
});
say('a selection starting under a nib is refused', refused.pen.sel);
say('  and so is the long-press menu', refused.pen.menu);
say('  neither is refused while reading, where both are wanted',
  !refused.read.sel && !refused.read.menu);

/* ---------------------------------------------------------------- */
sec('4. A CALLOUT ALREADY ON SCREEN IS DISMISSED BY THE NIB');

const cleared = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  /* A selection made before the pen was picked up — which is how one
     gets on screen in the first place. */
  Annotate.setTool('read'); await new Promise(r => setTimeout(r, 30));
  const el = document.querySelector('[data-an="q0.p0"]');
  el.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 250));
  const r = document.createRange(); r.selectNodeContents(el);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  const before = s.toString().length;

  Annotate.setTool('pen'); await new Promise(r => setTimeout(r, 50));
  const b = el.getBoundingClientRect();
  pane.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', pointerId: 111,
    bubbles: true, clientX: b.left + 40, clientY: b.top + 10, pressure: 0.5, isPrimary: true }));
  pane.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'pen', pointerId: 111,
    bubbles: true, clientX: b.left + 40, clientY: b.top + 10, pressure: 0.5, isPrimary: true }));
  await new Promise(r => setTimeout(r, 120));
  return { before, after: window.getSelection().toString().length };
});
say('a selection made before picking up the pen', cleared.before > 10, cleared.before + ' characters');
say('  is gone the moment the nib lands', cleared.after === 0, cleared.after + ' characters');

/* ---------------------------------------------------------------- */
sec('5. AND THE WRITING ITSELF IS UNAFFECTED');

/* The point of all of it: the stroke is not interrupted. */
const wrote = await page.evaluate(async () => {
  const pane = document.querySelector('.rd-scroll');
  const col = document.querySelector('.rd-doc').getBoundingClientRect();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(900);
  const n0 = Annotate.count();
  const pen = (t, x, y) => new PointerEvent(t, { pointerType: 'pen', pointerId: 112, bubbles: true,
    clientX: x, clientY: y, pressure: 0.5, isPrimary: true });
  const palm = (t, y) => new PointerEvent(t, { pointerType: 'touch', pointerId: 113, bubbles: true,
    clientX: col.right + 70, clientY: y, isPrimary: true });
  pane.dispatchEvent(palm('pointerdown', 700));
  pane.dispatchEvent(pen('pointerdown', col.left + 60, 500));
  for (let i = 1; i <= 20; i++) {
    pane.dispatchEvent(pen('pointermove', col.left + 60 + i * 10, 500 + Math.sin(i / 3) * 12));
    pane.dispatchEvent(palm('pointermove', 700 - i * 5));
    await wait(12);
  }
  pane.dispatchEvent(pen('pointerup', col.left + 260, 500));
  pane.dispatchEvent(palm('pointerup', 600));
  await wait(300);
  const m = Annotate._marks().filter(x => x.kind === 'ink').slice(-1)[0];
  return { made: Annotate.count() - n0, pts: (m?.pts || []).length,
    sel: window.getSelection().toString().length };
});
say('the stroke is written in one piece', wrote.made === 1 && wrote.pts > 15,
  wrote.made + ' stroke · ' + wrote.pts + ' points');
say('  with nothing selected anywhere by the hand that wrote it', wrote.sel === 0);

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v111/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '111', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
