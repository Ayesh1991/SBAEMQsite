/* t121 — everything a candidate sees is their own course's.

   TWO THINGS WERE STILL SHARED after v120, and both are the kind that look
   like working software right up to the moment somebody notices.

   THE BLUEPRINT. One row for the platform, holding the shape of one exam:
   how many SBAs, how many EMQs, how long, what each topic is worth. None of
   that transfers. A final MBBS mock sampled from the Part 2 weights is a
   Part 2 paper wearing another name, and the result is believed because it
   says "blueprint" on it. Worse than a missing feature: a measurement that
   is wrong without looking wrong.

   THE REMAINING BANKS. Only the OSCE bank was filtered by course (v116).
   Papers, essays and cases were not, so a final MBBS candidate browsing the
   library saw the whole O&G Part 2 bank.

   AND THE BUNDLED CONTENT, which is the subtle one. data/manifest.json,
   data/syllabus.json and data/blueprint.md all ship with the site and all
   three belong to ONE course — the exam AUREUM was built for. Reaching the
   course filter with no course on them, they would count as "unfiled",
   which errs towards SHOWING them (see Course.fits — the right default for
   a tag somebody forgot, the wrong one for a whole bundled bank). So each
   now names its course in its own file, and §3 is that proof.

   WHAT AN EMPTY BLUEPRINT MUST DO is refuse, loudly. Sampling no buckets
   falls straight through to the top-up and hands out thirty arbitrary
   questions dressed as a blueprint-shaped paper. §4 holds that line. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE BLUEPRINT IS KEYED BY COURSE');

const js = readFileSync('js/backend.js', 'utf8');
const bpJs = readFileSync('js/blueprint.js', 'utf8');
const sql = readFileSync('supabase/schema.sql', 'utf8');
say('both backends key it by course',
  (js.match(/async function getBlueprint\(trackId\)/g) || []).length === 2
  && (js.match(/async function saveBlueprint\(doc, trackId\)/g) || []).length === 2);
say('  and read the pre-v121 row as the course that existed',
  /ids\.push\('blueprint'\)/.test(js) && /trackId === 'pgim-og-2'/.test(js));
say('  the schema copies it to that course',
  /select 'blueprint:pgim-og-2', data from public\.app_config where id = 'blueprint'/.test(sql));
/* THE FALLBACK THAT MUST NOT LEAK. */
say('the bundled blueprint is the fallback only for the course it names',
  /!t \|\| !bundled\.track \|\| bundled\.track === t/.test(bpJs));
say('  and data/blueprint.md names it',
  /^track: pgim-og-2$/m.test(readFileSync('data/blueprint.md', 'utf8')));
/* A per-course cache that only busts one key leaves the others stale. */
say('a course switch drops every cached blueprint, not just one',
  /Course\.all\(\) : \[\]\)\.forEach\(t => Cache\.bust\(keyFor\(t\.id\)\)\)/.test(bpJs));

/* ---------------------------------------------------------------- */
sec('2. AND THE CARDS CARRY WHAT THE FILTER NEEDS');

/* A bank cannot filter on a column the read never selected. This is how
   v116's OSCE filter worked and how the other three silently did not. */
say('papers carry their course, subject and true/false count',
  /'sba:meta->sba,emq:meta->emq,tf:meta->tf,tracks,subject'/.test(js));
say('  essay papers carry theirs', /essay_papers'\)\.select\('id,meta,tracks,subject'\)/.test(js));
say('  cases carry theirs', /case_files'\)\.select\('id,meta,tracks,subject'\)/.test(js));
/* The local backend projects cases through a key list, so the columns have
   to be in it or local mode filters nothing. */
say('  and the local case card keeps them too', /'tracks', 'subject'\];/.test(js));

/* The editor's view stays whole — that is the reason for a second call. */
const dataJs = readFileSync('js/data.js', 'utf8');
say('the filtered bank is a separate call, so the console still sees everything',
  /async function myPapers\(\)/.test(dataJs) && /an editor has to see every paper/.test(dataJs));
say('  and the library asks for the filtered one',
  /Data\.loadSyllabus\(\), Data\.myPapers\(\), Backend\.getProgress\(\)/.test(readFileSync('js/app.js', 'utf8')));
say('  as does the mock pool', /const papers = await Data\.myPapers\(\);/.test(readFileSync('js/simulator.js', 'utf8')));

/* ---------------------------------------------------------------- */
sec('3. IN THE RUNNING APP');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.click('#auth-toggle'); await page.waitForTimeout(300);
await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1700);

const og2 = await page.evaluate(async () => {
  const b = await Blueprint.load();
  return { track: b.track, sba: b.sba.length, emq: b.emq.length, sbaCount: b.paper.sbaCount };
});
say('the course that exists keeps its blueprint', og2.sba > 0 && og2.emq > 0,
  og2.sba + ' SBA buckets, ' + og2.emq + ' EMQ themes');
say('  including its paper shape', og2.sbaCount === 30, 'sbaCount ' + og2.sbaCount);

/* A SECOND COURSE INHERITS NOTHING. */
const fresh = await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS — Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null, subjects: ['medicine', 'surgery'],
    positions: ['Final year student'], sort: 5, isLive: true, isFree: true });
  Course.bust(); await Course.load();
  const b = await Blueprint.load('mbbs-final');
  return { sba: b.sba.length, emq: b.emq.length };
});
say('a new course does NOT inherit the other exam’s blueprint',
  fresh.sba === 0 && fresh.emq === 0, JSON.stringify(fresh));

/* Four banks, two courses. */
await page.evaluate(async () => {
  const mk = (id, title, tracks) => ({ id, title, categoryId: 'obstetrics',
    sectionId: 'obs-antenatal', topicId: 't-preconception', sba: 1, emq: 0, tf: 0, tracks,
    content: { topic: title, sba: [{ stem: 's', options: ['a', 'b'], answer: 0 }] } });
  await Backend.publishPaper(mk('t121-og', 'An O&G paper', ['pgim-og-2']));
  await Backend.publishPaper(mk('t121-mbbs', 'A final MBBS paper', ['mbbs-final']));
  await Backend.publishEssayPaper({ id: 't121-e-og', title: 'O&G essay', tracks: ['pgim-og-2'], questions: [] });
  await Backend.publishEssayPaper({ id: 't121-e-mbbs', title: 'MBBS essay', tracks: ['mbbs-final'], questions: [] });
  await Backend.publishCase({ id: 't121-c-og', title: 'O&G case', tracks: ['pgim-og-2'], phases: [], questions: [] });
  await Backend.publishCase({ id: 't121-c-mbbs', title: 'MBBS case', tracks: ['mbbs-final'], phases: [], questions: [] });
  Data.bustPapers?.(); Essay.bustPapers?.(); Cases.bustCases?.();
});
const read = () => page.evaluate(async () => ({
  all: (await Data.publishedPapers()).map(p => p.id),
  papers: (await Data.myPapers()).map(p => p.id),
  essays: (await Essay.papers()).map(p => p.id),
  cases: (await Cases.cases()).map(c => c.id),
  bp: (await Blueprint.load()).sba.length
}));
const on2 = await read();
say('an editor still sees every paper on the platform',
  on2.all.includes('t121-og') && on2.all.includes('t121-mbbs'), on2.all.length + ' papers');
say('  while the candidate’s bank is their own course’s',
  on2.papers.includes('t121-og') && !on2.papers.includes('t121-mbbs'), on2.papers.join(', '));
/* THE BUNDLED BANK. Five O&G papers ship with the site; they belong to the
   course the site was built for and must not follow the candidate. */
say('  and the bundled papers count as that course’s',
  on2.papers.includes('p-hypertensive-disorders'), on2.papers.length + ' in the bank');
say('the essay bank is scoped too', on2.essays.join() === 't121-e-og', on2.essays.join(', '));
say('  and the case bank', on2.cases.join() === 't121-c-og', on2.cases.join(', '));

/* SWITCH COURSE AND ALL FOUR FOLLOW — plus the blueprint. Six caches in six
   modules, and the failure when one is missed is not an error, it is the
   previous course's content sitting there looking plausible. */
await page.evaluate(async () => { await Course.choose('mbbs-final'); });
const onM = await read();
say('switching course switches the paper bank',
  onM.papers.join() === 't121-mbbs', onM.papers.join(', '));
say('  including the bundled O&G papers, which do not follow',
  !onM.papers.some(id => /^p-/.test(id)), onM.papers.length + ' papers');
say('  the essay bank', onM.essays.join() === 't121-e-mbbs', onM.essays.join(', '));
say('  the case bank', onM.cases.join() === 't121-c-mbbs', onM.cases.join(', '));
say('  and the blueprint', onM.bp === 0, onM.bp + ' SBA buckets');

/* ---------------------------------------------------------------- */
sec('4. A MOCK WITHOUT A BLUEPRINT IS REFUSED, NOT FAKED');

await page.goto(B + '/index.html?r=' + Math.random() + '#/simulator/run', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2700);
const sim = await page.evaluate(() => ({
  title: document.querySelector('.page-title')?.textContent || '',
  body: document.querySelector('.card')?.textContent.replace(/\s+/g, ' ').trim() || '',
  cards: document.querySelectorAll('.quiz-question').length
}));
/* The engine must not produce a paper. Thirty arbitrary questions with a
   blueprint's name on them is worse than no mock, because the score is
   believed. */
say('no blueprint means no mock', /No blueprint for Final MBBS yet/.test(sim.title), sim.title);
say('  and no quiz is started', sim.cards === 0);
say('  it says why, in terms of the blueprint', /sampled from a blueprint/.test(sim.body),
  sim.body.slice(0, 70));
/* Refusing one thing must not read as the whole app being broken. */
say('  and points at what still works', /design your own paper/.test(sim.body));

/* ---------------------------------------------------------------- */
sec('5. AND THE CONSOLE EDITS ONE COURSE AT A TIME');

await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));
await page.goto(B + '/index.html#/dev/blueprint', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
const panel = await page.evaluate(() => ({
  options: [...document.querySelectorAll('#bp-course option')].map(o => o.value),
  selected: document.querySelector('#bp-course')?.value || '',
  summary: document.querySelector('#bp-summary')?.textContent.replace(/\s+/g, ' ').trim() || ''
}));
say('the blueprint page asks which course', panel.options.join() === 'mbbs-final,pgim-og-2',
  panel.options.join(', '));
say('  opening on the one the editor is studying for', panel.selected === 'mbbs-final', panel.selected);
say('  and saying plainly that it has none yet',
  /No blueprint for Final MBBS yet/.test(panel.summary), panel.summary.slice(0, 70));

/* Switch to the other course and the same page shows a real blueprint. */
await page.selectOption('#bp-course', 'pgim-og-2'); await page.waitForTimeout(1200);
const other = await page.evaluate(() =>
  document.querySelector('#bp-summary')?.textContent.replace(/\s+/g, ' ').trim() || '');
say('switching course on the page shows that course’s blueprint',
  !/No blueprint/.test(other) && other.length > 20, other.slice(0, 70));
/* A half-finished edit belongs to the course it was opened for. Carrying it
   across would save one exam's weights onto another. */
const devJs = readFileSync('js/dev-console.js', 'utf8');
say('  and a half-edited blueprint is not carried across', /bpEdit = null;\n      view\.querySelector\('#bp-studio'\)\.innerHTML = '';/.test(devJs));

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v121/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '121', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
