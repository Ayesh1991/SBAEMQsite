/* t137 — the re-make backlog: what is left, and what can be put away.

   v136 made two editions able to coexist. It did not answer the question
   an editor actually has — of 8000+ questions, how far through am I, and
   what is safe to put away. This is that page.

   §1 IS THE ONLY INTERESTING DESIGN DECISION. Progress is counted in
   QUESTIONS, not topics. The topics are wildly uneven: one holds 400
   questions and the next holds 12, so "48 of 105 topics" is a number that
   feels like progress and is not one. The fixture is built so the two
   counts disagree, and the assertion is on the question count.

   §3 IS WHY THE PAGE EXISTS AT ALL. When a 2nd edition goes live the 1st
   is superseded but STILL LIVE, so it is still offered under "also show
   the earlier questions". Nothing looks broken from any other screen —
   the candidate's bank already shows the newest — so those papers sit
   there forever unless something counts them. Every other state is
   information; this one is a job.

   §4 IS THE BUG THIS REPO HAS NOW MADE SIX TIMES. "In review" can only be
   told from "nobody has started" by reading the topic of a paper awaiting
   review, and listForReview's projection did not select it. A filter
   cannot filter on what the read never returned — v117, v121, v129, v131,
   v132, and here.

   §5 IS THE ROW THAT WOULD HAVE BEEN UNREACHABLE. A paper filed under a
   topic the syllabus no longer lists, or under no topic at all, appears in
   no topic list — so it could never be re-made, and nothing would have
   said so. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

await page.goto(B + '/index.html?r=' + Math.random() + '#/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1100);

/* ---------------------------------------------------------------- */
sec('1. COUNTED IN QUESTIONS, BECAUSE THE TOPICS ARE UNEVEN');

/* One huge untouched topic and three tiny finished ones: by topics this
   looks three-quarters done, by questions it has barely started. That
   gap is the whole reason the bar counts questions. */
const uneven = await page.evaluate(() => {
  const T = [{ id: 'big', title: 'Big' }, { id: 's1', title: 'S1' },
    { id: 's2', title: 'S2' }, { id: 's3', title: 'S3' }];
  const P = [{ id: 'b1', topicId: 'big', edition: 1, sba: 400, emq: 0, tf: 0 }];
  ['s1', 's2', 's3'].forEach((t, i) => {
    P.push({ id: t + 'a', topicId: t, edition: 1, sba: 4, emq: 0, tf: 0, archivedAt: '2026-01-01' });
    P.push({ id: t + 'b', topicId: t, edition: 2, sba: 4, emq: 0, tf: 0 });
  });
  const b = Course.remakeBacklog(P, T, {});
  const done = b.counts.done + b.counts.archive;
  return { percent: b.percent, questions: b.questions,
    topicsDone: done, topicsWithPapers: b.topics.length - b.counts.empty,
    byTopics: Math.round((done / (b.topics.length - b.counts.empty)) * 100) };
});
say('three small topics finished and one big one untouched', uneven.topicsDone === 3);
/* THE POINT: 75% by topics, 3% by questions. */
say('  counting topics would say ' + uneven.byTopics + '% done', uneven.byTopics === 75);
say('  counting questions says 3%', uneven.percent === 3, uneven.percent + '%');
say('  and reports both numbers, not just the flattering one',
  uneven.questions.done === 12 && uneven.questions.left === 400,
  uneven.questions.done + ' replaced / ' + uneven.questions.left + ' left');
/* An archived first edition is neither done nor left: it is put away. */
say('  with the put-away originals counted as neither',
  uneven.questions.total === 412, 'total ' + uneven.questions.total);

/* ---------------------------------------------------------------- */
sec('2. FIVE STATES, BECAUSE FOUR OF THEM NEED DIFFERENT ACTIONS');

const states = await page.evaluate(() => {
  const T = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, title: id.toUpperCase() }));
  const P = [
    { id: 'p1', topicId: 'a', edition: 1, sba: 100, emq: 0, tf: 0, tracks: ['x'] },
    { id: 'p2', topicId: 'b', edition: 1, sba: 50, emq: 0, tf: 0, tracks: ['x'] },
    { id: 'p3', topicId: 'b', edition: 2, sba: 60, emq: 0, tf: 0, tracks: ['x'] },
    { id: 'p4', topicId: 'c', edition: 1, sba: 40, emq: 0, tf: 0, tracks: ['x'], archivedAt: '2026-01-01' },
    { id: 'p5', topicId: 'c', edition: 2, sba: 45, emq: 0, tf: 0, tracks: ['x'] },
    { id: 'p6', topicId: 'd', edition: 1, sba: 30, emq: 0, tf: 0, tracks: ['x'] },
    /* Another course's paper, to prove the page is course-scoped. */
    { id: 'p9', topicId: 'a', edition: 2, sba: 999, emq: 0, tf: 0, tracks: ['other'] }
  ];
  const b = Course.remakeBacklog(P, T, { pending: [{ topicId: 'd', edition: 2 }],
    fits: p => (p.tracks || []).includes('x') });
  const st = id => (b.topics.find(t => t.id === id) || {}).state;
  return { a: st('a'), b: st('b'), c: st('c'), d: st('d'), e: st('e'),
    counts: b.counts, archivable: b.archivable };
});
say('a topic with only a 1st edition is the work', states.a === 'todo', states.a);
/* A 2nd edition that is written but not yet published is NOT untouched —
   telling those apart is the only reason §4 exists. */
say('one with a 2nd edition awaiting review is in flight', states.d === 'flight', states.d);
say('one with both editions live wants putting away', states.b === 'archive', states.b);
say('one whose original is already away is done', states.c === 'done', states.c);
/* A syllabus topic with no paper is a gap, not backlog: importing is the
   answer, not re-making. */
say('one with no paper at all is a gap, not backlog', states.e === 'empty', states.e);
/* A course's progress is its own. */
say("and another course's papers are not counted",
  states.counts.todo === 1 && states.archivable.join() === 'p2',
  'todo ' + states.counts.todo + ', archivable ' + states.archivable.join());

/* ---------------------------------------------------------------- */
sec('3. THE QUEUE THE PAGE EXISTS FOR');

/* Nothing is WRONG in this state — the candidate's bank already shows the
   newest edition. The old paper is simply still being offered under
   "earlier editions", invisibly, forever. */
const queue = await page.evaluate(() => {
  const T = [{ id: 'b', title: 'B' }];
  const P = [{ id: 'old1', topicId: 'b', edition: 1, sba: 10, emq: 0, tf: 0 },
    { id: 'old2', topicId: 'b', edition: 1, sba: 5, emq: 0, tf: 0 },
    { id: 'new', topicId: 'b', edition: 2, sba: 12, emq: 0, tf: 0 }];
  const b = Course.remakeBacklog(P, T, {});
  const t = b.topics[0];
  return { archivable: b.archivable.sort().join(), rowList: t.archivable.sort().join(),
    oldQ: t.oldQuestions, newQ: t.newQuestions,
    /* And once they are away the topic is done and the queue is empty. */
    after: (() => {
      const P2 = P.map(p => p.edition === 1 ? { ...p, archivedAt: 'now' } : p);
      const b2 = Course.remakeBacklog(P2, T, {});
      return { state: b2.topics[0].state, archivable: b2.archivable.length };
    })() };
});
say('every superseded paper on the topic is offered, not just one',
  queue.archivable === 'old1,old2', queue.archivable);
say('  and the row names the same ones', queue.rowList === 'old1,old2');
say('  with the superseded question count shown beside the total',
  queue.oldQ === 15 && queue.newQ === 12, queue.oldQ + ' superseded, ' + queue.newQ + ' new');
say('putting them away moves the topic to done', queue.after.state === 'done', queue.after.state);
say('  and empties the queue', queue.after.archivable === 0);

/* THE ONE THAT COULD HAVE EMPTIED A TOPIC. "Archivable" has to mean
   SUPERSEDED, not merely first-edition: an earlier draft returned every
   1st-edition paper, so a NOT-STARTED topic was offered a put-away
   control, and taking it would have archived the only edition that topic
   had — no questions left for the candidate and no replacement coming.
   Putting something away is only safe once something has replaced it. */
const safety = await page.evaluate(() => {
  const T = [{ id: 'todo', title: 'Untouched' }, { id: 'flight', title: 'In review' },
    { id: 'ready', title: 'Replaced' }];
  const P = [{ id: 'only', topicId: 'todo', edition: 1, sba: 9, emq: 0, tf: 0 },
    { id: 'wip', topicId: 'flight', edition: 1, sba: 9, emq: 0, tf: 0 },
    { id: 'o', topicId: 'ready', edition: 1, sba: 9, emq: 0, tf: 0 },
    { id: 'n', topicId: 'ready', edition: 2, sba: 9, emq: 0, tf: 0 }];
  const b = Course.remakeBacklog(P, T, { pending: [{ topicId: 'flight', edition: 2 }] });
  const g = id => b.topics.find(t => t.id === id).archivable;
  return { todo: g('todo'), flight: g('flight'), ready: g('ready'), all: b.archivable };
});
say('a not-started topic offers nothing to put away',
  safety.todo.length === 0, '[' + safety.todo.join() + ']');
/* Not even one whose replacement is written but not yet published. */
say('  nor does one whose replacement is still in review',
  safety.flight.length === 0, '[' + safety.flight.join() + ']');
say('  only the one that has actually been replaced does',
  safety.ready.join() === 'o' && safety.all.join() === 'o', safety.ready.join());

/* The control says plainly that this is not a delete — archiving and
   unpublishing sit next to each other and only one is reversible. */
const dev = readFileSync('js/dev-console.js', 'utf8');
say('the control says nothing is deleted',
  /Nothing is deleted — every mark, note and past attempt stays readable,\s*\n?\s*'?\s*\+?\s*'?and this can be undone/.test(dev)
  || /Nothing is deleted[\s\S]{0,120}can be undone/.test(dev));
say('  and it archives rather than unpublishing',
  /setArchived\('papers', ids, true\)/.test(dev) && !/unpublishPaper\(ids/.test(dev));

/* ---------------------------------------------------------------- */
sec('4. THE READ CARRIES THE TOPIC — THE SIXTH TIME');

const be = readFileSync('js/backend.js', 'utf8');
/* Without the topic on a row awaiting review, "in review" is
   indistinguishable from "nobody has started" — and the page would
   quietly show the wrong state rather than fail. */
say('the cloud review list selects the topic and the edition',
  /topicId:\$\{t\.topic\},edition/.test(be));
say('  and both reviewable tables say where their topic lives',
  /topic: 'meta->>topicId'/.test(be) && /topic: 'topic'/.test(be));
say('the local review list carries them too',
  /topicId: t\.topic \? String\(t\.topic\(r\) \|\| ''\) : ''/.test(be)
  && /edition: Number\(r\.edition\) \|\| 1/.test(be));
say('  and its tables do as well',
  /topic: r => r\.topicId \|\| \(r\.meta && r\.meta\.topicId\) \|\| ''/.test(be));
/* The reason, written where the next person will be editing. */
say('with the reason written down beside it',
  /read must carry what the view filters\s*\n?\s*(\*\s*)?on/.test(be)
  || /read must carry what the view filters[\s\S]{0,60}on/.test(be));

/* Only a 2nd-edition paper in review means the topic is in flight; a
   1st-edition draft is somebody fixing the OLD paper. */
const flight = await page.evaluate(() => {
  const T = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const P = [{ id: 'x', topicId: 'a', edition: 1, sba: 5, emq: 0, tf: 0 },
    { id: 'y', topicId: 'b', edition: 1, sba: 5, emq: 0, tf: 0 }];
  const b = Course.remakeBacklog(P, T, {
    pending: [{ topicId: 'a', edition: 2 }, { topicId: 'b', edition: 1 }] });
  return { a: b.topics.find(t => t.id === 'a').state, b: b.topics.find(t => t.id === 'b').state };
});
say('a 2nd edition in review puts its topic in flight', flight.a === 'flight', flight.a);
say('  but a 1st-edition draft does not — that is fixing the old one',
  flight.b === 'todo', flight.b);

/* ---------------------------------------------------------------- */
sec('5. AND NOTHING IS UNREACHABLE');

/* A paper filed under a dropped topic appears in no topic list. If the
   backlog only walked the syllabus it could never be re-made, and
   nothing would have said it was there. */
const odd = await page.evaluate(() => {
  const T = [{ id: 'known', title: 'Known' }];
  const P = [{ id: 'k', topicId: 'known', edition: 1, sba: 5, emq: 0, tf: 0 },
    { id: 'o', topicId: 'dropped-topic', edition: 1, sba: 9, emq: 0, tf: 0 },
    { id: 'u', topicId: '', edition: 1, sba: 3, emq: 0, tf: 0 },
    { id: 'u2', edition: 1, sba: 2, emq: 0, tf: 0 }];
  const b = Course.remakeBacklog(P, T, {});
  const f = id => b.topics.find(t => t.id === id);
  return { ids: b.topics.map(t => t.id).sort().join(','),
    orphan: f('dropped-topic') && f('dropped-topic').oddity,
    unfiledPapers: (f('') || {}).papers,
    unfiledFlag: (f('') || {}).oddity,
    left: b.questions.left };
});
say('a paper under a topic the syllabus dropped still appears',
  odd.ids.split(',').includes('dropped-topic'), odd.ids);
say('  and is marked as not in the syllabus', odd.orphan === 'orphan', String(odd.orphan));
/* Both unfiled papers group together: they share the one empty key, and
   that is right here — they are one bucket of work, not two editions. */
say('papers with no topic at all are gathered and marked',
  odd.unfiledPapers === 2 && odd.unfiledFlag === 'unfiled',
  odd.unfiledPapers + ' papers, ' + odd.unfiledFlag);
say('  and all of it counts as work left', odd.left === 19, odd.left + ' questions');

/* ---------------------------------------------------------------- */
sec('6. THE PAGE IN THE RUNNING APP');

await page.evaluate(() => { sessionStorage['aureum-passkey'] = '1'; });
await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.click('#auth-toggle'); await page.waitForTimeout(300);
await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1700);

/* A real topic from the bundled syllabus, so the page has something in
   the archive state to offer. */
await page.evaluate(async () => {
  const mk = (id, title, edition) => ({ id, title, categoryId: 'obstetrics',
    sectionId: 'obs-antenatal', topicId: 't-preconception', sba: 2, emq: 0, tf: 0,
    tracks: ['pgim-og-2'], edition,
    content: { topic: title, sba: [{ stem: 's', options: ['a', 'b'], answer: 0 }] } });
  await Backend.publishPaper(mk('t137-old', 'Preconception 1st edition', 1));
  await Backend.publishPaper(mk('t137-new', 'Preconception 2nd edition', 2));
  Data.bustPapers?.();
});

await page.evaluate(() => { sessionStorage['aureum-passkey'] = '1'; });
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/remake', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const ui = await page.evaluate(() => ({
  title: (document.querySelector('.page-title')?.textContent || '').trim(),
  bar: !!document.querySelector('.rm-bar > span'),
  width: document.querySelector('.rm-bar > span')?.style.width || '',
  figure: (document.querySelector('.rm-figure')?.textContent || '').replace(/\s+/g, ' ').trim(),
  honest: /Counted in questions, not topics/i.test(document.body.textContent || ''),
  ready: (document.querySelector('.rm-ready .card-title')?.textContent || '').trim(),
  bulk: (document.querySelector('#rm-archive-all')?.textContent || '').trim(),
  chips: [...document.querySelectorAll('[data-rmf]')].map(c => c.textContent.replace(/\s+/g, ' ').trim()),
  rows: document.querySelectorAll('.table-scroll tbody tr').length,
  courseSel: !!document.querySelector('#rm-track')
}));
say('the page draws', /second edition, topic by topic/i.test(ui.title), ui.title);
say('  with a progress bar', ui.bar && /%$/.test(ui.width), ui.width);
say('  saying what the number means', /replaced/.test(ui.figure), ui.figure.slice(0, 80));
say('  and that it is questions, not topics', ui.honest);
say('  the put-away queue is offered', /still being offered/.test(ui.ready), ui.ready);
say('    with one button for all of it', /Put away all/.test(ui.bulk), ui.bulk);
say('  a chip per state', ui.chips.length === 6, ui.chips.join(' | '));
say('  a row per topic', ui.rows > 1, ui.rows + ' rows');
say('  and a course switch', ui.courseSel);

/* THE ACTION, end to end: the queue empties and the paper is archived
   rather than deleted. */
const acted = await page.evaluate(async () => {
  const before = document.querySelectorAll('[data-rm-arch]').length;
  window.confirm = () => true;
  document.querySelector('#rm-archive-all')?.click();
  await new Promise(r => setTimeout(r, 2600));
  const still = (await Data.publishedPapers()).some(p => p.id === 't137-old');
  return { before, after: document.querySelectorAll('[data-rm-arch]').length,
    rowKept: still, inBank: (await Data.myPapers(true)).some(p => p.id === 't137-old'),
    ready: !!document.querySelector('.rm-ready') };
});
say('putting the queue away clears it', acted.before > 0 && acted.after === 0,
  acted.before + ' → ' + acted.after);
say('  the card goes with it', !acted.ready);
/* v136's rule, enforced from here too. */
say('  the row is kept, not deleted', acted.rowKept);
say('  and it stops being offered even under earlier editions', !acted.inBank);

/* The hub shows the one number worth seeing from outside. */
await page.evaluate(() => { sessionStorage['aureum-passkey'] = '1'; });
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
const hub = await page.evaluate(() => ({
  card: !!document.querySelector('a[href="#/dev/remake"]'),
  count: (document.querySelector('#hub-remake')?.textContent || '').trim()
}));
say('the hub has a card for it', hub.card);
say('  carrying the percentage', /^\d+%$/.test(hub.count), hub.count);

/* THE TRAP THIS RELEASE FELL INTO, made permanent. A section's name goes
   in two places: the dispatch in dev-console.js and the route list in
   app.js. renderRemakeSection existed and the hub card pointed at it, and
   #/dev/remake rendered the HUB — nothing threw, nothing logged, and
   nothing said why the link went nowhere. t118 had pinned `courses` as
   the last name in that list, which is why it broke when `remake` was
   appended; the rule it was reaching for is this one. */
const routable = await page.evaluate(async () => {
  const dev = await (await fetch('/js/dev-console.js')).text();
  const app = await (await fetch('/js/app.js')).text();
  const dispatched = [...dev.matchAll(/section === '([a-z]+)'/g)].map(m => m[1]);
  const m = app.match(/\^#\\\/dev\(\?:\\\/\(([a-z|]+)\)\)\?\$/);
  const routes = m ? m[1].split('|') : [];
  return { dispatched: [...new Set(dispatched)].filter(s => s !== 'hub'),
    routes, missing: [...new Set(dispatched)].filter(s => s !== 'hub' && !routes.includes(s)) };
});
say('every console section the module dispatches is also routable',
  routable.routes.length > 5 && routable.missing.length === 0,
  routable.missing.length ? 'unreachable: ' + routable.missing.join(', ')
    : routable.dispatched.length + ' sections, all routable');

/* ---------------------------------------------------------------- */
sec('7. STAMPS');
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
