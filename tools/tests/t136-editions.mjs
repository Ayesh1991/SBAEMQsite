/* t136 — a second edition, and archiving that keeps the history.

   THE O&G PART 2 BANK HOLDS 8000+ QUESTIONS written before the review
   flow existed. They are being re-made from the sources, reviewed, and
   published alongside — and the old ones have to stay sittable until
   their replacement is ready, or the bank empties for a year while the
   work is done.

   EDITION IS NOT review_status. That column answers "has a human checked
   this"; this one answers "which generation is it". A second-edition
   paper still goes draft → in_review → published, and most of the new
   work sits at "2nd edition, not yet reviewed" for months — a state one
   column could not express.

   NEWEST PER TOPIC, NOT A SWITCH. A global "2nd edition" toggle would
   hide every topic nobody has re-made yet, which is most of them for
   most of the year. §2 is the rule: a topic improves the day its
   replacement is live and nothing else moves.

   §3 IS WHY ARCHIVING IS NOT DELETING. unpublishPaper() removes the row,
   and js/review.js and the simulator both load the paper to render the
   questions of an attempt somebody already sat. Deleting the old bank
   would keep every mark and destroy every candidate's ability to see
   what they answered. An archived row stays readable; what changes is
   whether it is offered.

   §5 IS A BUG THIS RELEASE FOUND IN THE LAST ONE. v132 put a move button
   on all five published lists and wired four. The OSCE list rendered it
   and listened for nothing. t132 asserted the button EXISTS and drove a
   deck to prove moving works — which is exactly the hole left by testing
   markup instead of behaviour. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE MIGRATION MAKES WHAT EXISTS THE FIRST EDITION');

const sql = readFileSync('supabase/schema.sql', 'utf8');
const be = readFileSync('js/backend.js', 'utf8');
const co = readFileSync('js/course.js', 'utf8');

/* v123'S SHAPE: add with the default the EXISTING rows need, then move
   the default for the new ones. Either half alone is wrong. */
say('every paper that already exists becomes the 1st edition',
  /alter table public\.papers\s+add column if not exists edition integer not null default 1;/.test(sql));
say('  and everything imported from now on is the 2nd',
  /alter table public\.papers\s+alter column edition set default 2;/.test(sql));
say('  with OSCE stations treated the same way',
  /alter table public\.osce_stations\s+add column if not exists edition integer not null default 1;/.test(sql)
  && /alter table public\.osce_stations\s+alter column edition set default 2;/.test(sql));
/* A timestamp, not a status and not a delete. */
say('archiving is a timestamp on the row',
  /add column if not exists archived_at timestamptz/.test(sql));
say('  and only an editor may set it',
  /create or replace function public\.protect_edition\(\)/.test(sql)
  && /not public\.is_editor\(\)/.test(sql));
/* The read policies are untouched: an archived row is still readable,
   which is the entire point of archiving rather than deleting. The
   comment is asserted on because it is the only place that reasoning
   lives, and a future release will be tempted to "tidy up" by adding
   `archived_at is null` to a read policy — which would take every past
   attempt's questions with it. */
const prose = sql.replace(/^\s*--/gm, '').replace(/\s+/g, ' ');
say('  while nothing narrows what may be READ',
  /archived row stays readable for exactly that reason/.test(prose)
  && !/create policy[\s\S]*archived_at is null/.test(sql));

say('both backends can set an edition and archive',
  (be.match(/async function setEdition\(/g) || []).length === 2
  && (be.match(/async function setArchived\(/g) || []).length === 2);
/* RULE 2: a function on one backend and not the other works in testing
   and throws in production, or the reverse. */
say('  and both export them', (be.match(/setEdition, setArchived/g) || []).length === 2);
/* The rule lives in one module, not copied into each of the five banks. */
say('one definition of "the newest edition of each thing"',
  /function newestEdition\(rows, keyOf, earlier\)/.test(co)
  && /newestEdition, hasEarlier/.test(co));
/* THE BUG THAT HAS NOW BEEN MADE FIVE TIMES: a filter cannot filter on
   what the read never returned. */
say('and every read brings the two new columns back',
  (be.match(/edition,archivedAt:archived_at/g) || []).length === 2
  && (be.match(/edition,archived_at/g) || []).length === 2);
say('  including the degraded fallback reads',
  (be.match(/edition: r\.edition \|\| 1, archivedAt: r\.archived_at \|\| null/g) || []).length === 2);

/* ---------------------------------------------------------------- */
sec('2. A TOPIC IMPROVES WHEN ITS REPLACEMENT IS LIVE, AND NOTHING ELSE MOVES');

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

const bank = await page.evaluate(async () => {
  /* FIXTURE TOPICS ARE NAMESPACED. The first draft of this test used
     't-pph', which is a REAL topic in data/manifest.json — so the
     bundled PPH paper became a genuine earlier edition of the fixture
     and §3 failed, correctly. §2b now asserts that on purpose instead
     of colliding with it by accident. */
  const mk = (id, title, topicId, edition) => ({ id, title, categoryId: 'obstetrics',
    sectionId: 'obs-antenatal', topicId, sba: 1, emq: 0, tf: 0, tracks: ['pgim-og-2'], edition,
    content: { topic: title, sba: [{ stem: 's', options: ['a', 'b'], answer: 0 }] } });
  await Backend.publishPaper(mk('p-old', 'PPH 1st edition', 't136-pph', 1));
  await Backend.publishPaper(mk('p-new', 'PPH 2nd edition', 't136-pph', 2));
  /* The topic nobody has re-made yet — most of the bank, for most of
     the year. It must not vanish. */
  await Backend.publishPaper(mk('p-only', 'Eclampsia, still 1st edition', 't136-ecl', 1));
  Data.bustPapers?.();
  const ours = l => l.filter(p => /edition/.test(p.title)).map(p => p.id).sort().join(',');
  return { newest: ours(await Data.myPapers()), earlier: ours(await Data.myPapers(true)),
    offersEarlier: await Data.hasEarlierPapers() };
});
say('a re-made topic shows only its newest edition',
  bank.newest === 'p-new,p-only', bank.newest);
/* THE WHOLE REASON IT IS PER TOPIC. */
say('  and a topic nobody has touched keeps its first edition', bank.newest.includes('p-only'));
say('the earlier questions are still there for anyone who wants them',
  bank.earlier === 'p-new,p-old,p-only', bank.earlier);
say('  and the bank knows to offer them', bank.offersEarlier);

await page.goto(B + '/index.html?r=' + Math.random() + '#/library', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
const link = await page.evaluate(() => (document.querySelector('.lib-earlier')?.textContent || '').replace(/\s+/g, ' ').trim());
/* A LINK, NOT A TAB. A candidate should not have to decide which
   generation of the content to trust. */
say('the library offers them in one quiet line', /Also show the earlier questions/.test(link), link.slice(0, 80));
const toggled = await page.evaluate(async () => {
  document.querySelector('#lib-earlier')?.click();
  await new Promise(r => setTimeout(r, 1800));
  return (document.querySelector('.lib-earlier')?.textContent || '').replace(/\s+/g, ' ').trim();
});
say('  and says so when they are showing', /Showing earlier editions/.test(toggled), toggled.slice(0, 60));

/* ---------------------------------------------------------------- */
sec('2b. AND IT SUPERSEDES THE BANK THAT IS ACTUALLY SHIPPED');

/* THE WHOLE POINT OF THE RELEASE, against a real paper rather than a
   fixture: data/manifest.json ships p-postpartum-haemorrhage on topic
   t-pph. Publish a 2nd edition of THAT topic and the bundled paper
   stands down — which is what re-making 8000 questions will do, one
   topic at a time, to papers nobody wrote a fixture for. */
const real = await page.evaluate(async () => {
  const before = (await Data.myPapers()).map(p => p.id);
  await Backend.publishPaper({ id: 'p-pph-2e', title: 'PPH, re-made', categoryId: 'obstetrics',
    sectionId: 'obs-antenatal', topicId: 't-pph', sba: 1, emq: 0, tf: 0,
    tracks: ['pgim-og-2'], edition: 2,
    content: { topic: 'PPH', sba: [{ stem: 's', options: ['a', 'b'], answer: 0 }] } });
  Data.bustPapers?.();
  const after = (await Data.myPapers()).map(p => p.id);
  const earlier = (await Data.myPapers(true)).map(p => p.id);
  return { hadBundled: before.includes('p-postpartum-haemorrhage'),
    stillThere: after.includes('p-postpartum-haemorrhage'),
    newOne: after.includes('p-pph-2e'),
    recoverable: earlier.includes('p-postpartum-haemorrhage'),
    count: { before: before.length, after: after.length } };
});
say('the shipped PPH paper is in the bank to begin with', real.hadBundled);
say('  publishing a 2nd edition of its topic stands it down', !real.stillThere);
say('  and puts the re-made one there instead', real.newOne);
/* Nothing was destroyed — it is one click away, and still sittable. */
say('  with the original still reachable as an earlier edition', real.recoverable);
/* A re-make REPLACES; it must not grow the bank. */
say('  and the bank is no bigger than before',
  real.count.after === real.count.before, real.count.before + ' → ' + real.count.after);

/* Put the shipped bank back, so §3 can reason about the whole bank
   rather than about what this section left lying in it. */
await page.evaluate(async () => {
  await Backend.unpublishPaper('p-pph-2e'); Data.bustPapers?.();
});
const restored = await page.evaluate(async () =>
  (await Data.myPapers()).map(p => p.id).includes('p-postpartum-haemorrhage'));
say('  and standing it down is undone by withdrawing the re-make', restored);

/* ---------------------------------------------------------------- */
sec('3. ARCHIVING STOPS IT BEING OFFERED AND KEEPS EVERYTHING ELSE');

const arch = await page.evaluate(async () => {
  await Backend.setArchived('papers', ['p-old'], true);
  Data.bustPapers?.();
  const ours = l => l.filter(p => /edition/.test(p.title)).map(p => p.id).sort().join(',');
  const out = { bank: ours(await Data.myPapers()), evenWithEarlier: ours(await Data.myPapers(true)) };
  /* THE POINT. The row survives and its questions still render, because
     review.js loads the paper to show an attempt somebody already sat. */
  out.rowKept = (await Data.publishedPapers()).some(p => p.id === 'p-old');
  try { out.readable = !!(await Data.loadPaper('p-old'))?.paper; } catch { out.readable = false; }
  out.offersEarlier = await Data.hasEarlierPapers();
  return out;
});
say('an archived paper leaves the bank', !arch.bank.includes('p-old'), arch.bank);
/* Not even the "show earlier" link brings back something archived:
   earlier is about editions, archived is about being withdrawn. */
say('  and is not brought back by showing earlier editions',
  !arch.evenWithEarlier.includes('p-old'), arch.evenWithEarlier);
say('  the row is kept, not deleted', arch.rowKept);
say('  and its questions still render for a past attempt', arch.readable);
/* With nothing older left to show, the link goes. */
say('  so the link stops offering what is no longer there', !arch.offersEarlier);

const back = await page.evaluate(async () => {
  await Backend.setArchived('papers', ['p-old'], false);
  Data.bustPapers?.();
  return (await Data.myPapers(true)).some(p => p.id === 'p-old');
});
say('and archiving can be undone', back);

/* ---------------------------------------------------------------- */
sec('4. CONTENT NOBODY FILED IS NEVER HIDDEN BY CONTENT THAT WAS');

/* The same rule as Course.fits: unfiled is not irrelevant. Two papers
   with no topicId are not two editions of one thing. */
const unfiled = await page.evaluate(() => {
  const rows = [{ id: 'x', edition: 1 }, { id: 'y', edition: 2 },
    { id: 'z', topicId: 't', edition: 1 }, { id: 'w', topicId: 't', edition: 2 }];
  return Course.newestEdition(rows, r => r.topicId, false).map(r => r.id).sort().join(',');
});
say('two papers with no topic are each their own thing',
  unfiled === 'w,x,y', unfiled);

/* ---------------------------------------------------------------- */
sec('5. AND THE OSCE MOVE BUTTON IS WIRED AT LAST');

const dev = readFileSync('js/dev-console.js', 'utf8');
const osceFn = dev.slice(dev.indexOf('async function refreshOscePublished'),
  dev.indexOf('async function refreshOscePublished') + 3000);
/* v132 rendered this button here and wired four other lists. */
say('the OSCE list listens for its own move button',
  /querySelectorAll\('\[data-move\]'\)/.test(osceFn));
say('  and for archive', /wireArchive\(view, host, 'osce'\)/.test(osceFn));
say('the papers list shows which edition each row is',
  /<th>Edition<\/th>/.test(dev) && /function edCell\(rec\)/.test(dev));
say('  and offers archive beside unpublish',
  /data-arch-table="papers"/.test(dev) && /data-arch-table="osce_stations"/.test(dev));
/* Archiving is the safe one and unpublishing is not; the dialog has to
   say which is which. */
say('  saying plainly that nothing is deleted',
  /Nothing is deleted — every mark, note and past attempt stays readable/.test(dev));
say('the importers can say which edition they are loading',
  /const editionField = id =>/.test(dev) && /#pp-import-edition/.test(dev) && /#os-import-edition/.test(dev));

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v136/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '136', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
