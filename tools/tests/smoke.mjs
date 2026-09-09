/* smoke.mjs — every page draws, and nothing throws on the way.

   WHY THIS EXISTS, AND WHY IT IS IN THE REPOSITORY

   The detailed tests for each release used to live in a scratch
   directory beside the working copy. That directory is not part of the
   project, and when the machine it was on went away so did fifty test
   files — proven coverage that could not be re-run against the next
   change. A test that is not in the repository is a test you have only
   once.

   So this one is committed, and it is deliberately the SHALLOW kind: it
   opens every route in the application, in local mode, with a signed-in
   account and a little seeded data, and asserts only that the page
   renders and that nothing was thrown or logged as an error on the way.

   That is a low bar. It is also the bar that catches the failures which
   hurt most and are easiest to introduce — a typo in a template string, a
   `const` used above its declaration, a renamed export that one caller
   still asks for. Those turn a page white, and a white page is worse
   than a wrong number because nothing on it says what happened.

   Run it with the site served locally:

     python3 -m http.server 8907 --directory .
     node tools/tests/smoke.mjs            # or: node tools/tests/smoke.mjs http://127.0.0.1:8907
*/
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = process.argv[2] || 'http://127.0.0.1:8907';
let fails = 0;
const bad = [];
const say = (w, ok, x) => { console.log('  ' + (ok ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!ok) fails++; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
/* Local mode: no Supabase, so nothing here can touch a real database. */
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });

const page = await ctx.newPage();
let here = '(start)';
page.on('pageerror', e => bad.push(here + ' — PAGEERROR ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // a blocked CDN or a missing favicon is the sandbox, not the app
  if (/ERR_|Failed to load resource|net::/.test(t)) return;
  bad.push(here + ' — CONSOLE ' + t);
});

await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.click('#auth-toggle'); await page.waitForTimeout(250);
await page.fill('input[name=name]', 'Dr Smoke Test');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');       // the developer, so the dev pages draw too
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]');
await page.waitForTimeout(1600);

/* Just enough data that the list pages have something to draw and the
   detail pages have something to open. */
const seeded = await page.evaluate(async () => {
  await Backend.publishOsceStation({
    id: 'SMOKE-1', topic: 'Postpartum haemorrhage', scenario: 'A 28-year-old woman, one hour after delivery.',
    station_time_min: 15, total_marks: 20, pass_mark_percent: 70,
    questions: [{ id: 1, prompt: 'What are your immediate priorities?', marks: 20,
      marking_points: ['Call for help', 'Uterine massage', 'Oxytocic', 'Two wide-bore cannulae', 'Cross-match'] }]
  });
  await Backend.publishEssayPaper({
    id: 'SMOKE-P', examTitle: 'MD (O&G) Part II', durationHours: 3,
    sections: [{ sectionTitle: 'Paper A', questions: [{ code: 'SMOKE-Q1', type: 'SEQ', totalMarks: 100,
      stem: 'Discuss the management of postpartum haemorrhage.',
      parts: [{ label: '(a)', text: 'Immediate', marks: 50 }, { label: '(b)', text: 'Ongoing', marks: 50 }] }] }]
  });
  await Backend.saveOsceAttempt({
    id: 'smoke-att', station_id: 'SMOKE-1',
    station: { topic: 'Postpartum haemorrhage', scenario: 'A 28-year-old woman.', total_marks: 20, pass_mark: 14 },
    questions: [{ id: 1, prompt: 'What are your immediate priorities?', marks: 20,
      marking_points: ['Call for help', 'Uterine massage', 'Oxytocic', 'Two wide-bore cannulae', 'Cross-match'] }],
    answers: [{ id: 1, transcript: 'Call for help and rub up a contraction.' }],
    result: { questions: [{ id: 1, awarded: 8, max: 20, points: [
      { point: 'Call for help', status: 'covered', note: 'said' },
      { point: 'Uterine massage', status: 'covered', note: 'said' },
      { point: 'Oxytocic', status: 'missed', note: '' },
      { point: 'Two wide-bore cannulae', status: 'missed', note: '' },
      { point: 'Cross-match', status: 'missed', note: '' }] }],
      total: 8, max: 20, percent: 40, pass: false, examinerComment: 'Right start, no follow-through.' },
    created: Date.now(), model: 'gemini-3.1-flash-lite'
  });
  OSCE.bustStations?.(); Essay.bustPapers?.();
  return true;
});
say('the seed data went in', seeded);

/* Every route the router knows, with real ids where one is needed. A
   route left out of this list is a route nobody is watching. */
const ROUTES = [
  '#/dashboard', '#/library', '#/library/notes',
  '#/library/essay', '#/library/essay/writing', '#/library/essay/how', '#/library/essay/pgim',
  '#/library/essay/SMOKE-P', '#/library/essay/SMOKE-P/write/0',
  '#/osce', '#/osce/sim', '#/osce/mine', '#/osce/progress', '#/osce/recall',
  '#/osce/cards', '#/osce/real', '#/osce/edit',
  '#/osce/station/SMOKE-1', '#/osce/mark/SMOKE-1', '#/osce/result/smoke-att',
  '#/cases', '#/cases/mine', '#/cases/mine-disc',
  '#/billing', '#/profile', '#/studio', '#/review', '#/peer', '#/cards',
  '#/simulator', '#/simulator/design', '#/simulator/search', '#/mistakes',
  '#/library/cpd',
  '#/dev', '#/dev/users', '#/dev/osce', '#/dev/blueprint', '#/dev/essays', '#/dev/settings'
];

console.log('\n======== EVERY ROUTE DRAWS ========');
for (const r of ROUTES) {
  here = r;
  await page.evaluate(h => { location.hash = h; }, r);
  await page.waitForTimeout(650);
  const state = await page.evaluate(() => {
    const v = document.getElementById('view');
    const t = (v?.textContent || '').replace(/\s+/g, ' ').trim();
    return { n: t.length, boom: /Something went wrong/.test(t), hash: location.hash };
  });
  /* A route that redirects (a gate, a missing record) is not a failure —
     it drew a decision. A blank page or the error card is. */
  const ok = !state.boom && state.n > 40;
  say(r, ok, state.boom ? 'the error card' : state.n < 40 ? state.n + ' characters — blank' : undefined);
}

console.log('\n======== NOTHING THREW ========');
say('no page errors and no console errors', bad.length === 0);
if (bad.length) bad.slice(0, 25).forEach(b => console.log('    ' + b));
fails += bad.length;

console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
