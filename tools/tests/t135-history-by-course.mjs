/* t135 — a candidate's history belongs to the course it was made on.

   CONTENT HAS BEEN COURSE-TAGGED SINCE v115. A candidate's own history
   never was. So standing in final MBBS showed twenty-four Part 2 mocks,
   a last score of 78% earned on another exam, and mistake decks full of
   O&G — and that is the mild half.

   THE WEAKNESS PROFILE IS COMPUTED FROM THAT HISTORY. loadHistory() reads
   every mock, decays it by age and aggregates per bucket; select() then
   up-weights the buckets the candidate is weak in. With the history of
   the wrong exam in it, the WRONG EXAM WAS STEERING THE RIGHT ONE — and
   the bucket names of one exam do not even appear in the other's
   blueprint, so the steering was not merely wrong, it was noise.

   §3 IS THE OTHER HALF, and it is why the MBBS mock could not start at
   all. The readiness gate demanded ten unseen EMQs of EVERY course. The
   final MBBS paper has no EMQ section: it is SBA and true/false. So the
   button stayed disabled and the reason given was "not enough unseen
   questions — EMQ unseen: 0", a shortage of something nobody had asked
   for.

   A BLUEPRINT THAT ASKS FOR NOTHING is a third case and needed a third
   sentence. "Not enough unseen questions" sends somebody to import more
   papers; an empty blueprint is not fixed by importing anything. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. HISTORY IS STAMPED AND FILTERED, IN BOTH BACKENDS');

const be = readFileSync('js/backend.js', 'utf8');
const sim = readFileSync('js/simulator.js', 'utf8');

say('a mock and a mistake deck are stamped with the course',
  (be.match(/await stampTrack\(/g) || []).length === 4,
  (be.match(/await stampTrack\(/g) || []).length + ' writes');
say('  and both lists are filtered by it',
  (be.match(/onThisCourse\(/g) || []).length === 5,
  (be.match(/onThisCourse\(/g) || []).length + ' references');
/* A row written before courses existed was written on the only course
   there was. The same reasoning as the v119 and v121 migrations. */
say('  with pre-course history attributed to the course that existed',
  /const LEGACY_TRACK = 'pgim-og-2';/.test(be)
  && /\(r && r\.track \? r\.track : LEGACY_TRACK\) === here/.test(be));
/* Filtering a history nobody can scope would empty it for no reason. */
say('  and nothing filtered when no course is resolved',
  /if \(!here\) return rows;/.test(be));
/* A review link must still open the mock it names. */
say('a mock asked for by id is not hidden',
  /BY ID, UNFILTERED/.test(be));

say('the readiness gate asks only for the sections the blueprint wants',
  /const wantSba = bp\.paper\.sbaCount > 0 && \(bp\.sba \|\| \[\]\)\.length > 0;/.test(sim)
  && /const wantEmq = bp\.paper\.emqCount > 0 && \(bp\.emq \|\| \[\]\)\.length > 0;/.test(sim)
  && /\(!wantEmq \|\| unseenEmq >= 10\)/.test(sim));
/* Without this the gate passes vacuously and select() falls to the
   top-up — arbitrary questions dressed as a blueprint-shaped mock. */
say('  and refuses a blueprint that asks for nothing at all',
  /const asksForAnything = wantSba \|\| wantEmq \|\| wantTf;/.test(sim)
  && /const enough = asksForAnything/.test(sim));

/* ---------------------------------------------------------------- */
sec('2. SO ONE COURSE’S MOCKS STAY ON IT');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
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

const made = await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null, subjects: ['medicine', 'surgery', 'obgyn'],
    positions: ['Medical Student'], sort: 10, isLive: true, isFree: true });
  Course.bust(); await Course.load();
  /* A mock sat on Part 2, and one on MBBS — plus a deck from each. */
  await Course.choose('pgim-og-2');
  await Backend.saveMockResult({ id: 'm-og', date: new Date().toISOString(), percent: 78,
    total: 60, scored: 60, correct: 47, detail: [] });
  await Backend.saveUserDeck({ id: 'deck-ai-og', title: 'O&G mistakes', cardCount: 1,
    content: { topic: 'o', cards: [{ id: '1', question: 'q', answer: 'a' }] } });
  await Course.choose('mbbs-final');
  await Backend.saveMockResult({ id: 'm-mbbs', date: new Date().toISOString(), percent: 55,
    total: 60, scored: 60, correct: 33, detail: [] });
  await Backend.saveUserDeck({ id: 'deck-ai-mbbs', title: 'MBBS mistakes', cardCount: 1,
    content: { topic: 'm', cards: [{ id: '1', question: 'q', answer: 'a' }] } });
  /* AND ONE FROM BEFORE COURSES EXISTED — no track at all. */
  const raw = JSON.parse(localStorage.getItem('aureum.mocks.ayeshmantha@gmail.com') || '[]');
  raw.push({ id: 'm-legacy', date: new Date().toISOString(), percent: 66, total: 60, scored: 60, correct: 40, detail: [] });
  localStorage.setItem('aureum.mocks.ayeshmantha@gmail.com', JSON.stringify(raw));
  return true;
});
say('two mocks and two decks exist, on two courses', made);

const onMbbs = await page.evaluate(async () => ({
  mocks: (await Backend.listMockResults()).map(m => m.id).sort(),
  decks: (await Flashcards.mine()).map(d => d.id).sort()
}));
/* THE BUG, ASKED DIRECTLY. */
say('standing in MBBS shows only the MBBS mock',
  onMbbs.mocks.join() === 'm-mbbs', onMbbs.mocks.join(', ') || 'none');
say('  and only the MBBS mistake deck',
  onMbbs.decks.join() === 'deck-ai-mbbs', onMbbs.decks.join(', ') || 'none');

const onOg = await page.evaluate(async () => {
  await Course.choose('pgim-og-2');
  return { mocks: (await Backend.listMockResults()).map(m => m.id).sort(),
    decks: (await Flashcards.mine()).map(d => d.id).sort() };
});
say('and Part 2 shows its own', onOg.mocks.includes('m-og'), onOg.mocks.join(', '));
/* A row written before courses existed was written on the only course
   there was — so it belongs here, and only here. */
say('  including the one sat before courses existed', onOg.mocks.includes('m-legacy'));
say('  which does NOT follow to the other course', !onMbbs.mocks.includes('m-legacy'));
say('  and its own mistake deck', onOg.decks.join() === 'deck-ai-og', onOg.decks.join(', '));

/* A review link to another course's mock must still open it. */
const byId = await page.evaluate(async () => {
  await Course.choose('mbbs-final');
  return (await Backend.getMockResult('m-og'))?.percent;
});
say('a mock asked for by id still opens, whatever course you are on', byId === 78, String(byId));

/* ---------------------------------------------------------------- */
sec('3. AND A PAPER WITH NO EMQ CAN STILL MAKE A MOCK');

/* The final MBBS paper is SBA + true/false. Before v135 the gate wanted
   ten unseen EMQs of every course, so this mock could never start. */
const gate = await page.evaluate(async () => {
  const bp = await Blueprint.load('mbbs-final');
  bp.paper.sbaCount = 20; bp.paper.tfCount = 10;
  bp.paper.emqCount = 30;                 // the default nobody asked for
  bp.sba = [{ category: 'Obstetrics', subcategory: 'Antenatal care', weight: 100, areas: ['booking'] }];
  bp.emq = [];                            // no EMQ section in this exam
  bp.tf = [{ category: 'Obstetrics', subcategory: 'Antenatal care', weight: 100, areas: ['booking'] }];
  await Blueprint.save(bp, 'mbbs-final');
  return { sba: bp.sba.length, emq: bp.emq.length, tf: bp.tf.length };
});
say('a blueprint with SBA and true/false and no EMQ is stored',
  gate.sba === 1 && gate.emq === 0 && gate.tf === 1, JSON.stringify(gate));

await page.goto(B + '/index.html?r=' + Math.random() + '#/simulator', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2900);
const hero = await page.evaluate(() => ({
  kicker: document.querySelector('.sim-hero-kicker')?.textContent || '',
  line: (document.querySelector('.sim-hero-main .muted')?.textContent || '').replace(/\s+/g, ' ').trim(),
  disabled: !!document.querySelector('#sim-start')?.disabled
}));
/* A kicker reading "0 EMQ themes" states a shortfall that does not exist. */
say('the page does not mention an EMQ section this exam has not got',
  !/EMQ/.test(hero.kicker), hero.kicker.trim());
say('  and does not report a shortage of them', !/EMQ unseen/.test(hero.line), hero.line.slice(0, 90));
say('  naming the two sections it does have',
  /SBA topics/.test(hero.kicker) && /T\/F topics/.test(hero.kicker));

/* ---------------------------------------------------------------- */
sec('4. AND A COURSE WITH NO BLUEPRINT SAYS SO');

const none = await page.evaluate(async () => {
  const bp = await Blueprint.load('mbbs-final');
  bp.sba = []; bp.emq = []; bp.tf = [];
  bp.paper.sbaCount = 30; bp.paper.emqCount = 30; bp.paper.tfCount = 0;
  await Blueprint.save(bp, 'mbbs-final');
  return true;
});
await page.goto(B + '/index.html?r=' + Math.random() + '#/simulator', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);
const empty = await page.evaluate(() => ({
  line: (document.querySelector('.sim-hero-main .muted')?.textContent || '').replace(/\s+/g, ' ').trim(),
  disabled: !!document.querySelector('#sim-start')?.disabled
}));
/* "Not enough unseen questions" sends somebody to import more papers.
   Importing cannot fix an empty blueprint, and saying so is the
   difference between a dead end and an instruction. */
say('an empty blueprint says it is the blueprint that is missing',
  /No blueprint for/.test(empty.line), empty.line.slice(0, 90));
say('  naming the course', /Final MBBS/.test(empty.line));
say('  and does not blame the question bank', !/Not enough unseen/.test(empty.line));
say('  with the button refused', empty.disabled);

/* ---------------------------------------------------------------- */
sec('5. AND THE BLUEPRINT HANDOVER DESCRIBES THE REAL PARSER');

const doc = readFileSync('docs/BLUEPRINT-HANDOVER.md', 'utf8');
const bpjs = readFileSync('js/blueprint.js', 'utf8');
say('it gives the defaults the parser actually uses',
  /defaults to \*\*30\*\*/.test(doc) && /emqCount: num\(paper\.emq_count, 30\)/.test(bpjs)
  && /`tf_count` \| true\/false statements in one mock \| \*\*0\*\*/.test(doc)
  && /tfCount: num\(paper\.tf_count, 0\)/.test(bpjs));
/* The trap: omitting emq_count alone leaves it at 30. */
say('  and warns that omitting a count is not the same as removing a section',
  /Omitting `emq_count` does \*\*not\*\* give you zero/.test(doc));
say('it says a zero-weight bucket is dropped, and it is',
  /`weight: 0` is dropped on load/.test(doc) && /\.filter\(b => b\.weight > 0\)/.test(bpjs));
say('it names the three bucket lists the parser reads',
  ['blueprint_sba', 'blueprint_emq', 'blueprint_tf'].every(k => doc.includes(k) && bpjs.includes(k)));
say('  and that the blueprint is the fallback only for the course it names',
  /fallback only for the\s+course it names/.test(doc.replace(/\s+/g, ' '))
  && /!t \|\| !bundled\.track \|\| bundled\.track === t/.test(bpjs));
say('it tells the MBBS project its paper is SBA + true\/false',
  /SBA \+ true\/false, with no EMQ section/.test(doc));

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v135/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '135', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
