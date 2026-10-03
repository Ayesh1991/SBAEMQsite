/* t116 — Phase 1: the candidate can see, choose and change their course.

   v115 put tracks and enrolments in the database and changed nothing a
   candidate could see. This is the half they can see: a picker on the
   sign-up form, a switcher in the profile, and a bank that shows one
   course's stations instead of everybody's.

   THE RULE THE WHOLE RELEASE IS BUILT AROUND, and the first thing this
   file proves: WITH ONE COURSE OPEN, NOTHING CHANGES. A picker offering a
   single answer is not a choice, it is a question the candidate cannot
   get right or wrong, and putting one on the sign-up form of a platform
   with one exam makes the form worse for no gain. So today — one live
   course — the form and the bank look exactly as they did in v115, and
   every rule below only starts to draw anything when a second course is
   opened. That is what makes this release safe to ship before the second
   course exists.

   THE NAME COLLISION, recorded because it very nearly shipped. The
   obvious name for this module was `Track`, matching the table. `Track`
   was already taken — by the interaction logger in track.js that quiz.js
   and ai.js call on every answer a candidate gives. Two modules cannot
   share a global: the second `const Track` in load order throws, or, if
   the file replaces the first, a whole subsystem goes quiet with nothing
   on the console. So the table keeps `tracks` and the module is `Course`,
   which is also the word the candidate uses. §1 asserts both still exist.

   AND THE ONE THAT IS NOT A LOCK. The bank filter is relevance, not
   security. v115's policies decide what may be READ; this decides what is
   worth showing. The two disagree on purpose about untagged content —
   the database hides it, the browser shows it — and §4 pins that down,
   because a filter mistaken for a lock is how paid content leaks. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. TWO MODULES, TWO NAMES, BOTH STILL THERE');

const html = readFileSync('index.html', 'utf8');
const courseJs = readFileSync('js/course.js', 'utf8');
const trackJs = readFileSync('js/track.js', 'utf8');
say('the interaction logger is still called Track', /^const Track = /m.test(trackJs));
say('  and still logs events', /function log\(event, questionKey, mode, data\)/.test(trackJs));
say('the course module is called Course, not Track', /^const Course = /m.test(courseJs)
  && !/^const Track = /m.test(courseJs));
/* Both files must be on the page, and course.js must load before the
   pages that ask it anything. */
say('both are loaded', /js\/track\.js\?v=/.test(html) && /js\/course\.js\?v=/.test(html));
say('  and course.js comes before app.js and osce.js',
  html.indexOf('js/course.js') < html.indexOf('js/osce.js')
  && html.indexOf('js/course.js') < html.indexOf('js/app.js'));

/* The card projection has to carry the two new columns or the bank has
   nothing to filter on. */
const backend = readFileSync('js/backend.js', 'utf8');
say('the station card carries its course and subject',
  /'tracks', 'subject'\]/.test(backend) && /created_at,tracks,subject/.test(backend));

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING APP — ONE COURSE, NOTHING NEW');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

const signedOutAuth = async () => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(async () => { try { await Backend.signOut(); } catch {} });
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
};
const fresh = async (name, email) => {
  await signedOutAuth();
  await page.click('#auth-toggle'); await page.waitForTimeout(300);
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1600);
};
const signInAs = async email => {
  await signedOutAuth();
  await page.evaluate(async e => { await Backend.signIn(e, 'password123'); }, email);
};

await signedOutAuth();
await page.click('#auth-toggle'); await page.waitForTimeout(300);
const oneCourse = await page.evaluate(() => ({
  picker: !!document.querySelector('#auth-course'),
  markup: Course.picker('', 'course'),
  live: Course.live().map(t => t.id)
}));
/* THE POINT OF THE WHOLE RELEASE. */
say('with one course open the sign-up form asks nothing extra', !oneCourse.picker,
  oneCourse.live.join(', '));
say('  because a picker with one answer draws nothing at all', oneCourse.markup === '');

await fresh('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');
const seen = await page.evaluate(async () => {
  await Course.load(true);
  return { id: Course.currentId(), name: Course.current()?.name, subs: Course.subjects() };
});
say('and the account is on the one course there is', seen.id === 'pgim-og-2', seen.id);
say('  which has no subjects to filter by', seen.subs.length === 0);

/* The profile names it even with nothing to switch to — on a platform
   with several, seeing which one you are looking at matters more than
   being able to change it. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/profile', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
const soloCard = await page.evaluate(() => {
  const c = document.querySelector('#course-card');
  return { there: !!c, text: c?.textContent.replace(/\s+/g, ' ').trim() || '',
    radios: document.querySelectorAll('#course-card input[type=radio]').length };
});
say('the profile names the course', soloCard.there && /O&G|Obstetric/i.test(soloCard.text),
  soloCard.text.slice(0, 90));
say('  and offers no switch, because there is nowhere to switch to', soloCard.radios === 0);

/* ---------------------------------------------------------------- */
sec('3. OPEN A SECOND COURSE AND THE UI APPEARS');

/* Exactly the growth this release is for: a row in `tracks` and the
   picker exists — no deploy, no code change, no schema change. */
await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS — Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null,
    subjects: ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry'],
    sort: 5, isLive: true, isFree: true });
  await Backend.saveTrack({ id: 'pgim-med-1', name: 'PGIM MD (Medicine) — Part 1',
    short: 'Medicine Part 1', stage: 'pg-entry', speciality: 'medicine',
    subjects: [], sort: 20, isLive: false, isFree: false });
});

await signedOutAuth();
await page.click('#auth-toggle'); await page.waitForTimeout(400);
const nowPicker = await page.evaluate(() => {
  const host = document.querySelector('#auth-course');
  return { there: !!host,
    values: [...document.querySelectorAll('#auth-course input[type=radio]')].map(r => r.value),
    stages: [...document.querySelectorAll('#auth-course .tk-stage')].map(p => p.textContent.trim()) };
});
say('a second live course puts the picker on the sign-up form', nowPicker.there);
say('  offering both, and only the live ones', nowPicker.values.join() === 'mbbs-final,pgim-og-2',
  nowPicker.values.join(', '));
/* A course that is built but not opened is not on the form — the
   staging switch v115 put in is doing its job. */
say('  with the unopened course absent', !nowPicker.values.includes('pgim-med-1'));
say('  grouped by stage, undergraduate first', nowPicker.stages[0] === 'Undergraduate',
  nowPicker.stages.join(' | '));

/* Sign up choosing the undergraduate course. */
await page.click('#auth-course input[value="mbbs-final"]');
const lit = await page.evaluate(() =>
  document.querySelector('#auth-course .tk-opt.is-on')?.querySelector('input')?.value);
say('  and the chosen one lights up', lit === 'mbbs-final', lit);
await page.fill('input[name=name]', 'Kavindu Silva');
await page.fill('input[name=email]', 'kavindu@example.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1800);

const chose = await page.evaluate(async () => {
  await Course.load(true);
  return { id: Course.currentId(), subs: Course.subjects(),
    status: Course.statusOf(Course.currentId()),
    pending: localStorage.getItem('aureum-course-pick') };
});
say('the new account lands on the course it picked', chose.id === 'mbbs-final', chose.id);
say('  carrying its five subjects', chose.subs.length === 5, chose.subs.join(', '));
/* ENROLMENT IS NOT ENTITLEMENT — v115's rule, unchanged by a nicer form.
   A candidate enrols themselves; only an admin makes it active. */
say('  on a trial, not an entitlement', chose.status === 'trial', chose.status);
say('  and the remembered choice is spent, not left lying about', !chose.pending);

/* ---------------------------------------------------------------- */
sec('4. THE BANK SHOWS ONE COURSE');

/* Three stations: one tagged to each course, and one tagged to nothing. */
await page.evaluate(async () => {
  const st = (id, topic, tracks, subject) => ({
    id, topic, scenario: 'A scenario for ' + topic, tracks, subject,
    station_time_min: 15, questions: [{ prompt: 'Assess.', marking_points: [{ text: 'Do it', marks: 1 }] }]
  });
  await Backend.publishOsceStation(st('t116-og', 'Postpartum haemorrhage', ['pgim-og-2'], 'obgyn'));
  await Backend.publishOsceStation(st('t116-paeds', 'Febrile convulsion', ['mbbs-final'], 'paediatrics'));
  await Backend.publishOsceStation(st('t116-surg', 'Acute abdomen', ['mbbs-final'], 'surgery'));
  /* THE UNFILED ONE IS WRITTEN BY HAND, and has to be as of v117.
     Publishing cannot produce an untagged row any more — contentTags()
     stamps the editor's own course on anything that arrives without one —
     so a genuinely unfiled row is now only what it was always meant to
     represent here: something that predates the tagging, or was written
     straight into the table. Going through publish() would quietly tag it
     and this section would be asserting nothing. */
  const raw = JSON.parse(localStorage.getItem('aureum.oscestations') || '[]');
  raw.push(st('t116-unfiled', 'Consent for laparoscopy', [], null));
  localStorage.setItem('aureum.oscestations', JSON.stringify(raw));
});
await page.goto(B + '/index.html?r=' + Math.random() + '#/osce', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const bank = await page.evaluate(() => {
  const ids = [...document.querySelectorAll('.os-card')].map(c => c.dataset.st);
  const vis = [...document.querySelectorAll('.os-card')].filter(c => !c.hidden).map(c => c.dataset.st);
  return { ids, vis, subs: [...document.querySelectorAll('.tk-sub')].map(b => b.textContent.trim()),
    all: document.querySelector('.os-bin')?.textContent.replace(/\s+/g, ''),
    note: document.querySelector('.os-course-note')?.textContent.replace(/\s+/g, ' ').trim() || '' };
});
/* The filter runs at the top, before the counts and the chips, so a bin
   never claims a station that is not on the page. */
say('the other course’s station is not drawn at all', !bank.ids.includes('t116-og'),
  bank.ids.join(', '));
say('  this course’s two are', bank.ids.includes('t116-paeds') && bank.ids.includes('t116-surg'));
/* THE DISAGREEMENT, ON PURPOSE. The database hides an untagged row; the
   browser shows it. Different questions: "may this be read" errs shut so
   nothing leaks, "is this relevant" errs open because a row with no
   course is not irrelevant, it is unfiled — and a station whose tag
   somebody forgot must not vanish from its own author's bank. */
say('  and an untagged station is still shown, because unfiled is not irrelevant',
  bank.ids.includes('t116-unfiled'));
say('  so the "All stations" count is the filtered bank, not the whole one',
  /3$/.test(bank.all || ''), bank.all);
/* A FILTER THAT HIDES THINGS SILENTLY IS INDISTINGUISHABLE FROM A BROKEN
   SEARCH. It matters most to whoever writes the stations: publish one
   tagged to a course you are not on and it would vanish from your own
   bank with nothing on the page to say why. */
say('  and the bank says what the filter took, and where to change it',
  /1 station belongs to another course/.test(bank.note)
  && /Change your course/.test(bank.note), bank.note);

/* THE SUBJECT STRIP — a filter for the undergraduate and nobody else. */
say('a five-subject course gets a subject strip', bank.subs.length === 6, bank.subs.join(' | '));
say('  starting with a way to turn it off', bank.subs[0] === 'All subjects');
await page.click('.tk-sub[data-sub="surgery"]');
await page.waitForTimeout(500);
const bySub = await page.evaluate(() => ({
  vis: [...document.querySelectorAll('.os-card')].filter(c => !c.hidden).map(c => c.dataset.st)
}));
say('choosing a subject narrows the bank to it', bySub.vis.includes('t116-surg')
  && !bySub.vis.includes('t116-paeds'), bySub.vis.join(', '));
/* Same rule as the course filter, for the same reason. */
say('  and the untagged station survives the subject filter too',
  bySub.vis.includes('t116-unfiled'));

/* ---------------------------------------------------------------- */
sec('5. AND THE COURSE CAN BE CHANGED');

await page.goto(B + '/index.html?r=' + Math.random() + '#/profile', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1900);
const before = await page.evaluate(() => ({
  radios: [...document.querySelectorAll('#course-card input[type=radio]')].map(r => r.value),
  on: document.querySelector('#course-card input:checked')?.value
}));
say('the profile now offers the switch', before.radios.length === 2, before.radios.join(', '));
say('  with the current course already chosen', before.on === 'mbbs-final', before.on);

await page.click('#course-card input[value="pgim-og-2"]');
await page.waitForTimeout(1200);
const after = await page.evaluate(async () => {
  await Course.load(true);
  return { id: Course.currentId(), saved: !document.querySelector('#course-note')?.hidden,
    err: document.querySelector('#course-err')?.hidden === false,
    primaries: (await Backend.myEnrolments()).filter(e => e.isPrimary).length };
});
say('switching course saves', after.id === 'pgim-og-2' && after.saved, after.id);
say('  without an error', !after.err);
/* One primary, always. Two would mean the bank had two answers to "which
   course is this person on" and would pick whichever came back first. */
say('  and there is still exactly one primary course', after.primaries === 1,
  after.primaries + ' primary');

/* And the bank follows, which is the whole reason the switch is there. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/osce', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const swapped = await page.evaluate(() => ({
  ids: [...document.querySelectorAll('.os-card')].map(c => c.dataset.st),
  subs: document.querySelectorAll('.tk-sub').length
}));
say('the bank follows the switch', swapped.ids.includes('t116-og')
  && !swapped.ids.includes('t116-paeds'), swapped.ids.join(', '));
/* A one-speciality course has nothing to filter within, so the strip
   goes away rather than showing one useless chip. */
say('  and a single-subject course shows no subject strip', swapped.subs === 0);

/* A stale subject left over from the other course must not filter this
   bank to nothing — the chip explaining it is not on the page. */
const stale = await page.evaluate(() =>
  [...document.querySelectorAll('.os-card')].filter(c => !c.hidden).length);
say('  a subject remembered from the other course does not empty it', stale === 2, stale + ' shown');

/* ---------------------------------------------------------------- */
sec('6. TWO PEOPLE, ONE VISIT');

/* The course is held in memory for the length of the visit, and a visit
   can contain two people — a shared laptop, a demonstration, a colleague
   borrowing the browser. Signing out has to forget it, or the next person
   sees this bank filtered to the last person's course, which looks like
   missing content and is a leak of what somebody else is studying. */
/* A third person, on the undergraduate course — the previous two are both
   on O&G by now, and a handover between two people on the same course
   would prove nothing. */
await signedOutAuth();
await page.click('#auth-toggle'); await page.waitForTimeout(400);
await page.click('#auth-course input[value="mbbs-final"]');
await page.fill('input[name=name]', 'Tharindu Bandara');
await page.fill('input[name=email]', 'tharindu@example.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1800);
await page.goto(B + '/index.html?r=' + Math.random() + '#/osce', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const undergrad = await page.evaluate(() =>
  [...document.querySelectorAll('.os-card')].map(c => c.dataset.st));
say('the undergraduate sees the undergraduate bank',
  undergrad.includes('t116-paeds') && !undergrad.includes('t116-og'), undergrad.join(', '));

const handover = await page.evaluate(async () => {
  const wasId = Course.currentId();
  await Backend.signOut();
  Course.bust();
  return { wasId, after: Course.currentId(), tracks: Course._state().tracks };
});
say('signing out forgets whose course it was', handover.wasId === 'mbbs-final'
  && handover.after === '', handover.wasId + ' → "' + handover.after + '"');
say('  and nothing is left in the module to leak', handover.tracks === null);

/* The next person on the same browser gets their own bank, not the one
   the last person left behind. */
await signInAs('kavindu@example.com');
await page.goto(B + '/index.html?r=' + Math.random() + '#/osce', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const next = await page.evaluate(async () => {
  await Course.load();
  return { id: Course.currentId(), ids: [...document.querySelectorAll('.os-card')].map(c => c.dataset.st) };
});
say('the next person gets their own course', next.id === 'pgim-og-2', next.id);
say('  and their own bank, not the last person’s',
  next.ids.includes('t116-og') && !next.ids.includes('t116-paeds'), next.ids.join(', '));

/* ---------------------------------------------------------------- */
sec('7. THE FILTER IS NOT THE LOCK');

/* Said out loud in the module, because the next person to touch it will
   be tempted to make `fits()` err shut and call it security. */
say('course.js says so in as many words', /never a lock/.test(courseJs));
/* The real gate, unchanged since v115 and still where it belongs. */
const sql = readFileSync('supabase/schema.sql', 'utf8');
say('  and the read policy still decides, in the database',
  (sql.match(/public\.can_read_tracks\(tracks\)/g) || []).length >= 7,
  (sql.match(/public\.can_read_tracks\(tracks\)/g) || []).length + ' policies');

/* ---------------------------------------------------------------- */
sec('8. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  /* The literal belongs to the newest release file only — see the
     README. */
  return { vs, sw: vs.length === 1 && sw.includes("'aureum-v" + vs[0] + "'") };
});
say('one version across every asset', stamp.vs.length === 1, stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
