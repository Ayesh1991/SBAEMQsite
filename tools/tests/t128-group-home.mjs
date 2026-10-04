/* t128 — Phase 7: one place for a group.

   A GROUP WAS SPREAD OVER THREE SURFACES THAT DID NOT MENTION EACH OTHER.
   Its chat was in a dock you opened from a button. Its wall was a strip on
   the Studio wall. Its papers were at #/group/<id>. And the strip — the
   only way to reach a group's wall — was drawn by `paintWallRooms`, which
   `renderPanel` never called. renderPanel is the FULL-PAGE Studio wall:
   the one almost everybody actually reads. So on that page there was no
   way to open a group's wall, and after v127 no way to make a group
   either. Both existed; neither was reachable from where people were
   standing.

   That is the shape of the bug worth remembering: not a function that
   threw, but a surface that was never given one. §1 is the regression
   test for exactly that call.

   NOTHING HERE IS A SECOND IMPLEMENTATION. Each tab mounts whoever already
   owned that job — the wall panel, the chat panel, GroupPaper, the members
   list. A second copy of the wall would be a second thing to keep in step
   with the first, and the first is the one with four releases of fixes in
   it.

   §4 IS THE ONE THAT WOULD ROT QUIETLY. Tabs swap a shared panel in and
   out, and the wall registers itself as `panelHost` so the poll can
   repaint it. Moving to another tab without putting it down leaves the
   poll repainting an element that is no longer in the document — nothing
   throws, the page just goes subtly stale. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE SURFACE THAT HAD NO WAY IN');

const tr = readFileSync('js/tearoom.js', 'utf8');
const app = readFileSync('js/app.js', 'utf8');
const grp = readFileSync('js/group.js', 'utf8');

/* THE REGRESSION, and the shape of its fix. renderPanel is the full-page
   wall; before v128 it drew a bar, a composer and a feed, never called
   paintWallRooms, and so could not reach a group at all.
   A SECOND STRIP HERE WOULD HAVE BEEN THE WRONG FIX — two switchers over
   one piece of state, where clicking either leaves the other's header
   naming the wall you just left. The first draft of this release did
   exactly that and t124 caught it. The panel stays the SHARED wall; a
   group has a page. */
say('the full-page wall takes a group rather than growing a second switcher',
  /async function renderPanel\(host, roomId\)/.test(tr)
  && !/data-tw-rooms/.test(tr.slice(tr.indexOf('async function renderPanel'), tr.indexOf('function releasePanel')))
  && /THE FIX IS NOT A SECOND STRIP HERE/.test(tr));
/* And it can be pointed at ONE group, which is what the group page uses. */
say('  and can be addressed to one group',
  /const want = roomId \|\| null;/.test(tr) && /if \(want !== wallRoom\)/.test(tr));
/* Switching wall must DROP what was loaded, not filter it. */
say('  dropping the posts of the wall you came from',
  /wallRoom = want; posts = \[\]; myRx = \{\}; loaded = false/.test(tr));

say('the chat can be mounted inside a page, not only in a dock',
  /async function renderChatPanel\(host, roomId\)/.test(tr));
/* paintChat used to assume one element existed. Two hosts, one painter. */
say('  and painting walks every live host rather than assuming the dock',
  /\[chatEl, chatPanelEl\]\.filter\(Boolean\)\.forEach\(paintChatInto\)/.test(tr));
say('the files shared in a group can be asked for in one call',
  /async function groupFiles\(roomId\)/.test(tr));
/* Both sources, each guarded — one failing must not empty the other. */
say('  gathering them from the wall AND the chat',
  /listDiscussions\?\.\(\{ limit: 200, roomId \}\)/.test(tr)
  && /listChatMessages\?\.\(roomId\)/.test(tr));

say('a group is one module, and not the one that sits a paper',
  /^const Group = \(\(\) => \{/m.test(grp) && !/^const GroupPaper/m.test(grp));
say('  reached by its own addresses, tab by tab',
  /\{ re: \/\^#\\\/groups\$\/, fn: renderGroups \}/.test(app)
  && /wall\|chat\|files\|papers\|members/.test(app));
say('  and the studio points at it', /id: 'groups'/.test(app) && /go: '#\/groups'/.test(app));

/* ---------------------------------------------------------------- */
sec('2. ONE PAGE, FIVE TABS, ALL OF THEM REAL');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
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
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1500);
};

await signUp('Dr Nimal Perera', 'nimal@example.com');
await signUp('Dr Sunil Perera', 'sunil@example.com');
await signUp('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');

const id = await page.evaluate(async () => {
  const n = (await Backend.searchPeople('Nimal'))[0];
  const r = await Backend.createChatRoom({ title: 'MD 2026 group', kind: 'group',
    memberIds: [n.id], myName: 'Dr Didula Ayeshmantha' });
  /* One of each thing the group holds, so every tab has something real to
     show rather than its empty state. */
  await Backend.addDiscussion({ topic: 'Said only to the group', kind: 'post', roomId: r.id,
    media: [{ url: 'data:text/plain;base64,aGk=', name: 'handout.txt', type: 'text/plain' }] });
  await Backend.sendChatMessage(r.id, 'see you Saturday', []);
  /* And one on the SHARED wall, which must not appear inside the group. */
  await Backend.addDiscussion({ topic: 'Said to everyone', kind: 'post' });
  return r.id;
});

const tab = async t => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/group/' + id + t, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2300);
  return page.evaluate(() => ({
    title: document.querySelector('.page-title')?.textContent || '',
    tabs: [...document.querySelectorAll('.g-tab')].map(a => a.textContent.trim()),
    on: document.querySelector('.g-tab.is-on')?.textContent.trim() || '',
    body: (document.querySelector('#g-panel')?.textContent || '').replace(/\s+/g, ' ').trim()
  }));
};

const wall = await tab('');
say('a group has a page of its own, named after it', /MD 2026 group/.test(wall.title), wall.title);
say('  with the five things a group holds', wall.tabs.length === 5, wall.tabs.join(' · '));
/* THE DEFAULT IS THE WALL, because that is what the user went looking for
   and could not find. */
say('  opening on the wall', /Wall/.test(wall.on), wall.on);
say('  which carries the group’s posts', /Said only to the group/.test(wall.body));
/* THE POINT OF A GROUP WALL. */
say('  and NOT the shared wall’s', !/Said to everyone/.test(wall.body));
say('  with a composer, so you can post into the group from here',
  await page.evaluate(() => !!document.querySelector('#g-panel [data-act="post"]')));

const chat = await tab('/chat');
say('the chat is inside the page, not a dock you have to find',
  /see you Saturday/.test(chat.body), chat.on);
say('  with somewhere to type', await page.evaluate(() =>
  !!document.querySelector('#g-panel .tc-compose textarea')));

const files = await tab('/files');
/* Attached to a post on the group's wall, and found here — which is what
   "shared in the group" means to somebody hunting last Tuesday's handout. */
say('the files tab finds what was attached to the group’s wall',
  /handout\.txt/.test(files.body), files.body.slice(0, 80));

const papers = await tab('/papers');
say('the papers the group sits together are a tab, not a separate address',
  /Papers you sit together/.test(papers.body));

const members = await tab('/members');
say('the members tab says who is in it and what they are',
  /Didula Ayeshmantha/.test(members.body) && /Nimal Perera/.test(members.body), members.on);
say('  with the admin marked', /Admin/.test(members.body));

/* ---------------------------------------------------------------- */
sec('3. AND IT IS STILL ONLY THE GROUP’S');

/* A page is a nicer way to reach a group. It is not a way IN — that is
   still the database's answer, and §3 is the test that a page did not
   quietly become a door. */
const outsider = await page.evaluate(async i => {
  await Backend.signOut(); await Backend.signIn('sunil@example.com', 'password123');
  return { groups: (await Backend.listChatRooms()).length,
    wall: (await Backend.listDiscussions({ roomId: i })).length };
}, id);
say('somebody outside the group is in no groups', outsider.groups === 0, outsider.groups + ' groups');
say('  and asking for its wall by id gets nothing', outsider.wall === 0, outsider.wall + ' posts');
const bounced = await tab('');
say('  and the page says so rather than showing an empty group',
  /Not one of your groups/.test(bounced.title), bounced.title);
say('  offering the way back', await page.evaluate(() =>
  !!document.querySelector('a[href="#/groups"]')));

/* ---------------------------------------------------------------- */
sec('4. AND MOVING BETWEEN TABS PUTS THE LAST ONE DOWN');

/* The wall registers itself as panelHost so the poll can repaint it.
   Leaving it registered while another tab is on screen means the poll
   repaints an element that is no longer in the document — nothing throws,
   the page just goes quietly stale. */
say('each tab releases the surface the last one mounted',
  /TeaRoom\.releasePanel\?\.\(\);\s*\n\s*TeaRoom\.releaseChatPanel\?\.\(\);/.test(grp));
say('  and the module offers both handles to release',
  /renderChatPanel, releaseChatPanel, groupFiles/.test(tr));

await page.evaluate(async () => { await Backend.signOut(); await Backend.signIn('ayeshmantha@gmail.com', 'password123'); });
await page.goto(B + '/index.html?r=' + Math.random() + '#/group/' + id + '/wall', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
/* Walk the tabs in one session, the way a person would, and let the poll
   run over the top of it. A stale handle shows up here or nowhere. */
for (const t of ['chat', 'files', 'members', 'wall']) {
  await page.evaluate(x => { document.querySelector(`.g-tab[href$="/${x}"]`)?.click(); }, t);
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { try { await TeaRoom._pollNow?.(); } catch {} });
  await page.waitForTimeout(400);
}
const after = await page.evaluate(() => ({
  on: document.querySelector('.g-tab.is-on')?.textContent.trim() || '',
  body: (document.querySelector('#g-panel')?.textContent || '').replace(/\s+/g, ' ').trim()
}));
say('walking every tab and polling throughout leaves the wall intact',
  /Wall/.test(after.on) && /Said only to the group/.test(after.body), after.on);
say('  and still shows nothing from the shared wall', !/Said to everyone/.test(after.body));

/* ---------------------------------------------------------------- */
sec('5. THE LIST OF YOUR GROUPS, AND THE WAY TO MAKE ONE');

await page.goto(B + '/index.html?r=' + Math.random() + '#/groups', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2100);
const index = await page.evaluate(() => ({
  title: document.querySelector('.page-title')?.textContent || '',
  cards: [...document.querySelectorAll('.g-card-n')].map(x => x.textContent.trim()),
  links: [...document.querySelectorAll('.g-card')].map(a => a.getAttribute('href')),
  New: !!document.querySelector('#g-new')
}));
say('your groups are listed in one place', /Your groups/.test(index.title), index.title);
say('  naming each one', index.cards.join() === 'MD 2026 group', index.cards.join(', '));
say('  linking to its page', (index.links[0] || '').includes('#/group/'), index.links[0]);
/* THE CONTROL SOMEBODY WITH NO GROUPS NEEDS MOST. */
say('  and offering the way to make another', index.New);

/* Somebody in no groups is told how to start, not shown an empty box. */
await page.evaluate(async () => { await Backend.signOut(); await Backend.signIn('sunil@example.com', 'password123'); });
await page.goto(B + '/index.html?r=' + Math.random() + '#/groups', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const empty = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.g-card')].length,
  text: (document.querySelector('.card')?.textContent || '').replace(/\s+/g, ' ').trim(),
  New: !!document.querySelector('#g-new')
}));
say('somebody in no groups sees none of anybody else’s', empty.cards === 0, empty.cards + ' cards');
say('  is told they will be its admin', /you will be its admin/i.test(empty.text), empty.text.slice(0, 90));
say('  and still has the button', empty.New);

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  /* The literal belongs to the newest release file only — see the README. */
  return { vs, sw: vs.length === 1 && sw.includes("'aureum-v" + vs[0] + "'"), has: /js\/group\.js\?v=/.test(h) };
});
say('one version across every asset', stamp.vs.length === 1, stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);
/* A module nothing loads is a module that does not exist. */
say('  and the new module is actually loaded by the page', stamp.has);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
