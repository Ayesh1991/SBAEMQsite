/* t132 — every bank, the same two questions.

   FIVE BANKS, FIVE IMPORTERS, AND THEY WERE NEVER DONE AT ONCE. Papers,
   OSCE and essays got the course and subject pickers in v129; flashcard
   decks in v131; cases had neither until now, so a case could only ever
   be filed under whichever course the editor happened to be on. And the
   repair added in v130 — change a published row's course without
   unpublishing it — existed for papers alone, leaving the other four
   fixable only by importing them again.

   The pattern this file closes is not any one of those gaps. It is that
   each was closed on its own, in a different release, and the one left
   out was never the same one twice. So §1 asks the SAME question of all
   five, in a shape that fails for whichever is missing next time.

   §4 IS THE ONE NOBODY WOULD HAVE FOUND. getPublishedPapers and
   getOsceStations ask the server to project fields out of JSON, and fall
   back to reading whole rows if it will not. The fallback said
   `select('id,meta')` — no tracks, no subject. It is a path that only
   runs when something is already wrong, and on that path every filter
   would have silently opened: untagged content is SHOWN, so a candidate
   would have been handed another course's bank and nothing would have
   said so. A fallback may be slower. It may not be looser. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. EVERY IMPORTER ASKS WHICH COURSE, AND WHICH SUBJECT');

const dev = readFileSync('js/dev-console.js', 'utf8');
/* Asked of all five at once, so the next one added fails here rather than
   being discovered by whoever imports into the wrong course. */
const BANKS = [
  ['papers', 'pp'], ['OSCE', 'os'], ['essays', 'es'], ['flashcards', 'fc'], ['cases', 'cs']
];
BANKS.forEach(([name, p]) => {
  say(`the ${name} importer has a course picker`, dev.includes(`#${p}-import-track`));
  say(`  and a subject picker`, dev.includes(`#${p}-import-subject`));
});
/* ONE FUNCTION WRITES BOTH TAGS, and the first draft of this release did
   not — papers spread the two tags inline and OSCE set them a third way,
   which is how an importer ends up being the one nobody updates. The
   count is deliberately an equality: a sixth importer that invents its
   own way of doing this should fail here. */
const stamps = (dev.match(/stampCourse\(/g) || []).length;
say('all five stamp through the one function, and nothing does it twice',
  stamps === 8, stamps + ' references (1 definition + 7 calls)');
/* Exactly one place writes `.tracks`, and it is inside stampCourse. */
say('  with exactly one place that writes the tags',
  (dev.match(/\.tracks = \[tk\]/g) || []).length === 1
  && /function stampCourse\(rec, courseSel, subjectSel\) \{\s*\n\s*const tk = pickedCourse\(courseSel\); if \(tk && !rec\.tracks\) rec\.tracks = \[tk\];/.test(dev));

sec('   AND EVERY PUBLISHED LIST CAN PUT IT RIGHT');
say('the move control knows all five tables',
  ['papers', 'osce_stations', 'essay_papers', 'flashcard_decks', 'case_files']
    .every(t => new RegExp(`data-mv-table="${t}"`).test(dev)));
/* Each bank caches its own listing; a row that just changed course is in
   none of those copies. */
say('  and what each bank must drop to show the change',
  /const MOVABLE = \{/.test(dev) && /flashcard_decks: \{ label: 'deck', after:/.test(dev));
say('  writing through the same fileUnder for all of them',
  /Backend\.fileUnder\(table, \[paper\.id\], \[cSel\.value\], sSel\.value \|\| null\)/.test(dev));

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING CONSOLE, ALL FIVE SAY WHOSE THEY ARE');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
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

/* ONE ROW IN EVERY BANK, ALL FILED TO THE WRONG COURSE — which is what
   v130's bug did to anybody who imported before it was fixed. */
await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null, subjects: ['medicine', 'surgery', 'obgyn'],
    positions: ['Medical Student'], sort: 10, isLive: true, isFree: true });
  Course.bust(); await Course.load();
  await Backend.publishPaper({ id: 'x-p', title: 'Stray paper', categoryId: 'obstetrics',
    sectionId: 'obs-antenatal', topicId: 't-preconception', sba: 1, emq: 0, tf: 0, tracks: ['pgim-og-2'],
    content: { topic: 't', sba: [{ stem: 'a', options: ['x', 'y'], answer: 0 }] } });
  await Backend.publishEssayPaper({ id: 'x-e', paperNumber: 9, paperLabel: 'Stray essay', tracks: ['pgim-og-2'],
    sections: [{ sectionTitle: 'S', questions: [{ code: '1', stem: 'q' }] }] });
  await Backend.publishOsceStation({ id: 'x-o', topic: 'Stray station', scenario: 's', tracks: ['pgim-og-2'],
    questions: [{ prompt: 'p', marks: 5, marking_points: ['a'] }] });
  await Backend.publishFlashcardDeck({ id: 'x-d', title: 'Stray deck', cardCount: 1, tracks: ['pgim-og-2'],
    content: { topic: 'd', cards: [{ id: '1', question: 'q', answer: 'a' }] } });
  await Backend.publishCase({ id: 'x-c', topic: 'Stray case', tracks: ['pgim-og-2'], phases: [], questions: [] });
});
await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));

const look = async (route, sel) => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/' + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2700);
  return page.evaluate(s => {
    document.querySelector(s)?.closest('details')?.setAttribute('open', '');
    const h = document.querySelector(s);
    const row = [...(h?.querySelectorAll('tbody tr') || [])].find(r => /Stray/.test(r.textContent));
    return { head: h?.querySelector('thead')?.textContent.replace(/\s+/g, ' ').trim() || '',
      hasCourseCol: /Course/.test(h?.querySelector('thead')?.textContent || ''),
      says: /O&G Part 2/.test(row?.textContent || ''),
      canMove: !!row?.querySelector('[data-move]') };
  }, sel);
};
for (const [name, route, sel] of [
  ['papers', 'papers', '#dev-published'], ['essays', 'essays', '#es-published'],
  ['OSCE', 'osce', '#os-published'], ['flashcards', 'cards', '#fc-published'],
  ['cases', 'cases', '#cs-published']]) {
  const o = await look(route, sel);
  say(`the ${name} list has a Course column`, o.hasCourseCol, o.head);
  say(`  naming the course the row is under`, o.says);
  say(`  and offers to move it`, o.canMove);
}
/* The last importer to get them. */
say('the cases importer’s course picker is on screen',
  await page.evaluate(() => !document.querySelector('#cs-track-wrap')?.hidden));

/* ---------------------------------------------------------------- */
sec('3. AND A MOVE WORKS ON A BANK THAT IS NOT PAPERS');

/* v130 proved this for papers. The point of v132 is the other four, so
   the one driven here is a deck — a different table, a different cache to
   drop, a different list to redraw. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/cards', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2700);
const moved = await page.evaluate(async () => {
  const tr = [...document.querySelectorAll('#fc-published tbody tr')].find(r => /Stray deck/.test(r.textContent));
  tr.querySelector('[data-move]').click();
  await new Promise(r => setTimeout(r, 600));
  const row = document.querySelector('.dev-move-row');
  row.querySelector('[data-mv-course]').value = 'mbbs-final';
  row.querySelector('[data-mv-course]').dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const subs = [...row.querySelectorAll('[data-mv-subject] option')].length;
  row.querySelector('[data-mv-subject]').value = 'obgyn';
  row.querySelector('[data-mv-go]').click();
  await new Promise(r => setTimeout(r, 1700));
  const d = (await Backend.getFlashcardDecks()).find(x => x.id === 'x-d');
  return { subs, tracks: (d?.tracks || []).join(), subject: d?.subject || '',
    redrawn: /Final MBBS/.test(document.querySelector('#fc-published')?.textContent || '') };
});
say('a deck can be moved to another course', moved.tracks === 'mbbs-final', moved.tracks);
say('  under a subject of it', moved.subject === 'obgyn', moved.subject);
say('  with the subjects of the course it is going to', moved.subs === 4, moved.subs + ' options');
/* A move the table does not show is a move that looks like it failed. */
say('  and the list redraws to say so', moved.redrawn);

/* It has to reach the candidate's bank, not just the row. */
const reached = await page.evaluate(async () => {
  Flashcards.bustDecks?.();
  await Course.choose('mbbs-final');
  const there = (await Flashcards.decks('obgyn')).some(d => d.id === 'x-d');
  await Course.choose('pgim-og-2'); Flashcards.bustDecks?.();
  const gone = !(await Flashcards.decks('')).some(d => d.id === 'x-d');
  return there && gone;
});
say('and it reaches the bank it was moved into, and leaves the old one', reached);

/* ---------------------------------------------------------------- */
sec('4. THE DEGRADED READ IS SLOWER, NOT LOOSER');

const be = readFileSync('js/backend.js', 'utf8');
/* These fallbacks run when the server will not parse a JSON projection.
   tracks and subject are plain columns — they always parse — so dropping
   them here would turn a degraded read into an open one. */
say('the OSCE fallback still asks for the tags',
  /sb\.from\('osce_stations'\)\.select\('id,meta,tracks,subject'\)/.test(be));
say('  and keeps them on the card', /\.\.\.osceCard\(r\.meta\), tracks: r\.tracks \|\| \[\], subject: r\.subject \|\| null/.test(be));
say('the papers fallback does too',
  /sb\.from\('papers'\)\.select\('id,meta,tracks,subject'\)/.test(be));
say('  with the reason written down', /A fallback is\s*\n\s*allowed to be slower; it is not allowed to show a candidate\s*\n\s*another course's bank/.test(be));
/* No read of a tagged table may project the tags away. */
say('and no bank read drops them any more',
  !/select\('id,meta'\)[\s\S]{0,40}(papers|osce_stations|flashcard_decks|essay_papers|case_files)/.test(be)
  && (be.match(/id,meta,tracks,subject/g) || []).length === 5,
  (be.match(/id,meta,tracks,subject/g) || []).length + ' reads carry them');

/* ---------------------------------------------------------------- */
sec('5. AND CASES NARROW BY SUBJECT LIKE EVERY OTHER BANK');

const cs = readFileSync('js/cases.js', 'utf8');
say('the case bank filters by subject', /Course\.fitsSubject\(c, caseSubject\)/.test(cs));
say('  and draws the chips', /Course\.subjectBar\(caseSubject\)/.test(cs));
/* The cached list is the COURSE's cases; the subject narrows them, so
   caching per subject would be five copies of one read. */
say('  narrowing the cached list rather than caching one copy per subject',
  /if \(_cases\) return bySubject\(_cases\);/.test(cs));

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v132/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '132', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
