/* t139 — the sponsored pre-roll, and a number that can be defended.

   Supabase costs $25–40 a month and the candidates are registrars on a
   registrar's salary. A five-second pre-roll pays the bill instead of
   charging them. That makes this the first feature here with somebody
   OUTSIDE the project reading its output, so two things matter more
   than usual.

   §4 IS THE ONE THAT MATTERS MOST. An advertisement must never stop
   somebody studying. Every failure — no campaign, no network, a video
   that will not decode, autoplay refused — has to end with the app
   open. The test gets this honestly: Playwright's Chromium ships
   without H.264, so `ads/sample-5s.mp4` is a REAL undecodable video in
   this container, not a mock of one.

   §1 AND §5 ARE WHAT A SPONSOR IS SOLD. A browser can always lie about
   having watched a video; that is not fixable in a static app and
   claiming otherwise would be the dishonest part. So the claim is
   deliberately modest — "N distinct doctors, once each per day" — and
   the DATABASE keeps it, not the client: a unique index on (campaign,
   user, day), an insert policy that files it under the viewer's own id,
   and the server's clock.

   §2 IS THE REGULATOR. NMRA rules restrict advertising prescription
   medicines to the public, so nothing is served until a named person
   has approved it — and swapping the creative afterwards withdraws
   that approval, or the gate is theatre. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const WEBM = '/ads/sample-5s.webm';   // VP9 — the only thing this Chromium decodes
const MP4 = '/ads/sample-5s.mp4';     // H.264 — genuinely undecodable here, which §4 uses

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

/* ---------------------------------------------------------------- */
sec('1. THE CLAIM THE SCHEMA CAN KEEP');

const sql = readFileSync('supabase/schema.sql', 'utf8');
/* The dedup is ONE index, and it is the whole reason the monthly figure
   means "distinct doctors" rather than "times a page loaded". */
say('one impression per candidate per campaign per day, by unique index',
  /create unique index if not exists ad_impressions_once_a_day\s*\n\s*on public\.ad_impressions \(campaign_id, user_id, day\)/.test(sql));
/* A device with its clock wound back must not be a fresh impression. */
say('  dated by the server, never by the client',
  /day\s+date not null default \(now\(\) at time zone 'utc'\)::date/.test(sql));
say('  filed under the viewer’s own id and nobody else’s',
  /create policy ad_impressions_insert_own[\s\S]{0,200}user_id = auth\.uid\(\)/.test(sql));
say('  and only ever for a campaign that is live and approved',
  /with check \(\s*\n\s*user_id = auth\.uid\(\)[\s\S]{0,260}c\.status = 'live' and c\.approved_at is not null/.test(sql));
/* The tally is the editor's; a candidate cannot read what they are part of. */
say('the tally is readable only by an editor',
  /create policy ad_impressions_editor_read[\s\S]{0,120}public\.is_editor\(\)/.test(sql));
/* The honest limit, written down where the next person will look. */
say('and the limit of all this is written down, not glossed',
  /A BROWSER CAN ALWAYS LIE/.test(sql));

const be = readFileSync('js/backend.js', 'utf8');
say('both backends can serve, count and report',
  ['liveAds', 'recordImpression', 'adReport', 'approveCampaign', 'setCampaignStatus', 'saveCampaign', 'myPlan']
    .every(f => (be.match(new RegExp('async function ' + f + '\\(', 'g')) || []).length === 2));

/* ---------------------------------------------------------------- */
sec('2. NOTHING RUNS UNTIL A NAMED PERSON SAYS SO');

const gate = await page.evaluate(async (WEBM) => {
  const c = await Backend.saveCampaign({ sponsor: 'Acme Pharma', title: 'Iron Q1',
    mediaUrl: WEBM, durationS: 5 });
  const asDraft = (await Backend.liveAds()).length;
  await Backend.approveCampaign(c.id);
  const approvedOnly = (await Backend.liveAds()).length;
  await Backend.setCampaignStatus(c.id, 'live');
  const onAir = (await Backend.liveAds()).length;
  return { id: c.id, asDraft, approvedOnly, onAir };
}, WEBM);
say('a draft is never served', gate.asDraft === 0, gate.asDraft + ' servable');
/* Approved is not the same as on air — the editor still chooses when. */
say('  nor is one approved but not yet on air', gate.approvedOnly === 0, gate.approvedOnly + ' servable');
say('  on air, it is served', gate.onAir === 1, gate.onAir + ' servable');

const swap = await page.evaluate(async (id) => {
  await Backend.saveCampaign({ id, mediaUrl: '/ads/SOMETHING-ELSE.webm' });
  const c = (await Backend.listCampaigns()).find(x => x.id === id);
  return { status: c.status, approved: !!c.approved_at, servable: (await Backend.liveAds()).length };
}, gate.id);
/* THE GATE IS NOT THEATRE. Approving a creative and then swapping the
   file is the one way it becomes one. */
say('swapping the creative withdraws the approval', !swap.approved);
say('  takes it off air', swap.status === 'draft', swap.status);
say('  and it stops being served that instant', swap.servable === 0, swap.servable + ' servable');
say('  it cannot be put back on air unapproved',
  await page.evaluate(async (id) => {
    try { await Backend.setCampaignStatus(id, 'live'); return false; } catch { return true; }
  }, gate.id));

/* ---------------------------------------------------------------- */
sec('3. THE PRE-ROLL ITSELF');

await page.evaluate(async (args) => {
  await Backend.saveCampaign({ id: args.id, mediaUrl: args.WEBM });
  await Backend.approveCampaign(args.id);
  await Backend.setCampaignStatus(args.id, 'live');
}, { id: gate.id, WEBM });

const frames = await page.evaluate(async () => {
  window.__done = null;
  Ads.maybeShow({ force: true }).then(v => { window.__done = v; });
  const shots = [];
  for (let i = 0; i < 7; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 500 : 1000));
    shots.push({
      shade: !!document.querySelector('.ad-shade'),
      count: (document.querySelector('[data-ad-count]')?.textContent || '').trim(),
      skipOff: document.querySelector('[data-ad-skip]')?.disabled,
      done: window.__done
    });
    if (window.__done !== null) break;
  }
  return shots;
});
const early = frames[0], atSkip = frames.find(f => f.skipOff === false), last = frames[frames.length - 1];
say('the ad takes the screen', early.shade, JSON.stringify(early));
/* The wait is told, not guessed at. */
say('  counting down to the skip', /Skip in \d/.test(early.count), early.count);
say('  skip unlocks once it has actually played', !!atSkip, atSkip ? atSkip.count || 'enabled' : 'never');
say('  and it ends by itself', last.done === true && !last.shade);

const counted = await page.evaluate(async () => (await Backend.adReport())[0]);
/* The threshold for counting and for skipping is the same 3s on
   purpose: a candidate who skips the instant they may has still
   watched what the sponsor paid for, so there is nothing to argue
   about at the end of the month. */
say('an impression is recorded', counted.impressions === 1, JSON.stringify({
  impressions: counted.impressions, people: counted.people, completed: counted.completed }));
say('  and watching to the end is recorded separately', counted.completed === 1);
say('  the skip and the count are the same threshold',
  readFileSync('js/ads.js', 'utf8').match(/COUNT_AT_MS = 3000/)
  && readFileSync('js/ads.js', 'utf8').match(/SKIP_AT_MS = 3000/));

/* ---------------------------------------------------------------- */
sec('4. AND IT NEVER STOPS SOMEBODY STUDYING');

/* THE REAL THING, not a mock: this Chromium has no H.264, so the MP4 in
   ads/ genuinely cannot be decoded here. A creative that will not play
   must let the candidate straight in and count nothing. */
const broken = await page.evaluate(async (MP4) => {
  const v = document.createElement('video');
  const h264 = v.canPlayType('video/mp4; codecs="avc1.42E01E"');
  const c = await Backend.saveCampaign({ sponsor: 'Broken Co', title: 'undecodable', mediaUrl: MP4, durationS: 5 });
  await Backend.approveCampaign(c.id); await Backend.setCampaignStatus(c.id, 'live');
  await Backend.setCampaignStatus((await Backend.listCampaigns()).find(x => x.sponsor === 'Acme Pharma').id, 'ended');
  const t0 = Date.now();
  const shown = await Ads.maybeShow({ force: true });
  const ms = Date.now() - t0;
  const rep = (await Backend.adReport()).find(r => r.sponsor === 'Broken Co');
  return { h264, ms, shown, shade: !!document.querySelector('.ad-shade'),
    locked: document.body.classList.contains('ad-open'), impressions: rep.impressions };
}, MP4);
say('this browser really cannot decode the H.264 sample', broken.h264 === '', `canPlayType=${JSON.stringify(broken.h264)}`);
say('  a creative that will not play gives up quickly', broken.ms < 8000, broken.ms + 'ms');
say('  the screen is handed back', !broken.shade && !broken.locked);
/* An impression nobody saw would be the dishonest kind. */
say('  and nothing is counted for it', broken.impressions === 0, broken.impressions + ' impressions');

const quiet = await page.evaluate(async () => {
  for (const c of await Backend.listCampaigns()) await Backend.setCampaignStatus(c.id, 'ended');
  const t0 = Date.now();
  const shown = await Ads.maybeShow({ force: true });
  return { shown, ms: Date.now() - t0 };
});
say('with no campaign at all it returns at once', quiet.shown === false && quiet.ms < 2000,
  quiet.ms + 'ms');

/* ---------------------------------------------------------------- */
sec('5. A REFRESH LOOP CANNOT INFLATE WHAT A SPONSOR IS SOLD');

const dedup = await page.evaluate(async (WEBM) => {
  const c = await Backend.saveCampaign({ sponsor: 'Dedup Ltd', title: 'D', mediaUrl: WEBM, durationS: 5 });
  await Backend.approveCampaign(c.id); await Backend.setCampaignStatus(c.id, 'live');
  const first = await Backend.recordImpression(c.id, 5000, true);
  const again = await Backend.recordImpression(c.id, 5000, true);
  const third = await Backend.recordImpression(c.id, 5000, true);
  const rep = (await Backend.adReport()).find(r => r.sponsor === 'Dedup Ltd');
  return { first, again, third, impressions: rep.impressions, people: rep.people };
}, WEBM);
say('the first view counts', dedup.first === true);
say('  the second and third the same day do not', dedup.again === false && dedup.third === false);
say('  so the sponsor is told one doctor, once',
  dedup.impressions === 1 && dedup.people === 1,
  dedup.impressions + ' impressions, ' + dedup.people + ' doctors');
/* And a draft cannot be credited even by calling the API directly. */
say('an unapproved campaign cannot be credited at all',
  await page.evaluate(async (WEBM) => {
    const c = await Backend.saveCampaign({ sponsor: 'Sneaky', title: 'S', mediaUrl: WEBM, durationS: 5 });
    return (await Backend.recordImpression(c.id, 5000, true)) === false;
  }, WEBM));

/* ---------------------------------------------------------------- */
sec('6. WHO IS SHOWN ONE');

const ads = readFileSync('js/ads.js', 'utf8');
/* v140 made this conditional rather than absolute — the author of the
   thing has to be able to look at it — so the rule asserted here is now
   "staff are excluded BY DEFAULT", which is what it always meant. The
   setting itself is t140's §1. */
say('staff are not the audience',
  /\(me\.isEditor \|\| me\.isAdmin\) && !c\.includeStaff\) return false/.test(ads)
  && /includeStaff: false/.test(ads));
say('  nor is anybody who has paid', /\(plan \|\| 'free'\) === 'free'/.test(ads));
/* The flag exists before the tier does: a candidate who has paid and is
   still advertised to is the complaint that follows a paid tier. */
say('  and the plan column exists before the paid tier does',
  /alter table public\.profiles add column if not exists plan text not null default 'free'/.test(sql));
say('once per session, not once per page', /SESSION_KEY = 'aureum-ad-shown'/.test(ads)
  && /sessionStorage/.test(ads));
/* A private window must not throw on the way to studying. */
say('  and a browser that refuses storage still opens the app',
  /catch \{ return false; \}/.test(ads) && /catch \{ \/\* private window \*\/ \}/.test(ads));

const whoSees = await page.evaluate(async () => {
  const me = await Backend.currentUser();
  return { editorEligible: await Ads.eligible(), isEditor: !!(me && me.isEditor) };
});
say('the editor signed in here is shown none',
  whoSees.isEditor && whoSees.editorEligible === false);

/* ---------------------------------------------------------------- */
sec('7. WHAT THE SPONSOR IS HANDED');

await page.evaluate(() => { sessionStorage['aureum-passkey'] = '1'; });
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/ads', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
const ui = await page.evaluate(() => {
  const txt = document.body.textContent || '';
  return {
    title: (document.querySelector('.page-title') || {}).textContent || '',
    rows: document.querySelectorAll('#ad-list tbody tr').length,
    hasApprove: !!document.querySelector('[data-ad-approve]'),
    reportHeads: [...document.querySelectorAll('#ad-report th')].map(t => t.textContent.trim()),
    csv: !!document.querySelector('#ad-csv'),
    explains: /distinct accounts, counted\s+once per day/.test(txt.replace(/\s+/g, ' '))
      || /Doctors.{0,120}distinct accounts/.test(txt.replace(/\s+/g, ' '))
  };
});
say('the console has a sponsors page', /Campaigns, and what the sponsor is told/.test(ui.title), ui.title);
say('  listing the campaigns', ui.rows > 0, ui.rows + ' rows');
say('  with an approve control on what is not approved', ui.hasApprove);
/* Doctors FIRST: it is the weaker number that everyone asks for, and
   the stronger one that should be quoted. */
say('  the report leads with doctors, not impressions',
  ui.reportHeads[1] === 'Doctors' && ui.reportHeads[2] === 'Impressions', ui.reportHeads.join(' | '));
say('  says plainly what the number means', ui.explains);
say('  and can be handed over as a file', ui.csv);

const dev = readFileSync('js/dev-console.js', 'utf8');
/* Approving is the moment the legal responsibility is taken, so the
   dialog has to say what is being taken on. */
say('approving states what is being certified',
  /appropriate for a medical audience and complies with/.test(dev)
  && /NMRA rules/.test(dev));
say('  and that the approval does not survive a swap',
  /withdraws this approval automatically/.test(dev));
/* The console steers away from the thing that would have broken this. */
say('the importer warns off YouTube embeds', /Not a YouTube link:/.test(dev));

const app = readFileSync('js/app.js', 'utf8');
say('and a candidate can read why they are seeing it',
  /#\\\/about-ads\$/.test(app) && /renderAboutAds/.test(app));
say('  which says what is NOT sent to a sponsor',
  /is never sent to a sponsor/.test(app) && /no third-party advertising network/.test(app));

/* ---------------------------------------------------------------- */
sec('8. STAMPS');
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
