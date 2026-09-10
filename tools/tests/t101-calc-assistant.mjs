/* t101 — the calculators, and an assistant that would rather not ask a
   model.

   §1 is the arithmetic, checked against values worked out by hand. These
   are the assertions that matter most in the whole suite: everything
   else in AUREUM being wrong costs a candidate some revision, and a
   wrong gestational age or magnesium volume is a different kind of
   wrong. Each one here is a number somebody could check on paper.

   §2 is the routing, which is the whole design of the assistant. The
   claim being tested is not "it answers" — anything answers — but that
   it answers WITHOUT a model whenever a model is the less reliable of
   the two available answers. So the test watches the network: a
   calculation, a question about AUREUM and a search must all produce an
   answer with ZERO requests behind them.

   §3 is the window itself, in the corner fan.

   Run with the site served locally on 8907. */
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

/* Every call to the AI is counted and stubbed. Counting is the point:
   the assistant's whole claim is about how rarely this fires. */
await ctx.addInitScript(() => {
  window.__ai = [];
  const wire = () => {
    Backend.getAccessToken = async () => 'tok';
    const real = window.fetch;
    window.fetch = async (u, o) => {
      let b = {}; try { b = JSON.parse(o?.body || '{}'); } catch {}
      if (b.action) {
        window.__ai.push(b.action);
        if (b.action === 'assist') {
          return new Response(JSON.stringify({
            text: 'The short answer, from a model.', model: 'llama-3.3-70b', free: true,
            usage: { in: 0, out: 0 } }), { status: 200 });
        }
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

await page.evaluate(async () => {
  await Backend.publishOsceStation({
    id: 'T-PPH', topic: 'Postpartum haemorrhage', scenario: 'A 28-year-old woman one hour after delivery.',
    station_time_min: 15, total_marks: 20, pass_mark_percent: 70,
    questions: [{ id: 1, prompt: 'Priorities?', marks: 20, marking_points: ['Call for help', 'Oxytocin'] }] });
  await Backend.publishOsceStation({
    id: 'T-SEP', topic: 'Sepsis in pregnancy', scenario: 'Fever at 30 weeks.',
    station_time_min: 15, total_marks: 20, pass_mark_percent: 70,
    questions: [{ id: 1, prompt: 'Priorities?', marks: 20, marking_points: ['Cultures', 'Antibiotics within the hour'] }] });
  OSCE.bustStations?.();
});

/* ---------------------------------------------------------------- */
sec('1. THE ARITHMETIC, AGAINST NUMBERS WORKED OUT BY HAND');

const m = await page.evaluate(() => {
  const C = Calc;
  const g = C.fromLmp('2026-01-01', 28, '2026-06-01');       // 1 Jan + 280 = 8 Oct; 151 days = 21+4
  const long = C.fromLmp('2026-01-01', 35, '2026-06-01');    // a 35-day cycle is a week later
  const s = C.fromScan('2026-03-01', 12, 3, '2026-06-01');   // 87 days done, 193 to go → 10 Sep
  const e = C.fromEdd('2026-10-08', '2026-06-01');
  return {
    edd: C.iso(g.edd), ga: g.ga, gaDays: g.gaDays, toGo: g.toGo, trimester: g.trimester,
    longEdd: C.iso(long.edd), adj: long.adj,
    scanEdd: C.iso(s.edd), scanGa: s.ga,
    fromEddGa: e.ga,
    redate: C.redate(g.edd, s.edd, 87),
    wd: C.wd(187),
    bishop: C.bishop({ dilatation: 2, effacement: 2, station: 2, consistency: 2, position: 2 }),
    unfav: C.bishop({ dilatation: 0, effacement: 0, station: 1, consistency: 1, position: 0 }),
    si: C.shockIndex(120, 90),
    siOk: C.shockIndex(80, 120),
    loss: C.bloodLoss(60, 1500),
    zus: C.mgso4('zuspan', 50),
    pri: C.mgso4('pritchard', 50),
    twenty: C.mgso4('zuspan', 20),
    iron: C.ganzoni(60, 8, 11),
    bmi: C.bmi(70, 165),
    apgar: C.apgar({ colour: 1, heart: 2, grimace: 1, tone: 2, respiration: 2 })
  };
});
say('LMP 1 Jan gives an EDD of 8 October', m.edd === '2026-10-08', m.edd);
say('  and on 1 June she is 21+4', m.ga === '21+4' && m.gaDays === 151, m.ga + ' (' + m.gaDays + ' days)');
say('  with 129 days to go, in the second trimester', m.toGo === 129 && m.trimester === 2, m.toGo + ' days · T' + m.trimester);
say('a 35-day cycle moves the due date a week later', m.longEdd === '2026-10-15' && m.adj === 7, m.longEdd);
say('12+3 on 1 March gives an EDD of 10 September', m.scanEdd === '2026-09-10', m.scanEdd);
say('  and the same EDD read back gives the same gestation', m.fromEddGa === m.ga, m.fromEddGa);
say('a 28-day gap at 12 weeks re-dates the pregnancy (limit 5)',
  m.redate.redate === true && m.redate.limit === 5 && m.redate.diff === 28, m.redate.diff + ' vs ' + m.redate.limit);
say('187 days is written 26+5', m.wd === '26+5', m.wd);

say('a Bishop of 2+2+2+2+2 is 10 and favourable',
  m.bishop.score === 10 && m.bishop.favourable === true, m.bishop.score + '/13');
say('  and 0+0+1+1+0 is 2 and unfavourable',
  m.unfav.score === 2 && m.unfav.favourable === false && /ripening/.test(m.unfav.verdict), m.unfav.score + '/13');

say('120 over 90 is a shock index of 1.33', m.si.si === 1.33 && m.si.tone === 'bad', m.si.si);
say('  and 80 over 120 is 0.67, which is normal', m.siOk.si === 0.67 && m.siOk.tone === 'ok', m.siOk.si);
say('1500 mL in a 60 kg woman is 25% of 6000 mL',
  m.loss.pct === 25 && m.loss.ebv === 6000 && /Class II/.test(m.loss.cls), m.loss.pct + '% · ' + m.loss.cls);
say('  and it is flagged as major haemorrhage', m.loss.major === true && m.loss.massive === false);

say('Zuspan: 4 g loading is 8 mL of 50%', m.zus.loading[0].ml === 8, m.zus.loading[0].ml + ' mL');
say('  and 1 g/hour is 2 mL/hour', m.zus.maintenance.ml === 2, m.zus.maintenance.ml + ' mL/h');
say('Pritchard: 5 g IM is 10 mL, and the 10 g IM loading is 20 mL',
  m.pri.maintenance.ml === 10 && m.pri.loading[1].ml === 20, m.pri.maintenance.ml + ' / ' + m.pri.loading[1].ml);
say('  a recurrent fit is 2 g = 4 mL', m.zus.recurrent.ml === 4, m.zus.recurrent.ml + ' mL');
say('a 20% ampoule changes the volume, not the dose',
  m.twenty.loading[0].g === 4 && m.twenty.loading[0].ml === 20, '4 g = ' + m.twenty.loading[0].ml + ' mL');
say('  the antidote and the monitoring travel with it',
  m.zus.monitoring.some(x => /calcium gluconate/i.test(x)) && m.zus.monitoring.some(x => /patellar/i.test(x)));

say('Ganzoni for 60 kg, Hb 8 → 11 is 932 mg',
  m.iron.deficit === 932 && /60 × \(11 − 8\) × 2\.4 \+ 500/.test(m.iron.working), m.iron.deficit + ' mg');
say('70 kg at 165 cm is a BMI of 25.7', m.bmi.bmi === 25.7 && m.bmi.band === 'Overweight', m.bmi.bmi);
say('an Apgar of 1+2+1+2+2 is 8 and reassuring',
  m.apgar.score === 8 && m.apgar.verdict === 'Reassuring', m.apgar.score + '/10');

/* ---------------------------------------------------------------- */
sec('2. THE ROUTER ASKS A MODEL LAST');

await page.evaluate(() => { window.__ai = []; Assist.show(); });
await page.waitForTimeout(900);

const ask = async q => {
  await page.evaluate(async t => {
    const inp = document.querySelector('[data-as-in]');
    inp.value = t;
    document.querySelector('[data-as-form]').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, q);
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const msgs = Assist._msgs();
    const last = msgs[msgs.length - 1] || {};
    const b = [...document.querySelectorAll('.as-msg.is-it .as-b')].pop();
    /* The whole text for matching, a short one for the console: an
       assertion against a truncated string tests the truncation. */
    const full = (b?.textContent || '').replace(/\s+/g, ' ').trim();
    return { kind: last.kind, tool: last.tool,
      badge: (b?.querySelector('.as-badge')?.textContent || '').trim(),
      text: full, short: full.slice(0, 90),
      calls: window.__ai.slice() };
  });
};

let r = await ask('how many weeks is she on 12 June?');
say('a gestational-age question is routed to the calculator', r.kind === 'calc' && r.tool === 'ga', r.kind + '/' + r.tool);
say('  the badge says it was worked out here, free', /worked out here/.test(r.badge), r.badge);
say('  and NOTHING was asked of the network', r.calls.length === 0, r.calls.length + ' calls');
say('  the calculator is live inside the answer, not a picture of one',
  await page.evaluate(() => !!document.querySelector('.as-calc .cl-tab.is-on')));

r = await ask('what is the magnesium sulphate dose for eclampsia?');
say('a dose question goes to the calculator too, not to a model',
  r.kind === 'calc' && r.tool === 'mgso4' && r.calls.length === 0, r.kind + '/' + r.tool);

r = await ask('how do I start a circuit?');
say('a question about AUREUM is answered from its own pages', r.kind === 'help', r.kind);
say('  the badge says so', /AUREUM/.test(r.badge), r.badge);
say('  it is the real answer, not a generated one', /Exam simulator/.test(r.text), r.short);
say('  still nothing on the network', r.calls.length === 0, r.calls.length + ' calls');

r = await ask('find me a postpartum haemorrhage station');
say('“find me a station” searches the real bank', r.kind === 'find', r.kind);
say('  and returns the station that is published', /Postpartum haemorrhage/.test(r.text), r.short);
say('  without asking anything either', r.calls.length === 0, r.calls.length + ' calls');

r = await ask('what did the RCOG change about twin delivery timing');
say('only a question none of them can answer reaches the AI', r.kind === 'ai', r.kind);
say('  which is the FIRST network call of the whole conversation',
  r.calls.length === 1 && r.calls[0] === 'assist', r.calls.join(', '));
say('  and the badge says it was asked, and what it cost', /asked the AI/.test(r.badge), r.badge);

/* The count is the headline claim of the whole design. */
const tally = await page.evaluate(() => window.__ai.length);
say('five questions, one model call', tally === 1, tally + ' of 5');

/* ---------------------------------------------------------------- */
sec('3. THE WINDOW, AND WHAT IT PROMISES');

const win = await page.evaluate(() => ({
  open: !!document.querySelector('.as-dock.is-open'),
  inFan: !!document.querySelector('.tr-fan [data-open="assist"]'),
  svg: !!document.querySelector('.tr-launch-as svg'),
  above: (() => {
    const fan = [...document.querySelectorAll('.tr-fan .tr-launch')];
    return fan.length > 1 && fan[0].dataset.open === 'assist';
  })()
}));
say('it lives in the corner fan with the chat and the scanner', win.inFan);
say('  with a drawn icon, not an emoji that changes per platform', win.svg);
say('  first out of the fan, so it is the one you see', win.above);
say('the window is open', win.open);

/* Clearing is a real reset, not a visual one. */
await page.click('.as-dock [data-act="clear"]');
await page.waitForTimeout(300);
say('clearing empties the conversation and offers the openers again',
  await page.evaluate(() => Assist._msgs().length === 0 && !!document.querySelector('.as-openers')));

/* Closing must actually close, and the fan button must come back. */
await page.click('.as-dock [data-act="close"]');
await page.waitForTimeout(400);
say('closing it puts the button back in the fan',
  await page.evaluate(() => !document.querySelector('.as-dock.is-open')
    && !document.querySelector('[data-open="assist"]')?.classList.contains('is-hidden')));

/* The full page and the popup are the same panel. */
await page.evaluate(() => { location.hash = '#/tools'; });
await page.waitForTimeout(900);
const tools = await page.evaluate(() => ({
  tabs: document.querySelectorAll('#tools-host .cl-tab').length,
  free: /nothing is sent anywhere/.test(document.getElementById('view').textContent),
  proto: /check them against your unit/i.test(document.getElementById('view').textContent)
}));
say('the calculators have their own page too', tools.tabs === 7, tools.tabs + ' tools');
say('  which says plainly that nothing leaves the device', tools.free);
say('  and that a revision aid is not a prescription', tools.proto);

/* ---------------------------------------------------------------- */
sec('4. WHAT THE MODEL IS AND IS NOT ALLOWED TO DO');
const srv = await (await fetch(B + '/functions/api/explain.js')).text().catch(() => '');
if (srv) {
  say('the assistant may not invent a page of this app', /Do not invent anything about AUREUM/.test(srv));
  say('  may not do arithmetic or give a dose', /Do not do arithmetic and do not give a drug dose/.test(srv));
  say('  and may not advise on a patient in front of them', /Do not give advice about the care of a particular patient/.test(srv));
  say('the real page list is sent with every question, so it can point somewhere real',
    /THE PAGES THAT EXIST/.test(srv));
  say('the free tier is tried before the paid one', /Groq first, because its free tier costs nothing/.test(srv));
  say('  and a free tier that is down costs the asker nothing but a second',
    /if \(!res\.ok\) return null;\s*\/\/ quota, outage, bad id/.test(srv));
} else {
  say('the server file could be read', false, 'not served');
}

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamps = await page.evaluate(() => {
  const v = [...document.scripts].map(s => (s.src.match(/\?v=(\d+)/) || [])[1]).filter(Boolean);
  return { set: [...new Set(v)],
    calc: [...document.scripts].some(s => /calc\.js/.test(s.src)),
    assist: [...document.scripts].some(s => /assist\.js/.test(s.src)) };
});
say('one version across every asset', stamps.set.length === 1, stamps.set.join(', '));
const sw = await (await fetch(B + '/sw.js')).text();
say('  the service worker agrees', sw.includes("'aureum-v" + stamps.set[0] + "'"));
say('  and both new modules are on the page', stamps.calc && stamps.assist);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
