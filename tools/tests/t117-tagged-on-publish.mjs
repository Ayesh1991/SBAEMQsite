/* t117 — the other half of a fail-closed rule.

   WHAT WAS WRONG. v115 gave every content table a `tracks` column and
   made reading a decision: `is_preview or can_read_tracks(tracks)`, where
   an empty `tracks` passes only for an editor. That choice was argued for
   on sound grounds — an untagged station shown to everybody is a station
   leaking out of a paid bank — and on the promise that it fails LOUDLY,
   because "an editor still sees the row and the console can say it is
   filed nowhere".

   NEITHER HALF OF THAT PROMISE EXISTED. Nothing in AUREUM ever wrote the
   column: every publish path upserted `{ id, meta }` and the column kept
   its default of `'{}'`. So the moment the schema ran, every newly
   published paper, station, deck, essay paper, volume and case would have
   been visible to its author and to nobody else — failing closed, on all
   new content, in complete silence. And nothing anywhere said "filed
   nowhere", so the loudness that justified the choice was not built
   either.

   v117 does not reverse the rule, because the rule is right. It builds
   the two things that make it true:

     · THE WRITER. contentTags() runs on every publish path in BOTH
       backends, so content cannot be created untagged by forgetting
       anything. An existing tag is never overwritten — an admin fixing
       somebody else's paediatrics station while enrolled in O&G must not
       quietly move it into their own course.

     · THE LOUDNESS. listUntagged() finds every row no candidate can see
       and fileUnder() files it in one action, surfaced in the developer
       console as a panel that appears ONLY when there is something in it.

   AND ONE THING THAT IS NOT COURSE CONTENT. `curriculum` holds a single
   row, id = 'default'. v115 tagged it 'pgim-og-2' with everything else,
   which would leave a candidate on any other course reading no syllabus
   at all. It is `is_preview` instead — readable whatever the entitlement
   — until curricula are keyed by course, which is its own change. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. EVERY PUBLISH PATH WRITES THE COLUMN');

const js = readFileSync('js/backend.js', 'utf8');
say('there is one rule for it, not one per table',
  (js.match(/async function contentTags\(rec\)/g) || []).length === 1);
/* Six tables carry content a candidate reads. Every one of their publish
   paths must stamp, in BOTH backends — twelve call sites. A path that
   forgets is a table whose new rows go dark. */
const PATHS = ['publishPaper', 'publishOsceStation', 'publishCase',
  'publishFlashcardDeck', 'publishEssayPaper', 'publishCpdVolume'];
const stamped = PATHS.filter(fn => {
  const re = new RegExp('async function ' + fn + '\\([^)]*\\)[\\s\\S]{0,700}?contentTags', 'g');
  return (js.match(re) || []).length === 2;      // local AND cloud
});
say('  and all six publish paths apply it, in both backends',
  stamped.length === 6, stamped.length + ' of 6: ' + PATHS.filter(p => !stamped.includes(p)).join(', '));
/* The cloud has to write COLUMNS, not another key inside meta — a policy
   cannot read jsonb it has no index on. */
say('  the cloud writes them as columns beside meta',
  (js.match(/Object\.assign\(\{ id: \w+\.id, meta(: \w+)? \}, await contentTags\(\w+\)\)/g) || []).length >= 4);

/* THE LOUD HALF. */
say('an editor can list what nobody can see',
  (js.match(/async function listUntagged\(/g) || []).length === 2);
say('  and file it in one action', (js.match(/async function fileUnder\(/g) || []).length === 2);
say('  both exported from both backends',
  (js.match(/canReadTracks, listUntagged, fileUnder,/g) || []).length === 2);

/* THE SYLLABUS. */
const sql = readFileSync('supabase/schema.sql', 'utf8');
say('the syllabus is no longer tagged to one course',
  !/update public\.curriculum set tracks = '\{pgim-og-2\}'/.test(sql));
say('  it is readable whatever the entitlement',
  /update public\.curriculum set is_preview = true/.test(sql));
/* The key became the COURSE id in v119 — the assertion is that every
   curriculum write still carries is_preview, not that there is one row. */
say('  and an edit cannot undo that',
  /curriculum'\)\.upsert\(\{ id: trackId \|\| 'default', data, is_preview: true/.test(js));
/* The policy itself is UNCHANGED. The rule was right; what was missing
   was everything that made it true. */
say('the read policy still fails closed on untagged content',
  (sql.match(/using \(is_preview or public\.can_read_tracks\(tracks\)\)/g) || []).length === 7,
  (sql.match(/using \(is_preview or public\.can_read_tracks\(tracks\)\)/g) || []).length + ' policies');

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING APP');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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

await fresh('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');

/* THE BUG, IN ONE ASSERTION. Publish a station the way the app publishes
   one — nothing about courses mentioned anywhere — and see what comes
   back out. Before v117 `tracks` was absent and the row was readable by
   its author alone. */
const published = await page.evaluate(async () => {
  await Course.load(true);
  const st = {
    id: 't117-plain', topic: 'Cord prolapse', scenario: 'A scenario.',
    station_time_min: 15,
    questions: [{ prompt: 'Manage this.', marking_points: [{ text: 'Call for help', marks: 1 }] }]
  };
  const back = await Backend.publishOsceStation(st);
  return { tracks: back.tracks, subject: back.subject, on: Course.currentId() };
});
say('a station published with no mention of courses is tagged anyway',
  (published.tracks || []).join() === 'pgim-og-2', JSON.stringify(published.tracks));
/* A one-speciality course answers `subject` by itself. A five-subject
   course cannot, and guessing would be worse than leaving it unset: a
   wrong subject hides the station from the right chip. */
say('  and takes its subject from the course’s speciality',
  published.subject === 'obgyn', published.subject);
say('  which is the course the editor is on', published.on === 'pgim-og-2');

/* AND EVERY OTHER KIND OF CONTENT, not just the one I happened to test. */
const everyKind = await page.evaluate(async () => {
  const out = {};
  out.paper = (await Backend.publishPaper({ id: 't117-p', title: 'A paper', sba: 1, emq: 0, content: {} })).tracks;
  out.deck = (await Backend.publishFlashcardDeck({ id: 't117-d', title: 'A deck', cards: [] })).tracks;
  out.essay = (await Backend.publishEssayPaper({ id: 't117-e', title: 'An essay paper', questions: [] })).tracks;
  out.cpd = (await Backend.publishCpdVolume({ id: 't117-c', title: 'A volume', sections: [] })).tracks;
  out.kase = (await Backend.publishCase({ id: 't117-k', title: 'A case', phases: [], questions: [] })).tracks;
  return out;
});
const kinds = Object.keys(everyKind).filter(k => (everyKind[k] || []).join() === 'pgim-og-2');
say('every kind of content is stamped, not just stations', kinds.length === 5,
  kinds.length + ' of 5: ' + JSON.stringify(everyKind));

/* ---------------------------------------------------------------- */
sec('3. AN EXISTING TAG IS NEVER TAKEN BACK');

const respected = await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS — Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null,
    subjects: ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry'],
    sort: 5, isLive: true, isFree: true });
  await Course.load(true);
  /* An admin on O&G, correcting a paediatrics station somebody else wrote.
     The explicit tag has to survive the save, or one editor's housekeeping
     silently moves another's work into their own course. */
  const back = await Backend.publishOsceStation({
    id: 't117-paeds', topic: 'Febrile convulsion', scenario: 'A scenario.',
    tracks: ['mbbs-final'], subject: 'paediatrics',
    questions: [{ prompt: 'Assess.', marking_points: [{ text: 'ABC', marks: 1 }] }]
  });
  return { tracks: back.tracks, subject: back.subject, editorOn: Course.currentId() };
});
say('an explicit course survives a save by an editor on another course',
  (respected.tracks || []).join() === 'mbbs-final',
  JSON.stringify(respected.tracks) + ' (editor is on ' + respected.editorOn + ')');
say('  and so does its subject', respected.subject === 'paediatrics', respected.subject);
/* A five-subject course cannot guess, so it must NOT. */
const noGuess = await page.evaluate(async () => {
  await Course.choose('mbbs-final');
  const back = await Backend.publishOsceStation({
    id: 't117-noguess', topic: 'Chest pain', scenario: 'A scenario.',
    questions: [{ prompt: 'Assess.', marking_points: [{ text: 'ECG', marks: 1 }] }]
  });
  await Course.choose('pgim-og-2');
  return { tracks: back.tracks, subject: back.subject };
});
say('a five-subject course still tags the course', (noGuess.tracks || []).join() === 'mbbs-final',
  JSON.stringify(noGuess.tracks));
say('  but does not invent a subject out of five', !noGuess.subject, String(noGuess.subject));

/* ---------------------------------------------------------------- */
sec('4. AND THE STRAYS ALREADY THERE CAN BE FOUND');

/* Rows that reached the database untagged — published between the schema
   running and this release, or written by hand. They are invisible to
   every candidate, so somebody has to be told. */
const strays = await page.evaluate(async () => {
  const raw = JSON.parse(localStorage.getItem('aureum.oscestations') || '[]');
  raw.push({ id: 't117-stray', topic: 'Shoulder dystocia', scenario: 'x', tracks: [], questions: [] });
  localStorage.setItem('aureum.oscestations', JSON.stringify(raw));
  const p = JSON.parse(localStorage.getItem('aureum.published') || '[]');
  p.push({ id: 't117-strayp', title: 'An orphan paper', tracks: [] });
  localStorage.setItem('aureum.published', JSON.stringify(p));
  return (await Backend.listUntagged()).map(r => r.table + ':' + r.id);
});
say('an editor can find every row no candidate can see',
  strays.includes('osce_stations:t117-stray') && strays.includes('papers:t117-strayp'),
  strays.join(', '));
say('  and nothing that IS tagged is in the list',
  !strays.some(s => /t117-plain|t117-paeds/.test(s)), strays.length + ' listed');

const filed = await page.evaluate(async () => {
  const n = await Backend.fileUnder('osce_stations', ['t117-stray'], ['pgim-og-2'], 'obgyn');
  const left = (await Backend.listUntagged()).map(r => r.table + ':' + r.id);
  let refused = null;
  try { await Backend.fileUnder('osce_stations', ['t117-strayp'], [], null); } catch (e) { refused = e.message; }
  return { n, left, refused };
});
say('filing them under a course works', filed.n === 1, filed.n + ' filed');
say('  and takes them off the list', !filed.left.includes('osce_stations:t117-stray'),
  filed.left.join(', '));
/* Filing under nothing is not filing. Accepting it would write '{}' back
   and quietly report success on content still invisible to everybody. */
say('  while filing under no course at all is refused',
  /at least one course/i.test(filed.refused || ''), filed.refused);

/* A student must not be able to move content between courses. */
const studentTry = await page.evaluate(async () => {
  await Backend.signOut();
  await Backend.signUp({ name: 'Kavindu Silva', email: 'kavindu@example.com', password: 'password123' });
  let list = null, file = null;
  try { await Backend.listUntagged(); } catch (e) { list = e.message; }
  try { await Backend.fileUnder('papers', ['t117-strayp'], ['mbbs-final'], null); } catch (e) { file = e.message; }
  return { list, file };
});
say('a candidate cannot go looking for other people’s unpublished work',
  /only an editor/i.test(studentTry.list || ''), studentTry.list);
say('  nor move content between courses', /only an editor/i.test(studentTry.file || ''),
  studentTry.file);

/* ---------------------------------------------------------------- */
sec('5. AND THE CONSOLE SAYS SO');

/* The panel is what makes fail-closed honest, and it is drawn ONLY when
   there is something in it — a permanent "0 items" panel is furniture,
   and furniture stops being read. */
await page.evaluate(async () => {
  await Backend.signOut(); await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  /* The console sits behind a passkey asked once per session
     (ensureDevKey in app.js), which a test cannot type — it is verified
     against a Cloudflare secret. Satisfying the gate is not what this
     section is measuring, so it is marked as already satisfied. */
  sessionStorage.setItem('aureum-passkey', '1');
});
await page.goto(B + '/index.html#/dev', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const panel = await page.evaluate(() => {
  const p = document.querySelector('.dev-unfiled');
  return { there: !!p, text: p?.textContent.replace(/\s+/g, ' ').trim() || '',
    options: [...document.querySelectorAll('#unfiled-track option')].map(o => o.value) };
});
say('the console warns about content filed nowhere', panel.there,
  panel.text.slice(0, 80));
say('  naming the number', /1 item filed under no course/.test(panel.text), panel.text.slice(0, 60));
say('  and offering every open course to file it under',
  panel.options.length === 2, panel.options.join(', '));

await page.click('#unfiled-go');
await page.waitForTimeout(1800);
const cleared = await page.evaluate(async () => ({
  left: (await Backend.listUntagged()).length,
  panel: !!document.querySelector('.dev-unfiled')
}));
say('filing from the console clears the strays', cleared.left === 0, cleared.left + ' left');
say('  and the warning goes away, because there is nothing to warn about', !cleared.panel);

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
