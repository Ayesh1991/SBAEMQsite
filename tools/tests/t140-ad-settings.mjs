/* t140 — making the ad system assessable.

   v139 shipped a pre-roll ITS OWN AUTHOR COULD NOT SEE. Ads go to free
   accounts, staff are exempt, once a session, and the impression dedups
   per day. Every one of those is the right rule for candidates, and
   between them they make the feature impossible to check: the developer
   never sees an ad at all, and having tested the count once there is
   nothing more to learn for 24 hours.

   §2 IS THE LINE THIS RELEASE WALKS. Every switch changes WHO LOOKS at
   an ad; not one of them changes WHAT IS COUNTED. The per-day unique
   index is the whole basis of the figure a drug company is handed, and
   if a testing setting could move it the setting would be a way of
   inflating an invoice. "Show every time" is therefore safe to leave on
   — ten views in an afternoon is still one doctor, one impression — and
   §2 proves it rather than asserting it in a comment.

   §4 IS THE SAME ARGUMENT ABOUT THE TEST AID. Clearing impressions so
   the count can be tried again is exactly the shape of a hole: delete
   and re-insert is how a unique index is defeated. So it is the
   narrowest possible — an editor, their own rows, today — and a
   candidate cannot do it at all. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const WEBM = '/ads/sample-5s.webm';   // the only codec this Chromium decodes

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

const signIn = async (email, name) => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.click('#auth-toggle'); await page.waitForTimeout(300);
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1700);
};
await signIn('ayeshmantha@gmail.com', 'Dr Didula Ayeshmantha');

const setup = async () => page.evaluate(async (WEBM) => {
  for (const c of await Backend.listCampaigns()) await Backend.setCampaignStatus(c.id, 'ended');
  const c = await Backend.saveCampaign({ sponsor: 'Acme', title: 'T', mediaUrl: WEBM, durationS: 5 });
  await Backend.approveCampaign(c.id); await Backend.setCampaignStatus(c.id, 'live');
  return c.id;
}, WEBM);
const campaignId = await setup();

/* ---------------------------------------------------------------- */
sec('1. THE AUTHOR CAN SEE THE THING THEY BUILT');

const staff = await page.evaluate(async () => {
  const me = await Backend.currentUser();
  const off = await Ads.eligible();
  await Backend.saveAdSettings({ includeStaff: true });
  Ads.bust();
  const on = await Ads.eligible();
  await Backend.saveAdSettings({ includeStaff: false });
  Ads.bust();
  return { isEditor: !!(me && me.isEditor), off, on, back: await Ads.eligible() };
});
say('an editor is shown none by default', staff.isEditor && staff.off === false);
/* The reason it is a setting and not a law: the person who built it has
   to be able to look at it. */
say('  until they ask to be', staff.on === true);
say('  and the default comes back', staff.back === false);

const master = await page.evaluate(async () => {
  await Backend.saveAdSettings({ enabled: false, includeStaff: true }); Ads.bust();
  const off = await Ads.eligible();
  const shown = await Ads.maybeShow();
  await Backend.saveAdSettings({ enabled: true }); Ads.bust();
  return { off, shown, on: await Ads.eligible() };
});
say('the master switch stops everything', master.off === false && master.shown === false);
say('  and turning it back on restores it', master.on === true);

const paid = await page.evaluate(async () => {
  await Backend.saveAdSettings({ includeStaff: false, includePaid: true }); Ads.bust();
  const withPaid = await Backend.getAdSettings();
  await Backend.saveAdSettings({ includePaid: false }); Ads.bust();
  return withPaid.includePaid;
});
say('paying accounts can be included while launching', paid === true);

/* ---------------------------------------------------------------- */
sec('2. EVERY SWITCH CHANGES WHO LOOKS, NONE CHANGES WHAT IS COUNTED');

const freq = await page.evaluate(async () => {
  await Backend.saveAdSettings({ includeStaff: true, frequency: 'session' }); Ads.bust();
  sessionStorage.removeItem('aureum-ad-shown'); localStorage.removeItem('aureum-ad-day');
  const first = await Ads.maybeShow();            // plays
  const second = await Ads.maybeShow();           // same session: refused
  await Backend.saveAdSettings({ frequency: 'always' }); Ads.bust();
  const third = await Ads.maybeShow();            // 'always': plays again
  const fourth = await Ads.maybeShow();
  return { first, second, third, fourth };
});
say('once per session means once', freq.first === true && freq.second === false,
  `${freq.first} then ${freq.second}`);
/* The testing setting, and a legitimate launch choice. */
say('  "every time" means every time', freq.third === true && freq.fourth === true,
  `${freq.third} then ${freq.fourth}`);

/* THE WHOLE POINT. Four views above; the sponsor is told one. */
const unmoved = await page.evaluate(async (id) => {
  const r = (await Backend.adReport()).find(x => x.id === id);
  return { impressions: r.impressions, people: r.people };
}, campaignId);
say('and after all of that the sponsor is told one doctor, once',
  unmoved.impressions === 1 && unmoved.people === 1,
  unmoved.impressions + ' impressions, ' + unmoved.people + ' doctors');
say('  which is what makes "every time" safe to leave on',
  unmoved.impressions === 1);

const dayMode = await page.evaluate(async () => {
  await Backend.saveAdSettings({ frequency: 'day' }); Ads.bust();
  localStorage.removeItem('aureum-ad-day');
  const a = await Ads.maybeShow();
  const b = await Ads.maybeShow();
  const stamped = localStorage.getItem('aureum-ad-day');
  return { a, b, stamped: !!stamped };
});
say('once a day is remembered across sessions', dayMode.a === true && dayMode.b === false
  && dayMode.stamped, `${dayMode.a} then ${dayMode.b}`);

/* A forced preview must not consume the real allowance. */
const preview = await page.evaluate(async () => {
  await Backend.saveAdSettings({ frequency: 'session' }); Ads.bust();
  sessionStorage.removeItem('aureum-ad-shown');
  await Ads.maybeShow({ force: true });                 // preview
  const stillGets = await Ads.maybeShow();              // the real one
  return stillGets;
});
say('previewing does not use up the session', preview === true);

/* ---------------------------------------------------------------- */
sec('3. AND THERE IS SOMETHING TO WATCH');

const dev = readFileSync('js/dev-console.js', 'utf8');
say('the console can put the bundled clip on air',
  /id="ad-sample"/.test(dev) && /AUREUM \(sample\)/.test(dev) && /\/ads\/sample-5s\.mp4/.test(dev));
say('  play one on demand', /id="ad-preview"/.test(dev) && /maybeShow\(\{ force: true, fresh: true \}\)/.test(dev));
say('  and clear today so the count can be tried again', /id="ad-clear"/.test(dev));
/* The sample is marked as what it is, so it is never mistaken for a
   real sponsor in the report. */
say('the sample says it is not a real sponsor', /Not a real sponsor/.test(dev));

const sampleReal = await page.evaluate(async () => {
  const head = await fetch('/ads/sample-5s.mp4', { method: 'HEAD' });
  return { ok: head.ok, type: head.headers.get('content-type') };
});
say('and the bundled clip is actually served', sampleReal.ok && /video/.test(sampleReal.type || ''),
  sampleReal.type);

await page.evaluate(() => { sessionStorage['aureum-passkey'] = '1'; });
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/ads', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);
const ui = await page.evaluate(() => ({
  opts: [...document.querySelectorAll('[data-adset]')].map(i => i.dataset.adset),
  freq: [...document.querySelectorAll('#ad-freq option')].map(o => o.value),
  buttons: ['#ad-save', '#ad-sample', '#ad-preview', '#ad-clear'].filter(x => document.querySelector(x)).length,
  warns: /None of this changes what a sponsor is told/.test(document.body.textContent || '')
}));
say('the settings are on the page', ui.opts.length === 3, ui.opts.join(', '));
say('  with all three frequencies', ui.freq.join() === 'session,day,always', ui.freq.join(', '));
say('  and every control wired', ui.buttons === 4, ui.buttons + '/4');
/* Said where the choice is made, not buried in a doc. */
say('  saying plainly that none of it changes the sponsor’s number', ui.warns);

/* ---------------------------------------------------------------- */
sec('4. THE TEST AID IS THE NARROWEST ONE THAT WORKS');

const sql = readFileSync('supabase/schema.sql', 'utf8');
/* Delete-and-reinsert is precisely how a unique index is defeated, so
   this policy is the one place the release could have opened a hole. */
say('only an editor may clear, and only their own rows',
  /create policy ad_impressions_editor_clear_own on public\.ad_impressions for delete\s*\n\s*using \(user_id = auth\.uid\(\) and public\.is_editor\(\)\)/.test(sql));
say('  with the reason written beside it',
  /delete-and-reinsert loop is exactly how the unique index would be\s*\n--\s*defeated/.test(sql));

const clearing = await page.evaluate(async (id) => {
  const before = (await Backend.adReport()).find(x => x.id === id).impressions;
  const n = await Backend.clearMyImpressionsToday();
  const after = (await Backend.adReport()).find(x => x.id === id).impressions;
  /* And counting works again straight away — the point of the button. */
  const again = await Backend.recordImpression(id, 5000, true);
  const final = (await Backend.adReport()).find(x => x.id === id).impressions;
  return { before, n, after, again, final };
}, campaignId);
say('clearing removes my own impressions', clearing.n >= 1 && clearing.after === 0,
  `${clearing.before} → ${clearing.after}`);
say('  and the count can be tried again at once', clearing.again === true && clearing.final === 1);

/* A candidate must not be able to do this — it is the hole.
   Swapping account in place: going to #/auth while signed in just
   redirects, so there is no form to fill. */
await page.evaluate(async () => {
  await Backend.signOut();
  await Backend.signUp({ name: 'Dr Nimal Perera', email: 'nimal@example.com', password: 'password123' });
  await Backend.signIn('nimal@example.com', 'password123');
});
await page.waitForTimeout(600);
const asCandidate = await page.evaluate(async () => {
  const out = {};
  try { await Backend.clearMyImpressionsToday(); out.cleared = true; }
  catch { out.cleared = false; }
  try { await Backend.saveAdSettings({ enabled: false }); out.changed = true; }
  catch { out.changed = false; }
  out.stillOn = (await Backend.getAdSettings()).enabled;
  return out;
});
say('a candidate cannot clear impressions', asCandidate.cleared === false);
say('  nor change who sees an advertisement', asCandidate.changed === false);
say('  and the settings are untouched', asCandidate.stillOn === true);
/* But they can still READ them: the player needs to, on every open. */
say('  though the player can still read them',
  await page.evaluate(async () => !!(await Backend.getAdSettings())));

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v140/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '140', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
