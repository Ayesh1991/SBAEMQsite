/* t122 — Phase 1: the editor panel, and only the editors.

   WHAT THIS CHANGES. "Peer review" was in everybody's menu and open to
   every signed-in candidate: anyone could open the flagged list and propose
   a correction to any question in the bank. That was the right shape when
   there was one author and nobody to delegate to, and it is the wrong shape
   now. `editor` has been a granted role since v114, and the work behind
   this door is the work an editor will be paid for — counted per person,
   from the next release.

   WHAT DELIBERATELY DID NOT MOVE: flagging. A candidate still marks a
   question they doubt while they are practising, which is the only moment
   they know it is wrong. What went behind the role is ANSWERING a flag, not
   raising one — so the loop that keeps the bank honest still starts with
   whoever noticed, and §2 says so to the person who finds the door shut.

   AND WHAT STAYED WHERE IT WAS. The admin's power to APPROVE a proposal is
   still in the developer console, not here. v114 drew that line on purpose
   — "an editor writes content and sees nothing else, not the money, not the
   accounts, not the console" — and an editor who could approve their own
   proposal would make the approval meaningless. §4 holds it. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE DOOR IS GATED, AND THE OLD ONE STILL OPENS');

const app = readFileSync('js/app.js', 'utf8');
say('the panel has its own route', /\^#\\\/editor\(\?:\\\/\(flagged\|review\)\)\?\$/.test(app));
/* A dead bookmark teaches somebody the feature was removed. */
say('  and the old address still goes somewhere',
  /\^#\\\/peer\$[\s\S]{0,120}editor\/flagged/.test(app));
say('the nav link is drawn only for an editor',
  /\$\{isEd \? `<a href="#\/editor"/.test(app));
/* The roles nest: an owner who could not reach the editor panel would be
   locked out of their own bank. */
say('  and an admin counts as one', /user\.isEditor \|\| isDev/.test(app));

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

const signUp = async (name, email) => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(async () => { try { await Backend.signOut(); } catch {} });
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.click('#auth-toggle'); await page.waitForTimeout(300);
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1600);
};
const go = async hash => {
  await page.goto(B + '/index.html?r=' + Math.random() + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
};
const title = () => page.evaluate(() => document.querySelector('.page-title')?.textContent || '');
const hasTab = sel => page.evaluate(s => !!document.querySelector(s), sel);

/* ---------------------------------------------------------------- */
sec('2. A CANDIDATE IS TOLD, NOT BOUNCED');

await signUp('Dr Nimal Perera', 'nimal@example.com');
say('a candidate is not offered the panel', !(await hasTab('a[href="#/editor"]')));
await go('#/editor');
/* The link is not in their menu, so the only way here is a bookmark or
   something somebody pasted — they have done nothing wrong and a silent
   bounce to the dashboard leaves them wondering what they clicked. */
say('  and reaching it by link explains itself', /for the editors/i.test(await title()),
  await title());
const body = await page.evaluate(() => document.body.textContent);
/* THE SENTENCE THAT MATTERS. Flagging is what a candidate CAN do, it is
   what fills this panel, and the moment somebody is told "not for you" is
   the moment to say so. */
say('  saying plainly that flagging still needs nothing',
  /Flagging a question does not need it/.test(body));
say('  and offering a way back', await page.evaluate(() => !!document.querySelector('a[href="#/library"]')));

/* ---------------------------------------------------------------- */
sec('3. AN EDITOR GETS THE PANEL');

await signUp('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');
say('the owner is offered it', await hasTab('a[href="#/editor"]'));
await page.evaluate(async () => {
  const u = (await Backend.listAllUsers()).find(x => x.email === 'nimal@example.com');
  await Backend.setUserRole(u.id, 'editor');
});
await go('#/editor');
/* v123 moved the front door. The panel opens on the review queue, because
   that is the work that blocks candidates — a set nobody has read is
   content nobody can reach, whereas a flag is a question already in use
   that somebody doubts. Flagged is one tab away. */
say('  and it opens on the work that blocks candidates',
  /Sets waiting to be read/.test(await title()), await title());
await go('#/editor/flagged');
say('  with the flagged work one tab away',
  /Answer what the cohort flagged/.test(await title()), await title());
const tabs = await page.evaluate(() => [...document.querySelectorAll('.ed-tab')].map(t => t.textContent.trim()));
say('  and both sections in the sub-navigation', tabs.length === 2, tabs.join(', '));

/* The old address, from a bookmark or a message sent months ago. */
await go('#/peer');
say('the old peer-review link lands in the panel',
  (await page.evaluate(() => location.hash)) === '#/editor/flagged',
  await page.evaluate(() => location.hash));
say('  and renders it, rather than an empty page', /Answer what the cohort flagged/.test(await title()));

/* Now as the granted editor, who is not an admin. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.evaluate(async () => { await Backend.signOut(); await Backend.signIn('nimal@example.com', 'password123'); });
await go('#/editor');
say('a granted editor is offered the panel', await hasTab('a[href="#/editor"]'));
say('  and it opens', /Sets waiting to be read/.test(await title()), await title());

/* ---------------------------------------------------------------- */
sec('4. BUT AN EDITOR IS STILL NOT AN ADMIN');

/* THE LINE v114 DREW, and the reason this release did not simply move the
   console's review section here: approving a proposal is the owner's act.
   An editor who could approve their own proposal would make the approval
   a formality. */
say('an editor is not offered the developer console', !(await hasTab('a[href="#/dev"]')));
const devJs = readFileSync('js/dev-console.js', 'utf8');
say('  and approving a proposal is still in the console',
  /Community proposals awaiting your approval/.test(devJs));
const gate = await page.evaluate(async () => {
  const u = await Backend.currentUser();
  let err = null;
  try { await Backend.setProposalStatus('nothing', 'approved'); } catch (e) { err = e.message; }
  return { editor: u?.isEditor, dev: u?.isDeveloper, err };
});
say('  the account really is an editor and not an admin',
  gate.editor === true && gate.dev === false,
  'isEditor=' + gate.editor + ' isDeveloper=' + gate.dev);

/* ---------------------------------------------------------------- */
sec('5. AND THE WORK IS VISIBLE WITHOUT GOING LOOKING');

/* An editor has no console and no other reason to open the panel. Without
   a count on the tab, waiting work is only found by remembering to look. */
const badge = await page.evaluate(() => {
  const el = document.querySelector('#nav-ed-badge');
  return { there: !!el, hidden: el?.hidden };
});
say('the tab carries a badge for waiting flags', badge.there);
/* Nothing is flagged in this run, so it must be hidden rather than
   showing a zero — a permanent 0 is furniture, and furniture stops being
   read. */
say('  hidden while there is nothing waiting', badge.hidden === true);
say('  and filled from the flags, best-effort', /refreshEditorBadge/.test(app)
  && /listFlaggedDetails\(\)\) \|\| \[\]/.test(app));

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
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
