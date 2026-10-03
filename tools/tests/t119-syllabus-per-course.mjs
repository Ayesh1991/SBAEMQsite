/* t119 — a syllabus belongs to one exam.

   THE QUESTION THAT PROMPTED IT: "how can I fill each and every course I
   create? The final MBBS O&G paper is true/false and SBA, different from
   MD Part 2. Next I might open the Part 1 entry exam — anatomy,
   physiology, pathology, microbiology, genetics."

   The honest answer was that importing content already tagged itself to
   the right course (v117) but the three things that make an exam THAT exam
   were still single-exam: the syllabus, the blueprint, and the question
   types. This release does the first, because nothing can be filed at all
   without it — a paper is filed under a topic, and until v119 there was
   one tree of topics for the whole platform and it was the O&G Part 2 one.

   WHAT THAT WOULD HAVE MEANT, and it is worse than a missing feature:

     · a final MBBS paper classified against Obstetrics and Gynaecology is
       misfiled, with no category that fits it; and

     · adding Anatomy and Physiology for a Part 1 course would have shown
       them to every Part 2 candidate as two more categories beside the ten
       they actually sit. One owner building one course would have changed
       what every other course's candidates see.

   SO THE BUNDLED FILE IS NOT THE PLATFORM'S TREE. data/syllabus.json now
   carries a `track` field naming the course it belongs to, and it is the
   base for that course alone. Every other course is built from its own row
   in the database, starting EMPTY — which is the honest state of a course
   whose syllabus nobody has written, and visibly empty rather than quietly
   full of the wrong subjects. §2 is the isolation proof and §4 is the
   empty state, and between them they are most of the point. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE BUNDLED TREE SAYS WHOSE IT IS');

const syl = JSON.parse(readFileSync('data/syllabus.json', 'utf8'));
say('data/syllabus.json names its course', syl.track === 'pgim-og-2', syl.track);
say('  and still holds the O&G tree it always did',
  syl.categories.map(c => c.id).join() === 'obstetrics,gynaecology,governance,tog,mock',
  syl.categories.length + ' categories');

const data = readFileSync('js/data.js', 'utf8');
/* The base is applied only to the course it names — and to no course at
   all, so a signed-out visitor or a deployment that has never run the
   schema still gets the library it had before courses existed. */
say('it is the base for that course and for no other',
  /key === \(bundled\.track \|\| 'pgim-og-2'\)/.test(data));
say('  and a course of its own starts from an empty tree',
  /track: key, categories: \[\] \}/.test(data));

const js = readFileSync('js/backend.js', 'utf8');
say('both backends key the stored tree by course',
  /async function getCustomCurriculum\(trackId\)/.test(js)
  && (js.match(/async function saveCustomCurriculum\(data, trackId\)/g) || []).length === 2);
/* NOTHING THE OWNER ADDED IS LOST. Whatever was in the one pre-v119 row
   was added to the one course that existed, so it becomes that course's. */
const sql = readFileSync('supabase/schema.sql', 'utf8');
say('the tree that existed becomes that course’s own',
  /select 'pgim-og-2', data, true from public\.curriculum where id = 'default'/.test(sql));
say('  and both backends read the old row as a fallback',
  /ids\.push\('default'\)/.test(js) && /read\('curriculum', null\)/.test(js));
/* A candidate who cannot read their own syllabus has a broken library, and
   somebody deciding whether to pay has to see what the course covers. */
say('a syllabus stays readable whatever the entitlement',
  /id: trackId \|\| 'default', data, is_preview: true/.test(js));

/* ---------------------------------------------------------------- */
sec('2. IN THE RUNNING APP — ONE COURSE CANNOT REACH ANOTHER’S');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
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

/* TODAY IS UNCHANGED — the one promise every release in this sequence has
   had to keep. */
const og2 = await page.evaluate(async () => (await Data.loadSyllabus(true)).categories.map(c => c.id));
say('the course that exists keeps exactly the tree it had',
  og2.join() === 'obstetrics,gynaecology,governance,tog,mock', og2.join(', '));

/* The Part 1 exam from the question: a completely different subject tree. */
const empty = await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'pgim-og-1', name: 'PGIM MD (O&G) — Part 1 (entry)',
    short: 'O&G Part 1', stage: 'pg-entry', speciality: null, subjects: [],
    positions: ['Medical Officer'], sort: 8, isLive: true, isFree: true });
  Course.bust(); await Course.load();
  return (await Data.syllabusFor('pgim-og-1', true)).categories.map(c => c.id);
});
/* THE WHOLE POINT. A new course does NOT inherit Obstetrics and
   Gynaecology — an anatomy paper has nowhere wrong to go. */
say('a brand-new course starts with no syllabus at all', empty.length === 0,
  JSON.stringify(empty));

/* ---------------------------------------------------------------- */
sec('3. AND A WHOLE TREE CAN BE PASTED');

/* Typing anatomy, physiology, pathology, microbiology and genetics three
   clicks at a time is the kind of work that does not get done. */
await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));
await page.goto(B + '/index.html#/dev/papers', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
await page.waitForTimeout(400);
const picker = await page.evaluate(() =>
  [...document.querySelectorAll('#curr-course option')].map(o => o.value));
say('the curriculum manager asks which course it is editing',
  picker.join() === 'pgim-og-1,pgim-og-2', picker.join(', '));

await page.selectOption('#curr-course', 'pgim-og-1'); await page.waitForTimeout(700);
/* "No syllabus yet" is a state, not a fault, and it has to read like one. */
say('  and says plainly when a course has none',
  /No syllabus yet/.test(await page.evaluate(() =>
    document.querySelector('#curr-course-note')?.textContent || '')));

const PART1 = { categories: [
  { title: 'Anatomy', sections: [{ title: 'Pelvic anatomy',
    topics: [{ title: 'Bony pelvis' }, { title: 'Pelvic floor' }] }] },
  { title: 'Physiology', sections: [{ title: 'Reproductive physiology', topics: [{ title: 'Menstrual cycle' }] }] },
  { title: 'Pathology', sections: [{ title: 'Neoplasia', topics: [{ title: 'Trophoblastic disease' }] }] },
  { title: 'Microbiology', sections: [{ title: 'Genital tract infection', topics: [{ title: 'Bacterial vaginosis' }] }] },
  { title: 'Genetics', sections: [{ title: 'Inheritance', topics: [{ title: 'Aneuploidy' }] }] }
] };
await page.fill('#curr-json', JSON.stringify(PART1));
await page.click('#curr-json-btn'); await page.waitForTimeout(1800);
const merged = await page.evaluate(async () => ({
  msg: document.querySelector('#curr-json-msg')?.textContent || '',
  part1: (await Data.syllabusFor('pgim-og-1', true)).categories.map(c => c.id),
  og2: (await Data.syllabusFor('pgim-og-2', true)).categories.map(c => c.id)
}));
say('a whole tree can be pasted in one go', /Merged 5 categories/.test(merged.msg), merged.msg);
say('  ids are made from the titles, so none has to be invented',
  merged.part1.join() === 'cat-anatomy,cat-physiology,cat-pathology,cat-microbiology,cat-genetics',
  merged.part1.join(', '));
/* THE ISOLATION PROOF. Building the Part 1 tree must not add a single
   category to what a Part 2 candidate sees. */
say('  and Part 2’s tree is untouched by any of it',
  merged.og2.join() === 'obstetrics,gynaecology,governance,tog,mock', merged.og2.join(', '));

/* A merge, not a replace: pasting a corrected tree over a half-built one
   must not delete the half that was right. */
await page.fill('#curr-json', JSON.stringify({ categories: [
  { title: 'Anatomy', sections: [{ title: 'Pelvic anatomy',
    topics: [{ title: 'Bony pelvis' }, { title: 'Perineum' }] }] } ] }));
await page.click('#curr-json-btn'); await page.waitForTimeout(1700);
const again = await page.evaluate(async () => {
  const t = await Data.syllabusFor('pgim-og-1', true);
  const a = t.categories.find(c => c.id === 'cat-anatomy');
  return { cats: t.categories.length, tops: a.sections[0].topics.map(x => x.id) };
});
say('pasting again adds what is new and removes nothing', again.cats === 5
  && again.tops.length === 3, again.cats + ' categories, topics: ' + again.tops.join(', '));
say('  and does not duplicate what was already there',
  new Set(again.tops).size === again.tops.length);

/* A paper is classified against the course it is imported INTO, not the
   one the editor happens to be studying for. */
const devJs = readFileSync('js/dev-console.js', 'utf8');
say('the importer classifies against the course being imported into',
  /syllabus = await ctx\.Data\.syllabusFor\(e\.target\.value, false\)/.test(devJs));
say('  and warns when that course has no syllabus to classify against',
  /has no syllabus yet — build one/.test(devJs));

/* ---------------------------------------------------------------- */
sec('4. A BLANK LIBRARY SAYS WHY IT IS BLANK');

await page.evaluate(async () => { await Course.choose('pgim-og-1'); });
await page.goto(B + '/index.html?r=' + Math.random() + '#/library', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2100);
const lib = await page.evaluate(() =>
  document.querySelector('#lib-tree')?.textContent.replace(/\s+/g, ' ').trim() || '');
/* A question bank showing a search box over nothing looks broken. This
   course HAS a syllabus and no papers, and the message says which. */
say('a course with a syllabus and no papers says so, and names itself',
  /No papers published for O&G Part 1 yet/.test(lib), lib.slice(0, 80));
say('  and says the curriculum is there', /curriculum is here/.test(lib));

/* And the other empty state: no syllabus at all. */
const noSyl = await page.evaluate(async () => {
  await Backend.saveTrack({ id: 'mbbs-final', name: 'Final MBBS — Sri Lanka', short: 'Final MBBS',
    stage: 'mbbs-final', speciality: null,
    subjects: ['medicine', 'surgery', 'paediatrics', 'obgyn', 'psychiatry'],
    positions: ['Final year student'], sort: 5, isLive: true, isFree: true });
  Course.bust(); await Course.load(); await Course.choose('mbbs-final');
  return true;
});
await page.goto(B + '/index.html?r=' + Math.random() + '#/library', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2100);
const lib2 = await page.evaluate(() =>
  document.querySelector('#lib-tree')?.textContent.replace(/\s+/g, ' ').trim() || '');
say('a course with no syllabus says that instead', /No syllabus for Final MBBS yet/.test(lib2),
  lib2.slice(0, 80));
/* NOTHING IS MISSING AND NOTHING IS LOST — said out loud, because an empty
   bank is exactly what a lost database looks like. */
say('  and says nothing has been lost', /not been built yet/.test(lib2));
say('  pointing an owner at where to build it', /Manage curriculum/.test(lib2));

/* Switching course has to change the tree — one cached tree is how the old
   behaviour would survive the whole release. */
const followed = await page.evaluate(async () => {
  const before = (await Data.loadSyllabus()).categories.length;
  await Course.choose('pgim-og-2');
  const after = (await Data.loadSyllabus()).categories.map(c => c.id);
  return { before, after };
});
say('switching course switches the syllabus with it',
  followed.before === 0 && followed.after.join() === 'obstetrics,gynaecology,governance,tog,mock',
  followed.before + ' → ' + followed.after.length);

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
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
