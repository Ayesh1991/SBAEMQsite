/* t129 — Phase 8: a course with subjects, all the way through.

   A FINAL MBBS BANK IS FIVE BANKS. Obstetrics, medicine, surgery,
   paediatrics and psychiatry all belong to one course, and a candidate
   revising O&G has no use for the other four in the same list. v115 put a
   `subjects` list on a course and v116 gave the OSCE bank a subject bar.
   Then it stopped.

   SO THE MIDDLE OF THE PIPELINE WAS MISSING, in the way that is hardest to
   see: every piece existed and nothing joined them. `subject` was a column
   on seven tables. `Course.fitsSubject` was written and exported.
   `Course.subjectBar` drew the chips. And NOTHING WROTE THE COLUMN for a
   course with more than one subject — contentTags() infers it only when a
   course has exactly one speciality, which is precisely the case where it
   does not matter. A final MBBS paper reached the database with
   subject = null, which fitsSubject reads as unfiled and therefore shows
   under every subject.

   That is the same failure as v117's: a filter cannot filter on what
   nothing ever wrote. §1 is the test that somebody is now asked.

   AND UNFILED IS STILL SHOWN. §3. Hiding a paper whose subject somebody
   forgot would lose it from its own author's bank with nothing to say why
   — the same rule as Course.fits, for the same reason. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. SOMEBODY IS ASKED WHICH SUBJECT, AND THE ANSWER IS WRITTEN DOWN');

const dev = readFileSync('js/dev-console.js', 'utf8');
const app = readFileSync('js/app.js', 'utf8');
const es = readFileSync('js/essay.js', 'utf8');

say('the console asks which subject, for a course that has more than one',
  /async function fillSubjectPicker\(view, wrapSel, selSel, courseSel\)/.test(dev));
/* One chip is not a choice: a Part 2 course answers this by itself. */
say('  and does not ask when the course answers it itself',
  /if \(subs\.length < 2\) \{ wrap\.hidden = true/.test(dev));
/* The subjects belong to the course, so changing one must redraw the other
   or you file an MBBS paper under a Part 2 subject. */
say('  redrawing the subjects when the course changes',
  /view\.querySelector\(courseSel\)\?\.addEventListener\('change', draw\)/.test(dev));

/* THE WRITE. This is the line whose absence made every other piece
   useless. */
say('a paper is published carrying the subject that was chosen',
  /pickedSubject\('#pp-import-subject'\) \? \{ subject: pickedSubject\('#pp-import-subject'\) \} : \{\}/.test(dev));
say('  an OSCE station too', /pickedSubject\('#os-import-subject'\); if \(sj\) d\.subject = sj;/.test(dev));
/* The essay importer had NEITHER picker — not even the course one — so an
   essay paper could reach the database filed nowhere at all. */
say('  and an essay paper, which had no course picker either',
  /es-import-track/.test(dev) && /es-import-subject/.test(dev)
  && (dev.match(/stampCourse\(d, '#es-import-track', '#es-import-subject'\)/g) || []).length === 2);
/* Four importers each doing it by hand is four chances to forget. */
say('  through one function, not four copies of the same two lines',
  /function stampCourse\(rec, courseSel, subjectSel\)/.test(dev));

say('the question bank offers the subject chips',
  /Course\.subjectBar\(librarySubject\)/.test(app) && /Course\.fitsSubject\(p, librarySubject\)/.test(app));
say('  and the essay bank', /Course\.subjectBar\(listSubject\)/.test(es) && /Course\.fitsSubject\(p, listSubject\)/.test(es));
/* The counts in the header and the chips are counts of what is on screen.
   Filtering the DOM would leave every one of them describing a list that
   is no longer there. */
say('  redrawing rather than hiding, so the counts stay true',
  /renderLibrary\(user\);/.test(app.slice(app.indexOf('tk-subs'))) && /renderList\(view, user, kind\);/.test(es));

/* ---------------------------------------------------------------- */
sec('2. AND IN THE RUNNING APP, A COURSE SPLITS INTO ITS SUBJECTS');

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

/* The sample file, used as the content — so this test also proves the
   shipped sample is importable, not just that it parses. */
const sample = JSON.parse(readFileSync('data/samples/mbbs-obgyn-paper.json', 'utf8'));
const made = await page.evaluate(async content => {
  const bad = Data.validatePaper(content);
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS — Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null, subjects: ['obgyn', 'medicine', 'surgery'],
    positions: ['Final year student'], sort: 5, isLive: true, isFree: true });
  Course.bust(); await Course.load(); await Course.choose('mbbs-final');
  const mk = (id, title, subject) => ({ id, title, categoryId: 'obstetrics', sectionId: 'obs-antenatal',
    topicId: 't-preconception', sba: 2, emq: 2, tf: 3, tracks: ['mbbs-final'], subject, content });
  await Backend.publishPaper(mk('t129-og', 'MBBS O&G Paper 1', 'obgyn'));
  await Backend.publishPaper(mk('t129-med', 'MBBS Medicine Paper 1', 'medicine'));
  /* The one whose subject somebody forgot. */
  await Backend.publishPaper(mk('t129-unfiled', 'MBBS Unfiled Paper', null));
  Data.bustPapers?.();
  return { bad, subjects: Course.subjects(), name: Course.subjectName('obgyn') };
}, sample);
/* THE SHIPPED SAMPLE IS THE FORMAT, so it has to pass the real validator.
   A sample file that does not import is worse than none. */
say('the sample file in data/samples is importable as it ships',
  made.bad.length === 0, made.bad.join(' ') || 'no errors');
say('a course can hold several subjects', made.subjects.join() === 'obgyn,medicine,surgery', made.subjects.join(', '));
say('  each with a name a candidate would recognise',
  made.name === 'Obstetrics & Gynaecology', made.name);

const hits = async () => {
  await page.fill('#lib-search', 'MBBS');
  await page.waitForTimeout(500);
  return page.evaluate(() => [...document.querySelectorAll('#lib-results h4')].map(h => h.textContent.trim()));
};
await page.goto(B + '/index.html?r=' + Math.random() + '#/library', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
const chips = await page.evaluate(() => [...document.querySelectorAll('.tk-sub')].map(b => b.textContent.trim()));
say('the question bank draws a chip per subject',
  chips.join(' | ') === 'All subjects | Obstetrics & Gynaecology | Medicine | Surgery', chips.join(' | '));
const all = await hits();
say('  showing every subject to begin with', all.length === 3, all.join(', '));

await page.evaluate(() => [...document.querySelectorAll('.tk-sub')].find(b => /Obstetrics/.test(b.textContent))?.click());
await page.waitForTimeout(2200);
const og = await hits();
say('choosing Obstetrics & Gynaecology drops the other subject’s papers',
  og.includes('MBBS O&G Paper 1') && !og.includes('MBBS Medicine Paper 1'), og.join(', '));
say('  and the chip says which one you are on',
  /Obstetrics/.test(await page.evaluate(() => document.querySelector('.tk-sub.is-on')?.textContent || '')));

/* ---------------------------------------------------------------- */
sec('3. BUT A PAPER NOBODY FILED IS STILL SHOWN');

/* THE SAME RULE AS Course.fits, FOR THE SAME REASON. Hiding a paper whose
   subject somebody forgot would lose it from its own author's bank with
   nothing to say why. Unfiled is not irrelevant. */
say('a paper with no subject appears under every subject',
  og.includes('MBBS Unfiled Paper'), og.join(', '));

await page.evaluate(() => [...document.querySelectorAll('.tk-sub')].find(b => /Medicine/.test(b.textContent))?.click());
await page.waitForTimeout(2200);
const med = await hits();
say('  including under a subject it is plainly not about',
  med.includes('MBBS Medicine Paper 1') && med.includes('MBBS Unfiled Paper')
  && !med.includes('MBBS O&G Paper 1'), med.join(', '));

/* ---------------------------------------------------------------- */
sec('4. AND A COURSE WITH ONE SUBJECT IS NOT ASKED');

/* One chip is furniture. A Part 2 O&G candidate has no choice to make and
   should not be shown one. */
const single = await page.evaluate(async () => {
  await Course.choose('pgim-og-2');
  return { subs: Course.subjects().length, bar: Course.subjectBar('') };
});
await page.goto(B + '/index.html?r=' + Math.random() + '#/library', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const none = await page.evaluate(() => [...document.querySelectorAll('.tk-sub')].length);
say('a one-subject course draws no chips at all', single.bar === '' && none === 0,
  single.subs + ' subject(s), ' + none + ' chips');
/* And its bank is unchanged — no filter, nothing hidden. */
const back = await page.evaluate(async () => (await Data.myPapers()).length);
say('  and its bank is whole', back > 0, back + ' papers');

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  /* The literal belongs to the newest release file only — see the README. */
  return { vs, sw: vs.length === 1 && sw.includes("'aureum-v" + vs[0] + "'") };
});
say('one version across every asset', stamp.vs.length === 1, stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
