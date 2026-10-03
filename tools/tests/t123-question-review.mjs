/* t123 — Phase 2: nothing reaches a candidate unread.

   A set of questions is now invisible until an editor has been through it
   and submitted. That is the point of having editors, and it is the work
   they will be paid for — so it is counted, per person, per question.

   THE MIGRATION IS THE DANGEROUS PART of this release and §1 is most of
   the test. Two hundred stations and every paper are already in front of
   people. If the new column had landed as 'draft' the bank would have gone
   dark for everybody until somebody clicked through all of it — a feature
   that empties the site is not a feature. So the column is ADDED with a
   default of 'published', which is what every existing row then holds, and
   only afterwards is the default changed to 'draft' for what comes next.
   Both statements re-run harmlessly, so a second run never pushes a real
   draft back out to candidates.

   THE SAME TRICK HAD TO BE LEARNED TWICE. The local backend stores whole
   records rather than columns, and its first version read a MISSING status
   as 'draft' — which would have emptied the bank of everyone using local
   mode, the exact failure the schema had been written to avoid. t116
   caught it within a minute of the gate going in. A row with no status at
   all predates the gate and is published; only an explicit 'draft' is a
   draft.

   AND PUBLISHING IS NOT AN ACT OF AUTHORSHIP. Nothing writes the status on
   publish: the column default marks a new row, and an upsert that does not
   name the column leaves it alone. So fixing a typo in a reviewed paper
   does not send it back to the queue — §4 — and no author can mark their
   own work published by sending a field. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE MIGRATION CANNOT EMPTY THE BANK');

const sql = readFileSync('supabase/schema.sql', 'utf8');
/* The order of these two lines is the whole safety property. */
const addAt = sql.indexOf("add column if not exists review_status text not null default 'published'");
const defAt = sql.indexOf("alter column review_status set default 'draft'");
say('the column arrives as published, so nothing already in the bank moves', addAt > 0);
say('  and only then does the default become draft', defAt > addAt, 'add@' + addAt + ' default@' + defAt);
say('  both tables get it',
  (sql.match(/add column if not exists review_status text not null default 'published'/g) || []).length === 2
  && (sql.match(/alter column review_status set default 'draft'/g) || []).length === 2);
/* `add column if not exists` does nothing on a re-run, so a genuine draft
   is never pushed out to candidates by running the file again. */
say('  and re-running the file cannot publish a real draft',
  !/update public\.(papers|osce_stations) set review_status/.test(sql));

/* THE GATE, and the exemption that makes review possible at all. */
say('candidates read published sets only',
  (sql.match(/review_status = 'published' or public\.is_editor\(\)/g) || []).length === 2);
say('  editors read everything, or they could not review it',
  /or public\.is_editor\(\)\)/.test(sql));
/* A check that lives only in the browser is not a check. */
say('the status cannot be moved by a non-editor’s update',
  /function public\.protect_review_state\(\)/.test(sql)
  && /new\.review_status := old\.review_status/.test(sql));
say('  on both tables', (sql.match(/execute function public\.protect_review_state\(\)/g) || []).length === 2);

/* THE TALLY. One row per question per editor — so going over the same
   question twice is not two payments, and a second editor who reviews it
   is still credited for the work they did. */
say('the tally is a row per question per editor, not a number',
  /primary key \(question_key, reviewed_by\)/.test(sql));
say('  an editor records only their own work',
  /with check \(reviewed_by = auth\.uid\(\) and public\.is_editor\(\)\)/.test(sql));

const js = readFileSync('js/backend.js', 'utf8');
say('both backends can list, submit and count',
  (js.match(/async function listForReview\(/g) || []).length === 2
  && (js.match(/async function submitReview\(/g) || []).length === 2
  && (js.match(/async function reviewCounts\(/g) || []).length === 2);
/* The local mirror of the migration — the bug t116 found. */
say('locally too, a row with no status predates the gate',
  /r\.review_status == null \|\| r\.review_status === 'published'/.test(js));

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING APP — A NEW SET IS UNREADABLE');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

const signUp = async (name, email) => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(async () => { try { await Backend.signOut(); } catch {} });
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.click('#auth-toggle'); await page.waitForTimeout(300);
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1600);
};
const signIn = async email => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(async e => { await Backend.signOut(); await Backend.signIn(e, 'password123'); }, email);
};
const go = async hash => {
  await page.goto(B + '/index.html?r=' + Math.random() + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1900);
};

await signUp('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');
await page.evaluate(async () => {
  await Backend.publishPaper({ id: 't123-new', title: 'A newly imported paper',
    categoryId: 'obstetrics', sectionId: 'obs-antenatal', topicId: 't-preconception',
    sba: 2, emq: 0, tf: 0,
    content: { topic: 'A newly imported paper', sba: [
      { stem: 'Which first?', options: ['alpha', 'beta', 'gamma'], answer: 0, rationale: 'because' },
      { stem: 'And then?', options: ['yes', 'no'], answer: 1 }] } });
  Data.bustPapers?.();
});
const asEditor = await page.evaluate(async () => ({
  stored: JSON.parse(localStorage.getItem('aureum.published') || '[]')
    .filter(p => p.id === 't123-new').map(p => p.review_status),
  visible: (await Data.myPapers()).map(p => p.id).includes('t123-new'),
  queue: (await Backend.listForReview()).map(s => s.table + ':' + s.id + ':' + s.questionCount)
}));
say('a newly published set is a draft', asEditor.stored.join() === 'draft', asEditor.stored.join());
/* An editor must see it, or they could not review it. */
say('  its editor can still see it', asEditor.visible);
say('  and it is in the queue, with its size', asEditor.queue.join() === 'papers:t123-new:2',
  asEditor.queue.join(', '));

await signUp('Dr Nimal Perera', 'nimal@example.com');
const asStudent = await page.evaluate(async () => ({
  visible: (await Data.myPapers()).map(p => p.id).includes('t123-new'),
  content: await Backend.getPaperContent('t123-new').catch(() => 'threw'),
  bundled: (await Data.myPapers()).some(p => /^p-/.test(p.id))
}));
say('a candidate cannot see it', !asStudent.visible);
/* A CARD LIST THAT HIDES IT AND A CONTENT READ THAT HANDS IT OVER IS NOT A
   GATE. The paper page asks by id, and an id is easy to guess. */
say('  and cannot fetch its content by id either', !asStudent.content, String(asStudent.content));
/* THE PROMISE OF THE MIGRATION. */
say('  while everything already in the bank is untouched', asStudent.bundled);

/* ---------------------------------------------------------------- */
sec('3. THE EDITOR GOES THROUGH IT WITHOUT THE MOUSE');

await signIn('ayeshmantha@gmail.com');
await go('#/editor/review');
const cards = await page.evaluate(() => [...document.querySelectorAll('.er-card h3')].map(h => h.textContent.trim()));
say('the queue shows the set', cards.includes('A newly imported paper'), cards.join(', '));
await page.click('.er-card'); await page.waitForTimeout(1600);
say('  and opens it', /A newly imported paper/.test(await page.evaluate(() =>
  document.querySelector('.page-title')?.textContent || '')));
/* "How much more" is the only question anybody has while doing this. */
say('  saying how much is left', /Question 1 of 2 · 0 read · 2 to go/.test(
  await page.evaluate(() => document.querySelector('#er-count')?.textContent || '')),
  await page.evaluate(() => document.querySelector('#er-count')?.textContent || ''));
/* EVERY FIELD IS ALREADY AN INPUT — there is no edit mode to enter, and
   therefore no mode to forget you are in. */
const fields = await page.evaluate(() => ({
  stem: document.querySelector('[data-f="stem"]')?.value || '',
  opts: [...document.querySelectorAll('.er-opt input')].map(i => i.value),
  key: [...document.querySelectorAll('.er-opt')].findIndex(o => o.classList.contains('is-key'))
}));
say('every field is editable where it is read', fields.stem === 'Which first?'
  && fields.opts.join() === 'alpha,beta,gamma', fields.stem);
say('  with the current answer marked', fields.key === 0, 'option ' + fields.key);

/* THE KEYBOARD IS THE POINT: a set of forty cleared without reaching for
   the mouse once. */
await page.keyboard.press('2'); await page.waitForTimeout(300);
say('pressing 2 makes the second option the answer',
  (await page.evaluate(() => [...document.querySelectorAll('.er-opt')].findIndex(o => o.classList.contains('is-key')))) === 1);
await page.keyboard.press('Enter'); await page.waitForTimeout(400);
say('  Enter accepts and moves on', /Question 2 of 2 · 1 read/.test(
  await page.evaluate(() => document.querySelector('#er-count')?.textContent || '')),
  await page.evaluate(() => document.querySelector('#er-count')?.textContent || ''));
await page.keyboard.press('k'); await page.waitForTimeout(300);
say('  k goes back', /Question 1 of 2/.test(
  await page.evaluate(() => document.querySelector('#er-count')?.textContent || '')));
await page.keyboard.press('j'); await page.waitForTimeout(300);
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
say('  and the end offers the submit', await page.evaluate(() => !!document.querySelector('#er-submit')));

await page.click('#er-submit'); await page.waitForTimeout(2200);
const after = await page.evaluate(async () => {
  const row = JSON.parse(localStorage.getItem('aureum.published') || '[]').find(p => p.id === 't123-new');
  return { status: row.review_status, answer: row.content.sba[0].answer,
    counts: (await Backend.reviewCounts()).map(c => c.name + '=' + c.n) };
});
say('submitting publishes the set', after.status === 'published', after.status);
/* The edit made with the keyboard is written back into the paper itself —
   the only place a question actually lives. */
say('  and the change made while reading is saved with it', after.answer === 1,
  'answer is now option ' + after.answer);
/* THE TALLY IS A CONSEQUENCE OF THE WORK, not a number somebody types. */
say('  and both questions count towards the editor’s tally',
  after.counts.join() === 'Dr Didula Ayeshmantha=2', after.counts.join(', '));

await signIn('nimal@example.com');
const nowVisible = await page.evaluate(async () => ({
  visible: (await Data.myPapers()).map(p => p.id).includes('t123-new'),
  answer: (await Backend.getPaperContent('t123-new'))?.sba?.[0]?.answer
}));
say('the candidate can reach it the moment it is submitted', nowVisible.visible);
say('  and gets the corrected answer', nowVisible.answer === 1, 'option ' + nowVisible.answer);

/* ---------------------------------------------------------------- */
sec('4. AND A TYPO FIX DOES NOT SEND IT BACK');

/* The harsh alternative — any edit returns the set to the queue — would
   mean a one-character fix pulls a paper out of the bank mid-revision. */
const typo = await page.evaluate(async () => {
  await Backend.signOut(); await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  const loaded = await Data.loadPaper('t123-new');
  const doc = JSON.parse(JSON.stringify(loaded.paper));
  doc.sba[0].stem = 'Which first? (corrected)';
  await Backend.publishPaper({ ...loaded.meta, content: doc });
  Data.bustPapers?.();
  const row = JSON.parse(localStorage.getItem('aureum.published') || '[]').find(p => p.id === 't123-new');
  return { status: row.review_status, stem: row.content.sba[0].stem,
    queue: (await Backend.listForReview()).map(s => s.id) };
});
say('editing a reviewed set keeps it published', typo.status === 'published', typo.status);
say('  the edit is saved', /corrected/.test(typo.stem));
say('  and it does not reappear in the queue', !typo.queue.includes('t123-new'),
  typo.queue.join(', ') || 'queue empty');

/* A candidate may not record a review, whatever they send. */
const notEditor = await page.evaluate(async () => {
  await Backend.signOut(); await Backend.signIn('nimal@example.com', 'password123');
  const out = {};
  try { await Backend.listForReview(); } catch (e) { out.list = e.message; }
  try { await Backend.submitReview('papers', 't123-new', ['x']); } catch (e) { out.submit = e.message; }
  try { await Backend.reviewCounts(); } catch (e) { out.counts = e.message; }
  return out;
});
say('a candidate cannot open the queue', /only an editor/i.test(notEditor.list || ''), notEditor.list);
say('  nor publish a set', /only an editor/i.test(notEditor.submit || ''), notEditor.submit);
say('  nor read the tally', /only an editor/i.test(notEditor.counts || ''), notEditor.counts);

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v123/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '123', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
