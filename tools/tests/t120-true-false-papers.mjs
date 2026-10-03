/* t120 — a true/false statement is a question like any other.

   ASKED: "the final MBBS O&G paper consists of true/false questions and SBA
   questions." Half of that paper had nowhere to live. `validatePaper`
   accepted `sba` and `emq` and nothing else, so a true/false statement
   could not be in a paper — not in the library, not in a mock, not in the
   simulator.

   THE ENGINE ALREADY EXISTED, in the wrong place. cpd.js has had
   true/false since the TOG volumes: `qtype`, the T/F keys, the reasoning
   and the memory hook, lead-ins lifted out of consecutive statements. But
   it lived inside the CPD section with its own volumes table and its own
   progress store, so it could not be part of a paper.

   THE CHEAPEST CORRECT IMPLEMENTATION, and the reason this release is
   small: a true/false item IS a single-best-answer with two options. It is
   authored as its own array — because that is how the paper reads — and
   flattened into the ordinary question shape, `options: ['True','False']`
   with a 0/1 answer. Marking, elimination, flagging, notes, the review
   queue and the progress store are then untouched. Writing a parallel
   true/false path through all of that would have been the same behaviour
   implemented twice, and the second copy is the one that gets the bug.

   THE ONE THING WORTH REFUSING. `answer` must be a boolean, never a
   number: `0` reads as both "the first option, True" and "the value
   false", and the two are opposites. Accepting it would invert the mark on
   every statement in the file and look exactly like a candidate who got
   them all wrong. §1 holds that line.

   AND THE THING THAT COULD HAVE GONE SILENTLY WRONG. A question's key is
   `paper:KIND:number`, and `number` counts up through whatever flatten()
   has already emitted. A kind inserted before EMQ would renumber every EMQ
   question in the bank and orphan every mark, note, flag and review item
   filed against it. §2 proves the numbering did not move. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const PAPER = {
  schema: 'ogr-paper-v1', topic: 'Final MBBS O&G — Paper 1',
  sba: [
    { stem: 'Best first manoeuvre in shoulder dystocia?',
      options: ['McRoberts', 'Zavanelli', 'Caesarean section'], answer: 0, explanation: 'x' },
    { stem: 'First-line tocolytic?', options: ['Nifedipine', 'Ritodrine'], answer: 0 }
  ],
  emq: [{ theme: 'Postpartum haemorrhage', options: ['A. Atony', 'B. Trauma', 'C. Retained tissue'],
    stems: [{ stem: 'Boggy uterus after delivery', answer: 0 }] }],
  tf: [
    { lead: 'Regarding pre-eclampsia:', statements: [
      { stem: 'Proteinuria is required for the diagnosis', answer: false,
        explanation: 'Not since the 2013 ISSHP revision.', hook: 'No protein needed' },
      { stem: 'Magnesium sulphate reduces the risk of eclampsia', answer: true, explanation: 'MAGPIE.' }
    ] },
    { stem: 'A statement that stands on its own needs no lead-in', answer: 'T' }
  ]
};

/* ---------------------------------------------------------------- */
sec('1. THE SCHEMA TAKES TRUE/FALSE — AND REFUSES AN AMBIGUOUS ANSWER');

const data = readFileSync('js/data.js', 'utf8');
say('a paper may be sba, emq, tf, or any mixture',
  /Paper has no SBA, EMQ or true\/false content/.test(data));
/* TF LAST IN flatten(), so no earlier kind's numbering can move. */
say('true/false is appended, after both existing kinds',
  data.indexOf("kind: 'TF'") > data.indexOf("kind: 'EMQ'"));
const doc = readFileSync('docs/JSON_FORMAT.md', 'utf8');
say('  and the docs say how to write one',
  /## True\/false statements/.test(doc) && /a boolean, not a number/.test(doc));
/* The refusal is the surprising rule, so the doc has to carry the reason
   and not just the rule — otherwise the next author "fixes" it to 0/1. */
say('  including why a number is refused', /would invert the mark/.test(doc));

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

const valid = await page.evaluate(p => ({
  errors: Data.validatePaper(p),
  counts: { sba: Data.countSBA(p), emq: Data.countEMQ(p), tf: Data.countTF(p) }
}), PAPER);
say('a mixed paper validates clean', valid.errors.length === 0, valid.errors.join(' | '));
/* Three statements from two blocks — a block of two and a bare one. */
say('  and every statement is counted, lead-in or not',
  valid.counts.tf === 3, JSON.stringify(valid.counts));

/* THE AMBIGUITY, REFUSED. */
const refused = await page.evaluate(() => ({
  num: Data.validatePaper({ topic: 'x', tf: [{ stem: 's', answer: 0 }] }),
  junk: Data.validatePaper({ topic: 'x', tf: [{ stem: 's', answer: 'maybe' }] }),
  noStem: Data.validatePaper({ topic: 'x', tf: [{ answer: true }] }),
  empty: Data.validatePaper({ topic: 'x', tf: [{ lead: 'Regarding x:', statements: [] }] })
}));
say('a numeric true/false answer is refused, not guessed at',
  /must be true or false, not a number/.test(refused.num.join(' ')), refused.num[0]);
say('  and the refusal says why it cannot be guessed',
  /would invert the mark/.test(refused.num.join(' ')));
say('  a word that is neither is refused too', /must be true or false \(got/.test(refused.junk.join(' ')),
  refused.junk[0]);
say('  a statement with no stem is refused', /missing "stem"/.test(refused.noStem.join(' ')));
say('  and a block with no statements is refused', /has no statements/.test(refused.empty.join(' ')));

/* The words are accepted, because that is how a key is typed out. */
const words = await page.evaluate(() => ['true', 'TRUE', 'T', 'yes', 'false', 'F', 'no'].map(w =>
  Data.flatten({ tf: [{ stem: 's', answer: w }] }, 'TF')[0].answer));
say('the words true/T/yes and false/F/no all work',
  words.join() === '0,0,0,0,1,1,1', words.join(', '));

/* ---------------------------------------------------------------- */
sec('2. AND IT DID NOT RENUMBER ANYTHING');

/* THE SILENT BREAK THIS RELEASE HAD TO AVOID. Every mark, note, flag and
   review item is filed under `paper:KIND:number`. If adding a kind shifted
   the numbers, the whole bank's history would detach from its questions —
   and nothing would throw. */
const keys = await page.evaluate(p => ({
  sba: Data.flatten(p, 'SBA').map(q => q.kind + ':' + q.number),
  emq: Data.flatten(p, 'EMQ').map(q => q.kind + ':' + q.number),
  tf: Data.flatten(p, 'TF').map(q => q.kind + ':' + q.number)
}), PAPER);
say('SBA still numbers from 1', keys.sba.join() === 'SBA:1,SBA:2', keys.sba.join(', '));
say('  EMQ still numbers from 1', keys.emq.join() === 'EMQ:1', keys.emq.join(', '));
say('  and true/false numbers from 1 in its own series',
  keys.tf.join() === 'TF:1,TF:2,TF:3', keys.tf.join(', '));
/* Each kind numbering from 1 only holds because every caller asks for one
   kind. A caller that asked for 'ALL' and built keys would get a different
   answer, so the invariant is worth asserting rather than assuming. */
const callers = readFileSync('js/app.js', 'utf8') + readFileSync('js/review.js', 'utf8')
  + readFileSync('js/hooks.js', 'utf8') + readFileSync('js/simulator.js', 'utf8')
  + readFileSync('js/coverage.js', 'utf8') + readFileSync('js/dev-console.js', 'utf8');
say('  because no caller ever flattens every kind at once',
  !/flatten\([^)]*'ALL'\)/.test(callers));

/* The lead-in belongs to the block and reaches every statement in it. */
const leads = await page.evaluate(p => Data.flatten(p, 'TF').map(q => q.lead), PAPER);
say('a block’s lead-in reaches each of its statements',
  leads[0] === 'Regarding pre-eclampsia:' && leads[1] === leads[0], JSON.stringify(leads));
say('  and a standalone statement has none', leads[2] === '');
/* The answer each way round, which is the thing a boolean mix-up breaks. */
const answers = await page.evaluate(p => Data.flatten(p, 'TF').map(q => q.answer), PAPER);
say('false maps to the False button and true to the True button',
  answers.join() === '1,0,0', answers.join(', '));

/* ---------------------------------------------------------------- */
sec('3. IN THE PAPER, AND SAT LIKE A PAPER');

await page.evaluate(async p => {
  await Backend.publishPaper({ id: 't120-paper', title: p.topic, categoryId: 'obstetrics',
    sectionId: 'obs-antenatal', topicId: 't-preconception',
    sba: Data.countSBA(p), emq: Data.countEMQ(p), tf: Data.countTF(p), content: p });
  Data.bustPapers?.();
}, PAPER);
await page.goto(B + '/index.html?r=' + Math.random() + '#/paper/t120-paper', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2100);
const cards = await page.evaluate(() => ({
  kinds: [...document.querySelectorAll('.run-card')].map(c => c.dataset.kind),
  label: document.querySelector('.run-card[data-kind="TF"] .chip')?.textContent || '',
  count: document.querySelector('.run-card[data-kind="TF"] .run-count')?.textContent || '',
  href: document.querySelector('.run-card[data-kind="TF"] a[href*="/TF/"]')?.getAttribute('href') || ''
}));
/* ONE RUN CARD PER KIND — the final MBBS paper is sat as its true/false
   section and its SBA section, each marked on its own, which is how the
   real paper works. */
say('the paper offers a true/false section of its own',
  cards.kinds.join() === 'SBA,EMQ,TF', cards.kinds.join(', '));
say('  labelled T/F, not TF', cards.label === 'T/F', cards.label);
say('  with its three statements', /3 questions/.test(cards.count), cards.count);
/* A card that links to a route the router does not know is a dead button. */
say('  and the route it links to exists', /#\/quiz\/t120-paper\/TF\/(exam|study)/.test(cards.href),
  cards.href);

await page.goto(B + '/index.html?r=' + Math.random() + '#/quiz/t120-paper/TF/study', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2300);
const quiz = await page.evaluate(() => {
  const lead = document.querySelector('.q-tf-lead'), stem = document.querySelector('.q-stem');
  return {
    stem: stem?.textContent || '',
    lead: lead?.textContent || '',
    leadFirst: !!(lead && stem) && lead.compareDocumentPosition(stem) === Node.DOCUMENT_POSITION_FOLLOWING,
    options: [...document.querySelectorAll('#q-options .q-option')].map(b => b.textContent.trim()),
    cls: document.querySelector('#q-options')?.className || '',
    letters: document.querySelectorAll('#q-options .q-letter').length
  };
});
say('the quiz opens on the first statement', /Proteinuria is required/.test(quiz.stem), quiz.stem);
/* THE LEAD-IN GOES ABOVE. It is the sentence the statement completes, and
   by the fifth statement of a block it is the only thing saying what is
   being asked about. */
say('  with its lead-in above it, not under it', quiz.leadFirst, quiz.lead);
say('  two options, True and False', quiz.options.join() === 'True,False', quiz.options.join(', '));
say('  laid out as two, not as a list', /q-options-tf/.test(quiz.cls), quiz.cls.trim());
say('  and no A/B in front of two named options', quiz.letters === 0);

/* Marking: the whole point of reusing the SBA path. */
await page.click('#q-options .q-option:nth-child(2)');   // False — correct
await page.waitForTimeout(800);
const marked = await page.evaluate(() => ({
  cls: [...document.querySelectorAll('#q-options .q-option')].map(b => b.className),
  fb: document.querySelector('#q-feedback')?.textContent || ''
}));
say('answering False marks it correct', /correct/.test(marked.cls[1]) && !/incorrect/.test(marked.cls[1]),
  marked.cls[1]);
say('  and the explanation is shown', /2013 ISSHP/.test(marked.fb), marked.fb.slice(0, 60));

/* Elimination needs something to eliminate — not on two options. */
const quizJs = readFileSync('js/quiz.js', 'utf8');
say('striking out is not offered on a two-option question',
  /const canStrike = q\.kind !== 'TF'/.test(quizJs));

/* ---------------------------------------------------------------- */
sec('4. AND EVERYTHING ELSE TREATS IT AS A QUESTION');

/* Each of these walks every question in a paper. A kind missing from one
   of them is a feature that silently skips true/false. */
say('the review queue knows the kind',
  /\['SBA', 'EMQ', 'TF'\]/.test(readFileSync('js/review.js', 'utf8')));
say('  the memory hooks page does too',
  /\['SBA', 'EMQ', 'TF'\]/.test(readFileSync('js/hooks.js', 'utf8')));
say('  the AI tagger tags them', /:TF:\$\{q\.number\}/.test(readFileSync('js/dev-console.js', 'utf8')));
say('  and a mock can resolve a true/false key back to its question',
  /\['SBA', 'EMQ', 'TF'\]/.test(readFileSync('js/simulator.js', 'utf8')));

/* The library badge, and the honest absence of one. */
const chips = await page.evaluate(async () => {
  await Backend.publishPaper({ id: 't120-tfonly', title: 'Pure true/false paper',
    categoryId: 'obstetrics', sectionId: 'obs-antenatal', topicId: 't-preconception',
    sba: 0, emq: 0, tf: 2,
    content: { topic: 'Pure true/false paper', tf: [{ stem: 'a', answer: true }, { stem: 'b', answer: false }] } });
  Data.bustPapers?.();
  return true;
});
await page.goto(B + '/index.html?r=' + Math.random() + '#/library', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const badges = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll('.paper-card').forEach(c => {
    const t = c.querySelector('h4')?.textContent || '';
    if (/Final MBBS|Pure true/.test(t)) out[t] = [...c.querySelectorAll('.chip')].map(x => x.textContent.trim());
  });
  return out;
});
const mixed = badges['Final MBBS O&G — Paper 1'] || [];
const tfOnly = badges['Pure true/false paper'] || [];
say('a mixed paper is badged with all three', mixed.join(' ').includes('T/F 3')
  && mixed.join(' ').includes('SBA 2'), mixed.join(' | '));
/* "SBA 0" on a paper with no SBA is a worse answer than no chip at all. */
say('  and a pure true/false paper is not badged "SBA 0"',
  tfOnly.some(c => /T\/F 2/.test(c)) && !tfOnly.some(c => /SBA 0/.test(c)), tfOnly.join(' | '));

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
