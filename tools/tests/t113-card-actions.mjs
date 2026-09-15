/* t113 — the card does the work, not the page behind it.

   THE REQUEST. Every station in the bank already had seven things you
   could do with it, and all seven lived on the station's own page —
   behind one more tap and a page of reading you have usually done
   before. The card is where the decision is made. So the doing moved
   there: a row of seven at the foot of every card, the play first,
   the QR last, and pressing the card itself still opens the page as it
   always did.

   And the date it went into AUREUM, small, at the top left. The row's
   own insert time, which is the one date nobody has to remember to set —
   `created_on` is written by whoever authored a station and is missing
   from most of the bank.

   THE TRAP THIS FILE EXISTS FOR: the card is an ANCHOR. Without stopping
   the event, every one of those seven buttons would also open the
   station's page underneath itself — which is what the bucket and the
   star already had to learn. Each one is asserted to do its own thing
   and NOT to navigate. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });

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

await page.evaluate(async () => {
  const mk = (id, topic, sc) => ({ id, topic, scenario: sc, station_time_min: 15,
    total_marks: 100, pass_mark_percent: 70,
    questions: [
      { id: 1, prompt: 'What are the causes of premature ovarian insufficiency?', marks: 12,
        marking_points: ['Turner syndrome (45,X) due to premature follicular atresia (2)',
          'Fragile X syndrome, FMR1 premutation (2)'] },
      { id: 2, prompt: 'How would you investigate her?', marks: 10,
        marking_points: ['Karyotype (2)', 'Pelvic ultrasound to assess the Mullerian structures (2)'] }
    ] });
  await Backend.publishOsceStation(mk('FGR1', 'Fetal Growth Restriction (FGR)',
    'Mrs Sarasi is a 26-year-old primigravida with a symphysio-fundal height less than her period of amenorrhoea.'));
  await Backend.publishOsceStation(mk('PIH1', 'Pre-eclampsia with FGR',
    'A 22-year-old second para is admitted with a headache and a blood pressure of 160/100.'));
  OSCE.bustStations?.();
});

const bank = async () => {
  await page.evaluate(() => { location.hash = '#/osce'; });
  await page.waitForTimeout(1200);
};
const first = '.os-card[data-st="FGR1"]';
await bank();

/* ---------------------------------------------------------------- */
sec('1. SEVEN, IN ONE ROW, ON EVERY CARD');

const row = await page.evaluate(sel => {
  const cards = [...document.querySelectorAll('.os-card')];
  const c = document.querySelector(sel);
  const bs = [...c.querySelectorAll('[data-cact]')];
  const tops = bs.map(b => Math.round(b.getBoundingClientRect().top));
  const cardR = c.getBoundingClientRect();
  const rowR = c.querySelector('.os-card-acts').getBoundingClientRect();
  return {
    cards: cards.length,
    everyCard: cards.every(x => x.querySelectorAll('[data-cact]').length === 7),
    order: bs.map(b => b.dataset.cact),
    oneRow: new Set(tops).size === 1,
    /* At the foot of the card, under everything else. */
    atFoot: rowR.bottom <= cardR.bottom + 1 && rowR.top > cardR.top + cardR.height / 2,
    fills: rowR.width > cardR.width * 0.75,
    named: bs.every(b => (b.getAttribute('aria-label') || '').length > 3),
    icons: bs.every(b => !!b.querySelector('svg')),
    gone: !document.querySelector('.os-card-go')
  };
}, first);
say('every card carries seven', row.everyCard, row.cards + ' cards');
say('  play, reading, scheme, by hand, copy, AI, QR',
  row.order.join() === 'play,read,scheme,hand,copy,ai,qr', row.order.join(', '));
say('  in ONE row, at the foot of the card', row.oneRow && row.atFoot);
say('  spread across its width', row.fills);
say('  every one an icon, and every one named', row.icons && row.named);
say('  and "Start →" is gone, because the play is it', row.gone);

/* ---------------------------------------------------------------- */
sec('2. THE DAY IT WENT INTO AUREUM');

const when = await page.evaluate(sel => {
  const c = document.querySelector(sel);
  const w = c.querySelector('.os-card-when');
  if (!w) return null;
  const r = w.getBoundingClientRect(), cr = c.getBoundingClientRect();
  return { text: w.textContent.trim(), title: w.getAttribute('title') || '',
    left: r.left - cr.left < cr.width / 3, top: r.top - cr.top < 40,
    small: parseFloat(getComputedStyle(w).fontSize) < 12 };
}, first);
say('the card says when the station was added', !!when && /20\d\d/.test(when.text), when?.text);
say('  at the top left, in small letters', when.left && when.top && when.small);
say('  and says so in full on a hover', /Added to AUREUM/.test(when.title), when.title);

/* ---------------------------------------------------------------- */
sec('3. EACH BUTTON DOES ITS OWN THING — AND ONLY ITS OWN');

/* THE ANCHOR TRAP. The card is a link; a button inside it that does not
   stop the event opens the station page as well as doing its job. */
const press = async act => {
  await bank();
  const before = await page.evaluate(() => location.hash);
  await page.click(`${first} [data-cact="${act}"]`);
  await page.waitForTimeout(700);
  return { before, after: await page.evaluate(() => location.hash) };
};

const scheme = await press('scheme');
const schemeOn = await page.evaluate(() => ({
  modal: !!document.querySelector('.os-modal'),
  hasPoints: /Turner syndrome/.test(document.querySelector('.os-modal')?.textContent || '')
}));
say('the scheme opens over the bank', schemeOn.modal && schemeOn.hasPoints);
say('  without opening the station page underneath it',
  scheme.after === '#/osce', scheme.after);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

const read = await press('read');
const readOn = await page.evaluate(() => ({
  veil: !!document.querySelector('.rd-veil'),
  bar: !!document.querySelector('#an-bar'),
  topic: /Fetal Growth Restriction/.test(document.querySelector('.rd-doc')?.textContent || '')
}));
say('reading mode opens from the card, with the pencil case',
  readOn.veil && readOn.bar && readOn.topic);
say('  and the bank is still what is underneath', read.after === '#/osce', read.after);
await page.evaluate(() => document.querySelector('[data-rd-close]')?.click());
await page.waitForTimeout(400);

const copy = await press('copy');
const copied = await page.evaluate(async () => {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch {}
  return { t, flagged: !!document.querySelector('[data-cact="copy"].is-done') };
});
say('copy puts the station on the clipboard',
  /Fetal Growth Restriction/.test(copied.t) && /premature ovarian/i.test(copied.t),
  copied.t.slice(0, 40).replace(/\n/g, ' ') + '…');
/* The whole point of the copy button: it is for pasting into a chat
   model, and the marking scheme is the answers. */
say('  WITHOUT the marking scheme', !/Turner syndrome/.test(copied.t));
say('  and the icon says it worked, rather than being replaced by its own SVG',
  copied.flagged);
say('  still on the bank', copy.after === '#/osce', copy.after);

const qr = await press('qr');
const qrOn = await page.evaluate(() => {
  const v = document.querySelector('.qc-veil');
  return { veil: !!v, svg: !!v?.querySelector('svg'),
    url: v?.querySelector('.qc-url')?.textContent || '' };
});
say('the QR opens as a window over the bank', qrOn.veil && qrOn.svg);
say('  holding a link to THIS station', /osce\/station\/FGR1/.test(qrOn.url), qrOn.url.slice(-40));
say('  and the bank is still underneath', qr.after === '#/osce', qr.after);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

const ai = await press('ai');
const aiOn = await page.evaluate(() => ({
  modal: !!document.querySelector('.ai-modal'),
  topic: /Fetal Growth Restriction/.test(document.querySelector('.ai-modal')?.textContent || '')
}));
say('OSCE in AI opens for this station', aiOn.modal && aiOn.topic);
say('  and the bank is still underneath', ai.after === '#/osce', ai.after);
await page.keyboard.press('Escape'); await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('.ai-modal')?.remove());

const hand = await press('hand');
say('marking by hand goes to the marking sheet for this station',
  hand.after === '#/osce/mark/FGR1', hand.after);

const play = await press('play');
const ran = await page.evaluate(() => ({
  run: /^#\/osce\/run\//.test(location.hash),
  station: /Fetal Growth Restriction/.test(document.body.textContent)
}));
say('the play starts THIS station, with the clock', ran.run && ran.station, play.after);

/* ---------------------------------------------------------------- */
sec('4. AND THE CARD ITSELF STILL OPENS THE STATION');

await bank();
await page.evaluate(sel => document.querySelector(sel + ' h3').click(), first);
await page.waitForTimeout(900);
const opened = await page.evaluate(() => ({ hash: location.hash,
  brief: !!document.querySelector('#os-start') }));
say('pressing anywhere else on the card opens its page, as it always did',
  opened.hash === '#/osce/station/FGR1' && opened.brief, opened.hash);

/* ---------------------------------------------------------------- */
sec('5. AND SEVEN STILL FIT ON A PHONE');

/* Seven buttons is a lot for a 400px card, and a row that wraps to two
   is not the row that was asked for. */
await page.setViewportSize({ width: 400, height: 900 });
await bank();
const narrow = await page.evaluate(sel => {
  const c = document.querySelector(sel);
  const bs = [...c.querySelectorAll('[data-cact]')];
  const tops = bs.map(b => Math.round(b.getBoundingClientRect().top));
  const w = Math.round(bs[0].getBoundingClientRect().width);
  const cr = c.getBoundingClientRect();
  const over = bs.some(b => {
    const r = b.getBoundingClientRect();
    return r.left < cr.left - 1 || r.right > cr.right + 1;
  });
  return { oneRow: new Set(tops).size === 1, w, over,
    tall: Math.round(bs[0].getBoundingClientRect().height) };
}, first);
say('still one row at phone width', narrow.oneRow, narrow.w + ' px each');
say('  and none of them spills out of the card', !narrow.over);
/* Small enough to fit, big enough to hit. */
say('  each still a real target', narrow.w >= 28 && narrow.tall >= 30,
  narrow.w + ' × ' + narrow.tall);
await page.setViewportSize({ width: 1400, height: 1000 });

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v113/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '113', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
