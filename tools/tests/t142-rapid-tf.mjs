/* t142 — the rapid T/F reader.

   A paper's true/false section is a lead-in with five or six statements
   hanging off it. Shown one at a time the lead-in is reprinted six
   times, the candidate loses the thread of what is being compared, and
   six clicks of navigation buy nothing. CPD solved this already: the
   lead once, a line a statement, the verdict the instant you commit.

   §3 IS THE WHOLE DESIGN. This is not a third MODE, it is a second VIEW
   of study mode — same session key, same question keys, same attempt.
   So switching half way through a paper keeps the answers, and nothing
   downstream can tell which reader produced the attempt. Get that wrong
   and a candidate loses a sitting's work by pressing a button that
   looks like a display option.

   §4 IS WHY IT IS STUDY ONLY. Every statement is on screen at once, so
   a candidate can read ahead, and the clock belongs to one question at
   a time. Exam mode keeps the one-at-a-time reader and is not offered
   the switch.

   §5 IS THE THING THAT WOULD HAVE BROKEN QUIETLY. Data.flatten() turns
   a statement into a two-option question whose `answer` is an INDEX,
   not the boolean the source file had. CPD's reader works on booleans.
   Read one as the other and every verdict inverts — with nothing
   thrown, and a rationale underneath confidently explaining the wrong
   answer. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.click('#auth-toggle'); await page.waitForTimeout(300);
await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1700);

const PID = 't142-paper';
await page.evaluate(async (PID) => {
  await Backend.publishPaper({ id: PID, title: 'TF test', categoryId: 'obstetrics',
    sectionId: 'obs-antenatal', topicId: 't-preconception', sba: 0, emq: 0, tf: 5,
    tracks: ['pgim-og-2'], edition: 1,
    content: { topic: 'Pre-eclampsia & PPH', tf: [
      { lead: 'Regarding pre-eclampsia:', statements: [
        { stem: 'Proteinuria is required for the diagnosis.', answer: false, rationale: 'ISSHP 2018: not mandatory.' },
        { stem: 'Aspirin from 12 weeks reduces risk.', answer: true, rationale: '150 mg nocte.' },
        { stem: 'It resolves immediately at delivery.', answer: false, rationale: 'Can worsen postpartum.' } ] },
      { lead: 'Regarding postpartum haemorrhage:', statements: [
        { stem: 'Uterine atony is the commonest cause.', answer: true, rationale: 'About 70%.' },
        { stem: 'Tranexamic acid is contraindicated.', answer: false, rationale: 'WOMAN trial.' } ] }
    ] } });
  Data.bustPapers?.();
}, PID);

const openRapid = async () => {
  await page.evaluate(() => { try { localStorage.setItem('aureum-tf-view', 'rapid'); } catch {} });
  await page.goto(B + '/index.html?r=' + Math.random() + '#/quiz/' + PID + '/TF/study',
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
};
await openRapid();

/* ---------------------------------------------------------------- */
sec('1. THE LEAD ONCE, THEN A LINE A STATEMENT');

const shape = await page.evaluate(() => ({
  rapid: !!document.querySelector('.rpd'),
  leads: [...document.querySelectorAll('.cpdr-lead')].map(l => l.textContent.trim()),
  rows: document.querySelectorAll('.cpdr-row').length,
  perBlock: [...document.querySelectorAll('.cpdr-group')].map(g => g.querySelectorAll('.cpdr-row').length),
  first: (document.querySelector('.cpdr-txt') || {}).textContent.trim(),
  tf: document.querySelectorAll('.cpdr-row[data-i="0"] .cpdr-b').length
}));
say('study-mode T/F opens as the rapid reader', shape.rapid);
say('  one lead-in per block, printed once',
  shape.leads.length === 2 && shape.leads[0] === 'Regarding pre-eclampsia:', shape.leads.join(' | '));
/* Consecutive statements sharing a lead are one block; two blocks that
   happen to share one are still two. */
say('  the statements grouped under them', shape.perBlock.join(',') === '3,2', shape.perBlock.join(','));
say('  a row per statement, with T and F on it', shape.rows === 5 && shape.tf === 2);
/* The lead is not repeated inside the line it heads. */
say('  and the line does not repeat the lead-in',
  !/Regarding/.test(shape.first), shape.first);

/* ---------------------------------------------------------------- */
sec('2. THE VERDICT THE INSTANT YOU COMMIT');

const answered = await page.evaluate(async () => {
  document.querySelector('.cpdr-row[data-i="0"] .cpdr-f').click();   // FALSE — right
  await new Promise(r => setTimeout(r, 350));
  document.querySelector('.cpdr-row[data-i="1"] .cpdr-f').click();   // FALSE — wrong
  await new Promise(r => setTimeout(r, 450));
  const row = i => document.querySelector(`.cpdr-row[data-i="${i}"]`);
  return {
    right: row(0).className, wrong: row(1).className,
    why0: (row(0).querySelector('.cpdr-why') || {}).textContent.replace(/\s+/g, ' ').trim(),
    why1: (row(1).querySelector('.cpdr-why') || {}).textContent.replace(/\s+/g, ' ').trim(),
    locked: row(0).querySelector('.cpdr-b').disabled,
    score: (document.querySelector('#rpd-score') || {}).textContent.replace(/\s+/g, ' ').trim(),
    untouched: !row(2).querySelector('.cpdr-why') || row(2).querySelector('.cpdr-why').hidden
  };
});
say('a right answer is marked right', /is-right/.test(answered.right));
say('  a wrong one wrong', /is-wrong/.test(answered.wrong));
/* THE INVERSION TEST. flatten() gives an INDEX, the source file had a
   boolean; reading one as the other inverts every verdict silently. */
say('  and the verdict matches the source file',
  /statement is FALSE/.test(answered.why0) && /ISSHP/.test(answered.why0), answered.why0.slice(0, 44));
say('  including when the candidate was wrong',
  /statement is TRUE/.test(answered.why1) && /150 mg/.test(answered.why1), answered.why1.slice(0, 40));
say('an answered statement cannot be changed', answered.locked === true);
say('  the running score counts', /1 \/ 2 right/.test(answered.score), answered.score);
/* Answering one row must not collapse the feedback on the others. */
say('  and the statements not yet answered stay closed', answered.untouched);

/* ---------------------------------------------------------------- */
sec('3. A SECOND VIEW, NOT A SECOND MODE');

const switched = await page.evaluate(async () => {
  document.querySelector('#rpd-switch').click();
  await new Promise(r => setTimeout(r, 1700));
  return {
    quiz: !!document.querySelector('.quiz-shell'),
    rapidBtn: !!document.querySelector('#quiz-rapid'),
    done: document.querySelectorAll('[data-goto].done').length
  };
});
say('it can be swapped for one at a time', switched.quiz);
/* THE ONE THAT WOULD COST SOMEBODY THEIR WORK. */
say('  and the answers already given come with it', switched.done === 2, switched.done + ' of 2');
say('  with a way back', switched.rapidBtn);

const andBack = await page.evaluate(async () => {
  document.querySelector('#quiz-rapid').click();
  await new Promise(r => setTimeout(r, 1700));
  return {
    rapid: !!document.querySelector('.rpd'),
    shown: document.querySelectorAll('.cpdr-row.is-right, .cpdr-row.is-wrong').length,
    score: (document.querySelector('#rpd-score') || {}).textContent.replace(/\s+/g, ' ').trim()
  };
});
say('and back again', andBack.rapid);
say('  still holding both answers', andBack.shown === 2 && /1 \/ 2 right/.test(andBack.score), andBack.score);

const app = readFileSync('js/app.js', 'utf8');
/* Re-reading the session is what makes the above true; passing the
   page-load snapshot across would throw away the sitting. */
say('each mount re-reads the session rather than reusing the first one',
  /RE-READ THE SESSION ON EVERY MOUNT/.test(app) && /await Backend\.loadSession\(sessionKey\)/.test(app));
const quizJs = readFileSync('js/quiz.js', 'utf8');
const rapidJs = readFileSync('js/rapid.js', 'utf8');
/* A fire-and-forget save loses the race with that read. */
say('  and the handover waits for the save to land',
  /await autosaveNow\(\)/.test(quizJs) && /await saveNow\(\)/.test(rapidJs));
say('the view chosen is remembered', /aureum-tf-view/.test(app));

/* ---------------------------------------------------------------- */
sec('4. STUDY ONLY');

await page.goto(B + '/index.html?r=' + Math.random() + '#/quiz/' + PID + '/TF/exam',
  { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
const exam = await page.evaluate(() => ({
  quiz: !!document.querySelector('.quiz-shell'),
  rapid: !!document.querySelector('.rpd'),
  offered: !!document.querySelector('#quiz-rapid')
}));
say('exam mode is the one-at-a-time reader', exam.quiz && !exam.rapid);
/* Every statement on one page means reading ahead, and the clock
   belongs to one question at a time. */
say('  and is not offered the switch', !exam.offered);
say('the rule is written where the choice is made',
  /Exam mode is not offered it/.test(app) || /read ahead/.test(app));

/* ---------------------------------------------------------------- */
sec('5. ONE DEFINITION OF AN ATTEMPT');

/* Two builders that drifted would not throw — a candidate's history
   would quietly disagree with itself, and the weakness profile that
   shapes the next mock reads that history. */
say('Quiz owns the shape and exports it',
  /function buildAttempt\(a\)/.test(quizJs) && /snapshotQuestion, buildAttempt/.test(quizJs));
say('  and the rapid reader uses it rather than its own',
  /Quiz\.buildAttempt\(\{/.test(rapidJs)
  && !/paperTitle: .*loaded\.paper\.topic/.test(rapidJs));
say('  with the reason recorded', /ONE DEFINITION OF AN ATTEMPT/.test(quizJs));

const finished = await page.evaluate(async () => {
  await Backend.clearSession('t142-paper:TF:study').catch(() => {});
  try { localStorage.setItem('aureum-tf-view', 'rapid'); } catch {}
  location.hash = '#/quiz/t142-paper/TF/study';
  await new Promise(r => setTimeout(r, 2200));
  const order = [1, 0, 1, 0, 1];     // 0=True 1=False
  for (let i = 0; i < 5; i++) {
    document.querySelector(`.cpdr-row[data-i="${i}"] .${order[i] ? 'cpdr-f' : 'cpdr-t'}`)?.click();
    await new Promise(r => setTimeout(r, 160));
  }
  window.confirm = () => true;
  document.querySelector('#rpd-finish').click();
  await new Promise(r => setTimeout(r, 2200));
  const all = (await Backend.getProgress()).attempts || [];
  const a = all.slice().sort((x, y) => String(y.date).localeCompare(String(x.date)))[0];
  return { kind: a.kind, studyMode: a.studyMode, total: a.total, correct: a.correct,
    percent: a.percent, keys: (a.detail || []).map(d => d.qkey),
    onResults: /#\/results\//.test(location.hash) };
});
say('finishing records an attempt', finished.total === 5 && finished.kind === 'TF');
say('  marked as study', finished.studyMode === true);
/* The source answers are F,T,F,T,F; the picks were F,T,F,T,F mapped
   through order[] — four of five right. */
say('  scored against the source file', finished.correct === 5, finished.correct + '/5');
/* THE KEY IS THE POINT. Every mark, note, flag and review item is filed
   under it, so a reader that invented its own would detach a
   candidate's history from the questions it belongs to. */
say('  under the same question keys as the other reader',
  finished.keys.join() === 't142-paper:TF:1,t142-paper:TF:2,t142-paper:TF:3,t142-paper:TF:4,t142-paper:TF:5',
  finished.keys[0] + ' …');
say('  and it lands on the results page', finished.onResults);

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v142/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '142', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
