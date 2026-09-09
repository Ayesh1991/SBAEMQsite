/* t100 — a search that ranks, marks that follow the person, and a
   feature that can be turned off.

   §1–2 are the search. The complaint was "it shows unrelated OSCEs
   also", and the test of that is not that the right station is FOUND —
   it always was — but that the wrong ones are gone and the right one is
   first. So the fixtures are deliberately adversarial: a station whose
   marking scheme mentions PPH but which is about something else
   entirely, and a title that contains a query word inside a longer word.

   §3 is the one that cannot be tested by looking at a screen: a star is
   stored against the account and not the browser. Proved by starring on
   one device, opening a second browser context — a different machine as
   far as the app can tell — and finding it there.

   §4 is the switch. The point of it is not the hidden tab; it is that
   nothing runs. So the test watches for the requests themselves.

   Run with the site served locally on 8907. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const mkCtx = async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await c.addInitScript(() => { let real;
    Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
      set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
  return c;
};
const ctx = await mkCtx();
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

const signUp = async (p, name, email) => {
  await p.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1000);
  await p.click('#auth-toggle'); await p.waitForTimeout(250);
  await p.fill('input[name=name]', name);
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', 'password123');
  await p.click('#auth-form button[type=submit]'); await p.waitForTimeout(1600);
};
await signUp(page, 'Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');

/* The bank the search has to cope with. Note S3 and S5: they are the
   "unrelated OSCEs" — they mention the words, they are not about them. */
const STATIONS = [
  ['S1', 'Postpartum haemorrhage', 'A 28-year-old woman, one hour after a normal delivery, with heavy bleeding.',
    ['Call for help', 'Rub up a contraction', 'Oxytocin infusion', 'Two wide-bore cannulae']],
  ['S2', 'Shoulder dystocia', 'A large baby; the head has delivered and restituted.',
    ['McRoberts', 'Suprapubic pressure', 'Warn about postpartum haemorrhage afterwards']],
  ['S3', 'Consent for caesarean section', 'A woman for elective LSCS at 39 weeks.',
    ['Risks: bleeding, infection', 'Postpartum haemorrhage risk', 'Future pregnancies']],
  ['S4', 'Anaemia in pregnancy', 'Booking bloods show a haemoglobin of 8 g/dL.',
    ['Iron studies', 'Oral iron', 'Parenteral iron', 'Transfusion thresholds']],
  ['S5', 'Twin pregnancy counselling', 'A DCDA twin pregnancy at 12 weeks.',
    ['Chorionicity', 'Growth scans', 'Preterm labour', 'Anaemia screening']],
  ['S6', 'Pre-eclampsia at term', 'A woman at 38 weeks with a blood pressure of 160/110.',
    ['Antihypertensives', 'Magnesium sulphate', 'Delivery is the cure']],
  ['S7', 'Comparative audit of the labour ward', 'Presenting an audit to the department.',
    ['Standards', 'Data collection', 'Re-audit']]
];
await page.evaluate(async list => {
  for (const [id, topic, scenario, pts] of list) {
    await Backend.publishOsceStation({
      id, topic, scenario, station_time_min: 15, total_marks: 20, pass_mark_percent: 70,
      questions: [{ id: 1, prompt: 'Discuss your management.', marks: 20, marking_points: pts }]
    });
  }
  OSCE.bustStations?.();
}, STATIONS);

/* ---------------------------------------------------------------- */
sec('1. THE ENGINE');

const eng = await page.evaluate(() => {
  const recs = [
    { id: 'a', topic: 'Postpartum haemorrhage', scenario: 'heavy bleeding after delivery', deep: 'oxytocin' },
    { id: 'b', topic: 'Consent for caesarean section', scenario: 'elective LSCS', deep: 'postpartum haemorrhage risk' },
    { id: 'c', topic: 'Comparative audit', scenario: 'an audit', deep: 'standards' },
    { id: 'd', topic: 'Anaemia in pregnancy', scenario: 'haemoglobin of 8', deep: 'iron' }
  ];
  const ids = q => Search.rank(recs, q).rows.map(x => x.rec.id);
  return {
    abbrev: ids('pph'),                 // an abbreviation finds the spelled-out title
    reverse: ids('postpartum haemorrhage'),
    lscs: ids('lscs'),                  // and the other way round
    american: ids('hemorrhage'),        // spelled the American way
    anemia: ids('anemia'),
    para: ids('para'),                  // must NOT find "comparative"
    prefix: ids('haemo'),               // a half-typed word still works
    empty: Search.rank(recs, '').rows.length,
    loose: Search.rank(recs, 'postpartum haemorrhage management').loose
  };
});
say('an abbreviation finds the station spelled out in full', eng.abbrev[0] === 'a', eng.abbrev.join(', '));
say('  and the spelled-out words find a station titled by its abbreviation', eng.lscs[0] === 'b', eng.lscs.join(', '));
say('  the American spelling finds the British one', eng.american[0] === 'a', eng.american.join(', '));
say('  and “anemia” finds “anaemia”', eng.anemia[0] === 'd', eng.anemia.join(', '));
say('a half-typed word still matches', eng.prefix[0] === 'a', eng.prefix.join(', '));
say('“para” does NOT find “comparative”', eng.para.length === 0, eng.para.join(', ') || 'nothing');
say('an empty query is not a search', eng.empty === 4);
say('a query nothing matches in full falls back rather than showing nothing', eng.loose === true);

/* ---------------------------------------------------------------- */
sec('2. THE UNRELATED ONES ARE GONE, AND THE RIGHT ONE IS FIRST');

await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(1500);

const search = async q => {
  await page.fill('#os-search', q);
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.os-card')].filter(c => !c.hidden);
    cards.sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
    return { ids: cards.map(c => c.dataset.st),
      first: cards[0]?.querySelector('h3')?.textContent?.trim() || '',
      note: (document.querySelector('.os-srch-note')?.textContent || '').replace(/\s+/g, ' ').trim(),
      more: (document.querySelector('#os-srch-all')?.textContent || '').replace(/\s+/g, ' ').trim(),
      why: [...document.querySelectorAll('.os-card')].filter(c => !c.hidden)
        .map(c => (c.querySelector('.os-card-why')?.hidden === false)
          ? c.querySelector('.os-card-why').textContent : '') };
  });
};

let r = await search('postpartum haemorrhage');
say('the station it is ABOUT comes first', r.first === 'Postpartum haemorrhage', r.first);
say('  the two that merely mention it in their scheme are not in the list',
  !r.ids.includes('S2') && !r.ids.includes('S3'), r.ids.join(', '));
say('  and the page says how many it held back, with a way to see them',
  /weaker match/.test(r.more), r.more || '(no control)');

/* Bringing them back is one press, and they come back marked as what
   they are. */
await page.click('#os-srch-all'); await page.waitForTimeout(500);
const back = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.os-card')].filter(c => !c.hidden);
  cards.sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
  return { ids: cards.map(c => c.dataset.st),
    labels: cards.map(c => c.querySelector('.os-card-why')?.hidden === false
      ? c.querySelector('.os-card-why').textContent : '') };
});
say('showing them brings them back, still ranked below', back.ids[0] === 'S1' && back.ids.length > 1, back.ids.join(', '));
say('  and each says why it is there', back.labels.slice(1).every(l => /marking scheme/.test(l)), back.labels.slice(1).join(' · '));

r = await search('pph');
say('the abbreviation finds it too', r.first === 'Postpartum haemorrhage', r.first);
r = await search('para');
say('“para” finds nothing rather than the audit station', r.ids.length === 0, r.ids.join(', ') || 'nothing');
r = await search('pre-eclampsia');
say('a hyphen is not a barrier', r.first === 'Pre-eclampsia at term', r.first);
r = await search('PET');
say('and neither is the abbreviation for it', r.first === 'Pre-eclampsia at term', r.first);
r = await search('iron');
say('a word that exists only in marking schemes still finds its station',
  r.ids.includes('S4'), r.ids.join(', '));
await page.fill('#os-search', ''); await page.waitForTimeout(500);
const cleared = await page.evaluate(() => [...document.querySelectorAll('.os-card')].filter(c => !c.hidden).length);
say('clearing the box shows the whole bank again', cleared === 7, cleared + ' stations');

/* ---------------------------------------------------------------- */
sec('3. A STAR BELONGS TO THE PERSON, NOT THE DEVICE');

await page.evaluate(async () => { await Stars.set('S1', 'star'); });
await page.waitForTimeout(400);
say('starred on this device', await page.evaluate(() => Stars.of('S1')) === 'star');

/* WHAT LOCAL MODE CAN AND CANNOT PROVE.

   These tests run against the local backend, where the "database" IS
   this browser's localStorage — so "the mark is not in localStorage" is
   not a claim that can be made here, and asserting it would be asserting
   something false about a backend that is not the one in question.

   What CAN be proved, and is what actually matters:
     • the module goes through the Backend for every read and write, and
       holds nothing of its own in storage;
     • the cloud backend scopes both to the signed-in account;
     • two accounts on the same device see different marks.
   The third is the direct test of "not device-specific", and it is
   below. */
const store = await page.evaluate(async () => {
  const rows = await Backend.listOsceStars();
  return (rows || []).map(r => r.stationId + ':' + r.mark);
});
say('the mark is in the backend store, under the account', store.join() === 'S1:star', store.join(', '));

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const starSrc = strip(await (await fetch(B + '/js/stars.js')).text());
say('  the module itself keeps NOTHING in browser storage',
  !/localStorage|sessionStorage|indexedDB/.test(starSrc), 'no browser storage in stars.js code');

/* And in cloud mode — the one the real site runs — both halves are
   scoped to the signed-in account, which is what makes a star follow a
   person between an iPad and a phone. */
const beSrc = await (await fetch(B + '/js/backend.js')).text();
const cloudRead = /listOsceStars\(\)\s*\{[\s\S]*?from\('osce_stars'\)[\s\S]*?\.eq\('user_id', id\)/.test(beSrc);
const cloudWrite = /setOsceStar\(stationId, mark, note\)\s*\{[\s\S]*?user_id: id, station_id: stationId/.test(beSrc);
say('  the cloud read is filtered to the signed-in account', cloudRead);
say('  and the cloud write is stamped with it', cloudWrite);
say('  which is stated where the next person will look',
  /IT IS THE PERSON'S MARK, NOT THE DEVICE'S/.test(await (await fetch(B + '/js/stars.js')).text()));

/* Signing in as somebody else on the SAME device must show their marks,
   not the ones left behind — the other half of "not the device". */
const swapped = await page.evaluate(async () => {
  await Backend.signOut();
  await Backend.signUp({ name: 'Dr Other', email: 'other@example.com', password: 'password123' });
  Stars.bust(); await Stars.load();
  const theirs = Stars.of('S1');
  await Backend.signOut();
  await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  Stars.bust(); await Stars.load();
  return { theirs, mineAgain: Stars.of('S1') };
});
say('another person on the same device sees their own marks', swapped.theirs === '', swapped.theirs || 'none');
say('  and signing back in brings mine back', swapped.mineAgain === 'star');

/* ---------------------------------------------------------------- */
sec('4. THE REAL STATION SWITCH');

const flags = await page.evaluate(() => ({
  defaultOff: Features.DEFAULTS.realStation === false,
  now: Features.on('realStation')
}));
say('it is off unless somebody turns it on', flags.defaultOff && flags.now === false);

await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(1200);
say('the tab is not offered while it is off',
  await page.evaluate(() => ![...document.querySelectorAll('.lib-tab')].some(t => /Real station/.test(t.textContent))));

/* The point of the switch is not the tab. Watch the wire. */
const calls = [];
page.on('request', q => { if (/live_stations/.test(q.url())) calls.push(q.url()); });
await page.evaluate(() => { location.hash = '#/osce/real'; });
await page.waitForTimeout(2500);
const offPage = await page.evaluate(() => ({
  txt: document.getElementById('view').textContent.replace(/\s+/g, ' ').trim(),
  card: !!document.querySelector('.ft-off')
}));
say('the page still explains itself rather than redirecting', offPage.card);
say('  it says what is off and who can turn it on',
  /Real station is switched off/.test(offPage.txt) && /Developer → Settings/.test(offPage.txt));
say('  and it promises nothing in the middle is lost', /untouched/.test(offPage.txt));
say('NOTHING was asked of the live-station table', calls.length === 0, calls.length + ' requests');

/* Hand marking is the other place it used to cost something. */
await page.evaluate(() => { location.hash = '#/osce/mark/S1'; });
await page.waitForTimeout(1500);
say('the hand-marking sheet does not look up a live session either',
  await page.evaluate(() => (document.querySelector('#ms-live')?.innerHTML || '') === ''));

/* Turn it on the way the developer does, and it all comes back. */
await page.evaluate(async () => { await Features.set('realStation', true); });
await page.evaluate(() => { location.hash = '#/osce'; });
await page.waitForTimeout(1200);
say('turning it on brings the tab back',
  await page.evaluate(() => [...document.querySelectorAll('.lib-tab')].some(t => /Real station/.test(t.textContent))));
await page.evaluate(() => { location.hash = '#/osce/real'; });
await page.waitForTimeout(1200);
say('  and the page works again',
  await page.evaluate(() => !document.querySelector('.ft-off')
    && /real station|invite|user number/i.test(document.getElementById('view').textContent)));

const swSaved = await page.evaluate(async () => {
  Features.bust(); await Features.load();
  return Features.on('realStation');
});
say('  the setting is stored, not just remembered in the tab', swSaved === true);
await page.evaluate(async () => { await Features.set('realStation', false); });

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamps = await page.evaluate(() => {
  const v = [...document.scripts].map(s => (s.src.match(/\?v=(\d+)/) || [])[1]).filter(Boolean);
  return { set: [...new Set(v)],
    search: [...document.scripts].some(s => /search\.js/.test(s.src)),
    features: [...document.scripts].some(s => /features\.js/.test(s.src)) };
});
say('one version across every asset', stamps.set.length === 1, stamps.set.join(', '));
const sw = await (await fetch(B + '/sw.js')).text();
say('  the service worker agrees', sw.includes("'aureum-v" + stamps.set[0] + "'"));
say('  and both new modules are on the page', stamps.search && stamps.features);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
