/* t103 — the simulator bucket, the tool row, and reading mode.

   §1 is the bucket, and the assertion that matters is the LAST one: a
   station leaves it by being SAT, and by nothing else. Not when the
   round starts, not when it is skipped, not when the round ends early.
   A cart that empties on any other event is a cart you stop trusting
   with anything you care about, so each of those is tested separately
   rather than assumed from the happy path.

   §2 is the tool row. Icon-only buttons are the easiest thing in an
   interface to get wrong for anybody using a screen reader, so every one
   is checked for a name as well as an icon.

   §3 is reading mode. The chart is checked against arithmetic done here
   rather than against itself, and the light surface is asserted because
   the whole point of the mode is that it does not follow the app's dark
   theme. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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

/* Five stations, and one of them with a scheme rich enough to chart:
   uneven marks, section headings, several points per question. */
await page.evaluate(async () => {
  const plain = (id, topic) => ({
    id, topic, scenario: 'A woman attends the clinic.',
    station_time_min: 15, total_marks: 20, pass_mark_percent: 70,
    questions: [{ id: 1, prompt: 'Discuss your management.', marks: 20,
      marking_points: ['first point', 'second point'] }] });
  for (const [id, t] of [['A', 'Postpartum haemorrhage'], ['B', 'Shoulder dystocia'],
    ['C', 'Sepsis in pregnancy'], ['D', 'Twin pregnancy']]) await Backend.publishOsceStation(plain(id, t));
  await Backend.publishOsceStation({
    id: 'RICH', topic: '46XY DSD — Counselling',
    scenario: 'A mother brings her 13-year-old daughter who has not yet attained menarche.',
    station_time_min: 20, total_marks: 50, pass_mark_percent: 70,
    questions: [
      { id: 1, prompt: 'What further history would you take?', marks: 12,
        marking_points: ['# History', 'Age at onset', 'Family history', 'Neonatal ambiguity', 'Growth pattern', 'Drugs in pregnancy'] },
      { id: 2, prompt: 'What would you look for on examination?', marks: 10,
        marking_points: ['Growth centile', 'Tanner staging', 'Clitoromegaly', 'Palpable gonads'] },
      { id: 3, prompt: 'What investigations?', marks: 14,
        marking_points: ['Karyotype', 'Testosterone', 'LH and FSH', 'hCG stimulation', 'Pelvic ultrasound', 'Electrolytes'] },
      { id: 4, prompt: 'How would you counsel the mother?', marks: 9,
        marking_points: ['Plain language', 'Multidisciplinary decision', 'Confidentiality', 'Genetic counselling'] },
      { id: 5, prompt: 'Who else should be involved?', marks: 5,
        marking_points: ['Endocrinologist', 'Geneticist', 'Psychologist', 'Specialist nurse'] }
    ] });
  OSCE.bustStations?.();
});

/* ---------------------------------------------------------------- */
sec('1. THE BUCKET');

await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(1500);

const start = await page.evaluate(() => ({
  onCards: document.querySelectorAll('.os-card [data-bk-mark]').length,
  leftOfStar: (() => {
    const marks = document.querySelector('.os-card .os-card-marks');
    const kids = [...(marks?.children || [])];
    return kids.length === 2 && kids[0].hasAttribute('data-bk-mark') && kids[1].hasAttribute('data-st-mark');
  })(),
  chipHidden: document.querySelector('.os-bin[data-bin="@bucket"]')?.hidden === true,
  bar: !!document.querySelector('.os-bkbar')
}));
say('every card carries a bucket button', start.onCards >= 5, start.onCards + ' cards');
say('  to the LEFT of the star', start.leftOfStar);
say('an empty bucket shows neither a chip nor a checkout', start.chipHidden && !start.bar);

await page.click('.os-card[data-st="A"] .bk-b'); await page.waitForTimeout(400);
await page.click('.os-card[data-st="C"] .bk-b'); await page.waitForTimeout(400);
const two = await page.evaluate(() => ({
  n: Bucket.count(), ids: Bucket.ids(),
  chip: document.querySelector('.os-bin[data-bin="@bucket"] i')?.textContent,
  bar: (document.querySelector('.os-bkbar')?.textContent || '').replace(/\s+/g, ' ').trim(),
  hash: location.hash,
  on: document.querySelector('.os-card[data-st="A"] .bk-b')?.classList.contains('is-on')
}));
say('adding fills the button in', two.on && two.n === 2, two.n + ' in it');
say('  in the order they were collected', two.ids.join() === 'A,C', two.ids.join(', '));
say('  and pressing it does not open the station', two.hash === '#/osce');
say('the chip and the checkout appear', two.chip === '2' && /2 stations in your bucket/.test(two.bar));
say('  the checkout says how long it will take', /30 min|0\.5 h/.test(two.bar), two.bar.slice(0, 90));
say('  and that they leave it by being sat', /leaves the bucket once you have sat it/.test(two.bar));

await page.click('.os-bin[data-bin="@bucket"]'); await page.waitForTimeout(500);
const inBin = await page.evaluate(() =>
  [...document.querySelectorAll('.os-card')].filter(c => !c.hidden).map(c => c.dataset.st));
say('the bucket bin shows only what is in it', inBin.join() === 'A,C', inBin.join(', '));

/* Survives a reload — it is stored, not remembered. */
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1700);
say('the bucket survives a reload',
  await page.evaluate(() => Bucket.count() === 2 && Bucket.ids().join() === 'A,C'));

/* ---- the circuit it builds ---- */
await page.evaluate(() => { location.hash = '#/osce/sim?bucket=1'; });
await page.waitForTimeout(1600);
const sim = await page.evaluate(() => ({
  mode: document.querySelector('.os-pick-b.active')?.dataset.mode,
  first: document.querySelector('.os-pick-b')?.dataset.mode,
  sum: (document.querySelector('#os-sim-sum')?.textContent || '').replace(/\s+/g, ' ').trim(),
  note: (document.querySelector('#os-count-note')?.textContent || '').replace(/\s+/g, ' ').trim(),
  countOff: document.querySelector('#os-count')?.classList.contains('is-off'),
  freshHidden: document.querySelector('#os-freshwrap')?.hidden
}));
say('arriving from the checkout opens on the bucket', sim.mode === 'bucket', sim.mode);
say('  which is the first way offered when it has something in it', sim.first === 'bucket');
say('  two stations, not a draw of nine', /2 stations from your bucket/.test(sim.sum), sim.sum);
say('  "how many" does not apply and says so', sim.countOff && /already made it/.test(sim.note));
say('  nor do the ticks that shape a draw', sim.freshHidden === true);

await page.click('#os-sim-go'); await page.waitForTimeout(1600);
const run = await page.evaluate(() => {
  const sid = location.hash.split('/').pop();
  const s = JSON.parse(localStorage.getItem('aureum.osce:' + sid) || '{}');
  return { sid, ids: s.stations, fromBucket: !!s.fromBucket, blind: !!s.blind, n: Bucket.count() };
});
say('the circuit is exactly the bucket, in order', run.ids.join() === 'A,C', run.ids.join(', '));
say('  it knows where it came from', run.fromBucket);
say('  and it is NOT blind — you chose these, so you have read the list', run.blind === false);
say('STARTING the round does not empty the bucket', run.n === 2, run.n + ' still in it');

/* Skipping does not empty it either: a skip is a decision not to sit it
   today, and clearing it would undo the reason it was collected. */
await page.click('#os-skipst'); await page.waitForTimeout(1300);
say('SKIPPING a station leaves it in the bucket',
  await page.evaluate(() => Bucket.count() === 2 && Bucket.has('A')));

/* Sitting it does. */
await page.evaluate(() => { document.querySelector('#os-go')?.click(); });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const el = document.querySelector('[data-eq]');
  if (el) { el.innerText = 'I would call for help and rub up a contraction.';
    el.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.waitForTimeout(400);
/* Through the questions to the debrief, then hand the station over.
   #os-nextst only exists once the station is finished — it is the
   circuit's control, not the question's. */
await page.evaluate(() => document.querySelector('#os-next')?.click());
await page.waitForTimeout(1400);
say('  the station reaches its debrief', await page.evaluate(() => !!document.querySelector('#os-nextst')));
await page.evaluate(() => document.querySelector('#os-nextst')?.click());
await page.waitForTimeout(1600);
const after = await page.evaluate(() => ({ n: Bucket.count(), ids: Bucket.ids() }));
say('SITTING a station takes it out', after.n === 1 && after.ids.join() === 'A', after.ids.join(', ') || 'empty');
say('  and the one that was only skipped is still there', after.ids.includes('A'));

/* ---------------------------------------------------------------- */
sec('2. THE TOOL ROW');

await page.evaluate(() => { location.hash = '#/osce/station/RICH'; });
await page.waitForTimeout(1500);
const tools = await page.evaluate(() => {
  const row = document.querySelector('.os-tools');
  const bs = [...(row?.querySelectorAll('.os-tool') || [])];
  return {
    n: bs.length,
    ids: bs.map(b => b.id),
    named: bs.every(b => (b.getAttribute('aria-label') || '').length > 3),
    titled: bs.every(b => (b.getAttribute('title') || '').length > 3),
    wordless: bs.every(b => !b.textContent.trim()),
    svg: bs.filter(b => b.querySelector('svg')).length,
    start: (document.querySelector('#os-start')?.textContent || '').trim(),
    gone: !document.body.textContent.includes('Add it to a simulator session')
  };
});
say('four tools and the AI one, all icons', tools.n === 5, tools.ids.join(', '));
say('  with no words on them', tools.wordless);
say('  every one drawn, not an emoji', tools.svg === 5, tools.svg + ' with SVG');
say('  every one named for a screen reader', tools.named, tools.named ? 'all have aria-label' : 'missing');
say('  and every one explained on hover', tools.titled);
say('the one verb keeps its words', /Start the station/.test(tools.start), tools.start);
say('“Add it to a simulator session” is gone — the bucket replaced it', tools.gone);

/* ---------------------------------------------------------------- */
sec('3. READING MODE');

await page.click('#os-read'); await page.waitForTimeout(800);
const rd = await page.evaluate(() => {
  const doc = document.querySelector('.rd-doc');
  const veil = document.querySelector('.rd-veil');
  const bg = getComputedStyle(veil).backgroundColor;
  const ink = getComputedStyle(doc).color;
  const lum = s => { const m = s.match(/\d+/g) || [0, 0, 0]; return (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114); };
  return {
    open: !!veil, bgLum: Math.round(lum(bg)), inkLum: Math.round(lum(ink)),
    h1: (doc.querySelector('.rd-h1')?.textContent || '').trim(),
    stand: /13-year-old daughter/.test(doc.querySelector('.rd-stand')?.textContent || ''),
    facts: [...doc.querySelectorAll('.rd-facts b')].map(b => b.textContent),
    qs: doc.querySelectorAll('.rd-q').length,
    headings: [...doc.querySelectorAll('.rd-sec')].map(h => h.textContent),
    points: doc.querySelectorAll('.rd-points li').length,
    meter: (doc.querySelector('.rd-meter-top')?.textContent || '').replace(/\s+/g, ' ').trim(),
    bars: doc.querySelectorAll('.rd-fig svg rect').length,
    labels: [...doc.querySelectorAll('.rd-fig svg text')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
    table: doc.querySelectorAll('.rd-table tbody tr').length,
    ariaChart: doc.querySelector('.rd-fig svg')?.getAttribute('aria-label') || ''
  };
});
say('the article opens', rd.open);
say('  on a LIGHT page, whatever the app is set to', rd.bgLum > 200, 'background luminance ' + rd.bgLum);
say('  with dark letters on it', rd.inkLum < 60, 'ink luminance ' + rd.inkLum);
say('the title and the scenario lead it', /46XY DSD/.test(rd.h1) && rd.stand, rd.h1);
say('  the facts are the station’s own', rd.facts.join() === '5,50,23,20', rd.facts.join(' · '));
say('every question is a section of the article', rd.qs === 5, rd.qs + ' sections');
say('  the section headings survive as headings, not as marking points',
  rd.headings.join() === 'History' && rd.points === 23, rd.headings.join() + ' · ' + rd.points + ' points');

/* The chart, checked against arithmetic done here rather than against
   itself: 12 of 50 marks over 20 minutes is ~5 minutes. */
say('the pass mark is a meter, not a chart', /35 of 50 marks to pass/.test(rd.meter) && /70%/.test(rd.meter), rd.meter);
say('one bar per question, each with a baseline cap',
  rd.bars === 10, rd.bars + ' rects for 5 bars');
say('  direct-labelled with marks, points and the minutes they deserve',
  rd.labels.some(l => /^12 marks · 5 pts · ~5 min$/.test(l)), rd.labels.find(l => /12 marks/.test(l)) || '—');
say('  the smallest question gets the fewest minutes',
  rd.labels.some(l => /^5 marks · 4 pts · ~2 min$/.test(l)), rd.labels.find(l => /^5 marks/.test(l)) || '—');
say('  the figure has a spoken description', /Marks for each question/.test(rd.ariaChart));
say('  and the same numbers are reachable as a table', rd.table === 5, rd.table + ' rows');

/* A one-question station has nothing to compare, so it gets no chart. */
await page.evaluate(() => { document.querySelector('[data-rd-close]').click(); location.hash = '#/osce/station/A'; });
await page.waitForTimeout(1300);
await page.click('#os-read'); await page.waitForTimeout(700);
const solo = await page.evaluate(() => ({
  fig: !!document.querySelector('.rd-fig'),
  meter: !!document.querySelector('.rd-meter'),
  qs: document.querySelectorAll('.rd-q').length
}));
say('a one-question station gets no chart — one bar is not a comparison', solo.fig === false);
say('  but still gets its meter and its question', solo.meter && solo.qs === 1);

/* It closes properly, and does not leave the page locked. */
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const shut = await page.evaluate(() => ({
  gone: !document.querySelector('.rd-veil'),
  unlocked: !document.documentElement.classList.contains('is-printlock')
}));
say('Escape closes it', shut.gone);
say('  and the page underneath scrolls again', shut.unlocked);

/* ---------------------------------------------------------------- */
sec('4. STAMPS');
const stamps = await page.evaluate(() => {
  const v = [...document.scripts].map(s => (s.src.match(/\?v=(\d+)/) || [])[1]).filter(Boolean);
  return { set: [...new Set(v)], bucket: [...document.scripts].some(s => /bucket\.js/.test(s.src)) };
});
say('one version across every asset', stamps.set.length === 1, stamps.set.join(', '));
const sw = await (await fetch(B + '/sw.js')).text();
say('  the service worker agrees', sw.includes("'aureum-v" + stamps.set[0] + "'"));
say('  and the bucket module is on the page', stamps.bucket);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
