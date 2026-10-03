/* t125 — Phase 4: a paper the group sits together.

   One person sets it from the blueprint, names a time, and everybody sits
   the SAME questions at that time, alone. Afterwards the marks go side by
   side, which is the whole reason for doing it together.

   THE WHOLE DIFFICULTY IS FAIRNESS, and it is one sentence: A PAPER THAT
   CAN BE OPENED EARLY IS NOT AN ASSESSMENT. So the question list is not a
   column on the row the group can read — it is its own table, behind a
   policy that compares the clock to the start time. Asking early does not
   return an empty list to be filtered: the rows never leave the database.
   A countdown in the browser is a countdown anybody can skip with a
   console open, and §2 is the test that it is not one.

   SUBMITTED ONCE, deliberately. There is no update policy on the attempts
   table at all. Re-sitting the same paper for a better number is not what
   a group is comparing, and a leaderboard that can be improved by trying
   again measures persistence rather than knowledge.

   A SCORE IS NOT AN ANSWER, which is why the marks are readable by the
   whole group while the questions are not: knowing somebody got 72% tells
   you nothing about which ones they got right. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE CLOCK IS A POLICY, NOT A COUNTDOWN');

const sql = readFileSync('supabase/schema.sql', 'utf8');
/* THE DESIGN DECISION IN ONE LINE: the plan is a separate table so that a
   ROW-level policy can gate it. A column on group_papers could not be
   hidden while the rest of the row stayed readable. */
say('the questions live apart from the paper they belong to',
  /create table if not exists public\.group_paper_plan/.test(sql));
say('  and reading them compares the clock to the start time',
  /create policy "group plan read"[\s\S]{0,200}group_paper_open\(paper_id\)/.test(sql));
say('  which is a function over the stored time, not a client’s word',
  /select exists \(select 1 from public\.group_papers g\s*\n?\s*where g\.id = p and now\(\) >= g\.starts_at\)/.test(sql));
/* The invitation has to be visible beforehand or nobody turns up — the
   paper's name and time are readable, its questions are not. */
say('the group can see that a paper exists and when it starts',
  /create policy "group papers read" on public\.group_papers for select\s*\n\s*using \(public\.is_room_member\(room_id\)\)/.test(sql));
say('  and only its members can', /is_room_member/.test(sql));
/* Sitting it needs the clock too, or somebody could submit a mark for a
   paper that has not happened. */
say('submitting a mark also needs the paper to be open',
  /create policy "group attempts write"[\s\S]{0,260}group_paper_open\(paper_id\)/.test(sql));
/* NO UPDATE POLICY AT ALL. */
say('and a mark cannot be rewritten — there is no update policy',
  !/create policy "group attempts update"/.test(sql)
  && /no update policy, deliberately/i.test(sql));

const js = readFileSync('js/backend.js', 'utf8');
say('both backends can set, open, sit and tally a group paper',
  (js.match(/async function createGroupPaper\(/g) || []).length === 2
  && (js.match(/async function getGroupPaperPlan\(/g) || []).length === 2
  && (js.match(/async function saveGroupAttempt\(/g) || []).length === 2
  && (js.match(/async function listGroupAttempts\(/g) || []).length === 2);
/* The local backend applies the same clock. A fairness rule only one
   backend enforces is a rule that gets tested on the wrong one. */
say('  and the local one enforces the clock itself',
  /has not started yet/.test(js) && /const gpOpen = g =>/.test(js));

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING APP — SEALED UNTIL IT STARTS');

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
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1500);
};

await signUp('Dr Nimal Perera', 'nimal@example.com');
await signUp('Dr Sunil Perera', 'sunil@example.com');
await signUp('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');

const ids = await page.evaluate(async () => {
  const n = (await Backend.searchPeople('Nimal'))[0];
  const room = await Backend.createChatRoom({ title: 'Revision crew', kind: 'group',
    memberIds: [n.id], myName: 'Dr Didula Ayeshmantha' });
  const later = await Backend.createGroupPaper({ roomId: room.id, title: 'Saturday mock',
    startsAt: new Date(Date.now() + 3600000).toISOString(), minutes: 30,
    qkeys: ['x:SBA:1', 'x:SBA:2', 'x:SBA:3'] });
  const now = await Backend.createGroupPaper({ roomId: room.id, title: 'Open now',
    startsAt: new Date(Date.now() - 60000).toISOString(), minutes: 60,
    qkeys: ['x:SBA:1'] });
  return { room: room.id, later: later.id, now: now.id };
});

const sealed = await page.evaluate(async o => {
  try { const p = await Backend.getGroupPaperPlan(o.later); return { got: p }; }
  catch (e) { return { refused: e.message }; }
}, ids);
/* THE POINT OF THE RELEASE. Whoever SET the paper is asking, and is
   refused — the seal is not about trusting the other members. */
say('the questions are refused before the start time, even to the setter',
  !sealed.got && /has not started yet/i.test(sealed.refused || ''), sealed.refused);
const opened = await page.evaluate(async o => await Backend.getGroupPaperPlan(o.now), ids);
say('  and handed over once it has started', opened.length === 1, opened.join(', '));

/* ---------------------------------------------------------------- */
sec('3. AND ONLY TO THE GROUP');

const outsider = await page.evaluate(async o => {
  await Backend.signOut(); await Backend.signIn('sunil@example.com', 'password123');
  const out = { papers: (await Backend.listGroupPapers(o.room)).length };
  try { await Backend.getGroupPaperPlan(o.now); out.plan = 'handed over'; }
  catch (e) { out.plan = 'refused'; }
  try { await Backend.saveGroupAttempt(o.now, { score: 1, total: 1, percent: 100 }); out.sat = 'sat it'; }
  catch (e) { out.sat = 'refused'; }
  return out;
}, ids);
say('somebody outside the group sees no papers at all', outsider.papers === 0, outsider.papers + ' papers');
say('  cannot open one by id', outsider.plan === 'refused', outsider.plan);
say('  and cannot put a mark on the board', outsider.sat === 'refused', outsider.sat);
/* The page says which it is, rather than bouncing somebody who followed a
   link a friend sent them. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/group/' + ids.room, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1900);
say('  and the page says so plainly', /Not one of your groups/.test(
  await page.evaluate(() => document.querySelector('.page-title')?.textContent || '')),
  await page.evaluate(() => document.querySelector('.page-title')?.textContent || ''));

/* ---------------------------------------------------------------- */
sec('4. SAT ONCE, AND THE MARKS GO SIDE BY SIDE');

const sat = await page.evaluate(async o => {
  await Backend.signOut(); await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  const a = await Backend.saveGroupAttempt(o.now, { score: 8, total: 10, percent: 80, detail: [] });
  let again = null;
  try { await Backend.saveGroupAttempt(o.now, { score: 10, total: 10, percent: 100 }); again = 'allowed'; }
  catch (e) { again = e.message; }
  await Backend.signOut(); await Backend.signIn('nimal@example.com', 'password123');
  await Backend.saveGroupAttempt(o.now, { score: 9, total: 10, percent: 90, detail: [] });
  return { mine: a.percent, again, board: (await Backend.listGroupAttempts(o.now)).map(r => r.name + ' ' + r.percent) };
}, ids);
say('a member’s mark is recorded', sat.mine === 80, sat.mine + '%');
/* A leaderboard that can be improved by trying again measures persistence,
   not knowledge. */
say('  and cannot be sat a second time', /already sat/i.test(sat.again || ''), sat.again);
/* A score is not an answer — which is why the whole group may read these
   while the questions stay sealed. */
say('the group sees everyone, best first',
  sat.board.join(' | ') === 'Dr Nimal Perera 90 | Dr Didula Ayeshmantha 80', sat.board.join(' | '));

/* ---------------------------------------------------------------- */
sec('5. AND THE PAGE SAYS WHICH STATE EACH PAPER IS IN');

await page.evaluate(async () => { await Backend.signOut(); await Backend.signIn('ayeshmantha@gmail.com', 'password123'); });
await page.goto(B + '/index.html?r=' + Math.random() + '#/group/' + ids.room, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const ui = await page.evaluate(() => ({
  title: document.querySelector('.page-title')?.textContent || '',
  states: [...document.querySelectorAll('.gp-state')].map(s => s.textContent.trim()),
  rows: [...document.querySelectorAll('.gp-table tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim()),
  me: document.querySelectorAll('.gp-table tr.is-me').length,
  /* The sealed one offers no way in — not a disabled button, no button. */
  sealedHasLink: !![...document.querySelectorAll('.gp-card')]
    .find(c => /Not open yet/.test(c.textContent))?.querySelector('a[href*="/paper/"]')
}));
say('the group’s papers page opens', /Papers you sit together/.test(ui.title), ui.title);
/* Three states, three different pages. */
say('  each paper says whether it is open, waiting or closed',
  ui.states.join() === 'Open now,Not open yet', ui.states.join(', '));
say('  a paper that has not started offers no way in', !ui.sealedHasLink);
say('  and the board is under the open one', ui.rows.length === 2, ui.rows.join(' / '));
say('  with your own row marked', ui.me === 1);

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v125/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '125', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
