/* t114 — Phase 0: an editor is a person, not an email address.

   WHAT THIS REPLACES. Forty-one policies in supabase/schema.sql named one
   email address. Exactly one human being on Earth could publish a
   station, edit a paper or touch the curriculum, and adding a second
   author meant editing the schema and re-running it. For one exam with
   one author that was survivable. For several specialities, each needing
   its own editors, it is the thing that makes growth impossible — so it
   is the first thing Phase 0 removes.

   THREE ROLES:
     student — the default. Sits papers, keeps their own marks.
     editor  — writes CONTENT. No money, no spend, nobody else's account.
     admin   — all of that, plus users, money, configuration, the console.

   TWO THINGS THIS FILE EXISTS TO PROVE, because both are the kind of
   mistake that is invisible until it is expensive:

     · NOBODY CAN PROMOTE THEMSELVES. "own profile update" lets anyone
       write their own row, so without a guard anybody could set their own
       role to admin and take the platform. The guard is a database
       trigger, not a check in the browser, because a check in the browser
       is not a check.

     · NOBODY IS EVER LOCKED OUT. If the helpers read the role alone then
       on the first run — before any row says admin — nobody can write
       anything, including the person who would grant the first role. The
       owner's address stays as a second way in that no database state can
       take away. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE SCHEMA NO LONGER NAMES A PERSON');

const sql = readFileSync('supabase/schema.sql', 'utf8');
const EMAIL = "auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com'";
const policyLines = sql.split('\n');
const namedInPolicy = policyLines.filter(l => l.includes(EMAIL)).length;
say('no policy is granted to an email address any more', namedInPolicy === 0,
  namedInPolicy + ' left');
say('  the roles are named, and only those three',
  /role in \('student', 'editor', 'admin'\)/.test(sql));
say('  content is granted to editors', (sql.match(/public\.is_editor\(\)/g) || []).length > 20,
  (sql.match(/public\.is_editor\(\)/g) || []).length + ' uses');
/* Money, other people's accounts and global configuration are not
   content, and an editor has no business in any of them. */
const adminOnly = ['topups dev all', 'profiles dev read', 'profiles dev update',
  'config dev write', 'tokens dev read', 'usage dev read', 'essay feedback dev read'];
const guardedByAdmin = adminOnly.every(name => {
  const i = sql.indexOf(`create policy "${name}"`);
  if (i < 0) return false;
  const block = sql.slice(i, i + 400).split(';')[0];
  return block.includes('public.is_admin()') && !block.includes('is_editor');
});
say('  and money, accounts and configuration only to admins', guardedByAdmin,
  adminOnly.length + ' policies checked');

/* THE LOCKED DOOR WITH THE KEY INSIDE. */
say('the owner’s address still opens both helpers, so nobody can be locked out',
  (sql.match(/or coalesce\(auth\.jwt\(\) ->> 'email', ''\) = 'ayeshmantha@gmail\.com'/g) || []).length === 2);
say('  and the owner’s own row is stamped admin on the way past',
  /update public\.profiles set role = 'admin'/.test(sql));

/* THE ESCALATION GUARD. */
const trig = sql.slice(sql.indexOf('function public.protect_feature_flags()'));
say('the profiles trigger reverts a role a non-admin tried to set',
  /if new\.role is distinct from old\.role then new\.role := old\.role; end if;/.test(trig));
say('  and it decides by role, not by address', /if not public\.is_admin\(\) then/.test(trig));
/* A security-definer function with a loose search_path can be aimed at a
   table somebody else planted. */
say('  both helpers are security definer with a pinned search_path',
  (sql.match(/security definer set search_path = public/g) || []).length >= 3);

/* ---------------------------------------------------------------- */
sec('2. THE TWO BACKENDS STILL AGREE');

/* The local and cloud backends must export the SAME function list, or a
   feature works on one and throws on the other. */
const js = readFileSync('js/backend.js', 'utf8');
say('setUserRole exists in both backends', (js.match(/async function setUserRole/g) || []).length === 2);
say('  and is exported from both', (js.match(/setUserStatus, setUserRole,/g) || []).length === 2);

/* ---------------------------------------------------------------- */
sec('3. IN THE RUNNING APP');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

const signUp = async (name, email) => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  /* A signed-in session redirects away from the auth page, so the second
     account has to start from a signed-out one. */
  await page.evaluate(async () => { try { await Backend.signOut(); } catch {} });
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.click('#auth-toggle'); await page.waitForTimeout(250);
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1500);
};

/* A colleague who will write medicine questions — and the owner. */
await signUp('Dr Nimal Perera', 'nimal@example.com');
const student = await page.evaluate(async () => {
  const u = await Backend.currentUser();
  return { role: u?.role, dev: u?.isDeveloper, editor: u?.isEditor };
});
say('a new account is a student', student.role === 'student', student.role);
say('  not a developer, not an editor', !student.dev && !student.editor);
const navStudent = await page.evaluate(() => !!document.querySelector('a[href="#/dev"]'));
say('  and is not offered the developer console', !navStudent);

await signUp('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');
const owner = await page.evaluate(async () => {
  const u = await Backend.currentUser();
  return { role: u?.role, dev: u?.isDeveloper, editor: u?.isEditor };
});
/* THE FIRST RUN. No row anywhere says admin yet, and the owner must
   still be able to grant the first role. */
say('the owner is an admin on the very first run, with no role granted yet',
  owner.dev && owner.editor, 'role: ' + owner.role);
const navOwner = await page.evaluate(() => !!document.querySelector('a[href="#/dev"]'));
say('  and is offered the developer console', navOwner);

/* ---------------------------------------------------------------- */
sec('4. GRANTING A ROLE — AND NOT TAKING ONE');

const granted = await page.evaluate(async () => {
  const before = (await Backend.listAllUsers()).find(u => u.email === 'nimal@example.com');
  await Backend.setUserRole(before.id, 'editor');
  const after = (await Backend.listAllUsers()).find(u => u.email === 'nimal@example.com');
  let refused = null;
  try { await Backend.setUserRole(before.id, 'emperor'); } catch (e) { refused = e.message; }
  return { before: before.role, after: after.role, refused };
});
say('an admin can promote somebody to editor',
  granted.after === 'editor', granted.before + ' → ' + granted.after);
say('  and a role that does not exist is refused', /Unknown role/.test(granted.refused || ''),
  granted.refused);

/* Now sign in as the colleague and check what the role actually buys. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.evaluate(async () => { await Backend.signIn('nimal@example.com', 'password123'); });
/* Reloaded, not just re-routed: the navigation is painted once for
   whoever was signed in when the page loaded, and signing in underneath
   it leaves the previous person's menu on the screen. Measuring that
   would be measuring a stale DOM, not the rule. */
await page.goto(B + '/index.html?r=' + Math.random() + '#/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const editor = await page.evaluate(async () => {
  const u = await Backend.currentUser();
  return { role: u?.role, editor: u?.isEditor, dev: u?.isDeveloper,
    unlock: sessionStorage.getItem('aureum-dev'),
    nav: !!document.querySelector('a[href="#/dev"]') };
});
say('the colleague is now an editor', editor.role === 'editor' && editor.editor, editor.role);
/* THE POINT OF HAVING TWO ROLES. An editor writes content and sees
   nothing else — not the money, not the accounts, not the console. */
say('  but NOT an admin, and not offered the console', !editor.dev && !editor.nav,
  'isDeveloper=' + editor.dev + ' nav=' + editor.nav + ' devUnlock=' + editor.unlock);

/* ---------------------------------------------------------------- */
sec('5. AND NOBODY PROMOTES THEMSELVES');

/* In the cloud this is a database trigger — §1 asserts it is written.
   Here it is the same rule in the local backend, reached the way an
   attacker would: by asking the backend directly from the console. */
const selfRaise = await page.evaluate(async () => {
  const me = await Backend.currentUser();
  let err = null;
  try { await Backend.updateProfile({ role: 'admin' }); } catch (e) { err = e.message; }
  const after = await Backend.currentUser();
  return { was: me.role, now: after.role, err };
});
say('an editor cannot write their own way to admin',
  selfRaise.now !== 'admin', selfRaise.was + ' → ' + selfRaise.now);
say('  privilege is granted downwards, never claimed upwards', selfRaise.now === 'editor');

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v114/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '114', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
