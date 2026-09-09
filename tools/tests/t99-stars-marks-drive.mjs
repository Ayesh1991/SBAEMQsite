/* t99 — four things asked for on the same day, and one of them is a bug.

   The bug is the one that matters most: a station came back reading
   "Q3 20/20" over five marking points of which three said "did not
   mention". A candidate reads the number, not the ticks, and a number
   that flatters is worse than no marking at all — it says the revision
   is done when it is not.

   So §1 tests the arithmetic hardest: that the ticks win, that the
   marker's own figure is shown struck through rather than quietly
   replaced, and that a verdict written against the old total does not
   survive the correction.

   §2–4 are the three features: starring a station for the last week
   before the exam, seeing the starred ones together, leaving the ones
   you have pushed down out of a circuit, and skipping one mid-round.

   §5 is the Drive fix, tested at the exact fault: a token request that
   fails because the browser blocked a popup is NOT an expired grant, and
   must not put the connection into the state that stops it trying. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });

const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.click('#auth-toggle'); await page.waitForTimeout(250);
await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1600);

/* Three stations to work with. ST-A is the one from the screenshot: a
   twenty-mark question with five marking points, two of which were said. */
await page.evaluate(async () => {
  const st = (id, topic, marks) => ({
    id, topic, scenario: 'A 52-year-old woman attends the menopause clinic.',
    station_time_min: 15, total_marks: marks, pass_mark_percent: 70,
    questions: [{ id: 1, prompt: 'If she has an intact uterus, what are the available choices?', marks: marks,
      marking_points: [
        'MHT with oestrogen-progestogen combinations, either continuous or sequential',
        'Bazedoxifene (SERM) with conjugated oestrogen',
        'Tibolone (SERM)',
        'Oestrogen with Medroxyprogesterone acetate',
        'Oestrogen + IU LNG (levonorgestrel intrauterine system)'
      ] }]
  });
  await Backend.publishOsceStation(st('ST-A', 'Menopause — hormone choices', 20));
  await Backend.publishOsceStation(st('ST-B', 'Shoulder dystocia', 20));
  await Backend.publishOsceStation(st('ST-C', 'Sepsis in pregnancy', 20));
  OSCE.bustStations?.();
});

/* ---------------------------------------------------------------- */
sec('1. THE TICKS ARE THE MARKING');

/* The exact answer the model gave: an honest scheme under a dishonest
   total. Nothing here is invented — two covered, three missed, 20/20. */
const model = {
  questions: [{ id: 1, awarded: 20, max: 20, points: [
    { point: 'MHT with oestrogen-progestogen combinations, either continuous or sequential', status: 'covered', note: 'Mentioned combined oral HRT.' },
    { point: 'Bazedoxifene (SERM) with conjugated oestrogen', status: 'missed', note: 'Did not mention Bazedoxifene.' },
    { point: 'Tibolone (SERM)', status: 'missed', note: 'Did not mention Tibolone.' },
    { point: 'Oestrogen with Medroxyprogesterone acetate', status: 'missed', note: 'Did not mention MPA.' },
    { point: 'Oestrogen + IU LNG (levonorgestrel intrauterine system)', status: 'covered', note: 'Mentioned estrogen patch + LNG IUS.' }
  ], comment: 'Missed several specific options, but covered the main categories.' }],
  total: 20, max: 20, percent: 100, pass: true,
  examinerComment: 'Sound on the main categories.'
};

const arith = await page.evaluate(async ([m]) => {
  const st = await Backend.getOsceStation('ST-A');
  const r = OSCE.reconcile(JSON.parse(JSON.stringify(m)), st);
  const q = r.questions[0];
  return { awarded: q.awarded, claimed: q.claimed, max: q.max, share: q.share,
    total: r.total, percent: r.percent, regraded: r.regraded };
}, [model]);
say('two points of five, worth 20 marks, come to 8', arith.awarded === 8, arith.awarded + '/' + arith.max);
say('  the share of one point is stated', arith.share === 4, arith.share);
say('  the marker’s own figure is KEPT, not thrown away', arith.claimed === 20, arith.claimed);
say('  the total follows the questions', arith.total === 8, arith.total);
say('  and so does the percentage', arith.percent === 40, arith.percent + '%');
say('  the correction is recorded on the result', !!arith.regraded && arith.regraded.from === 20 && arith.regraded.to === 8,
  arith.regraded ? arith.regraded.from + ' → ' + arith.regraded.to : 'not recorded');

/* Half marks, and the one case where the model must be left alone. */
const edges = await page.evaluate(async () => {
  const st = await Backend.getOsceStation('ST-A');
  const five = s => ({ questions: [{ id: 1, awarded: 20, max: 20,
    points: s.map(x => ({ point: 'p', status: x })) }] });
  const half = OSCE.reconcile(five(['covered', 'partial', 'missed', 'missed', 'missed']), st).questions[0].awarded;
  const all = OSCE.reconcile(five(['covered', 'covered', 'covered', 'covered', 'covered']), st).questions[0];
  const none = OSCE.reconcile({ questions: [{ id: 1, awarded: 13, max: 20, points: [] }] }, st).questions[0];
  const agree = OSCE.reconcile({ questions: [{ id: 1, awarded: 8, max: 20,
    points: ['covered', 'covered', 'missed', 'missed', 'missed'].map(x => ({ point: 'p', status: x })) }] }, st);
  return { half, allAwarded: all.awarded, allClaimed: all.claimed,
    none: none.awarded, noneClaimed: none.claimed, agreeRegraded: !!agree.regraded };
});
say('a partial is worth half its share', edges.half === 6, edges.half);
say('a marking that agrees with itself is left exactly as it is',
  edges.allAwarded === 20 && edges.allClaimed === undefined && !edges.agreeRegraded);
say('  and a question with no ticks is never recomputed from nothing',
  edges.none === 13 && edges.noneClaimed === undefined, edges.none);

/* ---------------------------------------------------------------- */
sec('2. THE REPORT SAYS SO, RATHER THAN QUIETLY DISAGREEING');

await page.evaluate(async ([m]) => {
  const st = await Backend.getOsceStation('ST-A');
  const r = OSCE.reconcile(JSON.parse(JSON.stringify(m)), st);
  r.pass = r.regraded ? (r.total >= OSCE.passOf(st)) : r.pass;
  await Backend.saveOsceAttempt({
    id: 'oa-regrade', station_id: 'ST-A',
    station: { topic: st.topic, scenario: st.scenario, total_marks: 20, pass_mark: OSCE.passOf(st) },
    questions: OSCE.qsOf(st), answers: [{ id: 1, transcript: 'Combined oral HRT, and an estrogen patch with an LNG IUS.' }],
    result: r, created: Date.now(), model: 'gemini-3.1-flash-lite'
  });
}, [model]);
await page.evaluate(() => { location.hash = '#/osce/result/oa-regrade'; });
await page.waitForTimeout(1400);

const rep = await page.evaluate(() => {
  const t = document.getElementById('view').textContent.replace(/\s+/g, ' ');
  return { txt: t,
    banner: !!document.querySelector('.os-regrade'),
    qmark: (document.querySelector('.os-qres-m')?.textContent || '').replace(/\s+/g, ' ').trim(),
    struck: (document.querySelector('.os-qres-was')?.textContent || '').trim(),
    dial: (document.querySelector('#os-dial span')?.textContent || '').trim(),
    band: (document.querySelector('.os-res-score .es-fb-band')?.textContent || '').trim() };
});
say('the correction is announced, not hidden', rep.banner);
say('  it names both numbers', /20 where the points it marked come to 8/.test(rep.txt), '20 → 8');
say('  the question shows the marker’s figure struck through', rep.struck === '20' && /8\/20/.test(rep.qmark), rep.qmark);
say('  the score on the page is the corrected one', rep.dial === '40%', rep.dial);
say('  and a "pass" written against the old total does not survive it',
  /Below the pass mark/.test(rep.band), rep.band);
say('  the ticks that produced it are on the same page to check',
  /Did not mention Bazedoxifene/.test(rep.txt) && /Mentioned combined oral HRT/.test(rep.txt));

/* ---------------------------------------------------------------- */
sec('3. STARRING ONE, AND FINDING IT AGAIN');

await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(1400);

say('every card carries the mark',
  await page.evaluate(() => document.querySelectorAll('.os-card .st-mark').length >= 3));
say('  nothing is starred to begin with, so the bin is not offered',
  await page.evaluate(() => document.querySelector('.os-bin[data-bin="@star"]')?.hidden === true));

await page.click('.os-card[data-st="ST-A"] .st-star');
await page.waitForTimeout(500);
const afterStar = await page.evaluate(() => ({
  on: document.querySelector('.os-card[data-st="ST-A"] .st-star')?.classList.contains('is-on'),
  chip: document.querySelector('.os-bin[data-bin="@star"]')?.hidden === false,
  n: document.querySelector('.os-bin[data-bin="@star"] i')?.textContent,
  hash: location.hash
}));
say('starring fills the star in', afterStar.on);
say('  the ★ bin appears the moment there is one in it', afterStar.chip, afterStar.n + ' in it');
say('  and pressing a star inside a card does NOT open the station', afterStar.hash === '#/osce');

await page.click('.os-bin[data-bin="@star"]');
await page.waitForTimeout(500);
const inBin = await page.evaluate(() => ({
  shown: [...document.querySelectorAll('.os-card')].filter(c => !c.hidden).map(c => c.dataset.st),
  pack: !!document.querySelector('.os-starpack'),
  txt: document.getElementById('view').textContent.replace(/\s+/g, ' ')
}));
say('the ★ bin shows only what is starred', inBin.shown.join() === 'ST-A', inBin.shown.join(', ') || 'nothing');
say('  with the revision list, and a way to print every scheme in it', inBin.pack && /Print all 1 marking scheme/.test(inBin.txt));
say('  and it says the list is nobody else’s', /Nobody else sees this list/.test(inBin.txt));

/* It has to still be there tomorrow — that is the whole point of a mark
   made in the week before an exam. */
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
say('the star survives a reload',
  await page.evaluate(() => document.querySelector('.os-card[data-st="ST-A"] .st-star')?.classList.contains('is-on')));

/* And it is one person's opinion, not the site's. */
const otherSees = await page.evaluate(async () => {
  await Backend.signOut();
  await Backend.signUp({ name: 'Dr Someone Else', email: 'else@example.com', password: 'password123' });
  Stars.bust();
  await Stars.load();
  return Stars.of('ST-A');
});
say('another candidate does not inherit it', otherSees === '', otherSees || 'no mark');
await page.evaluate(async () => {
  await Backend.signOut();
  await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  Stars.bust(); await Stars.load();
});

/* ---------------------------------------------------------------- */
sec('4. THE ONES NOT WORTH FIFTEEN MINUTES');

await page.evaluate(async () => { await Stars.set('ST-C', 'low'); location.hash = '#/osce/sim'; });
await page.waitForTimeout(1500);

const sim = await page.evaluate(() => ({
  offered: document.querySelector('#os-lowwrap')?.hidden === false,
  ticked: document.querySelector('#os-low')?.checked,
  note: (document.querySelector('#os-lownote')?.textContent || '').replace(/\s+/g, ' ').trim()
}));
say('a circuit offers to leave the ↓ ones out', sim.offered);
say('  ticked already — having marked it IS the instruction', sim.ticked);
say('  and it says what it is costing you', /1 station you marked ↓ (is|are) out of this draw/.test(sim.note), sim.note);

const draws = await page.evaluate(async () => {
  const out = { withSkip: [], without: [] };
  const pick = () => [...document.querySelectorAll('.os-pick-b')].find(b => b.dataset.mode === 'random');
  pick().click();
  document.querySelector('#os-count').querySelector('[data-n="3"]').click();
  await new Promise(r => setTimeout(r, 200));
  // the pool is settled when Start is pressed, so ask the module instead:
  // twenty draws is enough to see whether one station can come up at all
  for (let i = 0; i < 20; i++) {
    document.querySelector('#os-count').querySelector('[data-n="3"]').click();
    out.withSkip.push(...[...document.querySelectorAll('.os-pick')].map(x => x.textContent));
  }
  return out;
});
/* The draw is settled when Start is pressed, so the honest test of the
   filter is the one the builder itself uses. */
const excluded = await page.evaluate(() => {
  const ids = new Set();
  for (let i = 0; i < 30; i++) {
    // rebuild the pool the way the page does, through the module's own state
    document.querySelector('#os-count').querySelector('[data-n="3"]').click();
  }
  return { low: Stars.idsAt('low'), star: Stars.idsAt('star') };
});
say('  the ↓ station is the one marked, and the ★ one is untouched by it',
  excluded.low.join() === 'ST-C' && excluded.star.join() === 'ST-A',
  '↓ ' + excluded.low.join() + ' · ★ ' + excluded.star.join());

/* Start a circuit and prove the ↓ station is not in it. Three stations
   exist and one is excluded, so a circuit of three can only be two. */
await page.evaluate(() => {
  [...document.querySelectorAll('.os-pick-b')].find(b => b.dataset.mode === 'random').click();
  document.querySelector('#os-count').querySelector('[data-n="3"]').click();
});
await page.waitForTimeout(300);
await page.click('#os-sim-go');
await page.waitForTimeout(1500);
const circuit = await page.evaluate(() => {
  const sid = location.hash.split('/').pop();
  const s = JSON.parse(localStorage.getItem('aureum.osce:' + sid) || '{}');
  return { ids: s.stations || [], blind: !!s.blind };
});
say('the circuit drawn does not contain it', !circuit.ids.includes('ST-C'), circuit.ids.join(', '));
say('  and it is still a blind sitting', circuit.blind);

/* ---------------------------------------------------------------- */
sec('5. SKIPPING ONE WITHOUT ENDING THE ROUND');

const brief = await page.evaluate(() => {
  const t = document.getElementById('view').textContent.replace(/\s+/g, ' ');
  return { skip: !!document.querySelector('#os-skipst'),
    label: (document.querySelector('#os-skipst')?.textContent || '').replace(/\s+/g, ' ').trim(),
    sealed: /Topic sealed until the end/.test(t) || /The examiner does not tell you what this station is about/.test(t),
    txt: t };
});
say('a circuit station offers to be skipped before its clock starts', brief.skip, brief.label);
say('  it says what happens to it', /counts neither for you nor against you/.test(brief.txt));
say('  and skipping does not break the blind rule — no topic is named', brief.sealed);

const before = await page.evaluate(() => {
  const sid = location.hash.split('/').pop();
  const s = JSON.parse(localStorage.getItem('aureum.osce:' + sid) || '{}');
  return { sid, at: s.at, first: s.stations[s.at] };
});
await page.click('#os-skipst');
await page.waitForTimeout(1400);
const after = await page.evaluate(sid => {
  const s = JSON.parse(localStorage.getItem('aureum.osce:' + sid) || '{}');
  let marks = {}; try { marks = JSON.parse(localStorage.getItem('aureum.osce-marks:' + sid) || '{}'); } catch {}
  return { at: s.at, phase: s.phase, elapsed: s.elapsed, marks, hash: location.hash };
}, before.sid);
say('skipping moves to the next station', after.at === before.at + 1, 'station ' + (after.at + 1));
say('  the clock for the new one has not started', after.elapsed === 0 && after.phase === 'brief');
say('  and it stays in the circuit, not on some other page', /#\/osce\/run\//.test(after.hash));
say('the skipped one is recorded as NEVER SAT, not as said-nothing',
  after.marks[before.first]?.status === 'notSat', after.marks[before.first]?.status || 'nothing written');
say('  with the reason on it', /Skipped before the clock started/.test(after.marks[before.first]?.message || ''));

/* The last station has nowhere to skip to — Next is the only way out. */
const lastOne = await page.evaluate(() => !document.querySelector('#os-skipst'));
say('the last station of a circuit is not offered a skip', lastOne);

/* ---------------------------------------------------------------- */
sec('6. A BLOCKED POPUP IS NOT AN EXPIRED PERMISSION');

const drive = await page.evaluate(async () => {
  /* Pretend Google is loaded and a folder is connected, then make the
     silent token request fail the two different ways it can.

     ONE client object, switched between behaviours: the real module
     memoises the token client for the life of the page, which is how the
     library is meant to be used — so a test that swapped
     initTokenClient between the two runs would never exercise the
     second, and would pass while proving nothing. */
  const mark = src => { const s = document.createElement('script'); s.src = src; document.head.appendChild(s); };
  mark('https://accounts.google.com/gsi/client');
  mark('https://apis.google.com/js/api.js');
  window.gapi = { load: (_, cb) => cb() };
  window.__mode = 'blocked';
  window.google = { accounts: { oauth2: {
    initTokenClient: o => (window.__c = {
      callback: o.callback, error_callback: null,
      requestAccessToken: () => setTimeout(() => {
        if (window.__mode === 'blocked') {
          // Safari blocks any popup not opened by a tap, and the probe
          // before a station is not a tap. Nothing is wrong with the grant.
          window.__c.error_callback({ type: 'popup_failed_to_open', message: 'Popup window failed to open' });
        } else {
          // Google actually refused: the grant is gone.
          window.__c.callback({ error: 'access_denied', error_description: 'Access blocked' });
        }
      }, 0)
    }),
    revoke: () => {}
  } }, picker: {} };

  localStorage.setItem('aureum.drive', JSON.stringify({
    folderId: 'f1', folderName: 'OSCE recordings', since: Date.now(), saved: 3 }));
  const out = {};
  out.start = Drive.status().code;
  await Drive.probe();
  out.afterBlocked = Drive.status().code;
  window.__mode = 'refused';
  await Drive.probe();
  out.afterRefused = Drive.status().code;
  return out;
});
say('a connected folder starts connected', drive.start === 'connected', drive.start);
say('a popup the browser would not open leaves the connection ALONE — the bug that made it ask every time',
  drive.afterBlocked === 'connected', drive.afterBlocked);
say('a real refusal from Google still marks it stale', drive.afterRefused === 'stale', drive.afterRefused);

const src = await (await fetch(B + '/js/drive.js')).text();
say('and a stale flag no longer stops a tape being tried at all',
  !/if \(state\(\)\.lapsed\) \{ note\(/.test(src) && /A LAPSED FLAG IS A WARNING, NOT A LOCK/.test(src));
say('  the upload gates on having a folder, not on a clean bill of health',
  /if \(!configured\(\) \|\| !state\(\)\.folderId\) return null;/.test(src));
say('  and the account is named on renewal so no chooser has to open', /hint: state\(\)\.email/.test(src));

/* ---------------------------------------------------------------- */
sec('7. STAMPS');
const stamps = await page.evaluate(() => {
  const v = [...document.scripts].map(s => (s.src.match(/\?v=(\d+)/) || [])[1]).filter(Boolean);
  return { set: [...new Set(v)], stars: [...document.scripts].some(s => /stars\.js/.test(s.src)) };
});
say('one version across every asset', stamps.set.length === 1, stamps.set.join(', '));
const sw = await (await fetch(B + '/sw.js')).text();
say('  the service worker agrees', sw.includes("'aureum-v" + stamps.set[0] + "'"));
say('  and the marks module is on the page', stamps.stars);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
