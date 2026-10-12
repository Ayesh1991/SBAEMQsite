/* t134 — flashcards are revision, not a part of the exam.

   THEORY IS THE EXAM: the question bank, the mocks, the essays, the
   mistakes a paper produces. Spaced repetition is done on a different day
   for a different reason, and sitting it in Theory's sub-nav — between
   Essay and My mistakes — said it was one more component of a paper.
   It is a tab of its own now.

   AND THE DECKS BUILT FROM A CANDIDATE'S OWN MISTAKES DO NOT GO WITH IT.
   They were merged in at the top of the deck library, which put "Mock 7 —
   what you got wrong" beside the published revision decks and made the
   library a mixture of somebody's study material and their errors. They
   belong to the paper that produced them, so they stay on My mistakes,
   under Theory, with the rest of that work.

   §3 IS THE HALF THAT WOULD HAVE BROKEN QUIETLY. A deck is SAT the same
   way wherever it was opened from, and renderDeck looked the deck up in
   the library list. Removing the personal decks from that list without
   touching renderDeck would have made every mistake deck answer "that
   deck is no longer published" — from a link on a page that had just
   counted it. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. A TAB OF ITS OWN');

const app = readFileSync('js/app.js', 'utf8');
const fc = readFileSync('js/flashcards.js', 'utf8');

say('flashcards is in the main nav', /">Flashcards<\/a>` : ''\}/.test(app));
/* The address must no longer light Theory, or two tabs claim the page. */
say('  and #/cards no longer lights Theory',
  !/startsWith\('#\/library'\)[\s\S]{0,160}startsWith\('#\/cards'\)/.test(app));
say('  it has left the Theory sub-nav', !/tab\('cards', '#\/cards', 'Flashcards'\)/.test(app));
/* Wearing Theory's tabs would say it is still one of them. */
say('  and the page does not wear that sub-nav either',
  /await Flashcards\.renderList\(view, user\); \}/.test(app)
  && !/renderList\(view, user\); injectLibNav\('cards'/.test(app));
say('My mistakes stays under Theory', /tab\('mistakes', '#\/mistakes', 'My mistakes'\)/.test(app));

say('the deck library returns only the published decks',
  /return published;\s*\n\s*\}/.test(fc));
say('  with the mistake decks asked for separately', /async function mine\(\)/.test(fc));
/* One definition of "a deck built from my mistakes", in one module. */
say('  and one definition of which those are',
  (fc.match(/\^deck-ai-/g) || []).length === 1
  && /decks = await Flashcards\.mine\(\)/.test(app)
  && !/listUserDecks\(\)\) \|\| \[\]\)\.filter\(d => \/\^deck-ai-/.test(app));

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING APP');

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

/* One of each: a deck somebody published, and a deck this candidate's own
   wrong answers produced. */
await page.evaluate(async () => {
  await Backend.publishFlashcardDeck({ id: 'deck-pub', title: 'Published revision deck', cardCount: 1,
    content: { topic: 'p', cards: [{ id: '1', question: 'q', answer: 'a' }] } });
  await Backend.saveUserDeck({ id: 'deck-ai-mock7', title: 'Mock 7 — what you got wrong', cardCount: 1,
    content: { topic: 'm', cards: [{ id: '1', question: 'mq', answer: 'ma' }] } });
  Flashcards.bustDecks?.();
});

await page.goto(B + '/index.html?r=' + Math.random() + '#/cards', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
const nav = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('#nav-links a')].map(a => a.textContent.replace(/\d+$/, '').trim()).filter(Boolean),
  active: [...document.querySelectorAll('#nav-links a.active')].map(a => a.textContent.replace(/\d+$/, '').trim()),
  subnav: !!document.querySelector('.lib-subnav')
}));
say('Flashcards is a tab beside Theory', nav.tabs.includes('Flashcards'), nav.tabs.join(' · '));
/* Exactly one tab may claim the page. */
say('  and it is the only one lit on its own page',
  nav.active.join() === 'Flashcards', nav.active.join(', ') || 'none');
say('  with no Theory sub-nav on it', !nav.subnav);

const lib = await page.evaluate(() => ({
  names: [...document.querySelectorAll('.fc-deck-name, .fc-deck h3, [data-deck]')].map(x => x.textContent.trim()),
  summary: (document.querySelector('.fc-summary')?.textContent || '').replace(/\s+/g, ' ').trim()
}));
say('the library lists the published deck', lib.names.some(n => /Published revision/.test(n)), lib.names.join(', '));
/* THE POINT OF THE SPLIT. */
say('  and not the one built from a mock', !lib.names.some(n => /Mock 7/.test(n)), lib.names.join(', '));
/* The counts are counts of what is shown, so they move with it. */
say('  and says one deck, not two', /\b1\s*Decks/.test(lib.summary), lib.summary);

await page.goto(B + '/index.html?r=' + Math.random() + '#/mistakes', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
const mk = await page.evaluate(() => ({
  subnav: !!document.querySelector('.lib-subnav'),
  body: (document.querySelector('#mk-body')?.textContent || '').replace(/\s+/g, ' ')
}));
say('My mistakes still wears the Theory sub-nav', mk.subnav);
say('  and still counts the mistake deck', /1\s*AI mistake decks/.test(mk.body),
  (mk.body.match(/\d+\s*AI mistake decks/) || ['?'])[0]);

/* ---------------------------------------------------------------- */
sec('3. AND A MISTAKE DECK STILL OPENS');

/* The link on My mistakes goes to the same address a library deck does.
   Taking the personal decks out of the list renderDeck searches would
   have made every one of them "no longer published" — from a page that
   had just counted it. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/cards/deck-ai-mock7', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2300);
const open = await page.evaluate(() => (document.querySelector('.page')?.textContent || '').replace(/\s+/g, ' ').trim());
say('opening a mistake deck by its address works',
  /Mock 7/.test(open) && !/no longer published/.test(open), open.slice(0, 70));
/* And the published one is unaffected. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/cards/deck-pub', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const open2 = await page.evaluate(() => (document.querySelector('.page')?.textContent || '').replace(/\s+/g, ' ').trim());
say('  as does a published one', /Published revision/.test(open2) && !/no longer published/.test(open2),
  open2.slice(0, 70));

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
