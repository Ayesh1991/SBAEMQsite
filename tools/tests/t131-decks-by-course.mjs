/* t131 — flashcard decks belong to a course too.

   THE FOURTH BANK, AND THE ONE THAT WAS NEVER JOINED UP. v116 filtered
   the OSCE bank by course, v121 did papers, essays and cases, and v129
   added the subject below that. Flashcard decks were in none of it: every
   published deck reached every candidate, whichever exam they were
   sitting.

   AND THE READ IS WHY, which is the third time this exact line has been
   the bug. publishFlashcardDeck has stamped `tracks` and `subject` since
   v117. getFlashcardDecks asked for `id,meta` — neither tag — and then
   mapped straight to `r.meta`, so the columns could not have survived
   even if they had been selected. Every deck arrived at the client
   looking unfiled, and a filter cannot filter on what the read never
   returned.

   §4 IS THE ONE THAT IS NOT ABOUT COURSES. A deck carries spaced
   repetition fields — due, interval, easeFactor, reps — in the file it is
   generated from, and they must NOT be imported. That schedule belongs to
   one candidate; shipping it in a shared deck would hand everybody the
   same due date and overwrite nothing, because the app keeps its own per
   person. buildDeckMeta drops them by naming the four fields it keeps,
   and this is the test that it still does.

   A PERSONAL DECK IS NEVER FILTERED (§3). Cards made from your own wrong
   answers are yours; hiding them because nobody tagged them with a course
   would be taking your own notes away from you. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE READ BRINGS THE TAGS BACK');

const be = readFileSync('js/backend.js', 'utf8');
const fc = readFileSync('js/flashcards.js', 'utf8');
const dev = readFileSync('js/dev-console.js', 'utf8');

say('the deck read asks for the course and the subject',
  /sb\.from\('flashcard_decks'\)\.select\('id,meta,tracks,subject'\)/.test(be));
/* Selecting them is half of it: mapping to r.meta would throw them away
   again, which is exactly what the old line did. */
say('  and keeps them on the deck it hands back',
  /\.map\(r => \(\{ \.\.\.r\.meta, tracks: r\.tracks \|\| \[\], subject: r\.subject \|\| null \}\)\)/.test(be));
say('  with the reason written down beside it',
  /The write\s*\n\s*has stamped tracks and subject since v117 and this read asked for\s*\n\s*neither/.test(be));

say('the deck list filters by course and by subject',
  /Course\.fits\(d\) && Course\.fitsSubject\(d, subject \|\| ''\)/.test(fc));
say('  and offers the subject chips', /Course\.subjectBar\(deckSubject\)/.test(fc));
/* An empty list has two causes and they need different sentences. */
say('  saying which kind of empty it is when a chip hides everything',
  /No decks under \$\{esc\(Course\.subjectName\(deckSubject\)\)\} yet/.test(fc));

say('the flashcard importer asks which course and subject',
  /fc-import-track/.test(dev) && /fc-import-subject/.test(dev)
  && /stampCourse\(meta, '#fc-import-track', '#fc-import-subject'\)/.test(dev));

/* ---------------------------------------------------------------- */
sec('2. AND A REAL DECK IMPORTS INTO THE COURSE YOU CHOOSE');

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

await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS-Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null,
    subjects: ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry', 'anaesthesiology'],
    positions: ['Medical Student'], sort: 10, isLive: true, isFree: true });
  Course.bust(); await Course.load();
});
await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/cards', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);
say('the course picker is on the flashcard importer',
  await page.evaluate(() => !document.querySelector('#fc-track-wrap')?.hidden));
await page.selectOption('#fc-import-track', 'mbbs-final'); await page.waitForTimeout(700);
say('  and choosing a multi-subject course reveals the subjects',
  await page.evaluate(() => !document.querySelector('#fc-subject-wrap')?.hidden));
await page.selectOption('#fc-import-subject', 'obgyn'); await page.waitForTimeout(300);

/* A DECK IN THE SHAPE THE GENERATOR PRODUCES — spaced-repetition fields
   and all, because those are what must not come through. */
const file = {
  topic: 'Female-Pelvic-Anatomy-and-Development (TTGyn-Ch1 2024)',
  cards: [
    { id: '1', question: 'What determines whether the bipotential fetal gonad becomes a testis or an ovary?',
      answer: 'The **SRY gene** on the Y chromosome drives it.', keyPoint: '',
      due: '2026-10-10', interval: 0, easeFactor: 2.5, reps: 0 },
    { id: '3', question: '⭐ What is the embryological origin of the vagina?',
      answer: 'Upper from the **fused Müllerian ducts**, lower from the sinovaginal bulbs.',
      keyPoint: '⭐ Upper vagina = Müllerian; lower vagina = urogenital sinus.',
      due: '2026-10-10', interval: 0, easeFactor: 2.5, reps: 0 }
  ]
};
const saved = await page.evaluate(async d => {
  const ta = document.getElementById('fc-paste'); ta.value = JSON.stringify(d);
  document.getElementById('fc-paste-btn').click();
  await new Promise(r => setTimeout(r, 900));
  const verdict = document.getElementById('fc-paste-result').textContent.trim();
  document.querySelector('#fc-list [data-role="deck-approve"][data-i="0"]')?.click();
  await new Promise(r => setTimeout(r, 1600));
  const deck = (await Backend.getFlashcardDecks()).find(x => /Female-Pelvic/.test(x.title));
  return { verdict, title: deck?.title, n: deck?.cardCount,
    tracks: (deck?.tracks || []).join(), subject: deck?.subject || '',
    keys: Object.keys(deck?.content?.cards?.[0] || {}).sort().join(','),
    keyPoint: deck?.content?.cards?.[1]?.keyPoint || '',
    md: deck?.content?.cards?.[0]?.answer || '' };
}, file);
/* THE USER'S FILE SHAPE, UNCHANGED, is accepted as it stands. */
say('the generator’s file validates with no edits', /Valid/.test(saved.verdict), saved.verdict);
say('  and publishes every card', saved.n === 2, saved.n + ' cards');
say('filed under the course that was chosen', saved.tracks === 'mbbs-final', saved.tracks);
say('  and the subject', saved.subject === 'obgyn', saved.subject);
say('  keeping the key point', /Upper vagina = M/.test(saved.keyPoint), saved.keyPoint);
/* The answers are markdown and stay that way. */
say('  and the markdown in the answer', /\*\*SRY gene\*\*/.test(saved.md));

/* ---------------------------------------------------------------- */
sec('3. THE SCHEDULE IN THE FILE IS NOT IMPORTED');

/* A due date belongs to one candidate. Shipping one in a shared deck
   would hand everybody the same schedule, and the app keeps its own per
   person in flashcard_progress. buildDeckMeta drops them by naming the
   four fields it keeps — this is the test that it still does. */
say('a card carries only what a deck should carry',
  saved.keys === 'answer,id,keyPoint,question', saved.keys);
say('  with no due date, interval, ease or rep count from the file',
  !/due|interval|ease|reps/.test(saved.keys));

/* ---------------------------------------------------------------- */
sec('4. AND THE DECK REACHES ONE COURSE, NOT EVERY COURSE');

const seen = await page.evaluate(async () => {
  Flashcards.bustDecks?.();
  await Course.choose('mbbs-final');
  const onMbbs = (await Flashcards.decks('')).some(d => /Female-Pelvic/.test(d.title));
  const onObgyn = (await Flashcards.decks('obgyn')).some(d => /Female-Pelvic/.test(d.title));
  const onMed = (await Flashcards.decks('medicine')).some(d => /Female-Pelvic/.test(d.title));
  await Course.choose('pgim-og-2');
  Flashcards.bustDecks?.();
  const onOg = (await Flashcards.decks('')).some(d => /Female-Pelvic/.test(d.title));
  return { onMbbs, onObgyn, onMed, onOg };
});
say('it is in the bank of the course it was filed under', seen.onMbbs);
say('  and under that course’s own subject', seen.onObgyn);
/* The point of the subject chip. */
say('  but not under another subject of the same course', !seen.onMed);
/* THE POINT OF THE RELEASE: before v131 this was true of every deck. */
say('and a candidate on another course does not see it at all', !seen.onOg);

/* A deck nobody tagged is still shown — unfiled is not irrelevant. */
const unfiled = await page.evaluate(async () => {
  await Backend.publishFlashcardDeck({ id: 'deck-t131-unfiled', title: 'An unfiled deck',
    cardCount: 1, tracks: [], subject: null, content: { topic: 'u', cards: [{ id: '1', question: 'q', answer: 'a' }] } });
  Flashcards.bustDecks?.();
  const d = (await Backend.getFlashcardDecks()).find(x => x.id === 'deck-t131-unfiled');
  /* contentTags() stamps the editor's own course AND, for a one-speciality
     course, its subject — so a row published here is never really
     unfiled. Both tags are cleared, because the thing under test is the
     FILTER's behaviour on content nobody tagged. */
  d.tracks = []; d.subject = null;
  return Course.fits(d) && Course.fitsSubject(d, 'medicine');
});
say('a deck with no course is shown under every course and subject', unfiled);

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v131/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '131', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
