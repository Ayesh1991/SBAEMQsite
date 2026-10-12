/* t133 — an admin can stand in any course.

   THE DEVELOPER COULD REACH EVERY COURSE'S CONTENT AND LOOK AT NONE OF
   IT. The console lists all courses and files content into any of them
   (v130), and the database has always agreed — can_read_tracks() begins
   `public.is_editor()`, so an editor reads every course's bank whatever
   their enrolment. But the site OUTSIDE the console shows one course: the
   one you are on. And the only way to change that, the profile picker,
   offered Course.live() — so the course being built, which is precisely
   the one worth looking at, was the one that could not be chosen.

   v130 fixed this exact mistake in the importer's picker and the "filed
   nowhere" panel. It was in a third place.

   §2 IS THE HALF THAT WAS NOT A DISPLAY PROBLEM. Opening the picker is no
   use if choosing is refused, and local mode refused everybody —
   `enrol()` threw on a course that is not live, for admins too. The cloud
   does not: "enrolments own insert" requires is_live, and "enrolments
   admin all" overrides it. So the admin's own switch worked in production
   and failed in testing, which is the wrong way round and the exact shape
   of hole the project has hit before.

   AND IT IS ADMIN, NOT EDITOR (§3). The database permits this through
   is_admin() and nothing weaker, so offering it to an editor would be
   offering a control that refuses them. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE PICKER OFFERS WHAT THE DATABASE ALREADY ALLOWS');

const co = readFileSync('js/course.js', 'utf8');
const app = readFileSync('js/app.js', 'utf8');
const dev = readFileSync('js/dev-console.js', 'utf8');
const be = readFileSync('js/backend.js', 'utf8');
const sql = readFileSync('supabase/schema.sql', 'utf8');

say('the picker can be asked for every course',
  /function picker\(selectedId, name, opts\)/.test(co)
  && /const l = \(opts && opts\.all\) \? all\(\) : live\(\);/.test(co));
say('  marking the ones not open yet', /tk-wip">being built/.test(co));
say('  and the profile asks for them when an admin is looking',
  /const canSeeAll = !!user\?\.isDeveloper;/.test(co + app));
/* The console is admin-only already, so its switch lists everything. */
say('the console has a switch where the work happens',
  /async function paintStandIn\(host\)/.test(dev) && /id="standin-course"/.test(dev));
/* It is the real switch, not a preview mode only some pages honour. */
say('  and it is the real course switch, not a pretend one',
  /await Course\.choose\(id\);/.test(dev));

say('the database has always permitted it',
  /create policy "enrolments admin all" on public\.enrolments for all\s*\n\s*using \(public\.is_admin\(\)\)/.test(sql));
say('  and local mode now says the same thing',
  /if \(!t\.isLive\) \{\s*\n\s*const me = await currentUser\(\);\s*\n\s*if \(!me \|\| !me\.isDeveloper\) throw new Error\('That course is not open yet\.'\);/.test(be));

/* ---------------------------------------------------------------- */
sec('2. AND AN ADMIN CAN ACTUALLY STAND IN ONE');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
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
/* A candidate, and the admin — the developer address is the admin in
   local mode, as it is in a fresh deployment. */
await signUp('Dr Nimal Perera', 'nimal@example.com');
await signUp('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');

/* EXACTLY THE SITUATION: a second course, built, subjects ticked, NOT
   open. This is what "being built" means and it is the normal state of a
   course somebody is filling. */
const setUp = await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS-Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null, subjects: ['medicine', 'surgery', 'obgyn'],
    positions: ['Medical Student'], sort: 10, isLive: false, isFree: false });
  Course.bust(); await Course.load();
  const me = await Backend.currentUser();
  return { live: Course.live().length, all: Course.all().length, admin: !!me.isDeveloper };
});
say('one course is open, a second is being built, and I am the admin',
  setUp.live === 1 && setUp.all === 2 && setUp.admin,
  setUp.live + ' open of ' + setUp.all + ', admin=' + setUp.admin);

await page.goto(B + '/index.html?r=' + Math.random() + '#/profile', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const prof = await page.evaluate(() => [...document.querySelectorAll('.tk-opt')].map(o => o.textContent.replace(/\s+/g, ' ').trim()));
say('the profile offers the course that is being built',
  prof.length === 2 && prof.some(o => /Final MBBS/.test(o)), prof.join(' | '));
say('  saying that it is', prof.some(o => /being built/.test(o)));

await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2700);
const switched = await page.evaluate(async () => {
  const s = document.querySelector('#standin-course');
  if (!s) return { missing: true };
  s.value = 'mbbs-final'; s.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1600));
  return { msg: document.querySelector('#standin-msg')?.textContent || '',
    now: Course.currentId(), subjects: Course.subjects() };
});
/* THE LINE THAT USED TO READ "That course is not open yet." */
say('switching to it is allowed', switched.now === 'mbbs-final', switched.msg);
say('  and the course scoping follows',
  switched.subjects.join() === 'medicine,surgery,obgyn', switched.subjects.join(', '));

/* The site outside the console has to follow, or the switch is cosmetic. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/library', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
const lib = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.tk-sub')].map(b => b.textContent.trim()),
  note: (document.querySelector('.lib-nosyl')?.textContent || '').replace(/\s+/g, ' ').trim()
}));
say('the library is now that course’s', lib.chips.length === 4, lib.chips.join(' | '));
/* AND IT SAYS WHAT IS MISSING. A course with no syllabus shows an empty
   library, and "no papers" would send somebody to the importer to fix
   something that is not broken. */
say('  and says plainly that it has no syllabus yet',
  /No syllabus for Final MBBS yet/.test(lib.note), lib.note.slice(0, 70));

/* ---------------------------------------------------------------- */
sec('3. BUT A CANDIDATE STILL CANNOT');

/* The whole point of "being built": nobody can choose it and nothing
   tagged to it reaches anybody. Opening it to the admin must not open it
   to everyone. */
const candidate = await page.evaluate(async () => {
  await Backend.signOut(); await Backend.signIn('nimal@example.com', 'password123');
  Course.bust(); await Course.load();
  const out = { admin: !!(await Backend.currentUser())?.isDeveloper };
  try { await Course.choose('mbbs-final'); out.got = Course.currentId(); }
  catch (e) { out.refused = e.message; }
  return out;
});
say('an ordinary candidate is not an admin', !candidate.admin);
say('  and is refused the course that is not open',
  !candidate.got && /not open yet/i.test(candidate.refused || ''), candidate.refused || candidate.got);

await page.goto(B + '/index.html?r=' + Math.random() + '#/profile', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
const theirs = await page.evaluate(() => [...document.querySelectorAll('.tk-opt')].map(o => o.textContent.replace(/\s+/g, ' ').trim()));
/* One course is not a choice, so with only the open one left there is no
   picker at all — which is also the v115 rule. */
say('  and is not even shown it', !theirs.some(o => /Final MBBS/.test(o)),
  theirs.join(' | ') || 'no picker');

/* ---------------------------------------------------------------- */
sec('4. AND THE HANDOVER FILE DESCRIBES THE REAL IMPORTER');

/* A document that drifts from the code is worse than none, because it is
   believed. These are the specific claims it makes about behaviour. */
const doc = readFileSync('docs/CURRICULUM-HANDOVER.md', 'utf8');
const data = readFileSync('js/data.js', 'utf8');

say('it names the three levels the importer requires',
  /category → section → topic/.test(doc));
say('  and the id prefixes it generates',
  /sec-antenatal-care/.test(doc) && /'cat-' \+ slugify/.test(dev) && /'sec-' \+ slugify/.test(dev));
/* The merge-not-replace promise is the one with consequences. */
say('it promises a merge, and the importer merges',
  /never deletes/i.test(doc) && /if \(!cSec\.topics\.find\(x => x\.id === top\.id\)\) cSec\.topics\.push\(top\)/.test(dev));
say('  and that a missing tags list defaults to the title',
  /defaults to `\[title\]`/.test(doc)
  && /tags: Array\.isArray\(tx\.tags\) && tx\.tags\.length \? tx\.tags : \[tt\]/.test(dev));
/* THE TWO-PASS MATCHER, which the first draft of the document got wrong
   by calling it a title-and-filename match. */
say('it describes the matcher as exact-then-loose, first hit wins',
  /\*\*Exact\*\*/.test(doc) && /\*\*Loose\*\*/.test(doc) && /first match wins/i.test(doc)
  && /looser contains-match as a fallback/.test(data));
say('  and warns that a short abbreviation over-matches',
  /three-letter tag matches anything containing those letters/.test(doc));
say('  naming folderTag as the reliable way in',
  /folderTag/.test(doc) && /f\.paper\.folderTag \|\| f\.paper\.topic/.test(dev));
/* The subject ids are a fixed vocabulary and a wrong one files content
   where no chip will find it. */
say('it lists the subject ids exactly as the app knows them',
  ['obgyn', 'medicine', 'surgery', 'paediatrics', 'psychiatry', 'anaesthesiology']
    .every(x => doc.includes(x) && co.includes(x)));
/* The one rule that silently inverts a mark. */
say('  and repeats the true/false answer rule',
  /never a number/i.test(doc) && /invert the mark/i.test(doc));

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
