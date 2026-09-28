/* t115 — Phase 0, step 2: tracks and enrolments.
   Nothing user-visible. The data layer the platform grows on.

   THREE FACTS ABOUT A PIECE OF CONTENT, all true at once, and keeping
   them apart is most of the design:

     track      which exam is this for        pgim-og-2
     subject    which speciality is it about  obgyn
     collection where did it come from        PERA OSCE

   THE ASYMMETRY THAT SHAPES IT. A final MBBS candidate sits ONE exam
   covering FIVE subjects; a Part 2 candidate sits one exam in one
   speciality. So a person enrols in a TRACK and `subject` filters within
   it — a filter for the undergraduate, a no-op for everyone else.

   AND THE ONE THAT MATTERS MOST: ENROLMENT IS NOT ENTITLEMENT.
   Choosing a course is the candidate's own business — they say what they
   are studying. Being allowed to READ that course's content is not, or
   anybody could self-enrol into every speciality and have the lot. A
   candidate creates TRIAL rows; 'active' is granted by payment or an
   admin, and a trigger stops it being claimed. That is the same lesson
   the role column taught in v114, applied before it could bite.

   SAFETY. The one track that exists is seeded FREE, so the machinery is
   live from the moment the schema runs and nothing is behind it until a
   paid track is deliberately added. Shipping the mechanism and flipping
   the switch are two decisions and should not happen on one day. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. WHAT THE SCHEMA SAYS');

const sql = readFileSync('supabase/schema.sql', 'utf8');
say('there is a tracks table, and an enrolments table',
  /create table if not exists public\.tracks/.test(sql) && /create table if not exists public\.enrolments/.test(sql));
/* A track can be filled with content long before anybody may choose it —
   which is how a new speciality is prepared without a half-empty bank
   appearing in front of students. */
say('  a track can be built before it is opened', /is_live\s+boolean not null default false/.test(sql));
say('  and one primary course per person, as a constraint not a hope',
  /create unique index enrolments_one_primary on public\.enrolments \(user_id\) where is_primary/.test(sql));

/* THE SEPARATION. A candidate may create the row; they may not create it
   already paid for. Same shape as the top-up policy above it. */
const ins = sql.slice(sql.indexOf('create policy "enrolments own insert"'), sql.indexOf('create policy "enrolments own update"'));
say('a candidate may enrol themselves — on TRIAL only',
  /status = 'trial'/.test(ins) && /auth\.uid\(\) = user_id/.test(ins));
say('  and only in a course that is actually open', /t\.is_live/.test(ins));
const trig = sql.slice(sql.indexOf('function public.protect_enrolment()'));
say('  and cannot upgrade their own to active',
  /if new\.status is distinct from old\.status then new\.status := old\.status; end if;/.test(trig));
say('  nor extend their own expiry', /new\.valid_until := old\.valid_until/.test(trig));

/* Reading stopped being `using (true)` on every content table. */
const gated = (sql.match(/using \(is_preview or public\.can_read_tracks\(tracks\)\)/g) || []).length;
say('every content table now decides who may read it', gated === 7, gated + ' of 7');
say('  editors can read everything — they cannot correct what they cannot see',
  /select public\.is_editor\(\)/.test(sql.slice(sql.indexOf('function public.can_read_tracks'))));
say('  a free track is readable by anyone signed in',
  /k\.id = any\(t\) and k\.is_free/.test(sql));
say('  and a preview is readable whatever the entitlement',
  /add column if not exists is_preview/.test(sql));

/* THE MIGRATION. Everyone already here keeps exactly what they had. */
say('the first track is seeded, live AND FREE, so today changes for nobody',
  /* Anchored on the two flags, not on the end of the line: v118 added a
     `positions` column after them, and a regex that insists on the closing
     bracket is asserting the column list, not the thing it cares about. */
  /'pg-exit', 'obgyn', 10, true, true/.test(sql));
say('  every existing account is enrolled in it, active',
  /select id, 'pgim-og-2', true, 'active' from public\.profiles/.test(sql));
/* SIX of the seven content tables, not all seven. `curriculum` holds one
   global row and was tagged here too, which v117 removed: a syllabus
   tagged to one course leaves a candidate on every other course reading
   no syllabus at all. It is `is_preview` instead — readable whatever the
   entitlement — so this file checks both halves rather than a count that
   would hide the exception. */
say('  and every existing row of content is tagged with it',
  (sql.match(/set tracks = '\{pgim-og-2\}', subject = 'obgyn'/g) || []).length === 6);
say('  except the syllabus, which belongs to no single course',
  /update public\.curriculum set is_preview = true/.test(sql)
  && !/update public\.curriculum set tracks/.test(sql));

/* ---------------------------------------------------------------- */
sec('2. THE TWO BACKENDS STILL AGREE');

const js = readFileSync('js/backend.js', 'utf8');
const names = ['listTracks', 'saveTrack', 'myEnrolments', 'enrol', 'setPrimaryTrack', 'grantEnrolment', 'canReadTracks'];
const both = names.filter(n => (js.match(new RegExp('async function ' + n + '\\b', 'g')) || []).length === 2);
say('every new call exists in BOTH backends', both.length === names.length,
  both.length + ' of ' + names.length);
say('  and both export them', (js.match(/listTracks, saveTrack, myEnrolments/g) || []).length === 2);

/* ---------------------------------------------------------------- */
sec('3. IN THE RUNNING APP');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

const fresh = async (name, email) => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(async () => { try { await Backend.signOut(); } catch {} });
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.click('#auth-toggle'); await page.waitForTimeout(250);
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1500);
};

await fresh('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');
const seeded = await page.evaluate(async () => {
  const t = await Backend.listTracks();
  /* AN ACCOUNT THAT PREDATES ALL OF THIS. The eight people already using
     AUREUM have no enrolment row, because there was nothing to have one
     in — and they must lose nothing. The cloud does this once, in the
     schema; locally the absence of the key is the same signal, so
     removing it is exactly how one of those accounts looks. */
  localStorage.removeItem('aureum.enrolments:ayeshmantha@gmail.com');
  const old = await Backend.myEnrolments();
  return { tracks: t.map(x => x.id), first: t[0], old };
});
say('the one track that exists is there', seeded.tracks.join() === 'pgim-og-2', seeded.tracks.join(', '));
say('  open, and free', seeded.first.isLive && seeded.first.isFree);
say('  and an account that predates courses is migrated onto it, active and primary',
  seeded.old.length === 1 && seeded.old[0].status === 'active' && seeded.old[0].isPrimary,
  JSON.stringify(seeded.old[0]));
/* AND A BRAND-NEW ACCOUNT IS NOT MIGRATED, which is the other half of the
   same rule: it predates nothing, so handing it an ACTIVE entitlement
   would be giving away a course it never paid for. v116 writes it an
   empty list at sign-up to say so. */
await fresh('Dr Sanduni Rathnayake', 'sanduni@example.com');
const brandNew = await page.evaluate(async () => await Backend.myEnrolments());
say('  while a brand-new account is enrolled on trial, not migrated to active',
  brandNew.length === 1 && brandNew[0].status === 'trial',
  JSON.stringify(brandNew[0]));

/* A second track, built but not yet opened — the phased plan in one row. */
const built = await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null,
    subjects: ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry'],
    sort: 5, isLive: false, isFree: false });
  await Backend.saveTrack({ id: 'pgim-med-1', name: 'PGIM MD (Medicine) — Part 1',
    short: 'Medicine Part 1', stage: 'pg-entry', speciality: 'medicine',
    subjects: [], sort: 20, isLive: true, isFree: false });
  const t = await Backend.listTracks();
  return { ids: t.map(x => x.id), mbbs: t.find(x => x.id === 'mbbs-final') };
});
say('a new course can be created', built.ids.includes('mbbs-final') && built.ids.includes('pgim-med-1'),
  built.ids.join(', '));
say('  carrying its five subjects', built.mbbs.subjects.length === 5, built.mbbs.subjects.join(', '));
say('  and built without being open', built.mbbs.isLive === false);

/* ---------------------------------------------------------------- */
sec('4. ENROLMENT IS NOT ENTITLEMENT');

await fresh('Dr Nimal Perera', 'nimal@example.com');
const student = await page.evaluate(async () => {
  /* A course that is built but not open cannot be joined. */
  let shut = null;
  try { await Backend.enrol('mbbs-final'); } catch (e) { shut = e.message; }
  /* One that IS open can be — on trial. */
  await Backend.enrol('pgim-med-1');
  await Backend.setPrimaryTrack('pgim-med-1');
  const mine = await Backend.myEnrolments();
  const med = mine.find(e => e.trackId === 'pgim-med-1');
  return { shut, status: med?.status, primary: med?.isPrimary,
    primaries: mine.filter(e => e.isPrimary).length };
});
say('a course that is not open yet cannot be joined', /not open/.test(student.shut || ''), student.shut);
/* THE POINT. Choosing is free; access is not. */
say('a candidate enrols themselves on TRIAL, never active',
  student.status === 'trial', student.status);
say('  and it becomes their primary course', student.primary);
say('  with exactly one primary, still', student.primaries === 1, student.primaries + ' primary');

/* THE READ GATE. A paid track they are only trialling is not theirs. */
const gatedRead = await page.evaluate(async () => ({
  paid: await Backend.canReadTracks(['pgim-med-1']),
  free: await Backend.canReadTracks(['pgim-og-2'])
}));
say('a trial does NOT open the paid course’s content', gatedRead.paid === false);
say('  while the free course stays readable by anyone signed in', gatedRead.free === true);

/* ---------------------------------------------------------------- */
sec('5. AND NOBODY GRANTS THEMSELVES A COURSE');

const selfGrant = await page.evaluate(async () => {
  let err = null;
  try { await Backend.grantEnrolment('nimal@example.com', 'pgim-med-1', 'active'); }
  catch (e) { err = e.message; }
  const mine = await Backend.myEnrolments();
  return { err, status: mine.find(e => e.trackId === 'pgim-med-1')?.status,
    canRead: await Backend.canReadTracks(['pgim-med-1']) };
});
say('a candidate cannot grant themselves paid access', /admin/i.test(selfGrant.err || ''), selfGrant.err);
say('  the trial stands', selfGrant.status === 'trial', selfGrant.status);
say('  and the content stays shut', selfGrant.canRead === false);

/* An admin can, and then it opens. Signing IN, not up — the owner's
   account already exists by this point in the file. */
const signInAs = async email => {
  await page.evaluate(async () => { try { await Backend.signOut(); } catch {} });
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(async e => { await Backend.signIn(e, 'password123'); }, email);
};
await signInAs('ayeshmantha@gmail.com');
const byAdmin = await page.evaluate(async () => {
  const them = (await Backend.listAllUsers()).find(u => u.email === 'nimal@example.com');
  await Backend.grantEnrolment(them.id, 'pgim-med-1', 'active');
  return true;
});
await signInAs('nimal@example.com');
const after = await page.evaluate(async () => {
  const mine = await Backend.myEnrolments();
  return { status: mine.find(e => e.trackId === 'pgim-med-1')?.status,
    canRead: await Backend.canReadTracks(['pgim-med-1']) };
});
say('an admin can grant it', byAdmin && after.status === 'active', after.status);
say('  and then the content opens', after.canRead === true);

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  /* The literal belongs to the newest release file only — see the
     README. What this file checks is that there is exactly ONE version
     and the service worker is on it. */
  return { vs, sw: vs.length === 1 && sw.includes("'aureum-v" + vs[0] + "'") };
});
say('one version across every asset', stamp.vs.length === 1, stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
