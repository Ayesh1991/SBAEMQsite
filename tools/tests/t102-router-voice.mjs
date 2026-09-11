/* t102 — the assistant reads the question properly, and the examiner's
   voice is a choice.

   §1 is a regression table, and it is the point of this file. Three real
   questions came back with three hundred and nineteen, two hundred and
   thirty-eight and one hundred and sixty-eight unrelated stations, and
   every one of them was a question about how to USE the application read
   as a request to SEARCH it. So the table below is written as
   question → what must come back, and it includes every phrasing that
   was wrong as well as the ones that were right, because a fix that
   breaks what already worked is not a fix.

   §2 tests the two engine faults underneath that: a query was tokenised
   without dropping stopwords, and the "matched some words" fallback had
   no ceiling. Between them, seven words of ordinary English matched most
   of the bank.

   §3 is the voice. The claim is not that a toggle exists — it is that
   choosing this device's voice stops the studio one being FETCHED, and
   that the trade-off (only the studio voice reaches the tape by itself)
   is stated before the choice rather than discovered afterwards. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
await ctx.addInitScript(() => {
  window.__ai = [];
  const wire = () => {
    Backend.getAccessToken = async () => 'tok';
    const real = window.fetch;
    window.fetch = async (u, o) => {
      let b = {}; try { b = JSON.parse(o?.body || '{}'); } catch {}
      if (b.action) {
        window.__ai.push({ action: b.action, found: (b.found || []).length });
        if (b.action === 'assist') return new Response(JSON.stringify({
          text: 'A short answer.', model: 'llama-3.3-70b', free: true, usage: { in: 0, out: 0 } }), { status: 200 });
        if (b.action === 'tts') return new Response(JSON.stringify({ audio: 'AAAA', mime: 'audio/wav', model: 'orpheus' }), { status: 200 });
        return new Response('{}', { status: 503 });
      }
      return real(u, o);
    };
  };
  if (window.Backend) wire(); else window.addEventListener('load', () => setTimeout(wire, 250));
});

const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.click('#auth-toggle'); await page.waitForTimeout(250);
await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1600);

/* A bank shaped like the real one: long teaching titles that share
   ordinary words with any sentence somebody might type. This is what
   made the old router fail, so the fixture has to reproduce it. */
await page.evaluate(async () => {
  const T = [
    'Teaching a first-year registrar, step by step, how to conduct a vaginal breech delivery',
    'Teaching a junior colleague how to manage inferior epigastric vessel injury at laparoscopy',
    'Teaching a junior colleague the basics of gynaecological laparoscopic surgery',
    'Osteoporosis Assessment and Management in a Postmenopausal Woman with Breast Cancer',
    'Consent for Surgical Termination of Pregnancy in a Competent Minor',
    'Vulval Itching in an Older Woman - Lichen Sclerosis and Progression to VIN',
    'Postpartum haemorrhage after a normal delivery',
    'Pre-eclampsia at term', 'Shoulder dystocia', 'Sepsis in pregnancy', 'Twin pregnancy counselling'
  ];
  for (let i = 0; i < T.length; i++) {
    await Backend.publishOsceStation({
      id: 'S' + i, topic: T[i],
      scenario: 'You are asked to demonstrate, using a dummy and a pelvis, how you would teach a first-year.',
      station_time_min: 15, total_marks: 20, pass_mark_percent: 70,
      questions: [{ id: 1, prompt: 'Discuss your management.', marks: 20,
        marking_points: ['a point about management', 'another point'] }] });
  }
  await Backend.publishEssayPaper({ id: 'P1', examTitle: 'MD (O&G) Part II',
    sections: [{ sectionTitle: 'A', questions: [{ code: 'MOB-Q1', type: 'SEQ', totalMarks: 100,
      stem: 'Discuss the identification and management of pre-eclampsia in Sri Lanka.',
      parts: [{ label: '(a)', text: 'Identification', marks: 40 }] }] }] });
  OSCE.bustStations?.(); Essay.bustPapers?.();
});

const routeOf = q => page.evaluate(async t => {
  const r = await Assist.route(t);
  return r ? { kind: r.kind, id: r.entry?.id || r.tool || '', n: (r.hits || []).length,
    first: (r.hits || [])[0] ? r.hits[0].kind + ':' + r.hits[0].topic : '' } : { kind: 'ai', id: '', n: 0, first: '' };
}, q);

/* ---------------------------------------------------------------- */
sec('1. THE THREE THAT WERE WRONG, AND EVERYTHING AROUND THEM');

/* [question, expected kind, expected entry/tool id] — '' means any. */
const TABLE = [
  // the three from the report, verbatim
  ['how to write essay and get marked',              'help', 'essay'],
  ['how can we do a osce in AI',                     'help', 'aiosce'],
  ['how to do osce in aureum',                       'help', 'circuit'],
  // the same intents said differently
  ['how do i get my essay marked',                   'help', 'essay'],
  ['how do i start a circuit',                       'help', 'circuit'],
  ['how do i sit a station against claude',          'help', 'aiosce'],
  ['how do i star a station',                        'help', 'star'],
  ['how do i mark my friend',                        'help', 'hand'],
  ['where are my recordings',                        'help', 'record'],
  ['my balance is zero why',                         'help', 'balance'],
  ['what is due in recall today',                    'help', 'recall'],
  ['is there a way to print the marking scheme',     'help', 'print'],
  ['how to disable the examiner voice',              'help', 'voice'],
  // searches — these must still work
  ['find me a postpartum haemorrhage station',       'find', ''],
  ['shoulder dystocia',                              'find', ''],
  ['breech',                                         'find', ''],
  ['any essay question on pre-eclampsia',            'find', ''],
  // arithmetic
  ['how many weeks on 12 june',                      'calc', 'ga'],
  ['what is the magnesium dose in eclampsia',        'calc', 'mgso4'],
  // courtesy
  ['hello',                                          'hello', ''],
  ['thanks',                                         'hello', ''],
  // genuinely clinical — the one kind a model is the best answer to
  ['what does hellp stand for',                      'ai', ''],
  ['what is the management of shoulder dystocia',    'ai', '']
];
for (const [q, kind, id] of TABLE) {
  const r = await routeOf(q);
  const ok = r.kind === kind && (!id || r.id === id);
  say(`“${q}”`, ok, r.kind + (r.id ? '/' + r.id : '') + (r.n ? ' ·' + r.n : ''));
}

/* The specific failure: a how-to must never come back as a pile of
   stations, however many words it shares with them. */
const essayQ = await routeOf('how to write essay and get marked');
say('a how-to returns NO station list at all', essayQ.n === 0, essayQ.n + ' hits');
const found = await routeOf('any essay question on pre-eclampsia');
say('“any essay question on X” searches the essays, not the MCQs',
  /^essay:/.test(found.first), found.first);

/* ---------------------------------------------------------------- */
sec('2. THE TWO ENGINE FAULTS UNDERNEATH IT');

const eng = await page.evaluate(() => ({
  stop: Search.terms('how to write essay and get marked'),
  keptWhenAllStop: Search.terms('how are you'),
  loose: Search.rank(
    Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, topic: 'Teaching a junior how to manage something ' + i,
      scenario: 'you are asked to demonstrate', deep: '' })),
    'how to write essay and get marked'),
  real: Search.rank([{ id: 'a', topic: 'Postpartum haemorrhage', scenario: 'bleeding', deep: '' },
    { id: 'b', topic: 'Sepsis', scenario: 'fever', deep: '' }], 'postpartum haemorrhage')
}));
say('ordinary English words are not search terms',
  eng.stop.join() === 'write,essay,marked', eng.stop.join(', '));
say('  unless that is all there is', eng.keptWhenAllStop.length === 3, eng.keptWhenAllStop.join(', '));
say('a sentence no longer matches most of the bank', eng.loose.rows.length === 0,
  eng.loose.rows.length + ' of 40');
say('  while a real query still finds its station', eng.real.rows.length === 1 && eng.real.rows[0].rec.id === 'a');

/* ---------------------------------------------------------------- */
sec('3. THE MODEL IS GIVEN WHAT AUREUM ALREADY FOUND');

await page.evaluate(() => { window.__ai = []; Assist.show(); });
await page.waitForTimeout(900);
await page.evaluate(() => {
  document.querySelector('[data-as-in]').value = 'what is the management of shoulder dystocia';
  document.querySelector('[data-as-form]').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
});
await page.waitForTimeout(1200);
const grounded = await page.evaluate(() => ({
  calls: window.__ai.slice(),
  srcs: [...document.querySelectorAll('.as-msg.is-it .as-hit')].map(a => a.textContent.replace(/\s+/g, ' ').trim()),
  header: !!document.querySelector('.as-srcs-h')
}));
say('a clinical question reaches the model', grounded.calls.length === 1, grounded.calls.length + ' calls');
say('  with what AUREUM holds on it attached',
  (grounded.calls[0]?.found || 0) > 0, (grounded.calls[0]?.found || 0) + ' items sent');
say('  and those items are shown under the answer as sources',
  grounded.header && grounded.srcs.some(s => /Shoulder dystocia/.test(s)), grounded.srcs[0] || 'none');

/* ---------------------------------------------------------------- */
sec('4. WHICH VOICE READS THE QUESTIONS');

const v = await page.evaluate(() => ({ def: OSCE.voiceSrc(), on: OSCE.speakOn(), VSRC: OSCE.VSRC }));
say('this device’s own voice is the default', v.def === 'device' && v.on === true, v.def);

/* Start a station and look at the brief. */
await page.evaluate(async () => {
  Assist.close();
  const sid = 'vt-1';
  localStorage.setItem('aureum.osce:' + sid, JSON.stringify({
    id: sid, stations: ['S7'], at: 0, phase: 'brief', answers: {}, elapsed: 0, started: Date.now() }));
  location.hash = '#/osce/run/' + sid;
});
await page.waitForTimeout(1600);
const brief = await page.evaluate(() => {
  const seg = document.querySelector('#os-vsrc-seg');
  return { there: !!seg,
    on: seg?.querySelector('button.is-on')?.dataset.v || '',
    opts: [...(seg?.querySelectorAll('button') || [])].map(b => b.dataset.v),
    say: (document.querySelector('#os-vsrc-say')?.textContent || '').replace(/\s+/g, ' ').trim() };
});
say('the choice is on the brief, before the clock starts', brief.there);
say('  three ways: this device, studio, or off', brief.opts.join() === 'device,studio,off', brief.opts.join(', '));
say('  and it opens on this device’s voice', brief.on === 'device', brief.on);
say('  which warns that the tape will not have the questions on it',
  /microphone hears the speaker/.test(brief.say), brief.say.slice(0, 80));

/* The claim that matters: choosing the device voice means nothing is
   FETCHED from the studio, not merely that it is not played. */
const quiet = await page.evaluate(() => window.__ai.filter(c => c.action === 'tts').length);
say('nothing was fetched from the studio while it is switched off', quiet === 0, quiet + ' tts calls');

await page.click('#os-vsrc-seg [data-v="studio"]');
await page.waitForTimeout(1200);
const studio = await page.evaluate(() => ({
  tts: window.__ai.filter(c => c.action === 'tts').length,
  say: (document.querySelector('#os-vsrc-say')?.textContent || '').replace(/\s+/g, ' ').trim(),
  line: (document.querySelector('#os-voiceline')?.textContent || '').replace(/\s+/g, ' ').trim(),
  saved: OSCE.voiceSrc()
}));
say('choosing the studio voice fetches it', studio.tts > 0, studio.tts + ' tts calls');
say('  and says it is the only one that reaches the recording by itself',
  /straight into the recording/.test(studio.say));
say('  the choice is remembered', studio.saved === 'studio', studio.saved);

await page.click('#os-vsrc-seg [data-v="off"]');
await page.waitForTimeout(500);
const off = await page.evaluate(() => ({
  on: OSCE.speakOn(), say: (document.querySelector('#os-vsrc-say')?.textContent || '').trim(),
  line: document.querySelector('#os-voiceline')?.hidden
}));
say('off means nothing is read aloud', off.on === false && /nothing is read aloud/.test(off.say));
say('  and the studio note is not shown for a voice nobody chose', off.line === true);
await page.evaluate(() => { OSCE.setSpeakOn(true); OSCE.setVoiceSrc('device'); });

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamps = await page.evaluate(() => {
  const v = [...document.scripts].map(s => (s.src.match(/\?v=(\d+)/) || [])[1]).filter(Boolean);
  return [...new Set(v)];
});
say('one version across every asset', stamps.length === 1, stamps.join(', '));
const sw = await (await fetch(B + '/sw.js')).text();
say('  the service worker agrees', sw.includes("'aureum-v" + stamps[0] + "'"));

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
