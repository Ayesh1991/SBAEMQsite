/* t130 — a course is filled before it is opened.

   THE COURSE ADMIN PAGE MAKES A PROMISE IN AS MANY WORDS: "A course can be
   built and filled long before it is opened — until Open is ticked nobody
   can choose it and nothing tagged to it reaches anybody."

   The importer's course picker offered `Course.live()`: the courses a
   CANDIDATE may choose. So the course you were filling was the one course
   you could not select. And because one live course is not a choice, the
   picker then hid itself entirely — leaving contentTags() to stamp the
   EDITOR'S OWN course on the import. The questions went somewhere real
   and plausible and wrong, with nothing thrown and nothing to see
   afterwards, because the published-papers table never showed a paper's
   course either.

   Three things in one failure, and the shape is worth remembering: the
   wrong LIST, a control that hides itself when the list comes back short,
   and a fallback that always succeeds. Each is defensible alone.

   §1 is the picker. §3 is the repair — a paper's course is now visible in
   the table and changeable in place, because content that was mis-filed
   by a bug has to be fixable by the person who hit it. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE CONSOLE OFFERS EVERY COURSE, NOT THE OPEN ONES');

const dev = readFileSync('js/dev-console.js', 'utf8');
say('the importer’s picker lists every course that exists',
  /const all = Course\.all\(\);\s*\n\s*if \(all\.length < 2\) return;/.test(dev));
/* Filing into a course nobody can reach yet is the normal way to build
   one. It should never be a surprise. */
say('  saying which are not open yet', /being built/.test(dev));
say('the "filed nowhere" panel offers them too',
  /try \{ await Course\.load\(\); live = Course\.all\(\); \}/.test(dev));
/* The reasoning, kept where the next person will meet it — the line that
   caused this looked obviously right. */
say('  and the reason is written down beside both',
  /EVERY COURSE, NOT THE OPEN ONES/.test(dev)
  && /FILLING IS EXACTLY WHAT THIS PICKER IS FOR/.test(dev));

say('a published paper’s course is visible in the table',
  /<th>Paper<\/th><th>Course<\/th>/.test(dev));
say('  and can be changed without re-importing it', /function moveRow\(view, host, btn, paper, courses\)/.test(dev));
/* One way to set these tags, not two. The table became an argument in
   v132, when the other four banks got this control — so the call is
   asserted by its SHAPE rather than by the literal 'papers' it used to
   carry. */
say('  through the same call the unfiled panel uses',
  /Backend\.fileUnder\(table, \[paper\.id\], \[cSel\.value\], sSel\.value \|\| null\)/.test(dev));

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING CONSOLE, WITH A COURSE THAT IS NOT OPEN');

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

/* THE EXACT SITUATION: a second course, built, subjects ticked, NOT open. */
const setUp = await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS-Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null,
    subjects: ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry', 'anaesthesiology'],
    positions: ['Medical Student'], sort: 10, isLive: false, isFree: false });
  Course.bust(); await Course.load();
  return { live: Course.live().length, all: Course.all().length };
});
/* The premise of the whole test: one live course, two in total. This is
   the state in which the old picker vanished. */
say('one course is open and a second is being built',
  setUp.live === 1 && setUp.all === 2, setUp.live + ' open of ' + setUp.all);

await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));
await page.goto(B + '/index.html#/dev/papers', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2700);
const picker = await page.evaluate(() => ({
  shown: !document.querySelector('#pp-track-wrap')?.hidden,
  opts: [...document.querySelectorAll('#pp-import-track option')].map(o => o.textContent.trim()),
  subShown: !document.querySelector('#pp-subject-wrap')?.hidden
}));
/* THE BUG, ASKED DIRECTLY. Before v130 this was hidden and empty. */
say('the course picker is on screen', picker.shown, picker.shown ? 'shown' : 'HIDDEN');
say('  offering the course that is still being built',
  picker.opts.some(o => /Final MBBS/.test(o)), picker.opts.join(' | '));
say('  and saying so on the option itself',
  picker.opts.some(o => /Final MBBS.*being built/.test(o)));
/* The subject picker belongs to the course, so with the one-speciality
   course selected there is nothing to ask. */
say('  with no subject asked while the one-speciality course is chosen', !picker.subShown);

await page.selectOption('#pp-import-track', 'mbbs-final');
await page.waitForTimeout(800);
const subs = await page.evaluate(() => ({
  shown: !document.querySelector('#pp-subject-wrap')?.hidden,
  opts: [...document.querySelectorAll('#pp-import-subject option')].map(o => o.textContent.trim())
}));
say('choosing it reveals its six subjects', subs.shown && subs.opts.length === 7, subs.opts.join(' | '));
say('  including the one these papers are for',
  subs.opts.some(o => /Obstetrics & Gynaecology/.test(o)));

/* ---------------------------------------------------------------- */
sec('3. AND A PAPER PUT IN THE WRONG COURSE CAN BE MOVED');

/* The damage this bug did: content stamped with the editor's own course.
   A paper filed under the wrong course looks exactly like one filed
   correctly, so the repair starts with being able to SEE it. */
const mis = await page.evaluate(async () => {
  await Backend.publishPaper({ id: 't130-strays', title: 'MBBS O&G questions filed wrongly',
    categoryId: 'obstetrics', sectionId: 'obs-antenatal', topicId: 't-preconception',
    sba: 2, emq: 0, tf: 0, tracks: ['pgim-og-2'], subject: 'obgyn',
    content: { topic: 'Strays', sba: [
      { stem: 'a', options: ['x', 'y'], answer: 0 }, { stem: 'b', options: ['x', 'y'], answer: 1 }] } });
  Data.bustPapers?.();
  return (await Data.publishedPapers()).find(p => p.id === 't130-strays')?.tracks;
}, {});
say('a paper lands under the course it was stamped with', (mis || []).join() === 'pgim-og-2', (mis || []).join(', '));

/* A fresh LOAD, not a hash change: going to the address the page is
   already on does not re-render it, and the table was drawn before this
   paper existed. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/papers', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/papers', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2900);
const seen = await page.evaluate(() => {
  document.querySelector('#dev-published')?.closest('details')?.setAttribute('open', '');
  const tr = [...document.querySelectorAll('#dev-published tr')].find(r => /filed wrongly/.test(r.textContent));
  return { row: !!tr, text: tr ? tr.textContent.replace(/\s+/g, ' ').trim() : '', move: !!tr?.querySelector('[data-move]') };
});
say('the table says which course it is under', seen.row && /O&G Part 2/.test(seen.text), seen.text.slice(0, 90));
say('  and offers to move it', seen.move);

const moved = await page.evaluate(async () => {
  const tr = [...document.querySelectorAll('#dev-published tr')].find(r => /filed wrongly/.test(r.textContent));
  tr.querySelector('[data-move]').click();
  await new Promise(r => setTimeout(r, 600));
  const row = document.querySelector('.dev-move-row');
  const out = { opened: !!row, subShown: !row?.querySelector('[data-mv-subwrap]')?.hidden };
  row.querySelector('[data-mv-course]').value = 'mbbs-final';
  row.querySelector('[data-mv-course]').dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  out.subsAfter = [...row.querySelectorAll('[data-mv-subject] option')].length;
  row.querySelector('[data-mv-subject]').value = 'obgyn';
  row.querySelector('[data-mv-go]').click();
  await new Promise(r => setTimeout(r, 1600));
  Data.bustPapers?.();
  const p = (await Data.publishedPapers()).find(x => x.id === 't130-strays');
  out.tracks = (p?.tracks || []).join(); out.subject = p?.subject || '';
  return out;
});
say('the move opens in the row, not in a modal', moved.opened);
/* The subject list belongs to the course, so it only appears once a
   course with several subjects is chosen. */
say('  asking for a subject once a multi-subject course is picked', moved.subsAfter === 7, moved.subsAfter + ' options');
say('the paper is now under the right course', moved.tracks === 'mbbs-final', moved.tracks);
say('  and the right subject', moved.subject === 'obgyn', moved.subject);

/* A move that does not reach the candidate's bank is a move that looks
   like it failed. */
const banks = await page.evaluate(async () => {
  await Course.load();
  const onOg = (await Data.myPapers()).some(p => p.id === 't130-strays');
  await Backend.saveTrack({ id: 'mbbs-final', isLive: true, name: 'Final MBBS-Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null,
    subjects: ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry', 'anaesthesiology'],
    positions: ['Medical Student'], sort: 10, isFree: true });
  Course.bust(); await Course.load(); await Course.choose('mbbs-final');
  const onMbbs = (await Data.myPapers()).some(p => p.id === 't130-strays');
  return { onOg, onMbbs };
});
say('it has left the course it was wrongly in', !banks.onOg);
say('  and reached the one it belongs to', banks.onMbbs);

/* ---------------------------------------------------------------- */
sec('4. STAMPS');
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
