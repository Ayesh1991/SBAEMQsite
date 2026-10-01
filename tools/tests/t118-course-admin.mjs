/* t118 — a second course can be born, and its candidates are not registrars.

   WHAT WENT WRONG, reported by somebody signing up with a fresh email:
   "it says registrar and senior registrar only, and nothing changes."

   Both halves were true and neither was a bug in what had been built —
   they were the two things that had not been.

     · NOTHING CHANGES. v116 gives the sign-up form a course picker and
       v117 tags every piece of content with a course, but `tracks` had
       exactly one row and no way to add another except by typing SQL. A
       picker with one answer draws nothing (deliberately), so every
       candidate — final MBBS student included — signed up to PGIM O&G
       Part 2 and saw its bank. The machinery was complete and unreachable.

     · REGISTRAR AND SENIOR REGISTRAR ONLY. `POSITIONS` was hard-coded in
       progression.js when there was one exam. It is decoration — it shows
       in the dashboard greeting and on an invoice and gates nothing — but
       a form whose first question has no true answer is a bad first
       impression, and "are you a registrar or a senior registrar?" has no
       true answer for a fourth-year medical student.

   So the grade belongs to the COURSE, not to the platform, and a course
   can be created from the console. An empty list means "use whatever the
   app ships", which is what every row holds until somebody edits it — so
   this changes nothing for the course that exists today.

   AND BUILDING IS STILL NOT OPENING. A course can be created, filled with
   content and left shut for months; until `is_live` is ticked nobody can
   choose it and nothing tagged to it reaches anybody. §3 holds that line,
   because a console that makes creating a course easy is exactly where
   that distinction would get lost. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE GRADE BELONGS TO THE COURSE');

const sql = readFileSync('supabase/schema.sql', 'utf8');
const js = readFileSync('js/backend.js', 'utf8');
const courseJs = readFileSync('js/course.js', 'utf8');
say('a course carries what its candidates are called',
  /alter table public\.tracks add column if not exists positions text\[\]/.test(sql));
say('  and the course that exists keeps the two grades it always had',
  /positions = '\{Registrar,"Senior Registrar"\}'/.test(sql));
say('  both backends read and write it',
  (js.match(/positions: r\.positions \|\| \[\]/g) || []).length === 1
  && /positions: t\.positions \|\| \[\]/.test(js));
/* EMPTY MEANS "THE COURSE HAS NOT SAID", not "nobody has a grade". */
say('an empty list falls back to the app’s own', /Progression\.POSITIONS\.slice\(\)/.test(courseJs));

/* The console has to be reachable, or it may as well not exist — this is
   the exact way the feature was unreachable before. */
const app = readFileSync('js/app.js', 'utf8');
say('the courses console is routable', /\|settings\|courses\)/.test(app));

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING APP — TODAY IS UNCHANGED');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
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
const posOptions = () => page.evaluate(() =>
  [...document.querySelectorAll('#auth-position option')].map(o => o.value));

await signedOutAuth();
await page.click('#auth-toggle'); await page.waitForTimeout(400);
const before = await posOptions();
/* One course open, so the grade list is that course's and the form is
   exactly what it was. */
say('with one course open the grades are the ones it has always offered',
  before.join() === 'Registrar,Senior Registrar', before.join(', '));
say('  and no course question is asked',
  !(await page.evaluate(() => !!document.querySelector('#auth-course'))));

await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1600);

/* ---------------------------------------------------------------- */
sec('3. A SECOND COURSE, MADE FROM THE CONSOLE');

await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));
await page.goto(B + '/index.html#/dev/courses', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
say('the courses console opens',
  /exams AUREUM prepares/.test(await page.evaluate(() => document.querySelector('.page-title')?.textContent || '')));
say('  listing the course that exists',
  (await page.evaluate(() => document.querySelectorAll('.co-card').length)) === 1);

/* A course with no code, name or short name is three blank chips and a
   bank nobody can identify. */
await page.evaluate(() => { document.querySelector('#co-new-wrap').open = true; });
await page.waitForTimeout(200);
await page.click('#co-form [data-cf-save]'); await page.waitForTimeout(500);
say('a course with no name is refused',
  /needs a code, a name/.test(await page.evaluate(() =>
    document.querySelector('#co-form [data-cf-msg]')?.textContent || '')));

/* BUILT BUT NOT OPENED — the distinction the whole staging plan rests on. */
const fill = async (id, name, short, stage, positions, subjects, live) => {
  await page.fill('#co-form [data-cf="id"]', id);
  await page.fill('#co-form [data-cf="name"]', name);
  await page.fill('#co-form [data-cf="short"]', short);
  await page.selectOption('#co-form [data-cf="stage"]', stage);
  await page.fill('#co-form [data-cf="positions"]', positions.join('\n'));
  for (const s of subjects) await page.evaluate(k => {
    document.querySelector(`#co-form [data-cf-sub="${k}"]`).checked = true; }, s);
  /* The Open and Free switches are styled toggles whose input is hidden,
     so they are set rather than clicked — the handler reads .checked. */
  await page.evaluate(on => { document.querySelector('#co-form [data-cf="isLive"]').checked = on;
    document.querySelector('#co-form [data-cf="isFree"]').checked = true; }, live);
  await page.click('#co-form [data-cf-save]'); await page.waitForTimeout(1400);
};
await fill('pgim-med-1', 'PGIM MD (Medicine) — Part 1', 'Medicine Part 1', 'pg-entry',
  ['Medical Officer', 'Registrar'], [], false);
const shut = await page.evaluate(async () => {
  await Course.load(true);
  const t = Course.byId('pgim-med-1');
  return { there: !!t, live: t?.isLive, inPicker: Course.live().map(x => x.id) };
});
say('a course can be created without being opened', shut.there && shut.live === false);
/* THE POINT. It exists, it can be filled with content, and no candidate
   can reach it. */
say('  and a course that is not open is offered to nobody',
  !shut.inPicker.includes('pgim-med-1'), shut.inPicker.join(', '));

await page.evaluate(() => { document.querySelector('#co-new-wrap').open = true; });
await page.waitForTimeout(200);
await fill('mbbs-final', 'Final MBBS — Sri Lanka', 'Final MBBS', 'mbbs-final',
  ['Final year student', 'Repeat candidate'],
  ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry'], true);
const made = await page.evaluate(async () => {
  await Course.load(true);
  const t = Course.byId('mbbs-final');
  return { live: t?.isLive, subs: t?.subjects || [], pos: t?.positions || [], stage: t?.stage };
});
say('an open course appears complete', made.live === true && made.stage === 'mbbs-final');
say('  with its five subjects', made.subs.length === 5, made.subs.join(', '));
say('  and its own grades', made.pos.join() === 'Final year student,Repeat candidate',
  made.pos.join(', '));

/* ---------------------------------------------------------------- */
sec('4. AND NOW THE FORM ANSWERS THE COMPLAINT');

await signedOutAuth();
await page.click('#auth-toggle'); await page.waitForTimeout(500);
const form = await page.evaluate(() => ({
  radios: [...document.querySelectorAll('#auth-course input')].map(r => r.value),
  pos: [...document.querySelectorAll('#auth-position option')].map(o => o.value),
  posDisabled: document.querySelector('#auth-position')?.disabled,
  /* The course is asked BEFORE the grade, because the grade depends on it. */
  courseFirst: document.querySelector('#auth-course')?.compareDocumentPosition(
    document.querySelector('#auth-position')) === Node.DOCUMENT_POSITION_FOLLOWING
}));
say('a second open course puts the question on the form', form.radios.length === 2,
  form.radios.join(', '));
say('  the course is asked before the grade', form.courseFirst);
/* UNTIL A COURSE IS CHOSEN THERE IS NO TRUE ANSWER, so none is offered.
   Showing the first course's grades to somebody who has not chosen is how
   a final MBBS student ends up a registrar — the original complaint. */
say('  and no grade is guessed before the course is chosen',
  form.posDisabled === true && form.pos.join() === '', JSON.stringify(form.pos));

await page.click('#auth-course input[value="mbbs-final"]'); await page.waitForTimeout(400);
const undergrad = await posOptions();
say('choosing final MBBS offers a student’s grades, not a registrar’s',
  undergrad.join() === 'Final year student,Repeat candidate', undergrad.join(', '));
await page.click('#auth-course input[value="pgim-og-2"]'); await page.waitForTimeout(400);
const pg = await posOptions();
say('  and choosing O&G Part 2 offers its two, unchanged', pg.join() === 'Registrar,Senior Registrar',
  pg.join(', '));

/* Sign up as the person who complained, and check the whole way through. */
await page.click('#auth-course input[value="mbbs-final"]'); await page.waitForTimeout(300);
await page.selectOption('#auth-position', 'Final year student');
await page.fill('input[name=name]', 'Kavindu Silva');
await page.fill('input[name=email]', 'kavindu@example.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1800);
const landed = await page.evaluate(async () => {
  await Course.load(true);
  const u = await Backend.currentUser();
  return { course: Course.currentId(), position: u?.position, greeting: document.body.textContent.includes('Final year student') };
});
say('the account lands on the course it chose', landed.course === 'mbbs-final', landed.course);
say('  keeping the grade it chose', landed.position === 'Final year student', landed.position);

/* And the profile agrees — it used to say "your training grade for the
   PGIM programme" to everybody, including people on no PGIM course. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/profile', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1900);
const prof = await page.evaluate(() => ({
  grades: [...document.querySelectorAll('.pos-btn')].map(b => b.textContent.trim()),
  copy: document.querySelector('.card-title')?.parentElement?.textContent.replace(/\s+/g, ' ') || ''
}));
say('the profile offers the same grades', prof.grades.join() === 'Final year student,Repeat candidate',
  prof.grades.join(', '));
say('  and no longer tells an undergraduate they are on the PGIM programme',
  !/PGIM programme/.test(prof.copy) && /Final MBBS/.test(prof.copy), prof.copy.slice(0, 70));

/* ---------------------------------------------------------------- */
sec('5. ENROLMENT IS STILL NOT ENTITLEMENT');

/* The candidate enrolled themselves by choosing on the form — which is
   their own business — and that must not have opened anything paid. */
await page.evaluate(async () => {
  await Backend.signOut(); await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS — Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null,
    subjects: ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry'],
    positions: ['Final year student', 'Repeat candidate'], sort: 5, isLive: true, isFree: false });
});
const gate = await page.evaluate(async () => {
  const before = (await Backend.listAllUsers()).find(u => u.email === 'kavindu@example.com');
  const was = (before.enrolments || []).find(e => e.trackId === 'mbbs-final')?.status;
  await Backend.grantEnrolment(before.id, 'mbbs-final', 'active', null);
  const after = (await Backend.listAllUsers()).find(u => u.email === 'kavindu@example.com');
  return { was, now: (after.enrolments || []).find(e => e.trackId === 'mbbs-final')?.status };
});
say('choosing a course on the form is a TRIAL, not access', gate.was === 'trial', gate.was);
/* The console is the only place that can change it, and only an admin. */
say('  and an admin can open it from the console', gate.now === 'active',
  gate.was + ' → ' + gate.now);
/* listAllUsers has to carry the enrolments or the console draws every
   course's row unset and silently offers to overwrite it. */
say('  the console reads the real state, not a blank', gate.was !== undefined);

const notAdmin = await page.evaluate(async () => {
  await Backend.signOut(); await Backend.signIn('kavindu@example.com', 'password123');
  let err = null;
  try { await Backend.grantEnrolment('kavindu@example.com', 'mbbs-final', 'active', null); }
  catch (e) { err = e.message; }
  return err;
});
say('a candidate cannot grant themselves the paid course', /only an admin/i.test(notAdmin || ''),
  notAdmin);

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
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
